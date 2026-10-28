import {
  ENEMY_COUNT,
  ENEMY_RADIUS,
  ENEMY_SPEED,
  PLAYER_RADIUS,
} from "../config.ts";

/** One enemy. Exists for the whole session; 'alive' decides if it is simulated  */
export interface Enemy {
  x: number;
  z: number;
  facing: number;
  throttle: number;
  alive: boolean;
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
    });
  }
  return enemies;
}

/** Hanldes enemy movement */

export function updateEnemies(
  enemies: Enemy[],
  targetX: number,
  targetZ: number,
  dt: number,
): void {
  const contact = ENEMY_RADIUS + PLAYER_RADIUS;
  for (let i = 0; i < enemies.length; i++) {
    const enemy = enemies[i];
    if (!enemy.alive) continue;
    const dx = targetX - enemy.x;
    const dz = targetZ - enemy.z;
    const distance = Math.hypot(dx, dz);
    if (distance <= contact) {
      enemy.throttle = 0;
      continue;
    }

    const dirX = dx / distance;
    const dirZ = dz / distance;

    enemy.facing = Math.atan2(dirX, dirZ);
    enemy.throttle = 1;
    enemy.x += dirX * ENEMY_SPEED * dt;
    enemy.z += dirZ * ENEMY_SPEED * dt;
  }
}
