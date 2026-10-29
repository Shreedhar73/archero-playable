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

/**
 * Countdown to the next enemy spawn, and how many have been sent so far.
 * Plain state like everything else, so an orientation change cannot reset it.
 */
export interface Spawner {
  cooldown: number;
  spawned: number;
  /** Injected so a test can seed it. Math.random cannot be reproduced, which
   *  makes a headless simulation useless as a regression test: same frames,
   *  different positions, every run. */
  random: () => number;
}

export function createSpawner(random: () => number = Math.random): Spawner {
  return { cooldown: SPAWN_INTERVAL, spawned: 0, random };
}

/** Index of the first free slot, or -1 when every one is in play. */

function freeSlot(enemies: Enemy[]): number {
  for (let i = 0; i < enemies.length; i++) {
    const enemy = enemies[i];

    if (!enemy.alive) return i;
  }
  return -1;
}

/** Spawsn the enemy at far edge. The player enters at bottom and the room fills from the top. */

function placeAtEdge(
  enemy: Enemy,
  enemies: Enemy[],
  random: () => number,
  index: number,
): void {
  const halfX = ROOM_WIDTH / 2 - ENEMY_RADIUS;
  const z = -(ROOM_DEPTH / 2 - ENEMY_RADIUS);

  // Several candidates, keeping the roomiest. One random x per spawn put new
  // arrivals on top of the last one often enough to matter: the separation
  // pass then has to tear two bodies apart in a few frames, which is the one
  // thing it cannot do without shoving them harder than they can walk.
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
    // Clear of everyone by a full body: nothing better to look for.
    if (gap >= ENEMY_RADIUS * 2) break;
  }

  enemy.x = bestX;
  enemy.z = z;

  enemy.facing = 0;
  enemy.throttle = 0;
  enemy.alive = true;
  // Kind comes from the POOL SLOT, not the spawn order. Each slot is one kind
  // for the whole session, which is what lets the renderer build the right
  // model and clip set for it once at boot instead of swapping models when
  // something respawns.
  enemy.kind = ENEMY_KINDS[index % ENEMY_KINDS.length];
  // Every field, not just the interesting ones: this slot held a corpse.
  enemy.hp = ENEMY_HP;
  enemy.dying = 0;
  enemy.attackCooldown = 0;
  enemy.attacking = false;
  enemy.hitFlash = 0;
  // Facing and heading agree at the top of the walk, or the first step is a
  // body travelling one way and pointing another.
  enemy.headingX = Math.sin(enemy.facing);
  enemy.headingZ = Math.cos(enemy.facing);
}

export function updateSpawner(
  spawner: Spawner,
  enemies: Enemy[],
  dt: number,
): void {
  // A level is exactly ENEMIES_TO_KILL enemies. Once they have all been
  // sent, the spawner is done — the level ends when the last one dies.
  if (spawner.spawned >= ENEMIES_TO_KILL) return;

  spawner.cooldown -= dt;
  if (spawner.cooldown > 0) return;
  const slot = freeSlot(enemies);
  if (slot === -1) {
    // pool full cannot spawn at this time
    spawner.cooldown = 0;
    return;
  }
  placeAtEdge(enemies[slot], enemies, spawner.random, slot);
  spawner.spawned += 1;
  spawner.cooldown = SPAWN_INTERVAL;
}
