/**
 * Binds a named clip to a mixer.
 */

import {
  AnimationClip,
  type AnimationAction,
  type AnimationMixer,
} from "three";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";

export function action(
  mixer: AnimationMixer,
  gltf: GLTF,
  name: string,
): AnimationAction {
  const clip = AnimationClip.findByName(gltf.animations, name);
  if (!clip) {
    const have = gltf.animations.map((c) => c.name).join(",");
    throw new Error(`no "${name}" clip; asset have : ${have}`);
  }
  return mixer.clipAction(clip);
}
