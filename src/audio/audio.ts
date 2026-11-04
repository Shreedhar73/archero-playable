/**
 * Sound output. Reads game state once a frame like the other renderers and
 * owns none of it.
 *
 * Autoplay policy may keep the context suspended until a user gesture, so
 * `unlock()` runs at boot and again inside every input event; whichever
 * lands first wins. Nothing is scheduled while suspended, or everything
 * queued would play as one burst on the first tap.
 *
 * Everything is synthesized; the bed and footsteps are transcribed from a
 * recording of the real game.
 */
import type { Enemy } from "../game/enemy.ts";
import type { Player } from "../game/player.ts";
import type { GameState } from "../game/state.ts";
import { createCueWatcher, readCues, type CueWatcher } from "./cues.ts";
import { midi, noise, tone, type Voice } from "./synth.ts";

const MASTER = 0.8;
// Safety against the frame where everything lands at once. The default -24
// engages on every footstep and pumps the bed.
const LIMIT_DB = -10;
// Music RMS sits about 15 dB under the effect peaks in the real game.
const MUSIC = 0.05;
const MUTE_RAMP = 0.05;

export type SfxName = "shot" | "impact" | "death" | "hurt" | "step" | "win" | "lose" | "tap";

/** Ordered names for the audition page. */
export const SFX_NAMES: readonly SfxName[] = ["shot", "impact", "death", "hurt", "step", "win", "lose", "tap"];

/** Minimum seconds between repeats of each sound. Cadence, not a voice cap. */
const GAP: Record<SfxName, number> = {
  shot: 0.05,
  impact: 0.12,
  death: 0.1,
  hurt: 0.15,
  // Under the 0.30 s step cadence, or every other step would be dropped.
  step: 0.2,
  win: 1,
  lose: 1,
  tap: 0.05,
};

/** Footstep pitch range, Hz, from the recording. */
const STEP_HZ: readonly [number, number] = [115, 190];
// A low thud reads much quieter than its amplitude suggests, and phone
// speakers drop most of it. Starts at the shot's gain.
const STEP_GAIN = 0.1;

// Gains 0.08–0.25, a tenth of a second or two. Short body, pitch falling,
// no attack: the sfxr "hit" and "shoot" shapes.
const SFX: Record<SfxName, (v: Voice) => void> = {
  // Heard every 0.8 s, so the quietest thing in the table.
  shot: (v) => {
    tone(v, 520, { duration: 0.09, slideTo: 170, gain: 0.1, type: "triangle" });
    noise(v, { duration: 0.03, filter: "highpass", frequency: 2500, gain: 0.05 });
  },

  // Thud plus a tick of arrowhead, so it reads as a hit and not a footstep.
  impact: (v) => {
    tone(v, 240, { duration: 0.08, slideTo: 80, gain: 0.14, type: "triangle" });
    noise(v, { duration: 0.06, filter: "lowpass", frequency: 800, gain: 0.08 });
    noise(v, { duration: 0.015, filter: "bandpass", frequency: 3500, q: 3, gain: 0.06 });
  },

  // Nine per run, so a short fall with a crunch and nothing cheerful.
  death: (v) => {
    noise(v, { duration: 0.05, filter: "bandpass", frequency: 1200, q: 1.5, gain: 0.08 });
    tone(v, 220, { duration: 0.26, slideTo: 70, gain: 0.18, type: "triangle" });
    noise(v, { duration: 0.18, filter: "lowpass", frequency: 900, sweepTo: 200, gain: 0.1 });
  },

  // 35 ms damped thud, little above 400 Hz.
  step: (v) => {
    const hz = STEP_HZ[0] + Math.random() * (STEP_HZ[1] - STEP_HZ[0]);
    tone(v, hz, { duration: 0.035, attack: 0.012, gain: STEP_GAIN, type: "sine" });
    noise(v, { duration: 0.02, filter: "lowpass", frequency: 400, gain: STEP_GAIN * 0.18 });
  },

  hurt: (v) => {
    tone(v, 330, { duration: 0.12, gain: 0.12, type: "triangle" });
    tone(v, 247, { at: 0.12, duration: 0.18, gain: 0.12, type: "triangle" });
  },

  win: (v) => {
    [67, 72, 76, 79, 84].forEach((n, i) =>
      tone(v, midi(n), { at: i * 0.1, duration: i === 4 ? 0.6 : 0.2, gain: 0.2, type: "triangle" }),
    );
  },

  lose: (v) => {
    [79, 74, 70, 65].forEach((n, i) =>
      tone(v, midi(n), { at: i * 0.12, duration: i === 3 ? 0.5 : 0.2, gain: 0.16, type: "triangle" }),
    );
  },

  tap: (v) => tone(v, 620, { duration: 0.08, slideTo: 980, gain: 0.25 }),
};

// The bed: 100 bpm, eighth-note grid, bass G2 two bars then F2 two. MIDI
// numbers, 0 = rest. Eight bars, 19.2 s a cycle.
const BPM = 100;
const LEAD = [
  67, 0, 67, 71, 67, 0, 67, 0, 67, 0, 67, 0, 67, 67, 72, 0,
  65, 0, 65, 65, 65, 75, 76, 65, 74, 0, 74, 0, 0, 0, 0, 0,
  67, 0, 67, 71, 67, 0, 67, 0, 67, 0, 67, 0, 67, 67, 72, 0,
  65, 72, 65, 72, 72, 72, 65, 71, 67, 0, 67, 0, 0, 0, 0, 0,
];
/** One note per bar, played on the eighths BASS_HITS marks. */
const BASS_BAR = [43, 43, 41, 41, 43, 43, 41, 43];
const BASS_HITS = [1, 0, 1, 1, 0, 1, 1, 0];
// Partials as [harmonic, amplitude], from the recording. The lead is
// odd-harmonic but softer than a square; the bass is bright and plucked.
const LEAD_PARTIALS: readonly [number, number][] = [[1, 1], [3, 0.32], [5, 0.09]];
const BASS_PARTIALS: readonly [number, number][] = [[1, 1], [2, 0.25], [3, 0.3], [4, 0.5]];
const LEAD_GAIN = 0.3;
const BASS_GAIN = 0.5;

/** One note as a stack of sines. */
function voice(
  v: Voice,
  hz: number,
  partials: readonly [number, number][],
  o: { at: number; duration: number; gain: number; attack?: number },
): void {
  for (const [k, a] of partials) {
    tone(v, hz * k, { at: o.at, duration: o.duration, gain: o.gain * a, attack: o.attack, type: "sine" });
  }
}

export class GameAudio {
  private readonly watcher: CueWatcher;
  private readonly last: Record<SfxName, number>;
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfx: Voice | null = null;
  private music: GainNode | null = null;
  private tune: number | null = null;
  private muted = false;

  constructor(enemyCount: number) {
    this.watcher = createCueWatcher(enemyCount);
    this.last = { shot: -1, impact: -1, death: -1, hurt: -1, step: -1, win: -1, lose: -1, tap: -1 };
  }

  /**
   * Call at boot and synchronously inside every input handler. Autoplay
   * policy checks the call stack, so resuming from a later loop tick leaves
   * the context suspended for good.
   */
  unlock(): void {
    // Audio may fail quietly; a working context must survive a later failure.
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
      // Several sounds can land in one frame; their sum clips without this.
      const limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = LIMIT_DB;
      master.connect(limiter).connect(ctx.destination);

      const sfxBus = ctx.createGain();
      sfxBus.connect(master);
      const musicBus = ctx.createGain();
      musicBus.gain.value = MUSIC;
      musicBus.connect(master);

      this.ctx = ctx;
      this.master = master;
      this.music = musicBus;
      this.sfx = { ctx, out: sfxBus };
      this.startTune({ ctx, out: musicBus });
    }

    const ctx = this.ctx;
    if (ctx.state === "running") return;
    void ctx.resume();
    // iOS Safari only starts a context once a source has played inside the
    // gesture, and parks it in "interrupted" after a phone call, so this
    // must be repeatable. One silent sample is enough. The ringer switch is
    // a separate problem and needs an <audio> element.
    const primer = ctx.createBufferSource();
    primer.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
    primer.connect(ctx.destination);
    primer.start();
  }

  /** In memory only: the Google build forbids localStorage. */
  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.ctx === null || this.master === null) return;
    this.master.gain.setTargetAtTime(muted ? 0 : MASTER, this.ctx.currentTime, MUTE_RAMP);
  }

  tap(): void {
    this.play("tap");
  }

  /** Audition page only. */
  preview(name: SfxName): void {
    if (this.muted) return;
    this.play(name);
  }

  /** Audition page only. */
  setMusic(on: boolean): void {
    if (this.ctx === null || this.music === null) return;
    this.music.gain.setTargetAtTime(on ? MUSIC : 0, this.ctx.currentTime, MUTE_RAMP);
  }

  /** Hidden tab, or the network reporting the ad is not viewable. */
  setViewable(viewable: boolean): void {
    if (this.ctx === null) return;
    if (viewable) {
      void this.ctx.resume();
      return;
    }
    void this.ctx.suspend();
  }

  /**
   * Cues are read even without a context so the baseline stays current:
   * unlocking mid-run must not fire every edge since boot.
   */
  sync(player: Player, enemies: Enemy[], state: GameState): void {
    const cues = readCues(this.watcher, player, enemies, state);
    if (this.sfx === null || this.muted) return;

    if (cues.shot) this.play("shot");
    // Two arrows landing in one frame is one sound.
    if (cues.impacts > 0) this.play("impact");
    if (cues.deaths > 0) this.play("death");
    if (cues.hurt) this.play("hurt");
    if (cues.steps > 0) this.play("step");
    if (cues.win) this.play("win");
    if (cues.lose) this.play("lose");
    // `cues.enemyShots` stays silent: six archers fire most frames. The
    // harness still checks the cue.
  }

  private play(name: SfxName): void {
    const voice = this.sfx;
    // A suspended context's clock is frozen; everything scheduled against it
    // fires together when it thaws.
    if (voice === null || voice.ctx.state !== "running") return;
    const now = voice.ctx.currentTime;
    if (now - this.last[name] < GAP[name]) return;
    this.last[name] = now;
    SFX[name](voice);
  }

  /**
   * Scheduled against the audio clock, kept ahead of it, so the clamped
   * frame dt cannot smear notes. Never stopped: mute and suspend act on the
   * master and the context, and a suspended clock stalls the scheduler.
   */
  private startTune(v: Voice): void {
    if (this.tune !== null) return;
    const step = 60 / BPM / 2;
    let index = 0;
    let next = v.ctx.currentTime + 0.1;

    const schedule = (): void => {
      while (next < v.ctx.currentTime + 0.25) {
        const at = next - v.ctx.currentTime;
        const l = LEAD[index % LEAD.length]!;
        const bar = Math.floor(index / 8) % BASS_BAR.length;
        // A lead note holds until the next one; rests are the gap between.
        if (l) {
          let len = 1;
          while (LEAD[(index + len) % LEAD.length] === 0 && len < 4) len++;
          voice(v, midi(l), LEAD_PARTIALS, { at, duration: step * len + 0.1, gain: LEAD_GAIN, attack: 0.02 });
        }
        if (BASS_HITS[index % 8]) {
          voice(v, midi(BASS_BAR[bar]!), BASS_PARTIALS, { at, duration: step * 0.9, gain: BASS_GAIN });
        }
        index++;
        next += step;
      }
    };
    this.tune = window.setInterval(schedule, 60);
    schedule();
  }
}
