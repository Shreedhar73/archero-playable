import {
  ENEMY_COUNT,
  ENEMY_DEATH_TIME,
  ENEMY_RADIUS,
  ENEMY_SPEED,
  PLAYER_RADIUS,
} from "../config.ts";
import { clampToRoom } from "./room.ts";
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
export interface Enemy {
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
}

/** FIxed-size pool, build once at boot. Nothing is created or destroyed during play
 * Spwans sets `alive : true`, dying sets `alive : false`;
 */
export function createEnemies(): Enemy[] {
  const enemies: Enemy[] = [];
  for (let i = 0; i < ENEMY_COUNT; i++) {
    enemies.push({
      x: 0,
      z: 0,
      facing: 0,
      throttle: 0,
      alive: false,
      hp: 0,
      dying: 0,
      attackCooldown: 0,
      attacking: false,
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
    if (distance <= contact) {
      enemy.throttle = 0;
      continue;
    }

    // The field knows the room's shape; the straight line does not. Fall back
    // to the straight line only where the flood never arrived: the player's
    // own cell, and anywhere sealed off from it.
    const flow = flowAt(grid, enemy.x, enemy.z);
    const dirX = flow.known ? flow.x : dx / distance;
    const dirZ = flow.known ? flow.z : dz / distance;

    enemy.facing = Math.atan2(dirX, dirZ);
    enemy.throttle = 1;
    enemy.x += dirX * ENEMY_SPEED * dt;
    enemy.z += dirZ * ENEMY_SPEED * dt;
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
