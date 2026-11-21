// Where HTML panels anchored to table pieces go (building menu, prompts, confirm bar, flash
// markers). Pure: the screen reads every size and anchor point first, calls placeAll once, then
// writes every position, so a frame never alternates layout reads and writes.

export interface Pt { readonly x: number; readonly y: number }
export interface Rect { left: number; top: number; right: number; bottom: number }
export type Side = 'left' | 'right' | 'above' | 'below';
/** 'center': a marker centred on its piece; 'below': the confirm bar; 'side': a panel beside its piece. */
export type PlaceKind = 'center' | 'below' | 'side';

export interface AnchorItem {
  kind: PlaceKind;
  /** Screen point of the piece, or null when it is not drawn (table loading, off screen). */
  p: Pt | null;
  w: number;
  h: number;
  /** Glowing targets other than this anchor (only used for the confirm bar). */
  lit?: readonly Pt[];
  hasPointer?: boolean;
}

export interface Placement {
  visible: boolean;
  x: number;
  y: number;
  side: Side;
  /** The little pointer triangle: where it sits on the panel, or hidden. */
  ptr: { left: number; top: number; hidden: boolean } | null;
}

export interface PlaceEnv {
  free: Rect;
  W: number;
  H: number;
  /** A board tile's size on screen (px). */
  tile: number;
  phone: boolean;
}

function clampX(env: PlaceEnv, x: number, w: number): number {
  return Math.max(Math.max(8, env.free.left), Math.min(x, Math.min(env.W - 8, env.free.right) - w));
}

function clampY(env: PlaceEnv, y: number, h: number): number {
  const lo = env.free.top, hi = env.free.bottom - h;
  if (hi >= lo) return Math.max(lo, Math.min(y, hi));
  return Math.max(8, Math.min(y, env.H - 8 - h));
}

/**
 * The confirm bar beside a piece about to be placed: of four candidate spots, the one that covers
 * the fewest other glowing targets, never the piece itself, and moved least by clamping.
 */
export function placeConfirm(env: PlaceEnv, p: Pt, w: number, h: number, lit: readonly Pt[]): { x: number; y: number; side: Side } {
  // The ghost's tile reaches about half a tile from its centre each way (more across).
  const rx = env.tile * 0.6, ry = env.tile * 0.5;
  const cands: [number, number, Side][] = [
    [p.x - w / 2, p.y + ry + 10, 'below'], [p.x + rx + 10, p.y - h / 2, 'right'],
    [p.x - rx - 10 - w, p.y - h / 2, 'left'], [p.x - w / 2, p.y - ry - 10 - h, 'above'],
  ];
  let best = Infinity;
  let out: { x: number; y: number; side: Side } = { x: 0, y: 0, side: 'below' };
  for (const [cx0, cy0, sd] of cands) {
    const cx = clampX(env, cx0, w), cy = clampY(env, cy0, h);
    const covered = lit.filter(q => q.x > cx - 8 && q.x < cx + w + 8 && q.y > cy - 8 && q.y < cy + h + 8).length;
    const coversGhost = cx < p.x + rx && cx + w > p.x - rx && cy < p.y + ry && cy + h > p.y - ry ? 100 : 0;
    const score = covered * 10 + coversGhost + Math.hypot(cx - cx0, cy - cy0) / 20;
    if (score < best) { best = score; out = { x: cx, y: cy, side: sd }; }
  }
  return out;
}

/** Place every anchored item (panels first so they avoid each other, markers last). Same order as given. */
export function placeAll(items: readonly AnchorItem[], env: PlaceEnv): Placement[] {
  const out: Placement[] = items.map(() => ({ visible: false, x: 0, y: 0, side: 'below', ptr: null }));
  const order = items.map((_, i) => i).sort((a, b) => Number(items[a]!.kind === 'center') - Number(items[b]!.kind === 'center'));
  const placed: Rect[] = [];
  const { free } = env;
  for (const i of order) {
    const it = items[i]!;
    const { w, h } = it;
    if (!it.p && it.kind === 'center') continue;
    // A panel whose piece cannot be located (table still loading) stays usable in the middle.
    const p = it.p ?? { x: (free.left + free.right) / 2, y: free.top + 40 };
    if (it.kind === 'center') {
      const inside = p.x > free.left && p.x < free.right && p.y > free.top && p.y < free.bottom;
      out[i] = { visible: inside, x: p.x - w / 2, y: p.y - h / 2, side: 'below', ptr: null };
      continue;
    }
    let x: number, y: number;
    let side: Side = 'below';
    if (it.kind === 'below') {
      ({ x, y, side } = placeConfirm(env, p, w, h, it.lit ?? []));
    } else if (!env.phone) {
      const gap = env.tile * 0.45 + 16;
      if (p.x + gap + w <= free.right) { x = p.x + gap; side = 'right'; }
      else if (p.x - gap - w >= free.left) { x = p.x - gap - w; side = 'left'; }
      else { x = clampX(env, p.x - w / 2, w); side = p.y - free.top > free.bottom - p.y ? 'above' : 'below'; }
      y = side === 'above' ? p.y - gap - h : side === 'below' ? p.y + gap : p.y - Math.min(40, h / 2);
      y = clampY(env, y, h);
    } else {
      const gap = env.tile * 0.45 + 14;
      x = clampX(env, p.x - w / 2, w);
      if (p.y + gap + h <= free.bottom) { y = p.y + gap; side = 'below'; }
      else { y = p.y - gap - h; side = 'above'; }
      y = clampY(env, y, h);
    }
    // Keep panels from covering each other: push down (or up when there is no room below).
    for (let guard = 0; guard < 6; guard++) {
      const hit = placed.find(r => x < r.right && x + w > r.left && y < r.bottom && y + h > r.top);
      if (!hit) break;
      y = hit.bottom + 8 + h <= Math.max(free.bottom, env.H - 8) ? hit.bottom + 8 : hit.top - 8 - h;
    }
    placed.push({ left: x, top: y, right: x + w, bottom: y + h });
    let ptr: Placement['ptr'] = null;
    if (it.hasPointer) {
      const across = side === 'left' || side === 'right';
      // Hide the pointer when the panel had to be pushed away from its piece.
      const far = across ? (p.y < y || p.y > y + h) : (p.x < x || p.x > x + w);
      ptr = across
        ? { top: Math.round(Math.max(12, Math.min(h - 30, p.y - y - 9))), left: side === 'right' ? -8 : w - 10, hidden: far }
        : { left: Math.round(Math.max(12, Math.min(w - 30, p.x - x - 9))), top: side === 'below' ? -8 : h - 10, hidden: far };
    }
    out[i] = { visible: true, x, y, side, ptr };
  }
  return out;
}
