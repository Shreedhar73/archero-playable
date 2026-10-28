import {
  ENEMY_RADIUS,
  ENEMY_HP,
  ROOM_DEPTH,
  ROOM_WIDTH,
  SPAWN_INTERVAL,
} from "../config.ts";
import type { Enemy } from "./enemy.ts";

/** Countdown to the next enemy spawn. Plain state like everything else, no restart on orient. change */
export interface Spawner {
  cooldown: number;
}

export function createSpawner(): Spawner {
  return { cooldown: SPAWN_INTERVAL };
}

/** First free slot ( dead or start), on null when every one is on play. */

function freeSlot(enemies: Enemy[]): Enemy | null {
  for (let i = 0; i < enemies.length; i++) {
    const enemy = enemies[i];

    if (!enemy.alive) return enemy;
  }
  return null;
}

/** Spawsn the enemy at far edge. The player enters at bottom and the room fills from the top. */

function placeAtEdge(enemy: Enemy): void {
  const halfX = ROOM_WIDTH / 2 - ENEMY_RADIUS;

  enemy.x = (Math.random() * 2 - 1) * halfX;
  enemy.z = -(ROOM_DEPTH / 2 - ENEMY_RADIUS);

  enemy.facing = 0;
  enemy.throttle = 0;
  enemy.alive = true;
  // Every field, not just the interesting ones: this slot held a corpse.
  enemy.hp = ENEMY_HP;
  enemy.dying = 0;
  enemy.attackCooldown = 0;
  enemy.attacking = false;
}

export function updateSpawner(
  spawner: Spawner,
  enemies: Enemy[],
  dt: number,
): void {
  spawner.cooldown -= dt;
  if (spawner.cooldown > 0) return;
  const enemy = freeSlot(enemies);
  if (enemy == null) {
    // pool full cannot spawn at this time
    spawner.cooldown = 0;
    return;
  }
  placeAtEdge(enemy);
  spawner.cooldown = SPAWN_INTERVAL;
}
