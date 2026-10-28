import { CELL_SIZE, ROOM_DEPTH, ROOM_WIDTH } from "../config.ts";
import type { Obstacle } from "./obstacles.ts";

/**
 * A breadth-first flow field over the room.
 *
 * One solve serves every enemy: BFS from the player's cell labels each cell
 * with its distance, and each cell then stores a unit vector pointing at its
 * cheapest neighbour. An enemy reads the vector under its feet, so N enemies
 * cost one solve rather than N path searches.
 *
 * Everything is allocated once. The queue, the distances and the field are
 * reused on every solve, because this runs whenever the player changes cell.
 */
export interface Grid {
  readonly cols: number;
  readonly rows: number;
  /** 1 where a body of the planning radius cannot stand. */
  readonly blocked: Uint8Array;
  /** BFS distance in cells; -1 means unreached. */
  readonly dist: Int32Array;
  readonly flowX: Float32Array;
  readonly flowZ: Float32Array;
  /** Reused BFS frontier, so a solve allocates nothing. */
  readonly queue: Int32Array;
  /** Cell the current field was solved for; -1 before the first solve. */
  solvedFor: number;
}

/** 8-neighbour offsets, orthogonals first so diagonals can check them. */
const NEIGHBOURS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

export function createGrid(obstacles: Obstacle[], radius: number): Grid {
  const cols = Math.ceil(ROOM_WIDTH / CELL_SIZE);
  const rows = Math.ceil(ROOM_DEPTH / CELL_SIZE);
  const count = cols * rows;

  const grid: Grid = {
    cols,
    rows,
    blocked: new Uint8Array(count),
    dist: new Int32Array(count),
    flowX: new Float32Array(count),
    flowZ: new Float32Array(count),
    queue: new Int32Array(count),
    solvedFor: -1,
  };

  // A cell is blocked if a body of this radius standing at its centre would
  // overlap a crate. Planning with the body's size baked in is what stops
  // enemies routing through gaps they cannot physically fit through.
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const x = cellCentreX(col);
      const z = cellCentreZ(row);
      for (const box of obstacles) {
        const dx = Math.abs(x - box.x) - box.halfX;
        const dz = Math.abs(z - box.z) - box.halfZ;
        const outside = Math.hypot(Math.max(dx, 0), Math.max(dz, 0));
        const inside = Math.max(dx, dz) < 0;
        if (inside || outside < radius) {
          grid.blocked[row * cols + col] = 1;
          break;
        }
      }
    }
  }

  return grid;
}

function cellCentreX(col: number): number {
  return -ROOM_WIDTH / 2 + (col + 0.5) * CELL_SIZE;
}

function cellCentreZ(row: number): number {
  return -ROOM_DEPTH / 2 + (row + 0.5) * CELL_SIZE;
}

/** Nearest cell index to a world position, clamped into the grid. */
export function cellAt(grid: Grid, x: number, z: number): number {
  const col = clampInt(Math.floor((x + ROOM_WIDTH / 2) / CELL_SIZE), grid.cols);
  const row = clampInt(Math.floor((z + ROOM_DEPTH / 2) / CELL_SIZE), grid.rows);
  return row * grid.cols + col;
}

function clampInt(value: number, size: number): number {
  if (value < 0) return 0;
  if (value >= size) return size - 1;
  return value;
}

/**
 * Floods out from `target` and rebuilds the field. Returns false and leaves
 * the previous field intact when the target sits in a blocked cell, which
 * happens while the player is being pushed out of a crate.
 */
export function solveFlow(grid: Grid, targetX: number, targetZ: number): boolean {
  const start = cellAt(grid, targetX, targetZ);
  if (grid.blocked[start] === 1) return false;
  if (grid.solvedFor === start) return true;

  grid.dist.fill(-1);
  grid.dist[start] = 0;
  grid.queue[0] = start;
  let head = 0;
  let tail = 1;

  while (head < tail) {
    const current = grid.queue[head++];
    const col = current % grid.cols;
    const row = (current - col) / grid.cols;
    const next = grid.dist[current] + 1;

    for (let n = 0; n < NEIGHBOURS.length; n++) {
      const [dc, dr] = NEIGHBOURS[n];
      const nc = col + dc;
      const nr = row + dr;
      if (nc < 0 || nc >= grid.cols || nr < 0 || nr >= grid.rows) continue;

      const index = nr * grid.cols + nc;
      if (grid.blocked[index] === 1 || grid.dist[index] !== -1) continue;

      // A diagonal step must not cut a corner: both orthogonals have to be
      // open, or enemies clip through the exact corner of a crate.
      if (dc !== 0 && dr !== 0) {
        if (grid.blocked[row * grid.cols + nc] === 1) continue;
        if (grid.blocked[nr * grid.cols + col] === 1) continue;
      }

      grid.dist[index] = next;
      grid.queue[tail++] = index;
    }
  }

  buildField(grid);
  grid.solvedFor = start;
  return true;
}

/** Each reached cell points at whichever neighbour is closest to the target. */
function buildField(grid: Grid): void {
  for (let row = 0; row < grid.rows; row++) {
    for (let col = 0; col < grid.cols; col++) {
      const index = row * grid.cols + col;
      grid.flowX[index] = 0;
      grid.flowZ[index] = 0;
      if (grid.dist[index] <= 0) continue;

      let bestDist = grid.dist[index];
      let bestCol = col;
      let bestRow = row;

      for (let n = 0; n < NEIGHBOURS.length; n++) {
        const [dc, dr] = NEIGHBOURS[n];
        const nc = col + dc;
        const nr = row + dr;
        if (nc < 0 || nc >= grid.cols || nr < 0 || nr >= grid.rows) continue;

        const candidate = grid.dist[nr * grid.cols + nc];
        if (candidate === -1 || candidate >= bestDist) continue;
        if (dc !== 0 && dr !== 0) {
          if (grid.blocked[row * grid.cols + nc] === 1) continue;
          if (grid.blocked[nr * grid.cols + col] === 1) continue;
        }
        bestDist = candidate;
        bestCol = nc;
        bestRow = nr;
      }

      const dx = bestCol - col;
      const dz = bestRow - row;
      const length = Math.hypot(dx, dz);
      if (length > 0) {
        grid.flowX[index] = dx / length;
        grid.flowZ[index] = dz / length;
      }
    }
  }
}

/** Reused so reading the field allocates nothing per enemy per frame. */
const direction = { x: 0, z: 0, known: false };

/**
 * The field's direction under a world position. `known` is false where the
 * flood never arrived — a cell sealed off from the player, or the player's
 * own cell — and the caller decides what to do about it.
 */
export function flowAt(
  grid: Grid,
  x: number,
  z: number,
): { x: number; z: number; known: boolean } {
  const index = cellAt(grid, x, z);
  direction.x = grid.flowX[index];
  direction.z = grid.flowZ[index];
  direction.known = grid.dist[index] > 0;
  return direction;
}
