import * as THREE from "three";

import type { Player } from "../game/player.ts";
import { ArcherView } from "./archer.ts";
import { type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { EnemyViews } from "./enemy.ts";
import type { Enemy } from "../game/enemy.ts";
import { ROOM_DEPTH, ROOM_WIDTH } from "../config.ts";
import { clamp } from "../engine/math.ts";
import { aimCamera, CAMERA_LEAD, cameraRange, frameRoom } from "./camera.ts";
import { device } from "../engine/device.ts";
import { checkerTexture } from "./textures.ts";
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

/** Teeth across the far edge, and how far each one bites into the arena. */
const FRINGE_TEETH = 52;
const FRINGE_DEPTH = 0.26;
const FRINGE_COLOUR = 0x44812d;

/**
 * Everything flat lives within a hair of y = 0, so the order has to be
 * explicit: coplanar surfaces z-fight, and a flickering floor is worse than
 * any of them is worth.
 */
/**
 * How far the land outside stands above the arena floor.
 *
 * The arena is cut *into* the ground, not laid on top of it — the real game's
 * play area sits a step below its surroundings, and the exposed earth of that
 * cut is what you see at the edges. It is also why every line drawn round the
 * arena was rejected: the edge is a step, and a step is a thing with a side,
 * not a stripe.
 *
 * Nothing in `src/game/` knows about it. Bodies still walk the y = 0 plane
 * and `clampToRoom` still stops them at the same x and z; what moved is the
 * land, upwards.
 */
const DROP = 0.38;

/** Earth, exposed by the cut. */
const BANK_COLOUR = 0xa9763e;
const FLOOR_Y = 0;
const FRINGE_Y = DROP + 0.004;

/** Olive, not pale: in the reference everything outside the arena sits in
 *  tree shade and reads darker than the grass inside. The one pale area is
 *  the near mist, and that is drawn in Pixi over the top (`src/ui/mist.ts`),
 *  because fog fades by distance and the mist is at the near edge. */
/**
 * The land outside, a clear step darker and cooler than the arena.
 *
 * It was briefly lifted to the recording's own sampled outer grass, which is
 * the same brightness as its arena — but the recording can afford that
 * because it rules an earth path between the two, and there is no line here
 * any more. With nothing drawn at the edge, tone is the only thing left
 * saying where play stops, so the two greens have to differ.
 */
const SURROUND = 0x6f9c47;

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
export class WorldScene {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
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
    this.scene.background = new THREE.Color(SURROUND);

    // Long lens, not a wide one: a narrow FOV from far away keeps the room's
    // near and far edges nearly the same width, so the arena reads as a
    // rectangle. frameRoom sets position, near and far on every resize.
    this.camera = new THREE.PerspectiveCamera(22, 1, 1, 100);

    // Hemisphere fills the shadows with sky colour so they are not black;
    // the directional light is what actually shapes anything.
    // Soft and nearly flat, which is what the reference is: a weak warm key
    // from the upper left over a lot of sky bounce. Pushed to 2.6 once and
    // every pale surface blew out — the sage crates came back white, which
    // was the thing being fixed.
    this.scene.add(new THREE.HemisphereLight(0xeaf4ff, 0x8fa172, 1.55));
    this.addSun();

    this.addSurround();
    this.addGate();
    this.scene.add(new Scenery(assets.scenery, DROP).root);
    this.addFloor();
    this.addFringe();
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
   * The way out, beyond the far wall.
   *
   * Not reachable and not simulated — `clampToRoom` still stops every body at
   * the wall. It is there because the reference has one and the top of our
   * room was blank surround: a doorway at the end of the room is what turns
   * "a square you are standing in" into "a room you are trying to leave", and
   * it costs five boxes and no bytes.
   */
  private addGate(): void {
    // Three stone tones, because from 68 degrees the top faces are most of
    // what is on screen and one colour makes a stepped wall read as a slab.
    const stone = new THREE.MeshStandardMaterial({ color: 0x8d9e7e });
    const capstone = new THREE.MeshStandardMaterial({ color: 0xc3cfae });
    const door = new THREE.MeshStandardMaterial({ color: 0x8a6136 });
    // The green shield over the doorway — the reference's level marker. It
    // carries no number here, because nothing in this ad has a level to
    // count; it is the shape that says "this is the way out".
    const badge = new THREE.MeshStandardMaterial({ color: 0x2f7a46 });
    const badgeTrim = new THREE.MeshStandardMaterial({ color: 0xd8e4c2 });
    const z = -ROOM_DEPTH / 2 - 1.3;
    const group = new THREE.Group();

    // x, y(base), z, sizeX, sizeY, sizeZ, material. Built as courses at
    // different heights rather than one wall with a hole: the steps are the
    // only depth cue this camera angle gives a static structure.
    const pieces: [number, number, number, number, number, number, THREE.Material][] = [
      // The long back wall, and a lower apron in front of it.
      [0, 0, z - 0.5, 13, 2.1, 1.4, stone],
      [0, 0, z + 0.7, 13, 0.75, 1.0, capstone],
      // Shoulders stepping down towards the trees at either side.
      [-5.3, 0, z - 0.5, 2.6, 2.9, 1.5, stone],
      [5.3, 0, z - 0.5, 2.6, 2.9, 1.5, stone],
      [-5.3, 2.9, z - 0.5, 2.6, 0.35, 1.5, capstone],
      [5.3, 2.9, z - 0.5, 2.6, 0.35, 1.5, capstone],
      // The two piers either side of the doorway, standing proud of the wall.
      [-1.85, 0, z, 1.1, 3.1, 1.9, stone],
      [1.85, 0, z, 1.1, 3.1, 1.9, stone],
      [-1.85, 3.1, z, 1.3, 0.4, 2.1, capstone],
      [1.85, 3.1, z, 1.3, 0.4, 2.1, capstone],
      // Lintel across the gap, with its own cap on top.
      [0, 2.5, z, 2.7, 0.6, 1.9, stone],
      [0, 3.1, z, 3.0, 0.4, 2.1, capstone],
      // The doors themselves. Across the front of the opening rather than
      // set back inside it: from 68 degrees the lintel roofs over anything
      // recessed, and a doorway with nothing visible in it is just a gap.
      [0, 0, z + 0.78, 2.6, 2.35, 0.4, door],
      // Badge, with a pale rim showing round it.
      [0, 3.0, z + 0.95, 1.5, 1.5, 0.22, badgeTrim],
      [0, 3.1, z + 1.02, 1.2, 1.2, 0.22, badge],
    ];
    for (const [x, base, zz, sx, sy, sz, material] of pieces) {
      const box = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), material);
      box.position.set(x, DROP + base + sy / 2, zz);
      box.castShadow = true;
      box.receiveShadow = true;
      group.add(box);
    }
    this.scene.add(group);
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
   * Ground outside the walls. A 9x12 room cannot fill a 9:19 phone screen, so
   * what surrounds it has to be land rather than void. Flat and darker than
   * the arena, as in the reference: the checker marks where play happens, so
   * checkering the outside too would say the opposite, and lighting it more
   * brightly would make the arena read as a hole.
   */
  private addSurround(): void {
    const material = new THREE.MeshStandardMaterial({ color: SURROUND });
    const halfX = ROOM_WIDTH / 2;
    const halfZ = ROOM_DEPTH / 2;
    const out = ROOM_DEPTH * 3;

    // Four planes rather than one, because the land stands above the arena
    // now: a single sheet at this height would be laid straight over the
    // floor and hide it. x, z, sizeX, sizeZ — a frame with the room's own
    // footprint missing from the middle.
    const sheets: [number, number, number, number][] = [
      [-halfX - out / 2, 0, out, ROOM_DEPTH],
      [halfX + out / 2, 0, out, ROOM_DEPTH],
      [0, -halfZ - out / 2, ROOM_WIDTH + out * 2, out],
      [0, halfZ + out / 2, ROOM_WIDTH + out * 2, out],
    ];
    for (const [x, z, sizeX, sizeZ] of sheets) {
      const sheet = new THREE.Mesh(
        new THREE.PlaneGeometry(sizeX, sizeZ),
        material,
      );
      sheet.rotation.x = -Math.PI / 2;
      sheet.position.set(x, DROP, z);
      sheet.receiveShadow = true;
      this.scene.add(sheet);
    }

    this.addBanks();
  }

  /**
   * The sides of the cut: four slabs of earth whose inner faces are the walls
   * of the pit the arena sits in.
   *
   * These are what the old waist-high walls should have been all along. They
   * stand *below* the land rather than above the floor, so nothing projects
   * between the camera and the fight, and they are not in any collision list
   * — the floor they face is still the y = 0 plane every body walks on.
   */
  private addBanks(): void {
    // Earth on the sides, grass on top: the slab is the edge of the land, so
    // its upper face is still lawn. Left all earth, the top face reads from
    // above as a brown band ruled round the arena — which is the very thing
    // three attempts at a boundary line were deleted for.
    const earth = new THREE.MeshStandardMaterial({ color: BANK_COLOUR });
    const turf = new THREE.MeshStandardMaterial({ color: SURROUND });
    // +x, -x, +y, -y, +z, -z — BoxGeometry's own group order.
    const material = [earth, earth, turf, earth, earth, earth];
    const halfX = ROOM_WIDTH / 2;
    const halfZ = ROOM_DEPTH / 2;
    const thickness = 0.5;
    // x, z, sizeX, sizeZ. Each sits just outside the room, so its inner face
    // lands exactly on the boundary clampToRoom uses.
    const banks: [number, number, number, number][] = [
      [-halfX - thickness / 2, 0, thickness, ROOM_DEPTH + thickness * 2],
      [halfX + thickness / 2, 0, thickness, ROOM_DEPTH + thickness * 2],
      [0, -halfZ - thickness / 2, ROOM_WIDTH, thickness],
      [0, halfZ + thickness / 2, ROOM_WIDTH, thickness],
    ];
    for (const [x, z, sizeX, sizeZ] of banks) {
      const bank = new THREE.Mesh(
        new THREE.BoxGeometry(sizeX, DROP, sizeZ),
        material,
      );
      bank.position.set(x, DROP / 2, z);
      bank.castShadow = true;
      bank.receiveShadow = true;
      this.scene.add(bank);
    }
  }

  /** One checker square per world unit, which is why the GridHelper is gone. */
  private addFloor(): void {
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(ROOM_WIDTH, ROOM_DEPTH),
      new THREE.MeshStandardMaterial({
        // Low contrast, as in the reference: the checker is a scale cue, not
        // a pattern competing with the characters. Two steps apart in value
        // and no more — at four the squares became the thing you look at.
        //
        // The hue is measured, not picked. Sampled from the recording the
        // grass renders RGB(126,177,25); ours rendered (136,186,57) — close
        // in value, far too much blue in it, which is what made ours read as
        // mid-green beside their yellow-green. These are those numbers
        // divided by the 0.86 this lighting multiplies them by.
        // Roughly 1.3 units a square. The reference shows about seven
        // across the arena where ours showed twelve, and a checker that fine
        // stops being a scale cue and becomes a texture.
        map: checkerTexture(
          "#92ce1d",
          "#8dc91a",
          ROOM_WIDTH / 2.6,
          ROOM_DEPTH / 2.6,
        ),
      }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = FLOOR_Y;
    floor.receiveShadow = true;
    this.scene.add(floor);
  }

  /**
   * The sawtooth of darker grass along the far edge.
   *
   * One triangle per tooth, written straight into a buffer: the shape is
   * thirty-four triangles and a loop, where a texture would be a file to
   * inline and a row of cones would be thirty-four transforms for the same
   * silhouette. Unlit, because it is a marking on the ground rather than a
   * thing standing on it.
   */
  private addFringe(): void {
    const halfX = ROOM_WIDTH / 2;
    const z = -ROOM_DEPTH / 2;
    const step = ROOM_WIDTH / FRINGE_TEETH;
    const vertices = new Float32Array(FRINGE_TEETH * 9);

    for (let i = 0; i < FRINGE_TEETH; i++) {
      const left = -halfX + i * step;
      // Every third tooth is longer. A perfectly even sawtooth reads as a
      // pattern printed on the grass; the reference's is grass.
      const depth = FRINGE_DEPTH * (i % 3 === 0 ? 1.45 : 1);
      const points = [
        left, 0, z,
        left + step / 2, 0, z + depth,
        left + step, 0, z,
      ];
      vertices.set(points, i * 9);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(vertices, 3));
    geometry.computeVertexNormals();
    const fringe = new THREE.Mesh(
      geometry,
      // Double-sided: the winding of a flat fan is not worth getting right
      // twice, and one unlit triangle fan costs nothing either way.
      new THREE.MeshBasicMaterial({
        color: FRINGE_COLOUR,
        side: THREE.DoubleSide,
      }),
    );
    fringe.position.y = FRINGE_Y;
    this.scene.add(fringe);
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
      : this.follow + (target - this.follow) * (1 - Math.exp(-dt * FOLLOW_RATE));
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
    this.camera.aspect = w / h;
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
