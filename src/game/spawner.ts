import {
  ENEMY_RADIUS,
  ENEMIES_TO_KILL,
  ENEMY_HP,
  ROOM_DEPTH,
  ROOM_WIDTH,
  SPAWN_INTERVAL,
} from "../config.ts";
import type { Enemy } from "./enemy.ts";

/**
 * Countdown to the next enemy spawn, and how many have been sent so far.
 * Plain state like everything else, so an orientation change cannot reset it.
 */
export interface Spawner {
  cooldown: number;
  spawned: number;
}

export function createSpawner(): Spawner {
  return { cooldown: SPAWN_INTERVAL, spawned: 0 };
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
  enemy.hitFlash = 0;
}

export function updateSpawner(
  spawner: Spawner,
  enemies: Enemy[],
  dt: number,
): void {
  // A level is exactly ENEMIES_TO_KILL enemies. Once they have all been
  // sent, the spawner is done - the level ends when the last one dies.
  if (spawner.spawned >= ENEMIES_TO_KILL) return;

  spawner.cooldown -= dt;
  if (spawner.cooldown > 0) return;
  const enemy = freeSlot(enemies);
  if (enemy == null) {
    // pool full cannot spawn at this time
    spawner.cooldown = 0;
    return;
  }
  placeAtEdge(enemy);
  spawner.spawned += 1;
  spawner.cooldown = SPAWN_INTERVAL;
}
