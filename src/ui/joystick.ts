import { Container, Graphics } from "pixi.js";

export class Joystick extends Container {
  constructor() {
    super();

    const base = new Graphics()
      .circle(0, 0, 70)
      .fill({ color: 0xffffff, alpha: 0.18 });
    this.addChild(base);
  }
}
