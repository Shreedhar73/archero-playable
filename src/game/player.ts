/**
 * Player state.
 * Plain data by design: No Pixi, No Three, no DOM. - the
 * renderers read this, never the other way around. The game loop updates this, and the renderers read this.
 */

import { PLAYER_SPEED, PLAYER_RADIUS, ROOM_SIZE } from "../config.ts";

export interface Player {
  /** Player, Height is constant so Y is not stored, x and z are stored for movement and collision detection. */
  x: number;
  z: number;
}

export function createPlayer(): Player {
  return { x: 0, z: 0 };
}

/** Move the player based on input direction and delta time. */
export function movePlayer(
  player: Player,
  dirX: number,
  dirZ: number,
  dt: number,
): void {
  player.x += dirX * PLAYER_SPEED * dt;
  player.z += dirZ * PLAYER_SPEED * dt;
  const limit = ROOM_SIZE / 2 - PLAYER_RADIUS;
  player.x = Math.max(-limit, Math.min(limit, player.x));
  player.z = Math.max(-limit, Math.min(limit, player.z));
}
