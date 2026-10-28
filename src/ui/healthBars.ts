import { Container, Graphics } from "pixi.js";
import { clamp } from "../engine/math.ts";

/** Friend or foe at a glance, without reading the number. The player's bar
 *  also warns by turning red when low; an enemy bar is red from the start, so
 *  it has nothing left to warn with and does not need to. */
const FRIENDLY = 0x5fd04a;
const FRIENDLY_LOW = 0xe0503a;
const HOSTILE = 0xe8452f;

const WIDTH = 44;
const HEIGHT = 6;

/** Keeps a bar off the very edge of the frame. */
const INSET = 6;

/**
 * One floating bar per entity, pooled like everything else. Pure
 * presentation: it is handed a screen position and a fraction, and knows
 * nothing about what it is floating over.
 */
export class HealthBars extends Container {
  private readonly bars: Graphics[] = [];
  private readonly drawn: number[] = [];
  private screenW = 1;
  private screenH = 1;
  private topLimit = 0;

  constructor(count: number) {
    super();
    for (let i = 0; i < count; i++) {
      const bar = new Graphics();
      bar.visible = false;
      this.bars.push(bar);
      this.drawn.push(-1);
      this.addChild(bar);
    }
  }

  /**
   * Called on resize only. `topLimit` sits below the HUD, so a bar pushed to
   * the top of the frame does not land under the score.
   */
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
  ): void {
    const bar = this.bars[index];
    bar.visible = show;
    if (!show) return;

    // Position every frame, because the entity moves. Rebuild the geometry
    // only when the fraction actually changed — a few times per life, not
    // sixty times a second.
    // An enemy on the spawn line projects its bar above the far wall and out
    // of frame. Clamping keeps it visible and attached to the right body,
    // which beats a bar that is accurate and invisible.
    bar.position.set(
      clamp(x, WIDTH / 2 + INSET, this.screenW - WIDTH / 2 - INSET) - WIDTH / 2,
      clamp(y, this.topLimit, this.screenH - HEIGHT - INSET),
    );
    if (fraction === this.drawn[index]) return;
    this.drawn[index] = fraction;

    bar
      .clear()
      .roundRect(0, 0, WIDTH, HEIGHT, HEIGHT / 2)
      .fill({ color: 0x000000, alpha: 0.5 })
      .roundRect(0, 0, WIDTH * fraction, HEIGHT, HEIGHT / 2)
      .fill({
        color: hostile ? HOSTILE : fraction > 0.3 ? FRIENDLY : FRIENDLY_LOW,
      });
  }
}
