import { ROOM_DEPTH, ROOM_WIDTH } from "../config.ts";
import { clamp } from "../engine/math.ts";

export interface Positioned {
  x: number;
  z: number;
}

/** Leeps a body inside the walls. Deliberately the last word on position */

export function clampToRoom(body: Positioned, radius: number): void {
  const limitX = ROOM_WIDTH / 2 - radius;
  const limitZ = ROOM_DEPTH / 2 - radius;
  body.x = clamp(body.x, -limitX, limitX);
  body.z = clamp(body.z, -limitZ, limitZ);
}
