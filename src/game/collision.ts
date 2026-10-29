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
    // No direction to recover: the centre is in the box, so the closest point
    // is the centre itself. Leave through the nearest face instead.
    const outX = box.halfX - Math.abs(body.x - box.x);
    const outZ = box.halfZ - Math.abs(body.z - box.z);
    if (outX < outZ) {
      body.x = box.x + Math.sign(body.x - box.x || 1) * (box.halfX + radius);
    } else {
      body.z = box.z + Math.sign(body.z - box.z || 1) * (box.halfZ + radius);
    }
  }
}

/**
 * Whether a circular body overlaps any box. Same closest-point test as the
 * push-out, but it only answers yes or no — projectiles are destroyed on
 * contact rather than slid along a surface.
 */
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
 * Whether an arrow fired from one point at another would reach it, or hit a
 * crate on the way.
 *
 * The arrow is a circle, so every box is grown by its radius and the arrow
 * treated as a point — the standard trade. It over-reports a hit at a box's
 * corners, where the true swept shape is rounded, and over-reporting costs
 * nothing here: the worst case is an archer declining a shot that would have
 * grazed past a crate edge.
 *
 * Slab test: clip the segment against each axis' pair of planes in turn and
 * see whether any interval survives. No square roots, no allocation; this
 * runs once per enemy per shot attempt.
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

    // Fractions along the segment, so the test is bounded by the target
    // rather than by an infinite ray: a crate behind the enemy blocks nothing.
    let near = 0;
    let far = 1;
    let blocked = true;

    for (let axis = 0; axis < 2 && blocked; axis++) {
      const origin = axis === 0 ? fromX : fromZ;
      const delta = axis === 0 ? dx : dz;
      const low = axis === 0 ? minX : minZ;
      const high = axis === 0 ? maxX : maxZ;

      if (Math.abs(delta) < 1e-9) {
        // Parallel to this pair of planes: either inside the slab for the
        // whole segment, or outside it for the whole segment.
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
