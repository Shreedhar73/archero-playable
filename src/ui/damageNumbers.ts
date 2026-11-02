import { Container, Text } from "pixi.js";

/**
 * Floating damage numbers. Pooled per value: assigning `Text.text` rebuilds the
 * glyph texture, so labels are written once at boot and only moved and faded.
 */
const LIFE = 0.7;
/** Upward drift over that life, in layout pixels. */
const RISE = 46;

export class DamageNumbers extends Container {
  private readonly labels: Text[] = [];
  private readonly value: number[] = [];
  private readonly left: number[] = [];
  private readonly driftX: number[] = [];
  private readonly next = new Map<number, number>();
  private readonly perValue: number;

  constructor(values: number[], perValue: number) {
    super();
    this.perValue = perValue;
    for (const amount of values) {
      this.next.set(amount, 0);
      for (let i = 0; i < perValue; i++) {
        const label = new Text({
          text: `-${amount}`,
          style: {
            fill: 0xffffff,
            fontSize: 26,
            fontWeight: "900",
            fontFamily: "Arial, Helvetica, sans-serif",
            stroke: { color: 0x2a1c0e, width: 5 },
          },
        });
        label.anchor.set(0.5, 1);
        label.visible = false;
        this.labels.push(label);
        this.value.push(amount);
        this.left.push(0);
        this.driftX.push(0);
        this.addChild(label);
      }
    }
  }

  /** Round-robin within the value's block. An undeclared amount is dropped, not asserted on. */
  pop(amount: number, x: number, y: number): void {
    const start = this.indexOf(amount);
    if (start < 0) return;
    const slot = this.next.get(amount) ?? 0;
    this.next.set(amount, (slot + 1) % this.perValue);
    const i = start + slot;
    // Sideways scatter so two hits in one place do not stack. Math.random is
    // fine here: nothing in the simulation reads a pixel.
    this.driftX[i] = (Math.random() - 0.5) * 34;
    this.labels[i].position.set(x, y);
    this.left[i] = LIFE;
  }

  advance(dt: number): void {
    for (let i = 0; i < this.labels.length; i++) {
      if (this.left[i] <= 0) continue;
      this.left[i] -= dt;
      const label = this.labels[i];
      const gone = 1 - Math.max(0, this.left[i]) / LIFE;
      label.visible = this.left[i] > 0;
      // Eased out: leaps off the hit, then hangs.
      label.y -= (RISE * dt * (1 - gone) * 2) / LIFE;
      label.x += this.driftX[i] * dt;
      // Opaque for the first half so it can be read.
      label.alpha = Math.min(1, 2 - 2 * gone);
    }
  }

  private indexOf(amount: number): number {
    for (let i = 0; i < this.value.length; i += this.perValue) {
      if (this.value[i] === amount) return i;
    }
    return -1;
  }
}
