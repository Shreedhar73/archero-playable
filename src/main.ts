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
import { FOG_DEPTH, Mist } from "./ui/mist.ts";
import { DamageNumbers } from "./ui/damageNumbers.ts";
import { MuteButton } from "./ui/muteButton.ts";
import { GameAudio } from "./audio/audio.ts";
import { endRun } from "./game/state.ts";
import { clamp } from "./engine/math.ts";
import { loadArrow, loadHero, loadRogue, loadScenery, loadWarrior } from "./three/assets.ts";
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
/** Floating bar width as a fraction of its body's height, so a scale edit resizes the bar too. */
const BAR_WIDTH_OF_HEIGHT = 0.57;

/** World units above the head. */
const BAR_GAP = 0.25;


/** Where a damage number starts, as a fraction of body height. Below the bar. */
const HIT_NUMBER_OF_HEIGHT = 0.75;

async function boot(): Promise<void> {
  // The network decides when the ad may start (MRAID ready etc.).
  await adapter.ready();
  const [hero, rogue, warrior, arrow, scenery] = await Promise.all([
    loadHero(),
    loadRogue(),
    loadWarrior(),
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
  // Inflated by the enemy radius so the field never routes through a gap a body cannot fit.
  const grid = createGrid(obstacles, ENEMY_RADIUS);

  const world = new WorldScene(
    { hero, rogue, warrior, arrow, scenery: { tree, rock, mushroom, pine } },
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
  // The only three damage values in the game.
  const numbers = new DamageNumbers(
    [ARROW_DAMAGE, ENEMY_DAMAGE, ENEMY_ARROW_DAMAGE],
    4,
  );
  // A hit is the frame a flash timer rises.
  const lastEnemyFlash = enemies.map(() => 0);
  let lastPlayerFlash = 0;
  // Unlocked at boot where autoplay policy allows; the first input resumes it otherwise.
  const audio = new GameAudio(enemies.length);
  audio.unlock();
  const mute = new MuteButton((muted) => {
    audio.setMuted(muted);
    // Only on unmute; a click into a closing mute is never heard.
    if (!muted) audio.tap();
  });

  // Haze over the world, under every widget.
  app.stage.addChild(mist);
  app.stage.addChild(hud);
  app.stage.addChild(bars);
  app.stage.addChild(numbers);
  app.stage.addChild(joystick);
  app.stage.addChild(hand);
  // Covers the joystick once the run is over.
  app.stage.addChild(endCard);
  // Muting must stay possible over the card.
  app.stage.addChild(mute);
  app.stage.eventMode = "static";
  app.stage.hitArea = app.screen;
  joystick.listenOn(app.stage);

  let touched = false;
  let tutorialElapsed = 0;
  const noteInput = (): void => {
    touched = true;
    // Synchronously inside the gesture; autoplay policy checks the call stack.
    audio.unlock();
  };
  app.stage.on("pointerdown", noteInput);
  // Not `once`: a lone modifier key grants no user activation, so the next
  // key must get another go.
  window.addEventListener("keydown", noteInput);

  // The haze is re-anchored every frame against the last viewport seen.
  let screenW = 1;
  let screenH = 1;
  document.addEventListener("visibilitychange", () => {
    audio.setViewable(document.visibilityState === "visible");
  });
  // Only the network knows when its ad is off-screen.
  adapter.onViewableChange?.((viewable) => audio.setViewable(viewable));

  onResize((w, h) => {
    screenW = w;
    screenH = h;
    world.resize(w, h);
    // Driven by the shorter side, so rotating moves the joystick but never resizes it.
    const scale = clamp(Math.min(w, h) / 420, 0.85, 1.5);
    joystick.scale.set(scale);
    // Rest position only; the base moves to the thumb on touch. Landscape
    // goes bottom-left, since a centred stick would sit on the arena.
    joystick.place(w > h ? w * 0.18 : w / 2, w > h ? h * 0.72 : h * 0.84, w, h);
    hud.layout(w, h, scale);
    bars.layout(w, h);
    endCard.layout(w, h);
    hand.layout(w, h, joystick.x, joystick.y);
    mute.layout(w, h, scale);
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
      // One solve for every enemy; early-outs unless the player changed cell.
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

    // Views keep syncing after the run ends so the room idles behind the card.
    // The camera is aimed first: bars and haze are placed from its projection.
    world.follows(player.z, dt);
    // project() returns one shared object, so each result is read before the next call.
    const nearEdge = world.project(0, 0, ROOM_DEPTH / 2).y;
    // Two world points, not a screen band: a band stretched to fit a short
    // viewport would reach full white over the player.
    const nearDeep = world.project(0, 0, ROOM_DEPTH / 2 + FOG_DEPTH).y;
    mist.layout(
      screenW,
      screenH,
      nearEdge,
      nearDeep,
      world.project(0, 0, -ROOM_DEPTH / 2 - 4.6).y,
    );
    // Before the views, so a death sting and its clip start on the same frame.
    audio.sync(player, enemies, state);
    hud.update(state.points, progress(state));
    world.syncPlayer(player);
    for (let i = 0; i < enemies.length; i++) {
      const ene = enemies[i];
      world.syncEnemy(i, ene, i === player.target);
    }
    for (let i = 0; i < projectiles.length; i++) {
      world.syncArrow(i, projectiles[i]);
    }
    // Bars live in Pixi and follow bodies in the Three scene via projection.
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
