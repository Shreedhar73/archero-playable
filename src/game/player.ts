/**
 * Player state.
 * Plain data by design: No Pixi, No Three, no DOM. - the
 * renderers read this, never the other way around. The game loop updates this, and the renderers read this.
 */

import { PLAYER_SPEED, PLAYER_RADIUS, PLAYER_HP, ROOM_DEPTH } from "../config.ts";
import { pushOutOfObstacles } from "./collision.ts";
import type { Obstacle } from "./obstacles.ts";
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

  /** Hit points. Reaching 0 ends the gameplay stage. */
  hp: number;

  /** Seconds until the next arrow. Ticks down even while moving, so stopping
   *  fires at once instead of after a pause the player did not ask for. */
  fireCooldown: number;

  /** Seconds of shoot pose left, counted down by combat. 0 means not
   *  shooting. Same shape as the enemy's `dying`: a timer the renderer reads,
   *  so the view owns no state of its own. */
  shooting: number;
}

export function createPlayer(): Player {
  return {
    x: 0,
    z: ROOM_DEPTH / 2 - 2,
    facing: 0,
    throttle: 0,
    hp: PLAYER_HP,
    fireCooldown: 0,
    shooting: 0,
  };
}

/** Move the player based on input direction and delta time. */
export function movePlayer(
  player: Player,
  dirX: number,
  dirZ: number,
  dt: number,
  obstacles: Obstacle[],
): void {
  if (dirX !== 0 || dirZ !== 0) {
    player.facing = Math.atan2(dirX, dirZ);
  }
  player.throttle = Math.hypot(dirX, dirZ);
  player.x += dirX * PLAYER_SPEED * dt;
  player.z += dirZ * PLAYER_SPEED * dt;
  pushOutOfObstacles(player, PLAYER_RADIUS, obstacles);
  clampToRoom(player, PLAYER_RADIUS);
}
