import * as THREE from "three";
import { ROOM_SIZE } from "../config.ts";
import { ArcherView } from "./archer.ts";
import { type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";

/**
 * Three.js world boot: renderer, camera, light. Owns the #world canvas,
 * stacked below the Pixi UI overlay. resize() only touches renderer/camera.
 */
export class WorldScene {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;
  private readonly archer: ArcherView;

  constructor(archerGltf: GLTF) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.domElement.id = "world";
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    document.body.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color(0x1a1c2c);

    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
    this.camera.position.set(0, 10, 8);
    this.camera.lookAt(0, 0, 0);

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x444466, 1.2));

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(ROOM_SIZE, ROOM_SIZE),
      new THREE.MeshStandardMaterial({ color: 0x4a7c3f }),
    );
    floor.rotation.x = -Math.PI / 2;
    this.scene.add(floor);

    this.archer = new ArcherView(archerGltf);
    this.scene.add(this.archer.root);

    const grid = new THREE.GridHelper(ROOM_SIZE, ROOM_SIZE, 0x2f5a28, 0x2f5a28);
    grid.position.y = 0.01; // avoid z-fighting with floor
    this.scene.add(grid);
    // TODO: room/level geometry, directional light, entity meshes
  }
  /** Sync the player mesh position with the game state. */
  syncPlayer(x: number, z: number, facing: number, throttle: number): void {
    this.archer.sync(x, z, facing, throttle);
  }

  resize(w: number, h: number): void {
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  /** advances anumation. Separate from render so loop's phase stays visible */
  update(dt: number): void {
    this.archer.advance(dt);
  }
}
