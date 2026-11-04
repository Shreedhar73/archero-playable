import { Group, Mesh, MeshBasicMaterial, PlaneGeometry } from "three";
import { STEP_LENGTH } from "../config.ts";
import type { Player } from "../game/player.ts";
import { cloudTexture } from "./textures.ts";

/**
 * Dust behind the running hero: one puff per footstep, left where it was made.
 * Spawns on the same `STEP_LENGTH` the footstep sound uses. Sizes and timing
 * are from the game recording. Pooled like `Impacts`, flat on the floor.
 */
const LIFE = 0.7;
const START = 0.6;
const END = 0.9;
/** Distance behind the feet, along the direction of travel. */
const BEHIND = 0.18;
/** Above the floor plane and under the marker ring and impact puffs (0.03). */
const HEIGHT = 0.06;

const geometry = new PlaneGeometry(1, 1);

export class Dust {
  readonly root = new Group();
  private readonly meshes: Mesh[] = [];
  private readonly materials: MeshBasicMaterial[] = [];
  private readonly left: number[] = [];
  private next = 0;
  /** Tracked here rather than read from audio, so the renderer owns nothing audio reads. */
  private lastX = 0;
  private lastZ = 0;
  private travelled = 0;
  private primed = false;

  constructor(count: number) {
    const map = cloudTexture();
    for (let i = 0; i < count; i++) {
      const material = new MeshBasicMaterial({
        map,
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

  /** Spawns on ground covered, not stick input, so a body held against a wall makes no dust. */
  track(player: Player): void {
    if (!this.primed) {
      this.lastX = player.x;
      this.lastZ = player.z;
      this.primed = true;
      return;
    }
    const dx = player.x - this.lastX;
    const dz = player.z - this.lastZ;
    this.lastX = player.x;
    this.lastZ = player.z;
    this.travelled += Math.hypot(dx, dz);
    if (this.travelled < STEP_LENGTH) return;
    this.travelled -= STEP_LENGTH;
    const len = Math.hypot(dx, dz) || 1;
    this.pop(player.x - (dx / len) * BEHIND, player.z - (dz / len) * BEHIND);
  }

  private pop(x: number, z: number): void {
    const i = this.next;
    this.next = (this.next + 1) % this.meshes.length;
    this.meshes[i].position.set(x, HEIGHT, z);
    // Random turn so a trail is not a row of stamps.
    this.meshes[i].rotation.z = Math.random() * Math.PI * 2;
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
      // Stays solid for the first part, thins late.
      this.materials[i].opacity = 0.92 * (1 - gone * gone);
    }
  }
}
