/**
 * Erika Archer + four Mixamo clips -> one glb, with nothing else done to it.
 *
 * The base mesh and the clips are the same Mixamo rig (`mixamorig:` bones in
 * both), so the merge itself is only "load the skinned FBX, take clip 0 out of
 * each animation FBX, export them together". No retargeting, no rescaling, no
 * bone renaming, no track resampling: anything the model needs beyond that
 * belongs to a later step, not to the conversion.
 *
 * Runs in headless Chromium because Mixamo embeds its textures as FBX
 * `Content` records that `FBXLoader` hands to `TextureLoader` as blob URLs —
 * decoding those needs an `Image`, and `GLTFExporter` needs a canvas to
 * re-encode them. Node has neither.
 *
 *   node scripts/fbx-merge.mjs
 */
import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { chromium } from "playwright";

const ROOT = resolve(import.meta.dirname, "..");

const BASE = "assets/raw/Pro Longbow Pack/Erika Archer With Bow Arrow.fbx";

// FBXLoader names every Mixamo clip `mixamo.com`, so four merged clips would
// otherwise be indistinguishable downstream; naming them is part of the merge,
// not processing on top of it.
const CLIPS = [
  ["Running", "assets/raw/Running (1).fbx"],
  ["Standing Idle", "assets/raw/Standing Idle.fbx"],
  ["Standing Draw Arrow", "assets/raw/Standing Draw Arrow.fbx"],
  ["Standing Death Left 01", "assets/raw/Standing Death Left 01.fbx"],
];

const OUT = "assets/raw/erika-final-raw.glb";

const MIME = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".fbx": "application/octet-stream",
};

const url = (p) => "/" + p.split("/").map(encodeURIComponent).join("/");

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
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";

const BASE = ${JSON.stringify(url(BASE))};
const CLIPS = ${JSON.stringify(CLIPS.map(([name, file]) => [name, url(file)]))};

// FBXLoader resolves once the FBX has parsed, not once the blob-URL textures
// it queued have decoded. Exporting at that point writes empty images, so wait
// for every map to actually carry a decoded bitmap.
async function texturesDecoded(root) {
  const maps = new Set();
  root.traverse((o) => {
    for (const m of [o.material].flat().filter(Boolean)) {
      for (const v of Object.values(m)) if (v && v.isTexture) maps.add(v);
    }
  });
  const deadline = Date.now() + 120000;
  for (;;) {
    const pending = [...maps].filter((t) => !(t.image && t.image.width > 0));
    if (pending.length === 0) return maps.size;
    if (Date.now() > deadline) throw new Error(pending.length + " textures never decoded");
    await new Promise((r) => setTimeout(r, 50));
  }
}

// FBXLoader builds a fresh Bone tree per skin deformer, so a character whose
// six meshes share one Mixamo armature arrives as six identical skeletons
// nested inside one another. Animation tracks bind by bone name and only ever
// reach the first copy, which leaves five of the six meshes frozen at bind
// pose — in three and in the exported glb alike. Point every skin at one tree
// and drop the copies; each mesh keeps its own inverse bind matrices, so this
// loses nothing.
function unifySkeletons(root) {
  const skins = [];
  root.traverse((o) => { if (o.isSkinnedMesh) skins.push(o); });

  // The copy that is wired into the scene graph under the root is the one the
  // clips will drive, so it is the one to keep.
  const top = root.children.find((c) => c.isBone);
  const canonical = skins.find((m) => m.skeleton.bones.includes(top))?.skeleton;
  if (!canonical) throw new Error("no skeleton owns the root bone");

  const byName = new Map(canonical.bones.map((b) => [b.name, b]));
  root.updateMatrixWorld(true);

  // Skinning only ever uses boneInverse * boneWorld, and each mesh keeps its
  // own boneInverses, so swapping a copy for the kept bone of the same name is
  // exact exactly when the two sit at the same world transform. Measure that
  // rather than trusting the loader to have placed the copies identically.
  // (The file's own transforms are not the bind pose, so comparing an inverse
  // against a world matrix would prove nothing.)
  const worldDrift = { bone: null, delta: 0 };
  const inverseDrift = { bone: null, delta: 0 };
  const seen = new Map();

  for (const mesh of skins) {
    const mapped = mesh.skeleton.bones.map((b, i) => {
      const keep = byName.get(b.name);
      if (!keep) throw new Error("bone " + b.name + " missing from the kept skeleton");
      track(worldDrift, b.name, b.matrixWorld.elements, keep.matrixWorld.elements);
      // Six skins binding the same armature should also agree on the inverse
      // bind matrix of a shared bone; disagreement would mean the copies were
      // genuinely different rigs.
      const first = seen.get(b.name);
      if (first) track(inverseDrift, b.name, mesh.skeleton.boneInverses[i].elements, first);
      else seen.set(b.name, mesh.skeleton.boneInverses[i].elements);
      return keep;
    });
    if (mesh.skeleton !== canonical) {
      mesh.bind(new THREE.Skeleton(mapped, mesh.skeleton.boneInverses), mesh.bindMatrix);
    }
  }

  // Detaching each copy's topmost bone takes its whole subtree with it.
  const kept = new Set(canonical.bones);
  const before = countBones(root);
  const orphans = [];
  root.traverse((o) => {
    if (o.isBone && !kept.has(o) && (!o.parent.isBone || kept.has(o.parent))) orphans.push(o);
  });
  for (const o of orphans) o.parent.remove(o);

  const bones = countBones(root);
  if (bones !== canonical.bones.length) {
    throw new Error("skeleton collapse left " + bones + " bones for " + canonical.bones.length + " joints");
  }
  return { skins: skins.length, joints: bones, bonesDropped: before - bones, worldDrift, inverseDrift };
}

/** Keep the worst element-wise difference between two matrices, and its bone. */
function track(worst, name, a, b) {
  for (let i = 0; i < 16; i++) {
    const d = Math.abs(a[i] - b[i]);
    if (d > worst.delta) { worst.delta = d; worst.bone = name; }
  }
}

function countBones(root) {
  let n = 0;
  root.traverse((o) => { if (o.isBone) n++; });
  return n;
}

// The source ships a loose arrow as its own skinned mesh bound to the prop
// bone mixamorigarrow, which rests at world origin — on the floor — and
// which no clip anywhere drives: Mixamo exports 53 humanoid bones plus the
// hips translation and keeps only Left_arch1 of the props. So the arrow lies
// at her feet through every animation and nothing can ever pick it up. Drop
// the mesh. Its bone stays as an unreferenced joint; the quiver on her back is
// welded into the clothes mesh and spine-weighted, so it is untouched.
function dropLooseArrow(root) {
  let mesh = null;
  root.traverse((o) => {
    if (!o.isSkinnedMesh) return;
    const used = new Set(o.geometry.getAttribute("skinIndex").array);
    // Node names in this file sit one slot off their geometry — the arrow
    // rides a node called Erika_Archer_Eyes_Mesh — so match on the joint.
    if ([...used].some((i) => o.skeleton.bones[i]?.name === "mixamorigarrow")) mesh = o;
  });
  if (!mesh) throw new Error("no mesh is weighted to mixamorigarrow");
  const verts = mesh.geometry.getAttribute("position").count;
  mesh.parent.remove(mesh);
  mesh.geometry.dispose();
  return { node: mesh.name, verts };
}

const nameSet = (root) => {
  const names = new Set();
  root.traverse((o) => names.add(o.name));
  return names;
};

// Rest / first-frame hips height, in the file's own units. A clip downloaded
// against a different character shows up here as a mismatched root height.
const hipsY = (root) => root.getObjectByName("mixamorigHips")?.position.y ?? null;
const trackHipsY = (clip) => clip.tracks.find((t) => t.name.endsWith("Hips.position"))?.values[1] ?? null;

const loader = new FBXLoader();

const root = await loader.loadAsync(BASE);
const textures = await texturesDecoded(root);
const skeleton = unifySkeletons(root);
const arrow = dropLooseArrow(root);
const baseNames = nameSet(root);

const report = {
  base: { textures, nodes: baseNames.size, hipsY: hipsY(root), ownClips: root.animations.map((a) => a.name), skeleton, arrow },
  clips: [],
};

const merged = [];
for (const [name, src] of CLIPS) {
  const scene = await loader.loadAsync(src);
  const clip = scene.animations[0];
  if (!clip) throw new Error("no animation in " + src);
  clip.name = name;
  merged.push(clip);
  // Tracks addressing a bone the base rig does not have are dropped silently
  // by the exporter, so count them here instead.
  const missing = [...new Set(clip.tracks.map((t) => t.name.split(".")[0]).filter((n) => !baseNames.has(n)))];
  report.clips.push({
    name,
    inFile: scene.animations.length,
    tracks: clip.tracks.length,
    duration: +clip.duration.toFixed(3),
    // The rest height is the rig Mixamo exported the clip against; the track
    // height is where the clip puts the hips on its first frame. Rest heights
    // that disagree with the base model mean the clip was downloaded against
    // a different character, which a merge cannot fix.
    restHipsY: hipsY(scene),
    hipsY: trackHipsY(clip),
    missing,
  });
}

const glb = await new GLTFExporter().parseAsync(root, { binary: true, animations: merged });
window.__glb = new Uint8Array(glb);
window.__report = report;
window.__done = true;
</script>`;

/** Static server over the repo, so the page can fetch three and the FBX files. */
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

// Pull the glb back in base64 slices; one 45 MB string through evaluate is a
// stack overflow waiting to happen. 3 MiB keeps every slice a multiple of 3,
// so the base64 pieces concatenate without padding landing mid-stream.
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

const s = report.base.skeleton;
console.log(`base   ${BASE}`);
console.log(`       ${report.base.nodes} names, ${report.base.textures} textures, hips y ${report.base.hipsY}`);
console.log(`       ${s.skins} skins over ${s.joints} joints, ${s.bonesDropped} duplicate bones dropped`);
console.log(`       worst copy-vs-kept world delta ${s.worldDrift.delta.toExponential(2)} (${s.worldDrift.bone}), worst inverse-bind delta ${s.inverseDrift.delta.toExponential(2)} (${s.inverseDrift.bone})`);
console.log(`       dropped the loose arrow mesh (${report.base.arrow.node}, ${report.base.arrow.verts} verts)`);
console.log(`       clips in the base file (not exported): ${report.base.ownClips.join(", ")}`);
for (const c of report.clips) {
  console.log(
    `clip   ${c.name}: ${c.tracks} tracks, ${c.duration}s, rig hips y ${c.restHipsY.toFixed(2)}, frame-0 hips y ${c.hipsY.toFixed(2)}` +
      (c.inFile > 1 ? `, ${c.inFile} clips in file (took the first)` : "") +
      (c.missing.length ? `, MISSING ${c.missing.join(" ")}` : ""),
  );
}
console.log(`wrote  ${OUT}  ${(bytes.length / 1e6).toFixed(2)} MB`);
