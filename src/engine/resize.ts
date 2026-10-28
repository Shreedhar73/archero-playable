/**
 * Layout bus. Register layout functions here; each runs immediately and again
 * on every resize/orientation change. Game state must never live in a layout
 * function — rotation re-layouts, it never restarts the game.
 */
import { device } from "./device.ts";

type LayoutFn = (w: number, h: number) => void;

const fns: LayoutFn[] = [];

function size(): [number, number] {
  return [device.clientWidth, device.clientHeight];
}

export function onResize(fn: LayoutFn): void {
  fns.push(fn);
  fn(...size());
}

// Observing the element rather than listening to window resize: the frame can
// change size without the window doing so, when a media query crosses its
// breakpoint or the device rotates into a different rule.
new ResizeObserver(() => {
  const [w, h] = size();
  if (w === 0 || h === 0) return;
  for (const fn of fns) fn(w, h);
}).observe(device);
