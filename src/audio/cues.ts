/**
 * What happened this frame, as far as the ear is concerned.
 *
 * Deliberately not an event bus. Every sound the game needs is already a
 * timer or a counter in game state, so this is a pure diff: keep last frame's
 * numbers, compare, report what rose. The game stays unaware that anything is
 * listening — the same contract `src/three/` and `src/ui/` work under — and
 * because there is no `AudioContext` in this file, `tests/sim.ts` can import
 * it and assert the cues in plain Node.
 *
 * The edges are the ones the renderers already use. `ArcherView` starts the
 * draw animation on a rise in `player.shooting`; this starts the bow sound on
 * the same rise, which is why the two can never disagree about when a shot
 * happened.
 */
import type { Enemy } from "../game/enemy.ts";
import type { Player } from "../game/player.ts";
import type { GameState } from "../game/state.ts";

export interface Cues {
  /** The player released an arrow. */
  shot: boolean;
  /** Arrows enemy archers released this frame. A count, like the others, so
   *  the harness can hold it against the pool rather than against itself. */
  enemyShots: number;
  /** Arrows that landed on an enemy this frame. */
  impacts: number;
  /** Enemies that started dying this frame. */
  deaths: number;
  /** The player lost health, to an arrow or a fist. */
  hurt: boolean;
  win: boolean;
  lose: boolean;
}

/**
 * Last frame's values. One slot per enemy, allocated once: this is read every
 * frame, and a per-frame array would be the one allocation in the loop.
 *
 * Float64, not Float32, and that is not a detail: a timer that has stopped
 * moving still rounds on the way into a Float32Array, and if it rounds *down*
 * then `current > stored` is true forever. The harness caught it as 37,000
 * arrow impacts in a fight with nine enemies in it.
 */
export interface CueWatcher {
  readonly dying: Float64Array;
  readonly hitFlash: Float64Array;
  readonly cooldown: Float64Array;
  /** 1 where the slot held a living body last frame. A pool slot is reused,
   *  and a fresh body carries none of the previous one's history. */
  readonly alive: Uint8Array;
  shooting: number;
  hp: number;
  ended: boolean;
  /** False until the first read has recorded a baseline. Without it every
   *  starting value reads as a change and the ad opens on a burst of noise. */
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
    ended: false,
    primed: false,
  };
}

/** Reused, like `flowAt`'s direction: read it before calling again. */
const cues: Cues = {
  shot: false,
  enemyShots: 0,
  impacts: 0,
  deaths: 0,
  hurt: false,
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

  watcher.shooting = player.shooting;
  watcher.hp = player.hp;
  watcher.ended = ended;

  for (let i = 0; i < enemies.length; i++) {
    const enemy = enemies[i];

    // A slot that was empty last frame has just been spawned into, and the
    // spawner zeroes every field. Against a corpse's leftovers that reads as
    // a rise — `hitFlash` freezes a hair below zero when its owner dies, so
    // the reset to 0 is an increase and the ad plays an arrow impact at the
    // moment an enemy walks in. Measured as 19 impacts for 18 arrows.
    const spawned = enemy.alive && watcher.alive[i] === 0;

    if (watcher.primed && !spawned) {
      if (enemy.dying > 0 && watcher.dying[i] === 0) cues.deaths++;
      if (enemy.hitFlash > watcher.hitFlash[i]) cues.impacts++;
      // A cooldown only climbs when the attack it was counting down to has
      // just gone off — except out of range, where `updateEnemyAttacks`
      // refills it so stepping away and back grants no free hit. That branch
      // drops `attacking` in the same breath, which is what tells the two
      // apart. Melee needs no cue of its own: a landed swing is a hit on the
      // player, and `hurt` already fires for that.
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
