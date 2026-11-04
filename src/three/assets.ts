// Bundled assets. At build time every byte is base64 encoded into single html file

import {
  type GLTF,
  GLTFLoader,
} from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import rogueUrl from "../../assets/skeleton_rogue.glb";
import heroUrl from "../../assets/archero_hero.glb";
import warriorUrl from "../../assets/skeleton_warrior.glb";
import arrowUrl from "../../assets/arrow.glb";
import treeUrl from "../../assets/tree.glb";
import rockUrl from "../../assets/rock.glb";
import mushroomUrl from "../../assets/mushroom.glb";
import pineUrl from "../../assets/low_poly_pine.glb";

// Every model uses EXT_meshopt_compression; GLTFLoader throws without the decoder.
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);

/** Ranged enemy: KayKit Skeleton Rogue with crossbow, clips Idle/Run/Attack/Death. */
export function loadRogue(): Promise<GLTF> {
  return loader.loadAsync(rogueUrl);
}

/** Player: Sketchfab chibi hero with Mixamo clips and the bow in its left hand. */
export function loadHero(): Promise<GLTF> {
  return loader.loadAsync(heroUrl);
}

/** Melee enemy: KayKit Skeleton Warrior with blade, same clip names. */
export function loadWarrior(): Promise<GLTF> {
  return loader.loadAsync(warriorUrl);
}


export function loadArrow(): Promise<GLTF> {
  return loader.loadAsync(arrowUrl);
}

/** Canopy blob, rock, mushroom and pine. `Scenery` needs all of them. */
export function loadScenery(): Promise<[GLTF, GLTF, GLTF, GLTF]> {
  return Promise.all([
    loader.loadAsync(treeUrl),
    loader.loadAsync(rockUrl),
    loader.loadAsync(mushroomUrl),
    loader.loadAsync(pineUrl),
  ]);
}
