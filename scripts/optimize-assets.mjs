/**
 * Rebuilds assets/*.glb from the untouched models in assets/raw/.
 *
 * The player's own model is not here: it is merged from a character and four
 * Mixamo clips by scripts/fbx-merge.mjs and built by scripts/build-archer.mjs,
 * which runs the same passes out of scripts/glb-passes.mjs.
 *
 * Idempotent: reads raw/, writes over the siblings. Never edits raw/.
 *
 *   node scripts/optimize-assets.mjs
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
  dropClips,
  dropExtraTexcoords,
  dropFingerChannels,
  dropNormalMaps,
  dropOrphanSamplers,
} from "./glb-passes.mjs";

const assets = fileURLToPath(new URL("../assets/", import.meta.url));
// The meshopt encoder is wasm and loads asynchronously; the extension writes
// through it, so the IO needs the ready instance as well as the transform.
await MeshoptEncoder.ready;
const io = new NodeIO()
  .registerExtensions([EXTMeshoptCompression, KHRMeshQuantization, EXTTextureWebP])
  .registerDependencies({ "meshopt.encoder": MeshoptEncoder });

/** Only these clips are reachable from a game state. */
const KEEP_CLIPS = {
  "enemy.glb": ["Idle", "Running", "Punch", "Death"],
  // The arrow: a static single mesh, no rig and no clips. It still goes
  // through the pipeline for meshopt and texture compression.
  "arrow.glb": [],
  // Scenery from the client's mesh set. All three are static props with no
  // rig, no clips and no textures — the rip carries none, so they are lit by
  // materials assigned in `src/three/scenery.ts`. The tree is the exception
  // that matters: its green lives in COLOR_0 and nowhere else, which is why
  // the prune below keeps attributes for these three.
  "tree.glb": [],
  "rock.glb": [],
  "mushroom.glb": [],
};

/** Files whose vertex attributes must survive prune. `keepAttributes: false`
 *  drops anything no material references, and a glTF material cannot say "I
 *  use vertex colours" — so COLOR_0 looks unused and the tree ships grey. */
const KEEP_ATTRIBUTES = ["tree.glb"];

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
    prune({
      keepAttributes: KEEP_ATTRIBUTES.includes(name),
      keepLeaves: false,
    }),
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
  console.log(
    `${name}: ${before} -> ${after} B  (${(after / before * 100).toFixed(0)}%)  ` +
      `base64 ${base64MB(before)} -> ${base64MB(after)} MB  ` +
      `[clips kept ${KEEP_CLIPS[name].join("/") || "none"}, -${fingers} finger channels, ` +
      `-${orphans} orphan samplers, -${uvs} uv sets, -${normals} normal maps]`,
  );
  return after;
}

let total = 0;
for (const name of Object.keys(KEEP_CLIPS)) total += await optimize(name);
console.log(`total ${total} B binary, ~${base64MB(total)} MB base64`);
