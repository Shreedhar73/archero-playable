/** Player state. Plain data: the loop writes it, renderers read it. */

import {
  PLAYER_ACCEL,
  PLAYER_BRAKE,
  PLAYER_HP,
  PLAYER_RADIUS,
  PLAYER_SPEED,
  ROOM_DEPTH,
} from "../config.ts";
import { pushOutOfObstacles } from "./collision.ts";
import type { Obstacle } from "./obstacles.ts";
import { clampToRoom } from "./room.ts";

export interface Player {
  /** Height is constant, so no y. */
  x: number;
  z: number;
  facing: number;

  /** Stick magnitude, 0..1. Drives the animation blend and gates shooting. */
  throttle: number;

  /** Velocity, units per second. Lags the stick so turns ease instead of snapping. */
  vx: number;
  vz: number;

  /** Reaching 0 ends the gameplay stage. */
  hp: number;

  /** Seconds of hit flash left, and the amount of that hit. Melee and arrows
   *  deal different damage, so the renderer cannot infer it. */
  hitFlash: number;
  lastDamage: number;

  /** Seconds until the next arrow. Ticks while moving so stopping fires at once. */
  fireCooldown: number;

  /** Seconds of shoot pose left. 0 means not shooting. */
  shooting: number;

  /** Auto-aim target as a pool index, or -1. Views are per slot, so an index
   *  is what they can act on. */
  target: number;
}

export function createPlayer(): Player {
  return {
    x: 0,
    // On the near edge, where clampToRoom would stop a body anyway.
    z: ROOM_DEPTH / 2 - PLAYER_RADIUS,
    // Facing is atan2(dirX, dirZ): 0 is +z, towards the camera. PI looks up the arena.
    facing: Math.PI,
    throttle: 0,
    vx: 0,
    vz: 0,
    hitFlash: 0,
    lastDamage: 0,
    hp: PLAYER_HP,
    fireCooldown: 0,
    shooting: 0,
    target: -1,
  };
}

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
  // Stick magnitude, not body speed: shooting must stop the moment the thumb lifts.
  player.throttle = Math.hypot(dirX, dirZ);

  // Exponential approach so the rate is frame-rate independent.
  const rate = player.throttle > 0 ? PLAYER_ACCEL : PLAYER_BRAKE;
  const blend = 1 - Math.exp(-dt * rate);
  player.vx += (dirX * PLAYER_SPEED - player.vx) * blend;
  player.vz += (dirZ * PLAYER_SPEED - player.vz) * blend;
  player.x += player.vx * dt;
  player.z += player.vz * dt;
  pushOutOfObstacles(player, PLAYER_RADIUS, obstacles);
  clampToRoom(player, PLAYER_RADIUS);
}
