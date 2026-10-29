import { ARROW_RADIUS, ARROW_SPAWN_OFFSET } from "../config.ts";
import { clearShot } from "./collision.ts";
import type { Enemy } from "./enemy.ts";
import type { Obstacle } from "./obstacles.ts";

/**
 * Nearest living enemy the shooter can actually hit: in range, and with no
 * crate between the two. Arrows die on crates, so without this the archer
 * spends the whole fight firing into the same box while an enemy stands
 * behind it — the shot looks aimed and lands nowhere.
 *
 * Nearest *visible*, not nearest: a closer enemy behind cover is skipped in
 * favour of one further away in the open, which is what a player does.
 *
 * The line is traced from where the arrow actually appears, a spawn offset
 * ahead of the shooter, rather than from its centre. A shooter standing with
 * its back against a crate is not blocked by the crate it is leaning on.
 */
export function nearestVisibleEnemy(
  enemies: Enemy[],
  x: number,
  z: number,
  range: number,
  obstacles: Obstacle[],
): Enemy | null {
  let best: Enemy | null = null;
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
    best = enemy;
  }

  return best;
}
