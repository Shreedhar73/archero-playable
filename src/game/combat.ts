import {
  ARROW_RADIUS,
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
import { clearShot } from "./collision.ts";
import type { Enemy } from "./enemy.ts";
import type { Player } from "./player.ts";
import { fireProjectile, type Projectile } from "./projectiles.ts";
import type { Obstacle } from "./obstacles.ts";
import { nearestVisibleEnemy } from "./targeting.ts";

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
  obstacles: Obstacle[],
  dt: number,
): void {
  player.fireCooldown -= dt;
  player.shooting = Math.max(0, player.shooting - dt);
  // Moving cancels the pose outright: the archer cannot run with the bow
  // drawn, and letting the clip finish while sprinting reads as a stutter.
  if (player.throttle > 0) player.shooting = 0;
  if (player.throttle > 0 || player.fireCooldown > 0) return;

  // Nothing in the open: hold the shot rather than feed the crate. Standing
  // behind cover costing the player their damage is the point of cover.
  const target = nearestVisibleEnemy(
    enemies,
    player.x,
    player.z,
    FIRE_RANGE,
    obstacles,
  );
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
  obstacles: Obstacle[],
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

    const distance = Math.sqrt(squared);
    const dirX = distance > 0 ? dx / distance : 0;
    const dirZ = distance > 0 ? dz / distance : 1;

    // Same rule as the player's: an archer with a crate in the way holds its
    // shot. `updateEnemies` is what walks it out from behind the crate, so
    // this is a pause, not a deadlock — and while it is walking, the facing
    // belongs to the walk. Turning the body towards the player here as well
    // is what made a repositioning archer look like it was sliding.
    const canShoot =
      enemy.kind !== "archer" ||
      clearShot(
        enemy.x + dirX * ARROW_SPAWN_OFFSET,
        enemy.z + dirZ * ARROW_SPAWN_OFFSET,
        player.x,
        player.z,
        ARROW_RADIUS,
        obstacles,
      );

    if (!canShoot) {
      enemy.attacking = false;
      continue;
    }

    enemy.attacking = true;
    enemy.attackCooldown -= dt;
    // Standing still and able to act: aim. An enemy that kept whatever facing
    // it arrived with would shoot sideways.
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
