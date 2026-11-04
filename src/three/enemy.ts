import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import {
  AnimationAction,
  AnimationMixer,
  Group,
  LoopOnce,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  RingGeometry,
} from "three";
import { clone } from "three/examples/jsm/utils/SkeletonUtils.js";
import {
  ENEMY_ARCHER_SCALE,
  ENEMY_COUNT,
  ENEMY_KINDS,
  ENEMY_SCALE,
} from "../config.ts";
import { action } from "./clips.ts";
import type { Enemy, EnemyKind } from "../game/enemy.ts";

/** Hit flash. White, as in the real game. */
const HIT_EMISSIVE = 0xffffff;
/** Full-intensity white paints the body out. */
const FLASH_INTENSITY = 0.6;

/**
 * Ring under the enemy the auto-aim has picked (`player.target`). On the
 * ground, not over the head: bodies overlap at this camera, and a floor decal
 * belongs to exactly one body. One geometry shared by every ring.
 */
const targetGeometry = new RingGeometry(0.42, 0.56, 24);

const TARGET_OPACITY = 0.72;

/** What differs between the two kinds: model and scale. Clip names are shared. */
interface KindSpec {
  gltf: GLTF;
  scale: number;
  idle: string;
  run: string;
  attack: string;
  death: string;
}

/**
 * One view per pool slot, cloned at boot. Cloning a rigged character is
 * expensive and must not happen during play; the spawner fixes each slot's
 * kind for the session, so the model never has to swap.
 */
class EnemyView {
  readonly root: Object3D;
  private readonly mixer: AnimationMixer;
  private readonly idle: AnimationAction;
  private readonly run: AnimationAction;
  private readonly attack: AnimationAction;
  private readonly death: AnimationAction;
  private wasDying = false;
  private wasFlashing = false;
  /** SkeletonUtils.clone shares materials between clones; each view needs its own. */
  private readonly materials: MeshStandardMaterial[] = [];
  private readonly baseEmissive: number[] = [];
  private readonly baseIntensity: number[] = [];
  private readonly targetRing: Mesh;

  constructor(spec: KindSpec) {
    this.root = clone(spec.gltf.scene);
    this.root.scale.setScalar(spec.scale);
    this.root.visible = false;

    this.root.traverse((node) => {
      if (!(node instanceof Mesh)) return;
      if (Array.isArray(node.material)) return;
      if (!(node.material instanceof MeshStandardMaterial)) return;
      const copy = node.material.clone();
      node.material = copy;
      this.materials.push(copy);
      this.baseEmissive.push(copy.emissive.getHex());
      this.baseIntensity.push(copy.emissiveIntensity);
    });

    // Parented to the body, scaled against the body's scale so both kinds
    // get the same-sized ring.
    this.targetRing = new Mesh(
      targetGeometry,
      new MeshBasicMaterial({
        color: 0xff3b2e,
        transparent: true,
        opacity: TARGET_OPACITY,
        depthWrite: false,
      }),
    );
    this.targetRing.rotation.x = -Math.PI / 2;
    this.targetRing.position.y = 0.025 / spec.scale;
    this.targetRing.scale.setScalar(1 / spec.scale);
    this.targetRing.visible = false;
    this.root.add(this.targetRing);

    this.mixer = new AnimationMixer(this.root);
    this.idle = action(this.mixer, spec.gltf, spec.idle);
    this.run = action(this.mixer, spec.gltf, spec.run);
    this.attack = action(this.mixer, spec.gltf, spec.attack);
    this.death = action(this.mixer, spec.gltf, spec.death);
    this.idle.play();
    this.run.play();
    this.attack.play();
    // Hold the last frame so the corpse stays down.
    this.death.setLoop(LoopOnce, 1);
    this.death.clampWhenFinished = true;
  }

  sync(enemy: Enemy, targeted: boolean): void {
    this.root.visible = enemy.alive;
    this.root.position.x = enemy.x;
    this.root.position.z = enemy.z;
    this.root.rotation.y = enemy.facing;

    const dying = enemy.dying > 0;
    if (dying && !this.wasDying) {
      // A clamped one-shot stays finished until reset.
      this.death.reset().play();
    }
    this.wasDying = dying;

    // The flash timer is the hit signal. Materials are written on the transition only.
    const flashing = !dying && enemy.hitFlash > 0;
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

    this.targetRing.visible = targeted && !dying;

    const attacking = !dying && enemy.attacking;
    this.death.weight = dying ? 1 : 0;
    this.attack.weight = attacking ? 1 : 0;
    this.run.weight = dying || attacking ? 0 : enemy.throttle;
    this.idle.weight = dying || attacking ? 0 : 1 - enemy.throttle;
  }

  advance(dt: number): void {
    this.mixer.update(dt);
  }
}

/** The pool's views, one per slot, built once at boot. */
export class EnemyViews {
  readonly root = new Group();
  private readonly views: EnemyView[] = [];

  constructor(warrior: GLTF, rogue: GLTF) {
    const specs: Record<EnemyKind, KindSpec> = {
      melee: {
        gltf: warrior,
        scale: ENEMY_SCALE,
        idle: "Idle",
        run: "Run",
        attack: "Attack",
        death: "Death",
      },
      archer: {
        gltf: rogue,
        scale: ENEMY_ARCHER_SCALE,
        idle: "Idle",
        run: "Run",
        attack: "Attack",
        death: "Death",
      },
    };

    for (let i = 0; i < ENEMY_COUNT; i++) {
      const view = new EnemyView(specs[ENEMY_KINDS[i % ENEMY_KINDS.length]]);
      this.views.push(view);
      this.root.add(view.root);
    }
  }

  sync(index: number, enemy: Enemy, targeted: boolean): void {
    this.views[index].sync(enemy, targeted);
  }

  /** Corpses advance too; a stopped mixer would resume mid-stride on respawn. */
  advance(dt: number): void {
    for (let i = 0; i < this.views.length; i++) {
      this.views[i].advance(dt);
    }
  }
}
