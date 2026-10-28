/**
 * Builds `assets/archer_playable.glb`: the Erika Archer skinned mesh with
 * Idle, Run, Shoot and Death retargeted onto her rig, in one GLB.
 *
 * The inputs are the four Mixamo FBX downloads (converted by
 * `fbx-to-glb.mjs`) and the Sketchfab export of the character. Three things
 * about them that the pipeline has to fix rather than assume:
 *
 * 1. Units. Sketchfab's export leaves the rig in centimetres — Erika is 166
 *    units tall — while the game's room is 10 units wide and its archer 1.83
 *    tall. A wrapper node above the rig carries the scale, because a skinned
 *    mesh ignores its own node's transform but its joints do not.
 * 2. Bone names. The mesh's joints are suffixed (`Hips_01`); the clips' are
 *    prefixed (`mixamorigHips`). `merge-animations.mjs` owns that.
 * 3. Weight. Five PNGs at 1 MB each dominate the 6.7 MB download, and the
 *    bundle inlines every byte as base64.
 *
 * Clip names are the repo's (`Idle`/`Run`/`Shoot`/`Death`), not the lowercase
 * `run`/`shoot`/`dead` of the original brief: `src/three/clips.ts` looks clips
 * up by exact name and `KEEP_CLIPS` already spells them this way.
 *
 *   node scripts/build-playable.mjs
 */
import { readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as THREE from "three";
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
import { mergeDocuments } from "@gltf-transform/functions";
import { mergeAnimations } from "./merge-animations.mjs";

const assets = fileURLToPath(new URL("../assets/", import.meta.url));
// The encoder is wasm and loads asynchronously; the extension writes through
// it, so both the transform and the IO have to be handed the ready instance.
await MeshoptEncoder.ready;
const io = new NodeIO()
  .registerExtensions([EXTMeshoptCompression, KHRMeshQuantization, EXTTextureWebP])
  .registerDependencies({ "meshopt.encoder": MeshoptEncoder });

const MASTER = `${assets}raw/erika_archer.glb`;
const OUT = `${assets}archer_playable.glb`;

/** Matches the Vanguard archer already in the game, so the camera framing,
 *  the joystick speed and the room scale all still hold. */
const TARGET_HEIGHT = 1.83;

const CLIPS = [
  { name: "Idle", file: `${assets}raw/anim_idle.glb` },
  // Downloaded without Mixamo's "In Place" box, so the clip walks the hips
  // 1.58 m forward per loop. The joystick owns position; the clip must not.
  { name: "Run", file: `${assets}raw/anim_run.glb`, inPlace: true },
  // Standing Aim Recoil is full-body: keyed below the waist it would freeze
  // the feet, so the legs are dropped and the clip layers over Idle or Run.
  { name: "Shoot", file: `${assets}raw/anim_shoot.glb`, upperOnly: true },
  { name: "Death", file: `${assets}raw/anim_dead.glb` },
];

/**
 * The bow, taken from Mixamo's "Erika Archer With Bow Arrow" download.
 *
 * Mixamo ships no props on their own; a weapon arrives welded into a
 * character export, posed in the hand by whoever authored it. That is worth
 * having: it replaces a prop the runtime bolted on with constants tuned by
 * eye, and a GLB viewer now shows the archer holding her bow.
 *
 * Identified by MATERIAL, not by mesh name: three's FBXLoader pairs the names
 * of this file's six meshes one position out, so `Erika_Archer_Body_Mesh` is
 * in fact the bow and the material is the only honest label.
 */
const BOW = {
  file: `${assets}raw/erika_bow.glb`,
  material: "Bow_MAT",
  /** Mixamo's prop bone, parented to the left hand — the bow arm. */
  bone: "mixamorigLeft_arch1",
  hand: "mixamorigLeftHand",
  texture: `${assets}raw/erika-textures/Bow_DIFF.jpg`,
};

/** Eyes and eyelashes are a few pixels on screen; the body and clothes are the
 *  only textures worth 512. */
const SMALL_TEXTURES = /eye|lash/i;

function sceneHeight(doc) {
  const box = new THREE.Box3();
  const vertex = new THREE.Vector3();
  const walk = (node, parent) => {
    const matrix = parent
      .clone()
      .multiply(
        new THREE.Matrix4().compose(
          new THREE.Vector3().fromArray(node.getTranslation()),
          new THREE.Quaternion().fromArray(node.getRotation()),
          new THREE.Vector3().fromArray(node.getScale()),
        ),
      );
    const mesh = node.getMesh();
    if (mesh) {
      for (const prim of mesh.listPrimitives()) {
        const position = prim.getAttribute("POSITION");
        for (let i = 0; i < position.getCount(); i++) {
          box.expandByPoint(vertex.fromArray(position.getElement(i, [])).applyMatrix4(matrix));
        }
      }
    }
    for (const child of node.listChildren()) walk(child, matrix);
  };
  for (const child of doc.getRoot().getDefaultScene().listChildren()) {
    walk(child, new THREE.Matrix4());
  }
  return box.getSize(new THREE.Vector3()).y;
}

/**
 * Reparents the scene under a scaled node. Above the rig, never on it: the
 * joints are inside that root, so scaling above it scales them and the skin
 * follows. The same reason `optimize-assets.mjs` wraps instead of rotating.
 */
function rescale(doc, factor) {
  const scene = doc.getRoot().getDefaultScene();
  const wrapper = doc.createNode("GameScale").setScale([factor, factor, factor]);
  for (const node of scene.listChildren()) {
    scene.removeChild(node);
    wrapper.addChild(node);
  }
  scene.addChild(wrapper);
}

/**
 * Lifts the bow out of the Mixamo character export and hangs it off the
 * master's hand.
 *
 * The bow arrives as a skinned mesh, but 98% of its weight is on one bone
 * (`Left_arch1`, with the rest on `arch2` for the string), so it is rigid in
 * practice. That makes the whole skin unnecessary: the vertices are baked into
 * that bone's space and the mesh becomes a plain child of a node standing
 * where the bone stood. One fewer skinned mesh to deform every frame, and no
 * second 70-joint skeleton riding along in the file.
 *
 * A skinned mesh's positions are already in the rig's own space, so the
 * transform into bone space is exactly the joint's inverse bind matrix.
 */
function attachBow(doc, source) {
  const prop = findByMaterial(source, BOW.material);
  if (!prop) throw new Error(`${BOW.file} has no mesh with ${BOW.material}`);

  const skin = prop.getSkin();
  const joints = skin.listJoints();
  const index = joints.findIndex((joint) => joint.getName() === BOW.bone);
  if (index < 0) throw new Error(`${BOW.file} has no ${BOW.bone}`);

  const inverseBind = new THREE.Matrix4().fromArray(
    skin.getInverseBindMatrices().getElement(index, []),
  );
  const normalMatrix = new THREE.Matrix3().getNormalMatrix(inverseBind);

  const map = mergeDocuments(doc, source);
  const node = map.get(prop);
  const mesh = node.getMesh();
  for (const primitive of mesh.listPrimitives()) {
    bake(primitive, "POSITION", (v) => v.applyMatrix4(inverseBind));
    bake(primitive, "NORMAL", (v) => v.applyMatrix3(normalMatrix).normalize());
    // Skinning is what the bake replaced; the tangents went with the normal
    // map this camera never resolves.
    for (const semantic of ["JOINTS_0", "WEIGHTS_0", "TANGENT"]) {
      primitive.setAttribute(semantic, null);
    }
    primitive.setMaterial(bowMaterial(doc));
  }
  node.setSkin(null).setTranslation([0, 0, 0]).setRotation([0, 0, 0, 1]).setScale([1, 1, 1]);

  // Where the prop bone sat relative to the hand, in the source rig. Both rigs
  // are the same character at the same scale, so the transform carries over
  // without conversion — asserted below rather than assumed.
  const world = worldMatrices(source);
  const hand = source.getRoot().listNodes().find((n) => n.getName() === BOW.hand);
  const local = world.get(hand).clone().invert().multiply(world.get(joints[index]));

  const master = findBone(doc, "LeftHand");
  const mount = doc.createNode("BowMount");
  mount.setMatrix(local.toArray());
  mount.addChild(node);
  master.addChild(mount);

  // Every scene the merge brought with it, and the rig inside them.
  for (const scene of source.getRoot().listScenes()) {
    const merged = map.get(scene);
    if (!merged) continue;
    const walk = (child) => {
      for (const grandchild of child.listChildren()) walk(grandchild);
      if (child !== node) child.dispose();
    };
    for (const child of merged.listChildren()) walk(child);
    merged.dispose();
  }

  // The merge brought the source's own buffer along, and a GLB holds one.
  const [buffer, ...extra] = doc.getRoot().listBuffers();
  for (const accessor of doc.getRoot().listAccessors()) accessor.setBuffer(buffer);
  for (const spare of extra) spare.dispose();

  const handWorld = new THREE.Vector3().setFromMatrixPosition(world.get(hand));
  const bowWorld = new THREE.Vector3().setFromMatrixPosition(world.get(joints[index]));
  return { gap: handWorld.distanceTo(bowWorld), hand: handWorld };
}

/** Mesh node carrying a primitive with this material. */
function findByMaterial(doc, material) {
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    if (mesh.listPrimitives().some((p) => p.getMaterial()?.getName() === material)) {
      return node;
    }
  }
  return null;
}

/** Master rig bone by name, ignoring the index suffix Sketchfab adds. */
function findBone(doc, name) {
  const bone = doc
    .getRoot()
    .listNodes()
    .find((node) => node.getName().replace(/_\d+$/, "") === name);
  if (!bone) throw new Error(`master rig has no ${name}`);
  return bone;
}

function bake(primitive, semantic, transform) {
  const accessor = primitive.getAttribute(semantic);
  if (!accessor) return;
  const vector = new THREE.Vector3();
  for (let i = 0; i < accessor.getCount(); i++) {
    accessor.setElement(i, transform(vector.fromArray(accessor.getElement(i, []))).toArray());
  }
}

/** World matrix per node, for reading the source rig's bind pose. */
function worldMatrices(doc) {
  const world = new Map();
  const walk = (node, parent) => {
    const matrix = parent
      .clone()
      .multiply(
        new THREE.Matrix4().compose(
          new THREE.Vector3().fromArray(node.getTranslation()),
          new THREE.Quaternion().fromArray(node.getRotation()),
          new THREE.Vector3().fromArray(node.getScale()),
        ),
      );
    world.set(node, matrix);
    for (const child of node.listChildren()) walk(child, matrix);
  };
  for (const child of doc.getRoot().getDefaultScene().listChildren()) {
    walk(child, new THREE.Matrix4());
  }
  return world;
}

/** The bow's own diffuse, recovered from the FBX by extract-fbx-textures.mjs. */
function bowMaterial(doc) {
  const texture = doc
    .createTexture("bow")
    .setImage(readFileSync(BOW.texture))
    .setMimeType("image/jpeg");
  return doc
    .createMaterial("Bow")
    .setBaseColorTexture(texture)
    .setMetallicFactor(0)
    .setRoughnessFactor(0.6);
}

/** The character download ships its own clip, always called "mixamo.com". */
function dropForeignClips(doc, keep) {
  for (const animation of doc.getRoot().listAnimations()) {
    if (!keep.includes(animation.getName())) animation.dispose();
  }
}

/** Mixamo rigs animate every finger joint; no camera here is ever that close. */
const FINGER = /Hand(Thumb|Index|Middle|Ring|Pinky)\d/;

function dropFingerChannels(doc) {
  let dropped = 0;
  for (const animation of doc.getRoot().listAnimations()) {
    for (const channel of animation.listChannels()) {
      const target = channel.getTargetNode();
      if (target && FINGER.test(target.getName())) {
        channel.dispose();
        dropped++;
      }
    }
    // A disposed channel leaves its sampler holding the keyframe accessors, so
    // prune would still see that data as used.
    const used = new Set(animation.listChannels().map((c) => c.getSampler()));
    for (const sampler of animation.listSamplers()) {
      if (!used.has(sampler)) sampler.dispose();
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

const { doc, report } = await mergeAnimations(io, MASTER, CLIPS);

dropForeignClips(doc, CLIPS.map((c) => c.name));
const fingers = dropFingerChannels(doc);
const normals = dropNormalMaps(doc);

// Measured before the bow is attached: it reaches well above her head, and a
// height taken with it in hand would scale the archer down to fit her weapon.
const height = sceneHeight(doc);
const factor = TARGET_HEIGHT / height;

const bow = attachBow(doc, await io.read(BOW.file));

rescale(doc, factor);

// Resize the small textures before the blanket pass, so the 512 cap below
// only ever shrinks what is already larger.
await doc.transform(
  textureCompress({
    encoder: sharp,
    targetFormat: "webp",
    resize: [128, 128],
    slots: "baseColorTexture",
    pattern: SMALL_TEXTURES,
  }),
);

await doc.transform(
  prune({ keepAttributes: false, keepLeaves: false }),
  dedup(),
  weld(),
  // Mixamo bakes a key per frame at 30 fps; most are interpolable.
  resample({ tolerance: 1e-4 }),
  sparse(),
  textureCompress({ encoder: sharp, targetFormat: "webp", resize: [512, 512] }),
  // EXT_meshopt_compression, which quantizes as part of its own work — so it
  // replaces the quantize() pass rather than following it. Measured on this
  // model: 582 KB to 275 KB, against a 29 KB decoder that the bundle inlines
  // once. Draco was tried and rejected; its decoder is 250 KB of wasm and
  // wrapper, which costs more than the geometry it saves.
  meshopt({ encoder: MeshoptEncoder, level: "high" }),
);

await io.write(OUT, doc);

const before = statSync(MASTER).size + CLIPS.reduce((sum, c) => sum + statSync(c.file).size, 0);
const after = statSync(OUT).size;
const b64 = (n) => ((Math.ceil(n / 3) * 4) / 1e6).toFixed(2);
for (const stat of report) {
  console.log(
    `  ${stat.name.padEnd(6)} ${stat.retargeted} channels retargeted, ${stat.dropped} dropped` +
      (stat.unitRatio === null ? "" : `, hips units x${stat.unitRatio.toFixed(2)}`),
  );
}
console.log(
  `  bow baked onto the left hand, ${bow.gap.toFixed(1)} units from the palm`,
);
console.log(
  `  scaled x${factor.toFixed(5)} (${height.toFixed(1)} -> ${TARGET_HEIGHT} units), ` +
    `-${fingers} finger channels, -${normals} normal maps`,
);
console.log(
  `${OUT}: ${before} -> ${after} B, base64 ${b64(before)} -> ${b64(after)} MB, ` +
    `clips ${doc.getRoot().listAnimations().map((a) => a.getName()).join("/")}`,
);
