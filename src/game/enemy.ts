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

/** Shared with the player's hit flash. */
export const HIT_FLASH_TIME = 0.12;
import { clearShot, pushOutOfObstacles } from "./collision.ts";
import type { Obstacle } from "./obstacles.ts";
import { flowAt, type Grid } from "./pathfind.ts";

/** Melee closes to touching range; archer stops short and shoots. */
export type EnemyKind = "melee" | "archer";

/**
 * Pooled for the session; `alive` gates simulation. Dying is a third state:
 * the corpse stays visible for its Death clip but takes no part in the sim,
 * and the slot is freed when `dying` reaches zero.
 */
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

  /** Seconds of hit flash left. Renderer only. */
  hitFlash: number;

  /** Actual travel direction, unit vector. Turned towards the flow field at a
   *  bounded rate: the field is eight-directional and snaps 45 degrees at a
   *  cell boundary, and a body that snaps with it slides. */
  headingX: number;
  headingZ: number;
}

/** Fixed pool built at boot; nothing is allocated during play. */
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
 * Flow field plus avoidance gives a wanted direction; the heading turns
 * towards it at TURN_RATE, then the body travels. Position fixes come last
 * and stay small: displacement the heading never turned towards reads as sliding.
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
      // Corpse: here only for the Death clip.
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

    // Kinds differ only in standoff distance. Archers hold a band around it.
    const want = enemy.kind === "archer" ? ENEMY_SHOOT_RANGE : contact;
    // A blocked archer keeps walking so the field takes it round the crate.
    // Same muzzle point as `updateEnemyAttacks`, or the two rules could
    // disagree and freeze it.
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
      // Straight back, not a negated field; push-out and clamp below handle walls.
      dirX = -toPlayerX;
      dirZ = -toPlayerZ;
      speed *= ENEMY_BACKPEDAL;
    } else {
      // Straight line only where the flood never reached.
      const flow = flowAt(grid, enemy.x, enemy.z);
      dirX = flow.known ? flow.x : toPlayerX;
      dirZ = flow.known ? flow.z : toPlayerZ;
    }

    // Crates and neighbours enter as steering input, not as a later push.
    avoidObstacles(enemy, obstacles);
    dirX += avoidX * AVOID_WEIGHT;
    dirZ += avoidZ * AVOID_WEIGHT;
    avoidCrowd(enemy, enemies);
    dirX += avoidX * CROWD_WEIGHT;
    dirZ += avoidZ * CROWD_WEIGHT;
    // Pressed from in front, slow down rather than shove.
    const press = Math.hypot(avoidX, avoidZ);
    const yield_ = press > 0 ? Math.max(0.35, 1 - press * 0.5) : 1;

    const wanted = Math.hypot(dirX, dirZ);
    if (wanted > 0) {
      dirX /= wanted;
      dirZ /= wanted;
    }

    steer(enemy, dirX, dirZ, dt);
    enemy.facing = Math.atan2(enemy.headingX, enemy.headingZ);
    enemy.throttle = 1;

    // Turn before travelling: full speed through a half-turn is a slide.
    const align = Math.max(0, enemy.headingX * dirX + enemy.headingZ * dirZ);
    const gait = 0.15 + 0.85 * align;

    enemy.x += enemy.headingX * speed * yield_ * gait * dt;
    enemy.z += enemy.headingZ * speed * yield_ * gait * dt;
    pushOutOfObstacles(enemy, ENEMY_RADIUS, obstacles);
    clampToRoom(enemy, ENEMY_RADIUS);
  }
}

/** Crate avoidance: distance at which it starts, and its weight against the
 *  field. A wider margin keeps bodies out of the narrow lanes. */
const AVOID_MARGIN = ENEMY_RADIUS * 0.5;
const AVOID_WEIGHT = 1.1;

/** Same for neighbours, weaker so bodies still bunch around the player. */
const CROWD_MARGIN = ENEMY_RADIUS * 0.6;
const CROWD_WEIGHT = 1.0;

/** Outputs of the avoid functions; module level so the hot path allocates nothing. */
let avoidX = 0;
let avoidZ = 0;

/** Soft push away from every crate within AVOID_MARGIN. */
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

    // Hyperbolic falloff, capped so a near-contact pair cannot spin.
    const strength = Math.min(3, reach / Math.max(distance, 1e-4) - 1);
    if (distance > 0) {
      avoidX += (dx / distance) * strength;
      avoidZ += (dz / distance) * strength;
    }
  }
}

/** Same for neighbours. `separateEnemies` is only the fallback. */
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

    const strength = Math.min(3, reach / Math.max(distance, 1e-4) - 1);
    if (distance > 0) {
      avoidX += (dx / distance) * strength;
      avoidZ += (dz / distance) * strength;
    }
  }
}

/** Separation accumulators, allocated once. */
const pushX = new Float32Array(ENEMY_COUNT);
const pushZ = new Float32Array(ENEMY_COUNT);

/** Radians per second. 9 is a half-turn in a third of a second. */
const TURN_RATE = 9;

/** Turn the heading towards a direction by at most one frame of TURN_RATE,
 *  the short way round the -pi/+pi seam. */
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

/** Returns true only on the killing hit, so a corpse never pays out twice. */
export function damageEnemy(enemy: Enemy, amount: number): boolean {
  if (!enemy.alive || enemy.dying > 0) return false;
  enemy.hitFlash = HIT_FLASH_TIME;
  enemy.hp -= amount;
  if (enemy.hp > 0) return false;
  enemy.hp = 0;
  enemy.dying = ENEMY_DEATH_TIME;
  return true;
}

/**
 * Last-resort separation for overlaps steering could not prevent. Capped at
 * one frame of walking, and summed before applying so three neighbours do
 * not move a body three times.
 */
export function separateEnemies(
  enemies: Enemy[],
  obstacles: Obstacle[],
  dt: number,
): void {
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

      // Coincident pair: any non-zero axis will do.
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
      // Turn the heading into the shove by its share of the frame's travel.
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
    // Separation can push a body into a crate; fix it now, not next frame.
    pushOutOfObstacles(enemy, ENEMY_RADIUS, obstacles);
    clampToRoom(enemy, ENEMY_RADIUS);
  }
}
