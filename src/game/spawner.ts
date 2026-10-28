import { ENEMY_RADIUS, ROOM_SIZE, SPAWN_INTERVAL } from "../config";
import type { Enemy } from "./enemy";

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

/** Place the enemy on circle inscribed in room, at a random angle. Every new Place is reset */

function placeAtEdge(enemy: Enemy): void {
  const edge = ROOM_SIZE / 2 - ENEMY_RADIUS;
  const angle = Math.random() * Math.PI * 2;

  enemy.x = Math.sin(angle) * edge;
  enemy.z = Math.cos(angle) * edge;

  enemy.facing = 0;
  enemy.throttle = 0;
  enemy.alive = true;
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
