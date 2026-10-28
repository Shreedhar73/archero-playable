/**
 * Passes shared by the two asset builds: `optimize-assets.mjs` for the props
 * and the melee enemy, `build-archer.mjs` for the player's own model.
 *
 * The bundle is one inlined HTML file, so every byte here costs ~1.33 bytes
 * base64 in dist/. Stock Mixamo and three.js models carry a lot this playable
 * never renders: unused UV sets, a normal map invisible at a top-down camera,
 * finger-bone channels, and clips for states that do not exist.
 */

/** Mixamo rigs animate every finger joint; nothing here is ever that close. */
// Mixamo names finger bones HandThumb1..; 3ds Max Biped rigs name them
// "Bip001 L Finger01". Both are detail no camera at this distance resolves.
const FINGER = /Hand(Thumb|Index|Middle|Ring|Pinky)\d|Finger\d/;

export function dropClips(doc, keep) {
  for (const anim of doc.getRoot().listAnimations()) {
    if (!keep.includes(anim.getName())) anim.dispose();
  }
}

export function dropFingerChannels(doc) {
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
export function dropOrphanSamplers(doc) {
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
export function dropExtraTexcoords(doc) {
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
export function dropNormalMaps(doc) {
  let dropped = 0;
  for (const material of doc.getRoot().listMaterials()) {
    if (material.getNormalTexture()) {
      material.setNormalTexture(null);
      dropped++;
    }
  }
  return dropped;
}

/** Decimal MB of the base64 the bundle will carry for `n` binary bytes. */
export const base64MB = (n) => ((Math.ceil(n / 3) * 4) / 1e6).toFixed(2);
