/** Static box on floor */
export interface Obstacle {
  x: number;
  z: number;
  halfX: number;
  halfZ: number;
}

export function createObstacles(): Obstacle[] {
  return [
    // Upper row: one long block, one short, lane between them at x≈1.
    { x: -1.8, z: -3, halfX: 1.6, halfZ: 0.5 },
    { x: 3.2, z: -3, halfX: 1.0, halfZ: 0.5 },
    // Middle row: both walls blocked, so the only way through is the centre.
    { x: -3.4, z: 0, halfX: 1.1, halfZ: 0.5 },
    { x: 3.4, z: 0, halfX: 1.1, halfZ: 0.5 },
    // Lower row: centre blocked, so the centre lane does not run straight
    // from the spawn line to the player.
    { x: 0.4, z: 2.6, halfX: 1.3, halfZ: 0.5 },
  ];
}
