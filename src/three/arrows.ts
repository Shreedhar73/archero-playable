import { Group, Mesh, MeshStandardMaterial, Object3D } from "three";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { PROJECTILE_COUNT } from "../config.ts";
import type { Projectile } from "../game/projectiles.ts";

/** Bow height on a 1.83-unit archer. At 0.55 the arrows left from the knees. */
const FLIGHT_HEIGHT = 1.05;

/** Source mesh is 0.403 long on Z; this brings it to roughly half a unit. */
const SCALE = 1.3;


/**
 * One clone per pool slot, built at boot and hidden rather than removed.
 *
 * Object3D.clone() is correct here, unlike the enemies: the arrow is a plain
 * mesh with no skeleton, so the clones share geometry and material and own
 * nothing but a transform.
 */
export class ArrowViews {
  readonly root = new Group();
  private readonly views: Object3D[] = [];

  constructor(gltf: GLTF) {
    // Shared across every clone, like the cylinder's was: the slots are
    // identical, which is the case material sharing exists for.
    const material = new MeshStandardMaterial({
      color: 0xf2e2b0,
      metalness: 0,
      roughness: 0.6,
    });

    for (let i = 0; i < PROJECTILE_COUNT; i++) {
      const view = gltf.scene.clone();
      view.scale.setScalar(SCALE);
      view.visible = false;
      view.traverse((node) => {
        node.castShadow = true;
      });
      view.traverse((node) => {
        if (node instanceof Mesh) node.material = material;
      });
      this.views.push(view);
      this.root.add(view);
    }
  }

  sync(index: number, arrow: Projectile): void {
    const view = this.views[index];
    view.visible = arrow.alive;
    if (!arrow.alive) return;
    view.position.set(arrow.x, FLIGHT_HEIGHT, arrow.z);
    view.rotation.y = Math.atan2(arrow.dirX, arrow.dirZ);
  }
}
