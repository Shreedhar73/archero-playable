import { BoxGeometry, Group, Mesh, MeshStandardMaterial } from "three";
import type { Obstacle } from "../game/obstacles.ts";

/** Create height. Visual only collision is 2d so height doesnt impact */
const HEIGHT = 0.9;
export class ObstacleViews {
  readonly root = new Group();
  constructor(obstacles: Obstacle[]) {
    const material = new MeshStandardMaterial({ color: 0xd8d4c4 });
    obstacles.forEach((e: Obstacle) => {
      const mesh = new Mesh(
        new BoxGeometry(e.halfX * 2, HEIGHT, e.halfZ * 2),
        material,
      );
      // BoxGeometry is centred on its origin, so half the height lifts it to
      // stand on the floor rather than hover above it.
      mesh.position.set(e.x, HEIGHT / 2, e.z);
      this.root.add(mesh);
    });
  }
}
