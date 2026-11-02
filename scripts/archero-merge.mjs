/**
 * assets/raw/archero-model.glb + four Mixamo clips + a bow -> one raw glb.
 *
 * Same job as `fbx-merge.mjs` does for Erika, against a source that arrives
 * differently and so needs three things that merge did not:
 *
 *  - The model is a Sketchfab export, so every joint is named
 *    `mixamorig:Hips_01` rather than `mixamorig:Hips`. Mixamo's own clips
 *    address `mixamorigHips`, so the suffixes are stripped here; without that
 *    every track targets a node that does not exist and the exporter drops it
 *    silently.
 *  - Its one material is `KHR_materials_pbrSpecularGlossiness`, which three
 *    removed. `GLTFLoader` says "Unknown extension" and renders the character
 *    white, so the conversion to metallic-roughness happens in Node, before
 *    the browser ever sees the file.
 *  - The rig is this character's proportions, not Erika's: a chibi hips sits
 *    at 55.8 where Mixamo's clips were recorded against ~100. Rotations
 *    retarget by name, but a translation key does not — so only the hips
 *    translation survives, scaled by the ratio of the two rest heights, and
 *    every other translation and scale track is dropped. Keeping them would
 *    impose the source rig's bone lengths on this one.
 *
 * The bow is a separate prop here (the model ships unarmed) and is parented to
 * the left hand bone at merge time rather than at runtime, so anything that
 * clones the glb gets the bow for free.
 *
 *   node scripts/archero-merge.mjs
 */
import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { metalRough } from "@gltf-transform/functions";
import { chromium } from "playwright";

const ROOT = resolve(import.meta.dirname, "..");

const SRC = "assets/raw/archero-model.glb";
/** The specular-glossiness conversion and the bone rename, nothing else. */
const BASE = "assets/raw/archero-base.glb";
const BOW = "assets/raw/bow.glb";
const OUT = "assets/raw/archero-final-raw.glb";

// Same four clips the Erika merge uses, and for the same reason: these are the
// only states the game has. FBXLoader names every Mixamo clip `mixamo.com`.
const CLIPS = [
  ["Running", "assets/raw/Running (1).fbx"],
  ["Standing Idle", "assets/raw/Standing Idle.fbx"],
  ["Standing Draw Arrow", "assets/raw/Standing Draw Arrow.fbx"],
  ["Standing Death Left 01", "assets/raw/Standing Death Left 01.fbx"],
];

/**
 * Where the bow sits in the left hand — copied off Erika rather than tuned.
 *
 * Three hand-picked constants lived here and all three were wrong in a way
 * that only showed up in motion. What finally settled it: the clips overwrite
 * every bone's *local* rotation, and a rotation chain does not care about
 * bone lengths, so at any frame of any clip this rig's left hand carries
 * exactly the world orientation Erika's does. Whatever constant she holds her
 * bow at is therefore the constant this prop wants, and hers is right because
 * her bow is skinned into a model the clips were authored around.
 *
 * So the merge measures her: principal axes of her bow's skinned vertices at
 * the Shoot pose give its limb axis and the normal of its plane, and the
 * same axes of this prop give the mapping between them. The lesson paid for
 * twice is that **a bow's plane contains the arrow's path** — the normal
 * points sideways, out of the archer's line of fire, not forwards. Aiming
 * the prop's flat face down the shot direction lays the bow over on its side,
 * which is what it was doing.
 *
 * `mirror` is the one thing the measurement cannot settle. An axis has no
 * direction, so limb-to-limb and aim-to-aim still leaves a half-turn about
 * the limbs — string where the riser should be — and deciding it needs to
 * know which side of this prop the string is on. Erika's bow says that with
 * its geometry (a thin straight run between the tips, the limbs bulging the
 * other way); this one, stylised and 166 vertices, does not: the knob at its
 * centre reads as a riser and points the other way, and every rule written
 * off its vertices picked the wrong side. So the half-turn is a flag, set by
 * putting the two bows side by side at the same frame of the same clip and
 * looking — `.flipcompare` renders exactly that pair.
 *
 * `shootAt` is where in the Shoot clip to measure. Full draw: hand extended,
 * everything about the pose unambiguous. That the copy is exact is checkable
 * rather than argued: posed at that frame, the two rigs' left hands agree on
 * their world orientation to 0.08 degrees.
 *
 * Only the *length* refuses to come across. Erika's bow is 4.8 of her hand
 * bones, and carrying that ratio over gives a bow a third of this character's
 * height, because a chibi's arms are short for his size — the thing the two
 * rigs disagree about is exactly the thing bone lengths measure. So the bow
 * is sized against the body instead: `lengthOfHeight` is what fraction of the
 * character it spans, picked off a contact sheet of candidates, where hers
 * would be 0.76 and that reads as oversized on a body this shape.
 */
const GRIP = {
  bone: "mixamorigLeftHand",
  reference: "assets/archer_playable.glb",
  referenceMaterial: /^bow/i,
  shootAt: 0.9,
  lengthOfHeight: 0.7,
  mirror: true,
};

const MIME = { ".html": "text/html", ".js": "text/javascript", ".fbx": "application/octet-stream" };

const url = (p) => "/" + p.split("/").map(encodeURIComponent).join("/");

/**
 * Sketchfab suffixes every node with its own index — `mixamorig:Hips_01`,
 * `mixamorig:RightUpLeg_00` — and `GLTFLoader` only strips the colon. Mixamo's
 * clips address the sanitized Mixamo name, so both have to go.
 */
const mixamoName = (name) => {
  const m = /^mixamorig:(.+?)(_\d+)?$/.exec(name);
  return m ? "mixamorig" + m[1] : name;
};

/** specGloss -> metalRough, Mixamo bone names, no baked clip. */
async function prepareBase() {
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const doc = await io.read(join(ROOT, SRC));

  const before = doc.getRoot().listExtensionsUsed().map((e) => e.extensionName);
  await doc.transform(metalRough());

  let renamed = 0;
  for (const node of doc.getRoot().listNodes()) {
    const to = mixamoName(node.getName());
    if (to === node.getName()) continue;
    node.setName(to);
    renamed++;
  }

  // The source carries one baked Mixamo clip of its own; the four this game
  // needs are merged in below, and an unnamed fifth would only confuse them.
  const dropped = doc.getRoot().listAnimations().map((a) => (a.dispose(), a.getName()));

  await io.write(join(ROOT, BASE), doc);
  return { before, renamed, dropped };
}

const base = await prepareBase();

const PAGE = `<!doctype html>
<meta charset="utf-8">
<script type="importmap">
{"imports":{
  "three":"/node_modules/three/build/three.module.js",
  "three/addons/":"/node_modules/three/examples/jsm/"
}}
</script>
<script type="module">
import * as THREE from "three";
import { FBXLoader } from "three/addons/loaders/FBXLoader.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";

const BASE = ${JSON.stringify(url(BASE))};
const BOW = ${JSON.stringify(url(BOW))};
const CLIPS = ${JSON.stringify(CLIPS.map(([name, file]) => [name, url(file)]))};
const GRIP = ${JSON.stringify({ ...GRIP, referenceMaterial: GRIP.referenceMaterial.source, reference: url(GRIP.reference) })};

const gltf = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const fbx = new FBXLoader();

const hero = (await gltf.loadAsync(BASE)).scene;
hero.updateMatrixWorld(true);

const skinned = [];
hero.traverse((o) => { if (o.isSkinnedMesh) skinned.push(o); });
const skeleton = skinned[0]?.skeleton;
if (!skeleton) throw new Error("no skinned mesh in " + BASE);
const byName = new Map(skeleton.bones.map((b) => [b.name, b]));

// The rig the clips were recorded against and the rig they are landing on are
// different builds of the same skeleton, so a translation key means a
// different distance in each. This is the number that converts between them.
const restHipsY = byName.get("mixamorigHips")?.position.y;
if (!restHipsY) throw new Error("no mixamorigHips after the rename");

/**
 * Keep every rotation, keep the hips translation rescaled, drop the rest.
 * A rotation is a pose and transfers; a translation or a scale key is the
 * source rig's geometry and would stretch this one's bones to match.
 */
function retarget(clip, ratio) {
  const kept = [];
  const dropped = [];
  for (const track of clip.tracks) {
    const [node, prop] = track.name.split(".");
    if (prop === "quaternion") { kept.push(track); continue; }
    if (prop === "position" && node === "mixamorigHips") {
      const v = track.values;
      for (let i = 0; i < v.length; i++) v[i] *= ratio;
      kept.push(track);
      continue;
    }
    dropped.push(track.name);
  }
  clip.tracks = kept;
  return dropped.length;
}

const report = { restHipsY, clips: [] };

const names = new Set();
hero.traverse((o) => names.add(o.name));

const merged = [];
for (const [name, src] of CLIPS) {
  const scene = await fbx.loadAsync(src);
  const clip = scene.animations[0];
  if (!clip) throw new Error("no animation in " + src);
  clip.name = name;

  const clipHipsY = scene.getObjectByName("mixamorigHips")?.position.y;
  if (!clipHipsY) throw new Error("clip " + name + " has no mixamorigHips rest pose");
  const ratio = restHipsY / clipHipsY;
  const dropped = retarget(clip, ratio);

  const missing = [...new Set(clip.tracks.map((t) => t.name.split(".")[0]).filter((n) => !names.has(n)))];
  merged.push(clip);
  report.clips.push({
    name,
    tracks: clip.tracks.length,
    dropped,
    duration: +clip.duration.toFixed(3),
    clipHipsY: +clipHipsY.toFixed(2),
    ratio: +ratio.toFixed(4),
    missing,
  });
}

// What this character actually measures, posed, and measured before the bow
// goes on so a prop cannot inflate it. The mesh's own POSITION range is not
// it: the skin's inverse bind matrices carry a ~24x scale, so the vertices
// read 6.4 units tall where the skinned result is ~163. The build step needs
// the real number to scale the character into metres.
hero.updateMatrixWorld(true);
skeleton.update();
const box = new THREE.Box3().setFromObject(hero, true);
const size = box.getSize(new THREE.Vector3());
report.posed = { height: size.y, min: box.min.toArray(), max: box.max.toArray() };
hero.userData.posedHeight = size.y;

// The bow rides the hand bone as an ordinary child node: no skin, no weights,
// so it inherits the hand's animated transform and costs one draw call.
const bow = (await gltf.loadAsync(BOW)).scene;
const hand = byName.get(GRIP.bone);
if (!hand) throw new Error("no " + GRIP.bone + " to hang the bow on");
bow.name = "Bow";

/**
 * Limb axis, plane normal, centre and length of a bow, from its vertices.
 * Power iteration on the covariance: the widest spread is along the limbs,
 * the narrowest is across the plane the bow lies in.
 */
function bowAxes(points) {
  const mid = points.reduce((a, p) => a.add(p), new THREE.Vector3()).multiplyScalar(1 / points.length);
  const cov = [[0,0,0],[0,0,0],[0,0,0]];
  for (const p of points) {
    const d = [p.x - mid.x, p.y - mid.y, p.z - mid.z];
    for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) cov[a][b] += d[a] * d[b];
  }
  const mul = (m, x) => new THREE.Vector3(
    m[0][0]*x.x + m[0][1]*x.y + m[0][2]*x.z,
    m[1][0]*x.x + m[1][1]*x.y + m[1][2]*x.z,
    m[2][0]*x.x + m[2][1]*x.y + m[2][2]*x.z,
  );
  const power = (m, seed) => { let x = seed.clone().normalize(); for (let i = 0; i < 200; i++) x = mul(m, x).normalize(); return x; };
  const limb = power(cov, new THREE.Vector3(1, 0.31, 0.17));
  const lambda = mul(cov, limb).dot(limb);
  const rest = cov.map((row, a) => row.map((val, b) => val - lambda * limb.getComponent(a) * limb.getComponent(b)));
  const inPlane = power(rest, new THREE.Vector3(0.19, 1, 0.29));

  let lo = Infinity, hi = -Infinity;
  for (const p of points) {
    const t = p.clone().sub(mid).dot(limb);
    lo = Math.min(lo, t); hi = Math.max(hi, t);
  }
  const length = hi - lo;

  // Power iteration hands back an axis, not a direction — its sign is
  // arbitrary — and a flipped in-plane axis is a bow turned 180 degrees about
  // its own limbs: string where the riser should be, shooting backwards. So
  // the direction is decided by the shape. Near the middle of the limbs the
  // riser stands proud of the string, and it stands proud on the side the
  // arrow leaves towards, so the grip's own offset from the centre is the
  // aim.
  let grip = 0;
  let n = 0;
  for (const p of points) {
    const d = p.clone().sub(mid);
    if (Math.abs(d.dot(limb)) > length * 0.12) continue;
    grip += d.dot(inPlane);
    n++;
  }
  if (!n) throw new Error("no vertices near the grip to take the bow's aim from");
  const aim = inPlane.clone().multiplyScalar(Math.sign(grip / n) || 1);
  const normal = limb.clone().cross(aim).normalize();
  return { mid, limb, aim, normal, length, gripOffset: grip / n };
}

/** Skinned world positions of every vertex of a mesh. */
function skinnedPoints(mesh) {
  const out = [];
  const v = new THREE.Vector3();
  const n = mesh.geometry.getAttribute("position").count;
  for (let i = 0; i < n; i++) {
    mesh.getVertexPosition(i, v);
    out.push(mesh.localToWorld(v.clone()));
  }
  return out;
}

// Erika, posed at full draw, with her bow found by material: this file's node
// names sit one slot off their geometry, so the node called
// "Erika_Archer_Bow_Mesh" is not the bow.
const erika = await gltf.loadAsync(GRIP.reference);
const refShoot = erika.animations.find((a) => a.name === "Shoot");
if (!refShoot) throw new Error("the reference archer has no Shoot clip");
const refMixer = new THREE.AnimationMixer(erika.scene);
refMixer.clipAction(refShoot).play();
refMixer.setTime(refShoot.duration * GRIP.shootAt);
erika.scene.updateMatrixWorld(true);

let refBow = null;
let refHand = null;
erika.scene.traverse((o) => {
  if (o.isSkinnedMesh) {
    const names = Array.isArray(o.material) ? o.material.map((m) => m.name).join("+") : o.material.name;
    if (new RegExp(GRIP.referenceMaterial, "i").test(names)) refBow = o;
  }
  if (o.name === GRIP.bone) refHand = o;
});
if (!refBow || !refHand) throw new Error("no bow mesh or hand bone on the reference archer");

const refAxes = bowAxes(skinnedPoints(refBow));
const refQ = new THREE.Quaternion();
refHand.getWorldQuaternion(refQ);
const refInv = refQ.clone().invert();
const refPos = new THREE.Vector3();
refHand.getWorldPosition(refPos);
const refForeArm = new THREE.Vector3();
erika.scene.getObjectByName("mixamorigLeftForeArm").getWorldPosition(refForeArm);
const refBone = refForeArm.distanceTo(refPos);

// Her axes in the frame of her hand. That frame is the one this rig's hand
// shares at every clip frame, which is what makes the copy exact.
const refLimb = refAxes.limb.clone().applyQuaternion(refInv);
const refAim = refAxes.aim.clone().applyQuaternion(refInv);
const refNormal = refAxes.normal.clone().applyQuaternion(refInv);

// Her aim should come out along the way she is shooting. If it does not, the
// rule above has been fooled by a differently built prop, and the grip it
// would produce is a bow facing backwards — fail rather than ship that.
const facing = new THREE.Vector3(0, 0, 1).applyQuaternion(erika.scene.getWorldQuaternion(new THREE.Quaternion()));
const agrees = refAxes.aim.dot(facing);
if (agrees <= 0) {
  throw new Error("the reference bow's aim came out backwards (dot " + agrees.toFixed(2) + ")");
}
const refMid = refAxes.mid.clone().sub(refPos).applyQuaternion(refInv).divideScalar(refBone);
const refLength = refAxes.length / refBone;

// The prop's own axes, in its own space, so the rotation below is a mapping
// between two measured frames rather than an assumption about either.
const propPoints = [];
bow.updateMatrixWorld(true);
bow.traverse((o) => {
  if (!o.isMesh) return;
  const v = new THREE.Vector3();
  const attr = o.geometry.getAttribute("position");
  for (let i = 0; i < attr.count; i++) propPoints.push(v.fromBufferAttribute(attr, i).clone().applyMatrix4(o.matrixWorld));
});
const propAxes = bowAxes(propPoints);

// Limb to limb, aim to aim: two directions that both bows define the same
// way, so the mapping between the frames cannot come out mirrored.
const from = new THREE.Matrix4().makeBasis(propAxes.limb, propAxes.aim, propAxes.normal);
const to = new THREE.Matrix4().makeBasis(refLimb, refAim, refNormal);
const rotation = new THREE.Quaternion().setFromRotationMatrix(to.multiply(from.invert()));
if (GRIP.mirror) {
  // A half-turn about the prop's own limbs: the limbs stay where they are and
  // the string swaps sides.
  rotation.multiply(new THREE.Quaternion().setFromAxisAngle(propAxes.limb, Math.PI));
}

// Her bow's offset from her hand in bone lengths, which does carry across;
// its length does not, and comes from the body instead.
const handPos = new THREE.Vector3();
hand.getWorldPosition(handPos);
const foreArmPos = new THREE.Vector3();
hero.getObjectByName("mixamorigLeftForeArm").getWorldPosition(foreArmPos);
const bone = foreArmPos.distanceTo(handPos);
const scale = (GRIP.lengthOfHeight * size.y) / propAxes.length;

bow.quaternion.copy(rotation);
bow.scale.setScalar(scale);
// Place the prop by its centre, where hers is, not by its origin — a prop's
// origin is not its handle, and this one's is off to one side.
bow.position
  .copy(refMid.multiplyScalar(bone))
  .sub(propAxes.mid.clone().multiplyScalar(scale).applyQuaternion(rotation));
hand.add(bow);

const euler = new THREE.Euler().setFromQuaternion(rotation);
report.grip = {
  rotation: [euler.x, euler.y, euler.z],
  scale,
  position: bow.position.toArray(),
  length: propAxes.length * scale,
  refLengthInBones: refLength,
  boneLength: bone,
  aimAgrees: agrees,
  gripOffsets: [refAxes.gripOffset, propAxes.gripOffset],
};
report.bow = { verts: (() => { let n = 0; bow.traverse((o) => { if (o.isMesh) n += o.geometry.getAttribute("position").count; }); return n; })() };

const glb = await new GLTFExporter().parseAsync(hero, { binary: true, animations: merged });
window.__glb = new Uint8Array(glb);
window.__report = report;
window.__done = true;
</script>`;

/** Static server over the repo, so the page can fetch three, the glb and the FBX. */
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
    res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((ok) => server.listen(0, "127.0.0.1", ok));

const browser = await chromium.launch();
const page = await browser.newPage();
page.setDefaultTimeout(0);
page.on("console", (m) => console.log("  [page]", m.text()));
page.on("pageerror", (e) => console.error("  [page error]", e.message));

await page.goto(`http://127.0.0.1:${server.address().port}/`);
await page.waitForFunction(() => window.__done === true, null, { timeout: 0 });

const report = await page.evaluate(() => window.__report);
const total = await page.evaluate(() => window.__glb.length);

// Base64 slices of 3 MiB: a multiple of 3, so no padding lands mid-stream.
const CHUNK = 3 << 20;
const parts = [];
for (let off = 0; off < total; off += CHUNK) {
  const b64 = await page.evaluate(([o, n]) => {
    const view = window.__glb.subarray(o, o + n);
    let s = "";
    for (let i = 0; i < view.length; i += 0x8000) {
      s += String.fromCharCode.apply(null, view.subarray(i, i + 0x8000));
    }
    return btoa(s);
  }, [off, CHUNK]);
  parts.push(Buffer.from(b64, "base64"));
}

await browser.close();
server.close();

const bytes = Buffer.concat(parts);
if (bytes.length !== total) throw new Error(`transfer lost bytes: ${bytes.length} of ${total}`);
await writeFile(join(ROOT, OUT), bytes);

console.log(`base   ${SRC} -> ${BASE}`);
console.log(`       ${base.before.join(", ") || "no extensions"} -> metallic-roughness, ${base.renamed} nodes renamed`);
console.log(`       dropped the source's own clip${base.dropped.length === 1 ? "" : "s"}: ${base.dropped.join(", ") || "none"}`);
console.log(`rig    rest hips y ${report.restHipsY.toFixed(2)}, posed height ${report.posed.height.toFixed(1)}`);
console.log(
  `bow    copied off ${GRIP.reference} at Shoot ${GRIP.shootAt}: ` +
    `rotation [${report.grip.rotation.map((v) => v.toFixed(3)).join(", ")}], scale ${report.grip.scale.toFixed(1)}, ` +
    `position [${report.grip.position.map((v) => v.toFixed(2)).join(", ")}]`,
);
console.log(
  `       aim taken from the riser's offset at the grip (hers ${report.grip.gripOffsets[0].toFixed(3)}, ` +
    `the prop's ${report.grip.gripOffsets[1].toFixed(3)}); hers agrees with her facing at ${report.grip.aimAgrees.toFixed(2)}`,
);
console.log(
  `       bow ${report.grip.length.toFixed(1)} long, ${GRIP.lengthOfHeight} of the body ` +
    `(hers is ${report.grip.refLengthInBones.toFixed(2)} hand bones, which on this rig would be ` +
    `${((report.grip.refLengthInBones * report.grip.boneLength) / report.posed.height).toFixed(2)} of the body)`,
);
for (const c of report.clips) {
  console.log(
    `clip   ${c.name}: ${c.tracks} tracks, ${c.duration}s, clip hips y ${c.clipHipsY} ` +
      `(x${c.ratio}), -${c.dropped} position/scale tracks` +
      (c.missing.length ? `, MISSING ${c.missing.join(" ")}` : ""),
  );
}
console.log(`wrote  ${OUT}  ${(bytes.length / 1e6).toFixed(2)} MB`);
