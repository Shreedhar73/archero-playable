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
