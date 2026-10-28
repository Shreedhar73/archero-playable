/**
 * Player state.
 * Plain data by design: No Pixi, No Three, no DOM. - the
 * renderers read this, never the other way around. The game loop updates this, and the renderers read this.
 */

import { PLAYER_SPEED, PLAYER_RADIUS, ROOM_DEPTH } from "../config.ts";
import { clampToRoom } from "./room.ts";

export interface Player {
  /** Player, Height is constant so Y is not stored, x and z are stored for movement and collision detection. */
  x: number;
  z: number;
  facing: number;

  /** 0 at rest, 1 at full tilt. Drives the animation blend. Not a speed -
   * PLAYER_SPEED is units per secondl this is a fraction of it
   */

  throttle: number;
}

export function createPlayer(): Player {
  return { x: 0, z: ROOM_DEPTH / 2 - 2, facing: 0, throttle: 0 };
}

/** Move the player based on input direction and delta time. */
export function movePlayer(
  player: Player,
  dirX: number,
  dirZ: number,
  dt: number,
): void {
  if (dirX !== 0 || dirZ !== 0) {
    player.facing = Math.atan2(dirX, dirZ);
  }
  player.throttle = Math.hypot(dirX, dirZ);
  player.x += dirX * PLAYER_SPEED * dt;
  player.z += dirZ * PLAYER_SPEED * dt;
  clampToRoom(player, PLAYER_RADIUS);
}
