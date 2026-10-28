import { Application } from "pixi.js";
import { ENEMY_RADIUS } from "./config.ts";
import { adapter } from "@network";
import { startLoop } from "./engine/loop.ts";
import { onResize } from "./engine/resize.ts";
import { device } from "./engine/device.ts";
import { WorldScene } from "./three/world.ts";
import { createPlayer, movePlayer } from "./game/player.ts";
import { keyboardDirection } from "./input/keyboard.ts";
import { Joystick } from "./ui/joystick.ts";
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
async function boot(): Promise<void> {
  // The network decides when the ad may start (MRAID ready etc.).
  await adapter.ready();
  const [archer, enemy] = await Promise.all([loadArcher(), loadEnemy()]);
  const enemies = createEnemies();
  const spawner = createSpawner();
  const projectiles = createProjectiles();

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

  app.stage.addChild(joystick);
  app.stage.eventMode = "static";
  app.stage.hitArea = app.screen;
  joystick.listenOn(app.stage);

  onResize((w, h) => {
    world.resize(w, h);
    // Thumb-sized on a phone, not absurd on a desktop. Based on the shorter
    // side, so rotating changes where the joystick is, never how big.
    const scale = clamp(Math.min(w, h) / 800, 0.6, 1.2);
    joystick.scale.set(scale);
    joystick.x = w / 2;
    joystick.y = h - 110 * scale; // 110 is the distance from the bottom of the screen to the center of the joystick, in pixels
    // TODO: re-position UI elements
  });

  startLoop(app, (dt) => {
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
    updateProjectiles(projectiles, enemies, obstacles, dt);
    world.syncPlayer(player.x, player.z, player.facing, player.throttle);
    for (let i = 0; i < enemies.length; i++) {
      const ene = enemies[i];
      world.syncEnemy(i, ene);
    }
    for (let i = 0; i < projectiles.length; i++) {
      world.syncArrow(i, projectiles[i]);
    }
    world.update(dt);
    world.render();
  });
}

void boot();
