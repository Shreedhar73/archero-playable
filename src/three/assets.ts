// Bundled assets. At build time every byte is base64 encoded into single html file

import {
  type GLTF,
  GLTFLoader,
} from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import archerUrl from "../../assets/archer_playable.glb";
import enemyURL from "../../assets/enemy.glb";

/**
 * Every model is EXT_meshopt_compression, so the decoder is not optional —
 * GLTFLoader throws without it. It is one 29 KB module with its wasm embedded
 * as base64, which is why meshopt won over Draco here: Draco's decoder is 250
 * KB of wasm and wrapper, more than the geometry it would have saved.
 */
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);

/**
 * Loads the archer: Erika with Idle, Run, Shoot and Death retargeted onto her
 * rig by `scripts/build-playable.mjs`. Awaited during boot, so every clip is
 * resident before the first frame.
 */
export function loadArcher(): Promise<GLTF> {
  return loader.loadAsync(archerUrl);
}

/** Loads the melee enemy. Same loader instance as archer  and iss stateless config*/
export function loadEnemy(): Promise<GLTF> {
  return loader.loadAsync(enemyURL);
}
