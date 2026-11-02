import {
  BoxGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
} from "three";
import { ROOM_DEPTH, ROOM_WIDTH } from "../config.ts";
import type { Obstacle } from "../game/obstacles.ts";
import { plankTexture } from "./textures.ts";

/** Crate height. Visual only — collision is 2D on the floor plane. */
const HEIGHT = 0.85;

/** Side of one crate, measured off reference.jpg: 46px against a 507px room
 *  that is 9 units wide. Footprints are tiled with these, not stretched. */
const CRATE = 0.82;
export class ObstacleViews {
  readonly root = new Group();

  constructor(obstacles: Obstacle[]) {
    // Sage, not white. The reference's blocks are a pale green-grey against
    // the grass — ours were a near-white top over grey sides, which at this
    // camera angle is the brightest thing on screen and pulled the eye off
    // the fight. Top and sides are a step apart, not a jump.
    //
    // Six materials, not one: BoxGeometry groups its faces, so the top can be
    // a flat pale colour while the sides keep the bordered texture. The real
    // game's blocks read as rounded because their top catches the light and
    // their sides do not, and from a 68-degree camera the top face is most of
    // what is on screen — so that one difference does the work an actual
    // bevel would, for no extra geometry.
    const sides = new MeshStandardMaterial({
      // Pale stone blocks, as in reference.jpg. The baked border gives the
      // toon edge without an outline pass.
      map: plankTexture("#9fb690", "#93ab84", "#7b9470"),
    });
    const top = new MeshStandardMaterial({ color: 0xf2f5e8 });
    const bottom = new MeshStandardMaterial({ color: 0xb6bda6 });
    // +x, -x, +y, -y, +z, -z — BoxGeometry's own group order.
    const material = [sides, sides, top, bottom, sides, sides];

    // One stretched box per obstacle read as a bench. Tiling the same
    // footprint with uniform cubes reads as stacked crates, which is what the
    // references do -- and it costs nothing, because the collision shape is
    // still the single box the game logic knows about.
    const placements: [number, number][] = [];
    const limitX = ROOM_WIDTH / 2;
    const limitZ = ROOM_DEPTH / 2;

    for (const box of obstacles) {
      // Boxes that meet a wall extend past it on purpose, so the push-out
      // never fights clampToRoom. The art must stop at the wall, so tile the
      // clipped footprint rather than dropping whole crates out of it --
      // dropping them left a visible gap between the blocks and the wall.
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

    const mesh = new InstancedMesh(
      new BoxGeometry(CRATE, HEIGHT, CRATE),
      material,
      placements.length,
    );
    const matrix = new Matrix4();
    for (let i = 0; i < placements.length; i++) {
      const [x, z] = placements[i];
      matrix.makeTranslation(x, HEIGHT / 2, z);
      mesh.setMatrixAt(i, matrix);
    }
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.root.add(mesh);
  }
}
