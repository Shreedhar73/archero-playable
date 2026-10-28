/**
 * Converts the Mixamo FBX downloads in assets/raw/ into the .glb files the
 * archer build reads. Mixamo exports FBX only; everything downstream here
 * speaks glTF.
 *
 * The conversion runs in headless Chromium, not in Node. three ships both
 * halves of it (FBXLoader, GLTFExporter), but an FBX with embedded textures —
 * which every "With Skin" character download is — hands its images to
 * ImageLoader, and GLTFExporter reads them back off the decoded Image. Node
 * has neither, so the Node path converts the geometry and drops every texture
 * without saying so. A browser has both, and Chromium is already a devDep for
 * screenshots.
 *
 * The outputs are intermediates, not sources: the clips end up inside
 * assets/archer_playable.glb, so they are regenerated rather than kept.
 *
 *   npm run convert                     # every source below, one browser
 *   node scripts/fbx-to-glb.mjs "in.fbx" out.glb
 */
import { writeFileSync } from "node:fs";
import { basename, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createServer } from "vite";
import { extractTextures } from "./extract-fbx-textures.mjs";

const assets = fileURLToPath(new URL("../assets/raw/", import.meta.url));

/** Every derived .glb, and the download it comes from. */
const SOURCES = [
  ["Standing Idle.fbx", "anim_idle.glb"],
  ["Running.fbx", "anim_run.glb"],
  ["Standing Aim Recoil.fbx", "anim_shoot.glb"],
  ["Standing Death Left 01.fbx", "anim_dead.glb"],
  ["Erika Archer With Bow Arrow.fbx", "erika_bow.glb"],
];

/**
 * The one texture the archer build needs, and the download holding it.
 * Mixamo buries its textures in FBX `Content` records that FBXLoader does not
 * unpack, so they come out separately — see extract-fbx-textures.mjs.
 */
const TEXTURE = {
  from: "Erika Archer With Bow Arrow.fbx",
  name: "Bow_DIFF.jpg",
  dir: `${assets}erika-textures/`,
};

/**
 * Converts every pair through ONE browser and ONE dev server. Launching
 * Chromium per file costs more than all five conversions put together.
 */
async function convert(jobs) {
  const root = process.cwd();
  const server = await createServer({ root, server: { port: 0 }, logLevel: "warn" });
  await server.listen();
  const port = server.config.server.port ?? server.httpServer?.address()?.port;
  const browser = await chromium.launch();

  try {
    for (const [input, output] of jobs) {
      // Served rather than read: the page fetches the FBX itself, so the
      // loader can resolve embedded media against a real URL.
      const url = `/${relative(root, resolve(input)).split("/").map(encodeURIComponent).join("/")}`;
      const page = await browser.newPage();
      const problems = [];
      page.on("pageerror", (error) => problems.push(error.message));
      await page.goto(
        `http://localhost:${port}/scripts/convert-fbx.html?src=${encodeURIComponent(url)}`,
      );
      // A 25 MB character with 4k textures is slow to parse under SwiftShader.
      await page.waitForFunction(() => window.__result !== undefined, null, { timeout: 180000 });
      const result = await page.evaluate(() => window.__result);
      await page.close();
      if (result.error) throw new Error(`${basename(input)}: ${result.error}`);

      const glb = Buffer.from(result.glb, "base64");
      writeFileSync(output, glb);
      console.log(
        `  ${basename(output).padEnd(16)} ${(glb.byteLength / 1024).toFixed(0).padStart(5)} KB  ` +
          `from ${basename(input)}` +
          `  clips ${result.clips.map((c) => c.name).join("/") || "none"}`,
      );
      if (problems.length > 0) console.log(`    page errors: ${problems.join("; ")}`);
    }
  } finally {
    await browser.close();
    await server.close();
  }
}

const args = process.argv.slice(2);
if (args[0] === "--all") {
  await convert(SOURCES.map(([from, to]) => [`${assets}${from}`, `${assets}${to}`]));

  const { mkdirSync } = await import("node:fs");
  mkdirSync(TEXTURE.dir, { recursive: true });
  const texture = extractTextures(`${assets}${TEXTURE.from}`).find(
    (entry) => entry.name === TEXTURE.name,
  );
  if (!texture) throw new Error(`${TEXTURE.from} has no ${TEXTURE.name}`);
  writeFileSync(`${TEXTURE.dir}${TEXTURE.name}`, texture.bytes);
  console.log(
    `  ${TEXTURE.name.padEnd(16)} ${(texture.bytes.length / 1024).toFixed(0).padStart(5)} KB  ` +
      `from ${TEXTURE.from}`,
  );
} else {
  const [input, output] = args;
  if (!input || !output) {
    console.error('usage: node scripts/fbx-to-glb.mjs "<in.fbx>" <out.glb>   (or --all)');
    process.exit(1);
  }
  await convert([[input, output]]);
}
