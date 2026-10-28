/**
 * Headless regression test. `src/game/` imports no renderer, so Node runs it
 * directly — hundreds of frames in milliseconds, no browser, no bundler.
 *
 *   node tests/sim.ts
 *
 * This exists because of a real bug: in 5.6 both bodies in a separation pair
 * were pushed the same way, so pairs translated instead of separating and
 * drifted 6.8 units/second out of a 10-unit room. It type-checked, it ran, and
 * it was invisible until enemies started leaving the screen. The assertions
 * below would have caught it in one second.
 */
import {
  ENEMIES_TO_KILL,
  ENEMY_RADIUS,
  PLAYER_RADIUS,
  ROOM_DEPTH,
  ROOM_WIDTH,
} from "../src/config.ts";
import { clamp } from "../src/engine/math.ts";
import { createRandom } from "../src/engine/random.ts";
import { updateEnemyAttacks, updateShooting } from "../src/game/combat.ts";
import { createEnemies, separateEnemies, updateEnemies } from "../src/game/enemy.ts";
import { createObstacles, type Obstacle } from "../src/game/obstacles.ts";
import { createGrid, solveFlow } from "../src/game/pathfind.ts";
import { createPlayer, movePlayer } from "../src/game/player.ts";
import { createProjectiles, updateProjectiles } from "../src/game/projectiles.ts";
import { createSpawner, updateSpawner } from "../src/game/spawner.ts";
import { addKills, createState } from "../src/game/state.ts";

const failures: string[] = [];

function check(condition: boolean, message: string): void {
  if (!condition) failures.push(message);
}

/** True overlap against a box: the closest point, not an expanded-box test —
 *  a circle's corners are round. */
function insideObstacle(
  x: number,
  z: number,
  radius: number,
  obstacles: Obstacle[],
): boolean {
  return obstacles.some((box) => {
    const cx = clamp(x, box.x - box.halfX, box.x + box.halfX);
    const cz = clamp(z, box.z - box.halfZ, box.z + box.halfZ);
    return Math.hypot(x - cx, z - cz) < radius - 1e-6;
  });
}

function run(seed: number, moving: boolean): void {
  const label = `seed ${seed} ${moving ? "moving" : "still"}`;
  const obstacles = createObstacles();
  const grid = createGrid(obstacles, ENEMY_RADIUS);
  const enemies = createEnemies();
  const spawner = createSpawner(createRandom(seed));
  const projectiles = createProjectiles();
  const player = createPlayer();
  const state = createState();
  state.stage = "gameplay";

  const dt = 1 / 60;
  const seconds = 90;
  let finishedAt = 0;

  for (let frame = 1; frame <= seconds * 60; frame++) {
    if (moving) {
      // Dodge for 0.8s, stand and shoot for 1.2s. A player who never stops
      // never fires — that is the Archero rule the whole game turns on.
      const cycle = frame % 120;
      const dir = cycle < 24 ? 1 : cycle < 48 ? -1 : 0;
      movePlayer(player, dir, 0, dt, obstacles);
    }

    solveFlow(grid, player.x, player.z);
    updateSpawner(spawner, enemies, dt);
    updateEnemies(enemies, player.x, player.z, dt, obstacles, grid);
    separateEnemies(enemies);
    updateEnemyAttacks(enemies, player, projectiles, dt);
    updateShooting(player, enemies, projectiles, dt);
    addKills(state, updateProjectiles(projectiles, enemies, player, obstacles, dt));

    if (state.stage === "end" && finishedAt === 0) finishedAt = frame / 60;

    // --- invariants, every frame ---
    const limitX = ROOM_WIDTH / 2;
    const limitZ = ROOM_DEPTH / 2;

    check(
      Number.isFinite(player.x) && Number.isFinite(player.z),
      `${label}: player position went NaN at frame ${frame}`,
    );
    check(
      Math.abs(player.x) <= limitX && Math.abs(player.z) <= limitZ,
      `${label}: player left the room at frame ${frame}`,
    );
    check(
      !insideObstacle(player.x, player.z, PLAYER_RADIUS, obstacles),
      `${label}: player inside an obstacle at frame ${frame}`,
    );

    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i];
      if (!e.alive) continue;
      check(
        Number.isFinite(e.x) && Number.isFinite(e.z),
        `${label}: enemy ${i} position went NaN at frame ${frame}`,
      );
      check(
        Math.abs(e.x) <= limitX && Math.abs(e.z) <= limitZ,
        `${label}: enemy ${i} left the room at frame ${frame} ` +
          `(${e.x.toFixed(2)}, ${e.z.toFixed(2)})`,
      );
      check(
        e.hp >= 0,
        `${label}: enemy ${i} has negative health at frame ${frame}`,
      );
    }

    // Separation converges rather than solving exactly, so allow the residual
    // it actually settles at (measured at 3%) and fail on anything worse.
    for (let i = 0; i < enemies.length; i++) {
      const a = enemies[i];
      if (!a.alive || a.dying > 0) continue;
      for (let j = i + 1; j < enemies.length; j++) {
        const b = enemies[j];
        if (!b.alive || b.dying > 0) continue;
        const gap = Math.hypot(b.x - a.x, b.z - a.z);
        check(
          gap > ENEMY_RADIUS * 2 * 0.9,
          `${label}: enemies ${i} and ${j} overlapping by too much at ` +
            `frame ${frame} (gap ${gap.toFixed(3)})`,
        );
      }
    }

    const live = projectiles.filter((p) => p.alive).length;
    check(
      live <= projectiles.length,
      `${label}: projectile pool overflowed at frame ${frame}`,
    );
  }

  // The level has to be finishable, or the ad never reaches its CTA.
  check(
    state.stage === "end",
    `${label}: level never ended — ${state.kills}/${ENEMIES_TO_KILL} kills in ${seconds}s`,
  );
  check(
    spawner.spawned === ENEMIES_TO_KILL,
    `${label}: spawner sent ${spawner.spawned}, expected ${ENEMIES_TO_KILL}`,
  );

  const outcome =
    state.stage !== "end" ? "UNFINISHED" : state.cleared ? "cleared" : "died";
  console.log(
    `  ${label}: ${outcome} at ${finishedAt.toFixed(1)}s, ` +
      `${state.kills} kills, ${state.points} points, ${player.hp} hp left`,
  );
}

console.log("simulating...");
run(1, false);
run(1, true);
run(7, true);
run(99, true);

if (failures.length > 0) {
  // Only the first few: a broken invariant fails on every frame after it
  // breaks, and 5000 identical lines help nobody.
  console.error(`\n${failures.length} failure(s):`);
  for (const line of failures.slice(0, 5)) console.error(`  ${line}`);
  process.exit(1);
}

console.log("all invariants held");
