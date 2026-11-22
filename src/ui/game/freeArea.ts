// The part of the screen the board is framed into: the area between the fixed bars, minus every
// opaque panel that floats over it (the roll outcome while it is open, the turn queue, the bank,
// a planned route's panel, notices). Each panel is cut away from the side that keeps the most
// room, so no lit target ends up under a panel once the board is re-framed.

import type { Rect } from './anchors';

const area = (r: Rect): number => Math.max(0, r.right - r.left) * Math.max(0, r.bottom - r.top);

/** `free` with each of `panels` (that overlaps it) cut away, keeping a gap of `gap` px. */
export function carve(free: Rect, panels: readonly Rect[], gap = 8): Rect {
  let f = { ...free };
  // Larger panels first: they decide the shape, smaller ones then only trim it.
  const sorted = [...panels].sort((a, b) => area(b) - area(a));
  for (const p of sorted) {
    const overlaps = p.right > f.left && p.left < f.right && p.bottom > f.top && p.top < f.bottom;
    if (!overlaps || area(p) === 0) continue;
    const options: Rect[] = [
      { ...f, top: Math.max(f.top, p.bottom + gap) },
      { ...f, bottom: Math.min(f.bottom, p.top - gap) },
      { ...f, left: Math.max(f.left, p.right + gap) },
      { ...f, right: Math.min(f.right, p.left - gap) },
    ];
    let best = f, bestArea = -1;
    for (const o of options) {
      const a = o.right > o.left && o.bottom > o.top ? area(o) : -1;
      if (a > bestArea) { best = o; bestArea = a; }
    }
    // A panel too big to leave any room is ignored (the camera keeps a usable minimum anyway).
    if (bestArea > 0) f = best;
  }
  return f;
}
