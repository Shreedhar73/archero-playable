// Frame-time sample from the running dev server.
//
// Headless Chromium has no GPU: WebGL goes through SwiftShader on the CPU, so
// absolute numbers here are far worse than any real device. What this does
// catch is the shape of the distribution — a long tail means stalls, usually
// allocation and garbage collection, which is device-independent.
import { chromium } from "playwright";

const browser = await chromium.launch({
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
const page = await browser.newPage({ viewport: { width: 420, height: 900 } });
await page.goto("http://localhost:8080", { waitUntil: "load" });
await page.waitForTimeout(1500);
await page.keyboard.press("Shift");
await page.waitForTimeout(2500);

const frames = await page.evaluate(
  () =>
    new Promise((resolve) => {
      const times = [];
      let last = performance.now();
      const tick = (now) => {
        times.push(now - last);
        last = now;
        if (times.length < 240) requestAnimationFrame(tick);
        else resolve(times);
      };
      requestAnimationFrame(tick);
    }),
);

const sorted = [...frames].sort((a, b) => a - b);
const at = (q) => sorted[Math.floor(sorted.length * q)];
const mean = frames.reduce((a, b) => a + b, 0) / frames.length;
console.log(`frames sampled: ${frames.length}`);
console.log(`mean   ${mean.toFixed(1)} ms`);
console.log(`median ${at(0.5).toFixed(1)} ms`);
console.log(`p95    ${at(0.95).toFixed(1)} ms`);
console.log(`worst  ${sorted[sorted.length - 1].toFixed(1)} ms`);
console.log(`ratio worst/median ${(sorted[sorted.length - 1] / at(0.5)).toFixed(2)}x`);

await browser.close();
