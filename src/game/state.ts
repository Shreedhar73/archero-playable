import { ENEMIES_TO_KILL, POINTS_PER_KILL } from "../config.ts";

/** Which part of the ad is running — the brief's three stages, in order. */
export type Stage = "tutorial" | "gameplay" | "end";

/**
 * Run state. Separate from the player because it outlives them: the end card
 * reads points after the gameplay stage is over.
 */
export interface GameState {
  points: number;
  kills: number;
  stage: Stage;
  /** True when the level was cleared, false when the player ran out of
   *  health. Read by the end card, which says different things. */
  cleared: boolean;
}

export function createState(): GameState {
  return { points: 0, kills: 0, stage: "tutorial", cleared: false };
}

/**
 * Scores a frame's kills and ends the level on the last one.
 *
 * Kept here so projectiles.ts never learns what a point is worth, or that
 * killing enough of them finishes the ad — it only reports how many died.
 */
export function addKills(state: GameState, kills: number): void {
  if (kills <= 0) return;
  state.kills += kills;
  state.points += kills * POINTS_PER_KILL;
  if (state.kills < ENEMIES_TO_KILL) return;
  state.cleared = true;
  state.stage = "end";
}

/** 0 to 1, for the level bar across the top. */
export function progress(state: GameState): number {
  return Math.min(state.kills / ENEMIES_TO_KILL, 1);
}

/** The run ends the moment health does. Points earned still count — an ad
 *  that punishes losing by showing nothing wastes the install it was after. */
export function endRun(state: GameState): void {
  state.cleared = false;
  state.stage = "end";
}
