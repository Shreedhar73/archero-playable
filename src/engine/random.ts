/**
 * Seeded pseudo-random numbers. Math.random cannot be reproduced, which makes
 * a headless simulation useless as a test: the same frames give different
 * positions every run. Everything that wants randomness should take one of
 * these, so a test can seed it with a constant.
 *
 * mulberry32: 32-bit state, one multiply-xorshift round. Not cryptographic —
 * it is for scattering rocks and picking spawn points.
 */
export function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return function random(): number {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Uniform in [min, max). */
export function range(random: () => number, min: number, max: number): number {
  return min + random() * (max - min);
}
