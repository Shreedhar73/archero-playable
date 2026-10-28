import * as THREE from "three";

import { ArcherView } from "./archer.ts";
import { type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { EnemyViews } from "./enemy.ts";
import type { Enemy } from "../game/enemy.ts";
import { ROOM_DEPTH, ROOM_WIDTH } from "../config.ts";
import { frameRoom } from "./camera.ts";
import { checkerTexture } from "./textures.ts";
import { Scenery } from "./scenery.ts";
import type { Obstacle } from "../game/obstacles.ts";
import { ObstacleViews } from "./obstacles.ts";

/** Visual only. clampToRoom is what actually stops a body at the wall. */
const WALL_HEIGHT = 0.7;
const WALL_THICKNESS = 0.3;

/**
 * Three.js world boot: renderer, camera, light. Owns the #world canvas,
 * stacked below the Pixi UI overlay. resize() only touches renderer/camera.
 */
export class WorldScene {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;
  private readonly archer: ArcherView;
  private readonly enemies: EnemyViews;

  constructor(archerGltf: GLTF, enemyGltf: GLTF, obstacles: Obstacle[]) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.domElement.id = "world";
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    document.body.appendChild(this.renderer.domElement);

    // Matches the surround, so anything the ground does not reach still reads
    // as distance rather than as a letterbox.
    this.scene.background = new THREE.Color(0x93b579);

    // Long lens, not a wide one: a narrow FOV from far away keeps the room's
    // near and far edges nearly the same width, so the arena reads as a
    // rectangle. frameRoom sets position, near and far on every resize.
    this.camera = new THREE.PerspectiveCamera(22, 1, 1, 100);

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x444466, 1.2));

    this.addSurround();
    this.scene.add(new Scenery().root);
    this.addFloor();
    this.addWalls();
    this.scene.add(new ObstacleViews(obstacles).root);

    this.archer = new ArcherView(archerGltf);
    this.scene.add(this.archer.root);

    this.enemies = new EnemyViews(enemyGltf);
    this.scene.add(this.enemies.root);
  }

  /**
   * Ground outside the walls. A 9x12 room cannot fill a 9:19 phone screen, so
   * what surrounds it has to be land rather than void. Flat and paler than the
   * arena, as in the reference: the checker marks where play happens, so
   * checkering the outside too would say the opposite.
   */
  private addSurround(): void {
    const surround = new THREE.Mesh(
      new THREE.PlaneGeometry(ROOM_WIDTH * 6, ROOM_DEPTH * 6),
      new THREE.MeshStandardMaterial({ color: 0x93b579 }),
    );
    surround.rotation.x = -Math.PI / 2;
    // Just under the floor, so the two coplanar planes cannot z-fight.
    surround.position.y = -0.02;
    this.scene.add(surround);
  }

  /** One checker square per world unit, which is why the GridHelper is gone. */
  private addFloor(): void {
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(ROOM_WIDTH, ROOM_DEPTH),
      new THREE.MeshStandardMaterial({
        // Low contrast, as in the reference: the checker is a scale cue, not a
        // pattern competing with the characters.
        map: checkerTexture(
          "#6fb04a",
          "#68a844",
          ROOM_WIDTH / 2,
          ROOM_DEPTH / 2,
        ),
      }),
    );
    floor.rotation.x = -Math.PI / 2;
    this.scene.add(floor);
  }

  /** Four boxes on the room's edges: x, z, sizeX, sizeZ. */
  private addWalls(): void {
    const material = new THREE.MeshStandardMaterial({ color: 0x8a7a5c });
    const walls: [number, number, number, number][] = [
      [0, -ROOM_DEPTH / 2, ROOM_WIDTH + WALL_THICKNESS, WALL_THICKNESS],
      [0, ROOM_DEPTH / 2, ROOM_WIDTH + WALL_THICKNESS, WALL_THICKNESS],
      [-ROOM_WIDTH / 2, 0, WALL_THICKNESS, ROOM_DEPTH],
      [ROOM_WIDTH / 2, 0, WALL_THICKNESS, ROOM_DEPTH],
    ];
    for (const [x, z, sizeX, sizeZ] of walls) {
      const wall = new THREE.Mesh(
        new THREE.BoxGeometry(sizeX, WALL_HEIGHT, sizeZ),
        material,
      );
      wall.position.set(x, WALL_HEIGHT / 2, z);
      this.scene.add(wall);
    }
  }

  /** Sync the player mesh position with the game state. */
  syncPlayer(x: number, z: number, facing: number, throttle: number): void {
    this.archer.sync(x, z, facing, throttle);
  }

  syncEnemy(index: number, enemy: Enemy): void {
    this.enemies.sync(index, enemy);
  }

  resize(w: number, h: number): void {
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    frameRoom(this.camera);
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  /** Advances animation. Separate from render so the loop's phases stay visible. */
  update(dt: number): void {
    this.archer.advance(dt);
    this.enemies.advance(dt);
  }
}
