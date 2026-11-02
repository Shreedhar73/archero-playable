import { MathUtils, OrthographicCamera, Vector3 } from "three";
import { ROOM_DEPTH, ROOM_WIDTH } from "../config.ts";

/**
 * Camera elevation above the floor, measured off the game recording. Anything
 * placed by a world-space Y offset is coupled to this: cos(48.5) is 0.66, so
 * a unit of height travels two thirds of a unit up the screen.
 */
export const ELEVATION = MathUtils.degToRad(48.5);

/**
 * Orthographic, as in the real game: its arena border stays at one x for the
 * whole frame, which a tilted perspective camera cannot do. It also keeps the
 * near end from spilling off the sides when the room is framed by width.
 */

/** Headroom for the tallest thing standing in the room. */
const HEADROOM = 1;

const MARGIN = 1.02;

/**
 * Where each wall may sit on screen while the camera follows, as a fraction of
 * screen height from the top. Measured off the game recording.
 */
const NEAR_WALL_MIN = 0.52;
const NEAR_WALL_MAX = 0.93;
const FAR_WALL_MIN = -0.15;
const FAR_WALL_MAX = 0.33;

/**
 * How far ahead of the player the camera looks, in world units. Positive is
 * towards the near wall, which holds the player a little above screen centre.
 */
export const CAMERA_LEAD = 0.65;

/**
 * The strip of z the look-at point may occupy, recomputed on every resize.
 * Module state because `frameRoom` and `aimCamera` must not disagree.
 */
const range = { min: 0, max: 0 };

/** Set by frameRoom, read by aimCamera. */
let distance = 0;

/** The viewport in CSS pixels. An orthographic camera has no `aspect` of its own. */
const VIEWPORT = { w: 1, h: 1 };

/** Called by `resize` before `frameRoom`, which reads it. */
export function setViewport(w: number, h: number): void {
  VIEWPORT.w = w;
  VIEWPORT.h = h;
}

const target = new Vector3();

/** The strip of look-at z the camera may use at the current aspect ratio. */
export function cameraRange(): { min: number; max: number } {
  return range;
}

/**
 * Fits the room across the screen at any aspect ratio and works out how far
 * the camera may then travel along z. Moves the camera only, never game
 * state, so a rotation reframes without restarting.
 */
export function frameRoom(camera: OrthographicCamera): void {
  // Across the screen the room is just its width. Up the screen, depth
  // foreshortens by sin(elevation) and model height contributes cos(elevation).
  const halfAcross = ROOM_WIDTH / 2;
  const halfUp =
    (ROOM_DEPTH / 2) * Math.sin(ELEVATION) + HEADROOM * Math.cos(ELEVATION);

  // Fit whichever axis is tighter.
  const viewportAspect = VIEWPORT.w / VIEWPORT.h;
  const half = Math.max(halfAcross / viewportAspect, halfUp) * MARGIN;
  camera.top = half;
  camera.bottom = -half;
  camera.right = half * viewportAspect;
  camera.left = -camera.right;

  // Screen height in world units, and the same height measured along z.
  const span = 2 * half;
  const halfDepth = ROOM_DEPTH / 2;
  const screenHalfZ = half / Math.sin(ELEVATION);
  const toZ = (fraction: number): number =>
    ((fraction - 0.5) * span) / Math.sin(ELEVATION);

  // How far the look-at point may move before a wall leaves the screen. When
  // the whole arena fits, the travel is exactly the slack.
  const lift = (HEADROOM * Math.cos(ELEVATION)) / Math.sin(ELEVATION);
  const slack = screenHalfZ - halfDepth - lift;
  if (slack > 0) {
    range.min = -slack;
    range.max = slack;
  } else {
    // Each wall has a highest and lowest allowed place; the tighter of each
    // pair wins. Only reachable in a short landscape viewport.
    const nearMin = halfDepth - toZ(NEAR_WALL_MIN);
    const nearMax = halfDepth - toZ(NEAR_WALL_MAX);
    const farMin = -halfDepth + toZ(1 - FAR_WALL_MIN);
    const farMax = -halfDepth + toZ(1 - FAR_WALL_MAX);
    range.max = Math.min(nearMin, farMin);
    range.min = Math.max(nearMax, farMax);
    if (range.min > range.max) {
      const middle = (range.min + range.max) / 2;
      range.min = middle;
      range.max = middle;
    }
  }

  // Orbit radius changes nothing on screen under a parallel projection; it
  // only has to keep the near and far planes clear of the room and the trees.
  distance = ROOM_DEPTH;
  camera.near = 0.1;
  camera.far = distance * 3;
  camera.updateProjectionMatrix();
}

/**
 * Points the camera at one spot on the room's centre line. Radius and
 * elevation are fixed, so this is a pure translation.
 */
export function aimCamera(camera: OrthographicCamera, lookZ: number): void {
  target.set(0, 0, lookZ);
  camera.position.set(
    target.x,
    Math.sin(ELEVATION) * distance,
    target.z + Math.cos(ELEVATION) * distance,
  );
  camera.lookAt(target);
}
