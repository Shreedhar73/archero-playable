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

/**
 * Props from the ripped mesh set, used for geometry alone. Materials are
 * assigned here: the rip's `DefaultMaterial` has metallicFactor 1.0, which
 * renders black with no environment map.
 */
export interface SceneryAssets {
  tree: GLTF;
  rock: GLTF;
  mushroom: GLTF;
  /** Not from the ripped set; see `Scenery.kinds`. */
  pine: GLTF;
}

/** Fixed seed: the scatter is part of the art and must look the same every run. */
const SEED = 20260112;

/**
 * Where props may stand. Portrait sees barely a unit of ground past the side
 * walls but a long run above and below; landscape is the reverse. Zones are
 * weighted so props land where each orientation looks.
 */
interface Zone {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  /** Relative share of cluster centres. */
  weight: number;
  /** Flank zones are sampled on the right and mirrored. */
  mirror: boolean;
}

const ZONES: Zone[] = [
  // Beyond the far wall, split around the middle so nothing stands in front
  // of the gate.
  { minX: 4.8, maxX: 9, minZ: -11, maxZ: -7.2, weight: 3, mirror: true },
  // No zone in front of the near wall: that land is empty in the real game
  // apart from two hand-placed conifers.
  // Against the side walls, overlapping them. Portrait sees only 0.09 units
  // of ground past the wall, so trees must lean over the rim to show at all.
  { minX: 4.5, maxX: 6.3, minZ: -13, maxZ: 17, weight: 12, mirror: true },
  { minX: 6.3, maxX: 9.5, minZ: -13, maxZ: 17, weight: 2, mirror: true },
  // Behind the ruins, seen once the player walks to the far wall.
  { minX: -11, maxX: 11, minZ: -24, maxZ: -13, weight: 5, mirror: false },
  // The outer flanks, which only landscape ever sees.
  { minX: 9.5, maxX: 14, minZ: -8, maxZ: 8, weight: 2, mirror: true },
];

const ZONE_TOTAL = ZONES.reduce((sum, zone) => sum + zone.weight, 0);

/**
 * Keep-out around the room, measured from the wall. Zero lets a trunk stand
 * right against the outside of the wall with its canopy over the rim.
 * `findSpot` still rejects the room's own footprint.
 */
const CLEARANCE = 0;

/**
 * Units of z a unit of height carries up the screen: cot(elevation). A tree
 * outside the near wall can still paint its canopy over the arena; behind
 * the far wall height climbs away from the room.
 */
const LIFT = Math.cos(ELEVATION) / Math.sin(ELEVATION);

/**
 * The nearest a prop of this height may stand in front of the near wall
 * without its canopy climbing back over the arena.
 */
function clearOfArena(x: number, z: number, height: number): number {
  const halfX = ROOM_WIDTH / 2 + CLEARANCE;
  const halfZ = ROOM_DEPTH / 2 + CLEARANCE;
  if (z <= halfZ || Math.abs(x) >= halfX + height) return z;
  return Math.max(z, halfZ + LIFT * height);
}

/** One piece of a prop, in fractions of the prop's own height. */
interface Part {
  geometry: BufferGeometry;
  material: MeshStandardMaterial;
  /** Where this piece's base sits, as a fraction of the prop's height. */
  base: number;
  /** This piece's own height, as a fraction of the prop's height. */
  height: number;
  /** Width against the prop's footprint, 1 being all of it. */
  width: number;
  /** Per-instance colour range; instanced meshes share one material. */
  from: Color;
  to: Color;
  /** The shadow pass pays for every instance again, so only the pieces that show cast. */
  shadow: boolean;
}

interface PropKind {
  parts: Part[];
  /**
   * Hand-placed spots as `[x, z, height]`. When present the scatter is not
   * used: at three trees a random scatter can clump them all on one side.
   */
  fixed?: [number, number, number][];
  /** Props are placed in copses; an even scatter reads as a texture. */
  clusters: number;
  minPer: number;
  maxPer: number;
  /** How far a prop may sit from its cluster's centre. */
  spread: number;
  minHeight: number;
  maxHeight: number;
  /** Footprint against height. */
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
 * Trees, rocks and mushrooms outside the walls. Instanced: five draw calls
 * for a few hundred pieces. Decoration only, nothing here is in a collision
 * list.
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
      // Every part of a prop reads the same spots, which keeps a trunk under
      // its own canopy.
      const spots =
        kind.fixed === undefined
          ? this.scatter(random, kind)
          : kind.fixed.map(([x, z, height]) => ({
              x,
              // Hand-placed spots still obey the arena keep-out.
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
   * Rejection sampling: pick a spot, retry while it lands on the room.
   * `spread` of 0 means anywhere in a weighted zone, which is how cluster
   * centres are chosen. Null when every attempt failed; a skipped prop is
   * cheaper than one inside a wall.
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
      // In front of the near wall a prop's own height can carry its canopy
      // back over the play area; see LIFT.
      if (z > halfZ && clearOfArena(x, z, kind.maxHeight) !== z) continue;
      return { x, z };
    }
    return null;
  }

  private kinds(assets: SceneryAssets): PropKind[] {
    // The ripped set's only tree-ish mesh is a round blob. The real game's
    // trees are conifers, so the pine is a separate low-poly model and the
    // blob is used as the bushes between the pines.
    const canopy = prop(assets.tree);
    const [needles, trunk] = propParts(assets.pine);
    // The blob carries its green in COLOR_0, so its material must let vertex
    // colours through. The pine has no such attribute, and `vertexColors` on
    // a geometry without one renders black.
    const blobLeaf = (): MeshStandardMaterial =>
      new MeshStandardMaterial({ vertexColors: true, roughness: 1 });

    return [
      {
        // Two parts so needles and trunk tint apart. `propParts` normalised
        // them against a shared box, so both are placed at base 0, height 1.
        parts: [
          {
            geometry: needles.geometry,
            material: needles.material,
            base: 0,
            height: 1,
            width: 1,
            from: new Color(0x3f8f33),
            to: new Color(0x63b84a),
            // Widest part of the tree, so its shadow is the tree's shadow.
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
        // Counts and positions follow the game recording: about two pines
        // down one side, one down the other, a thin scatter beyond the walls.
        // x = +-4.5 is the wall; the three against it stand just outside and
        // lean in.
        fixed: [
          [4.95, -3.0, 6.4],
          [4.95, 4.1, 5.8],
          [-4.95, 0.6, 6.1],
          // Two short conifers in front of the near wall, deep in the haze.
          [-3.8, 11.2, 2.4],
          [3.7, 11.0, 2.2],
          [-7.0, -8.5, 4.4],
          [7.1, -8.9, 4.1],
          // Beyond the ruins. Keep inside |x| < 4.8 and z > -16: the view at
          // the far end of the camera's travel reaches z = -17 and spans
          // about nine units.
          [-4.1, -12.6, 4.8],
          [4.3, -13.4, 4.5],
          [-2.5, -15.8, 4.1],
          [2.7, -15.2, 3.8],
          // At the far end height climbs away from the view, so a pine whose
          // base is past z = -17.8 is off the top entirely. These fill to
          // that bound.
          [-6.0, -16.9, 4.6],
          [6.1, -17.4, 4.2],
          // The near land. Height climbs towards the arena here, so a tree
          // whose base is past the screen bottom (z = 17.8) still shows its top.
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
        // The model is normalised to unit height and keeps its own proportions.
        widthRatio: 1,
      },
      {
        // The blob, as undergrowth between the pines.
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
        // The slab is already wider than it is tall at unit height.
        widthRatio: 1,
      },
      {
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
 * Every mesh in a GLTF, baked into geometries that together stand one unit
 * tall, sit on y = 0 and are centred on x/z. Normalised against the shared
 * bounding box so a multi-piece model keeps its pieces in place. Returned
 * tallest-first.
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
    // Cloned because the instance tint writes through it.
    const material = (
      Array.isArray(node.material) ? node.material[0] : node.material
    ).clone() as MeshStandardMaterial;
    material.roughness = 1;
    material.metalness = 0;
    // The instance colour multiplies the texture, and the pine's is a dark
    // teal no tint can lift to the bright green needed. Flat colour instead.
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
 * sits on y = 0 and is centred on x/z, so the scatter can think in world
 * heights.
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
  // Meshopt stores positions and normals as normalised integers with the
  // real size on the node's scale. Baking that scale into an integer
  // attribute would clip every value into [-1, 1], so widen to float first.
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
