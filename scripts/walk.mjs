// Walks the player to both ends of the room with the keyboard and screenshots
// each, so the following camera can be seen moving. shot.mjs only ever
// photographs a standing player.
//
//   npm run dev
//   node scripts/walk.mjs [--out walk] [--dir shots] [--size 603x1311]
//                         [--url http://localhost:8080] [--hold 9000]
//
// --hold is per leg, in milliseconds, and generous: headless Chromium runs
// the game well under real time.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at === -1 ? fallback : args[at + 1];
};

const url = flag("url", "http://localhost:8080");
const out = flag("out", "walk");
const dir = flag("dir", "shots");
const hold = Number(flag("hold", 9000));
const [width, height] = flag("size", "603x1311").split("x").map(Number);
mkdirSync(dir, { recursive: true });

const browser = await chromium.launch({
  args: [
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
    "--ignore-gpu-blocklist",
  ],
});
const page = await browser.newPage({
  viewport: { width, height },
  hasTouch: true,
  isMobile: true,
});
const problems = [];
page.on("console", (m) => {
  if (m.type() === "error") problems.push(m.text());
});
page.on("pageerror", (e) => problems.push(e.message));

await page.goto(url, { waitUntil: "load" });
await page.waitForTimeout(3500);
// A keypress ends the tutorial without dragging the joystick.
await page.keyboard.press("Shift");

const shot = async (name) => {
  const file = `${dir}/${out}-${name}.png`;
  await page.screenshot({ path: file });
  console.log(file);
};

await page.waitForTimeout(600);
await shot("1-start");
await page.keyboard.down("w");
await page.waitForTimeout(hold);
await shot("2-far");
await page.keyboard.up("w");
await page.waitForTimeout(400);
await page.keyboard.down("s");
await page.waitForTimeout(hold * 1.3);
await shot("3-near");
await page.keyboard.up("s");
// Let the camera damping settle.
await page.waitForTimeout(1500);
await shot("4-settled");

if (problems.length > 0) {
  console.log(problems.slice(0, 8).map((p) => `  ${p}`).join("\n"));
}
await browser.close();
