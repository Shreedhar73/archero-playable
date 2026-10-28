import * as THREE from "three";
import { type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { action } from "./clips";
/** The archer's view: Loaded model + animation state belonging to this on instance */

export class ArcherView {
  readonly root: THREE.Object3D;
  private readonly mixer: THREE.AnimationMixer;
  private readonly idle: THREE.AnimationAction;
  private readonly run: THREE.AnimationAction;

  constructor(gltf: GLTF) {
    this.root = gltf.scene;
    this.mixer = new THREE.AnimationMixer(this.root);
    this.idle = action(this.mixer, gltf, "Idle");
    this.run = action(this.mixer, gltf, "Run");
    this.idle.play();
    this.run.play();
  }

  sync(x: number, z: number, facing: number, throttle: number) {
    this.root.position.x = x;
    this.root.position.z = z;
    this.root.rotation.y = facing;
    //Both clips always play
    this.run.weight = throttle;
    this.idle.weight = 1 - throttle;
    //legs cycling at full speed while boody creeps is footskate
    this.run.timeScale = Math.max(throttle, 0.4);
  }

  advance(dt: number): void {
    this.mixer.update(dt);
  }
}
