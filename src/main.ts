import { Application } from "pixi.js";
import {
  ARROW_DAMAGE,
  ENEMY_DAMAGE,
  ENEMY_ARROW_DAMAGE,
  ENEMY_RADIUS,
  ENEMY_HP,
  ENEMY_HEIGHTS,
  PLAYER_HP,
  PLAYER_HEIGHT,
  ROOM_DEPTH,
  TUTORIAL_TIMEOUT,
} from "./config.ts";
import { adapter } from "@network";
import { startLoop } from "./engine/loop.ts";
import { onResize } from "./engine/resize.ts";
import { device } from "./engine/device.ts";
import { WorldScene } from "./three/world.ts";
import { createPlayer, movePlayer } from "./game/player.ts";
import { keyboardDirection } from "./input/keyboard.ts";
import { Joystick } from "./ui/joystick.ts";
import { Hud } from "./ui/hud.ts";
import { HealthBars } from "./ui/healthBars.ts";
import { addKills, createState, progress } from "./game/state.ts";
import { EndCard } from "./ui/endCard.ts";
import { TutorialHand } from "./ui/tutorialHand.ts";
import { Mist } from "./ui/mist.ts";
import { DamageNumbers } from "./ui/damageNumbers.ts";
import { endRun } from "./game/state.ts";
import { clamp } from "./engine/math.ts";
import { loadArcher, loadArrow, loadEnemy, loadHero, loadScenery } from "./three/assets.ts";
import {
  createEnemies,
  separateEnemies,
  updateEnemies,
} from "./game/enemy.ts";
import { createSpawner, updateSpawner } from "./game/spawner.ts";
import { createObstacles } from "./game/obstacles.ts";
import { createGrid, solveFlow } from "./game/pathfind.ts";
import { createProjectiles, updateProjectiles } from "./game/projectiles.ts";
import { updateEnemyAttacks, updateShooting } from "./game/combat.ts";

/**
 * Composition root. Two stacked canvases: Three.js world (#world) below,
 * transparent Pixi UI overlay (#ui) above. Game state lives outside the
 * renderers, so a resize/orientation change never restarts the game.
 *
 * CTA: call adapter.cta() from the end card; label is adapter.ctaLabel.
 */
/**
 * How wide a floating bar is, as a fraction of its own body's height.
 *
 * 0.57 is not a taste: 44 px was tuned at 055610a against a body 1.836 units
 * tall, in the same 9-unit-wide framing this still uses, which is 42 px a
 * unit. The ratio is what was already on screen — only now it is expressed
 * against the body, so a scale edit resizes the bar instead of leaving a
 * full-size strip over a smaller model.
 *
 * Height drives it, not width: Erika's bounding box is 1.845 across because
 * her bow is in it, so width is not a usable proxy for how big a body reads.
 */
const BAR_WIDTH_OF_HEIGHT = 0.57;

/**
 * Clear of the head, in world units — one number for every body, so bars over
 * heads of different heights sit the same distance above them. A world-space
 * Y offset moves cos(48.5) = 0.66 of itself up the screen, so this is about
 * seven pixels of gap.
 */
const BAR_GAP = 0.25;

/** Where a damage number starts, as a fraction of the body's height. Below
 *  the bar, so the two do not overlap on the way up — as a fixed 2.1 it was
 *  *above* the hero's 1.56 head and crossed the bar it was meant to clear. */
const HIT_NUMBER_OF_HEIGHT = 0.75;

async function boot(): Promise<void> {
  // The network decides when the ad may start (MRAID ready etc.).
  await adapter.ready();
  const [hero, archer, enemy, arrow, scenery] = await Promise.all([
    loadHero(),
    loadArcher(),
    loadEnemy(),
    loadArrow(),
    loadScenery(),
  ]);
  const [tree, rock, mushroom, pine] = scenery;
  const enemies = createEnemies();
  const spawner = createSpawner();
  const projectiles = createProjectiles();
  const state = createState();

  const player = createPlayer();
  const obstacles = createObstacles();
  // Planned with the enemy's radius baked in, so the field never routes
  // anything through a gap it cannot fit through.
  const grid = createGrid(obstacles, ENEMY_RADIUS);

  const world = new WorldScene(
    { hero, archer, enemy, arrow, scenery: { tree, rock, mushroom, pine } },
    obstacles,
  );

  const app = new Application();
  await app.init({ resizeTo: device, backgroundAlpha: 0, antialias: true });
  app.canvas.id = "ui";
  device.appendChild(app.canvas);

  const mist = new Mist();
  const joystick = new Joystick();
  const hud = new Hud();
  // One per enemy, plus the player's at index 0.
  const bars = new HealthBars(enemies.length + 1);
  const endCard = new EndCard();
  const hand = new TutorialHand();
  // Three values and no more: every arrow the player fires does ARROW_DAMAGE,
  // and the player is only ever hit by a swing or an enemy arrow. Four labels
  // each is more than can be in the air at once at these hit rates.
  const numbers = new DamageNumbers(
    [ARROW_DAMAGE, ENEMY_DAMAGE, ENEMY_ARROW_DAMAGE],
    4,
  );
  // A hit is the frame a flash timer goes up, which is the same edge the
  // white flash is drawn from. Built once; nothing here allocates per frame.
  const lastEnemyFlash = enemies.map(() => 0);
  let lastPlayerFlash = 0;

  // First child, so the haze sits over the 3D world and under every widget.
  app.stage.addChild(mist);
  app.stage.addChild(hud);
  app.stage.addChild(bars);
  // Over the bars, under the stick: a number is the thing being read.
  app.stage.addChild(numbers);
  app.stage.addChild(joystick);
  app.stage.addChild(hand);
  // Last, so it covers the joystick: the run is over, the stick is not live.
  app.stage.addChild(endCard);
  app.stage.eventMode = "static";
  app.stage.hitArea = app.screen;
  joystick.listenOn(app.stage);

  // The tutorial ends on the first input of any kind, so the listeners are
  // registered once and never removed — a flag is cheaper than teardown, and
  // nothing else reads it after the first frame of gameplay.
  let touched = false;
  let tutorialElapsed = 0;
  const noteInput = (): void => {
    touched = true;
  };
  app.stage.on("pointerdown", noteInput);
  window.addEventListener("keydown", noteInput, { once: true });

  // The camera now moves, so the haze has to be re-anchored every frame
  // rather than on resize — these are the last viewport the layout saw.
  let screenW = 1;
  let screenH = 1;

  onResize((w, h) => {
    screenW = w;
    screenH = h;
    world.resize(w, h);
    // Thumb-sized on a phone, not absurd on a desktop. Based on the shorter
    // side, so rotating changes where the joystick is, never how big.
    // Ring is 70 units wide, and reference.jpg puts it at ~19% of screen
    // width. Driven by the shorter side so rotating moves it, never resizes it.
    const scale = clamp(Math.min(w, h) / 420, 0.85, 1.5);
    joystick.scale.set(scale);
    // Portrait: thumb-centre, below the room. Landscape: bottom-left, because
    // a centred stick there lands in the middle of the arena, on the archer.
    // A fraction, not a pixel offset: this holds its place across aspect
    // ratios, and puts the stick over the play area rather than below it.
    // Only where it *rests* — the base moves to the thumb on every touch.
    joystick.place(w > h ? w * 0.18 : w / 2, w > h ? h * 0.72 : h * 0.84, w, h);
    hud.layout(w, h, scale);
    bars.layout(w, h);
    endCard.layout(w, h);
    hand.layout(w, h, joystick.x, joystick.y);
    // TODO: re-position UI elements
  });

  startLoop(app, (dt) => {
    if (state.stage === "tutorial") {
      hand.advance(dt);
      tutorialElapsed += dt;
      if (touched || tutorialElapsed >= TUTORIAL_TIMEOUT) {
        state.stage = "gameplay";
        hand.visible = false;
      }
    } else if (state.stage === "gameplay") {
      const dir = joystick.dragging ? joystick.direction : keyboardDirection();
      movePlayer(player, dir.x, dir.z, dt, obstacles);
      // One solve serves every enemy, and it early-outs unless the player
      // changed cell.
      solveFlow(grid, player.x, player.z);
      updateSpawner(spawner, enemies, dt);
      updateEnemies(enemies, player.x, player.z, dt, obstacles, grid);
      separateEnemies(enemies, obstacles, dt);
      updateEnemyAttacks(enemies, player, projectiles, obstacles, dt);
      updateShooting(player, enemies, projectiles, obstacles, dt);
      addKills(state, updateProjectiles(projectiles, enemies, player, obstacles, dt));
      if (player.hp <= 0) endRun(state);
    } else if (!endCard.visible) {
      endCard.show(state.points, state.cleared);
    }

    // Views keep syncing and mixers keep advancing after the run ends, so the
    // room idles behind the card instead of freezing mid-stride.
    //
    // The camera is aimed first: the bars and the haze are placed from its
    // projection, and aiming after them would place this frame's overlay
    // against last frame's view.
    world.follows(player.z, dt);
    // The near wall in screen pixels: where the land in front of the arena
    // starts, and so where the haze starts. Per frame now, because the camera
    // travels — on resize only, the band would stay where the wall was at
    // boot. project() returns a shared object, so it is read before anything
    // else can call it.
    // Both walls, read one at a time: project() hands back one shared
    // object, so the near edge is taken before the far one overwrites it.
    const nearEdge = world.project(0, 0, ROOM_DEPTH / 2).y;
    mist.layout(
      screenW,
      screenH,
      nearEdge,
      world.project(0, 0, -ROOM_DEPTH / 2 - 4.6).y,
    );
    hud.update(state.points, progress(state));
    world.syncPlayer(player);
    for (let i = 0; i < enemies.length; i++) {
      const ene = enemies[i];
      world.syncEnemy(i, ene);
    }
    for (let i = 0; i < projectiles.length; i++) {
      world.syncArrow(i, projectiles[i]);
    }
    // Floating bars live in Pixi but follow entities in the Three scene, so
    // each position is projected through the camera. project() returns a
    // shared object: read it before the next call.
    const head = world.project(player.x, PLAYER_HEIGHT + BAR_GAP, player.z);
    bars.set(
      0,
      head.x,
      head.y,
      player.hp / PLAYER_HP,
      head.onScreen,
      false,
      dt,
      PLAYER_HEIGHT *
        BAR_WIDTH_OF_HEIGHT *
        world.pixelsPerUnit(player.x, player.z),
    );
    bars.setPlayerHp(player.hp);
    if (player.hitFlash > lastPlayerFlash) {
      const at = world.project(
        player.x,
        PLAYER_HEIGHT * HIT_NUMBER_OF_HEIGHT,
        player.z,
      );
      if (at.onScreen) numbers.pop(player.lastDamage, at.x, at.y);
    }
    lastPlayerFlash = player.hitFlash;
    for (let i = 0; i < enemies.length; i++) {
      const enemy = enemies[i];
      // Per kind, because the two are nothing like the same height: the
      // robot stands 0.86 units and the archer 1.07, and one number for both
      // put one bar on a head and the other in the air above it.
      const height = ENEMY_HEIGHTS[enemy.kind];
      const over = world.project(enemy.x, height + BAR_GAP, enemy.z);
      const standing = enemy.alive && enemy.dying === 0;
      bars.set(
        i + 1,
        over.x,
        over.y,
        enemy.hp / ENEMY_HP,
        standing && over.onScreen,
        true,
        dt,
        height * BAR_WIDTH_OF_HEIGHT * world.pixelsPerUnit(enemy.x, enemy.z),
      );
      if (enemy.hitFlash > lastEnemyFlash[i]) {
        // project() hands back one shared object, so the bar's position is
        // already consumed above before this overwrites it.
        const at = world.project(
          enemy.x,
          height * HIT_NUMBER_OF_HEIGHT,
          enemy.z,
        );
        if (at.onScreen) numbers.pop(ARROW_DAMAGE, at.x, at.y);
      }
      lastEnemyFlash[i] = enemy.hitFlash;
    }
    numbers.advance(dt);

    world.update(dt);
    world.render();
  });
}

void boot();
