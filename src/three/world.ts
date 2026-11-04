import * as THREE from "three";

import type { Player } from "../game/player.ts";
import { ArcherView } from "./archer.ts";
import { type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { EnemyViews } from "./enemy.ts";
import type { Enemy } from "../game/enemy.ts";
import { ROOM_DEPTH, ROOM_WIDTH } from "../config.ts";
import { clamp } from "../engine/math.ts";
import {
  aimCamera,
  CAMERA_LEAD,
  cameraRange,
  frameRoom,
  setViewport,
} from "./camera.ts";
import { device } from "../engine/device.ts";
import arenaUrl from "../../assets/arena.webp";
import { Scenery, type SceneryAssets } from "./scenery.ts";
import { ArrowViews } from "./arrows.ts";
import { Impacts } from "./impacts.ts";
import type { Projectile } from "../game/projectiles.ts";
import type { Obstacle } from "../game/obstacles.ts";
import { ObstacleViews } from "./obstacles.ts";
import { Dust } from "./dust.ts";

/** Everything the scene needs loaded before it can be built. */
export interface WorldAssets {
  hero: GLTF;
  /** Ranged enemies: KayKit Skeleton Rogue with crossbow. */
  rogue: GLTF;
  /** Melee enemies: KayKit Skeleton Warrior with blade. */
  warrior: GLTF;
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

/**
 * Pixel coordinates in `assets/arena.webp`. The image is the source painting
 * resized and alpha-keyed, no crop, so these numbers can be checked against
 * it directly.
 *
 * The arena is painted ground, not geometry: nothing here is in a collision
 * list and the floor is y = 0. FIELD is the arena, border to border. It must
 * land exactly on ROOM_WIDTH x ROOM_DEPTH because `clampToRoom` stops bodies
 * at that rectangle and knows nothing about the image. The painting's field
 * is about 12% longer in z per unit; the camera's foreshortening absorbs it.
 */
const IMAGE_W = 1200;
/**
 * Taller than the source painting: `scripts/build-arena.py` adds rows of
 * flat surround green and a near border below FIELD, so clamping past the
 * near wall repeats green instead of arena checker.
 */
const IMAGE_H = 2529;
const FIELD = { x0: 93, y0: 465, x1: 1127, y1: 2100 };
/** The ruins, and the row their feet stand on. */
const RUINS = { x0: 85, y0: 0, x1: 1075, y1: 345 };

/** Painting pixels to world units, across and along. */
const PX_X = ROOM_WIDTH / (FIELD.x1 - FIELD.x0);
const PX_Z = ROOM_DEPTH / (FIELD.y1 - FIELD.y0);
const COLUMN_0 = (FIELD.x0 + FIELD.x1) / 2;
const ROW_0 = (FIELD.y0 + FIELD.y1) / 2;

const worldX = (column: number): number => (column - COLUMN_0) * PX_X;
const worldZ = (row: number): number => (row - ROW_0) * PX_Z;
/** ...and back, as texture coordinates. v counts from the image's bottom. */
const uAt = (x: number): number => (x / PX_X + COLUMN_0) / IMAGE_W;
const vAt = (z: number): number => 1 - (z / PX_Z + ROW_0) / IMAGE_H;

/**
 * Ground extent in world units. Wider and longer than the painting: UVs run
 * past 0..1 and `ClampToEdgeWrapping` repeats the outermost column, which
 * is flat surround green.
 */
const GROUND_HALF_W = 11;
/** At the near end of the camera's travel the screen bottom is z = 17.8. */
const GROUND_NEAR = 20;

const FLOOR_Y = 0;

/**
 * Land beyond the ruins, and the horizon colour. The painting's own surround,
 * used raw: this plane is unlit, so there is no lighting factor to undo.
 */
const BEYOND = 0x8fca24;

/** Camera lag, per second. Fast enough that the player never leaves the screen. */
const FOLLOW_RATE = 4.5;

/**
 * sRGB explicitly, or three decodes the map as linear and the grass goes
 * pale. Clamped: each mesh's UVs stay inside its own band.
 */
function arenaTexture(): THREE.Texture {
  const map = new THREE.TextureLoader().load(arenaUrl);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = THREE.ClampToEdgeWrapping;
  map.wrapT = THREE.ClampToEdgeWrapping;
  map.anisotropy = 4;
  return map;
}

/**
 * Points a plane at one rectangle of the painting by rewriting its UVs, so
 * two meshes share one texture. Values outside 0..1 are intended and clamp.
 */
function rectUv(
  geometry: THREE.BufferGeometry,
  u0: number,
  v0: number,
  u1: number,
  v1: number,
): void {
  const uv = geometry.attributes.uv;
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, u0 + uv.getX(i) * (u1 - u0), v0 + uv.getY(i) * (v1 - v0));
  }
}

export class WorldScene {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.OrthographicCamera;
  readonly renderer: THREE.WebGLRenderer;
  private readonly archer: ArcherView;
  private readonly enemies: EnemyViews;
  private readonly arrows: ArrowViews;
  private readonly impacts: Impacts;
  private readonly dust: Dust;
  private screenW = 1;
  private screenH = 1;
  /**
   * Look-at z along the room's centre line. View state, not game state: a
   * rotation re-clamps it rather than resetting it. NaN until the first aim
   * so the camera starts on the player instead of sweeping onto them.
   */
  private follow = Number.NaN;
  private readonly arena = arenaTexture();
  private readonly point = new THREE.Vector3();
  /** pixelsPerUnit() must not share `point` with project(). */
  private readonly spanA = new THREE.Vector3();
  private readonly spanB = new THREE.Vector3();

  constructor(assets: WorldAssets, obstacles: Obstacle[]) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.domElement.id = "world";
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    device.appendChild(this.renderer.domElement);

    // Matches the surround, so ground the plate does not reach still reads
    // as distance.
    this.scene.background = new THREE.Color(BEYOND);

    // Placeholder frustum; frameRoom sets the real one on the first resize.
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);

    // Nearly flat lighting: a strong key blows out every pale surface.
    this.scene.add(new THREE.HemisphereLight(0xeaf4ff, 0x8fa172, 1.55));
    this.addSun();

    this.addGround();
    this.addBeyond();
    this.addGate();
    this.scene.add(new Scenery(assets.scenery, 0).root);
    this.scene.add(new ObstacleViews(obstacles).root);

    this.archer = new ArcherView(assets.hero);
    this.castOnly(this.archer.root);
    this.scene.add(this.archer.root);

    this.arrows = new ArrowViews(assets.arrow);
    this.scene.add(this.arrows.root);

    this.impacts = new Impacts(8);
    this.scene.add(this.impacts.root);

    this.dust = new Dust(6);
    this.scene.add(this.dust.root);

    this.enemies = new EnemyViews(assets.warrior, assets.rogue);
    this.castOnly(this.enemies.root);
    this.scene.add(this.enemies.root);
  }

  /**
   * Land past the ruins' feet. A hair below the painted ground so the two
   * are not coplanar. Unlit, so it meets the painting's apron without a
   * gradient.
   */
  private addBeyond(): void {
    const far = worldZ(RUINS.y1);
    const depth = 40;
    const beyond = new THREE.Mesh(
      new THREE.PlaneGeometry(4 * GROUND_HALF_W, depth),
      new THREE.MeshBasicMaterial({ color: BEYOND }),
    );
    beyond.rotation.x = -Math.PI / 2;
    beyond.position.set(0, FLOOR_Y - 0.01, far - depth / 2);
    this.scene.add(beyond);
  }

  /**
   * The ruins at the far edge, stood upright: they are painted in elevation,
   * so laid flat they smear into the grass. Unlit, since their shading is
   * baked in. `alphaTest` rather than blending so the doorway sorts as a hole.
   */
  private addGate(): void {
    // Both from the across-scale: the ruins' pixels are height, not depth.
    const width = (RUINS.x1 - RUINS.x0) * PX_X;
    const height = (RUINS.y1 - RUINS.y0) * PX_X;
    const geometry = new THREE.PlaneGeometry(width, height);
    rectUv(
      geometry,
      RUINS.x0 / IMAGE_W,
      1 - RUINS.y1 / IMAGE_H,
      RUINS.x1 / IMAGE_W,
      1 - RUINS.y0 / IMAGE_H,
    );
    const gate = new THREE.Mesh(
      geometry,
      new THREE.MeshBasicMaterial({
        map: this.arena,
        transparent: true,
        alphaTest: 0.5,
      }),
    );
    // Foot on the row the painting stands them on, centred where it centres them.
    gate.position.set(
      worldX((RUINS.x0 + RUINS.x1) / 2),
      height / 2,
      worldZ(RUINS.y1),
    );
    this.scene.add(gate);
  }

  private addSun(): void {
    const sun = new THREE.DirectionalLight(0xfff3dc, 1.15);
    // Steep, so crates throw short shadows that sit under them.
    sun.position.set(-4, 26, 5);
    sun.target.position.set(0, 0, 1);
    sun.castShadow = true;
    // 1024 over a 22-unit box is a 0.021-unit texel, finer than any edge
    // reads at this distance. 2048 costs four times the memory on a phone.
    sun.shadow.mapSize.set(1024, 1024);
    const box = sun.shadow.camera;
    box.left = -13;
    box.right = 13;
    box.top = 17;
    box.bottom = -17;
    box.near = 1;
    box.far = 45;
    box.updateProjectionMatrix();
    // Keeps a mesh from shading itself in stripes.
    sun.shadow.bias = -0.0008;
    sun.shadow.normalBias = 0.02;
    this.scene.add(sun);
    this.scene.add(sun.target);
  }

  /**
   * Skinned meshes cast but do not receive. Unlit meshes are skipped: a
   * MeshBasicMaterial here is a floor decal, and a decal must not cast.
   */
  private castOnly(root: THREE.Object3D): void {
    root.traverse((node) => {
      if (!(node instanceof THREE.Mesh)) return;
      if (node.material instanceof THREE.MeshBasicMaterial) return;
      node.castShadow = true;
    });
  }

  /**
   * One painted plate. The arena field is mapped onto exactly
   * ROOM_WIDTH x ROOM_DEPTH so `clampToRoom` stops bodies at the painted
   * edge. UVs run outside 0..1 at the sides, where clamping repeats the
   * painting's flat green.
   */
  private addGround(): void {
    const far = worldZ(RUINS.y1);
    const depth = GROUND_NEAR - far;
    const geometry = new THREE.PlaneGeometry(2 * GROUND_HALF_W, depth);
    rectUv(
      geometry,
      uAt(-GROUND_HALF_W),
      vAt(GROUND_NEAR),
      uAt(GROUND_HALF_W),
      vAt(far),
    );
    const ground = new THREE.Mesh(
      geometry,
      new THREE.MeshStandardMaterial({
        map: this.arena,
        // The plate carries its own lighting and this scene multiplies it by
        // about 0.86; undo that here. Only valid because there is a map.
        color: new THREE.Color().setScalar(1 / 0.86),
      }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(0, FLOOR_Y, (far + GROUND_NEAR) / 2);
    ground.receiveShadow = true;
    this.scene.add(ground);
  }

  syncPlayer(player: Player): void {
    this.archer.sync(player);
    this.dust.track(player);
  }

  syncEnemy(index: number, enemy: Enemy, targeted: boolean): void {
    this.enemies.sync(index, enemy, targeted);
  }

  /** Syncs one arrow and, on the frame it ends, puts a puff where it was. */
  syncArrow(index: number, arrow: Projectile): void {
    if (!this.arrows.sync(index, arrow)) return;
    this.impacts.pop(this.arrows.endedX(index), this.arrows.endedZ(index));
  }

  /**
   * A world point in CSS pixels, for positioning Pixi over the 3D scene.
   * NDC has +Y up, screens have +Y down. `onScreen` is false behind the
   * camera, where the projection still yields plausible coordinates.
   */
  project(x: number, y: number, z: number): Projected {
    this.point.set(x, y, z).project(this.camera);
    projected.x = (this.point.x * 0.5 + 0.5) * this.screenW;
    projected.y = (-this.point.y * 0.5 + 0.5) * this.screenH;
    projected.onScreen = this.point.z < 1;
    return projected;
  }

  /**
   * Pixels per world unit, measured horizontally at (x, z) so the camera's
   * elevation does not foreshorten it. Own vectors: `project()` hands back a
   * shared object the caller may still be reading.
   */
  pixelsPerUnit(x: number, z: number): number {
    this.spanA.set(x, 0, z).project(this.camera);
    this.spanB.set(x + 1, 0, z).project(this.camera);
    return Math.abs(this.spanB.x - this.spanA.x) * 0.5 * this.screenW;
  }

  /**
   * Must run before anything projects through the camera this frame, or the
   * health bars and haze are placed against last frame's view.
   *
   * Exponential damping so the rate is per second regardless of frame time.
   */
  follows(playerZ: number, dt: number): void {
    const { min, max } = cameraRange();
    const target = clamp(playerZ + CAMERA_LEAD, min, max);
    this.follow = Number.isNaN(this.follow)
      ? target
      : this.follow +
        (target - this.follow) * (1 - Math.exp(-dt * FOLLOW_RATE));
    aimCamera(this.camera, this.follow);
    // project() reads matrixWorldInverse, which the renderer only refreshes
    // at render time.
    this.camera.updateMatrixWorld(true);
  }

  /** Where the camera is looking, for anything that has to agree with it. */
  get followZ(): number {
    return Number.isNaN(this.follow) ? 0 : this.follow;
  }

  resize(w: number, h: number): void {
    this.screenW = w;
    this.screenH = h;
    this.renderer.setSize(w, h);
    setViewport(w, h);
    frameRoom(this.camera);
    // Re-clamp into the new aspect's travel strip, never reset. Left NaN if
    // still NaN: layout runs before the first frame, and seeding it here would
    // make the opening second a sweep up the room towards the player.
    if (Number.isNaN(this.follow)) return;
    const { min, max } = cameraRange();
    this.follow = clamp(this.follow, min, max);
    aimCamera(this.camera, this.follow);
    // Layout callbacks run before the first frame, so the renderer has not
    // refreshed matrixWorldInverse yet.
    this.camera.updateMatrixWorld(true);
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  update(dt: number): void {
    this.archer.advance(dt);
    this.enemies.advance(dt);
    this.impacts.advance(dt);
    this.dust.advance(dt);
  }
}
