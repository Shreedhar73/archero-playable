/**
 * assets/raw/archero-final-raw.glb -> assets/archero_hero.glb
 *
 * Same division of labour as `build-archer.mjs`: `archero-merge.mjs` stays
 * faithful to the sources, and every decision that serves *this* game is made
 * here. The differences from the Erika build are the ones this source forces:
 *
 *  - The character is measured posed, not from the rest mesh. The merge wrote
 *    the number into the root node's extras because the skin's inverse bind
 *    matrices carry a ~24x scale: POSITION tops out at 6.4 where the skinned
 *    body stands 163 tall, so `modelHeight`-by-vertex would be 25x wrong.
 *  - The bow is a prop from the client's mesh set, exported white with
 *    `metallic 1`, which under this game's near-flat lighting renders as a
 *    dark smear. It is given wood here rather than in the merge, because it
 *    is a judgement about this game's lighting, not about the source.
 *  - The specular-glossiness conversion in the merge leaves `KHR_materials_
 *    specular` and `_ior` behind. three reads them, they tint the character
 *    towards grey under a flat key, and they cost JSON; the pipeline drops
 *    them.
 *
 * Unlike the Erika build this file is the *player* only — the enemy archers
 * still clone `archer_playable.glb`, which is what finally gives the two
 * sides different silhouettes.
 *
 *   node scripts/build-archero.mjs
 */
import { statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import {
  EXTMeshoptCompression,
  EXTTextureWebP,
  KHRMaterialsIOR,
  KHRMaterialsSpecular,
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

const SRC = fileURLToPath(new URL("../assets/raw/archero-final-raw.glb", import.meta.url));
const DST = fileURLToPath(new URL("../assets/archero_hero.glb", import.meta.url));

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
 * Metres, head to heel — the same number the Erika build uses, so the health
 * bar heights and the enemy scales in `src/config.ts` keep meaning what they
 * meant. The chibi proportions change what that height looks like, not what
 * the rest of the game measures against it.
 */
const ARCHER_HEIGHT_M = 1.83;

/**
 * Wood, matte, and lighter than wood really is: the prop ships white at
 * `metallic 1`, and the first pass at a true dark brown disappeared into the
 * costume at the game's camera. This reads as a bow from above.
 */
const BOW_COLOR = [0.52, 0.35, 0.19, 1];
const BOW_MATERIAL = "DefaultMaterial";

await MeshoptEncoder.ready;
const io = new NodeIO()
  .registerExtensions([
    EXTMeshoptCompression,
    KHRMeshQuantization,
    EXTTextureWebP,
    KHRMaterialsIOR,
    KHRMaterialsSpecular,
  ])
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
 * Holding every key at the first frame's x and z does the same thing and
 * keeps the vertical bob.
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
      stripped.push(`${anim.getName()} -${travel.toFixed(0)}`);
    }
  }
  return stripped;
}

/**
 * The posed height the merge measured, before `dropExtras` throws the extras
 * away. Nothing else in the file knows it: the rest mesh is 25x smaller than
 * the skinned body.
 */
function posedHeight(doc) {
  for (const node of doc.getRoot().listNodes()) {
    const h = node.getExtras().posedHeight;
    if (typeof h === "number") return h;
  }
  throw new Error("the merge did not record posedHeight — rerun scripts/archero-merge.mjs");
}

/**
 * GLTFExporter writes three's `userData` straight into `extras`, which here is
 * the loader's own copy of every node name — 70 of them — plus the height
 * this build has already read.
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

/** TANGENT exists for the normal map, and the normal map is dropped. */
function dropTangents(doc) {
  let dropped = 0;
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      if (!prim.getAttribute("TANGENT")) continue;
      prim.setAttribute("TANGENT", null);
      dropped++;
    }
  }
  return dropped;
}

/** The bow prop has skinning attributes but no skin: it rides a bone node. */
function dropUnskinnedWeights(doc) {
  let dropped = 0;
  const skinned = new Set();
  for (const node of doc.getRoot().listNodes()) {
    if (node.getSkin() && node.getMesh()) skinned.add(node.getMesh());
  }
  for (const mesh of doc.getRoot().listMeshes()) {
    if (skinned.has(mesh)) continue;
    for (const prim of mesh.listPrimitives()) {
      for (const semantic of ["JOINTS_0", "WEIGHTS_0"]) {
        if (!prim.getAttribute(semantic)) continue;
        prim.setAttribute(semantic, null);
        dropped++;
      }
    }
  }
  return dropped;
}

/** specGloss leaves these behind; flat lighting makes no use of either. */
function dropSpecularExtensions(doc) {
  let dropped = 0;
  for (const material of doc.getRoot().listMaterials()) {
    for (const name of ["KHR_materials_specular", "KHR_materials_ior"]) {
      if (!material.getExtension(name)) continue;
      material.setExtension(name, null);
      dropped++;
    }
  }
  for (const ext of doc.getRoot().listExtensionsUsed()) {
    if (/specular|_ior$/.test(ext.extensionName)) ext.dispose();
  }
  return dropped;
}

/** Wood, matte, no map: 134 triangles do not need one. */
function paintBow(doc) {
  const bow = doc.getRoot().listMaterials().find((m) => m.getName() === BOW_MATERIAL);
  if (!bow) throw new Error(`no "${BOW_MATERIAL}" material — did the bow attach?`);
  bow.setBaseColorFactor(BOW_COLOR).setMetallicFactor(0).setRoughnessFactor(0.85);
  return bow.getName();
}

/**
 * One node above everything, carrying only the unit conversion. The renderers
 * set position and rotation.y on `gltf.scene`, so the scale cannot live there
 * — it would be overwritten.
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
const tangents = dropTangents(doc);
const weights = dropUnskinnedWeights(doc);
const specular = dropSpecularExtensions(doc);
const bow = paintBow(doc);

const height = posedHeight(doc);
const extras = dropExtras(doc);

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
  // EXT_meshopt_compression quantizes as part of its own work, so it stands in
  // for a separate quantize() pass.
  meshopt({ encoder: MeshoptEncoder, level: "high" }),
);

await io.write(DST, doc);

const before = statSync(SRC).size;
const after = statSync(DST).size;
console.log(
  `archero_hero.glb: ${(before / 1e6).toFixed(2)} MB -> ${(after / 1024).toFixed(0)} KB  ` +
    `(base64 ${base64MB(after)} MB in the bundle)`,
);
console.log(
  `  clips ${clips.join("/")} | root motion ${stripped.join(", ") || "none"} | ` +
    `scale ${scale} (${height.toFixed(1)} -> ${ARCHER_HEIGHT_M}m)`,
);
console.log(
  `  -${fingers} finger channels, -${orphans} orphan samplers, -${uvs} uv sets, ` +
    `-${normals} normal maps, -${tangents} tangent sets, -${weights} unskinned weight sets, ` +
    `-${specular} specular extensions, -${extras} extras blobs, ${bow} painted wood`,
);
