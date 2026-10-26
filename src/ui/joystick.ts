import { Container, FederatedPointerEvent, Graphics } from "pixi.js";
import { joystickVector } from "../input/joystick.ts";

/** Ring radius in the widget's own units. The container is scaled for screen
 *  size, so this stays fixed. */
const RADIUS = 70;

/**
 * Virtual joystick. Pixi display Ovjects and its pointer handling.
 * Gives game direction vector
 */
export class Joystick extends Container {
  private readonly knob: Graphics;
  private active = false;
  readonly direction = { x: 0, z: 0 };

  get dragging(): boolean {
    return this.active;
  }

  constructor() {
    super();

    const base = new Graphics()
      .circle(0, 0, RADIUS)
      .fill({ color: 0xffffff, alpha: 0.18 });
    this.knob = new Graphics()
      .circle(0, 0, RADIUS * 0.43)
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
    this.direction.x = vector.x;
    this.direction.z = vector.z;
  }

  private release(): void {
    this.active = false;
    this.knob.position.set(0, 0);
    this.direction.x = 0;
    this.direction.z = 0;
  }
}
