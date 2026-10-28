import { ENEMIES_TO_KILL, POINTS_PER_KILL } from "../config.ts";

export type Stage = "tutorial" | "gameplay" | "end";

/** Run state. Outlives the player: the end card reads points after gameplay. */
export interface GameState {
  points: number;
  kills: number;
  stage: Stage;
  /** Cleared the level, as opposed to dying. The end card words it differently. */
  cleared: boolean;
}

export function createState(): GameState {
  return { points: 0, kills: 0, stage: "tutorial", cleared: false };
}

/** Scores a frame's kills and ends the level on the last one. */
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

/** Player died. Points earned still show on the end card. */
export function endRun(state: GameState): void {
  state.cleared = false;
  state.stage = "end";
}
