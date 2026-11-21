// "Feel" settings (animation speed, sound, vibration), remembered per device, and the haptic
// patterns. Storage and the vibrate function are passed in, so this is testable without a browser.

import type { AnimSpeed } from '../../table/playback';

export interface Feel {
  speed: AnimSpeed;
  sound: boolean;
  vibrate: boolean;
}

export const FEEL_KEY = 'fs.feel';
const SPEEDS: readonly AnimSpeed[] = ['off', 'fast', 'normal'];

/** Normal speed, or no animation when the system asks for reduced motion. */
export function defaultFeel(reducedMotion: boolean): Feel {
  return { speed: reducedMotion ? 'off' : 'normal', sound: true, vibrate: true };
}

interface KeyValue { getItem(k: string): string | null; setItem(k: string, v: string): void }

export function loadFeel(storage: KeyValue | null | undefined, reducedMotion: boolean): Feel {
  const base = defaultFeel(reducedMotion);
  try {
    const raw = storage?.getItem(FEEL_KEY);
    if (!raw) return base;
    const v = JSON.parse(raw) as Partial<Record<keyof Feel, unknown>>;
    return {
      speed: SPEEDS.includes(v.speed as AnimSpeed) ? v.speed as AnimSpeed : base.speed,
      sound: typeof v.sound === 'boolean' ? v.sound : base.sound,
      vibrate: typeof v.vibrate === 'boolean' ? v.vibrate : base.vibrate,
    };
  } catch {
    return base;
  }
}

export function saveFeel(storage: KeyValue | null | undefined, feel: Feel): void {
  try { storage?.setItem(FEEL_KEY, JSON.stringify(feel)); } catch { /* private mode, quota: not remembered */ }
}

/** The browser's storage, or null where reading it throws (blocked cookies, some private modes). */
export function deviceStorage(): KeyValue | null {
  try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; }
}

export function prefersReducedMotion(): boolean {
  try { return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
}

// ── Haptics ─────────────────────────────────────────────────────────────────────────────────────
export type Haptic = 'turn' | 'prompt' | 'confirm' | 'refuse';

export const HAPTIC_PATTERN: Readonly<Record<Haptic, number | number[]>> = {
  turn: [35, 70, 35],
  prompt: [60, 50, 60, 50, 60],
  confirm: 14,
  refuse: [45, 35, 45],
};

/** Phones that can vibrate (Android browsers); iOS Safari has no navigator.vibrate. */
export function canVibrate(): boolean {
  try { return typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function'; } catch { return false; }
}

export function vibrate(kind: Haptic, feel: Feel): void {
  if (!feel.vibrate || !canVibrate()) return;
  try { navigator.vibrate(HAPTIC_PATTERN[kind]); } catch { /* not allowed before a user gesture, or not supported */ }
}
