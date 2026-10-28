/** Static box on floor */
export interface Obstacle {
  x: number;
  z: number;
  halfX: number;
  halfZ: number;
}

/**
 * Two rows in the upper half, traced off `requirements/reference.jpg`.
 *
 * Measured from that image: the room is 507x634 px, the first row sits 18%
 * down and the second 41%, and everything below is open. That open bottom
 * half is the player's space -- a row down there, as the first draft had,
 * crowds the one place the player actually stands.
 *
 * Lane widths are checked against a body (0.7 across): 2.47 either side of
 * the top row, and 0.80 / 2.34 / 0.87 across the second. The tight ones are
 * deliberate -- they are what gives the flow field a decision to make.
 *
 * Boxes meeting a wall extend past it. Stopping flush puts clampToRoom's
 * limit inside the geometry, and the push-out then fights the clamp forever.
 */
export function createObstacles(): Obstacle[] {
  return [
    // Row one: a run of five across the centre.
    { x: 0, z: -3.79, halfX: 2.02, halfZ: 0.47 },
    // Row two: pairs at both walls, singles flanking a wide centre lane.
    { x: -3.95, z: -1.09, halfX: 1.05, halfZ: 0.52 },
    { x: -1.61, z: -1.09, halfX: 0.43, halfZ: 0.52 },
    { x: 1.59, z: -1.09, halfX: 0.43, halfZ: 0.52 },
    { x: 3.91, z: -1.09, halfX: 1.09, halfZ: 0.52 },
  ];
}
