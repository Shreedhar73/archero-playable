import { Container, FederatedPointerEvent, Graphics } from "pixi.js";
import { joystickVector } from "../input/joystick.ts";
import { clamp } from "../engine/math.ts";

/** Ring radius in the widget's own units; the container is scaled for screen size. */
const RADIUS = 70;

/** How far past the ring the knob may travel. Visual only. */
const REACH = RADIUS * 1.3;

const GLOW = RADIUS * 1.2;
const KNOB = RADIUS * 0.44;

/**
 * Virtual joystick: Pixi display objects and pointer handling, producing a
 * direction vector. Floating: the base jumps to where the thumb lands. `home`
 * is where it waits before the first touch and where the tutorial hand circles.
 */
export class Joystick extends Container {
  private readonly knob: Graphics;
  private active = false;
  private homeX = 0;
  private homeY = 0;
  private screenW = 1;
  private screenH = 1;
  readonly direction = { x: 0, z: 0 };

  get dragging(): boolean {
    return this.active;
  }

  constructor() {
    super();

    // Drawn once: ring, halo, four chevrons.
    const base = new Graphics();
    base.circle(0, 0, GLOW).stroke({ color: 0x7fe3ff, width: 7, alpha: 0.22 });
    base.circle(0, 0, RADIUS).fill({ color: 0xffffff, alpha: 0.13 });
    base.circle(0, 0, RADIUS).stroke({ color: 0xffffff, width: 3, alpha: 0.34 });
    for (let i = 0; i < 4; i++) {
      const angle = (i * Math.PI) / 2;
      chevron(base, angle, RADIUS * 0.74);
    }

    this.knob = new Graphics();
    this.knob.circle(0, 0, KNOB * 1.25).fill({ color: 0x7fe3ff, alpha: 0.3 });
    this.knob.circle(0, 0, KNOB).fill({ color: 0x1668d8 });
    this.knob.circle(0, -KNOB * 0.22, KNOB * 0.6).fill({ color: 0x4ea4f5, alpha: 0.5 });

    this.addChild(base);
    this.addChild(this.knob);
  }

  /** Listens for pointer events on the given target container. */
  listenOn(target: Container): void {
    target.on("pointerdown", (event: FederatedPointerEvent) => {
      this.active = true;
      // Base comes to the thumb, kept inside the screen so the ring is not cropped.
      const edge = GLOW * this.scale.x;
      this.position.set(
        clamp(event.global.x, edge, this.screenW - edge),
        clamp(event.global.y, edge, this.screenH - edge),
      );
      this.moveKnob(event);
    });
    target.on("pointermove", (event: FederatedPointerEvent) => {
      if (this.active) {
        this.moveKnob(event);
      }
    });
    target.on("pointerup", () => this.release());
    target.on("pointerupoutside", () => this.release());
    target.on("pointercancel", () => this.release());
  }

  /** Home position. Called from resize only; a live drag is not moved. */
  place(x: number, y: number, w: number, h: number): void {
    this.homeX = x;
    this.homeY = y;
    this.screenW = w;
    this.screenH = h;
    if (!this.active) this.position.set(x, y);
  }

  private moveKnob(event: FederatedPointerEvent): void {
    const pos = this.toLocal(event.global);
    const vector = joystickVector(pos.x, pos.y, RADIUS, REACH);
    this.knob.position.set(vector.knobX, vector.knobY);
    this.direction.x = vector.x;
    this.direction.z = vector.z;
  }

  private release(): void {
    this.active = false;
    this.knob.position.set(0, 0);
    this.direction.x = 0;
    this.direction.z = 0;
    this.position.set(this.homeX, this.homeY);
  }
}

/** One arrowhead pointing out along `angle`, at `at` units from the centre. */
function chevron(into: Graphics, angle: number, at: number): void {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  // Built in the chevron's own frame (out, across), then rotated.
  const point = (out: number, across: number): [number, number] => [
    cos * out - sin * across,
    sin * out + cos * across,
  ];
  const [tipX, tipY] = point(at + 11, 0);
  const [leftX, leftY] = point(at, -10);
  const [rightX, rightY] = point(at, 10);
  into
    .moveTo(leftX, leftY)
    .lineTo(tipX, tipY)
    .lineTo(rightX, rightY)
    .stroke({ color: 0xffffff, width: 4, alpha: 0.33, join: "round", cap: "round" });
}
