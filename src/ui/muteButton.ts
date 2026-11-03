import { Circle, Container, Graphics } from "pixi.js";

const SIZE = 36;
const MARGIN = 16;
/** Vertical centre: level with the HUD's progress bar, which is 26 px tall at
 *  the same margin. Top-left corner, asked for — the bar is centred and at
 *  least 74 px of clear screen is left of it at the narrowest viewport, so
 *  the two never meet. */
const CENTRE_Y = MARGIN + 13;

/**
 * Mute toggle.
 *
 * Its own widget rather than part of `Hud`, because the HUD is handed numbers
 * and draws them — it has no handlers and nothing it owns can be tapped.
 * This has exactly one job and one event.
 *
 * Networks expect sound to be mutable and expect nothing to play before the
 * first tap. The tutorial's first-input gesture covers the second; this is
 * the first. The state is not persisted: the Google build forbids
 * localStorage, and muting is a per-impression choice anyway.
 *
 * Top-left, where the user asked for it; the points counter has the right.
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
    // A drawn shape is a poor tap target on a phone: the hit area is a circle
    // wider than the button, which is what a thumb actually lands on.
    this.hitArea = new Circle(0, 0, SIZE / 2 + 6);
    this.on("pointertap", () => {
      this.muted = !this.muted;
      this.draw();
      this.onToggle(this.muted);
    });

    this.draw();
  }

  /** Called from onResize only. Scaled with the rest of the HUD so rotating
   *  moves it without resizing it. */
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

    // Drawn, not typed: an icon font is bytes the cap cannot spare and an
    // emoji renders differently on every platform.
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

    // Two bars rather than arcs: an arc continues the path the cone left
    // open and draws a stray line across the button to reach its start.
    glyph
      .roundRect(4.5, -3, 2.4, 6, 1.2)
      .roundRect(9, -6.5, 2.4, 13, 1.2)
      .fill({ color: 0xffffff });
  }
}
