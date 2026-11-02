import { CanvasSource, Container, Sprite, Texture } from "pixi.js";
import { clamp } from "../engine/math.ts";

/**
 * Pale haze over the land nearest the camera, below the arena's near wall.
 *
 * Pixi rather than `THREE.Fog`: fog fades by distance from the camera and
 * would haze the far wall, not the foreground. Anchored to the projected
 * near wall, so in landscape the band shrinks to nothing on its own.
 */
export class Mist extends Container {
  private readonly near = new Sprite(gradient(1, NEAR_HAZE, NEAR_RAMP));
  /** The matching band behind the gate, flipped and at half strength so the gate stays visible. */
  private readonly far = new Sprite(gradient(0.55, FAR_HAZE, FAR_RAMP));

  /**
   * Everything past where the ramp has finished. The ramp covers a fixed
   * distance of ground, so on a tall viewport it ends above the bottom and
   * this fills the rest.
   */
  private readonly deep = new Sprite(Texture.WHITE);

  constructor() {
    super();
    this.far.scale.y = -1;
    this.deep.tint = NEAR_TINT;
    this.addChild(this.near);
    this.addChild(this.deep);
    this.addChild(this.far);
  }

  /**
   * `nearY` is the projected near wall and `nearEndY` the projected point
   * FOG_DEPTH of ground beyond it.
   */
  layout(
    w: number,
    h: number,
    nearY: number,
    nearEndY: number,
    farY: number,
  ): void {
    const bottom = clamp(nearY, 0, h);
    // Not clamped to `h`: the ramp covers FOG_DEPTH of ground whether or not
    // it fits, and a sprite that runs off the bottom is clipped.
    const end = Math.max(bottom, nearEndY);
    this.near.position.set(0, bottom);
    this.near.width = w;
    this.near.height = Math.max(0, end - bottom);
    this.near.visible = this.near.height > 1;

    this.deep.position.set(0, end);
    this.deep.width = w;
    this.deep.height = Math.max(0, h - end);
    this.deep.visible = this.deep.height > 1;

    // Negative scale draws upwards from the anchor, so the anchor is the wall.
    const top = clamp(farY, 0, h);
    this.far.position.set(0, top);
    this.far.width = w;
    this.far.height = Math.max(0, top);
    this.far.visible = this.far.height > 1;
  }
}

/** Near-white, sampled off the game recording. */
const NEAR_HAZE = "248, 251, 250";
/** The same colour as a Pixi tint, for the solid tail below the ramp. */
const NEAR_TINT = 0xf8fbfa;

/**
 * How far past the near wall the haze takes to finish, in world units of
 * ground rather than a fraction of the screen. Stops sampled off the game
 * recording; anchoring to ground keeps them right at every aspect ratio.
 */
export const FOG_DEPTH = 8.5;
const NEAR_RAMP: [number, number][] = [
  [0, 0],
  [1.7 / FOG_DEPTH, 0.36],
  [3.4 / FOG_DEPTH, 0.55],
  [5.1 / FOG_DEPTH, 0.77],
  [6.7 / FOG_DEPTH, 0.93],
  [1, 1],
];

/** Pale yellow-green: white at any strength bleaches the gate. */
const FAR_HAZE = "226, 240, 200";
const FAR_RAMP: [number, number][] = [
  [0, 0],
  [0.5, 0.46],
  [1, 0.82],
];

/** One pixel wide, 256 tall; the sprite stretches it across the screen. */
function gradient(
  strength: number,
  rgb: string,
  ramp: [number, number][],
): Texture {
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 256;

  const ctx = canvas.getContext("2d");
  if (ctx === null) throw new Error("no 2d canvas context");

  const fade = ctx.createLinearGradient(0, 0, 0, 256);
  for (const [stop, alpha] of ramp) {
    fade.addColorStop(stop, `rgba(${rgb}, ${alpha * strength})`);
  }
  ctx.fillStyle = fade;
  ctx.fillRect(0, 0, 1, 256);

  return new Texture({ source: new CanvasSource({ resource: canvas }) });
}
