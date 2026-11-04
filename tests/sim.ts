/**
 * Headless regression test. `src/game/` imports no renderer, so Node runs it
 * directly: `node tests/sim.ts`.
 */
import {
  ARROW_LIFE,
  ARROW_RADIUS,
  ENEMIES_TO_KILL,
  ENEMY_RADIUS,
  ENEMY_SPEED,
  FIRE_RANGE,
  PLAYER_RADIUS,
  ROOM_DEPTH,
  ROOM_WIDTH,
  STEP_LENGTH,
} from "../src/config.ts";
import { clamp } from "../src/engine/math.ts";
import { createRandom } from "../src/engine/random.ts";
import { updateEnemyAttacks, updateShooting } from "../src/game/combat.ts";
import {
  createEnemies,
  separateEnemies,
  updateEnemies,
} from "../src/game/enemy.ts";
import { clearShot } from "../src/game/collision.ts";
import { createObstacles, type Obstacle } from "../src/game/obstacles.ts";
import { createGrid, solveFlow } from "../src/game/pathfind.ts";
import { createPlayer, movePlayer } from "../src/game/player.ts";
import { createProjectiles, updateProjectiles } from "../src/game/projectiles.ts";
import { createSpawner, updateSpawner } from "../src/game/spawner.ts";
import { nearestVisibleEnemy } from "../src/game/targeting.ts";
import { createCueWatcher, readCues } from "../src/audio/cues.ts";
import { readFileSync } from "node:fs";
import { addKills, createState } from "../src/game/state.ts";

const failures: string[] = [];

function check(condition: boolean, message: string): void {
  if (!condition) failures.push(message);
}

/** Closest-point overlap, not an expanded box: a circle's corners are round. */
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

/** Line of sight against the real layout, so a moved crate fails loudly. */
function lineOfSight(): void {
  const obstacles = createObstacles();
  const shot = (
    fromX: number,
    fromZ: number,
    toX: number,
    toZ: number,
  ): boolean =>
    clearShot(fromX, fromZ, toX, toZ, ARROW_RADIUS, obstacles);

  check(!shot(0, 0, 0, -6), "line of sight: row one does not block the centre");
  check(shot(-4, -2.5, 4, -2.5), "line of sight: the lane between rows is blocked");
  check(!shot(-3, 0, -3, -3), "line of sight: row two does not block the left pair");
  check(shot(-4, 4, 4, 4), "line of sight: the open half is blocked");
  check(shot(0, 0, 0, -3), "line of sight: a crate past the target blocks the shot");
}

/** Sound table gains stay under a ceiling. Level is all a machine can judge here. */
function audio(): void {
  const source = readFileSync(new URL("../src/audio/audio.ts", import.meta.url), "utf8");
  const table = source.slice(source.indexOf("const SFX:"), source.indexOf("export class GameAudio"));
  const gains = [...table.matchAll(/gain:\s*(\d*\.?\d+)/g)].map((m) => Number(m[1]));

  check(gains.length > 0, "audio: no gains found in the sound table");
  const loudest = Math.max(...gains);
  check(
    loudest <= 0.25,
    `audio: a sound is at gain ${loudest}, over the 0.25 ceiling for routine events`,
  );
  console.log(`  audio: ${gains.length} gains in the sound table, loudest ${loudest}, no files`);
}

function run(seed: number, moving: boolean, cover = false): void {
  const label = `seed ${seed} ${cover ? "in cover" : moving ? "moving" : "still"}`;
  const obstacles = createObstacles();
  const grid = createGrid(obstacles, ENEMY_RADIUS);
  const enemies = createEnemies();
  const spawner = createSpawner(createRandom(seed));
  const projectiles = createProjectiles();
  const player = createPlayer();
  const state = createState();
  state.stage = "gameplay";

  // Behind the left pair of row two: nobody can shoot until the archers walk
  // round. If either side waited on the other, the run would never end.
  if (cover) {
    player.x = -3.95;
    player.z = 0.2;
  }

  const dt = 1 / 60;
  const seconds = 90;
  let finishedAt = 0;
  let coveredFrames = 0;
  // Sliding: a walking body moving more than 60 degrees off its facing.
  let slideFrames = 0;
  let movedFrames = 0;
  const wasX = enemies.map(() => 0);
  const wasZ = enemies.map(() => 0);
  const streak = enemies.map(() => 0);
  let longestSlide = 0;
  let worstGap = Number.POSITIVE_INFINITY;
  // Cues are a state diff, so they are checkable without a browser.
  const cueWatcher = createCueWatcher(enemies.length);
  let shotCues = 0;
  let enemyShotCues = 0;
  let impactCues = 0;
  let deathCues = 0;
  let hurtCues = 0;
  let stepCues = 0;
  // Path length from positions: the witness for step cues.
  let walked = 0;
  let lastX = player.x;
  let lastZ = player.z;
  // Counted off the pool, independently of the code under test.
  let arrowsFired = 0;
  let hostileFired = 0;

  for (let frame = 1; frame <= seconds * 60; frame++) {
    if (moving && !cover) {
      // Dodge 0.8 s, stand and shoot 1.2 s.
      const cycle = frame % 120;
      const dir = cycle < 24 ? 1 : cycle < 48 ? -1 : 0;
      movePlayer(player, dir, 0, dt, obstacles);
    }

    solveFlow(grid, player.x, player.z);
    updateSpawner(spawner, enemies, dt);
    updateEnemies(enemies, player.x, player.z, dt, obstacles, grid);
    separateEnemies(enemies, obstacles, dt);
    updateEnemyAttacks(enemies, player, projectiles, obstacles, dt);
    updateShooting(player, enemies, projectiles, obstacles, dt);
    // Scan between firing and resolving: a point-blank arrow is spent inside
    // updateProjectiles the same frame. A fresh arrow still has full life.
    for (let i = 0; i < projectiles.length; i++) {
      const arrow = projectiles[i];
      if (arrow.alive && arrow.life === ARROW_LIFE) {
        if (arrow.hostile) hostileFired++;
        else arrowsFired++;
      }
    }
    addKills(state, updateProjectiles(projectiles, enemies, player, obstacles, dt));

    if (state.stage === "end" && finishedAt === 0) finishedAt = frame / 60;

    if (state.stage === "gameplay") walked += Math.hypot(player.x - lastX, player.z - lastZ);
    lastX = player.x;
    lastZ = player.z;
    const cues = readCues(cueWatcher, player, enemies, state);
    if (cues.shot) shotCues++;
    stepCues += cues.steps;
    enemyShotCues += cues.enemyShots;
    impactCues += cues.impacts;
    deathCues += cues.deaths;
    if (cues.hurt) hurtCues++;

    // Frames with an enemy in range but none visible. Reported, not asserted.
    const anyInRange = enemies.some(
      (e) =>
        e.alive &&
        e.dying === 0 &&
        Math.hypot(e.x - player.x, e.z - player.z) <= FIRE_RANGE,
    );
    const visible = nearestVisibleEnemy(
      enemies,
      player.x,
      player.z,
      FIRE_RANGE,
      obstacles,
    );
    if (anyInRange && visible === null) coveredFrames++;

    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i];
      const moveX = e.x - wasX[i];
      const moveZ = e.z - wasZ[i];
      wasX[i] = e.x;
      wasZ[i] = e.z;
      if (!e.alive || e.dying > 0 || e.throttle === 0) continue;

      const moved = Math.hypot(moveX, moveZ);
      // Under half a step is a correction settling, not a walk.
      if (moved < 0.5 * ENEMY_SPEED * dt) continue;
      movedFrames++;
      // Facing is atan2(dirX, dirZ), so forward is (sin, cos).
      const forward =
        (Math.sin(e.facing) * moveX + Math.cos(e.facing) * moveZ) / moved;
      if (forward < 0.5) {
        slideFrames++;
        streak[i]++;
        longestSlide = Math.max(longestSlide, streak[i]);
      } else {
        streak[i] = 0;
      }
    }

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

    // Separation converges rather than solving exactly; allow a small residual.
    for (let i = 0; i < enemies.length; i++) {
      const a = enemies[i];
      if (!a.alive || a.dying > 0) continue;
      for (let j = i + 1; j < enemies.length; j++) {
        const b = enemies[j];
        if (!b.alive || b.dying > 0) continue;
        const gap = Math.hypot(b.x - a.x, b.z - a.z);
        worstGap = Math.min(worstGap, gap);
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

  // The level must finish, or the ad never reaches its CTA.
  check(
    state.stage === "end",
    `${label}: level never ended, ${state.kills}/${ENEMIES_TO_KILL} kills in ${seconds}s`,
  );
  check(
    spawner.spawned === ENEMIES_TO_KILL,
    `${label}: spawner sent ${spawner.spawned}, expected ${ENEMIES_TO_KILL}`,
  );

  const outcome =
    state.stage !== "end" ? "UNFINISHED" : state.cleared ? "cleared" : "died";
  console.log(
    `  ${label}: ${outcome} at ${finishedAt.toFixed(1)}s, ` +
      `${state.kills} kills, ${state.points} points, ${player.hp} hp left, ` +
      `${coveredFrames} frames with every target behind cover`,
  );
  console.log(
    `    cues: ${shotCues} shots, ${enemyShotCues} enemy shots, ` +
      `${impactCues} impacts, ${deathCues} deaths, ${hurtCues} hits taken, ` +
      `${stepCues} steps over ${walked.toFixed(1)} units`,
  );
  console.log(
    `    sliding: ${slideFrames} of ${movedFrames} walking frames ` +
      `(${((slideFrames / Math.max(movedFrames, 1)) * 100).toFixed(1)}%), ` +
      `longest run ${longestSlide} frames, ` +
      `closest pair ${worstGap.toFixed(3)} of ${(ENEMY_RADIUS * 2).toFixed(2)}`,
  );

  // A few slide frames are unavoidable push-out corrections; 2% is the ceiling.
  check(
    slideFrames < movedFrames * 0.02,
    `${label}: enemies slid for ${slideFrames} of ${movedFrames} walking frames`,
  );

  // One bow cue per arrow loosed; the pool count is the independent witness.
  check(
    shotCues === arrowsFired,
    `${label}: ${shotCues} shot cues for ${arrowsFired} arrows fired`,
  );
  // One death cue per kill, or a corpse is paying out twice.
  check(
    deathCues === state.kills,
    `${label}: ${deathCues} death cues for ${state.kills} kills`,
  );
  check(shotCues > 0, `${label}: no shot cues at all`);
  // Enemy shots are read off a cooldown refilling, which also happens when an
  // archer loses range, so hold it against the pool.
  check(
    enemyShotCues === hostileFired,
    `${label}: ${enemyShotCues} enemy shot cues for ${hostileFired} enemy arrows`,
  );
  // One step per STEP_LENGTH of ground covered, not of stick input.
  const expectedSteps = Math.floor(walked / STEP_LENGTH);
  check(
    Math.abs(stepCues - expectedSteps) <= 1,
    `${label}: ${stepCues} step cues for ${walked.toFixed(1)} units walked (expected ${expectedSteps})`,
  );
  if (!moving) check(stepCues === 0, `${label}: ${stepCues} steps while standing still`);
  // An arrow can miss but cannot land twice.
  check(
    impactCues <= arrowsFired,
    `${label}: ${impactCues} impacts for ${arrowsFired} arrows`,
  );

  // A watcher created mid-run must open silent, or a late audio unlock
  // fires every accumulated edge at once.
  const fresh = readCues(
    createCueWatcher(enemies.length),
    player,
    enemies,
    state,
  );
  check(
    !fresh.shot &&
      fresh.enemyShots === 0 &&
      fresh.impacts === 0 &&
      fresh.deaths === 0 &&
      !fresh.hurt &&
      fresh.steps === 0 &&
      !fresh.win &&
      !fresh.lose,
    `${label}: a fresh cue watcher fired on its first read`,
  );
}

console.log("simulating...");
audio();
lineOfSight();
run(1, false);
run(1, true);
run(7, true);
run(99, true);
run(3, false, true);

if (failures.length > 0) {
  // First few only: a broken invariant fails on every frame after it breaks.
  console.error(`\n${failures.length} failure(s):`);
  for (const line of failures.slice(0, 5)) console.error(`  ${line}`);
  process.exit(1);
}

console.log("all invariants held");
