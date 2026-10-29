import {
  Box3,
  BufferAttribute,
  type BufferGeometry,
  Color,
  CylinderGeometry,
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
import { createRandom, range } from "../engine/random.ts";

/** Props from the client's mesh set. Static, unrigged, and used for their
 *  geometry alone — materials are assigned here, because the rip carries no
 *  textures and its `DefaultMaterial` has glTF's default metallicFactor of
 *  1.0, which renders black with no environment map. */
export interface SceneryAssets {
  tree: GLTF;
  rock: GLTF;
  mushroom: GLTF;
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
  // Beyond the far wall: the top of a portrait screen, under the HUD.
  { minX: -7, maxX: 7, minZ: -8.8, maxZ: -6.3, weight: 5, mirror: false },
  // In front of the near wall: the bottom of a portrait screen, where the
  // mist takes over (`src/ui/mist.ts`).
  { minX: -7, maxX: 7, minZ: 6.3, maxZ: 12.5, weight: 3, mirror: false },
  // Right against the side walls. Portrait sees barely half a unit past them,
  // so this is the only flank band it ever shows — and it has to be its own
  // zone, or a wide flank band spends its clusters where only landscape looks.
  { minX: 5.1, maxX: 6.4, minZ: -9, maxZ: 13, weight: 4, mirror: true },
  { minX: 6.4, maxX: 9.5, minZ: -9, maxZ: 13, weight: 2, mirror: true },
  // The outer flanks, which only landscape ever sees.
  { minX: 9.5, maxX: 14, minZ: -8, maxZ: 8, weight: 2, mirror: true },
];

const ZONE_TOTAL = ZONES.reduce((sum, zone) => sum + zone.weight, 0);

/** Keep-out around the room. Tight on purpose: the reference lets canopies
 *  lean over the rim, and these sit a plinth's depth lower than the floor, so
 *  overlapping the wall reads as depth rather than as a mistake. */
const CLEARANCE = 0.6;

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
      const spots = this.scatter(random, kind);

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
      const centre = this.findSpot(random, 0, 0);
      if (centre === null) continue;
      const count = Math.round(range(random, kind.minPer, kind.maxPer));

      for (let i = 0; i < count; i++) {
        const spot = this.findSpot(random, centre.x, centre.z, kind.spread);
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
      return { x, z };
    }
    return null;
  }

  private kinds(assets: SceneryAssets): PropKind[] {
    // The canopy blob from the game's own meshes: 158 triangles, and its
    // green is in COLOR_0, so the materials only have to let it through and
    // tint it. A cone would be cheaper still, and from a 68-degree camera it
    // reads as a pinwheel — the silhouette is the whole point.
    const canopy = prop(assets.tree);
    const leaf = (): MeshStandardMaterial =>
      new MeshStandardMaterial({ vertexColors: true, roughness: 1 });

    return [
      {
        parts: [
          {
            // Six sides, because nothing at this distance resolves more. The
            // sliver of trunk under the canopy is what stops a tree reading
            // as a bush lying on the grass.
            geometry: new CylinderGeometry(0.17, 0.24, 1, 6).translate(
              0,
              0.5,
              0,
            ),
            material: new MeshStandardMaterial({ roughness: 1 }),
            base: 0,
            height: 0.5,
            width: 1,
            from: new Color(0x6b4a2c),
            to: new Color(0x7d5a34),
            shadow: false,
          },
          {
            geometry: canopy,
            material: leaf(),
            base: 0.24,
            height: 0.6,
            width: 1,
            // Dark, as the reference's surround foliage is: outside the arena
            // everything sits in shade, and the arena is what should read lit.
            from: new Color(0x2f5a21),
            to: new Color(0x44742b),
            // The one piece that casts: it is the widest part of the tree, so
            // its shadow is the tree's shadow.
            shadow: true,
          },
          {
            geometry: canopy,
            material: leaf(),
            base: 0.58,
            height: 0.46,
            width: 0.72,
            // A shade lighter than the layer below: this is the part the sun
            // reaches, and the step between them is the volume.
            from: new Color(0x47772c),
            to: new Color(0x5e9336),
            shadow: false,
          },
        ],
        clusters: 42,
        minPer: 2,
        maxPer: 4,
        spread: 1.3,
        minHeight: 2.3,
        maxHeight: 3.6,
        // Taller than wide: a canopy as broad as the tree is high is a bush.
        widthRatio: 0.62,
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
        clusters: 16,
        minPer: 1,
        maxPer: 3,
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
