/** Static box on floor */
export interface Obstacle {
  x: number;
  z: number;
  halfX: number;
  halfZ: number;
}

/**
 * Three rows at 18%, 41% and 62% of the depth, traced off
 * `requirements/reference.jpg`. Narrow lanes in row two are what give the
 * flow field a choice. Boxes meeting a wall extend past it, or clampToRoom's
 * limit sits inside the geometry and fights the push-out.
 */
export function createObstacles(): Obstacle[] {
  return [
    // Row one: a run of five across the centre.
    { x: 0, z: -5.12, halfX: 2.02, halfZ: 0.47 },
    // Row two: pairs at both walls, singles flanking the centre lane.
    { x: -3.95, z: -1.44, halfX: 1.05, halfZ: 0.52 },
    { x: -1.61, z: -1.44, halfX: 0.43, halfZ: 0.52 },
    { x: 1.59, z: -1.44, halfX: 0.43, halfZ: 0.52 },
    { x: 3.91, z: -1.44, halfX: 1.09, halfZ: 0.52 },
    // Row three: one block against each wall.
    { x: -3.6, z: 1.92, halfX: 1.4, halfZ: 0.5 },
    { x: 3.6, z: 1.92, halfX: 1.4, halfZ: 0.5 },
  ];
}
