/**
 * Sound output: a renderer for the ear.
 *
 * Same contract as `src/three/` and `src/ui/` — it reads game state once a
 * frame and makes noise about what changed. It owns no game state, so a
 * rotation never touches it and nothing here can alter the simulation.
 *
 * Nothing exists until `unlock()`. Browsers start an `AudioContext` suspended
 * and only let a user gesture resume it, so the context and its bus are built
 * inside the first tap — which this ad already has, because the tutorial
 * ends on it.
 *
 * **The third sound source this file has had**, and the history is the reason
 * for its shape. A first pass synthesized everything and was rejected. A
 * second decoded seven CC0 MP3s, which cost 220 KB of the bundle and was
 * rejected twice — once for being loud, once for still being wrong after the
 * levels were measured against two creatives of ours we had called subtle.
 * What those two have in common is not a level: it is that their audio is
 * synthesized, by `synth.ts`, which is now this one's too. Zero bytes, and a
 * timbre somebody has already judged.
 *
 * `cues.ts`, the unlock, the mute button and every harness assertion have
 * survived all three. That is what the seam is for.
 *
 * **There is no background music.** Three beds were built and two were
 * heard: the AR creative's chiptune came over with its primitives and was
 * replaced unheard as the wrong mood; a three-note sine pad was "too
 * distracting"; a slower drone of open fifths was "still too distracting,
 * and unlikeable". The effects passed both listens. A bed is the one sound
 * that plays for the whole ad, so it is the one sound that cannot be nearly
 * right — and nothing synthesized here has been. The reference tune is on
 * `scripts/audition.html` to be heard in this context if a bed is ever
 * wanted again; the game ships effects only.
 */
import type { Enemy } from "../game/enemy.ts";
import type { Player } from "../game/player.ts";
import type { GameState } from "../game/state.ts";
import { createCueWatcher, readCues, type CueWatcher } from "./cues.ts";
import { midi, noise, tone, type Voice } from "./synth.ts";

/** Everything, under the limiter. The AR creative's value. */
const MASTER = 0.8;
/** Seconds for a mute to take effect. Long enough not to click, short enough
 *  to feel like a button. */
const MUTE_RAMP = 0.05;

export type SfxName = "shot" | "impact" | "death" | "hurt" | "win" | "lose" | "tap";

/** Every name, for the audition page — a `Record` has no order of its own. */
export const SFX_NAMES: readonly SfxName[] = ["shot", "impact", "death", "hurt", "win", "lose", "tap"];

/**
 * How soon each sound may fire again, in seconds of context time.
 *
 * Not a voice cap — every note owns its own oscillator and stops itself, so
 * there is nothing to pool. This is about cadence, which is where "too much"
 * actually came from: nine bodies converging means several of everything in
 * one frame, and a frame reported in full is chatter rather than combat.
 */
const GAP: Record<SfxName, number> = {
  shot: 0.05,
  impact: 0.12,
  death: 0.1,
  hurt: 0.15,
  win: 1,
  lose: 1,
  tap: 0.05,
};

/**
 * The sounds themselves, in the AR creative's routine envelope — gain 0.08 to
 * 0.25, a tenth of a second or two. Nothing here earns more: that creative
 * keeps its one loud sound (0.6) for the moment the sticker comes alive, and
 * this ad's equivalent is the end card, not its ninth kill.
 *
 * The shapes follow what sfxr's generator does for its own "hit/hurt" and
 * "shoot" families, which is the recipe a generation of small games got
 * these sounds from: no attack, a short body, and the pitch always falling.
 * The first version's bow *rose* (1250 to 2000 Hz), which is a ping or a
 * laser, and nothing a string does.
 */
const SFX: Record<SfxName, (v: Voice) => void> = {
  // Heard every 0.8 s for the whole ad, so it is the quietest thing in the
  // table. A string let go: a triangle dropping fast through its first
  // octave, under a snap of high noise for the string itself.
  shot: (v) => {
    tone(v, 520, { duration: 0.09, slideTo: 170, gain: 0.1, type: "triangle" });
    noise(v, { duration: 0.03, filter: "highpass", frequency: 2500, gain: 0.05 });
  },

  // An arrow landing on a body: a thud, and a tick of arrowhead on top of it
  // so it reads as a hit rather than a footstep.
  impact: (v) => {
    tone(v, 240, { duration: 0.08, slideTo: 80, gain: 0.14, type: "triangle" });
    noise(v, { duration: 0.06, filter: "lowpass", frequency: 800, gain: 0.08 });
    noise(v, { duration: 0.015, filter: "bandpass", frequency: 3500, q: 3, gain: 0.06 });
  },

  // Nine of these per run. A cheerful arpeggio nine times over is the
  // opposite of subtle, so a kill is a short fall with a little crunch at
  // the front and nothing more.
  death: (v) => {
    noise(v, { duration: 0.05, filter: "bandpass", frequency: 1200, q: 1.5, gain: 0.08 });
    tone(v, 220, { duration: 0.26, slideTo: 70, gain: 0.18, type: "triangle" });
    noise(v, { duration: 0.18, filter: "lowpass", frequency: 900, sweepTo: 200, gain: 0.1 });
  },

  // AR's "decoy": two falling triangles. It is already the sound of a wrong
  // thing happening, which is what taking a hit is.
  hurt: (v) => {
    tone(v, 330, { duration: 0.12, gain: 0.12, type: "triangle" });
    tone(v, 247, { at: 0.12, duration: 0.18, gain: 0.12, type: "triangle" });
  },

  // AR's "end", unchanged: a rising five-note major run.
  win: (v) => {
    [67, 72, 76, 79, 84].forEach((n, i) =>
      tone(v, midi(n), { at: i * 0.1, duration: i === 4 ? 0.6 : 0.2, gain: 0.2, type: "triangle" }),
    );
  },

  // The same run downwards. No separate recording to find, and a falling
  // phrase says "the run ended" without saying "you were punished".
  lose: (v) => {
    [79, 74, 70, 65].forEach((n, i) =>
      tone(v, midi(n), { at: i * 0.12, duration: i === 3 ? 0.5 : 0.2, gain: 0.16, type: "triangle" }),
    );
  },

  // AR's "tap", unchanged.
  tap: (v) => tone(v, 620, { duration: 0.08, slideTo: 980, gain: 0.25 }),
};

export class GameAudio {
  private readonly watcher: CueWatcher;
  private readonly last: Record<SfxName, number>;
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfx: Voice | null = null;
  private muted = false;

  constructor(enemyCount: number) {
    this.watcher = createCueWatcher(enemyCount);
    this.last = { shot: -1, impact: -1, death: -1, hurt: -1, win: -1, lose: -1, tap: -1 };
  }

  /**
   * Called from inside the first input event, synchronously — autoplay policy
   * wants the gesture's own call stack, so doing this from the loop tick that
   * reads the "touched" flag is one frame too late and leaves the context
   * suspended forever. Safe to call again; later calls only resume.
   */
  unlock(): void {
    // Audio is the one system allowed to fail quietly. An ad that throws
    // because a context could not be created is worse than a silent one —
    // but a context that already works must survive a later failure, so only
    // a build that never got one gives up.
    try {
      this.build();
    } catch {
      if (this.master === null) this.ctx = null;
    }
  }

  private build(): void {
    if (this.ctx === null) {
      // Older iOS Safari only has the prefixed constructor.
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new Ctor();
      const master = ctx.createGain();
      master.gain.value = this.muted ? 0 : MASTER;
      // A limiter, not an effect: a bow, a hit and a death can land in the
      // same frame, and the sum of them clips without it.
      master.connect(ctx.createDynamicsCompressor()).connect(ctx.destination);

      // One bus. A second, for music, existed through three beds and is gone
      // with them — see the file comment.
      const sfxBus = ctx.createGain();
      sfxBus.connect(master);

      this.ctx = ctx;
      this.master = master;
      this.sfx = { ctx, out: sfxBus };
    }

    const ctx = this.ctx;
    if (ctx.state === "running") return;
    void ctx.resume();
    // iOS Safari: a context only starts once a source has played inside the
    // gesture, and parks itself in "interrupted" after a phone call, so this
    // has to be repeatable rather than a one-off at boot. One silent sample
    // is enough, and harmless everywhere else. Gated on the state because
    // `noteInput` fires on every `pointerdown` — which the joystick produces
    // a great many of — and a running context needs none of this.
    //
    // Not the ringer-switch problem: that one needs an <audio> element to
    // have played, and is still open.
    const primer = ctx.createBufferSource();
    primer.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
    primer.connect(ctx.destination);
    primer.start();
  }

  /** In memory only: the Google build forbids localStorage, and a muted ad
   *  is a per-impression choice anyway. */
  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.ctx === null || this.master === null) return;
    this.master.gain.setTargetAtTime(muted ? 0 : MASTER, this.ctx.currentTime, MUTE_RAMP);
  }

  /** The button's own click, so unmuting proves itself. */
  tap(): void {
    this.play("tap");
  }

  /** For `scripts/audition.html` only: a sound by name, through the same
   *  cadence gate the game uses. Not called from the game. */
  preview(name: SfxName): void {
    if (this.muted) return;
    this.play(name);
  }

  /** Hidden tab, or a network reporting the ad is no longer viewable. */
  setViewable(viewable: boolean): void {
    if (this.ctx === null) return;
    if (viewable) {
      void this.ctx.resume();
      return;
    }
    void this.ctx.suspend();
  }

  /**
   * One frame. Cues are read whether or not there is a context, so the
   * baseline stays current: unlocking mid-run must not fire every edge the
   * run has accumulated since boot.
   */
  sync(player: Player, enemies: Enemy[], state: GameState): void {
    const cues = readCues(this.watcher, player, enemies, state);
    if (this.sfx === null || this.muted) return;

    if (cues.shot) this.play("shot");
    // Counts, not loops: two arrows landing in one frame is one sound. The
    // numbers are there for the harness, which asserts deaths against kills.
    if (cues.impacts > 0) this.play("impact");
    if (cues.deaths > 0) this.play("death");
    if (cues.hurt) this.play("hurt");
    if (cues.win) this.play("win");
    if (cues.lose) this.play("lose");
    // `cues.enemyShots` is deliberately silent. Six archers on six cooldowns
    // fire most frames, and reporting that was the chatter under the player's
    // own bow — the cue stays, because the harness checks it.
  }

  private play(name: SfxName): void {
    const voice = this.sfx;
    if (voice === null) return;
    const now = voice.ctx.currentTime;
    if (now - this.last[name] < GAP[name]) return;
    this.last[name] = now;
    SFX[name](voice);
  }
}
