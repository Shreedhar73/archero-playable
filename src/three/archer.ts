import * as THREE from "three";
import { type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { Player } from "../game/player.ts";
import { action } from "./clips.ts";
import { FIRE_INTERVAL } from "../config.ts";

/** Seconds to blend into the death pose. Long enough to read as a collapse
 *  rather than a cut, short enough that the end card is not waiting on it. */
const DEATH_FADE = 0.15;

/**
 * The archer's view: loaded model plus the animation state belonging to this
 * one instance.
 *
 * The bow is part of the model — baked onto the hand bone by
 * `scripts/build-playable.mjs` from Mixamo's own with-bow export — so nothing
 * here attaches a prop or carries a pose constant for one.
 */
export class ArcherView {
  readonly root: THREE.Object3D;
  private readonly mixer: THREE.AnimationMixer;
  private readonly idle: THREE.AnimationAction;
  private readonly run: THREE.AnimationAction;
  private readonly shoot: THREE.AnimationAction;
  private readonly death: THREE.AnimationAction;
  /** Death is a one-shot, started on the transition rather than kept in sync
   *  with a weight every frame. Same shape as the enemy's. */
  private wasDead = false;
  private lastShooting = 0;

  constructor(gltf: GLTF) {
    this.root = gltf.scene;
    this.mixer = new THREE.AnimationMixer(this.root);
    this.idle = action(this.mixer, gltf, "Idle");
    this.run = action(this.mixer, gltf, "Run");
    this.shoot = action(this.mixer, gltf, "Shoot");
    this.death = action(this.mixer, gltf, "Death");
    this.idle.play();
    this.run.play();
    this.shoot.play();
    // One full draw-and-release per shot. The clip is 0.70s and the archer
    // fires every FIRE_INTERVAL, so playing it at its authored rate would cut
    // the gesture off partway through every time.
    this.shoot.timeScale = this.shoot.getClip().duration / FIRE_INTERVAL;
    // Holds the last frame instead of snapping back to the bind pose, so the
    // body stays down behind the end card.
    this.death.setLoop(THREE.LoopOnce, 1);
    this.death.clampWhenFinished = true;
  }

  sync(player: Player): void {
    // `shooting` decays every frame and jumps back up the moment a shot is
    // fired, so a rise is the one signal the renderer gets that an arrow just
    // left. Without this the action keeps looping on its own clock and each
    // shot reveals a different, arbitrary frame of the draw.
    if (player.shooting > this.lastShooting) this.shoot.reset().play();
    this.lastShooting = player.shooting;

    this.root.position.x = player.x;
    this.root.position.z = player.z;
    this.root.rotation.y = player.facing;

    const dead = player.hp <= 0;
    if (dead && !this.wasDead) this.death.reset().fadeIn(DEATH_FADE).play();
    this.wasDead = dead;

    // Shoot keys the upper body only, so blending it against Idle at equal
    // weight would average a drawn bow with hanging arms and read as neither.
    // It takes the body over instead — which costs nothing, because Archero
    // only fires while standing still and the legs are already at rest.
    const aiming = !dead && player.shooting > 0 ? 1 : 0;
    const locomotion = dead ? 0 : 1 - aiming;
    this.shoot.weight = aiming;
    this.death.weight = dead ? 1 : 0;
    // Both locomotion clips always play; throttle mixes between them.
    this.run.weight = player.throttle * locomotion;
    this.idle.weight = (1 - player.throttle) * locomotion;
    // Legs cycling at full speed while the body creeps is footskate.
    this.run.timeScale = Math.max(player.throttle, 0.4);
  }

  advance(dt: number): void {
    this.mixer.update(dt);
  }

}
