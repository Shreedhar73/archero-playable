import * as THREE from "three";
import { ROOM_DEPTH, ROOM_WIDTH } from "../config.ts";
import { createRandom, range } from "../engine/random.ts";

/** Fixed seed: the scatter is part of the art, so it must look the same every
 *  run. A different seed is a different level, not a different session. */
const SEED = 20260112;

/**
 * Band the props scatter over. Sized to what the camera actually sees, found
 * by measuring: the visible ground runs about z = -9 to z = +12 and x = +-8.
 * The first version used +-17 and most of the props rendered off-screen --
 * scattering outside the frustum is scattering into nothing.
 */
const SPREAD_X = 8.5;
const SPREAD_Z_NEAR = 13;
const SPREAD_Z_FAR = 11;

/** Keep-out around the room, so nothing grows through a wall. */
const CLEARANCE = 1.1;

/** Second keep-out: the patch of ground the joystick sits over. Props behind
 *  a translucent widget read as dirt on the screen. */
const UI_HALF_X = 4;
const UI_MIN_Z = 7.4;

interface PropKind {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  count: number;
  minScale: number;
  maxScale: number;
  /** Props sit on the ground, so each needs lifting by half its own height. */
  lift: number;
  /** Nearest z this kind may scatter to. Tall props are kept out of the near
   *  strip, because that is where the joystick lives and a 3-unit tree behind
   *  a translucent UI widget is noise. */
  maxZ: number;
}

/**
 * Trees, rocks and crates scattered outside the walls. Instanced: three draw
 * calls for seventy-odd props, because the frame budget is 16.6 ms and the
 * characters have first claim on it.
 *
 * Decoration only. Nothing here is in any collision list — the room's walls
 * are what bound play, and art that silently changed the rules would make
 * every visual tweak a gameplay change.
 */
export class Scenery {
  readonly root = new THREE.Group();

  constructor() {
    const random = createRandom(SEED);

    for (const kind of this.kinds()) {
      const mesh = new THREE.InstancedMesh(
        kind.geometry,
        kind.material,
        kind.count,
      );
      const matrix = new THREE.Matrix4();
      const position = new THREE.Vector3();
      const quaternion = new THREE.Quaternion();
      const scale = new THREE.Vector3();

      for (let i = 0; i < kind.count; i++) {
        const spot = this.findSpot(random, kind.maxZ);
        const size = range(random, kind.minScale, kind.maxScale);
        position.set(spot.x, kind.lift * size, spot.z);
        quaternion.setFromAxisAngle(
          new THREE.Vector3(0, 1, 0),
          range(random, 0, Math.PI * 2),
        );
        scale.setScalar(size);
        matrix.compose(position, quaternion, scale);
        mesh.setMatrixAt(i, matrix);
      }

      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.root.add(mesh);
    }
  }

  /** Rejection sampling: pick a point, retry while it lands on the room. */
  private findSpot(
    random: () => number,
    maxZ: number,
  ): { x: number; z: number } {
    const halfX = ROOM_WIDTH / 2 + CLEARANCE;
    const halfZ = ROOM_DEPTH / 2 + CLEARANCE;
    for (let attempt = 0; attempt < 40; attempt++) {
      const x = range(random, -SPREAD_X, SPREAD_X);
      const z = range(random, -SPREAD_Z_FAR, maxZ);
      if (Math.abs(x) <= halfX && Math.abs(z) <= halfZ) continue;
      if (Math.abs(x) < UI_HALF_X && z > UI_MIN_Z) continue;
      return { x, z };
    }
    // Unreachable in practice; the band is far larger than the keep-out.
    return { x: SPREAD_X, z: maxZ };
  }

  private kinds(): PropKind[] {
    return [
      {
        // Cone + implied trunk. A cone alone reads as a conifer from above,
        // which is the only angle this camera has.
        geometry: new THREE.ConeGeometry(0.75, 2.4, 7),
        material: new THREE.MeshStandardMaterial({ color: 0x3f7a35 }),
        count: 58,
        minScale: 0.8,
        maxScale: 1.6,
        lift: 1.2,
        maxZ: 8.5,
      },
      {
        // Low-poly sphere: faceted enough to catch light differently per face.
        geometry: new THREE.IcosahedronGeometry(0.55, 0),
        material: new THREE.MeshStandardMaterial({ color: 0x8d8475 }),
        count: 40,
        minScale: 0.5,
        maxScale: 1.3,
        lift: 0.4,
        maxZ: SPREAD_Z_NEAR,
      },
      {
        geometry: new THREE.BoxGeometry(0.8, 0.8, 0.8),
        material: new THREE.MeshStandardMaterial({ color: 0xb08b56 }),
        count: 22,
        minScale: 0.7,
        maxScale: 1.1,
        lift: 0.4,
        maxZ: SPREAD_Z_NEAR,
      },
    ];
  }
}
