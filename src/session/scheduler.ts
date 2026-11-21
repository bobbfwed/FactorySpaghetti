// The host's clock and timers, injected so tests can control time.

export interface Scheduler {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export const realScheduler: Scheduler = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (h) => globalThis.clearTimeout(h as ReturnType<typeof globalThis.setTimeout>),
};

/** A uint32 from the platform's cryptographic random source. */
export function cryptoUint32(): number {
  const a = new Uint32Array(1);
  globalThis.crypto.getRandomValues(a);
  return a[0]!;
}

/** A random id for a move or a visitor (16 hex characters). */
export function randomId(): string {
  const a = new Uint8Array(8);
  globalThis.crypto.getRandomValues(a);
  return Array.from(a, b => b.toString(16).padStart(2, '0')).join('');
}
