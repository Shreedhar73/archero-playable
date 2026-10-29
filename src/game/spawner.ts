import {
  ENEMY_RADIUS,
  ENEMIES_TO_KILL,
  ENEMY_KINDS,
  ENEMY_HP,
  ROOM_DEPTH,
  ROOM_WIDTH,
  SPAWN_INTERVAL,
} from "../config.ts";
import type { Enemy } from "./enemy.ts";

export interface Spawner {
  cooldown: number;
  spawned: number;
  /** Injected so the headless test can seed it. */
  random: () => number;
}

export function createSpawner(random: () => number = Math.random): Spawner {
  return { cooldown: SPAWN_INTERVAL, spawned: 0, random };
}

/** First free slot, or -1. */
function freeSlot(enemies: Enemy[]): number {
  for (let i = 0; i < enemies.length; i++) {
    const enemy = enemies[i];

    if (!enemy.alive) return i;
  }
  return -1;
}

/** Spawns at the far edge; the player enters from the near one. */
function placeAtEdge(
  enemy: Enemy,
  enemies: Enemy[],
  random: () => number,
  index: number,
): void {
  const halfX = ROOM_WIDTH / 2 - ENEMY_RADIUS;
  const z = -(ROOM_DEPTH / 2 - ENEMY_RADIUS);

  // Try several x and keep the roomiest, so spawns do not land on each other.
  let bestX = (random() * 2 - 1) * halfX;
  let bestGap = -1;

  for (let attempt = 0; attempt < 6; attempt++) {
    const x = (random() * 2 - 1) * halfX;
    let gap = Number.POSITIVE_INFINITY;

    for (let i = 0; i < enemies.length; i++) {
      const other = enemies[i];
      if (other === enemy || !other.alive) continue;
      gap = Math.min(gap, Math.hypot(other.x - x, other.z - z));
    }

    if (gap > bestGap) {
      bestGap = gap;
      bestX = x;
    }
    if (gap >= ENEMY_RADIUS * 2) break;
  }

  enemy.x = bestX;
  enemy.z = z;

  enemy.facing = 0;
  enemy.throttle = 0;
  enemy.alive = true;
  // Kind is fixed per slot, not per spawn, so the renderer builds each slot's
  // model and clips once at boot.
  enemy.kind = ENEMY_KINDS[index % ENEMY_KINDS.length];
  // Reset every field: this slot held a corpse.
  enemy.hp = ENEMY_HP;
  enemy.dying = 0;
  enemy.attackCooldown = 0;
  enemy.attacking = false;
  enemy.hitFlash = 0;
  // Heading must agree with facing or the first step is a slide.
  enemy.headingX = Math.sin(enemy.facing);
  enemy.headingZ = Math.cos(enemy.facing);
}

export function updateSpawner(
  spawner: Spawner,
  enemies: Enemy[],
  dt: number,
): void {
  // A level is exactly ENEMIES_TO_KILL enemies.
  if (spawner.spawned >= ENEMIES_TO_KILL) return;

  spawner.cooldown -= dt;
  if (spawner.cooldown > 0) return;
  const slot = freeSlot(enemies);
  if (slot === -1) {
    // Pool full; retry next frame.
    spawner.cooldown = 0;
    return;
  }
  placeAtEdge(enemies[slot], enemies, spawner.random, slot);
  spawner.spawned += 1;
  spawner.cooldown = SPAWN_INTERVAL;
}
