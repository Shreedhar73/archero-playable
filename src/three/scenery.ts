import {
  Box3,
  BufferAttribute,
  type BufferGeometry,
  Color,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  Vector3,
} from "three";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { ROOM_DEPTH, ROOM_WIDTH } from "../config.ts";
import { ELEVATION } from "./camera.ts";
import { createRandom, range } from "../engine/random.ts";

/** Props from the client's mesh set. Static, unrigged, and used for their
 *  geometry alone — materials are assigned here, because the rip carries no
 *  textures and its `DefaultMaterial` has glTF's default metallicFactor of
 *  1.0, which renders black with no environment map. */
export interface SceneryAssets {
  tree: GLTF;
  rock: GLTF;
  mushroom: GLTF;
  /** Not from the client's set — see `Scenery.kinds`. */
  pine: GLTF;
}

/** Fixed seed: the scatter is part of the art, so it must look the same every
 *  run. A different seed is a different level, not a different session. */
const SEED = 20260112;

/**
 * Where props may stand, split by what each orientation actually sees.
 *
 * `frameRoom` fits the room's width in portrait, from about 51 units back,
 * which leaves barely a unit of ground visible past the side walls but a long
 * run of it above and below. Landscape fits the depth instead, from about 31
 * units, which opens the horizontal field to roughly x = +-13 and crops the
 * top and bottom. Scattering uniformly over the union puts most of the props
 * where neither orientation looks, so the zones are weighted instead: the
 * ends for portrait, the flanks for landscape.
 */
interface Zone {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  /** Relative share of cluster centres. */
  weight: number;
  /** Flank zones are sampled on the right and mirrored, so one entry covers
   *  both sides without a second set of numbers to keep in step. */
  mirror: boolean;
}

const ZONES: Zone[] = [
  // Beyond the far wall: the top of a portrait screen, under the HUD. Split
  // around the middle rather than spanning it, because the gate stands there
  // now (`WorldScene.addGate`) and a copse in front of a doorway is a copse
  // in front of the one landmark the room has.
  { minX: 4.8, maxX: 9, minZ: -11, maxZ: -7.2, weight: 3, mirror: true },
  // There is deliberately no zone in front of the near wall. The reference
  // frame's land below the arena is empty: a clean band of grass, then two
  // small conifers in fog, and no rocks, bushes or mushrooms anywhere in it.
  // This zone used to put all three right under the near lip, where they are
  // the largest and sharpest things on screen because nothing is between
  // them and the camera. The two conifers are hand-placed with the rest.
  // Right against the side walls, and now overlapping them: at this framing
  // portrait sees only 0.09 units of ground past the wall, so a band that
  // started clear of it put every tree off the side of the screen. The real
  // game has conifers hugging both screen edges in every frame, and they get
  // there by leaning over the rim — the trunk outside, the canopy inside.
  // This is the band that does the most work in portrait, hence the weight.
  { minX: 4.5, maxX: 6.3, minZ: -13, maxZ: 17, weight: 12, mirror: true },
  { minX: 6.3, maxX: 9.5, minZ: -13, maxZ: 17, weight: 2, mirror: true },
  // Well behind the ruins, where the camera reaches once the player walks to
  // the far wall. The reference's far end is a field of conifers standing in
  // fog, and before the painting replaced the drawn ground this was the only
  // stretch of surround with nothing scattered on it.
  { minX: -11, maxX: 11, minZ: -24, maxZ: -13, weight: 5, mirror: false },
  // The outer flanks, which only landscape ever sees.
  { minX: 9.5, maxX: 14, minZ: -8, maxZ: 8, weight: 2, mirror: true },
];

const ZONE_TOTAL = ZONES.reduce((sum, zone) => sum + zone.weight, 0);

/** Keep-out around the room. Tight on purpose: the reference lets canopies
 *  lean over the rim, and these sit a plinth's depth lower than the floor, so
 *  overlapping the wall reads as depth rather than as a mistake. */
/**
 * Keep-out around the room, measured from the wall.
 *
 * Zero: a trunk may stand right against the outside of the wall, which is
 * what puts the canopy over the rim. Portrait sees only 0.09 units of ground
 * past the side wall, so anything that clears the room properly is a sliver
 * at the screen edge or off it entirely — and the real game's trees are not
 * slivers, they lean well into the frame. Nothing can get *inside* the room
 * whatever this is: `findSpot` rejects the room's own footprint outright.
 */
const CLEARANCE = 0;

/**
 * How far up the screen a unit of height carries, in units of z: cot(48.5).
 *
 * This is why a tree standing *outside* the near wall can still be painted
 * over the arena — its canopy climbs the screen towards the room, and at
 * this elevation five units of pine reach 4.4 units of z. From behind the
 * far wall height climbs away from the room, so only the near side has to
 * be kept clear.
 */
const LIFT = Math.cos(ELEVATION) / Math.sin(ELEVATION);

/**
 * The nearest a prop of this height may stand in front of the near wall
 * without its canopy climbing back over the arena. Anything behind the far
 * wall, or clear of the room in x, is left exactly where it is.
 */
function clearOfArena(x: number, z: number, height: number): number {
  const halfX = ROOM_WIDTH / 2 + CLEARANCE;
  const halfZ = ROOM_DEPTH / 2 + CLEARANCE;
  if (z <= halfZ || Math.abs(x) >= halfX + height) return z;
  return Math.max(z, halfZ + LIFT * height);
}

/**
 * One piece of a prop, in fractions of the prop's own height.
 *
 * A tree is three of these — trunk, lower canopy, upper canopy — because one
 * blob scaled to a tree's footprint reads as a splat of paint on the ground.
 * What gives a tree volume from a 68-degree camera is the stacking: the upper
 * canopy stands proud of the lower one, takes the sun on top and drops a
 * shadow across it, and that difference is the only depth cue this angle has.
 */
interface Part {
  geometry: BufferGeometry;
  material: MeshStandardMaterial;
  /** Where this piece's base sits, as a fraction of the prop's height. */
  base: number;
  /** This piece's own height, as a fraction of the prop's height. */
  height: number;
  /** Width against the prop's footprint, 1 being all of it. */
  width: number;
  /** Per-instance colour range. Instanced meshes share one material, so
   *  variety has to come out of the instance colour buffer. */
  from: Color;
  to: Color;
  /** Whether this piece is drawn into the shadow map. Off for most of them:
   *  the shadow pass pays for every instance again, and a trunk hidden under
   *  its own canopy or a rock the size of a boot contributes nothing a player
   *  can see. */
  shadow: boolean;
}

interface PropKind {
  parts: Part[];
  /**
   * Hand-placed spots, as `[x, z, height]`. When present the scatter is not
   * used at all.
   *
   * Art direction, not procedural variety. The real game shows about three
   * trees against the arena at any moment — two down one side, one down the
   * other — and at that count a weighted random scatter is a lottery: one
   * seed clumps all three below the near wall and leaves both flanks bare.
   * Scatter is right for forty rocks and wrong for three trees.
   */
  fixed?: [number, number, number][];
  /** Props are placed in copses, not sprinkled: an even scatter reads as a
   *  texture, and clumps read as a wood. */
  clusters: number;
  minPer: number;
  maxPer: number;
  /** How far a prop may sit from its cluster's centre. */
  spread: number;
  minHeight: number;
  maxHeight: number;
  /** Footprint against height. Below 1 for a tree, which is taller than it is
   *  wide; well above it for a rock slab. */
  widthRatio: number;
}

/** One placed prop, before it is written into the instance buffers. */
interface Spot {
  x: number;
  z: number;
  height: number;
  /** Per-prop stretch, so neighbouring copies of one blob differ. */
  stretch: number;
  angle: number;
  /** Position in the part's colour range, 0 to 1. */
  shade: number;
}

/**
 * Trees, rocks and mushrooms scattered outside the walls. Instanced: five
 * draw calls for a few hundred pieces, because the frame budget is 16.6 ms
 * and the characters have first claim on it.
 *
 * Decoration only. Nothing here is in any collision list — the room's walls
 * are what bound play, and art that silently changed the rules would make
 * every visual tweak a gameplay change.
 */
export class Scenery {
  readonly root = new Group();

  constructor(assets: SceneryAssets, groundY: number) {
    const random = createRandom(SEED);
    this.root.position.y = groundY;

    const matrix = new Matrix4();
    const position = new Vector3();
    const quaternion = new Quaternion();
    const axis = new Vector3(0, 1, 0);
    const scale = new Vector3();
    const colour = new Color();

    for (const kind of this.kinds(assets)) {
      // Every part of a prop reads the same spots, which is what keeps a
      // trunk under its own canopy.
      const spots =
        kind.fixed === undefined
          ? this.scatter(random, kind)
          : kind.fixed.map(([x, z, height]) => ({
              x,
              // Hand-placed, then held off the arena by the same rule the
              // scattered ones obey: the four at the near corners are five
              // units tall and were leaning their canopies back over the
              // play area. Moved rather than dropped — the framing is why
              // they are hand-placed at all, and the haze they land in is
              // where the reference keeps its own near trees.
              z: clearOfArena(x, z, height),
              height,
              stretch: range(random, 0.9, 1.12),
              angle: range(random, 0, Math.PI * 2),
              shade: random(),
            }));

      for (const part of kind.parts) {
        const mesh = new InstancedMesh(
          part.geometry,
          part.material,
          spots.length,
        );

        for (let i = 0; i < spots.length; i++) {
          const spot = spots[i];
          const width = spot.height * kind.widthRatio * part.width;
          position.set(spot.x, spot.height * part.base, spot.z);
          quaternion.setFromAxisAngle(axis, spot.angle);
          scale.set(width * spot.stretch, spot.height * part.height, width);
          matrix.compose(position, quaternion, scale);
          mesh.setMatrixAt(i, matrix);
          mesh.setColorAt(i, colour.lerpColors(part.from, part.to, spot.shade));
        }

        mesh.castShadow = part.shadow;
        // Nothing out here receives: these are small, saturated shapes and
        // the surround they stand on already takes the trees' shadows.
        mesh.receiveShadow = false;
        this.root.add(mesh);
      }
    }
  }

  /** Cluster centres, then members jittered around them. */
  private scatter(random: () => number, kind: PropKind): Spot[] {
    const spots: Spot[] = [];

    for (let c = 0; c < kind.clusters; c++) {
      const centre = this.findSpot(random, kind, 0, 0);
      if (centre === null) continue;
      const count = Math.round(range(random, kind.minPer, kind.maxPer));

      for (let i = 0; i < count; i++) {
        const spot = this.findSpot(random, kind, centre.x, centre.z, kind.spread);
        if (spot === null) continue;
        spots.push({
          x: spot.x,
          z: spot.z,
          height: range(random, kind.minHeight, kind.maxHeight),
          stretch: range(random, 0.88, 1.15),
          angle: range(random, 0, Math.PI * 2),
          shade: random(),
        });
      }
    }
    return spots;
  }

  /**
   * Rejection sampling around a point: pick a spot, retry while it lands on
   * the room. `spread` of 0 means anywhere in a weighted zone, which is how
   * cluster centres are chosen. Returns null when every attempt landed on the
   * room — a prop skipped is cheaper than a prop inside a wall.
   */
  private findSpot(
    random: () => number,
    kind: PropKind,
    aroundX: number,
    aroundZ: number,
    spread = 0,
  ): { x: number; z: number } | null {
    const halfX = ROOM_WIDTH / 2 + CLEARANCE;
    const halfZ = ROOM_DEPTH / 2 + CLEARANCE;

    for (let attempt = 0; attempt < 24; attempt++) {
      let x: number;
      let z: number;

      if (spread === 0) {
        const zone = pickZone(random);
        x = range(random, zone.minX, zone.maxX);
        z = range(random, zone.minZ, zone.maxZ);
        if (zone.mirror && random() < 0.5) x = -x;
      } else {
        x = aroundX + range(random, -spread, spread);
        z = aroundZ + range(random, -spread, spread);
      }

      if (Math.abs(x) <= halfX && Math.abs(z) <= halfZ) continue;
      // Outside the room's footprint is not the same as off the arena: see
      // LIFT. A prop in front of the near wall is rejected if its own height
      // would carry its canopy back over the play area.
      if (z > halfZ && clearOfArena(x, z, kind.maxHeight) !== z) continue;
      return { x, z };
    }
    return null;
  }

  private kinds(assets: SceneryAssets): PropKind[] {
    // Two tree meshes, and neither is interchangeable with the other.
    //
    // The client's set has exactly one tree-ish mesh and it is a *blob* —
    // 0.58 x 0.56 x 0.40, one rounded mass, its green in COLOR_0. The real
    // game's trees are conifers: a tiered cone of drooping fronds, lighter
    // towards the top. Stacking the blob into tiers was tried and reads as
    // broccoli, and building the tiers out of cones reads as cones. So the
    // pine is a downloaded low-poly model (needles and trunk, 25 KB through
    // the pipeline) and the client's blob stays in the scene as what it
    // actually is: the round bushes that grow between the pines.
    const canopy = prop(assets.tree);
    const [needles, trunk] = propParts(assets.pine);
    // The blob carries its green in COLOR_0, so its material has to let
    // vertex colours through. The pine does not have the attribute at all,
    // and `vertexColors` on a geometry without one renders it black. Both
    // still take their variation from the instance colour buffer.
    const blobLeaf = (): MeshStandardMaterial =>
      new MeshStandardMaterial({ vertexColors: true, roughness: 1 });

    return [
      {
        // The pine, as two parts rather than one, so needles and trunk can be
        // tinted apart. `propParts` normalised them against a shared box, so
        // both are placed by base 0, height 1, width 1 — the model already
        // holds its own proportions.
        parts: [
          {
            geometry: needles.geometry,
            material: needles.material,
            base: 0,
            height: 1,
            width: 1,
            // The reference's trees are a bright mid-green, darker at the
            // skirt than at the tip. The spread across the range is what
            // stops a stand of them looking like one tree stamped out nine
            // times.
            from: new Color(0x3f8f33),
            to: new Color(0x63b84a),
            // The one piece that casts: it is the widest part of the tree, so
            // its shadow is the tree's shadow.
            shadow: true,
          },
          {
            geometry: trunk.geometry,
            material: trunk.material,
            base: 0,
            height: 1,
            width: 1,
            from: new Color(0x7a5a38),
            to: new Color(0x96724a),
            shadow: false,
          },
        ],
        // Counted off the recording rather than chosen: at any moment the
        // real game shows about two pines down one side of the arena, one
        // down the other, and a thin scatter beyond the walls — not a
        // forest. An earlier pass put roughly two hundred out there and the
        // arena read as a clearing hacked out of woodland, which is the
        // opposite of a bright room with trees at its edges.
        //
        // The room is 9 by 12, so x = +-4.5 is the wall. The three against
        // it stand just outside and lean in; the rest sit beyond the near
        // and far walls, clear of the gate.
        // A trunk at 4.95 is a tenth of a unit clear of the plinth rim, and
        // portrait sees to x = 4.59 — so what shows of a side tree is the
        // inner third of its canopy, which is what the recording shows too.
        // Height is doing the rest of the work: the taller the pine, the
        // wider the canopy and the more of it reaches over the wall.
        fixed: [
          [4.95, -3.0, 6.4],
          [4.95, 4.1, 5.8],
          [-4.95, 0.6, 6.1],
          // The two in front of the near wall, measured off the reference
          // frame rather than scattered. Its arena is 1131 px wide for nine
          // units, so 125.7 px a unit: both tree centres sit at |x| = 3.7,
          // their tops land 0.8 units of screen BELOW the wall line, and
          // what shows of each is about 1.75 units tall. A cone 0.47 as wide
          // as it is high reads h * (cos E + 0.47 sin E) = 1.011 h up the
          // screen, so that is a tree about two units tall — and for its top
          // to fall 0.8 below the wall it has to stand (0.8 + h cos E) / sin
          // E = 3 units out from it.
          //
          // Four conifers five units tall used to stand here, a unit past
          // the wall, and they were the sharpest, largest things on screen.
          // The reference's are tree tops in fog, which is the whole reason
          // its land reads as far away rather than as a garden.
          [-3.8, 11.2, 2.4],
          [3.7, 11.0, 2.2],
          [-7.0, -8.5, 4.4],
          [7.1, -8.9, 4.1],
          // Beyond the ruins, where the camera reaches once the player walks
          // to the far wall. The tall kind never scatters — `clusters` is 0
          // and every one of these is placed by hand — so the field of
          // conifers the reference has past its doorway has to be listed
          // here or it does not exist.
          //
          // Inside |x| < 4.8 and no further back than z = -16: at the far
          // end of the camera's travel the view reaches z = -17 and spans
          // about nine units across, and the first five of these were put
          // at |x| up to 9.5 and z to -22, which is simply off the screen.
          [-4.1, -12.6, 4.8],
          [4.3, -13.4, 4.5],
          [-2.5, -15.8, 4.1],
          [2.7, -15.2, 3.8],
          // The far end cannot be extended, and this is the line that says
          // why. The camera's travel stops at lookZ = -4.44, so the top of a
          // portrait screen is z = -4.44 - 9.978 / sin(48.5) = -17.8 — and
          // on this side height climbs *away* from the view, because a far
          // tree's canopy sits higher on screen than its trunk. A pine whose
          // base is off the top is off the top entirely. Six were placed out
          // to -28 and every one of them was invisible at any camera
          // position; these two fill to the bound instead. The land itself
          // runs 40 units past the gate (`WorldScene.addBeyond`) and always
          // did — what was short was never the ground.
          [-6.0, -16.9, 4.6],
          [6.1, -17.4, 4.2],
          // The near land is the end that could be tripled, and these are
          // what stand in it. Here height climbs *towards* the arena, so a
          // pine whose base is past the bottom of the screen (z = 17.8) still
          // shows its top: for a four-unit tree that reaches back to z = 21.
          // They stand in the deep end of the haze, so what each contributes
          // is a shape in fog rather than a tree — the two at 11 are the ones
          // meant to read as trees.
          [-6.2, 13.4, 4.2],
          [5.5, 14.1, 3.8],
          [-2.4, 16.2, 4.6],
          [2.9, 18.3, 4.0],
          [-7.4, 18.9, 3.6],
        ],
        clusters: 0,
        minPer: 0,
        maxPer: 0,
        spread: 0,
        minHeight: 3.2,
        maxHeight: 5.4,
        // 1, not a tree-ish fraction: the model is 7.5 wide against 16.1 tall
        // and `propParts` normalised it to unit height, so it already carries
        // its own proportions. Multiplying by a second ratio squashed every
        // pine to a spike.
        widthRatio: 1,
      },
      {
        // The client's own blob, used as the bush it is. Fewer and lower
        // than the conifers, so they read as undergrowth between them rather
        // than as a second kind of tree.
        parts: [
          {
            geometry: canopy,
            material: blobLeaf(),
            base: 0,
            height: 0.78,
            width: 1,
            from: new Color(0x4a8a33),
            to: new Color(0x62a843),
            shadow: true,
          },
          {
            geometry: canopy,
            material: blobLeaf(),
            base: 0.46,
            height: 0.6,
            width: 0.74,
            from: new Color(0x5c9f3c),
            to: new Color(0x74ba4e),
            shadow: false,
          },
        ],
        clusters: 7,
        minPer: 1,
        maxPer: 2,
        spread: 1,
        minHeight: 0.85,
        maxHeight: 1.5,
        widthRatio: 1.2,
      },
      {
        parts: [
          {
            geometry: prop(assets.rock),
            material: new MeshStandardMaterial({ roughness: 1 }),
            base: 0,
            height: 1,
            width: 1,
            from: new Color(0x6c675e),
            to: new Color(0x857f74),
            shadow: false,
          },
        ],
        clusters: 9,
        minPer: 1,
        maxPer: 2,
        spread: 0.9,
        minHeight: 0.3,
        maxHeight: 0.65,
        // The slab is already three times as wide as it is tall once it is
        // normalised to unit height, so its own proportions are kept.
        widthRatio: 1,
      },
      {
        // The reference scatters a few pink caps near the rim; from this
        // camera they are punctuation, not props.
        parts: [
          {
            geometry: prop(assets.mushroom),
            material: new MeshStandardMaterial({ roughness: 1 }),
            base: 0,
            height: 1,
            width: 1,
            from: new Color(0xc9557a),
            to: new Color(0xe07a92),
            shadow: false,
          },
        ],
        clusters: 8,
        minPer: 1,
        maxPer: 3,
        spread: 0.7,
        minHeight: 0.26,
        maxHeight: 0.42,
        widthRatio: 1,
      },
    ];
  }
}

/** Weighted pick over the zones. */
function pickZone(random: () => number): Zone {
  let ticket = random() * ZONE_TOTAL;
  for (const zone of ZONES) {
    ticket -= zone.weight;
    if (ticket <= 0) return zone;
  }
  return ZONES[ZONES.length - 1];
}

/**
 * Every mesh in a GLTF, baked into geometries that *together* stand one unit
 * tall, sit on y = 0 and are centred on x/z.
 *
 * Normalised against the shared bounding box rather than each mesh's own, so
 * a model built from more than one piece keeps them in the right places
 * relative to each other — a trunk normalised on its own would come out the
 * same height as the tree it holds up. Returned tallest-first, which for a
 * tree is foliage then trunk.
 */
function propParts(gltf: GLTF): PropPart[] {
  gltf.scene.updateWorldMatrix(true, true);

  const parts: PropPart[] = [];
  gltf.scene.traverse((node) => {
    if (!(node instanceof Mesh)) return;
    const geometry = node.geometry.clone();
    widen(geometry, "position");
    widen(geometry, "normal");
    geometry.applyMatrix4(node.matrixWorld);
    // The model's own material, kept rather than replaced: unlike the
    // client's rip this one ships textures, and they are already paid for in
    // the bundle. Cloned because the instance tint writes through it.
    const material = (
      Array.isArray(node.material) ? node.material[0] : node.material
    ).clone() as MeshStandardMaterial;
    material.roughness = 1;
    material.metalness = 0;
    // The map is dropped on purpose. The instance colour *multiplies* the
    // texture, so with a dark one no tint can reach the bright mid-green the
    // reference's trees are — and the pine's is a dark teal. Flat colour per
    // instance gets there, matches how every other prop here is coloured,
    // and takes the two baked textures out of the bundle with it.
    material.map = null;
    parts.push({ geometry, material });
  });
  if (parts.length === 0) throw new Error("scenery prop has no mesh");
  const geometries = parts.map((part) => part.geometry);

  const shared = new Box3();
  for (const geometry of geometries) {
    shared.union(
      new Box3().setFromBufferAttribute(
        geometry.getAttribute("position") as BufferAttribute,
      ),
    );
  }
  const size = shared.getSize(new Vector3());
  const centre = shared.getCenter(new Vector3());
  const unit = 1 / Math.max(size.y, 1e-6);
  for (const geometry of geometries) {
    geometry.translate(-centre.x, -shared.min.y, -centre.z);
    geometry.scale(unit, unit, unit);
  }

  parts.sort((a, b) => {
    a.geometry.computeBoundingBox();
    b.geometry.computeBoundingBox();
    return (b.geometry.boundingBox?.max.y ?? 0) - (a.geometry.boundingBox?.max.y ?? 0);
  });
  return parts;
}

/** One mesh of a multi-part prop, with the material it shipped with. */
interface PropPart {
  geometry: BufferGeometry;
  material: MeshStandardMaterial;
}

/**
 * The first mesh in a GLTF, baked into a geometry that stands one unit tall,
 * sits on y = 0 and is centred on x/z. Normalised here rather than at each
 * instance so a scatter can think in world heights instead of in whatever
 * scale the prop happened to be authored at.
 */
function prop(gltf: GLTF): BufferGeometry {
  gltf.scene.updateWorldMatrix(true, true);

  const meshes: Mesh[] = [];
  gltf.scene.traverse((node) => {
    if (node instanceof Mesh) meshes.push(node);
  });
  const mesh = meshes[0];
  if (mesh === undefined) throw new Error("scenery prop has no mesh");

  const geometry = mesh.geometry.clone();
  // Meshopt stores positions and normals quantized into normalised integers,
  // with the real size carried on the node's scale. Baking that scale into an
  // integer attribute would clip every value back into [-1, 1], so the two
  // attributes a matrix touches are widened to float first.
  widen(geometry, "position");
  widen(geometry, "normal");
  geometry.applyMatrix4(mesh.matrixWorld);

  const box = new Box3().setFromBufferAttribute(
    geometry.getAttribute("position") as BufferAttribute,
  );
  const size = box.getSize(new Vector3());
  const centre = box.getCenter(new Vector3());
  geometry.translate(-centre.x, -box.min.y, -centre.z);
  const unit = 1 / Math.max(size.y, 1e-6);
  geometry.scale(unit, unit, unit);
  return geometry;
}

/** Replaces one attribute with a float copy, denormalising as it goes. */
function widen(geometry: BufferGeometry, name: string): void {
  const attr = geometry.getAttribute(name);
  if (attr === undefined || attr.array instanceof Float32Array) return;

  const out = new Float32Array(attr.count * attr.itemSize);
  for (let i = 0; i < attr.count; i++) {
    for (let c = 0; c < attr.itemSize; c++) {
      out[i * attr.itemSize + c] = attr.getComponent(i, c);
    }
  }
  geometry.setAttribute(name, new BufferAttribute(out, attr.itemSize));
}
