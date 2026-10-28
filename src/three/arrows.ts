import {
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  Object3D,
} from "three";
import { PROJECTILE_COUNT } from "../config.ts";
import type { Projectile } from "../game/projectiles.ts";

/** Arrows fly flat, a little above the floor so they read against the grass. */
const FLIGHT_HEIGHT = 0.55;
const LENGTH = 0.5;

/**
 * One mesh per pool slot, built at boot and hidden rather than removed.
 * Geometry and material are shared across all of them — the slots are
 * identical, which is exactly the case geometry sharing exists for.
 */
export class ArrowViews {
  readonly root = new Group();
  private readonly views: Object3D[] = [];

  constructor() {
    // Built lying along +Z so rotation.y maps straight onto flight direction.
    const geometry = new CylinderGeometry(0.035, 0.015, LENGTH, 5);
    geometry.rotateX(Math.PI / 2);
    const material = new MeshStandardMaterial({ color: 0xf2e2b0 });

    for (let i = 0; i < PROJECTILE_COUNT; i++) {
      const mesh = new Mesh(geometry, material);
      mesh.visible = false;
      mesh.castShadow = true;
      this.views.push(mesh);
      this.root.add(mesh);
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
