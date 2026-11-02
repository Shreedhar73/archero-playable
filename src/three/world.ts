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

/**
 * Everything the scene needs loaded before it can be built. An options object
 * rather than five positional arguments: four of them are GLTFs, so the
 * compiler could not tell them apart if they were swapped.
 */
export interface WorldAssets {
  /** The player. Its own model since the chibi hero landed. */
  hero: GLTF;
  /** The enemy archers, who still clone Erika. */
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

/**
 * The arena is **not a box**. It is a patch of ground.
 *
 * It used to stand on a plinth behind waist-high walls, and from above that
 * read as a crate the fight happens inside. It is cut into the ground now
 * instead, which is what the real game does: the play area sits a step below
 * its surroundings, the earth of that cut shows at the edges, and a sawtooth
 * fringe of grass hangs over the far lip.
 *
 * **There is no line around it, and that was the lesson.** A boundary stripe
 * was drawn three times — coral, coral over a dark band, then bare earth
 * measured off a 3x zoom of the recording — and rejected every time, because
 * a rectangle ruled round the play area reads as a border however faithful
 * it is. What the recording actually has at that edge is not paint. It is
 * the side of this step.
 *
 * Nothing here is in any collision list; `clampToRoom` is still the only
 * thing that stops a body at the edge, and the floor is still y = 0.
 */

/**
 * The painting, in its own pixel coordinates, and what they mean out here.
 *
 * `assets/arena.webp` is `assets/raw/level-1.jpg` resized and alpha-keyed and
 * nothing else — no crop, no re-composite — so these are the source image's
 * own numbers and can be checked against it in any image viewer.
 *
 * FIELD is the arena, coral border to coral border. It is the one rectangle
 * that has to land exactly on ROOM_WIDTH x ROOM_DEPTH, because `clampToRoom`
 * stops bodies at that rectangle's edge and nothing in `src/game/` has ever
 * heard of this image. Everything else is placed relative to it.
 *
 * The painting's field is 1635 px long where the room is 16 units and 1034 px
 * wide where it is 9, so the two scales differ by 12%: its arena is shorter
 * than ours. Mapping is where that is absorbed — the squares come out 12%
 * long in z, which the 48.5-degree camera foreshortens back towards square.
 */
const IMAGE_W = 1200;
/**
 * 2529, not the source painting's 2100: `scripts/build-arena.py` grows the
 * canvas by 429 rows of flat surround green and draws the near border the
 * painting never had.
 *
 * It had to. FIELD.y1 is the near wall and it used to be the image's last
 * row, so the arena's bottom row of checker was what `ClampToEdgeWrapping`
 * repeated over the four units of ground between the wall and GROUND_NEAR —
 * four units of painted arena in front of an arena that stops at the wall,
 * with the trees and rocks `Scenery` correctly placed outside the room
 * standing on top of it. The field keeps its own coordinates; only what lies
 * past its near edge is new.
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
 * How far the ground reaches, in world units.
 *
 * Wider and longer than the painting, on purpose: the UVs run past 0 and 1 at
 * the sides and `ClampToEdgeWrapping` repeats the painting's own outermost
 * column, which along the arena is flat surround green. That is the padding,
 * and it costs no pixels.
 *
 * The near end used to be the honest weak point, because what clamping
 * repeated towards the camera was the plate's last row of arena checker. It
 * is not any more — see IMAGE_H: the plate carries a near border and an apron
 * of surround green that reaches past GROUND_NEAR, so clamping repeats flat
 * green or nothing at all.
 */
const GROUND_HALF_W = 11;
/**
 * 20, three times the four units it used to reach past the near wall.
 *
 * The plate's apron is only 4.2 units long, and it does not have to be any
 * longer: its last row is flat surround green by construction, so what
 * `ClampToEdgeWrapping` repeats over the remaining eight units is that one
 * colour. Extending the *mesh* costs two triangles and extending the
 * *texture* would cost rows of a single flat value.
 *
 * It is worth having because the camera reaches further than the old ground
 * did. At the near end of its travel the bottom of a portrait screen is
 * z = 17.8, so everything past 12 was `scene.background` showing through —
 * the right colour, but flat, with nothing standing on it.
 */
const GROUND_NEAR = 20;

const FLOOR_Y = 0;

/**
 * The land beyond the ruins, and the colour of the horizon behind it.
 *
 * The painting stops at the ruins' feet, and when the camera follows the
 * player to the far wall what used to lie past the doorway — land, trees,
 * haze — went with the geometry the plate replaced. The reference still has
 * all three: its far end is a field of fog with conifers standing in it.
 *
 * Flat, because that is all it ever was: one colour, the painting's own
 * surround sampled at RGB(143,202,36) and used raw. Not divided by the 0.86
 * this lighting multiplies by, the way the painted ground's material is —
 * that plane is unlit, so there is nothing to undo, and dividing it is what
 * put a bright seam at the ruins' feet. The trees out there are `Scenery`'s,
 * and `src/ui/mist.ts` fades the whole thing out.
 */
const BEYOND = 0x8fca24;

/**
 * How fast the camera closes the gap to where it wants to be, per second.
 *
 * The reference's camera lags the player and catches up — that lag is most of
 * what makes its movement read as smooth rather than as the room being
 * dragged. Fast enough that the player never walks off the top of the screen,
 * slow enough that a flick of the joystick does not snap the whole room.
 */
const FOLLOW_RATE = 4.5;

/**
 * Three.js world boot: renderer, camera, light. Owns the #world canvas,
 * stacked below the Pixi UI overlay. resize() only touches renderer/camera.
 */
/**
 * The one image both the ground and the ruins are cut from.
 *
 * sRGB explicitly, because three decodes a colour map as linear otherwise and
 * the grass comes out pale. Clamped rather than wrapped: each mesh's UVs stay
 * inside its own band, so wrapping could only ever be a bug showing itself.
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
 * Points a plane at one rectangle of the painting, by rewriting its UVs.
 *
 * This is what replaces cutting the image up: two meshes, two rectangles, one
 * file and one upload. `texture.offset`/`repeat` would do the same arithmetic
 * but they live on the texture, so two rectangles would mean two textures.
 * The rectangle is a per-mesh fact, so it belongs on the per-mesh thing.
 *
 * Values outside 0..1 are intended and clamp — see GROUND_HALF_W.
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
  private screenW = 1;
  private screenH = 1;
  /**
   * Where the camera is looking along the room's centre line.
   *
   * View state, not game state: the simulation never reads it, so a rotation
   * re-clamps it rather than resetting it and nothing restarts. NaN until the
   * first aim, which is how the camera starts on the player instead of
   * sweeping onto them from the middle of the room.
   */
  private follow = Number.NaN;
  /** Both the ground and the ruins are bands of this one image. */
  private readonly arena = arenaTexture();
  private readonly point = new THREE.Vector3();
  /** pixelsPerUnit()'s own pair — see the note there. */
  private readonly spanA = new THREE.Vector3();
  private readonly spanB = new THREE.Vector3();

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
    this.scene.background = new THREE.Color(BEYOND);

    // Long lens, not a wide one: a narrow FOV from far away keeps the room's
    // near and far edges nearly the same width, so the arena reads as a
    // rectangle. frameRoom sets position, near and far on every resize.
    // The frustum is set by `frameRoom` on the first resize; these are
    // placeholders, not a framing.
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);

    // Hemisphere fills the shadows with sky colour so they are not black;
    // the directional light is what actually shapes anything.
    // Soft and nearly flat, which is what the reference is: a weak warm key
    // from the upper left over a lot of sky bounce. Pushed to 2.6 once and
    // every pale surface blew out — the sage crates came back white, which
    // was the thing being fixed.
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

    // Eight is more than the pool can end in one frame in any run the
    // harness has produced, and a puff outlives its arrow by a fifth of a
    // second rather than a lifetime.
    this.impacts = new Impacts(8);
    this.scene.add(this.impacts.root);

    this.enemies = new EnemyViews(assets.enemy, assets.archer);
    this.castOnly(this.enemies.root);
    this.scene.add(this.enemies.root);
  }

  /**
   * One directional light, angled off-axis so faces that meet at a corner get
   * different brightness. Weak, with the hemisphere doing most of the work:
   * the reference is lit almost flat and its shadows are short and soft,
   * where a strong key threw hard black bars off every crate. Its shadow camera is orthographic and sized to the
   * room plus a margin: every unit it covers costs shadow-map resolution, so
   * a loose box is a blurry contact shadow.
   */
  /**
   * The land past the ruins' feet, where the painting runs out.
   *
   * A hair below the painted ground rather than level with it: the two are
   * coplanar otherwise, and a flickering horizon is worse than a seam.
   * Unlit, because a flat colour under a key light is a flat colour with a
   * gradient on it, and this one has to meet the painting's own apron.
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
   * The way out, beyond the far wall: the source image's ruins, keyed off
   * their dark background and stood upright at the far edge.
   *
   * Upright, not flat. The plate below is a top-down painting and lies on the
   * ground, but the ruins are painted in elevation — their front faces are
   * what you see — so laid flat they smear into the grass. One quad at the
   * far lip is where that painting is already looking from.
   *
   * Unlit (`MeshBasicMaterial`): the stone has its own shading baked in, and
   * a second light over the top greys it. `alphaTest` rather than blending,
   * so the doorway is a hole that sorts correctly against everything behind
   * it instead of a transparent surface fighting the depth buffer.
   */
  private addGate(): void {
    // Width and height both from the across-scale: the ruins are painted in
    // elevation, so their pixels are height, not the depth PX_Z measures.
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
    // Its foot on the floor, a hair beyond the far wall so the fringe painted
    // on the plate still reads in front of it.
    // Standing on the row the painting has them standing on, centred where
    // the painting centres them — both read off the image, not nudged.
    gate.position.set(
      worldX((RUINS.x0 + RUINS.x1) / 2),
      height / 2,
      worldZ(RUINS.y1),
    );
    this.scene.add(gate);
  }

  private addSun(): void {
    const sun = new THREE.DirectionalLight(0xfff3dc, 1.15);
    // From the upper left, as the reference's shaft is — but steep. At a
    // shallower angle every crate dragged a long hard bar across the grass,
    // where the reference's shadows are short and sit under the thing that
    // casts them.
    sun.position.set(-4, 26, 5);
    sun.target.position.set(0, 0, 1);
    sun.castShadow = true;
    // 1024 over a 22-unit shadow box is a 0.021-unit texel — finer than any
    // crate edge reads at this distance, and a quarter of the memory and fill
    // cost of 2048 on a phone.
    sun.shadow.mapSize.set(1024, 1024);
    const box = sun.shadow.camera;
    box.left = -13;
    box.right = 13;
    box.top = 17;
    box.bottom = -17;
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
   * The ground: one plate, painted.
   *
   * It replaces four things that were drawn here — the surround, the banks of
   * the step, the checkered floor and the sawtooth fringe — because the
   * source image already has all four in it, and two of them drawn twice
   * would fight. The arena field in that image is mapped onto exactly
   * ROOM_WIDTH x ROOM_DEPTH, so `clampToRoom` still stops bodies where the
   * painted earth line is.
   *
   * **The arena is flat again.** It used to be cut a step into the land, and
   * the side of that cut was the project's answer to "no painted border".
   * This image paints the border instead, so the step would only double it.
   *
   * The plane stops at GROUND_HALF_W and GROUND_NEAR and does not reach the
   * horizon; what fills the rest is `scene.background`, set to SURROUND. Its
   * UVs deliberately run outside 0..1 at the sides, where clamping repeats
   * the painting's own flat green, so the join reads as distance.
   */
  private addGround(): void {
    // From the ruins' feet to well in front of the near wall.
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
        // The plate carries its own flat lighting and this scene then
        // multiplies it by about 0.86. The drawn colours used to be written
        // pre-divided by that; a texture cannot be, so the divide moves to
        // the material's multiplier. Safe only because there is a map here.
        color: new THREE.Color().setScalar(1 / 0.86),
      }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(0, FLOOR_Y, (far + GROUND_NEAR) / 2);
    ground.receiveShadow = true;
    this.scene.add(ground);
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

  /** Syncs one arrow and, on the frame it ends, puts a puff where it was. */
  syncArrow(index: number, arrow: Projectile): void {
    if (!this.arrows.sync(index, arrow)) return;
    this.impacts.pop(this.arrows.endedX(index), this.arrows.endedZ(index));
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

  /**
   * How many pixels a world unit spans *horizontally* at (x, z) — horizontal,
   * so the camera's elevation does not foreshorten it. This is what turns a
   * body's world size into the pixel size its floating bar is drawn at, which
   * is the whole reason a bar now tracks the scale its model is drawn at.
   *
   * Its own vectors on purpose: `project()` hands back one shared object that
   * the caller is still reading when this runs.
   */
  pixelsPerUnit(x: number, z: number): number {
    this.spanA.set(x, 0, z).project(this.camera);
    this.spanB.set(x + 1, 0, z).project(this.camera);
    return Math.abs(this.spanB.x - this.spanA.x) * 0.5 * this.screenW;
  }

  /**
   * Follows the player up and down the room. Called before anything projects
   * through the camera, because the health bars and the haze are positioned
   * from that projection and a camera aimed after them lags a frame — which
   * reads as the bars sliding off the heads they belong to.
   *
   * Damped with an exponential rather than a fixed fraction of the gap, so
   * the rate is per second and does not change meaning when the frame time
   * does. `startLoop` already clamps dt to 1/20 s, so a slow frame cannot
   * overshoot.
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
    // at render time — too late for everything that projects this frame.
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
    // Re-clamped into the new aspect's travel strip, never reset: rotating
    // mid-run must re-layout the view, not jump the camera back to the
    // middle of the room.
    //
    // Left NaN if it is still NaN, rather than seeded with one end of the
    // strip. Layout runs before the loop's first frame, so seeding it here
    // is what the damping would then spend the opening second crawling away
    // from — the ad would start by sweeping up the room at the player. The
    // first `follows()` snaps instead, and nothing projects before it.
    if (Number.isNaN(this.follow)) return;
    const { min, max } = cameraRange();
    this.follow = clamp(this.follow, min, max);
    aimCamera(this.camera, this.follow);
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
    this.impacts.advance(dt);
  }
}
