import * as THREE from "three";

import type { Player } from "../game/player.ts";
import { ArcherView } from "./archer.ts";
import { type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { EnemyViews } from "./enemy.ts";
import type { Enemy } from "../game/enemy.ts";
import { ROOM_DEPTH, ROOM_WIDTH } from "../config.ts";
import { frameRoom } from "./camera.ts";
import { device } from "../engine/device.ts";
import { checkerTexture } from "./textures.ts";
import { Scenery, type SceneryAssets } from "./scenery.ts";
import { ArrowViews } from "./arrows.ts";
import type { Projectile } from "../game/projectiles.ts";
import type { Obstacle } from "../game/obstacles.ts";
import { ObstacleViews } from "./obstacles.ts";

/**
 * Everything the scene needs loaded before it can be built. An options object
 * rather than five positional arguments: four of them are GLTFs, so the
 * compiler could not tell them apart if they were swapped.
 */
export interface WorldAssets {
  archer: GLTF;
  enemy: GLTF;
  arrow: GLTF;
  scenery: SceneryAssets;
}

/** A world point in overlay pixels, plus whether it is in front of the camera. */
export interface Projected {
  x: number;
  y: number;
  onScreen: boolean;
}

/** Reused: project() runs once per entity per frame. */
const projected: Projected = { x: 0, y: 0, onScreen: false };

/** Visual only. clampToRoom is what actually stops a body at the wall. */
const WALL_HEIGHT = 0.7;
const WALL_THICKNESS = 0.3;

/**
 * How far the arena stands above the land around it, and how far its base
 * oversails the walls. The reference does not paint the play area onto the
 * ground — it raises it, so the rim catches light along its top and drops a
 * shadow on the grass outside. Nothing in `src/game/` knows about either
 * number: the floor is still the y = 0 plane every body walks on.
 */
const PLINTH = 0.45;
const RIM = 0.35;

/** Olive, not pale: in the reference everything outside the arena sits in
 *  tree shade and reads darker than the grass inside. The one pale area is
 *  the near mist, and that is drawn in Pixi over the top (`src/ui/mist.ts`),
 *  because fog fades by distance and the mist is at the near edge. */
const SURROUND = 0x5f7f40;

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
  private readonly arrows: ArrowViews;
  private screenW = 1;
  private screenH = 1;
  private readonly point = new THREE.Vector3();

  constructor(assets: WorldAssets, obstacles: Obstacle[]) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.domElement.id = "world";
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    // Shadows are the cheapest thing that makes objects look like they are on
    // the ground rather than floating above a painted floor.
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    device.appendChild(this.renderer.domElement);

    // Matches the surround, so anything the ground does not reach still reads
    // as distance rather than as a letterbox.
    this.scene.background = new THREE.Color(SURROUND);

    // Long lens, not a wide one: a narrow FOV from far away keeps the room's
    // near and far edges nearly the same width, so the arena reads as a
    // rectangle. frameRoom sets position, near and far on every resize.
    this.camera = new THREE.PerspectiveCamera(22, 1, 1, 100);

    // Hemisphere fills the shadows with sky colour so they are not black;
    // the directional light is what actually shapes anything.
    this.scene.add(new THREE.HemisphereLight(0xcfe3ff, 0x6a7a55, 1.5));
    this.addSun();

    this.addSurround();
    this.scene.add(new Scenery(assets.scenery, -PLINTH).root);
    this.addPlinth();
    this.addFloor();
    this.addWalls();
    this.scene.add(new ObstacleViews(obstacles).root);

    this.archer = new ArcherView(assets.archer);
    this.castOnly(this.archer.root);
    this.scene.add(this.archer.root);

    this.arrows = new ArrowViews(assets.arrow);
    this.scene.add(this.arrows.root);

    this.enemies = new EnemyViews(assets.enemy, assets.archer);
    this.castOnly(this.enemies.root);
    this.scene.add(this.enemies.root);
  }

  /**
   * One directional light, angled off-axis so faces that meet at a corner get
   * different brightness. Its shadow camera is orthographic and sized to the
   * room plus a margin: every unit it covers costs shadow-map resolution, so
   * a loose box is a blurry contact shadow.
   */
  private addSun(): void {
    const sun = new THREE.DirectionalLight(0xfff4e0, 2.1);
    sun.position.set(7, 15, 9);
    sun.target.position.set(0, 0, 1);
    sun.castShadow = true;
    // 1024 over a 22-unit shadow box is a 0.021-unit texel — finer than any
    // crate edge reads at this distance, and a quarter of the memory and fill
    // cost of 2048 on a phone.
    sun.shadow.mapSize.set(1024, 1024);
    const box = sun.shadow.camera;
    box.left = -11;
    box.right = 11;
    box.top = 15;
    box.bottom = -15;
    box.near = 1;
    box.far = 45;
    box.updateProjectionMatrix();
    // Pushes the shadow off the surface that casts it, so a mesh does not
    // shade itself in stripes.
    sun.shadow.bias = -0.0008;
    sun.shadow.normalBias = 0.02;
    this.scene.add(sun);
    this.scene.add(sun.target);
  }

  /** Skinned meshes cast but do not receive: self-shadowing a rigged mesh
   *  costs more than it shows at this camera distance.
   *
   *  Unlit meshes are skipped. A MeshBasicMaterial here means an effect lying
   *  on the floor — the player's marker ring — and a decal that casts a
   *  shadow stops being a decal. */
  private castOnly(root: THREE.Object3D): void {
    root.traverse((node) => {
      if (!(node instanceof THREE.Mesh)) return;
      if (node.material instanceof THREE.MeshBasicMaterial) return;
      node.castShadow = true;
    });
  }

  /**
   * Ground outside the walls. A 9x12 room cannot fill a 9:19 phone screen, so
   * what surrounds it has to be land rather than void. Flat and darker than
   * the arena, as in the reference: the checker marks where play happens, so
   * checkering the outside too would say the opposite, and lighting it more
   * brightly would make the arena read as a hole.
   */
  private addSurround(): void {
    const surround = new THREE.Mesh(
      new THREE.PlaneGeometry(ROOM_WIDTH * 6, ROOM_DEPTH * 6),
      new THREE.MeshStandardMaterial({ color: SURROUND }),
    );
    surround.rotation.x = -Math.PI / 2;
    // A plinth's depth below the floor: the arena stands on the land, it is
    // not flush with it.
    surround.position.y = -PLINTH;
    surround.receiveShadow = true;
    this.scene.add(surround);
  }

  /**
   * The block the arena stands on. Oversails the walls by RIM so its edge is
   * visible from above as a lip, and casts onto the surround — that contact
   * shadow is most of what makes the arena look raised rather than painted.
   */
  private addPlinth(): void {
    const plinth = new THREE.Mesh(
      new THREE.BoxGeometry(
        ROOM_WIDTH + RIM * 2,
        PLINTH,
        ROOM_DEPTH + RIM * 2,
      ),
      new THREE.MeshStandardMaterial({ color: 0x6d5a3c }),
    );
    // A hair under the floor plane rather than flush with it: two coplanar
    // surfaces at y = 0 z-fight, and the plinth wins often enough to paint
    // the whole arena brown.
    plinth.position.y = -PLINTH / 2 - 0.01;
    plinth.castShadow = true;
    plinth.receiveShadow = true;
    this.scene.add(plinth);
  }

  /** One checker square per world unit, which is why the GridHelper is gone. */
  private addFloor(): void {
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(ROOM_WIDTH, ROOM_DEPTH),
      new THREE.MeshStandardMaterial({
        // Low contrast, as in the reference: the checker is a scale cue, not a
        // pattern competing with the characters.
        map: checkerTexture(
          "#8cc63f",
          "#83bd3a",
          ROOM_WIDTH / 2,
          ROOM_DEPTH / 2,
        ),
      }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);
  }

  /** Four boxes on the room's edges: x, z, sizeX, sizeZ. */
  private addWalls(): void {
    // Warm tan, lighter than the plinth below it, so the rim reads as a lit
    // top edge rather than as more of the same block.
    const material = new THREE.MeshStandardMaterial({ color: 0xa89066 });
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
      wall.castShadow = true;
      wall.receiveShadow = true;
      this.scene.add(wall);
    }
  }

  /** Sync the player mesh with the game state. Takes the whole player: the
   *  view reads facing, throttle, the shoot timer and health, and adding each
   *  as its own argument is how four positional numbers become five. */
  syncPlayer(player: Player): void {
    this.archer.sync(player);
  }

  syncEnemy(index: number, enemy: Enemy): void {
    this.enemies.sync(index, enemy);
  }

  syncArrow(index: number, arrow: Projectile): void {
    this.arrows.sync(index, arrow);
  }

  /**
   * A world point in CSS pixels, for positioning Pixi over the 3D scene.
   *
   * project() runs the point through the camera's view and projection
   * matrices — the same arithmetic the vertex shader does — leaving
   * normalised device coordinates from -1 to +1. NDC has +Y up; screens and
   * Pixi have +Y down, hence the negation.
   *
   * `onScreen` is false behind the camera, where perspective division by a
   * negative depth still yields plausible-looking coordinates on the wrong
   * side of the screen.
   */
  project(x: number, y: number, z: number): Projected {
    this.point.set(x, y, z).project(this.camera);
    projected.x = (this.point.x * 0.5 + 0.5) * this.screenW;
    projected.y = (-this.point.y * 0.5 + 0.5) * this.screenH;
    projected.onScreen = this.point.z < 1;
    return projected;
  }

  resize(w: number, h: number): void {
    this.screenW = w;
    this.screenH = h;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    frameRoom(this.camera);
    // project() reads matrixWorldInverse, which the renderer refreshes at
    // render time. Layout callbacks run before the first frame, so without
    // this the first projection of the frame is against a stale camera — and
    // at boot that is the identity, which puts the near wall nowhere.
    this.camera.updateMatrixWorld(true);
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
