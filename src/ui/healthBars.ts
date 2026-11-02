import { Container, Graphics, Text } from "pixi.js";
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
 * How fast a bar's fill closes on the real fraction, per second.
 *
 * A bar that jumps tells you the hit landed; a bar that drains tells you how
 * hard. The reference's do the second, and it costs one number per slot.
 */
const DRAIN_RATE = 9;

/**
 * One floating bar per entity, pooled like everything else. Pure
 * presentation: it is handed a screen position and a fraction, and knows
 * nothing about what it is floating over.
 */
export class HealthBars extends Container {
  /**
   * The player's own hit points, written on the bar.
   *
   * Only the player's: the real game prints a figure on the hero's bar and
   * leaves its enemies with a bare strip, and nine numbers floating over nine
   * bodies would be noise. Index 0 is the player by the pool's own
   * convention. `Text.text` rebuilds a glyph texture, which is why this is
   * written on change rather than every frame — it changes about ten times in
   * a run.
   */
  private readonly figure: Text;
  private figured = -1;
  private readonly bars: Graphics[] = [];
  private readonly drawn: number[] = [];
  /** The fraction being shown, chasing the real one. Separate from `drawn`,
   *  which is what the geometry was last built against. */
  private readonly shown: number[] = [];
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
      this.addChild(bar);
    }
    // Added last so it sits over the strip it labels.
    this.addChild(this.figure);
  }

  /** The number on the player's bar. Separate from `set` because it is the
   *  one bar that carries one, and it is written only when it changes. */
  setPlayerHp(hp: number): void {
    const bar = this.bars[0];
    this.figure.visible = bar.visible;
    if (!bar.visible) return;
    this.figure.position.set(bar.x + WIDTH / 2, bar.y + HEIGHT / 2 - 1);
    if (hp === this.figured) return;
    this.figured = hp;
    this.figure.text = `${hp}`;
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
    dt: number,
  ): void {
    const bar = this.bars[index];
    bar.visible = show;
    // A refilled slot — a respawn, or the pool handing this one to a new body
    // — must not drain down from the last occupant's health.
    if (!show) {
      this.shown[index] = fraction;
      return;
    }

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
    const eased = this.shown[index] + (fraction - this.shown[index]) * (1 - Math.exp(-dt * DRAIN_RATE));
    // Snapped once it is within half a pixel of the target, so a bar that is
    // asymptotically approaching empty stops rebuilding its geometry forever.
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
