/**
 * Rebuilds the prop glbs in assets/ from assets/raw/. Characters have their own
 * build scripts. Reads raw/, writes over the siblings, never edits raw/.
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
// Must be awaited or meshopt silently writes uncompressed data.
await MeshoptEncoder.ready;
const io = new NodeIO()
  .registerExtensions([EXTMeshoptCompression, KHRMeshQuantization, EXTTextureWebP])
  .registerDependencies({ "meshopt.encoder": MeshoptEncoder });

/** Clips to keep per file. All static props, so none. */
const KEEP_CLIPS = {
  "arrow.glb": [],
  // Untextured; materials are assigned in src/three/scenery.ts.
  "tree.glb": [],
  "rock.glb": [],
  "mushroom.glb": [],
  // Separate source from the other props; the only textured one.
  "low_poly_pine.glb": [],
};

/** The tree's green is in COLOR_0, which `keepAttributes: false` would drop
 *  because no material references it. */
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
    prune({
      keepAttributes: KEEP_ATTRIBUTES.includes(name),
      keepLeaves: false,
    }),
    dedup(),
    weld(),
    resample({ tolerance: 1e-4 }),
    sparse(),
    textureCompress({ encoder: sharp, targetFormat: "webp", resize: [512, 512] }),
    // meshopt quantizes on its own, so no separate quantize() pass. Its 29 KB
    // decoder is inlined once; Draco's wasm costs more than it saves here.
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
