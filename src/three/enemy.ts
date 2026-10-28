import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { ENEMY_COUNT, ENEMY_SCALE } from "../config.ts";
import {
  AnimationAction,
  AnimationMixer,
  Group,
  LoopOnce,
  Object3D,
} from "three";
import { clone } from "three/examples/jsm/utils/SkeletonUtils.js";
import { action } from "./clips.ts";
import type { Enemy } from "../game/enemy.ts";

/**
 * One view per pool slot, all cloned at boot ( it is expensive so cloning at boot time)
 */

class EnemyView {
  readonly root = new Object3D();
  private readonly mixer: AnimationMixer;
  private readonly idle: AnimationAction;
  private readonly run: AnimationAction;
  private readonly punch: AnimationAction;
  private readonly death: AnimationAction;
  /** Death is a one-shot, so it is started on the transition rather than kept
   *  playing at zero weight like the looping clips. */
  private wasDying = false;

  constructor(gltf: GLTF) {
    this.root = clone(gltf.scene);
    this.root.scale.setScalar(ENEMY_SCALE);
    this.root.visible = false;
    this.mixer = new AnimationMixer(this.root);
    this.idle = action(this.mixer, gltf, "Idle");
    this.run = action(this.mixer, gltf, "Running");
    this.punch = action(this.mixer, gltf, "Punch");
    this.death = action(this.mixer, gltf, "Death");
    this.idle.play();
    this.run.play();
    this.punch.play();
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
      // reset() rewinds a clip that already ran: this slot may have died
      // before, and a clamped one-shot stays finished until told otherwise.
      this.death.reset().play();
    }
    this.wasDying = dying;

    const punching = !dying && enemy.attacking;
    this.death.weight = dying ? 1 : 0;
    this.punch.weight = punching ? 1 : 0;
    this.run.weight = dying || punching ? 0 : enemy.throttle;
    this.idle.weight = dying || punching ? 0 : 1 - enemy.throttle;
  }

  advance(dt: number): void {
    this.mixer.update(dt);
  }
}

/** The pool view */

export class EnemyViews {
  readonly root = new Group();
  private readonly views: EnemyView[] = [];

  constructor(gltf: GLTF) {
    for (let i = 0; i < ENEMY_COUNT; i++) {
      const view = new EnemyView(gltf);
      this.views.push(view);
      this.root.add(view.root);
    }
  }

  sync(index: number, enemy: Enemy): void {
    this.views[index].sync(enemy);
  }

  /** Dead enemy still advance */

  advance(dt: number): void {
    this.views.forEach((v) => v.advance(dt));
  }
}
