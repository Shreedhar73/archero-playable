import { Container, Graphics, Text } from "pixi.js";
import { adapter } from "@network";

const PANEL_WIDTH = 300;
const PANEL_HEIGHT = 330;
const BUTTON_WIDTH = 232;
const BUTTON_HEIGHT = 62;

/**
 * The end card: points gained, the game's logo, and the CTA.
 *
 * The CTA goes through adapter.cta() and uses adapter.ctaLabel — never
 * window.open directly, because each ad network has its own click handling
 * and bypassing it loses the click attribution the network is paid on.
 */
export class EndCard extends Container {
  private readonly dim = new Graphics();
  private readonly panel = new Graphics();
  private readonly logo = new Graphics();
  private readonly logoText: Text;
  private readonly heading: Text;
  private readonly score: Text;
  private readonly button = new Container();
  private readonly buttonFace = new Graphics();
  private readonly buttonLabel: Text;

  constructor() {
    super();
    this.visible = false;

    this.heading = label("", 20, 0xdfe8d2);
    this.score = label("0", 58, 0xffd166);
    // Placeholder. The brief asks for the game's logo; that artwork has to
    // come from the client. Swapping this block for a Sprite is a layout
    // change and nothing more.
    this.logoText = label("LOGO", 24, 0xcfe0bd);
    this.buttonLabel = label(adapter.ctaLabel, 22, 0x26341c);

    this.button.addChild(this.buttonFace);
    this.button.addChild(this.buttonLabel);
    this.button.eventMode = "static";
    this.button.cursor = "pointer";
    this.button.on("pointertap", () => adapter.cta());

    this.addChild(this.dim);
    this.addChild(this.panel);
    this.addChild(this.logo);
    this.addChild(this.logoText);
    this.addChild(this.heading);
    this.addChild(this.score);
    this.addChild(this.button);
  }

  /** Called from onResize. Centres the panel at any aspect ratio. */
  layout(w: number, h: number): void {
    this.dim
      .clear()
      .rect(0, 0, w, h)
      .fill({ color: 0x0b1208, alpha: 0.62 });

    const scale = Math.min(1, (Math.min(w, h) * 0.86) / PANEL_WIDTH);
    const cx = w / 2;
    const cy = h / 2;

    this.panel
      .clear()
      .roundRect(
        cx - (PANEL_WIDTH * scale) / 2,
        cy - (PANEL_HEIGHT * scale) / 2,
        PANEL_WIDTH * scale,
        PANEL_HEIGHT * scale,
        26 * scale,
      )
      .fill({ color: 0x1f2d16, alpha: 0.96 })
      .stroke({ color: 0x8fae74, width: 3 * scale });

    const top = cy - (PANEL_HEIGHT * scale) / 2;
    this.logo
      .clear()
      .roundRect(cx - 90 * scale, top + 26 * scale, 180 * scale, 54 * scale, 14 * scale)
      .fill({ color: 0x3f6b32 });
    place(this.logoText, cx, top + 53 * scale, scale);
    place(this.heading, cx, top + 112 * scale, scale);
    place(this.score, cx, top + 166 * scale, scale);

    this.buttonFace
      .clear()
      .roundRect(
        cx - (BUTTON_WIDTH * scale) / 2,
        top + (PANEL_HEIGHT - 92) * scale,
        BUTTON_WIDTH * scale,
        BUTTON_HEIGHT * scale,
        BUTTON_HEIGHT * scale * 0.5,
      )
      .fill({ color: 0xf5c243 });
    place(
      this.buttonLabel,
      cx,
      top + (PANEL_HEIGHT - 92 + BUTTON_HEIGHT / 2) * scale,
      scale,
    );
  }

  show(points: number, cleared: boolean): void {
    this.heading.text = cleared ? "Level complete" : "Out of health";
    this.score.text = `${points}`;
    this.visible = true;
  }
}

function label(text: string, size: number, fill: number): Text {
  const item = new Text({
    text,
    style: {
      fill,
      fontSize: size,
      fontWeight: "700",
      fontFamily: "Arial, Helvetica, sans-serif",
    },
  });
  item.anchor.set(0.5);
  return item;
}

function place(item: Text, x: number, y: number, scale: number): void {
  item.position.set(x, y);
  item.scale.set(scale);
}
