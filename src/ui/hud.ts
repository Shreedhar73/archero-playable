import { Container, Graphics, Text } from "pixi.js";
import { ENEMIES_TO_KILL } from "../config.ts";
import { clamp } from "../engine/math.ts";

const BAR_HEIGHT = 18;
const MARGIN = 16;

/**
 * Level progress bar and the points counter.
 *
 * The bar is progress through the level, not health — the player's health is
 * the floating bar over their head. Pure presentation: it is handed numbers
 * and draws them, so nothing here can change the game.
 *
 * Layout is a separate call from update, because layout runs on resize and
 * update runs every frame. Mixing them would rebuild geometry sixty times a
 * second to no effect.
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
        fontSize: 13,
        fontWeight: "700",
        fontFamily: "Arial, Helvetica, sans-serif",
        stroke: { color: 0x5a3b12, width: 3 },
      },
    });
    this.level.anchor.set(0.5);

    this.addChild(this.barBack);
    this.addChild(this.barFill);
    this.addChild(this.level);
    this.addChild(this.points);
  }

  /** Called from onResize only. Sized off the shorter side, so landscape does
   *  not stretch the bar into something that reads as a loading indicator. */
  layout(w: number, h: number, scale: number): void {
    this.barWidth = clamp(Math.min(w, h) * 0.42, 140, 300);
    this.scale.set(scale);
    this.barBack
      .clear()
      .roundRect(0, 0, this.barWidth, BAR_HEIGHT, BAR_HEIGHT / 2)
      .fill({ color: 0x000000, alpha: 0.45 });
    this.barBack.position.set(MARGIN, MARGIN);
    this.barFill.position.set(MARGIN, MARGIN);
    this.level.position.set(MARGIN + this.barWidth / 2, MARGIN + BAR_HEIGHT / 2);
    this.points.position.set(w / scale - MARGIN, MARGIN - 4);
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
      // Amber, so it reads as experience rather than health.
      .fill({ color: 0xf5a623 });
  }

  /** Kills remaining, for anything that wants to show the goal. */
  static get target(): number {
    return ENEMIES_TO_KILL;
  }
}
