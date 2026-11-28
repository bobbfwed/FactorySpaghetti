// Whether the Teleporters' glowing portals swirl on the 3D table ("Moving Teleporter portals" in
// the game menu), remembered on this device. Moving portals redraw the table a few times a second
// while a Teleporter is on the board, which uses more battery; off, they show a still swirl and an
// idle table draws nothing. Default: on, unless the device asks for reduced motion; once the player
// flips the switch, their choice wins over the device's default.

export const PORTAL_MOTION_KEY = 'fs.portals';

interface KeyValue { getItem(k: string): string | null; setItem(k: string, v: string): void }

/** The default when the player has not chosen: moving, unless the device asks for reduced motion. */
export function defaultPortalMotion(reducedMotion: boolean): boolean {
  return !reducedMotion;
}

/** The player's stored choice, or the device default when there is none (or storage fails). */
export function loadPortalMotion(storage: KeyValue | null | undefined, reducedMotion: boolean): boolean {
  try {
    const v = storage?.getItem(PORTAL_MOTION_KEY);
    if (v === 'on') return true;
    if (v === 'off') return false;
  } catch { /* blocked storage: the default */ }
  return defaultPortalMotion(reducedMotion);
}

export function savePortalMotion(storage: KeyValue | null | undefined, on: boolean): void {
  try { storage?.setItem(PORTAL_MOTION_KEY, on ? 'on' : 'off'); } catch { /* private mode, quota: this visit only */ }
}

// ── This device ──────────────────────────────────────────────────────────────────────────────────

let chosen: boolean | null = null;
const listeners = new Set<() => void>();

function storage(): KeyValue | null {
  try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; }
}

function reduced(): boolean {
  try { return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
}

/** Whether portals swirl on this device now. */
export function movingPortals(): boolean {
  return chosen ?? loadPortalMotion(storage(), reduced());
}

/** The player flipped the switch: remember it and tell every open table at once. */
export function setMovingPortals(on: boolean): void {
  chosen = on;
  savePortalMotion(storage(), on);
  for (const fn of [...listeners]) fn();
}

export function onPortalMotionChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
