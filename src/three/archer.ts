import * as THREE from "three";
import { type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { Player } from "../game/player.ts";
import { action } from "./clips.ts";
import { FIRE_INTERVAL, PLAYER_SCALE } from "../config.ts";

/** Seconds to blend into the death pose. */
const DEATH_FADE = 0.15;

/**
 * Body turn rate, radians per second. `facing` in the state changes instantly
 * so arrows leave in the asked direction; only the drawn body eases.
 */
const TURN_RATE = 18;

const HIT_EMISSIVE = 0xffffff;
/** Full-intensity white erases the body instead of highlighting it. */
const FLASH_INTENSITY = 0.6;

/**
 * The player's view: model plus animation state. The bow is part of the model
 * (parented to the left hand by `scripts/archero-merge.mjs`), so nothing here
 * attaches a prop.
 */
export class ArcherView {
  /** Model plus the ring under it, moved together. */
  readonly root = new THREE.Group();
  private readonly mixer: THREE.AnimationMixer;
  private readonly idle: THREE.AnimationAction;
  private readonly run: THREE.AnimationAction;
  private readonly shoot: THREE.AnimationAction;
  private readonly death: THREE.AnimationAction;
  private wasDead = false;
  private lastShooting = 0;
  /** Drawn yaw, chasing `player.facing`. Nothing in the sim reads it. */
  private yaw = Number.NaN;
  private wantYaw = 0;
  private readonly materials: THREE.MeshStandardMaterial[] = [];
  private readonly baseEmissive: number[] = [];
  private readonly baseIntensity: number[] = [];
  private wasFlashing = false;

  constructor(gltf: GLTF) {
    lift(gltf.scene);
    gltf.scene.traverse((node) => {
      if (!(node instanceof THREE.Mesh)) return;
      if (!(node.material instanceof THREE.MeshStandardMaterial)) return;
      this.materials.push(node.material);
      this.baseEmissive.push(node.material.emissive.getHex());
      this.baseIntensity.push(node.material.emissiveIntensity);
    });
    gltf.scene.scale.setScalar(PLAYER_SCALE);
    this.root.add(gltf.scene, marker());
    this.mixer = new THREE.AnimationMixer(gltf.scene);
    this.idle = action(this.mixer, gltf, "Idle");
    this.run = action(this.mixer, gltf, "Run");
    this.shoot = action(this.mixer, gltf, "Shoot");
    this.death = action(this.mixer, gltf, "Death");
    this.idle.play();
    this.run.play();
    this.shoot.play();
    // One full draw-and-release per FIRE_INTERVAL.
    this.shoot.timeScale = this.shoot.getClip().duration / FIRE_INTERVAL;
    // Hold the last frame so the body stays down behind the end card.
    this.death.setLoop(THREE.LoopOnce, 1);
    this.death.clampWhenFinished = true;
  }

  sync(player: Player): void {
    // `shooting` decays each frame and jumps on a shot; the rise restarts the clip.
    if (player.shooting > this.lastShooting) this.shoot.reset().play();
    this.lastShooting = player.shooting;

    this.root.position.x = player.x;
    this.root.position.z = player.z;
    // Snap on the first frame so there is no spin-up at boot.
    this.wantYaw = player.facing;
    if (Number.isNaN(this.yaw)) {
      this.yaw = player.facing;
      this.root.rotation.y = player.facing;
    }

    // Materials are written on the transition only.
    const flashing = player.hitFlash > 0 && player.hp > 0;
    if (flashing !== this.wasFlashing) {
      for (let i = 0; i < this.materials.length; i++) {
        this.materials[i].emissive.setHex(
          flashing ? HIT_EMISSIVE : this.baseEmissive[i],
        );
        this.materials[i].emissiveIntensity = flashing
          ? FLASH_INTENSITY
          : this.baseIntensity[i];
      }
      this.wasFlashing = flashing;
    }

    const dead = player.hp <= 0;
    if (dead && !this.wasDead) this.death.reset().fadeIn(DEATH_FADE).play();
    this.wasDead = dead;

    // Shoot keys the upper body only; blending it with Idle averages a drawn
    // bow with hanging arms. It takes over fully while shooting.
    const aiming = !dead && player.shooting > 0 ? 1 : 0;
    const locomotion = dead ? 0 : 1 - aiming;
    this.shoot.weight = aiming;
    this.death.weight = dead ? 1 : 0;
    this.run.weight = player.throttle * locomotion;
    this.idle.weight = (1 - player.throttle) * locomotion;
    // Slow the run cycle with the body to avoid footskate.
    this.run.timeScale = Math.max(player.throttle, 0.4);
  }

  advance(dt: number): void {
    this.mixer.update(dt);
    if (Number.isNaN(this.yaw)) return;
    // Wrap to (-PI, PI] so the turn takes the short way round.
    let delta = (this.wantYaw - this.yaw) % (Math.PI * 2);
    if (delta > Math.PI) delta -= Math.PI * 2;
    if (delta < -Math.PI) delta += Math.PI * 2;
    this.yaw += delta * (1 - Math.exp(-dt * TURN_RATE));
    this.root.rotation.y = this.yaw;
  }

}

/**
 * Ring under the hero. The costume is nearly black from above, so this is what
 * makes the player readable. Unlit and no depth write: a floor decal.
 */
function marker(): THREE.Object3D {
  const group = new THREE.Group();

  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.46, 0.6, 28),
    new THREE.MeshBasicMaterial({
      color: 0x4fd8ff,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
    }),
  );
  const fill = new THREE.Mesh(
    new THREE.RingGeometry(0, 0.46, 28),
    new THREE.MeshBasicMaterial({
      color: 0x58e0ff,
      transparent: true,
      opacity: 0.16,
      depthWrite: false,
    }),
  );

  for (const mesh of [ring, fill]) {
    mesh.rotation.x = -Math.PI / 2;
    // Lift off the floor plane at y = 0 to avoid z-fighting.
    mesh.position.y = 0.02;
    group.add(mesh);
  }
  return group;
}

/**
 * Undoes the 0.604 grey baked into the model's baseColorFactor. Materials are
 * cloned so other users of the same GLTF are not affected.
 */
function lift(root: THREE.Object3D): void {
  const brighten = (material: THREE.Material): THREE.Material => {
    const copy = material.clone();
    if (copy instanceof THREE.MeshStandardMaterial) {
      // Multiply, not assign: the bow's wood has no map, and assigning turns it white.
      copy.color.multiplyScalar(1.35);
    }
    return copy;
  };

  root.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return;
    node.material = Array.isArray(node.material)
      ? node.material.map(brighten)
      : brighten(node.material);
  });
}
