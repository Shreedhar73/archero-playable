import {
  ARROW_SPAWN_OFFSET,
  ENEMY_SHOOT_RANGE,
  ENEMY_SHOT_INTERVAL,
  ENEMY_ATTACK_INTERVAL,
  ENEMY_DAMAGE,
  ENEMY_RADIUS,
  FIRE_INTERVAL,
  FIRE_RANGE,
  PLAYER_RADIUS,
  SHOOT_POSE,
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
  player.shooting = Math.max(0, player.shooting - dt);
  // Moving cancels the pose outright: the archer cannot run with the bow
  // drawn, and letting the clip finish while sprinting reads as a stutter.
  if (player.throttle > 0) player.shooting = 0;
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
  fireProjectile(
    projectiles,
    player.x + dirX * ARROW_SPAWN_OFFSET,
    player.z + dirZ * ARROW_SPAWN_OFFSET,
    dirX,
    dirZ,
    false,
  );
  player.fireCooldown = FIRE_INTERVAL;
  player.shooting = SHOOT_POSE;
}

/**
 * Enemy offence, both kinds.
 *
 * Melee swings when touching; archers hold at ENEMY_SHOOT_RANGE and fire.
 * Out of their own range either way, the cooldown resets, so stepping away
 * and back does not grant a free hit.
 */
export function updateEnemyAttacks(
  enemies: Enemy[],
  player: Player,
  projectiles: Projectile[],
  dt: number,
): void {
  for (let i = 0; i < enemies.length; i++) {
    const enemy = enemies[i];
    if (!enemy.alive || enemy.dying > 0) continue;

    const dx = player.x - enemy.x;
    const dz = player.z - enemy.z;
    const squared = dx * dx + dz * dz;
    const reach = enemy.kind === "archer" ? ENEMY_SHOOT_RANGE : MELEE_REACH;

    if (squared > reach * reach) {
      enemy.attacking = false;
      enemy.attackCooldown =
        enemy.kind === "archer" ? ENEMY_SHOT_INTERVAL : ENEMY_ATTACK_INTERVAL;
      continue;
    }

    enemy.attacking = true;
    enemy.attackCooldown -= dt;

    // An archer that has stopped walking would otherwise keep whatever facing
    // it arrived with, and shoot sideways.
    const distance = Math.sqrt(squared);
    const dirX = distance > 0 ? dx / distance : 0;
    const dirZ = distance > 0 ? dz / distance : 1;
    enemy.facing = Math.atan2(dirX, dirZ);

    if (enemy.attackCooldown > 0) continue;

    if (enemy.kind === "archer") {
      fireProjectile(
        projectiles,
        enemy.x + dirX * ARROW_SPAWN_OFFSET,
        enemy.z + dirZ * ARROW_SPAWN_OFFSET,
        dirX,
        dirZ,
        true,
      );
      enemy.attackCooldown = ENEMY_SHOT_INTERVAL;
    } else {
      player.hp = Math.max(0, player.hp - ENEMY_DAMAGE);
      enemy.attackCooldown = ENEMY_ATTACK_INTERVAL;
    }
  }
}
