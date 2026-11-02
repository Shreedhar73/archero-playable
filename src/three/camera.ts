import { MathUtils, PerspectiveCamera, Vector3 } from "three";
import { ROOM_DEPTH, ROOM_WIDTH } from "../config.ts";

/**
 * Camera elevation above the floor. Derived, after two wrong guesses.
 *
 * Measured two independent ways off the recording, which agree:
 *  - A crate at 3x zoom shows a 130px top face over a 115px front face. For a
 *    near-cube that is tan(E) = 130/115, so E = 48.5 degrees.
 *  - The arena covers 96% of screen width and 59% of its height. At 9 units
 *    wide that is 64.3 px a unit, so the depth foreshortens to 12.0 units of
 *    screen — and 12.0 / sin(48.5) is a room 16 deep.
 *
 * 68 was a guess and 78 was worse: it came from one eyeballed crate, and at
 * 78 a tree is a disc, because a cone's circular footprint swallows its own
 * profile when you look almost straight down at it. The reference's trees
 * read as trees, which is what finally gave this away.
 *
 * Anything placed by a world-space Y offset is coupled to this: cos(48.5) is
 * 0.66, so a unit of height now travels two thirds of a unit up the screen
 * where at 78 it travelled a fifth.
 */
const ELEVATION = MathUtils.degToRad(48.5);

/** Headroom for the tallest thing standing in the room. */
const HEADROOM = 1;

const MARGIN = 1.02;

/**
 * Where each wall is allowed to sit on screen, as a fraction of screen height
 * measured from the top, while the camera follows the player.
 *
 * Measured off the real game's own recording rather than chosen: across its
 * 22 seconds the near wall travels between 0.53 and 0.91 of screen height and
 * the far wall between -0.06 (just off the top) and 0.33. The room itself
 * stays 0.58 of the screen throughout, which is also what ours measures — so
 * following is translation inside slack we already have, not a zoom.
 */
const NEAR_WALL_MIN = 0.52;
const NEAR_WALL_MAX = 0.93;
const FAR_WALL_MIN = -0.15;
const FAR_WALL_MAX = 0.33;

/**
 * How far ahead of the player the camera looks, in world units.
 *
 * Positive is towards the near wall, which pushes the player slightly above
 * the middle of the screen — where the reference holds them, because the
 * space that matters is the space they are walking into.
 */
export const CAMERA_LEAD = 0.65;

/**
 * The strip of z the camera's look-at point may occupy, recomputed on every
 * resize. Module state rather than a return value because `frameRoom` and
 * `aimCamera` are two halves of one layout and must not disagree.
 */
const range = { min: 0, max: 0 };

/** Set by frameRoom, read by aimCamera: the two are a fixed orbit radius. */
let distance = 0;

const target = new Vector3();

/** The strip of look-at z the camera may use at the current aspect ratio. */
export function cameraRange(): { min: number; max: number } {
  return range;
}

/**
 * Places the camera so the room fits across the screen, at any aspect ratio,
 * and works out how far it may then travel along z. Moves the camera only —
 * never the game state — so a rotation reframes without restarting.
 */
export function frameRoom(camera: PerspectiveCamera): void {
  const vHalf = MathUtils.degToRad(camera.fov / 2);
  const hHalf = Math.atan(Math.tan(vHalf) * camera.aspect);

  //Across the screen the room is just its width- tilting aroung x leaves the X extent alone.
  // Up the screen, depth foreshortens by sin(elevation) and model height contributes cos(elevation)
  const halfAcross = ROOM_WIDTH / 2;
  const halfUp =
    (ROOM_DEPTH / 2) * Math.sin(ELEVATION) + HEADROOM * Math.cos(ELEVATION);

  distance =
    MARGIN * Math.max(halfAcross / Math.tan(hHalf), halfUp / Math.tan(vHalf));

  // Screen height in world units at the look-at plane. A wall `d` units of z
  // from the look-at point lands `d * sin(ELEVATION) / span` of a screen away
  // from the middle, which is the whole of the arithmetic below.
  const span = 2 * distance * Math.tan(vHalf);
  const half = ROOM_DEPTH / 2;
  const toZ = (fraction: number): number => ((fraction - 0.5) * span) / Math.sin(ELEVATION);

  // Four bounds, two per wall. Each wall has a highest and a lowest place it
  // may sit, and the look-at point has to satisfy all four at once — so the
  // tighter of each pair wins. In landscape the room nearly fills the screen
  // and these collapse to a strip a couple of units wide, which is correct:
  // there is no slack there to travel through.
  const nearMin = half - toZ(NEAR_WALL_MIN);
  const nearMax = half - toZ(NEAR_WALL_MAX);
  const farMin = -half + toZ(1 - FAR_WALL_MIN);
  const farMax = -half + toZ(1 - FAR_WALL_MAX);
  range.max = Math.min(nearMin, farMin);
  range.min = Math.max(nearMax, farMax);
  // A viewport can be short enough that no position satisfies everything.
  // Splitting the difference beats letting min exceed max and clamping a
  // value into an inverted interval.
  if (range.min > range.max) {
    const middle = (range.min + range.max) / 2;
    range.min = middle;
    range.max = middle;
  }

  // Depth precision is dominated by the near plane, and at this distance
  // nothing is anywhere near the camera. Keeping the near/far range tight is
  // what stops the floor and the surround z-fighting. Generous at the far end
  // because the camera now travels towards the near wall, which puts the far
  // wall further away than the framing distance.
  camera.near = distance * 0.4;
  camera.far = distance * 2.4;
  camera.updateProjectionMatrix();
}

/**
 * Points the camera at one spot on the room's centre line. The orbit radius
 * and the elevation never change, so this is a translation: what the player
 * sees slides up and down the room without the arena changing size.
 */
export function aimCamera(camera: PerspectiveCamera, lookZ: number): void {
  target.set(0, 0, lookZ);
  camera.position.set(
    target.x,
    Math.sin(ELEVATION) * distance,
    target.z + Math.cos(ELEVATION) * distance,
  );
  camera.lookAt(target);
}
