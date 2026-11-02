import { CanvasSource, Container, Sprite, Texture } from "pixi.js";
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
export class Mist extends Container {
  private readonly near = new Sprite(gradient(1));
  /**
   * The matching band at the far end.
   *
   * The reference hazes both edges, not one: beyond the gate its land fades
   * to pale before the screen does. We only ever had the near band, so the
   * far end stopped at a hard line of flat green under the HUD. Same
   * gradient at just over half strength, flipped, anchored behind the gate
   * rather than at the wall — at full strength it bleached the gate itself,
   * which is the one landmark the far end has.
   */
  private readonly far = new Sprite(gradient(0.55));

  constructor() {
    super();
    this.far.scale.y = -1;
    this.addChild(this.near);
    this.addChild(this.far);
  }

  layout(w: number, h: number, nearY: number, farY: number): void {
    const bottom = clamp(nearY, 0, h);
    this.near.position.set(0, bottom);
    this.near.width = w;
    this.near.height = Math.max(0, h - bottom);
    // Nothing to haze when the near wall is already off the bottom.
    this.near.visible = this.near.height > 1;

    // Flipped, so its transparent end meets the wall and its solid end runs
    // off the top of the screen. A negative scale means the sprite is drawn
    // upwards from its anchor, so the anchor is the wall itself.
    const top = clamp(farY, 0, h);
    this.far.position.set(0, top);
    this.far.width = w;
    this.far.height = Math.max(0, top);
    this.far.visible = this.far.height > 1;
  }
}

/**
 * One pixel wide and 256 tall: the sprite stretches it across the screen, and
 * a gradient has nothing to say horizontally. Drawn into a canvas because the
 * bundle is base64 under a 5 MB cap and a procedural texture costs only the
 * code that draws it.
 */
function gradient(strength: number): Texture {
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 256;

  const ctx = canvas.getContext("2d");
  if (ctx === null) throw new Error("no 2d canvas context");

  const fade = ctx.createLinearGradient(0, 0, 0, 256);
  // Transparent at the wall, almost solid at the bottom edge. Never fully
  // solid: a hard stop reads as a band of paint rather than as distance.
  // Green, not white, and weaker than it was. The reference's haze is a pale
  // yellow-green that trees stay visibly green inside; ours was near-white by
  // the bottom edge and bleached every prop in it to grey.
  fade.addColorStop(0, "rgba(206, 228, 172, 0)");
  fade.addColorStop(0.5, `rgba(214, 233, 183, ${0.46 * strength})`);
  fade.addColorStop(1, `rgba(226, 240, 200, ${0.82 * strength})`);
  ctx.fillStyle = fade;
  ctx.fillRect(0, 0, 1, 256);

  // Wrapped in its source explicitly rather than through Texture.from, so
  // nothing here depends on that helper's resolution rules.
  return new Texture({ source: new CanvasSource({ resource: canvas }) });
}
