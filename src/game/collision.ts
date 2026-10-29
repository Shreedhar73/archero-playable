import { clamp } from "../engine/math.ts";
import type { Obstacle } from "./obstacles.ts";
import type { Positioned } from "./room.ts";

export function pushOutOfObstacles(
  body: Positioned,
  radius: number,
  obstacles: Obstacle[],
): void {
  for (let i = 0; i < obstacles.length; i++) {
    const box = obstacles[i];

    const closestX = clamp(body.x, box.x - box.halfX, box.x + box.halfX);
    const closestZ = clamp(body.z, box.z - box.halfZ, box.z + box.halfZ);

    const dx = body.x - closestX;
    const dz = body.z - closestZ;
    const distance = Math.hypot(dx, dz);

    if (distance >= radius) continue;

    if (distance > 0) {
      body.x = closestX + (dx / distance) * radius;
      body.z = closestZ + (dz / distance) * radius;
      continue;
    }
    // Centre inside the box: no direction to push along, so exit through the nearest face.
    const outX = box.halfX - Math.abs(body.x - box.x);
    const outZ = box.halfZ - Math.abs(body.z - box.z);
    if (outX < outZ) {
      body.x = box.x + Math.sign(body.x - box.x || 1) * (box.halfX + radius);
    } else {
      body.z = box.z + Math.sign(body.z - box.z || 1) * (box.halfZ + radius);
    }
  }
}

/** Yes/no overlap test for projectiles, which die on contact instead of sliding. */
export function overlapsObstacle(
  x: number,
  z: number,
  radius: number,
  obstacles: Obstacle[],
): boolean {
  for (let i = 0; i < obstacles.length; i++) {
    const box = obstacles[i];
    const closestX = clamp(x, box.x - box.halfX, box.x + box.halfX);
    const closestZ = clamp(z, box.z - box.halfZ, box.z + box.halfZ);
    if (Math.hypot(x - closestX, z - closestZ) < radius) return true;
  }
  return false;
}

/**
 * Segment-vs-boxes slab test: boxes grown by the arrow radius, arrow treated
 * as a point. Slightly conservative at corners, which only costs a shot that
 * would have grazed a crate.
 */
export function clearShot(
  fromX: number,
  fromZ: number,
  toX: number,
  toZ: number,
  radius: number,
  obstacles: Obstacle[],
): boolean {
  const dx = toX - fromX;
  const dz = toZ - fromZ;

  for (let i = 0; i < obstacles.length; i++) {
    const box = obstacles[i];
    const minX = box.x - box.halfX - radius;
    const maxX = box.x + box.halfX + radius;
    const minZ = box.z - box.halfZ - radius;
    const maxZ = box.z + box.halfZ + radius;

    // Fractions of the segment, not a ray: a crate behind the target blocks nothing.
    let near = 0;
    let far = 1;
    let blocked = true;

    for (let axis = 0; axis < 2 && blocked; axis++) {
      const origin = axis === 0 ? fromX : fromZ;
      const delta = axis === 0 ? dx : dz;
      const low = axis === 0 ? minX : minZ;
      const high = axis === 0 ? maxX : maxZ;

      if (Math.abs(delta) < 1e-9) {
        // Parallel to this slab: wholly inside or wholly outside.
        if (origin < low || origin > high) blocked = false;
        continue;
      }

      const first = (low - origin) / delta;
      const second = (high - origin) / delta;
      near = Math.max(near, Math.min(first, second));
      far = Math.min(far, Math.max(first, second));
      if (near > far) blocked = false;
    }

    if (blocked) return false;
  }
  return true;
}
