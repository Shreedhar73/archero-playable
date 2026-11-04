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
  ARROW_RADIUS,
  ENEMIES_TO_KILL,
  ENEMY_RADIUS,
  ENEMY_SPEED,
  FIRE_RANGE,
  PLAYER_RADIUS,
  ROOM_DEPTH,
  ROOM_WIDTH,
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
import { STEP_LENGTH, createCueWatcher, readCues } from "../src/audio/cues.ts";
import { readFileSync } from "node:fs";
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

/**
 * Line of sight, against the real crate layout rather than a fixture: these
 * are the cases the shooting rule turns on, and a crate moved in
 * `createObstacles` should break them loudly rather than quietly change who
 * can shoot whom.
 */
function lineOfSight(): void {
  const obstacles = createObstacles();
  const shot = (
    fromX: number,
    fromZ: number,
    toX: number,
    toZ: number,
  ): boolean =>
    clearShot(fromX, fromZ, toX, toZ, ARROW_RADIUS, obstacles);

  // Straight up the middle, through row one (x +-2.02 at z -4.26..-3.32).
  check(!shot(0, 0, 0, -6), "line of sight: row one does not block the centre");
  // The gap between the two rows runs clear across the room.
  check(shot(-4, -2.5, 4, -2.5), "line of sight: the lane between rows is blocked");
  // Through the left pair of row two (x -5.00..-2.90, z -1.61..-0.57).
  check(!shot(-3, 0, -3, -3), "line of sight: row two does not block the left pair");
  // Open bottom half: the player's own space has nothing in it.
  check(shot(-4, 4, 4, 4), "line of sight: the open half is blocked");
  // A crate behind the target blocks nothing: the segment stops at the target.
  check(shot(0, 0, 0, -3), "line of sight: a crate past the target blocks the shot");
}

/**
 * The audio module, checked for the thing that goes wrong silently.
 *
 * There are no files to weigh any more — every sound is built from two
 * oscillator-and-filter primitives at runtime — so what is worth asserting is
 * that the primitives still import outside a browser and that nothing in the
 * sound table has crept back up to the level the last two versions were
 * rejected for. A gain is the one property of a sound a machine here can
 * judge; what it sounds like is the user's ears, and pretending otherwise
 * would be worse than saying so.
 */
function audio(): void {
  const source = readFileSync(new URL("../src/audio/audio.ts", import.meta.url), "utf8");
  const table = source.slice(source.indexOf("const SFX:"), source.indexOf("export class GameAudio"));
  const gains = [...table.matchAll(/gain:\s*(\d*\.?\d+)/g)].map((m) => Number(m[1]));

  check(gains.length > 0, "audio: no gains found in the sound table — did it move?");
  // The AR creative's routine envelope, which is the whole reason these
  // numbers are these numbers. Its one louder sound is for a reveal; nothing
  // in this ad earns that, so 0.25 is the ceiling here.
  const loudest = Math.max(...gains);
  check(
    loudest <= 0.25,
    `audio: a sound is at gain ${loudest}, over the 0.25 the reference creative ` +
      `keeps for routine events — the last two versions were rejected for being loud`,
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

  // Parked directly behind the left pair of row two, which is the shape the
  // line-of-sight rule exists for: the player can see nothing, and the enemy
  // archers have to come round the crate instead of firing into it. If either
  // side were to stand still waiting for the other, this run would never end.
  if (cover) {
    player.x = -3.95;
    player.z = 0.2;
  }

  const dt = 1 / 60;
  const seconds = 90;
  let finishedAt = 0;
  let coveredFrames = 0;
  // Sliding is movement the body is not facing: the collision push-out
  // translating an enemy sideways while its run clip points somewhere else.
  // Counted rather than eyeballed, because it is invisible in a still.
  let slideFrames = 0;
  let movedFrames = 0;
  const wasX = enemies.map(() => 0);
  const wasZ = enemies.map(() => 0);
  // A single frame of being shoved is invisible; a second of it is the bug.
  const streak = enemies.map(() => 0);
  let longestSlide = 0;
  let worstGap = Number.POSITIVE_INFINITY;
  // Sound is driven by diffing state, not by events, so the cues are
  // checkable here even though nothing in Node can play them.
  const cueWatcher = createCueWatcher(enemies.length);
  let shotCues = 0;
  let enemyShotCues = 0;
  let impactCues = 0;
  let deathCues = 0;
  let hurtCues = 0;
  let stepCues = 0;
  // The player's own path length, from positions — the witness for steps.
  let walked = 0;
  let lastX = player.x;
  let lastZ = player.z;
  // Counted independently, by watching the pool fill rather than by
  // asking the thing under test.
  let arrowsFired = 0;
  let hostileFired = 0;
  const arrowWas = projectiles.map(() => false);

  for (let frame = 1; frame <= seconds * 60; frame++) {
    if (moving && !cover) {
      // Dodge for 0.8s, stand and shoot for 1.2s. A player who never stops
      // never fires — that is the Archero rule the whole game turns on.
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
    // Between firing and resolving on purpose: an arrow loosed at point blank
    // is spent inside updateProjectiles in the same frame, so a pool scanned
    // afterwards never sees it and the witness undercounts by one.
    for (let i = 0; i < projectiles.length; i++) {
      const arrow = projectiles[i];
      if (arrow.alive && !arrowWas[i]) {
        if (arrow.hostile) hostileFired++;
        else arrowsFired++;
      }
      arrowWas[i] = arrow.alive;
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

    // Frames where someone was in range but none of them could be shot at.
    // Reported rather than asserted: it is the feature working, and a run
    // that never reaches it has not tested anything.
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
      // Anything under half a step is a correction settling, not a walk.
      if (moved < 0.5 * ENEMY_SPEED * dt) continue;
      movedFrames++;
      // Facing is an angle about +Y with 0 along +Z, so forward is
      // (sin, cos) — the same convention `Math.atan2(dirX, dirZ)` writes.
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

    // Separation converges rather than solving exactly, so allow the residual
    // it actually settles at (measured at 3%) and fail on anything worse.
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

  // An enemy walking one way while facing another is the bug the user saw.
  // A few are unavoidable — the push-out has to move somebody out of a crate
  // eventually — but it is a correction, not a gait.
  check(
    slideFrames < movedFrames * 0.02,
    `${label}: enemies slid for ${slideFrames} of ${movedFrames} walking frames`,
  );

  // One bow sound per arrow the player actually loosed. The pool count is the
  // independent witness: if `player.shooting` ever stopped rising on a shot,
  // the archer's draw animation would break in the same silent way.
  check(
    shotCues === arrowsFired,
    `${label}: ${shotCues} shot cues for ${arrowsFired} arrows fired`,
  );
  // Exactly one death sound per kill. `damageEnemy` reports a kill once, and
  // the dying edge has to agree with it or a corpse is paying out twice.
  check(
    deathCues === state.kills,
    `${label}: ${deathCues} death cues for ${state.kills} kills`,
  );
  check(shotCues > 0, `${label}: no shot cues at all`);
  // The enemy side has no `shooting` timer to rise, so its cue is read off a
  // cooldown climbing back up. Held against the pool, because the same climb
  // happens when an archer loses range and the counter is refilled.
  check(
    enemyShotCues === hostileFired,
    `${label}: ${enemyShotCues} enemy shot cues for ${hostileFired} enemy arrows`,
  );
  // One footstep per STEP_LENGTH of ground actually covered, read off the
  // same positions this harness walks the player through. Not off the stick:
  // the still runs hold it at zero and must hear nothing, and a moving run
  // pushed into a wall covers less ground than it asks for.
  const expectedSteps = Math.floor(walked / STEP_LENGTH);
  check(
    Math.abs(stepCues - expectedSteps) <= 1,
    `${label}: ${stepCues} step cues for ${walked.toFixed(1)} units walked (expected ${expectedSteps})`,
  );
  if (!moving) check(stepCues === 0, `${label}: ${stepCues} steps while standing still`);
  // An arrow can miss: into a crate, or out of life. It cannot land twice.
  check(
    impactCues <= arrowsFired,
    `${label}: ${impactCues} impacts for ${arrowsFired} arrows`,
  );

  // A watcher created mid-run must open silent. Unlocking audio on a late tap
  // would otherwise fire every edge the run has accumulated at once.
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
  // Only the first few: a broken invariant fails on every frame after it
  // breaks, and 5000 identical lines help nobody.
  console.error(`\n${failures.length} failure(s):`);
  for (const line of failures.slice(0, 5)) console.error(`  ${line}`);
  process.exit(1);
}

console.log("all invariants held");
