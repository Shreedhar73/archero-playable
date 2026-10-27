// Bundled assets. At build time every byte is base64 encoded into single html file

import {
  type GLTF,
  GLTFLoader,
} from "three/examples/jsm/loaders/GLTFLoader.js";
import archerUrl from "../../assets/archer.glb";
import enemyURL from "../../assets/enemy.glb";

const loader = new GLTFLoader();

/** Loads the archer . Awaited during boot, so are preloaded when game starts */
export function loadArcher(): Promise<GLTF> {
  return loader.loadAsync(archerUrl);
}

/** Loads the melee enemy. Same loader instance as archer  and iss stateless config*/
export function loadEnemy(): Promise<GLTF> {
  return loader.loadAsync(enemyURL);
}
