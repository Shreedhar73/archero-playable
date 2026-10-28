// Screenshots the running dev server, so visual changes can be checked
// without a human in the loop. Headless Chromium has no GPU, so WebGL is
// rendered by SwiftShader on the CPU: correct output, just slow.
//
//   node scripts/shot.mjs [--url http://localhost:8080] [--wait 4000]
//                         [--size 420x900] [--out name] [--dir shots]
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at === -1 ? fallback : args[at + 1];
};

const url = flag("url", "http://localhost:8080");
const wait = Number(flag("wait", 4000));
const out = flag("out", "shot");
const sizes = flag("size", "420x900")
  .split(",")
  .map((pair) => pair.split("x").map(Number));

const dir = flag("dir", "shots");
mkdirSync(dir, { recursive: true });

const browser = await chromium.launch({
  args: [
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
    "--ignore-gpu-blocklist",
  ],
});

for (const [width, height] of sizes) {
  // --touch reports a coarse pointer, so the desktop phone-frame media query
  // does not apply and the game fills the viewport — which is what a real
  // phone does when it rotates.
  const page = await browser.newPage({
    viewport: { width, height },
    hasTouch: args.includes("--touch"),
    isMobile: args.includes("--touch"),
  });
  const problems = [];
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") {
      problems.push(`${message.type()}: ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));

  await page.goto(url, { waitUntil: "load" });

  // The tutorial stage waits for real input, so a headless run sits on it
  // forever. A keypress ends it without also dragging the joystick, which a
  // synthetic click would. --tutorial keeps the hand on screen.
  if (!args.includes("--tutorial")) {
    await page.waitForTimeout(900);
    await page.keyboard.press("Shift");
  }
  // Assets decode and the first frames render after load; there is no event
  // for "the game is showing something", so this waits a human-ish moment.
  await page.waitForTimeout(wait);

  const file = `${dir}/${out}-${width}x${height}.png`;
  const clip = flag("clip", "");
  await page.screenshot(
    clip === ""
      ? { path: file }
      : (([x, y, w, h]) => ({ path: file, clip: { x, y, width: w, height: h } }))(
          clip.split(",").map(Number),
        ),
  );
  console.log(`${file}`);

  // --rotate WxH: resize mid-run and shoot again. The brief requires that a
  // rotation re-layouts without restarting the game, and the only honest test
  // is to do it to a running game and compare.
  const rotate = flag("rotate", "");
  if (rotate !== "") {
    const [rw, rh] = rotate.split("x").map(Number);
    await page.setViewportSize({ width: rw, height: rh });
    await page.waitForTimeout(1200);
    const rotated = `${dir}/${out}-rotated-${rw}x${rh}.png`;
    await page.screenshot({ path: rotated });
    console.log(`${rotated}`);
  }
  if (problems.length > 0) {
    console.log(problems.slice(0, 12).map((p) => `  ${p}`).join("\n"));
  }
  await page.close();
}

await browser.close();
