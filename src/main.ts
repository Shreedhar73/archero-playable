import { Application } from "pixi.js";
import { adapter } from "@network";
import { startLoop } from "./engine/loop.ts";
import { onResize } from "./engine/resize.ts";
import { WorldScene } from "./three/world.ts";

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

  const world = new WorldScene();

  const app = new Application();
  await app.init({ resizeTo: window, backgroundAlpha: 0, antialias: true });
  app.canvas.id = "ui";
  document.body.appendChild(app.canvas);

  onResize((w, h) => {
    world.resize(w, h);
    // TODO: re-position UI elements
  });

  startLoop(app, () => {
    // TODO: update game state, then let the renderers read it
    world.render();
  });
}

void boot();
