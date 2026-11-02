import { Container, Graphics, Text } from "pixi.js";
import { clamp } from "../engine/math.ts";

/** The player's bar turns red when low; enemy bars are red throughout. */
const FRIENDLY = 0x5fd04a;
const FRIENDLY_LOW = 0xe0503a;
const HOSTILE = 0xe8452f;

const WIDTH = 44;
const HEIGHT = 6;

/** Keeps a bar off the very edge of the frame. */
const INSET = 6;

/** A bar never shrinks below this, in pixels. */
const MIN_WIDTH = 18;

/** How fast the fill closes on the real fraction, per second. */
const DRAIN_RATE = 9;

/**
 * One floating bar per entity, pooled. Pure presentation: handed a screen
 * position and a fraction, knows nothing about what it floats over.
 */
export class HealthBars extends Container {
  /**
   * The player's hit points, printed on index 0 only. `Text.text` rebuilds a
   * glyph texture, so it is written on change rather than every frame.
   */
  private readonly figure: Text;
  private figured = -1;
  private readonly bars: Graphics[] = [];
  private readonly drawn: number[] = [];
  /** Fraction being shown, chasing the real one. `drawn` is what the geometry was last built against. */
  private readonly shown: number[] = [];
  /** Scale factor per slot; the player's figure rides the same one. */
  private readonly sized: number[] = [];
  private screenW = 1;
  private screenH = 1;
  private topLimit = 0;

  constructor(count: number) {
    super();
    this.figure = new Text({
      text: "",
      style: {
        fill: 0xffffff,
        fontSize: 13,
        fontWeight: "900",
        fontFamily: "Arial, Helvetica, sans-serif",
        stroke: { color: 0x14240c, width: 3 },
      },
    });
    this.figure.anchor.set(0.5, 0.5);
    this.figure.visible = false;
    for (let i = 0; i < count; i++) {
      const bar = new Graphics();
      bar.visible = false;
      this.bars.push(bar);
      this.drawn.push(-1);
      this.shown.push(1);
      this.sized.push(1);
      this.addChild(bar);
    }
    // Added last so it sits over the strip it labels.
    this.addChild(this.figure);
  }

  setPlayerHp(hp: number): void {
    const bar = this.bars[0];
    this.figure.visible = bar.visible;
    if (!bar.visible) return;
    const k = this.sized[0];
    this.figure.scale.set(k);
    this.figure.position.set(bar.x + (WIDTH * k) / 2, bar.y + (HEIGHT * k) / 2 - k);
    if (hp === this.figured) return;
    this.figured = hp;
    this.figure.text = `${hp}`;
  }

  /** Called on resize only. `topLimit` keeps bars out from under the HUD. */
  layout(w: number, h: number): void {
    this.screenW = w;
    this.screenH = h;
    this.topLimit = h * 0.08;
  }

  set(
    index: number,
    x: number,
    y: number,
    fraction: number,
    show: boolean,
    hostile: boolean,
    dt: number,
    width: number,
  ): void {
    const bar = this.bars[index];
    bar.visible = show;
    // A respawned slot must not drain down from the last occupant's health.
    if (!show) {
      this.shown[index] = fraction;
      return;
    }

    // Position every frame; rebuild geometry only when the fraction changes.
    // Size by scaling the pooled Graphics so movement costs no tessellation.
    // Clamp to the screen: an enemy on the spawn line projects above the far wall.
    const k = Math.max(width, MIN_WIDTH) / WIDTH;
    this.sized[index] = k;
    bar.scale.set(k);
    const w = WIDTH * k;
    const h = HEIGHT * k;
    // `y` is the head; the bar hangs its bottom edge there.
    bar.position.set(
      clamp(x, w / 2 + INSET, this.screenW - w / 2 - INSET) - w / 2,
      clamp(y, this.topLimit + h, this.screenH - INSET) - h,
    );
    const eased = this.shown[index] + (fraction - this.shown[index]) * (1 - Math.exp(-dt * DRAIN_RATE));
    // Snap within half a pixel so an asymptotic approach stops rebuilding geometry.
    this.shown[index] = Math.abs(fraction - eased) < 1 / WIDTH / 2 ? fraction : eased;

    if (this.shown[index] === this.drawn[index]) return;
    this.drawn[index] = this.shown[index];

    bar
      .clear()
      .roundRect(0, 0, WIDTH, HEIGHT, HEIGHT / 2)
      .fill({ color: 0x000000, alpha: 0.5 })
      .roundRect(0, 0, WIDTH * this.shown[index], HEIGHT, HEIGHT / 2)
      .fill({
        color: hostile ? HOSTILE : fraction > 0.3 ? FRIENDLY : FRIENDLY_LOW,
      });
  }
}
