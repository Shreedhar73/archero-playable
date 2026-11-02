import { CircleGeometry, Group, Mesh, MeshBasicMaterial } from "three";

/**
 * White puff where an arrow stops: a disc on the ground that grows and fades.
 * Pooled at boot. Flat on the floor rather than billboarded, since the camera moves.
 */
const LIFE = 0.22;
const START = 0.18;
const END = 0.62;
/** Above the floor plane to avoid z-fighting. */
const HEIGHT = 0.03;

const geometry = new CircleGeometry(1, 12);

export class Impacts {
  readonly root = new Group();
  private readonly meshes: Mesh[] = [];
  private readonly materials: MeshBasicMaterial[] = [];
  /** Seconds of life left per slot. 0 is free. */
  private readonly left: number[] = [];
  private next = 0;

  constructor(count: number) {
    for (let i = 0; i < count; i++) {
      const material = new MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      });
      const mesh = new Mesh(geometry, material);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.y = HEIGHT;
      mesh.visible = false;
      this.meshes.push(mesh);
      this.materials.push(material);
      this.left.push(0);
      this.root.add(mesh);
    }
  }

  /** Round-robin: the oldest puff is the one to lose when several land at once. */
  pop(x: number, z: number): void {
    const i = this.next;
    this.next = (this.next + 1) % this.meshes.length;
    this.meshes[i].position.set(x, HEIGHT, z);
    this.left[i] = LIFE;
  }

  advance(dt: number): void {
    for (let i = 0; i < this.meshes.length; i++) {
      if (this.left[i] <= 0) continue;
      this.left[i] -= dt;
      const gone = 1 - Math.max(0, this.left[i]) / LIFE;
      const mesh = this.meshes[i];
      mesh.visible = this.left[i] > 0;
      mesh.scale.setScalar(START + (END - START) * gone);
      // Fades faster than it grows: a widening edge, not a disc blinking off.
      this.materials[i].opacity = 0.75 * (1 - gone) * (1 - gone);
    }
  }
}
