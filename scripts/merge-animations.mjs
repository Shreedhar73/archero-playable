/**
 * Retargets animation-only glTF files onto one skinned master, so a Mixamo
 * character and its clips ship as a single GLB.
 *
 * `gltf-transform merge` cannot do this: it concatenates documents into
 * separate scenes and leaves every animation channel pointing at the bones it
 * arrived with, so the master's skin never moves. No CLI flag retargets. What
 * actually has to happen is per channel: find the node of the same name in the
 * master and `setTargetNode` to it, then throw the imported rig away.
 *
 * Bone names are matched on the part after the last ':' — FBX2glTF emits
 * `mixamorig:Hips`, some converters emit `mixamorig1:Hips`, and a rig whose
 * clips all came from the same character still disagrees across converters.
 *
 * Mixamo names every downloaded clip "mixamo.com", so the clip name comes from
 * the command line, not from the file.
 *
 * Exports `mergeAnimations` for `optimize-assets.mjs`; run directly to write a
 * file and print what moved:
 *
 *   node scripts/merge-animations.mjs assets/raw/erika_archer.glb out.glb \
 *     Run=assets/raw/anim_run.glb Shoot=assets/raw/anim_shoot.glb:upper Death=assets/raw/anim_dead.glb
 */
import { fileURLToPath } from "node:url";
import * as THREE from "three";
import { NodeIO } from "@gltf-transform/core";
import { mergeDocuments, prune } from "@gltf-transform/functions";

/**
 * Bones below the waist. A clip tagged `:upper` drops them, which is what lets
 * three's mixer keep taking the legs from Idle or Run while the upper body
 * plays a shot — Mixamo's aim clips are full-body and would otherwise freeze
 * the feet. Same reasoning as the finger-channel drop in optimize-assets.mjs.
 */
const LOWER_BODY = /^(Hips|(Left|Right)(UpLeg|Leg|Foot|ToeBase|Toe_End))$/;

/**
 * Bones whose translation is worth keeping: only the root ever moves, and
 * every other joint's translation is its bind offset repeated per frame.
 *
 * `inPlace` drops even that one. A locomotion clip downloaded without Mixamo's
 * "In Place" box ticked walks the hips forward — 1.58 m per 0.7 s loop for the
 * Running download — and the game already moves the character from the
 * joystick, so the clip would slide it away from its own position.
 */
const TRANSLATED = /^Hips$/;

/**
 * Bone key a channel targets, with every converter's decoration stripped:
 * `mixamorig:Hips` (FBX2glTF), `mixamorigHips` (three's GLTFExporter sanitizes
 * the colon away) and `Hips_01` (an FBX round-tripped through Sketchfab, which
 * suffixes every joint with its index) all have to meet at `Hips`.
 */
const boneKey = (name) =>
  name
    .split(":")
    .pop()
    .replace(/^mixamorig\d*/, "")
    .replace(/_\d+$/, "");

function indexNodes(doc) {
  const byKey = new Map();
  for (const node of doc.getRoot().listNodes()) {
    byKey.set(boneKey(node.getName()), node);
  }
  return byKey;
}

/**
 * Disposing a channel leaves its sampler attached, and the sampler keeps its
 * keyframe accessors alive, so prune still sees the data as used.
 */
function dropOrphanSamplers(animation) {
  const used = new Set(animation.listChannels().map((c) => c.getSampler()));
  let dropped = 0;
  for (const sampler of animation.listSamplers()) {
    if (!used.has(sampler)) {
      sampler.dispose();
      dropped++;
    }
  }
  return dropped;
}

/**
 * Pulls one clip out of `source` and onto `target`'s rig.
 *
 * `upperOnly` keeps the clip layerable; `keepScale` is off because an FBX
 * export writes a constant unit scale channel per joint and nothing reads it.
 */
function retarget(target, source, { name, upperOnly = false, inPlace = false, keepScale = false }) {
  const sourceRoot = source.getRoot();
  const clips = sourceRoot.listAnimations();
  if (clips.length === 0) throw new Error(`${name}: source has no animation`);
  // Mixamo ships one clip per download; a T-pose export can carry a stray
  // 1-frame clip, so the longest is the real one.
  const longest = clips.reduce((best, clip) =>
    clipLength(clip) > clipLength(best) ? clip : best,
  );

  // Indexed BEFORE the merge: afterwards the master holds two bones per name
  // — its own and the imported rig's — and the later one wins the lookup, so
  // every channel would retarget onto the copy that is about to be disposed.
  const bones = indexNodes(target);
  // The clip's own rest pose, read before the merge for the same reason the
  // bone index is: afterwards both rigs live in one document.
  const restPose = indexNodes(source);
  const scale = rigScale(bones.get("Hips"), restPose.get("Hips"));
  const map = mergeDocuments(target, source);
  const animation = map.get(longest);

  const stats = {
    name,
    retargeted: 0,
    missing: new Set(),
    dropped: 0,
    unitRatio: hipsUnitRatio(animation, bones.get("Hips")),
  };
  // A clip exported in centimetres against a metre-scaled armature retargets
  // channel for channel and then throws the corpse off the floor. The ratio is
  // the only cheap tell, and it is only cheap before anyone looks at it in a
  // viewer.
  if (stats.unitRatio !== null && (stats.unitRatio > 10 || stats.unitRatio < 0.1)) {
    console.warn(
      `  ${name}: Hips translation is ${stats.unitRatio.toFixed(1)}x the master's` +
        ` rest offset — mesh and clip came from different converters?`,
    );
  }
  // Every channel is retargeted and rebased FIRST, and only then are the
  // unwanted ones dropped. Dropping early looks equivalent and is not: the
  // rebase reads the whole skeleton at each instant, so removing the hips
  // before it runs leaves the upper body hanging off a rest-pose pelvis — a
  // layered Shoot clip then aims the wrong way round.
  const spare = [];
  for (const channel of animation.listChannels()) {
    const from = channel.getTargetNode();
    const key = from ? boneKey(from.getName()) : "";
    const path = channel.getTargetPath();
    const to = bones.get(key);
    if (!to) {
      // A clip bone with no home in the master means the two were rigged
      // differently; dropping it silently would give a half-playing clip.
      stats.missing.add(key);
      channel.dispose();
      continue;
    }
    channel.setTargetNode(to);
    stats.retargeted++;
    const unwanted =
      (upperOnly && LOWER_BODY.test(key)) ||
      (path === "scale" && !keepScale) ||
      (path === "translation" && (inPlace || !TRANSLATED.test(key)));
    if (unwanted) spare.push(channel);
  }
  dropOrphanSamplers(animation);
  unifyTimeline(target, animation);
  rebaseClip(animation, bones, restPose, scale, upperOnly);

  for (const channel of spare) {
    channel.dispose();
    stats.retargeted--;
    stats.dropped++;
  }
  dropOrphanSamplers(animation);
  animation.setName(name);

  // Everything the merge brought except the clip itself: the imported rig,
  // its scenes, its mesh. The channels now point into the master, so the
  // source nodes are safe to drop and prune sweeps the rest.
  for (const scene of sourceRoot.listScenes()) {
    const merged = map.get(scene);
    if (!merged) continue;
    const walk = (node) => {
      for (const child of node.listChildren()) walk(child);
      node.dispose();
    };
    for (const child of merged.listChildren()) walk(child);
    merged.dispose();
  }
  // The other clips a download can carry (a T-pose export ships a 1-frame
  // one): their channels still point at nodes just disposed, so they would
  // survive as empty animations.
  for (const clip of clips) {
    if (clip !== longest) map.get(clip)?.dispose();
  }

  if (stats.missing.size > 0) {
    throw new Error(
      `${name}: master rig has no bone for ${[...stats.missing].join(", ")}` +
        ` — the clip was retargeted to a different skeleton`,
    );
  }
  return stats;
}

/**
 * Clip Hips translation over master Hips rest translation, or null when either
 * is absent. Both are in whatever unit their exporter chose, so only the ratio
 * carries information.
 */
function hipsUnitRatio(animation, masterHips) {
  if (!masterHips) return null;
  const rest = Math.hypot(...masterHips.getTranslation());
  if (rest < 1e-6) return null;
  for (const channel of animation.listChannels()) {
    const node = channel.getTargetNode();
    if (!node || channel.getTargetPath() !== "translation") continue;
    if (boneKey(node.getName()) !== "Hips") continue;
    const out = channel.getSampler().getOutput()?.getArray();
    if (!out || out.length < 3) return null;
    return Math.hypot(out[0], out[1], out[2]) / rest;
  }
  return null;
}

/**
 * Rebases a channel's keyframes from the clip's bind pose onto the master's.
 *
 * A glTF rotation channel stores each bone's ABSOLUTE local rotation, which is
 * only meaningful against the rig it was authored on. Two rigs can share every
 * bone name and still disagree about rest: Mixamo's own export leaves
 * `LeftUpLeg` resting at a 180-degree flip, while the same character exported
 * through Sketchfab rests at identity and hides that flip in the inverse bind
 * matrices. Copying the keys across then puts the legs on backwards — visibly,
 * pointing at the sky.
 *
 * So each key is converted to the motion it represents, `inverse(sourceRest) *
 * key`, and re-applied to the master's rest: `targetRest * inverse(sourceRest)
 * * key`. Rigs that already agree get a no-op, which is why this runs
 * unconditionally rather than behind a flag.
 *
 * Translation is rebased the same way and scaled by the two rigs' hip heights,
 * so a fall that drops 90 cm on a 166-unit skeleton still drops 90 cm here.
 */
/**
 * Puts every channel of a clip on one shared timeline.
 *
 * three's GLTFExporter thins each track independently, so a clip arrives with
 * sixty samplers holding sixty different key counts. Model-space rebasing has
 * to look at the whole skeleton at one instant, which that representation
 * cannot answer. The union of all key times is used rather than a fixed rate,
 * so nothing is lost here; `resample()` in the asset pipeline thins it again
 * afterwards.
 */
function unifyTimeline(doc, animation) {
  const times = new Set();
  for (const sampler of animation.listSamplers()) {
    if (sampler.getInterpolation() !== "LINEAR") {
      throw new Error(`${sampler.getInterpolation()} interpolation is not handled`);
    }
    for (const time of sampler.getInput().getArray()) times.add(time);
  }
  const timeline = [...times].sort((a, b) => a - b);

  const buffer = doc.getRoot().listBuffers()[0];
  const input = doc
    .createAccessor("time")
    .setType("SCALAR")
    .setArray(new Float32Array(timeline))
    .setBuffer(buffer);

  for (const sampler of animation.listSamplers()) {
    const oldInput = sampler.getInput().getArray();
    const output = sampler.getOutput();
    const size = output.getElementSize();
    const old = output.getArray();
    const resampled = new Float32Array(timeline.length * size);
    const rotation = size === 4;

    for (let i = 0; i < timeline.length; i++) {
      const time = timeline[i];
      // The keys are sorted, so a linear scan over the whole clip is O(n+m).
      let next = 0;
      while (next < oldInput.length && oldInput[next] < time) next++;
      const after = Math.min(next, oldInput.length - 1);
      const before = Math.max(after - 1, 0);
      const span = oldInput[after] - oldInput[before];
      const t = span > 1e-9 ? (time - oldInput[before]) / span : 0;
      if (rotation) {
        const a = new THREE.Quaternion().fromArray(old, before * 4);
        const b = new THREE.Quaternion().fromArray(old, after * 4);
        a.slerp(b, t).toArray(resampled, i * 4);
      } else {
        for (let c = 0; c < size; c++) {
          const a = old[before * size + c];
          resampled[i * size + c] = a + (old[after * size + c] - a) * t;
        }
      }
    }
    output.setArray(resampled);
    sampler.setInput(input);
  }
}

/**
 * Rebases a whole clip from the rig it was authored on onto the master's rig.
 *
 * A glTF rotation channel stores a bone's ABSOLUTE local rotation, which only
 * means anything against that rig's rest pose AND its parent chain. Two rigs
 * can share every bone name and still disagree: Mixamo's export rests
 * `LeftUpLeg` at a 180-degree flip, while the same character round-tripped
 * through Sketchfab rests at identity and hides the difference in its inverse
 * bind matrices. Copy the keys across and the legs point at the sky.
 *
 * Rebasing one channel at a time does not fix it either, because a bone's
 * local frame is only meaningful relative to everything above it. So the work
 * happens in model space — the rig's own space, below any scene wrapper:
 *
 *   D       = sourceModel(bone) * inverse(sourceBindModel(bone))
 *   wanted  = D * targetBindModel(bone)
 *   local   = inverse(wanted of parent) * wanted
 *
 * D is the motion the clip actually describes, free of either rig's rest pose.
 * Rigs that already agree get an identity D, which is why this runs
 * unconditionally instead of behind a flag.
 *
 * Hips translation is rebased the same way and scaled by the two rigs' hip
 * heights, so a fall that drops 90 cm on a 166-unit skeleton drops 90 cm here.
 */
function rebaseClip(animation, bones, restPose, scale, foldRoot) {
  const sourceHips = restPose.get("Hips");
  const targetHips = bones.get("Hips");
  if (!sourceHips || !targetHips) return;

  /** Channels by bone key, now that they target the master. */
  const tracks = new Map();
  for (const channel of animation.listChannels()) {
    const node = channel.getTargetNode();
    if (!node) continue;
    const key = boneKey(node.getName());
    const entry = tracks.get(key) ?? {};
    entry[channel.getTargetPath()] = channel.getSampler().getOutput();
    tracks.set(key, entry);
  }

  const rotationTracks = [...tracks.values()].filter((t) => t.rotation);
  if (rotationTracks.length === 0) return;
  const frames = rotationTracks[0].rotation.getCount();
  for (const track of rotationTracks) {
    if (track.rotation.getCount() !== frames) {
      // Mixamo bakes one key per frame on every bone, so unequal lengths mean
      // the clip was resampled upstream and the frames no longer line up.
      throw new Error("clip channels disagree on keyframe count");
    }
  }

  // Each rig's rest pose in its own model space, computed once.
  const sourceBind = modelRotations(sourceHips, () => null);
  const targetBind = modelRotations(targetHips, () => null);

  // The two rigs' model spaces need not agree: Mixamo's Vanguard rests its
  // hips at -180 degrees about X relative to a clip rig that rests at
  // identity. A motion measured in one space has to be carried into the other
  // or the whole character tips over, so it is conjugated by the constant
  // difference between the two hips binds. Rigs that already agree get an
  // identity here, which is the Erika case.
  const align = targetBind.get("Hips").clone().multiply(sourceBind.get("Hips").clone().invert());
  const alignInverse = align.clone().invert();

  // Scratch buffers: a clip is a few hundred frames times sixty bones, and
  // allocating a quaternion per bone per frame is the one thing here that
  // would actually show up in a profile.
  const quaternion = new THREE.Quaternion();
  const motion = new THREE.Quaternion();
  const wanted = new THREE.Quaternion();
  const local = new THREE.Quaternion();
  const values = new Map();
  for (const [key, track] of tracks) {
    for (const [path, accessor] of Object.entries(track)) {
      values.set(`${key}.${path}`, accessor.getArray().slice());
    }
  }

  for (let frame = 0; frame < frames; frame++) {
    const sourceModel = modelRotations(sourceHips, (key) => {
      const array = values.get(`${key}.rotation`);
      return array ? quaternion.fromArray(array, frame * 4).clone() : null;
    });

    const targetModel = new Map();
    const walk = (node, parentModel) => {
      const key = boneKey(node.getName());
      const bind = targetBind.get(key);
      const source = sourceModel.get(key);
      const sourceRest = sourceBind.get(key);
      const animated = values.has(`${key}.rotation`);

      if (animated && bind && source && sourceRest) {
        motion.copy(source).multiply(sourceRest.clone().invert());
        motion.premultiply(align).multiply(alignInverse);
        wanted.copy(motion).multiply(bind);
      } else {
        wanted.copy(parentModel).multiply(new THREE.Quaternion().fromArray(node.getRotation()));
      }
      if (animated) {
        local.copy(parentModel).invert().multiply(wanted).normalize();
        local.toArray(values.get(`${key}.rotation`), frame * 4);
      }
      targetModel.set(key, wanted.clone());
      for (const child of node.listChildren()) walk(child, targetModel.get(key));
    };
    walk(targetHips, new THREE.Quaternion());
  }

  if (foldRoot) foldHipsIntoSpine(values, targetHips, frames);

  // Hips translation: the one channel that carries a position rather than a
  // pose, so it is offset from each rig's own hips and scaled between them.
  const hipsTranslation = values.get("Hips.translation");
  if (hipsTranslation) {
    const from = new THREE.Vector3().fromArray(sourceHips.getTranslation());
    const to = new THREE.Vector3().fromArray(targetHips.getTranslation());
    const key = new THREE.Vector3();
    for (let i = 0; i < hipsTranslation.length; i += 3) {
      key
        .fromArray(hipsTranslation, i)
        .sub(from)
        .multiplyScalar(scale)
        .add(to)
        .toArray(hipsTranslation, i);
    }
  }

  for (const [path, array] of values) {
    const [key, which] = path.split(".");
    tracks.get(key)[which].setArray(array);
  }
}

/**
 * Moves the hips' own rotation down into the spine, for a clip whose hips
 * channel is about to be dropped.
 *
 * A bone's rotation is relative to its parent, so simply deleting the hips
 * channel silently re-orients everything above it. Mixamo's aim clips blade
 * the pelvis — 91 degrees for "Standing Aim Recoil" — and dropping that turn
 * leaves the arms pointing out to the sides instead of down the line of fire.
 *
 * Preserving what the clip meant costs one multiply per frame: the hips go
 * back to rest and the spine absorbs the difference,
 * `spine' = inverse(hipsRest) * hipsKey * spine`, which is what makes the
 * clip layerable over whatever pelvis Idle or Run supplies.
 */
function foldHipsIntoSpine(values, hipsNode, frames) {
  const hipsKeys = values.get("Hips.rotation");
  if (!hipsKeys) return;
  const rest = new THREE.Quaternion().fromArray(hipsNode.getRotation()).invert();

  const children = hipsNode
    .listChildren()
    .map((node) => boneKey(node.getName()))
    .filter((key) => !LOWER_BODY.test(key) && values.has(`${key}.rotation`));

  const hips = new THREE.Quaternion();
  const child = new THREE.Quaternion();
  for (let frame = 0; frame < frames; frame++) {
    hips.fromArray(hipsKeys, frame * 4).premultiply(rest);
    for (const key of children) {
      const keys = values.get(`${key}.rotation`);
      child.fromArray(keys, frame * 4).premultiply(hips).normalize().toArray(keys, frame * 4);
    }
  }
}

/**
 * Rotation of every bone relative to the rig root, for one pose. `rotationOf`
 * supplies a bone's local rotation, or null to use its rest. Model space, not
 * world: it starts at the hips, so a scene wrapper's own rotation — Sketchfab
 * adds a -90 degree X — never enters the comparison between two rigs.
 */
function modelRotations(hips, rotationOf) {
  const model = new Map();
  const walk = (node, parent) => {
    const key = boneKey(node.getName());
    const local = rotationOf(key) ?? new THREE.Quaternion().fromArray(node.getRotation());
    const here = parent.clone().multiply(local);
    model.set(key, here);
    for (const child of node.listChildren()) walk(child, here);
  };
  walk(hips, new THREE.Quaternion());
  return model;
}

/** Hip height ratio between the two rigs, the one number that converts a
 *  clip's root motion into the master's units. */
function rigScale(masterHips, clipHips) {
  if (!masterHips || !clipHips) return 1;
  const from = Math.hypot(...clipHips.getTranslation());
  const to = Math.hypot(...masterHips.getTranslation());
  return from < 1e-6 ? 1 : to / from;
}

function clipLength(clip) {
  let last = 0;
  for (const sampler of clip.listSamplers()) {
    const input = sampler.getInput()?.getArray();
    if (input && input.length) last = Math.max(last, input[input.length - 1]);
  }
  return last;
}

/**
 * A GLB may hold exactly one buffer, and every merge brings another along.
 */
function collapseBuffers(doc) {
  const [buffer, ...extra] = doc.getRoot().listBuffers();
  for (const accessor of doc.getRoot().listAccessors()) accessor.setBuffer(buffer);
  for (const spare of extra) spare.dispose();
}

/**
 * @param {import('@gltf-transform/core').NodeIO} io
 * @param {string|import('@gltf-transform/core').Document} master
 *        skinned mesh, the rig everything retargets onto — a path, or an
 *        already-built Document when a longer pipeline owns the reading
 * @param {{name: string, file: string, upperOnly?: boolean}[]} clips
 */
export async function mergeAnimations(io, master, clips) {
  const doc = typeof master === "string" ? await io.read(master) : master;
  const report = [];
  for (const clip of clips) {
    const source = await io.read(clip.file);
    report.push(retarget(doc, source, clip));
  }
  collapseBuffers(doc);
  await doc.transform(prune({ keepAttributes: false, keepLeaves: false }));
  return { doc, report };
}

/** `Name=path/to.glb`, with `:upper` and/or `:inplace` appended. */
function parseSpec(arg) {
  const at = arg.indexOf("=");
  if (at < 0) throw new Error(`expected Name=file.glb, got "${arg}"`);
  const name = arg.slice(0, at);
  const rest = arg.slice(at + 1);
  const flags = new Set();
  let file = rest;
  for (;;) {
    const match = /:(upper|inplace)$/.exec(file);
    if (!match) break;
    flags.add(match[1]);
    file = file.slice(0, -match[0].length);
  }
  return { name, file, upperOnly: flags.has("upper"), inPlace: flags.has("inplace") };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [master, out, ...specs] = process.argv.slice(2);
  if (!master || !out || specs.length === 0) {
    console.error(
      "usage: node scripts/merge-animations.mjs <master.glb> <out.glb>" +
      " Name=clip.glb[:upper][:inplace] ...",
    );
    process.exit(1);
  }
  const io = new NodeIO();
  const { doc, report } = await mergeAnimations(io, master, specs.map(parseSpec));
  await io.write(out, doc);
  for (const stat of report) {
    console.log(
      `  ${stat.name.padEnd(8)} ${stat.retargeted} channels retargeted, ${stat.dropped} dropped` +
        (stat.unitRatio === null ? "" : `, hips units x${stat.unitRatio.toFixed(2)}`),
    );
  }
  console.log(
    `${out}: clips ${doc
      .getRoot()
      .listAnimations()
      .map((a) => `${a.getName()}(${clipLength(a).toFixed(2)}s)`)
      .join(" ")}`,
  );
}
