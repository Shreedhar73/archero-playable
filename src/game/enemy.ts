import {
  ARROW_RADIUS,
  ARROW_SPAWN_OFFSET,
  ENEMY_COUNT,
  ENEMY_DEATH_TIME,
  ENEMY_RADIUS,
  ENEMY_BACKPEDAL,
  ENEMY_KITE_BAND,
  ENEMY_SHOOT_RANGE,
  ENEMY_SPEED,
  PLAYER_RADIUS,
} from "../config.ts";
import { clamp } from "../engine/math.ts";
import { clampToRoom } from "./room.ts";

/** Long enough to see at 60fps, short enough not to linger. */
const HIT_FLASH_TIME = 0.12;
import { clearShot, pushOutOfObstacles } from "./collision.ts";
import type { Obstacle } from "./obstacles.ts";
import { flowAt, type Grid } from "./pathfind.ts";

/**
 * One enemy. Exists for the whole session; `alive` decides if it is simulated.
 *
 * Dying is a third state, not a flag: a corpse must stay visible long enough
 * to play its Death clip while taking no part in the simulation. `dying`
 * counts that down, and the slot is only handed back when it reaches zero.
 */
/** Melee closes to touching range; archer stops short and shoots. */
export type EnemyKind = "melee" | "archer";

export interface Enemy {
  kind: EnemyKind;
  x: number;
  z: number;
  facing: number;
  throttle: number;
  alive: boolean;
  hp: number;
  /** Seconds of Death clip left. 0 means not dying. */
  dying: number;
  /** Seconds until the next melee swing lands. */
  attackCooldown: number;
  /** Drives the Punch clip. Set by combat, read by the renderer. */
  attacking: boolean;

  /** Seconds of hit flash left. Feedback only — nothing reads it but the
   *  renderer, and a hit with no feedback reads as a miss. */
  hitFlash: number;

  /** The way the body is actually travelling, as a unit vector. Steered
   *  towards what the flow field wants at a bounded rate rather than set to
   *  it: an eight-direction field changes by 45 degrees the moment a body
   *  crosses a cell boundary, and a body that can change direction instantly
   *  slides rather than runs. */
  headingX: number;
  headingZ: number;
}

/** FIxed-size pool, build once at boot. Nothing is created or destroyed during play
 * Spwans sets `alive : true`, dying sets `alive : false`;
 */
export function createEnemies(): Enemy[] {
  const enemies: Enemy[] = [];
  for (let i = 0; i < ENEMY_COUNT; i++) {
    enemies.push({
      kind: "melee",
      x: 0,
      z: 0,
      facing: 0,
      throttle: 0,
      alive: false,
      hp: 0,
      dying: 0,
      attackCooldown: 0,
      attacking: false,
      hitFlash: 0,
      headingX: 0,
      headingZ: 1,
    });
  }
  return enemies;
}

/**
 * One step of enemy movement, in the order a body would take it.
 *
 * The flow field says which way the room wants it to go; crates and
 * neighbours add directions it wants to avoid; the sum is what it would like
 * to be doing. It does not get to do that instantly — the heading turns
 * towards it at TURN_RATE, speed drops when the body is pressed from in front
 * or still swinging round, and only then does it travel.
 *
 * The position fixes come last and stay small on purpose. Correcting a body
 * after it has moved is what made these slide: travel it never turned
 * towards reads as a body on ice, however good the run clip is.
 */
export function updateEnemies(
  enemies: Enemy[],
  targetX: number,
  targetZ: number,
  dt: number,
  obstacles: Obstacle[],
  grid: Grid,
): void {
  const contact = ENEMY_RADIUS + PLAYER_RADIUS;
  for (let i = 0; i < enemies.length; i++) {
    const enemy = enemies[i];
    if (!enemy.alive) continue;

    if (enemy.hitFlash > 0) enemy.hitFlash -= dt;

    if (enemy.dying > 0) {
      // Corpses do not move, do not push and do not block: they are only
      // still here so the Death clip can finish.
      enemy.dying -= dt;
      enemy.throttle = 0;
      enemy.attacking = false;
      if (enemy.dying <= 0) enemy.alive = false;
      continue;
    }

    const dx = targetX - enemy.x;
    const dz = targetZ - enemy.z;
    const distance = Math.hypot(dx, dz);
    const toPlayerX = distance > 0 ? dx / distance : 0;
    const toPlayerZ = distance > 0 ? dz / distance : 1;

    // The kinds differ only in the distance they want to be at. Melee pushes
    // until it is touching. An archer holds a band around its firing range,
    // advancing when the player is beyond it and backing off when the player
    // closes inside it.
    const want = enemy.kind === "archer" ? ENEMY_SHOOT_RANGE : contact;
    // An archer with a crate in the line has nothing to stand still for: it
    // would hold position at its firing range and hold its shot there for
    // ever. Treating it as out of position sends it back to the flow field,
    // which is the thing that knows the way round the crate — the same
    // muzzle origin as `updateEnemyAttacks`, so the two cannot disagree and
    // leave it frozen between them.
    const blocked =
      enemy.kind === "archer" &&
      !clearShot(
        enemy.x + toPlayerX * ARROW_SPAWN_OFFSET,
        enemy.z + toPlayerZ * ARROW_SPAWN_OFFSET,
        targetX,
        targetZ,
        ARROW_RADIUS,
        obstacles,
      );
    const crowded =
      enemy.kind === "archer" &&
      !blocked &&
      distance < want * ENEMY_KITE_BAND;

    if (!blocked && !crowded && distance <= want) {
      enemy.throttle = 0;
      continue;
    }

    let dirX: number;
    let dirZ: number;
    let speed = ENEMY_SPEED;

    if (crowded) {
      // Straight away from the player, not a reversed flow field: the field
      // points downhill toward the player, and negating it gives a direction
      // rather than a route. Backing into a wall is survivable because the
      // push-out and the room clamp still run below.
      dirX = -toPlayerX;
      dirZ = -toPlayerZ;
      speed *= ENEMY_BACKPEDAL;
    } else {
      // The field knows the room's shape; the straight line does not. Fall
      // back to the straight line only where the flood never arrived: the
      // player's own cell, and anywhere sealed off from it.
      const flow = flowAt(grid, enemy.x, enemy.z);
      dirX = flow.known ? flow.x : toPlayerX;
      dirZ = flow.known ? flow.z : toPlayerZ;
    }

    // Crates and neighbours are steered around, not corrected for. Both used
    // to be positional: walk into something, get pushed out of it next. A
    // body displaced by a push it never turned towards is exactly what
    // sliding is, so both now enter as a direction the body wants to go, and
    // the body turns towards the sum at its own turn rate.
    avoidObstacles(enemy, obstacles);
    dirX += avoidX * AVOID_WEIGHT;
    dirZ += avoidZ * AVOID_WEIGHT;
    avoidCrowd(enemy, enemies);
    dirX += avoidX * CROWD_WEIGHT;
    dirZ += avoidZ * CROWD_WEIGHT;
    // Pressed from in front, a body yields rather than shoves. Steering alone
    // cannot stop a queue converging on one point — somebody has to give way,
    // and a body that slows is a body that does not have to be pushed back
    // out afterwards.
    const press = Math.hypot(avoidX, avoidZ);
    const yield_ = press > 0 ? Math.max(0.35, 1 - press * 0.5) : 1;

    const wanted = Math.hypot(dirX, dirZ);
    if (wanted > 0) {
      dirX /= wanted;
      dirZ /= wanted;
    }

    // Steer, do not snap. `dirX/dirZ` is where the field says to go; the
    // heading is where the body is actually going, and it turns towards the
    // one at a bounded rate. Snapping is what produced the slide: the field
    // is quantised to eight directions, so crossing a cell boundary swung the
    // step 45 degrees in a single frame and the body translated sideways.
    steer(enemy, dirX, dirZ, dt);
    enemy.facing = Math.atan2(enemy.headingX, enemy.headingZ);
    enemy.throttle = 1;

    // A body that has to turn right around turns before it travels. Running
    // at full speed through a half-circle of turn is a body moving one way
    // while pointing another for a third of a second, which is the slide seen
    // when an archer breaks off to reposition.
    const align = Math.max(0, enemy.headingX * dirX + enemy.headingZ * dirZ);
    const gait = 0.15 + 0.85 * align;

    enemy.x += enemy.headingX * speed * yield_ * gait * dt;
    enemy.z += enemy.headingZ * speed * yield_ * gait * dt;
    pushOutOfObstacles(enemy, ENEMY_RADIUS, obstacles);
    clampToRoom(enemy, ENEMY_RADIUS);
  }
}

/** How far from a crate a body starts steering away from it, and how hard
 *  that pull counts against the direction the field wants. Half a body is
 *  enough warning at this speed; more and bodies refuse to use the narrow
 *  lanes the layout is built around. */
const AVOID_MARGIN = ENEMY_RADIUS * 0.5;
const AVOID_WEIGHT = 1.1;

/** The same, for neighbours. Weaker than the crate pull: bodies should bunch
 *  up around the player, just not occupy each other. */
const CROWD_MARGIN = ENEMY_RADIUS * 0.6;
const CROWD_WEIGHT = 1.0;

/** Written by `avoidObstacles` instead of returned, so the hot path
 *  allocates nothing. */
let avoidX = 0;
let avoidZ = 0;

/**
 * Sums a push away from every crate the body is nearly touching. Same
 * closest-point test as the collision push-out, but acting early and softly:
 * this is a nudge off the line, not a correction.
 */
function avoidObstacles(enemy: Enemy, obstacles: Obstacle[]): void {
  const reach = ENEMY_RADIUS + AVOID_MARGIN;
  avoidX = 0;
  avoidZ = 0;

  for (let i = 0; i < obstacles.length; i++) {
    const box = obstacles[i];
    const closestX = clamp(enemy.x, box.x - box.halfX, box.x + box.halfX);
    const closestZ = clamp(enemy.z, box.z - box.halfZ, box.z + box.halfZ);
    const dx = enemy.x - closestX;
    const dz = enemy.z - closestZ;
    const distance = Math.hypot(dx, dz);
    if (distance >= reach) continue;

    // Strongest right at the surface, nothing at the margin's edge.
    // Hyperbolic, not linear: a body a whisker away from another has to turn
    // harder than one a body-width off, or the crowd closes to overlapping
    // and the positional fix below has to do the work — which is the thing
    // that slides. Capped so a near-contact pair cannot steer into a spin.
    const strength = Math.min(3, reach / Math.max(distance, 1e-4) - 1);
    if (distance > 0) {
      avoidX += (dx / distance) * strength;
      avoidZ += (dz / distance) * strength;
    }
  }
}

/**
 * The same thing for neighbours: a body about to walk into another one turns
 * off the line early instead of being shoved off it late. Crowding is a
 * steering input here and only a position fix of last resort in
 * `separateEnemies`.
 */
function avoidCrowd(enemy: Enemy, enemies: Enemy[]): void {
  const reach = ENEMY_RADIUS * 2 + CROWD_MARGIN;
  avoidX = 0;
  avoidZ = 0;

  for (let i = 0; i < enemies.length; i++) {
    const other = enemies[i];
    if (other === enemy || !other.alive || other.dying > 0) continue;

    const dx = enemy.x - other.x;
    const dz = enemy.z - other.z;
    const distance = Math.hypot(dx, dz);
    if (distance >= reach) continue;

    // Hyperbolic, not linear: a body a whisker away from another has to turn
    // harder than one a body-width off, or the crowd closes to overlapping
    // and the positional fix below has to do the work — which is the thing
    // that slides. Capped so a near-contact pair cannot steer into a spin.
    const strength = Math.min(3, reach / Math.max(distance, 1e-4) - 1);
    if (distance > 0) {
      avoidX += (dx / distance) * strength;
      avoidZ += (dz / distance) * strength;
    }
  }
}

/** Separation accumulators, one slot per pool slot. Module level because
 *  this runs every frame and allocating two arrays per frame is a garbage
 *  collection pause waiting to happen. */
const pushX = new Float32Array(ENEMY_COUNT);
const pushZ = new Float32Array(ENEMY_COUNT);

/** Radians per second a body may turn. 9 rad/s turns one right around in a
 *  third of a second: reactive enough to chase, slow enough that the path
 *  round a crate is a curve a runner could have run. */
const TURN_RATE = 9;

/** Turns a body's heading towards a wanted direction, by at most one frame's
 *  worth of turn. The wrap keeps it taking the short way round: without it a
 *  body crossing the -pi/+pi seam turns the long way, right through the
 *  front. */
function steer(enemy: Enemy, wantX: number, wantZ: number, dt: number): void {
  const want = Math.atan2(wantX, wantZ);
  const have = Math.atan2(enemy.headingX, enemy.headingZ);

  let delta = want - have;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;

  const step = TURN_RATE * dt;
  const turned =
    have + (Math.abs(delta) <= step ? delta : Math.sign(delta) * step);
  enemy.headingX = Math.sin(turned);
  enemy.headingZ = Math.cos(turned);
}

/**
 * Applies damage, and reports whether this hit was the killing one so the
 * caller can score it. Returns false on a later hit against the same corpse,
 * which is what stops one enemy paying out twice.
 */
export function damageEnemy(enemy: Enemy, amount: number): boolean {
  if (!enemy.alive || enemy.dying > 0) return false;
  enemy.hitFlash = HIT_FLASH_TIME;
  enemy.hp -= amount;
  if (enemy.hp > 0) return false;
  enemy.hp = 0;
  enemy.dying = ENEMY_DEATH_TIME;
  return true;
}

/** Separate overlapping enemies */

export function separateEnemies(
  enemies: Enemy[],
  obstacles: Obstacle[],
  dt: number,
): void {
  // Last resort only. Steering in `updateEnemies` is what keeps bodies apart;
  // this exists for the overlaps steering cannot prevent — a spawn on top of
  // somebody, or a crowd pinned against a wall — and it is capped hard,
  // because a body displaced further than it can walk is a body sliding.
  // Shoves are summed before being applied: three neighbours resolving
  // against one body in turn would move it three times in a frame.
  const limit = ENEMY_SPEED * dt;

  for (let i = 0; i < enemies.length; i++) {
    pushX[i] = 0;
    pushZ[i] = 0;
  }

  for (let i = 0; i < enemies.length; i++) {
    const a = enemies[i];
    if (!a.alive || a.dying > 0) continue;
    for (let j = i + 1; j < enemies.length; j++) {
      const b = enemies[j];
      if (!b.alive || b.dying > 0) continue;

      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const distance = Math.hypot(dx, dz);
      const overlap = ENEMY_RADIUS * 2 - distance;
      if (overlap <= 0) continue;

      // Two enemies at the exact same point have no direction between them;
      // any axis will do, as long as it is not zero for both of them.
      const nx = distance > 0 ? dx / distance : 1;
      const nz = distance > 0 ? dz / distance : 0;
      const share = overlap / 2;

      pushX[i] -= nx * share;
      pushZ[i] -= nz * share;
      pushX[j] += nx * share;
      pushZ[j] += nz * share;
    }
  }

  for (let i = 0; i < enemies.length; i++) {
    const enemy = enemies[i];
    if (!enemy.alive || enemy.dying > 0) continue;

    const length = Math.hypot(pushX[i], pushZ[i]);
    if (length > 0) {
      const scale = length > limit ? limit / length : 1;
      const movedX = pushX[i] * scale;
      const movedZ = pushZ[i] * scale;
      enemy.x += movedX;
      enemy.z += movedZ;
      // The body acknowledges the shove instead of ignoring it. Movement the
      // heading never turned towards is what sliding is, so the push turns
      // the heading by its own share of the frame's travel — a small nudge
      // bends the run, a big one turns the body into it.
      const shoved = Math.hypot(movedX, movedZ);
      const share = shoved / (ENEMY_SPEED * dt + shoved);
      const want = Math.atan2(movedX, movedZ);
      let delta = want - Math.atan2(enemy.headingX, enemy.headingZ);
      while (delta > Math.PI) delta -= Math.PI * 2;
      while (delta < -Math.PI) delta += Math.PI * 2;
      const turned = Math.atan2(enemy.headingX, enemy.headingZ) + delta * share;
      enemy.headingX = Math.sin(turned);
      enemy.headingZ = Math.cos(turned);
      if (enemy.throttle > 0) enemy.facing = turned;
    }
    // Separation does not know about crates, so a crowd pressed against one
    // puts bodies inside it. Correcting here rather than next frame keeps
    // them out of blocked cells, where the field has no route and the walk
    // degenerates into grinding along the face.
    pushOutOfObstacles(enemy, ENEMY_RADIUS, obstacles);
    clampToRoom(enemy, ENEMY_RADIUS);
  }
}
