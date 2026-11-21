// Which game screen to show: the 3D table (default) or the text view. `?view=text` in the address
// picks the text view; the game menu switches and the choice is remembered on this device. When
// the table cannot start (no WebGL, models failed to load) the text view is used for the rest of
// the visit, with the reason shown.

export type GameViewKind = 'table' | 'text';

const KEY = 'fs.view';
let chosen: GameViewKind | null = null;
let failure: string | null = null;
const listeners = new Set<() => void>();

function stored(): GameViewKind | null {
  try {
    const v = window.localStorage.getItem(KEY);
    return v === 'text' || v === 'table' ? v : null;
  } catch {
    return null;
  }
}

function fromAddress(): GameViewKind | null {
  try {
    const v = new URLSearchParams(window.location.search).get('view');
    return v === 'text' || v === 'table' ? v : null;
  } catch {
    return null;
  }
}

export function preferredView(): GameViewKind {
  if (failure !== null) return 'text';
  return chosen ?? fromAddress() ?? stored() ?? 'table';
}

export function setPreferredView(kind: GameViewKind): void {
  chosen = kind;
  if (kind === 'table') failure = null;
  try { window.localStorage.setItem(KEY, kind); } catch { /* private mode: remember for this visit only */ }
  for (const fn of [...listeners]) fn();
}

/** The table could not start: use the text view and say why. */
export function tableFailed(message: string): void {
  failure = message;
  for (const fn of [...listeners]) fn();
}

/** Why the table view is not available on this visit, or null. */
export function tableFailure(): string | null {
  return failure;
}

export function onViewChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
