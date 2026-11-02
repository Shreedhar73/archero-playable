/**
 * Player state.
 * Plain data by design: No Pixi, No Three, no DOM. - the
 * renderers read this, never the other way around. The game loop updates this, and the renderers read this.
 */

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
  /** Player, Height is constant so Y is not stored, x and z are stored for movement and collision detection. */
  x: number;
  z: number;
  facing: number;

  /** 0 at rest, 1 at full tilt. Drives the animation blend. Not a speed -
   * PLAYER_SPEED is units per secondl this is a fraction of it
   */

  throttle: number;

  /**
   * Current velocity, units per second. Separate from the input direction
   * because the two are no longer the same thing: the stick says where to go,
   * this says where the body is actually going, and the gap between them is
   * what makes a turn read as a turn rather than as teleporting sideways.
   */
  vx: number;
  vz: number;

  /** Hit points. Reaching 0 ends the gameplay stage. */
  hp: number;

  /**
   * Seconds of hit flash left, and how much the hit that started it took.
   *
   * Same shape as the enemy's `hitFlash`, and for the same reason: feedback
   * is a timer the renderers read, not an event they subscribe to. The
   * amount is here because the player can be hit by two things for two
   * different numbers, where every arrow the player fires does ARROW_DAMAGE.
   */
  hitFlash: number;
  lastDamage: number;

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
    // On the arena's near line, not two units up the field. The reference
    // frame spawns its hero with the marker ring's bottom touching the coral
    // border, and `clampToRoom` already stops a body exactly here — so this
    // is the limit of the room rather than a number chosen next to it.
    z: ROOM_DEPTH / 2 - PLAYER_RADIUS,
    // Looking up the arena, at the end the enemies come from. `facing` is
    // `atan2(dirX, dirZ)`, so 0 is +z — straight at the camera, which is
    // what the hero stood doing through the whole tutorial stage: it only
    // became legible once he had a bow to point the wrong way.
    facing: Math.PI,
    throttle: 0,
    vx: 0,
    vz: 0,
    hitFlash: 0,
    lastDamage: 0,
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
  // Throttle stays the stick's own magnitude, not the body's speed. Combat
  // reads it to decide whether the bow may be drawn, and an archer who keeps
  // firing for the tenth of a second it takes her to stop would be shooting
  // mid-slide — stop-to-shoot has to end the moment the thumb lifts.
  player.throttle = Math.hypot(dirX, dirZ);

  // Exponential approach, so the rate is per second and keeps its meaning
  // when the frame time changes. Braking is quicker than starting: a body
  // that coasts to a halt feels heavy, and this one has to stop on a thumb.
  const rate = player.throttle > 0 ? PLAYER_ACCEL : PLAYER_BRAKE;
  const blend = 1 - Math.exp(-dt * rate);
  player.vx += (dirX * PLAYER_SPEED - player.vx) * blend;
  player.vz += (dirZ * PLAYER_SPEED - player.vz) * blend;
  player.x += player.vx * dt;
  player.z += player.vz * dt;
  pushOutOfObstacles(player, PLAYER_RADIUS, obstacles);
  clampToRoom(player, PLAYER_RADIUS);
}
