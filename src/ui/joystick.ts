import { Container, FederatedPointerEvent, Graphics } from "pixi.js";

/**
 * Virtual joystick. Pixi display Ovjects and its pointer handling.
 * Gives game direction vector
 */
export class Joystick extends Container {
  private readonly knob: Graphics;
  private active = false;
  constructor() {
    super();

    const base = new Graphics()
      .circle(0, 0, 70)
      .fill({ color: 0xffffff, alpha: 0.18 });
    this.knob = new Graphics()
      .circle(0, 0, 30)
      .fill({ color: 0xffffff, alpha: 0.5 });
    this.addChild(base);
    this.addChild(this.knob);
  }

  /** Listens for pointer events on the given target container. */
  listenOn(target: Container): void {
    target.on("pointerdown", (event: FederatedPointerEvent) => {
      this.active = true;
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

  private moveKnob(event: FederatedPointerEvent): void {
    const pos = this.toLocal(event.global);
    const vector = joystickVector(pos.x, pos.y, 70);
    this.knob.position.set(vector.knobX, vector.knobY);
  }

  private release(): void {
    this.active = false;
    this.knob.position.set(0, 0);
  }
}

export interface JoystickVector {
  /**-1...1 along x axis on world */
  x: number;
  /** -1...1 along z axis on world */
  z: number;

  knobX: number;
  knobY: number;
}

const out: JoystickVector = { x: 0, z: 0, knobX: 0, knobY: 0 };

export function joystickVector(
  dx: number,
  dy: number,
  radius: number,
): JoystickVector {
  const distance = Math.hypot(dx, dy);
  const scale = distance > radius ? radius / distance : 1;
  out.knobX = dx * scale;
  out.knobY = dy * scale;
  out.x = out.knobX / radius;
  out.z = out.knobY / radius;
  return out;
}
