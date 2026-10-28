import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import {
  AnimationAction,
  AnimationMixer,
  Color,
  Group,
  LoopOnce,
  Mesh,
  MeshStandardMaterial,
  Object3D,
} from "three";
import { clone } from "three/examples/jsm/utils/SkeletonUtils.js";
import {
  ENEMY_ARCHER_SCALE,
  ENEMY_ARCHER_TINT,
  ENEMY_ARCHER_TINT_MIX,
  ENEMY_COUNT,
  ENEMY_KINDS,
  ENEMY_SCALE,
} from "../config.ts";
import { action } from "./clips.ts";
import type { Enemy, EnemyKind } from "../game/enemy.ts";

/** Flash colour for a hit. Bright enough to read for the two frames it lasts. */
const HIT_EMISSIVE = 0xff3a1a;

/**
 * Everything that differs between the two enemy kinds: which model they are,
 * how big, what their clips are called, and how they are tinted.
 *
 * Archers reuse the player's GLB. It already carries a bow, a Shoot clip and
 * a Death clip, so an enemy archer costs nothing in the bundle — and it
 * actually draws a bow, instead of a robot throwing a punch at range.
 */
interface KindSpec {
  gltf: GLTF;
  scale: number;
  idle: string;
  run: string;
  attack: string;
  death: string;
  tint: Color | null;
}

/**
 * One view per pool slot, cloned at boot. Cloning a rigged character is
 * expensive, so it must never happen during play.
 *
 * A slot's kind is fixed for the session — the spawner assigns kind by slot —
 * which is what lets each view build its model and clip set once, rather than
 * swapping models whenever something respawns.
 */
class EnemyView {
  readonly root: Object3D;
  private readonly mixer: AnimationMixer;
  private readonly idle: AnimationAction;
  private readonly run: AnimationAction;
  private readonly attack: AnimationAction;
  private readonly death: AnimationAction;
  /** Death is a one-shot, started on the transition rather than kept playing
   *  at zero weight like the looping clips. */
  private wasDying = false;
  private wasFlashing = false;
  /** SkeletonUtils.clone shares materials between clones, so tinting or
   *  flashing one enemy would do it to every one of them. Each view needs its
   *  own copies. */
  private readonly materials: MeshStandardMaterial[] = [];
  private readonly baseEmissive: number[] = [];

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
      // Lerped rather than replaced, so the model's own light and dark parts
      // stay distinguishable instead of flattening into one colour.
      if (spec.tint !== null) copy.color.lerp(spec.tint, ENEMY_ARCHER_TINT_MIX);
      this.materials.push(copy);
      this.baseEmissive.push(copy.emissive.getHex());
    });

    this.mixer = new AnimationMixer(this.root);
    this.idle = action(this.mixer, spec.gltf, spec.idle);
    this.run = action(this.mixer, spec.gltf, spec.run);
    this.attack = action(this.mixer, spec.gltf, spec.attack);
    this.death = action(this.mixer, spec.gltf, spec.death);
    this.idle.play();
    this.run.play();
    this.attack.play();
    // Holds the last frame instead of snapping back to the bind pose, so a
    // corpse stays down for the rest of its dying time.
    this.death.setLoop(LoopOnce, 1);
    this.death.clampWhenFinished = true;
  }

  sync(enemy: Enemy): void {
    this.root.visible = enemy.alive;
    this.root.position.x = enemy.x;
    this.root.position.z = enemy.z;
    this.root.rotation.y = enemy.facing;

    const dying = enemy.dying > 0;
    if (dying && !this.wasDying) {
      // reset() rewinds a clip that already ran: a clamped one-shot stays
      // finished until told otherwise.
      this.death.reset().play();
    }
    this.wasDying = dying;

    // A hit with no feedback reads as a miss. Written only on the transition:
    // touching every material every frame to write the value it already holds
    // is the kind of cost that never shows up as one big number.
    const flashing = !dying && enemy.hitFlash > 0;
    if (flashing !== this.wasFlashing) {
      for (let i = 0; i < this.materials.length; i++) {
        this.materials[i].emissive.setHex(
          flashing ? HIT_EMISSIVE : this.baseEmissive[i],
        );
      }
      this.wasFlashing = flashing;
    }

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

  constructor(melee: GLTF, archer: GLTF) {
    const specs: Record<EnemyKind, KindSpec> = {
      melee: {
        gltf: melee,
        scale: ENEMY_SCALE,
        idle: "Idle",
        run: "Running",
        attack: "Punch",
        death: "Death",
        tint: null,
      },
      archer: {
        gltf: archer,
        scale: ENEMY_ARCHER_SCALE,
        idle: "Idle",
        run: "Run",
        attack: "Shoot",
        death: "Death",
        tint: new Color(ENEMY_ARCHER_TINT),
      },
    };

    for (let i = 0; i < ENEMY_COUNT; i++) {
      const view = new EnemyView(specs[ENEMY_KINDS[i % ENEMY_KINDS.length]]);
      this.views.push(view);
      this.root.add(view.root);
    }
  }

  sync(index: number, enemy: Enemy): void {
    this.views[index].sync(enemy);
  }

  /** Corpses advance too: a stopped mixer would resume mid-stride on respawn,
   *  and a handful of mixers is nothing. */
  advance(dt: number): void {
    for (let i = 0; i < this.views.length; i++) {
      this.views[i].advance(dt);
    }
  }
}
