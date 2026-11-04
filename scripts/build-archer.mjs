/**
 * assets/raw/erika-final-raw.glb -> assets/raw/archer_playable.glb
 *
 * fbx-merge.mjs keeps the raw file faithful to the source; game-specific
 * decisions happen here: clip names, root motion stripped, centimetres to
 * metres, textures down from 2048 PNG. The output is the bow reference for
 * archero-merge.mjs and does not ship.
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
const DST = fileURLToPath(new URL("../assets/raw/archer_playable.glb", import.meta.url));

/** Clip names the renderers ask for. */
const RENAME = {
  "Standing Idle": "Idle",
  Running: "Run",
  "Standing Draw Arrow": "Shoot",
  "Standing Death Left 01": "Death",
};

/** Clips that must not move the character: code owns x and z. */
const IN_PLACE = ["Run"];

/** Metres, head to heel. Health bar heights and enemy scales depend on it. */
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
 * The clips were exported without Mixamo's In Place option, so the run walks
 * the character off its origin. Hold hips x and z at the first key; keep the bob.
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
 * GLTFExporter writes three's `userData` into `extras`: FBXLoader's raw bone
 * transforms for 70 joints, about 64 KB of JSON nothing reads.
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
 * One wrapper node carrying the unit conversion. Renderers overwrite the
 * transform of `gltf.scene`, so the scale cannot live there.
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
  prune({ keepAttributes: false, keepLeaves: false }),
  dedup(),
  weld(),
  // Mixamo bakes a key per frame; most are interpolable.
  resample({ tolerance: 1e-4 }),
  sparse(),
  textureCompress({ encoder: sharp, targetFormat: "webp", resize: [512, 512] }),
  // meshopt quantizes on its own, so no separate quantize() pass.
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
