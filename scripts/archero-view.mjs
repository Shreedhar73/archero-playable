/**
 * Contact sheet of a merged character: one column per clip, posed at a
 * fraction of its duration. A track count only proves the names matched;
 * whether the retarget looks right needs eyes.
 *
 *   node scripts/archero-view.mjs [glb] [out.png] [t=0.5] [yaw=20] [pitch=8]
 */
import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { chromium } from "playwright";

const ROOT = resolve(import.meta.dirname, "..");

const SRC = process.argv[2] ?? "assets/raw/archero-final-raw.glb";
const OUT = process.argv[3] ?? "shots/archero-clips.png";
const AT = Number(process.argv[4] ?? 0.5);
const YAW = Number(process.argv[5] ?? 20);
/** Camera elevation in degrees. The game's camera sits at 48.5. */
const PITCH = Number(process.argv[6] ?? 8);

const W = 320;
const H = 440;

const PAGE = `<!doctype html>
<meta charset="utf-8">
<script type="importmap">
{"imports":{
  "three":"/node_modules/three/build/three.module.js",
  "three/addons/":"/node_modules/three/examples/jsm/"
}}
</script>
<body style="margin:0;background:#2b3138">
<script type="module">
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";

const PITCH = ${PITCH};
const SRC = ${JSON.stringify("/" + SRC.split("/").map(encodeURIComponent).join("/"))};
const AT = ${AT}, YAW = ${YAW}, W = ${W}, H = ${H};

// Built models are EXT_meshopt_compression; the loader throws without this,
// and an unhandled throw up here reads as the page simply never finishing.
const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(SRC);
const clips = gltf.animations;
const cols = Math.max(clips.length, 1);

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setSize(W * cols, H, false);
renderer.setScissorTest(true);
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x2b3138);
scene.add(new THREE.HemisphereLight(0xffffff, 0x404848, 2.4));
const key = new THREE.DirectionalLight(0xffffff, 1.2);
key.position.set(2, 4, 3);
scene.add(key);
scene.add(gltf.scene);

const mixer = new THREE.AnimationMixer(gltf.scene);
const cam = new THREE.PerspectiveCamera(32, W / H, 0.1, 10000);

// Frame the rest pose once, so every column shares a camera and a difference
// between two columns is the clip rather than the framing.
gltf.scene.updateMatrixWorld(true);
const rest = new THREE.Box3().setFromObject(gltf.scene, true);
const c = rest.getCenter(new THREE.Vector3());
const r = rest.getSize(new THREE.Vector3()).y || 1;
const rad = (YAW * Math.PI) / 180;
const el = (PITCH * Math.PI) / 180;
const dist = r * 2.9;
cam.position.set(
  c.x + Math.sin(rad) * Math.cos(el) * dist,
  c.y + Math.sin(el) * dist,
  c.z + Math.cos(rad) * Math.cos(el) * dist,
);
cam.lookAt(c);

const labels = [];
for (let i = 0; i < cols; i++) {
  const clip = clips[i];
  mixer.stopAllAction();
  if (clip) {
    const action = mixer.clipAction(clip);
    action.play();
    mixer.setTime(clip.duration * AT);
    labels.push(clip.name + " @" + (clip.duration * AT).toFixed(2) + "s");
  } else {
    labels.push("rest pose");
  }
  renderer.setViewport(i * W, 0, W, H);
  renderer.setScissor(i * W, 0, W, H);
  renderer.render(scene, cam);
}

window.__png = renderer.domElement.toDataURL("image/png");
window.__labels = labels;
window.__done = true;
</script>`;

const server = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (path === "/") {
    res.writeHead(200, { "content-type": "text/html" }).end(PAGE);
    return;
  }
  const file = join(ROOT, normalize(path));
  if (!file.startsWith(ROOT)) {
    res.writeHead(403).end();
    return;
  }
  try {
    const body = await readFile(file);
    const type = extname(file) === ".js" ? "text/javascript" : "application/octet-stream";
    res.writeHead(200, { "content-type": type }).end(body);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((ok) => server.listen(0, "127.0.0.1", ok));

// Headless Chromium has no GPU; without SwiftShader the sheet comes out blank.
const browser = await chromium.launch({
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
const page = await browser.newPage();
page.setDefaultTimeout(0);
page.on("pageerror", (e) => console.error("  [page error]", e.message));

await page.goto(`http://127.0.0.1:${server.address().port}/`);
await page.waitForFunction(() => window.__done === true, null, { timeout: 0 });

const png = await page.evaluate(() => window.__png);
const labels = await page.evaluate(() => window.__labels);
await writeFile(join(ROOT, OUT), Buffer.from(png.split(",")[1], "base64"));

await browser.close();
server.close();

console.log(`${SRC} -> ${OUT}`);
console.log("  " + labels.join(" | "));
