import { Group, Mesh, MeshStandardMaterial, Object3D } from "three";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { PROJECTILE_COUNT } from "../config.ts";
import type { Projectile } from "../game/projectiles.ts";

/** Bow height on the archer. */
const FLIGHT_HEIGHT = 1.05;

/** Source mesh is 0.403 long on Z; this brings it to about half a unit. */
const SCALE = 1.3;

/** Enemy arrows need to read while still far enough away to dodge. */
const FRIENDLY = 0xf2e2b0;
const HOSTILE = 0xff5a3c;

/**
 * One clone per pool slot, built at boot and hidden rather than removed.
 * Object3D.clone() is fine here: no skeleton, so clones share geometry.
 */
export class ArrowViews {
  readonly root = new Group();
  private readonly views: Object3D[] = [];
  private readonly materials: MeshStandardMaterial[] = [];
  private readonly hostile: boolean[] = [];
  /** Last alive position per slot, for placing the impact after the arrow ends. */
  private readonly lastX: number[] = [];
  private readonly lastZ: number[] = [];
  private readonly wasAlive: boolean[] = [];

  constructor(gltf: GLTF) {
    for (let i = 0; i < PROJECTILE_COUNT; i++) {
      const view = gltf.scene.clone();
      view.scale.setScalar(SCALE);
      view.visible = false;
      view.traverse((node) => {
        node.castShadow = true;
      });
      // One material per slot: the loaded prop shares one across clones.
      const material = new MeshStandardMaterial({
        color: FRIENDLY,
        metalness: 0,
        roughness: 0.6,
      });
      view.traverse((node) => {
        if (node instanceof Mesh) node.material = material;
      });
      this.materials.push(material);
      this.hostile.push(false);
      this.lastX.push(0);
      this.lastZ.push(0);
      this.wasAlive.push(false);
      this.views.push(view);
      this.root.add(view);
    }
  }

  /**
   * Returns true on the frame this slot went from alive to dead. That edge is
   * the impact; the simulation stores nothing extra for it.
   */
  sync(index: number, arrow: Projectile): boolean {
    const view = this.views[index];
    view.visible = arrow.alive;
    const ended = this.wasAlive[index] && !arrow.alive;
    this.wasAlive[index] = arrow.alive;
    if (!arrow.alive) return ended;
    if (arrow.hostile !== this.hostile[index]) {
      this.hostile[index] = arrow.hostile;
      this.materials[index].color.setHex(arrow.hostile ? HOSTILE : FRIENDLY);
    }
    this.lastX[index] = arrow.x;
    this.lastZ[index] = arrow.z;
    view.position.set(arrow.x, FLIGHT_HEIGHT, arrow.z);
    view.rotation.y = Math.atan2(arrow.dirX, arrow.dirZ);
    return ended;
  }

  /** Only meaningful on the frame `sync` returned true. */
  endedX(index: number): number {
    return this.lastX[index];
  }

  endedZ(index: number): number {
    return this.lastZ[index];
  }
}
