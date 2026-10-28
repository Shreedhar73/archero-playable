import { MathUtils, PerspectiveCamera, Vector3 } from "three";
import { ROOM_DEPTH, ROOM_WIDTH } from "../config.ts";

/**
 * Camera elevation above the floor. Steep, because depth foreshortens by
 * sin(ELEVATION): at 55 degrees a 12-deep room covers only 9.8 units of screen
 * and the arena reads square, at 68 it covers 11.1 and reads like the
 * reference. Still short of straight down, so models keep a silhouette.
 */
const ELEVATION = MathUtils.degToRad(68);

/** Headroom for the tallest thing standing in the room. */
const HEADROOM = 1;

const MARGIN = 1.02;

/**
 * Places the camera so the whole room fits, at any aspect ratio. Moves the camera only- never the game state -
 * so a rotation, reframes with restarting
 */
export function frameRoom(camera: PerspectiveCamera): void {
  const vHalf = MathUtils.degToRad(camera.fov / 2);
  const hHalf = Math.atan(Math.tan(vHalf) * camera.aspect);

  //Across the screen the room is just its width- tilting aroung x leaves the X extent alone.
  // Up the screen, depth foreshortens by sin(elevation) and model height contributes cos(elevation)
  const halfAcross = ROOM_WIDTH / 2;
  const halfUp =
    (ROOM_DEPTH / 2) * Math.sin(ELEVATION) + HEADROOM * Math.cos(ELEVATION);

  const distance =
    MARGIN * Math.max(halfAcross / Math.tan(hHalf), halfUp / Math.tan(vHalf));
  // Portrait leaves vertical slack that no tilt removes. Spend it the way the
  // reference does: a thin strip above for the HUD, a deep one below for the
  // joystick, rather than splitting it evenly into two dead bands.
  const visibleUp = 2 * distance * Math.tan(vHalf);
  const slack = Math.max(0, visibleUp - 2 * halfUp);
  const bias = (slack * 0.3) / Math.sin(ELEVATION);

  const target = new Vector3(0, 0, bias);
  camera.position.set(
    target.x,
    Math.sin(ELEVATION) * distance,
    target.z + Math.cos(ELEVATION) * distance,
  );
  camera.lookAt(target);
  // Depth precision is dominated by the near plane, and at this distance
  // nothing is anywhere near the camera. Keeping the near/far range tight is
  // what stops the floor and the surround z-fighting.
  camera.near = distance * 0.5;
  camera.far = distance * 2;
  camera.updateProjectionMatrix();
}
