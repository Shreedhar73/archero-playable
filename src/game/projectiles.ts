import {
  ARROW_DAMAGE,
  ENEMY_ARROW_DAMAGE,
  ENEMY_ARROW_SPEED,
  ARROW_LIFE,
  ARROW_RADIUS,
  ARROW_SPEED,
  ENEMY_RADIUS,
  PLAYER_RADIUS,
  PROJECTILE_COUNT,
  ROOM_DEPTH,
  ROOM_WIDTH,
} from "../config.ts";
import { overlapsObstacle } from "./collision.ts";
import { damageEnemy, HIT_FLASH_TIME, type Enemy } from "./enemy.ts";
import type { Obstacle } from "./obstacles.ts";
import type { Player } from "./player.ts";

/** One arrow. Pooled like enemies; `alive` gates simulation. */
export interface Projectile {
  x: number;
  z: number;
  dirX: number;
  dirZ: number;
  /** Seconds before it despawns on its own. */
  life: number;
  alive: boolean;
  /** Enemy arrow: hits the player instead. One pool serves both sides. */
  hostile: boolean;
}

export function createProjectiles(): Projectile[] {
  const projectiles: Projectile[] = [];
  for (let i = 0; i < PROJECTILE_COUNT; i++) {
    projectiles.push({
      x: 0,
      z: 0,
      dirX: 0,
      dirZ: 1,
      life: 0,
      alive: false,
      hostile: false,
    });
  }
  return projectiles;
}

/** Drops the shot when the pool is full; at this fire rate and life it never is. */
export function fireProjectile(
  projectiles: Projectile[],
  x: number,
  z: number,
  dirX: number,
  dirZ: number,
  hostile: boolean,
): void {
  for (let i = 0; i < projectiles.length; i++) {
    const arrow = projectiles[i];
    if (arrow.alive) continue;
    arrow.x = x;
    arrow.z = z;
    arrow.dirX = dirX;
    arrow.dirZ = dirZ;
    arrow.life = ARROW_LIFE;
    arrow.hostile = hostile;
    arrow.alive = true;
    return;
  }
}

/**
 * Returns kills this frame; scoring lives elsewhere. Enemies are tested before
 * obstacles so a shot grazing a crate edge still lands.
 */
export function updateProjectiles(
  projectiles: Projectile[],
  enemies: Enemy[],
  player: Player,
  obstacles: Obstacle[],
  dt: number,
): number {
  const limitX = ROOM_WIDTH / 2;
  const limitZ = ROOM_DEPTH / 2;
  let kills = 0;

  for (let i = 0; i < projectiles.length; i++) {
    const arrow = projectiles[i];
    if (!arrow.alive) continue;

    arrow.life -= dt;
    if (arrow.life <= 0) {
      arrow.alive = false;
      continue;
    }

    // Enemy arrows are slower so they can be dodged.
    const speed = arrow.hostile ? ENEMY_ARROW_SPEED : ARROW_SPEED;
    arrow.x += arrow.dirX * speed * dt;
    arrow.z += arrow.dirZ * speed * dt;

    if (Math.abs(arrow.x) > limitX || Math.abs(arrow.z) > limitZ) {
      arrow.alive = false;
      continue;
    }

    let hit = false;
    if (arrow.hostile) {
      const dx = player.x - arrow.x;
      const dz = player.z - arrow.z;
      const reach = PLAYER_RADIUS + ARROW_RADIUS;
      if (dx * dx + dz * dz <= reach * reach) {
        player.hp = Math.max(0, player.hp - ENEMY_ARROW_DAMAGE);
        player.hitFlash = HIT_FLASH_TIME;
        player.lastDamage = ENEMY_ARROW_DAMAGE;
        hit = true;
      }
    } else {
      for (let e = 0; e < enemies.length; e++) {
        const enemy = enemies[e];
        if (!enemy.alive || enemy.dying > 0) continue;

        const dx = enemy.x - arrow.x;
        const dz = enemy.z - arrow.z;
        const reach = ENEMY_RADIUS + ARROW_RADIUS;
        if (dx * dx + dz * dz > reach * reach) continue;

        if (damageEnemy(enemy, ARROW_DAMAGE)) kills++;
        hit = true;
        break;
      }
    }

    if (hit || overlapsObstacle(arrow.x, arrow.z, ARROW_RADIUS, obstacles)) {
      arrow.alive = false;
    }
  }

  return kills;
}
