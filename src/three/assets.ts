// Bundled assets. At build time every byte is base64 encoded into single html file

import {
  type GLTF,
  GLTFLoader,
} from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import archerUrl from "../../assets/archer_playable.glb";
import enemyURL from "../../assets/enemy.glb";
import arrowUrl from "../../assets/arrow.glb";
import treeUrl from "../../assets/tree.glb";
import rockUrl from "../../assets/rock.glb";
import mushroomUrl from "../../assets/mushroom.glb";

/**
 * Every model is EXT_meshopt_compression, so the decoder is not optional —
 * GLTFLoader throws without it. It is one 29 KB module with its wasm embedded
 * as base64, which is why meshopt won over Draco here: Draco's decoder is 250
 * KB of wasm and wrapper, more than the geometry it would have saved.
 */
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);

/**
 * Loads the archer: Erika with Idle, Run, Shoot and Death, merged onto her
 * rig by `scripts/fbx-merge.mjs` and named by `scripts/build-archer.mjs`.
 * Awaited during boot, so every clip is resident before the first frame.
 *
 * The enemy archers clone this same GLTF — see `EnemyViews` — so a clip
 * dropped here is dropped for both sides.
 */
export function loadArcher(): Promise<GLTF> {
  return loader.loadAsync(archerUrl);
}

/** Loads the melee enemy. Same loader instance as archer  and iss stateless config*/
export function loadEnemy(): Promise<GLTF> {
  return loader.loadAsync(enemyURL);
}


/** Arrow prop from the client's mesh set: 1.6 KB after the pipeline. */
export function loadArrow(): Promise<GLTF> {
  return loader.loadAsync(arrowUrl);
}

/**
 * Scenery props from the client's mesh set: a canopy blob, a rock slab and a
 * mushroom cap, 18 KB between them. Loaded together because `Scenery` wants
 * all three at construction and none is any use alone.
 */
export function loadScenery(): Promise<[GLTF, GLTF, GLTF]> {
  return Promise.all([
    loader.loadAsync(treeUrl),
    loader.loadAsync(rockUrl),
    loader.loadAsync(mushroomUrl),
  ]);
}
