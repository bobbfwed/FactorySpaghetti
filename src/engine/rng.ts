// Mulberry32 — fast 32-bit seeded PRNG.
// All functions are pure: they return a new RNG state rather than mutating.
// A game is fully described by (seed, action[]); this makes it reproducible.

export type RngState = number; // uint32

export function createRng(seed: number): RngState {
  return seed >>> 0;
}

// Returns [output, nextState]. The output is a uniformly distributed uint32.
export function nextUint32(state: RngState): [value: number, next: RngState] {
  const next = (state + 0x6d2b79f5) >>> 0;
  let t = next;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return [(t ^ (t >>> 14)) >>> 0, next];
}

// Returns a random integer in [0, n). n must be > 0.
export function nextIntBelow(state: RngState, n: number): [value: number, next: RngState] {
  const [uint, next] = nextUint32(state);
  return [uint % n, next];
}

// Fisher-Yates in-place shuffle. Returns a new array and updated RNG state. Pure.
export function shuffle<T>(arr: readonly T[], state: RngState): [result: T[], next: RngState] {
  const result = [...arr];
  let s = state;
  for (let i = result.length - 1; i > 0; i--) {
    const [j, nextS] = nextIntBelow(s, i + 1);
    s = nextS;
    const tmp = result[i] as T; // loop bounds guarantee i and j are valid
    result[i] = result[j] as T;
    result[j] = tmp;
  }
  return [result, s];
}
