import { CanvasSource, Sprite, Texture } from "pixi.js";
import { clamp } from "../engine/math.ts";

/**
 * The pale haze the reference lays over the land nearest the camera, below
 * the arena's near wall.
 *
 * It is drawn in Pixi rather than with `THREE.Fog` because fog fades by
 * distance from the camera and this band is at the *near* edge: fog would
 * haze the far wall and leave the foreground sharp, which is backwards. A
 * screen-space gradient also costs one quad instead of a per-fragment term on
 * every material in the scene.
 *
 * Anchored to the projected near wall, so landscape needs no second code
 * path: the wall sits close to the bottom of the screen there and the band
 * shrinks to nothing on its own.
 */
export class Mist extends Sprite {
  constructor() {
    super(gradient());
  }

  layout(w: number, h: number, topY: number): void {
    const top = clamp(topY, 0, h);
    this.position.set(0, top);
    this.width = w;
    this.height = Math.max(0, h - top);
    // Nothing to haze when the near wall is already off the bottom.
    this.visible = this.height > 1;
  }
}

/**
 * One pixel wide and 256 tall: the sprite stretches it across the screen, and
 * a gradient has nothing to say horizontally. Drawn into a canvas because the
 * bundle is base64 under a 5 MB cap and a procedural texture costs only the
 * code that draws it.
 */
function gradient(): Texture {
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 256;

  const ctx = canvas.getContext("2d");
  if (ctx === null) throw new Error("no 2d canvas context");

  const fade = ctx.createLinearGradient(0, 0, 0, 256);
  // Transparent at the wall, almost solid at the bottom edge. Never fully
  // solid: a hard stop reads as a band of paint rather than as distance.
  fade.addColorStop(0, "rgba(228, 238, 208, 0)");
  fade.addColorStop(0.45, "rgba(230, 240, 212, 0.62)");
  fade.addColorStop(1, "rgba(236, 244, 220, 0.93)");
  ctx.fillStyle = fade;
  ctx.fillRect(0, 0, 1, 256);

  // Wrapped in its source explicitly rather than through Texture.from, so
  // nothing here depends on that helper's resolution rules.
  return new Texture({ source: new CanvasSource({ resource: canvas }) });
}
