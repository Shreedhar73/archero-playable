/**
 * Web Audio primitives: a tone with an optional pitch slide, and a filtered
 * noise burst. Every sound is built from these two, so audio costs no bytes.
 * Change the sounds in `audio.ts`, not these.
 */
export interface Voice {
  ctx: AudioContext;
  out: AudioNode;
}

export interface ToneOptions {
  type?: OscillatorType;
  /** Seconds from now. */
  at?: number;
  duration: number;
  gain?: number;
  /** Exponential slide to this frequency over the duration. */
  slideTo?: number;
  attack?: number;
}

export function tone({ ctx, out }: Voice, frequency: number, o: ToneOptions): void {
  const start = ctx.currentTime + (o.at ?? 0);
  const end = start + o.duration;
  const osc = ctx.createOscillator();
  const amp = ctx.createGain();
  osc.type = o.type ?? "sine";
  osc.frequency.setValueAtTime(frequency, start);
  if (o.slideTo) osc.frequency.exponentialRampToValueAtTime(o.slideTo, end);
  // Ramp from ~0 both ways: a hard edge clicks.
  amp.gain.setValueAtTime(0.0001, start);
  amp.gain.exponentialRampToValueAtTime(o.gain ?? 0.3, start + (o.attack ?? 0.01));
  amp.gain.exponentialRampToValueAtTime(0.0001, end);
  osc.connect(amp).connect(out);
  osc.start(start);
  osc.stop(end + 0.02);
}

export interface NoiseOptions {
  at?: number;
  duration: number;
  gain?: number;
  filter?: BiquadFilterType;
  /** Filter frequency at the start, and optionally swept to `sweepTo`. */
  frequency: number;
  sweepTo?: number;
  q?: number;
}

let noiseBuffer: AudioBuffer | null = null;

export function noise({ ctx, out }: Voice, o: NoiseOptions): void {
  if (!noiseBuffer || noiseBuffer.sampleRate !== ctx.sampleRate) {
    noiseBuffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }
  const start = ctx.currentTime + (o.at ?? 0);
  const end = start + o.duration;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer;
  src.loop = true;
  const filter = ctx.createBiquadFilter();
  filter.type = o.filter ?? "bandpass";
  filter.Q.value = o.q ?? 1;
  filter.frequency.setValueAtTime(o.frequency, start);
  if (o.sweepTo) filter.frequency.exponentialRampToValueAtTime(o.sweepTo, end);
  const amp = ctx.createGain();
  amp.gain.setValueAtTime(0.0001, start);
  amp.gain.exponentialRampToValueAtTime(o.gain ?? 0.3, start + Math.min(0.05, o.duration / 3));
  amp.gain.exponentialRampToValueAtTime(0.0001, end);
  src.connect(filter).connect(amp).connect(out);
  src.start(start);
  src.stop(end + 0.02);
}

/** MIDI note number to Hz. 60 = middle C. */
export const midi = (note: number): number => 440 * 2 ** ((note - 69) / 12);
