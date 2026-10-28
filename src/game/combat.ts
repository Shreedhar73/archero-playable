import {
  ENEMY_ATTACK_INTERVAL,
  ENEMY_DAMAGE,
  ENEMY_RADIUS,
  FIRE_INTERVAL,
  FIRE_RANGE,
  PLAYER_RADIUS,
} from "../config.ts";
import type { Enemy } from "./enemy.ts";
import type { Player } from "./player.ts";
import { fireProjectile, type Projectile } from "./projectiles.ts";
import { nearestEnemy } from "./targeting.ts";

/** Slightly more than touching, so a swing does not miss on a rounding error. */
const MELEE_REACH = ENEMY_RADIUS + PLAYER_RADIUS + 0.15;

/**
 * The Archero rule: the archer fires automatically, but only while standing
 * still. That is the whole design of the game in one condition — moving is
 * dodging, standing is shooting, and the player is always choosing between
 * them.
 *
 * The cooldown keeps ticking while moving, so stopping fires immediately
 * rather than after a pause the player did not ask for.
 */
export function updateShooting(
  player: Player,
  enemies: Enemy[],
  projectiles: Projectile[],
  dt: number,
): void {
  player.fireCooldown -= dt;
  if (player.throttle > 0 || player.fireCooldown > 0) return;

  const target = nearestEnemy(enemies, player.x, player.z, FIRE_RANGE);
  if (target === null) return;

  const dx = target.x - player.x;
  const dz = target.z - player.z;
  const distance = Math.hypot(dx, dz);
  if (distance === 0) return;

  const dirX = dx / distance;
  const dirZ = dz / distance;

  // Facing follows the shot while standing: an archer firing sideways reads
  // as a bug even when the arrow goes the right way.
  player.facing = Math.atan2(dirX, dirZ);
  fireProjectile(projectiles, player.x, player.z, dirX, dirZ);
  player.fireCooldown = FIRE_INTERVAL;
}

/**
 * Melee. An enemy in reach swings on its own cooldown; out of reach, the
 * cooldown is reset so stepping away and back does not grant a free hit.
 */
export function updateEnemyAttacks(
  enemies: Enemy[],
  player: Player,
  dt: number,
): void {
  for (let i = 0; i < enemies.length; i++) {
    const enemy = enemies[i];
    if (!enemy.alive || enemy.dying > 0) continue;

    const dx = player.x - enemy.x;
    const dz = player.z - enemy.z;
    const inReach = dx * dx + dz * dz <= MELEE_REACH * MELEE_REACH;

    if (!inReach) {
      enemy.attacking = false;
      enemy.attackCooldown = ENEMY_ATTACK_INTERVAL;
      continue;
    }

    enemy.attacking = true;
    enemy.attackCooldown -= dt;
    if (enemy.attackCooldown <= 0) {
      player.hp = Math.max(0, player.hp - ENEMY_DAMAGE);
      enemy.attackCooldown = ENEMY_ATTACK_INTERVAL;
    }
  }
}
