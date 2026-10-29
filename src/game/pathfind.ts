import { CELL_SIZE, ROOM_DEPTH, ROOM_WIDTH } from "../config.ts";
import type { Obstacle } from "./obstacles.ts";

/**
 * BFS flow field from the player's cell. One solve serves every enemy: each
 * cell stores a unit vector towards its cheapest neighbour. All buffers are
 * allocated once and reused.
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
  /** Reused BFS frontier. */
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

  // Blocked if a body of this radius at the cell centre would overlap a crate,
  // so routes never go through gaps the body cannot fit.
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
 * Rebuilds the field from `target`. Returns false and keeps the old field
 * when the target is in a blocked cell (the player mid push-out).
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

      // No corner cutting: both orthogonals must be open.
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

/** Reused return value. */
const direction = { x: 0, z: 0, known: false };

/**
 * Field direction under a world position. Blocked cells are normal (they are
 * padded by the body radius), so from one the step is towards the best open
 * neighbour. `known` is false only when sealed off or in the player's own cell.
 */
export function flowAt(
  grid: Grid,
  x: number,
  z: number,
): { x: number; z: number; known: boolean } {
  const index = cellAt(grid, x, z);
  if (grid.dist[index] > 0) {
    direction.x = grid.flowX[index];
    direction.z = grid.flowZ[index];
    direction.known = true;
    return direction;
  }

  // Blocked or unreached: head for the open neighbour nearest the player.
  // No corner check here; this is an escape and the push-out handles geometry.
  const col = index % grid.cols;
  const row = (index - col) / grid.cols;
  let bestDist = Number.MAX_SAFE_INTEGER;
  let bestCol = col;
  let bestRow = row;

  for (let n = 0; n < NEIGHBOURS.length; n++) {
    const [dc, dr] = NEIGHBOURS[n];
    const nc = col + dc;
    const nr = row + dr;
    if (nc < 0 || nc >= grid.cols || nr < 0 || nr >= grid.rows) continue;

    const candidate = grid.dist[nr * grid.cols + nc];
    if (candidate < 0 || candidate >= bestDist) continue;
    bestDist = candidate;
    bestCol = nc;
    bestRow = nr;
  }

  const dx = bestCol - col;
  const dz = bestRow - row;
  const length = Math.hypot(dx, dz);
  direction.x = length > 0 ? dx / length : 0;
  direction.z = length > 0 ? dz / length : 0;
  direction.known = length > 0;
  return direction;
}
