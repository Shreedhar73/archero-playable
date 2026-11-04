/**
 * What happened this frame, for the ear. A pure diff of game state against
 * last frame's copy, not an event bus, so `tests/sim.ts` can import it
 * without an AudioContext. The edges are the same ones the renderers use.
 */
import { STEP_LENGTH } from "../config.ts";
import type { Enemy } from "../game/enemy.ts";
import type { Player } from "../game/player.ts";
import type { GameState } from "../game/state.ts";

export interface Cues {
  /** The player released an arrow. */
  shot: boolean;
  /** Arrows enemy archers released this frame. */
  enemyShots: number;
  /** Arrows that landed on an enemy this frame. */
  impacts: number;
  /** Enemies that started dying this frame. */
  deaths: number;
  /** The player lost health. */
  hurt: boolean;
  /** Footsteps this frame. */
  steps: number;
  win: boolean;
  lose: boolean;
}

/**
 * Last frame's values, one slot per enemy, allocated once. Float64: a
 * stalled timer rounds on the way into a Float32Array, and if it rounds
 * down then `current > stored` is true forever.
 */
export interface CueWatcher {
  readonly dying: Float64Array;
  readonly hitFlash: Float64Array;
  readonly cooldown: Float64Array;
  /** 1 where the slot held a living body last frame. */
  readonly alive: Uint8Array;
  shooting: number;
  hp: number;
  /** Player position last frame, and distance walked since the last step. */
  x: number;
  z: number;
  travelled: number;
  ended: boolean;
  /** False until the first read has recorded a baseline. */
  primed: boolean;
}

export function createCueWatcher(count: number): CueWatcher {
  return {
    dying: new Float64Array(count),
    hitFlash: new Float64Array(count),
    cooldown: new Float64Array(count),
    alive: new Uint8Array(count),
    shooting: 0,
    hp: 0,
    x: 0,
    z: 0,
    travelled: 0,
    ended: false,
    primed: false,
  };
}

/** Reused: read it before calling again. */
const cues: Cues = {
  shot: false,
  enemyShots: 0,
  impacts: 0,
  deaths: 0,
  hurt: false,
  steps: 0,
  win: false,
  lose: false,
};

export function readCues(
  watcher: CueWatcher,
  player: Player,
  enemies: Enemy[],
  state: GameState,
): Cues {
  const ended = state.stage === "end";

  cues.shot = watcher.primed && player.shooting > watcher.shooting;
  cues.hurt = watcher.primed && player.hp < watcher.hp;
  cues.win = watcher.primed && ended && !watcher.ended && state.cleared;
  cues.lose = watcher.primed && ended && !watcher.ended && !state.cleared;
  cues.enemyShots = 0;
  cues.impacts = 0;
  cues.deaths = 0;
  cues.steps = 0;

  // Distance, not velocity: a body held against a wall makes no sound.
  // Gameplay only, or the spawn position reads as a walk.
  if (watcher.primed && state.stage === "gameplay") {
    watcher.travelled += Math.hypot(player.x - watcher.x, player.z - watcher.z);
    while (watcher.travelled >= STEP_LENGTH) {
      watcher.travelled -= STEP_LENGTH;
      cues.steps++;
    }
  }
  watcher.x = player.x;
  watcher.z = player.z;

  watcher.shooting = player.shooting;
  watcher.hp = player.hp;
  watcher.ended = ended;

  for (let i = 0; i < enemies.length; i++) {
    const enemy = enemies[i];

    // The spawner zeroes every field of a reused slot. Against a corpse's
    // leftovers that reads as a rise, so a fresh spawn is skipped.
    const spawned = enemy.alive && watcher.alive[i] === 0;

    if (watcher.primed && !spawned) {
      if (enemy.dying > 0 && watcher.dying[i] === 0) cues.deaths++;
      if (enemy.hitFlash > watcher.hitFlash[i]) cues.impacts++;
      // A cooldown climbs when a shot went off, or when `updateEnemyAttacks`
      // refills it out of range; that branch also drops `attacking`. Melee
      // needs no cue: a landed swing already fires `hurt`.
      if (
        enemy.kind === "archer" &&
        enemy.attacking &&
        enemy.attackCooldown > watcher.cooldown[i]
      ) {
        cues.enemyShots++;
      }
    }

    watcher.dying[i] = enemy.dying;
    watcher.hitFlash[i] = enemy.hitFlash;
    watcher.cooldown[i] = enemy.attackCooldown;
    watcher.alive[i] = enemy.alive ? 1 : 0;
  }

  watcher.primed = true;
  return cues;
}
