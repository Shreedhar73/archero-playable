/** Static box on floor */
export interface Obstacle {
  x: number;
  z: number;
  halfX: number;
  halfZ: number;
}

export function createObstacles(): Obstacle[] {
  return [
    // Upper row: one long block, one short. The short one runs past the right
    // wall — a box flush with a wall puts clampToRoom's limit inside it, and
    // the push-out then fights the clamp forever (measured: 437 frames
    // overlapping). Lane between them is 2.1 wide; a body is 0.7.
    { x: -1.8, z: -3, halfX: 1.6, halfZ: 0.5 },
    { x: 3.35, z: -3, halfX: 1.45, halfZ: 0.5 },
    // Middle row: both ends run past the walls, so the only way through is
    // the 4.6-wide centre.
    { x: -3.65, z: 0, halfX: 1.35, halfZ: 0.5 },
    { x: 3.65, z: 0, halfX: 1.35, halfZ: 0.5 },
    // Lower row: centre blocked, so the centre lane does not run straight
    // from the spawn line to the player.
    { x: 0.4, z: 2.6, halfX: 1.3, halfZ: 0.5 },
  ];
}
