import { Circle, Container, Graphics } from "pixi.js";

const SIZE = 36;
const MARGIN = 16;
/** Level with the HUD's progress bar, 26 px tall at the same margin. */
const CENTRE_Y = MARGIN + 13;

/**
 * Mute toggle, top-left. Networks expect sound to be mutable from the first
 * frame. State is not persisted: the Google build forbids localStorage.
 */
export class MuteButton extends Container {
  private readonly face = new Graphics();
  private readonly glyph = new Graphics();
  private readonly onToggle: (muted: boolean) => void;
  private muted = false;

  constructor(onToggle: (muted: boolean) => void) {
    super();
    this.onToggle = onToggle;
    this.addChild(this.face);
    this.addChild(this.glyph);

    this.eventMode = "static";
    this.cursor = "pointer";
    // Hit area wider than the drawn button, for thumbs.
    this.hitArea = new Circle(0, 0, SIZE / 2 + 6);
    this.on("pointertap", () => {
      this.muted = !this.muted;
      this.draw();
      this.onToggle(this.muted);
    });

    this.draw();
  }

  /** Called from onResize only. Scaled with the rest of the HUD. */
  layout(_w: number, _h: number, scale: number): void {
    this.scale.set(scale);
    this.position.set((MARGIN + SIZE / 2) * scale, CENTRE_Y * scale);
  }

  private draw(): void {
    this.face
      .clear()
      .circle(0, 0, SIZE / 2)
      .fill({ color: 0x0b1208, alpha: 0.5 })
      .circle(0, 0, SIZE / 2)
      .stroke({ color: 0xffffff, alpha: 0.35, width: 1.5 });

    // Drawn, not typed: an icon font costs bytes and an emoji differs per platform.
    const glyph = this.glyph
      .clear()
      .poly([-9, -3.5, -4.5, -3.5, 0.5, -8.5, 0.5, 8.5, -4.5, 3.5, -9, 3.5])
      .fill({ color: 0xffffff });

    if (this.muted) {
      glyph
        .moveTo(4.5, -5)
        .lineTo(11.5, 5)
        .stroke({ color: 0xffffff, width: 2.2 })
        .moveTo(11.5, -5)
        .lineTo(4.5, 5)
        .stroke({ color: 0xffffff, width: 2.2 });
      return;
    }

    // Bars, not arcs: an arc would continue the open path and draw a stray line.
    glyph
      .roundRect(4.5, -3, 2.4, 6, 1.2)
      .roundRect(9, -6.5, 2.4, 13, 1.2)
      .fill({ color: 0xffffff });
  }
}
