import {
  ENEMY_COUNT,
  ENEMY_DEATH_TIME,
  ENEMY_RADIUS,
  ENEMY_BACKPEDAL,
  ENEMY_KITE_BAND,
  ENEMY_SHOOT_RANGE,
  ENEMY_SPEED,
  PLAYER_RADIUS,
} from "../config.ts";
import { clampToRoom } from "./room.ts";

/** Long enough to see at 60fps, short enough not to linger. */
const HIT_FLASH_TIME = 0.12;
import { pushOutOfObstacles } from "./collision.ts";
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
    });
  }
  return enemies;
}

/**
 * Straight-line seek: aim at the player, step, then let collision correct the
 * position. Nothing here knows the room's shape, so an enemy that walks into a
 * crate keeps choosing the same direction into it. Chapter 6.7 replaces this
 * direction with one read from a flow field.
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
    const crowded = enemy.kind === "archer" && distance < want * ENEMY_KITE_BAND;

    if (!crowded && distance <= want) {
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

    // An archer keeps its bow on the player even while walking backwards.
    // Melee faces where it is going, because the flow field may be routing it
    // around a crate and facing the player there would look broken.
    enemy.facing =
      enemy.kind === "archer"
        ? Math.atan2(toPlayerX, toPlayerZ)
        : Math.atan2(dirX, dirZ);
    enemy.throttle = 1;
    enemy.x += dirX * speed * dt;
    enemy.z += dirZ * speed * dt;
    pushOutOfObstacles(enemy, ENEMY_RADIUS, obstacles);
    clampToRoom(enemy, ENEMY_RADIUS);
  }
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

export function separateEnemies(enemies: Enemy[]) {
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

      // Two enemies at exact same point have no direction between them.
      const nx = distance > 0 ? dx / distance : 0;
      const nz = distance > 0 ? dz / distance : 0;

      const push = overlap / 2;
      a.x -= nx * push;
      a.z -= nz * push;
      b.x += nx * push;
      b.z += nz * push;
      clampToRoom(a, ENEMY_RADIUS);
      clampToRoom(b, ENEMY_RADIUS);
    }
  }
}
