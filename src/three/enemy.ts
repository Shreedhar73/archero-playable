import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { ENEMY_COUNT, ENEMY_SCALE } from "../config.ts";
import { AnimationAction, AnimationMixer, Group, Object3D } from "three";
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

  constructor(gltf: GLTF) {
    this.root = clone(gltf.scene);
    this.root.scale.setScalar(ENEMY_SCALE);
    this.root.visible = false;
    this.mixer = new AnimationMixer(this.root);
    this.idle = action(this.mixer, gltf, "Idle");
    this.run = action(this.mixer, gltf, "Running");
    this.idle.play();
    this.run.play();
  }

  sync(enemy: Enemy): void {
    this.root.visible = enemy.alive;
    this.root.position.x = enemy.x;
    this.root.position.z = enemy.z;
    this.root.rotation.y = enemy.facing;
    this.run.weight = enemy.throttle;
    this.idle.weight = 1 - enemy.throttle;
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
