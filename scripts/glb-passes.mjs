/**
 * Passes shared by the asset builds. Every byte ships as base64 at ~1.33x, and
 * stock models carry plenty the game never renders.
 */

// Mixamo finger bones are HandThumb1..; 3ds Max Biped uses "Bip001 L Finger01".
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
 * Disposing a channel leaves its sampler on the clip, and the sampler keeps its
 * accessors alive, so prune keeps the data. Dispose samplers no channel uses.
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

/** Secondary UV sets are for lightmaps the game does not use. */
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

/** Normal maps read as noise from this camera. */
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

/** Decimal MB of base64 for `n` binary bytes. */
export const base64MB = (n) => ((Math.ceil(n / 3) * 4) / 1e6).toFixed(2);
