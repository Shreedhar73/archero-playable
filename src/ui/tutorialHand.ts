import { Container, Graphics } from "pixi.js";

/** Seconds for one full figure-8. Slow enough to read as an instruction. */
const PERIOD = 2.6;

/** Lissajous: x on the fundamental, y on the second harmonic. The 1:2 ratio
 *  is what makes a figure-8 rather than an ellipse. */
const SPAN_X = 0.17;
const SPAN_Y = 0.07;

/**
 * The tutorial hand: a pointer tracing a figure-8 over the joystick, which is
 * the brief's first stage. Drawn rather than loaded — a sprite would cost
 * bundle bytes for something on screen for two seconds.
 */
export class TutorialHand extends Container {
  private readonly hand = new Graphics();
  private readonly halo = new Graphics();
  private time = 0;
  private originX = 0;
  private originY = 0;
  private spanX = 60;
  private spanY = 24;

  constructor() {
    super();

    // Ripple at the fingertip, which is the origin: the hand points at the
    // stick, so that is where the press reads from.
    this.halo
      .circle(0, 0, 30)
      .fill({ color: 0xffffff, alpha: 0.18 })
      .circle(0, 0, 30)
      .stroke({ color: 0xffffff, width: 2.5, alpha: 0.55 });

    // Outline pass first, fill pass second. Stroking and filling each
    // rectangle in turn draws the outline *between* the pieces too, which is
    // what turns three rounded rects into a seamed blob instead of a hand.
    const parts = (g: Graphics): Graphics =>
      g
        .roundRect(-7, 0, 14, 30, 7) // index finger, tip at the origin
        .roundRect(-11, 20, 38, 35, 14) // palm with the other fingers folded
        .roundRect(-21, 31, 15, 12, 6); // thumb
    parts(this.hand).stroke({ width: 5, color: 0x24341a, join: "round" });
    parts(this.hand).fill(0xfdfdfd);

    // Knuckle creases: two short lines are the difference between a mitten
    // and a closed hand.
    this.hand
      .moveTo(7, 25)
      .lineTo(7, 33)
      .moveTo(16, 26)
      .lineTo(16, 34)
      .stroke({ width: 2, color: 0x24341a, alpha: 0.45, cap: "round" });

    this.hand.rotation = -0.28;

    this.addChild(this.halo);
    this.addChild(this.hand);
  }

  /** Centred on the joystick, so the gesture is shown where it is performed. */
  layout(w: number, h: number, joystickX: number, joystickY: number): void {
    this.originX = joystickX;
    this.originY = joystickY;
    this.spanX = w * SPAN_X;
    this.spanY = h * SPAN_Y;
  }

  advance(dt: number): void {
    this.time += dt;
    const phase = (this.time / PERIOD) * Math.PI * 2;
    const x = this.originX + Math.sin(phase) * this.spanX;
    const y = this.originY + Math.sin(phase * 2) * this.spanY;
    this.hand.position.set(x, y);
    this.halo.position.set(x, y);
    // Halo breathes on the same clock, so the gesture reads as a press that
    // is being dragged rather than a cursor drifting.
    const pulse = 0.85 + Math.sin(phase * 2) * 0.15;
    this.halo.scale.set(pulse);
  }
}
