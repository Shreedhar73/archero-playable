import {
  BufferAttribute,
  Color,
  Group,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
} from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { ROOM_DEPTH, ROOM_WIDTH } from "../config.ts";
import type { Obstacle } from "../game/obstacles.ts";
import { softShadowTexture } from "./textures.ts";

/** Side of one block, from reference.jpg. Footprints are tiled with these, not stretched. */
const CRATE = 0.82;
/** Block height. Visual only; collision is 2D. Set by screenshot against the recording. */
const HEIGHT = CRATE * 0.9;
/** Corner radius: the width of the shaded rim between top and side. */
const RADIUS = 0.1;
/**
 * Material colours that render to the recording's sampled top (197,217,181)
 * and side (73,116,67) under this lighting, which gives the top 0.88 of its
 * colour and the side 0.57.
 */
const TOP = new Color("#e0f7ce");
const SIDE = new Color("#82be76");
/** Underside, lit from below by the hemisphere fill. */
const BOTTOM = new Color("#5a8a50");
/**
 * Drop shadow decal, offset lower-left as in the recording. The shadow map is
 * tuned for bodies and falls too short under a block to be seen.
 */
const SHADOW_SIZE = CRATE * 1.5;
const SHADOW_OFFSET = { x: -0.16, z: 0.18 };
const SHADOW_ALPHA = 0.55;

export class ObstacleViews {
  readonly root = new Group();

  constructor(obstacles: Obstacle[]) {
    // Tile each footprint with uniform cubes. Collision stays the single box
    // the game logic knows.
    const placements: [number, number][] = [];
    const limitX = ROOM_WIDTH / 2;
    const limitZ = ROOM_DEPTH / 2;

    for (const box of obstacles) {
      // Boxes that meet a wall extend past it so push-out never fights
      // clampToRoom. Tile the clipped footprint so the art stops at the wall
      // without a gap.
      const minX = Math.max(box.x - box.halfX, -limitX);
      const maxX = Math.min(box.x + box.halfX, limitX);
      const minZ = Math.max(box.z - box.halfZ, -limitZ);
      const maxZ = Math.min(box.z + box.halfZ, limitZ);

      const cols = Math.max(1, Math.round((maxX - minX) / CRATE));
      const rows = Math.max(1, Math.round((maxZ - minZ) / CRATE));
      for (let col = 0; col < cols; col++) {
        for (let row = 0; row < rows; row++) {
          placements.push([
            minX + ((col + 0.5) * (maxX - minX)) / cols,
            minZ + ((row + 0.5) * (maxZ - minZ)) / rows,
          ]);
        }
      }
    }

    // Colour by normal, baked into the vertices: top, side, and the rounded
    // rim graded between them. Touching blocks meet along shaded rims, which
    // is the seam.
    const geometry = new RoundedBoxGeometry(CRATE, HEIGHT, CRATE, 3, RADIUS);
    const normal = geometry.getAttribute("normal");
    const colors = new Float32Array(normal.count * 3);
    const c = new Color();
    for (let i = 0; i < normal.count; i++) {
      const ny = normal.getY(i);
      // Squared so the 45-degree rim is the midpoint and reads as a line.
      if (ny >= 0) c.copy(SIDE).lerp(TOP, ny * ny);
      else c.copy(SIDE).lerp(BOTTOM, -ny);
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    geometry.setAttribute("color", new BufferAttribute(colors, 3));

    const mesh = new InstancedMesh(
      geometry,
      new MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }),
      placements.length,
    );
    const shadows = new InstancedMesh(
      new PlaneGeometry(SHADOW_SIZE, SHADOW_SIZE),
      new MeshBasicMaterial({
        map: softShadowTexture(),
        transparent: true,
        opacity: SHADOW_ALPHA,
        depthWrite: false,
      }),
      placements.length,
    );
    const matrix = new Matrix4();
    for (let i = 0; i < placements.length; i++) {
      const [x, z] = placements[i];
      matrix.makeTranslation(x, HEIGHT / 2, z);
      mesh.setMatrixAt(i, matrix);
      // Flat on the ground, just above it to avoid z-fighting.
      matrix.makeRotationX(-Math.PI / 2);
      matrix.setPosition(x + SHADOW_OFFSET.x, 0.01, z + SHADOW_OFFSET.z);
      shadows.setMatrixAt(i, matrix);
    }
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.root.add(shadows);
    this.root.add(mesh);
  }
}
