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
import { HIT_FLASH_TIME, type Enemy } from "./enemy.ts";
import type { Player } from "./player.ts";
import { fireProjectile, type Projectile } from "./projectiles.ts";
import type { Obstacle } from "./obstacles.ts";
import { nearestVisibleEnemy } from "./targeting.ts";

/** A hair past touching so a swing never misses on rounding. */
const MELEE_REACH = ENEMY_RADIUS + PLAYER_RADIUS + 0.15;

/**
 * Auto-fire, only while standing still. The cooldown keeps ticking while
 * moving so stopping fires at once.
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
  player.hitFlash = Math.max(0, player.hitFlash - dt);
  // Moving cancels the pose; the Shoot clip must not play over the run.
  if (player.throttle > 0) player.shooting = 0;

  // Every frame, moving or not: the target marker and the facing read this,
  // not just the frames an arrow leaves.
  player.target = nearestVisibleEnemy(
    enemies,
    player.x,
    player.z,
    FIRE_RANGE,
    obstacles,
  );

  if (player.target >= 0 && player.throttle === 0) {
    // Standing: face the target. `movePlayer` owns facing while the stick is pushed.
    const aim = enemies[player.target];
    player.facing = Math.atan2(aim.x - player.x, aim.z - player.z);
  }

  if (player.throttle > 0 || player.fireCooldown > 0) return;
  if (player.target < 0) return;

  const target = enemies[player.target];
  const dx = target.x - player.x;
  const dz = target.z - player.z;
  const distance = Math.hypot(dx, dz);
  if (distance === 0) return;

  const dirX = dx / distance;
  const dirZ = dz / distance;

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
 * Melee swings when touching; archers fire from ENEMY_SHOOT_RANGE. Out of
 * range the cooldown resets, so stepping away and back is not a free hit.
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

    // Blocked archers hold the shot; `updateEnemies` walks them clear. While
    // walking, facing belongs to the walk, so do not turn them here.
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
      player.hitFlash = HIT_FLASH_TIME;
      player.lastDamage = ENEMY_DAMAGE;
      enemy.attackCooldown = ENEMY_ATTACK_INTERVAL;
    }
  }
}
