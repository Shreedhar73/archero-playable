import type { Application } from "pixi.js";

/**
 * Main loop on Pixi's ticker. dt is seconds, clamped so a backgrounded tab
 * doesn't produce a giant step on return.
 */
export function startLoop(app: Application, update: (dt: number) => void): void {
  app.ticker.add((ticker) => {
    update(Math.min(ticker.deltaMS / 1000, 1 / 20));
  });
}
