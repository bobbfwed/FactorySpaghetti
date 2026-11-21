// Pointy-top axial hex ↔ pixel conversion and geometry helpers.

export interface Point { x: number; y: number; }

const SQRT3 = Math.sqrt(3);

/** Convert axial (q, r) to canvas pixel given hex size and canvas center offset. */
export function hexToPixel(q: number, r: number, size: number, ox: number, oy: number): Point {
  return {
    x: ox + size * (SQRT3 * q + SQRT3 / 2 * r),
    y: oy + size * (1.5 * r),
  };
}

/** Convert canvas pixel to nearest axial hex coordinate. */
export function pixelToHex(px: number, py: number, size: number, ox: number, oy: number): { q: number; r: number } {
  const x = (px - ox) / size;
  const y = (py - oy) / size;
  const q = (SQRT3 / 3 * x) - (1 / 3 * y);
  const r = (2 / 3 * y);
  return hexRound(q, r);
}

function hexRound(q: number, r: number): { q: number; r: number } {
  const s = -q - r;
  let rq = Math.round(q), rr = Math.round(r), rs = Math.round(s);
  const dq = Math.abs(rq - q), dr = Math.abs(rr - r), ds = Math.abs(rs - s);
  if (dq > dr && dq > ds) rq = -rr - rs;
  else if (dr > ds) rr = -rq - rs;
  return { q: rq, r: rr };
}

/** Six corner points of a pointy-top hex centered at (cx, cy). */
export function hexCorners(cx: number, cy: number, size: number): Point[] {
  return Array.from({ length: 6 }, (_, i) => {
    const angle = (Math.PI / 3) * i - Math.PI / 6; // -30° offset for pointy-top
    return { x: cx + size * Math.cos(angle), y: cy + size * Math.sin(angle) };
  });
}

/** Width of a pointy-top hex with the given size. */
export function hexWidth(size: number): number { return SQRT3 * size; }

/** Height of a pointy-top hex with the given size. */
export function hexHeight(size: number): number { return 2 * size; }
