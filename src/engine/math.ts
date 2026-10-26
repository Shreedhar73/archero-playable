/** small numeric helpers for both game logic and renderers */

/** clamps value for min max */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
