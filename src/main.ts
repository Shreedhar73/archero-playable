import { Application } from "pixi.js";
import { adapter } from "@network";
import { startLoop } from "./engine/loop.ts";
import { onResize } from "./engine/resize.ts";
import { WorldScene } from "./three/world.ts";
import { createPlayer, movePlayer } from "./game/player.ts";
import { keyboardDirection } from "./input/keyboard.ts";
import { Joystick } from "./ui/joystick.ts";

/**
 * Composition root. Two stacked canvases: Three.js world (#world) below,
 * transparent Pixi UI overlay (#ui) above. Game state lives outside the
 * renderers, so a resize/orientation change never restarts the game.
 *
 * CTA: call adapter.cta() from the end card; label is adapter.ctaLabel.
 */
async function boot(): Promise<void> {
  // The network decides when the ad may start (MRAID ready etc.).
  await adapter.ready();

  const player = createPlayer();

  const world = new WorldScene();

  const app = new Application();
  await app.init({ resizeTo: window, backgroundAlpha: 0, antialias: true });
  app.canvas.id = "ui";
  document.body.appendChild(app.canvas);

  const joystick = new Joystick();
  joystick.x = app.screen.width / 2;
  joystick.y = app.screen.height - 150;

  app.stage.addChild(joystick);

  onResize((w, h) => {
    world.resize(w, h);
    app.canvas.width = w;
    app.canvas.height = h;

    // TODO: re-position UI elements
  });

  startLoop(app, (dt) => {
    const dir = keyboardDirection();
    movePlayer(player, dir.x, dir.z, dt);
    world.syncPlayer(player.x, player.z);
    world.render();
  });
}

void boot();
