import { Application } from "pixi.js";
import { ENEMY_RADIUS, ENEMY_HP, PLAYER_HP, TUTORIAL_TIMEOUT } from "./config.ts";
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
import { endRun } from "./game/state.ts";
import { clamp } from "./engine/math.ts";
import { loadArcher, loadEnemy } from "./three/assets.ts";
import { createEnemies, separateEnemies, updateEnemies } from "./game/enemy.ts";
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
 * How high above the floor a health bar is projected from.
 *
 * Far above the heads (1.83 for the archer, 1.53 for a scaled robot) because
 * the camera looks down at 68 degrees: a world-space Y offset only moves
 * cos(68) = 0.37 of itself up the screen, so clearing a head by a visible gap
 * costs about three times that gap in world units.
 */
const BAR_HEIGHT_PLAYER = 3.4;
const BAR_HEIGHT_ENEMY = 3.1;

async function boot(): Promise<void> {
  // The network decides when the ad may start (MRAID ready etc.).
  await adapter.ready();
  const [archer, enemy] = await Promise.all([loadArcher(), loadEnemy()]);
  const enemies = createEnemies();
  const spawner = createSpawner();
  const projectiles = createProjectiles();
  const state = createState();

  const player = createPlayer();
  const obstacles = createObstacles();
  // Planned with the enemy's radius baked in, so the field never routes
  // anything through a gap it cannot fit through.
  const grid = createGrid(obstacles, ENEMY_RADIUS);

  const world = new WorldScene(archer, enemy, obstacles);

  const app = new Application();
  await app.init({ resizeTo: device, backgroundAlpha: 0, antialias: true });
  app.canvas.id = "ui";
  device.appendChild(app.canvas);

  const joystick = new Joystick();
  const hud = new Hud();
  // One per enemy, plus the player's at index 0.
  const bars = new HealthBars(enemies.length + 1);
  const endCard = new EndCard();
  const hand = new TutorialHand();

  app.stage.addChild(hud);
  app.stage.addChild(bars);
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

  onResize((w, h) => {
    world.resize(w, h);
    // Thumb-sized on a phone, not absurd on a desktop. Based on the shorter
    // side, so rotating changes where the joystick is, never how big.
    // Ring is 70 units wide, and reference.jpg puts it at ~19% of screen
    // width. Driven by the shorter side so rotating moves it, never resizes it.
    const scale = clamp(Math.min(w, h) / 420, 0.85, 1.5);
    joystick.scale.set(scale);
    // Portrait: thumb-centre, below the room. Landscape: bottom-left, because
    // a centred stick there lands in the middle of the arena, on the archer.
    joystick.x = w > h ? w * 0.18 : w / 2;
    // A fraction, not a pixel offset: this holds its place across aspect
    // ratios, and puts the stick over the play area rather than below it.
    joystick.y = w > h ? h * 0.72 : h * 0.84;
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
      separateEnemies(enemies);
      updateEnemyAttacks(enemies, player, dt);
      updateShooting(player, enemies, projectiles, dt);
      addKills(state, updateProjectiles(projectiles, enemies, obstacles, dt));
      if (player.hp <= 0) endRun(state);
    } else if (!endCard.visible) {
      endCard.show(state.points, state.cleared);
    }

    // Views keep syncing and mixers keep advancing after the run ends, so the
    // room idles behind the card instead of freezing mid-stride.
    hud.update(state.points, progress(state));
    world.syncPlayer(player.x, player.z, player.facing, player.throttle);
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
    const head = world.project(player.x, BAR_HEIGHT_PLAYER, player.z);
    bars.set(0, head.x, head.y, player.hp / PLAYER_HP, head.onScreen);
    for (let i = 0; i < enemies.length; i++) {
      const enemy = enemies[i];
      const over = world.project(enemy.x, BAR_HEIGHT_ENEMY, enemy.z);
      const standing = enemy.alive && enemy.dying === 0;
      bars.set(
        i + 1,
        over.x,
        over.y,
        enemy.hp / ENEMY_HP,
        standing && over.onScreen,
      );
    }

    world.update(dt);
    world.render();
  });
}

void boot();
