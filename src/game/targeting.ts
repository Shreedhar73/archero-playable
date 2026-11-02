import { ARROW_RADIUS, ARROW_SPAWN_OFFSET } from "../config.ts";
import { clearShot } from "./collision.ts";
import type { Enemy } from "./enemy.ts";
import type { Obstacle } from "./obstacles.ts";

/**
 * Nearest living enemy in range with no crate in the way, as a pool index or
 * -1. Traced from the arrow's spawn point, not the shooter's centre, so a
 * crate at the shooter's back does not block.
 */
export function nearestVisibleEnemy(
  enemies: Enemy[],
  x: number,
  z: number,
  range: number,
  obstacles: Obstacle[],
): number {
  let best = -1;
  let bestSquared = range * range;

  for (let i = 0; i < enemies.length; i++) {
    const enemy = enemies[i];
    if (!enemy.alive || enemy.dying > 0) continue;

    const dx = enemy.x - x;
    const dz = enemy.z - z;
    const squared = dx * dx + dz * dz;
    if (squared >= bestSquared) continue;

    const distance = Math.sqrt(squared);
    if (distance === 0) continue;
    const muzzleX = x + (dx / distance) * ARROW_SPAWN_OFFSET;
    const muzzleZ = z + (dz / distance) * ARROW_SPAWN_OFFSET;
    if (!clearShot(muzzleX, muzzleZ, enemy.x, enemy.z, ARROW_RADIUS, obstacles)) {
      continue;
    }

    bestSquared = squared;
    best = i;
  }

  return best;
}
