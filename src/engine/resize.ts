/**
 * Layout bus. Each registered function runs immediately and again on every
 * resize. Layout functions must not hold or construct game state: rotation
 * re-layouts, it never restarts the game.
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

// Observe the element, not the window: a media query can resize the frame
// without a window resize.
new ResizeObserver(() => {
  const [w, h] = size();
  if (w === 0 || h === 0) return;
  for (const fn of fns) fn(w, h);
}).observe(device);
