/**
 * assets/raw/erika-final-raw.glb -> assets/archer_playable.glb
 *
 * The merge (`scripts/fbx-merge.mjs`) stays faithful to the Mixamo source;
 * every decision that serves *this* game is made here, so the raw file remains
 * something to diff against. What that means in practice:
 *
 *  - Mixamo clip names become the four the renderers ask for by name.
 *  - The run clip travels 375 units per cycle because Mixamo's In Place box
 *    was not ticked; code owns position, so the travel is removed here.
 *  - The source is in centimetres and the game is in metres.
 *  - Textures are 2048² PNG, which is most of the 46 MB.
 *
 * The player and the enemy archers share this one file — `src/three/enemy.ts`
 * clones it and tints it — so anything dropped here is dropped for both.
 *
 *   node scripts/build-archer.mjs
 */
import { statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import {
  EXTMeshoptCompression,
  EXTTextureWebP,
  KHRMeshQuantization,
} from "@gltf-transform/extensions";
import {
  dedup,
  meshopt,
  prune,
  resample,
  sparse,
  textureCompress,
  weld,
} from "@gltf-transform/functions";
import { MeshoptEncoder } from "meshoptimizer";
import sharp from "sharp";
import {
  base64MB,
  dropExtraTexcoords,
  dropFingerChannels,
  dropNormalMaps,
  dropOrphanSamplers,
} from "./glb-passes.mjs";

const SRC = fileURLToPath(new URL("../assets/raw/erika-final-raw.glb", import.meta.url));
const DST = fileURLToPath(new URL("../assets/archer_playable.glb", import.meta.url));

/** What the renderers call `action(mixer, gltf, name)` with. */
const RENAME = {
  "Standing Idle": "Idle",
  Running: "Run",
  "Standing Draw Arrow": "Shoot",
  "Standing Death Left 01": "Death",
};

/** Clips that must not move the character: code owns x and z. */
const IN_PLACE = ["Run"];

/**
 * Metres, head to heel. `src/main.ts` floats the health bar at 1.83 for the
 * archer, and the enemy scales in `src/config.ts` are tuned against that, so
 * this number is load-bearing rather than cosmetic.
 */
const ARCHER_HEIGHT_M = 1.83;

await MeshoptEncoder.ready;
const io = new NodeIO()
  .registerExtensions([EXTMeshoptCompression, KHRMeshQuantization, EXTTextureWebP])
  .registerDependencies({ "meshopt.encoder": MeshoptEncoder });

function renameClips(doc) {
  const seen = [];
  for (const anim of doc.getRoot().listAnimations()) {
    const to = RENAME[anim.getName()];
    if (!to) throw new Error(`unexpected clip "${anim.getName()}" in the raw merge`);
    anim.setName(to);
    seen.push(to);
  }
  const missing = Object.values(RENAME).filter((n) => !seen.includes(n));
  if (missing.length) throw new Error(`raw merge is missing ${missing.join(", ")}`);
  return seen;
}

/**
 * Mixamo's In Place option rewrites the hips translation; without it the clip
 * walks the character off its own origin and the game's position fights it.
 * Holding every key at the first frame's x and z does the same thing, and
 * keeps the vertical bob, which In Place also keeps.
 */
function stripRootMotion(doc) {
  const stripped = [];
  for (const anim of doc.getRoot().listAnimations()) {
    if (!IN_PLACE.includes(anim.getName())) continue;
    for (const channel of anim.listChannels()) {
      const node = channel.getTargetNode();
      if (channel.getTargetPath() !== "translation" || !/Hips$/.test(node.getName())) continue;
      const output = channel.getSampler().getOutput();
      const v = output.getArray();
      let travel = 0;
      for (let i = 0; i < v.length; i += 3) {
        travel = Math.max(travel, Math.abs(v[i] - v[0]), Math.abs(v[i + 2] - v[2]));
        v[i] = v[0];
        v[i + 2] = v[2];
      }
      output.setArray(v);
      stripped.push(`${anim.getName()} -${travel.toFixed(0)}cm`);
    }
  }
  return stripped;
}

/**
 * FBXLoader parks the raw FBX transform of every bone in `userData`, and
 * GLTFExporter writes `userData` straight into `extras` — pre-rotations, euler
 * orders, parent matrices, all of it, for 70 joints. Nothing reads it and it
 * was 64 KB of the JSON chunk, which is more than the textures.
 */
function dropExtras(doc) {
  let dropped = 0;
  for (const prop of doc.getGraph().listEdges().map((e) => e.getChild())) {
    if (Object.keys(prop.getExtras()).length) {
      prop.setExtras({});
      dropped++;
    }
  }
  return dropped;
}

/** Source height, in its own units, from the rest pose. */
function modelHeight(doc) {
  let top = 0;
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      top = Math.max(top, prim.getAttribute("POSITION").getMax([])[1]);
    }
  }
  return top;
}

/**
 * One node above everything, carrying only the unit conversion. The renderers
 * set position and rotation.y on `gltf.scene`, so the scale cannot live there
 * — it would be overwritten — and baking it into the vertices would also have
 * to rewrite every hips translation key.
 */
function addGameScale(doc, scale) {
  const scene = doc.getRoot().getDefaultScene();
  const wrap = doc.createNode("GameScale").setScale([scale, scale, scale]);
  for (const child of scene.listChildren()) {
    scene.removeChild(child);
    wrap.addChild(child);
  }
  scene.addChild(wrap);
}

const doc = await io.read(SRC);

const clips = renameClips(doc);
const stripped = stripRootMotion(doc);
const fingers = dropFingerChannels(doc);
const orphans = dropOrphanSamplers(doc);
const uvs = dropExtraTexcoords(doc);
const normals = dropNormalMaps(doc);
const extras = dropExtras(doc);

const height = modelHeight(doc);
const scale = ARCHER_HEIGHT_M / height;
addGameScale(doc, scale);

await doc.transform(
  // prune first so later passes don't spend work on orphans.
  prune({ keepAttributes: false, keepLeaves: false }),
  dedup(),
  // The dropped UV sets left vertices split for no reason.
  weld(),
  // Mixamo bakes a key per frame; most are interpolable.
  resample({ tolerance: 1e-4 }),
  sparse(),
  textureCompress({ encoder: sharp, targetFormat: "webp", resize: [512, 512] }),
  // EXT_meshopt_compression quantizes as part of its own work, so it stands in
  // for a separate quantize() pass. See the note in optimize-assets.mjs.
  meshopt({ encoder: MeshoptEncoder, level: "high" }),
);

await io.write(DST, doc);

const before = statSync(SRC).size;
const after = statSync(DST).size;
console.log(
  `archer_playable.glb: ${(before / 1e6).toFixed(2)} MB -> ${(after / 1024).toFixed(0)} KB  ` +
    `(base64 ${base64MB(after)} MB in the bundle)`,
);
console.log(
  `  clips ${clips.join("/")} | root motion ${stripped.join(", ") || "none"} | ` +
    `scale ${scale} (${height.toFixed(1)}cm -> ${ARCHER_HEIGHT_M}m)`,
);
console.log(
  `  -${fingers} finger channels, -${orphans} orphan samplers, -${uvs} uv sets, ` +
    `-${normals} normal maps, -${extras} extras blobs`,
);
