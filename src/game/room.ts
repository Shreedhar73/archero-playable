import { ROOM_SIZE } from "../config.ts";
import { clamp } from "../engine/math.ts";

export interface Positioned {
  x: number;
  z: number;
}

/** Leeps a body inside the walls. Deliberately the last word on position */

export function clampToRoom(body: Positioned, radius: number): void {
  const limit = ROOM_SIZE / 2 - radius;
  body.x = clamp(body.x, -limit, limit);
  body.z = clamp(body.z, -limit, limit);
}
