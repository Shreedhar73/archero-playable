import type { Enemy } from "./enemy.ts";

/**
 * Nearest living enemy within range, or null. Linear over the pool, which is
 * the right answer at these counts: a spatial index costs more to maintain
 * than it saves across six entries.
 *
 * Corpses are skipped, so the archer never keeps shooting something already
 * dead while a live enemy closes in.
 */
export function nearestEnemy(
  enemies: Enemy[],
  x: number,
  z: number,
  range: number,
): Enemy | null {
  let best: Enemy | null = null;
  // Compared squared, so the loop needs no square roots.
  let bestSquared = range * range;

  for (let i = 0; i < enemies.length; i++) {
    const enemy = enemies[i];
    if (!enemy.alive || enemy.dying > 0) continue;

    const dx = enemy.x - x;
    const dz = enemy.z - z;
    const squared = dx * dx + dz * dz;
    if (squared < bestSquared) {
      bestSquared = squared;
      best = enemy;
    }
  }

  return best;
}
