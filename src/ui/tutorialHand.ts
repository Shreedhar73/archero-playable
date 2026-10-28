import { Container, Graphics } from "pixi.js";

/** Seconds for one full figure-8. */
const PERIOD = 2.6;

/** Lissajous spans: x on the fundamental, y on the second harmonic gives a figure-8. */
const SPAN_X = 0.17;
const SPAN_Y = 0.07;

/** Tutorial hand tracing a figure-8 over the joystick. Drawn, not loaded, to save bytes. */
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

    // Ripple at the fingertip, which is the origin.
    this.halo
      .circle(0, 0, 30)
      .fill({ color: 0xffffff, alpha: 0.18 })
      .circle(0, 0, 30)
      .stroke({ color: 0xffffff, width: 2.5, alpha: 0.55 });

    // Outline pass first, fill second; stroking each piece in turn would draw seams.
    const parts = (g: Graphics): Graphics =>
      g
        .roundRect(-7, 0, 14, 30, 7) // index finger, tip at the origin
        .roundRect(-11, 20, 38, 35, 14) // palm with the other fingers folded
        .roundRect(-21, 31, 15, 12, 6); // thumb
    parts(this.hand).stroke({ width: 5, color: 0x24341a, join: "round" });
    parts(this.hand).fill(0xfdfdfd);

    // Knuckle creases.
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

  /** Centred on the joystick. */
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
    // Halo breathes on the same clock, so it reads as a dragged press.
    const pulse = 0.85 + Math.sin(phase * 2) * 0.15;
    this.halo.scale.set(pulse);
  }
}
