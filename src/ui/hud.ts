import { Container, Graphics, Text } from "pixi.js";
import { ENEMIES_TO_KILL } from "../config.ts";
import { clamp } from "../engine/math.ts";

const BAR_HEIGHT = 26;
const MARGIN = 16;

/**
 * Level progress bar and points counter. The bar is level progress, not health.
 * Layout runs on resize, update every frame; keep them separate.
 */
export class Hud extends Container {
  private readonly points: Text;
  private readonly level: Text;
  private readonly barBack = new Graphics();
  private readonly barFill = new Graphics();
  private barWidth = 200;
  private drawn = -1;

  constructor() {
    super();
    this.points = new Text({
      text: "0",
      style: {
        fill: 0xffffff,
        fontSize: 34,
        fontWeight: "700",
        fontFamily: "Arial, Helvetica, sans-serif",
        stroke: { color: 0x1d2b16, width: 5 },
      },
    });
    this.points.anchor.set(1, 0);

    this.level = new Text({
      text: "Lv.1",
      style: {
        fill: 0xffffff,
        fontSize: 16,
        fontWeight: "900",
        fontFamily: "Arial, Helvetica, sans-serif",
        stroke: { color: 0x4a2f0c, width: 4 },
      },
    });
    this.level.anchor.set(0.5);

    this.addChild(this.barBack);
    this.addChild(this.barFill);
    this.addChild(this.level);
    this.addChild(this.points);
  }

  /** Called from onResize only. Sized off the shorter side so landscape does not stretch it. */
  layout(w: number, h: number, scale: number): void {
    this.barWidth = clamp(Math.min(w, h) * 0.62, 180, 380);
    this.scale.set(scale);
    this.barBack
      .clear()
      .roundRect(0, 0, this.barWidth, BAR_HEIGHT, BAR_HEIGHT / 2)
      .fill({ color: 0x24301a, alpha: 0.72 })
      .roundRect(0, 0, this.barWidth, BAR_HEIGHT, BAR_HEIGHT / 2)
      .stroke({ color: 0x0f1a0a, width: 3, alpha: 0.65 });
    const left = (w / scale - this.barWidth) / 2;
    this.barBack.position.set(left, MARGIN);
    this.barFill.position.set(left, MARGIN);
    this.level.position.set(left + this.barWidth / 2, MARGIN + BAR_HEIGHT / 2);
    this.points.position.set(w / scale - MARGIN, MARGIN - 2);
    // Force the next update to redraw against the new width.
    this.drawn = -1;
  }

  update(points: number, progress: number): void {
    this.points.text = `${points}`;

    if (progress === this.drawn) return;
    this.drawn = progress;

    this.barFill.clear();
    if (progress <= 0) return;
    this.barFill
      .roundRect(
        0,
        0,
        Math.max(BAR_HEIGHT, this.barWidth * progress),
        BAR_HEIGHT,
        BAR_HEIGHT / 2,
      )
      // Amber so it reads as experience, not health. The lighter band gives it roundness.
      .fill({ color: 0xf5a623 })
      .roundRect(
        3,
        3,
        Math.max(BAR_HEIGHT, this.barWidth * progress) - 6,
        BAR_HEIGHT * 0.34,
        BAR_HEIGHT * 0.17,
      )
      .fill({ color: 0xffd27a, alpha: 0.75 });
  }

  /** Kills remaining, for anything that wants to show the goal. */
  static get target(): number {
    return ENEMIES_TO_KILL;
  }
}
