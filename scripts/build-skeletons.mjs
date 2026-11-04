/**
 * assets/raw/kaykit/*.glb -> assets/skeleton_rogue.glb, assets/skeleton_warrior.glb
 *
 * KayKit Skeletons character pack (CC0, Kay Lousberg,
 * https://kaylousberg.itch.io/kaykit-skeletons; files from the GitHub mirror
 * KayKit-Game-Assets/KayKit-Character-Pack-Skeletons-1.0). Rogue plus crossbow
 * for ranged, Warrior plus blade for melee. Each source has 95 clips and a
 * 1024 palette atlas; the game needs four clips and 128.
 *
 * Two traps:
 *  - `Animation.dispose()` leaves channels and samplers alive, so dropped
 *    keyframes stay in the file. Dispose those first and prune with
 *    `keepLeaves: false`.
 *  - `MeshoptEncoder.ready` must be awaited or meshopt silently writes
 *    uncompressed data.
 *
 * Raw files are gitignored; re-fetch from the mirror into assets/raw/kaykit/.
 *
 *   node scripts/build-skeletons.mjs
 */
import { statSync } from "node:fs";
import { resolve } from "node:path";
import { NodeIO } from "@gltf-transform/core";
import {
  EXTMeshoptCompression,
  EXTTextureWebP,
  KHRMeshQuantization,
} from "@gltf-transform/extensions";
import {
  dedup,
  meshopt,
  mergeDocuments,
  prune,
  resample,
  textureCompress,
  unpartition,
  weld,
} from "@gltf-transform/functions";
import { MeshoptEncoder } from "meshoptimizer";
import sharp from "sharp";
import { base64MB } from "./glb-passes.mjs";

const RAW = resolve(import.meta.dirname, "../assets/raw/kaykit");
const OUT = resolve(import.meta.dirname, "../assets");

/**
 * The four clips under the renderers' names, and the weapon for the right hand
 * slot. The Rogue idles in the aiming clip: the unarmed idle lets the crossbow
 * hang sideways from the hand.
 */
const CHARACTERS = {
  skeleton_rogue: {
    source: "Skeleton_Rogue.glb",
    clips: { Idle: "2H_Ranged_Aiming", Run: "Running_A", Attack: "2H_Ranged_Shoot", Death: "Death_A" },
    // Quarter turn about the slot's Y. At identity the crossbow's long axis
    // lies along the character's -x, across the chest. Solved from the weapon
    // and slot axes, not eyeballed.
    weapon: { file: "Skeleton_Crossbow.gltf", slot: "handslot.r", rotation: [0, Math.SQRT1_2, 0, Math.SQRT1_2] },
  },
  skeleton_warrior: {
    source: "Skeleton_Warrior.glb",
    clips: { Idle: "Idle", Run: "Running_A", Attack: "1H_Melee_Attack_Chop", Death: "Death_A" },
    weapon: { file: "Skeleton_Blade.gltf", slot: "handslot.r", rotation: null },
  },
};

await MeshoptEncoder.ready;
const io = new NodeIO()
  .registerExtensions([EXTMeshoptCompression, KHRMeshQuantization, EXTTextureWebP])
  .registerDependencies({ "meshopt.encoder": MeshoptEncoder });

const only = process.argv.slice(2);
for (const [name, spec] of Object.entries(CHARACTERS)) {
  if (only.length > 0 && !only.includes(name)) continue;
  const doc = await io.read(resolve(RAW, spec.source));
  const root = doc.getRoot();

  // Keep four clips under the renderers' names; dispose the rest fully.
  const wanted = new Map(Object.entries(spec.clips).map(([to, from]) => [from, to]));
  for (const anim of root.listAnimations()) {
    const to = wanted.get(anim.getName());
    if (to !== undefined) {
      anim.setName(to);
      continue;
    }
    for (const channel of anim.listChannels()) channel.dispose();
    for (const sampler of anim.listSamplers()) sampler.dispose();
    anim.dispose();
  }
  if (root.listAnimations().length !== 4) {
    throw new Error(`${name}: expected 4 clips, got ${root.listAnimations().map((a) => a.getName())}`);
  }

  // Merge the weapon in as a second scene, reparent its nodes under the hand
  // slot, drop the extra scene.
  const weapon = await io.read(resolve(RAW, spec.weapon.file));
  const map = mergeDocuments(doc, weapon);
  const slot = root.listNodes().find((n) => n.getName() === spec.weapon.slot);
  if (slot === undefined) throw new Error(`${name}: no node named ${spec.weapon.slot}`);
  const weaponScene = map.get(weapon.getRoot().listScenes()[0]);
  for (const node of weaponScene.listChildren()) {
    if (spec.weapon.rotation !== null) node.setRotation(spec.weapon.rotation);
    slot.addChild(node);
  }
  weaponScene.dispose();

  await doc.transform(
    // The merge brought the weapon's buffer along; a GLB holds one.
    unpartition(),
    prune({ keepLeaves: false, keepAttributes: false }),
    dedup(),
    weld(),
    resample(),
    // Gradient palette atlas; the pack's README says 128 is enough.
    textureCompress({ encoder: sharp, targetFormat: "webp", resize: [128, 128] }),
    meshopt({ encoder: MeshoptEncoder, level: "high" }),
  );
  const out = resolve(OUT, `${name}.glb`);
  await io.write(out, doc);
  const bytes = statSync(out).size;
  console.log(
    `${name}.glb: ${bytes} B (${base64MB(bytes)} MB base64), ` +
      `clips ${root.listAnimations().map((a) => a.getName()).join("/")}, ` +
      `${root.listTextures().length} texture at ${root.listTextures()[0]?.getSize().join("x")}`,
  );
}
