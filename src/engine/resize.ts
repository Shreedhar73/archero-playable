/**
 * Layout bus. Register layout functions here; each runs immediately and again
 * on every resize/orientation change. Game state must never live in a layout
 * function — rotation re-layouts, it never restarts the game.
 */
type LayoutFn = (w: number, h: number) => void;

const fns: LayoutFn[] = [];

export function onResize(fn: LayoutFn): void {
  fns.push(fn);
  fn(window.innerWidth, window.innerHeight);
}

window.addEventListener("resize", () => {
  for (const fn of fns) fn(window.innerWidth, window.innerHeight);
});
