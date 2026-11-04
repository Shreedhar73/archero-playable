/**
 * Side by side: the reference archer, the hero as built, the hero with its bow
 * flipped. Same clip frame, one camera on the bow hand. This is how
 * `GRIP.mirror` in archero-merge.mjs gets picked; axis matching cannot decide it.
 *
 *   node scripts/archero-compare.mjs [out.png] [yaw=90] [at=0.93]
 */
import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { chromium } from "playwright";
const ROOT = resolve(import.meta.dirname);
const OUT = process.argv[2] ?? "shots/archero-bow-compare.png", YAW = Number(process.argv[3] ?? 90), AT = Number(process.argv[4] ?? 0.93);
const PAGE = `<!doctype html>
<meta charset="utf-8">
<script type="importmap">{"imports":{"three":"/node_modules/three/build/three.module.js","three/addons/":"/node_modules/three/examples/jsm/"}}</script>
<body style="margin:0;background:#2b3138">
<script type="module">
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
const YAW = ${YAW}, AT = ${AT}, W = 440, H = 520;
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setSize(W * 3, H, false);
renderer.setScissorTest(true);
document.body.appendChild(renderer.domElement);
const panels = [
  ["erika", "/assets/raw/archer_playable.glb", null],
  ["hero as built", "/assets/archero_hero.glb", null],
  ["hero flipped", "/assets/archero_hero.glb", Math.PI],
];
for (let i = 0; i < panels.length; i++) {
  const [label, url, flip] = panels[i];
  const g = await loader.loadAsync(url);
  const clip = g.animations.find(a => a.name === "Shoot");
  const mixer = new THREE.AnimationMixer(g.scene);
  mixer.clipAction(clip).play();
  mixer.setTime(clip.duration * AT);
  if (flip !== null) {
    // The bow's limb axis is its own local x; turning about it swaps which
    // side the string sits on without moving the limbs.
    const bow = g.scene.getObjectByName("Bow") ?? g.scene.getObjectByName("SubMesh_0").parent;
    bow.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), flip));
  }
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x2b3138);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x404848, 2.4));
  const key = new THREE.DirectionalLight(0xffffff, 1.2); key.position.set(2, 4, 3); scene.add(key);
  scene.add(g.scene);
  g.scene.updateMatrixWorld(true);
  const hand = new THREE.Vector3();
  g.scene.getObjectByName("mixamorigLeftHand").getWorldPosition(hand);
  const cam = new THREE.PerspectiveCamera(30, W / H, 0.01, 100);
  const yaw = YAW * Math.PI / 180, el = 12 * Math.PI / 180, d = 4.0;
  cam.position.set(hand.x + Math.sin(yaw)*Math.cos(el)*d, hand.y + 0.2 + Math.sin(el)*d, hand.z + Math.cos(yaw)*Math.cos(el)*d);
  cam.lookAt(hand.x, hand.y - 0.15, hand.z);
  renderer.setViewport(i*W, 0, W, H); renderer.setScissor(i*W, 0, W, H);
  renderer.render(scene, cam);
}
window.__png = renderer.domElement.toDataURL("image/png");
window.__done = true;
</script>`;
const server = createServer(async (req,res)=>{const p=decodeURIComponent(new URL(req.url,"http://x").pathname);
  if(p==="/") return void res.writeHead(200,{"content-type":"text/html"}).end(PAGE);
  const f=join(ROOT,normalize(p)); if(!f.startsWith(ROOT)) return void res.writeHead(403).end();
  try{res.writeHead(200,{"content-type":extname(f)===".js"?"text/javascript":"application/octet-stream"}).end(await readFile(f));}catch{res.writeHead(404).end();}});
await new Promise(ok=>server.listen(0,"127.0.0.1",ok));
const browser = await chromium.launch({ args:["--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader"] });
const page = await browser.newPage(); page.setDefaultTimeout(0);
page.on("pageerror",e=>console.error("  [page]",e.message));
await page.goto(`http://127.0.0.1:${server.address().port}/`);
await page.waitForFunction(()=>window.__done===true,null,{timeout:0});
await writeFile(OUT, Buffer.from((await page.evaluate(()=>window.__png)).split(",")[1],"base64"));
await browser.close(); server.close();
console.log("wrote " + OUT + "  erika | hero as built | hero flipped");
