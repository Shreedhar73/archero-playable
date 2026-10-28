/**
 * Rebuilds assets/*.glb from the untouched models in assets/raw/.
 *
 * The player's own model is not here: it is merged from a character and four
 * Mixamo clips by scripts/build-playable.mjs, which runs the same passes.
 *
 * The bundle is one inlined HTML file, so every byte here costs ~1.33 bytes
 * base64 in dist/. These models are stock Mixamo / three.js samples and carry a
 * lot that this playable never renders: unused UV sets, a normal map invisible
 * at a top-down camera, finger-bone animation channels, and clips for gameplay
 * states that do not exist.
 *
 * Idempotent: reads raw/, writes over the siblings. Never edits raw/.
 *
 *   node scripts/optimize-assets.mjs
 */
import { readFileSync, statSync } from "node:fs";
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

const assets = fileURLToPath(new URL("../assets/", import.meta.url));
// The meshopt encoder is wasm and loads asynchronously; the extension writes
// through it, so the IO needs the ready instance as well as the transform.
await MeshoptEncoder.ready;
const io = new NodeIO()
  .registerExtensions([EXTMeshoptCompression, KHRMeshQuantization, EXTTextureWebP])
  .registerDependencies({ "meshopt.encoder": MeshoptEncoder });

/** Mixamo rigs animate every finger joint; nothing here is ever that close. */
// Mixamo names finger bones HandThumb1..; 3ds Max Biped rigs name them
// "Bip001 L Finger01". Both are detail no camera at this distance resolves.
const FINGER = /Hand(Thumb|Index|Middle|Ring|Pinky)\d|Finger\d/;

/** Only these clips are reachable from a game state. */
const KEEP_CLIPS = {
  "enemy.glb": ["Idle", "Running", "Punch", "Death"],
};

function dropClips(doc, keep) {
  for (const anim of doc.getRoot().listAnimations()) {
    if (!keep.includes(anim.getName())) anim.dispose();
  }
}

function dropFingerChannels(doc) {
  let dropped = 0;
  for (const anim of doc.getRoot().listAnimations()) {
    for (const channel of anim.listChannels()) {
      const target = channel.getTargetNode();
      if (target && FINGER.test(target.getName())) {
        channel.dispose();
        dropped++;
      }
    }
  }
  return dropped;
}

/**
 * Disposing a channel leaves its AnimationSampler attached to the clip, and the
 * sampler keeps its keyframe accessors alive — so prune sees them as used and
 * the dropped channels' data stays in the bin. Collect what the surviving
 * channels still point at and dispose the rest.
 */
function dropOrphanSamplers(doc) {
  let dropped = 0;
  for (const anim of doc.getRoot().listAnimations()) {
    const used = new Set(anim.listChannels().map((c) => c.getSampler()));
    for (const sampler of anim.listSamplers()) {
      if (!used.has(sampler)) {
        sampler.dispose();
        dropped++;
      }
    }
  }
  return dropped;
}

/** Secondary UV sets exist because the source authored lightmaps we don't use. */
function dropExtraTexcoords(doc) {
  let dropped = 0;
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      for (const name of prim.listSemantics()) {
        if (/^TEXCOORD_[1-9]/.test(name)) {
          prim.setAttribute(name, null);
          dropped++;
        }
      }
    }
  }
  return dropped;
}

/** A normal map reads as noise from a top-down three-quarter camera. */
function dropNormalMaps(doc) {
  let dropped = 0;
  for (const material of doc.getRoot().listMaterials()) {
    if (material.getNormalTexture()) {
      material.setNormalTexture(null);
      dropped++;
    }
  }
  return dropped;
}

async function optimize(name) {
  const src = `${assets}raw/${name}`;
  const dst = `${assets}${name}`;
  const doc = await io.read(src);

  dropClips(doc, KEEP_CLIPS[name]);
  const fingers = dropFingerChannels(doc);
  const orphans = dropOrphanSamplers(doc);
  const uvs = dropExtraTexcoords(doc);
  const normals = dropNormalMaps(doc);

  await doc.transform(
    // prune first so later passes don't spend work on orphans.
    prune({ keepAttributes: false, keepLeaves: false }),
    dedup(),
    // The dropped UV sets left vertices split for no reason.
    weld(),
    // Mixamo and FBX2glTF bake a key per frame; most are interpolable.
    resample({ tolerance: 1e-4 }),
    sparse(),
    textureCompress({ encoder: sharp, targetFormat: "webp", resize: [512, 512] }),
    // EXT_meshopt_compression quantizes as part of its own work, so it stands
    // in for a separate quantize() pass. Measured on the archer: 582 KB to
    // 279 KB against a 29 KB decoder the bundle inlines once, for every model
    // at once. Draco was measured too and rejected — 250 KB of wasm and
    // wrapper costs more than the geometry it saves.
    meshopt({ encoder: MeshoptEncoder, level: "high" }),
  );

  await io.write(dst, doc);

  const before = statSync(src).size;
  const after = statSync(dst).size;
  const b64 = (n) => (Math.ceil(n / 3) * 4 / 1e6).toFixed(2);
  console.log(
    `${name}: ${before} -> ${after} B  (${(after / before * 100).toFixed(0)}%)  ` +
      `base64 ${b64(before)} -> ${b64(after)} MB  ` +
      `[clips kept ${KEEP_CLIPS[name].join("/")}, -${fingers} finger channels, ` +
      `-${orphans} orphan samplers, -${uvs} uv sets, -${normals} normal maps]`,
  );
  return after;
}

let total = 0;
for (const name of Object.keys(KEEP_CLIPS)) total += await optimize(name);
void readFileSync;
console.log(`total ${total} B binary, ~${(Math.ceil(total / 3) * 4 / 1e6).toFixed(2)} MB base64`);
