// Decoder for Bambu Studio / PrusaSlicer per-triangle colour painting ("paint_color" /
// "slic3rpe:mmu_segmentation" attribute on <triangle>). The value is a hex string; read from the
// LAST character to the first, each character gives 4 bits, least significant bit first. The bits
// describe a subdivision tree of the triangle:
//   nibble: low 2 bits = number of split sides (0 = leaf). For a leaf the high 2 bits are the state
//   (filament number); if they are 3, the next nibble + 3 is the state. For a split node the high
//   2 bits are the "special side", followed by the children's codes (last child first).
// We do not rebuild the sub-triangles: a triangle gets the state of its leaves weighted by their
// share of the parent's area (sub-triangle areas follow from the split pattern), which is exact for
// unsplit triangles and a close approximation along painted borders.

function bitsOf(str) {
  const bits = [];
  for (let i = str.length - 1; i >= 0; i--) {
    const d = parseInt(str[i], 16);
    if (Number.isNaN(d)) throw new Error(`bad paint code "${str}"`);
    for (let b = 0; b < 4; b++) bits.push((d >> b) & 1);
  }
  return bits;
}

/**
 * Returns Map<state, areaFraction> for one triangle's paint code. Area shares of children:
 * 1 split side -> 2 children of 1/2; 2 split sides -> 3 children (1/4, 1/4, 1/2 — the order inside
 * the parent does not matter for the totals, but we assign the larger share to the child that the
 * slicers emit for the unsplit corner); 3 split sides -> 4 children of 1/4.
 */
export function decodePaint(str) {
  const bits = bitsOf(str);
  let i = 0;
  const nib = () => {
    let n = 0;
    for (let k = 0; k < 4; k++) n |= (bits[i++] ?? 0) << k;
    return n;
  };
  const out = new Map();
  const add = (state, w) => out.set(state, (out.get(state) ?? 0) + w);
  const walk = (weight) => {
    const code = nib();
    const split = code & 3;
    if (split === 0) {
      let state = code >> 2;
      if (state === 3) state = nib() + 3;
      add(state, weight);
      return;
    }
    const n = split + 1;
    const shares = split === 1 ? [0.5, 0.5] : split === 2 ? [0.25, 0.25, 0.5] : [0.25, 0.25, 0.25, 0.25];
    for (let c = 0; c < n; c++) walk(weight * shares[c]);
  };
  walk(1);
  return out;
}

/** Dominant state (largest area share) of a paint code; null/empty -> null (unpainted). */
export function dominantState(str) {
  if (!str) return null;
  let best = null;
  let bestW = -1;
  for (const [s, w] of [...decodePaint(str)].sort((a, b) => a[0] - b[0])) {
    if (w > bestW + 1e-9) {
      best = s;
      bestW = w;
    }
  }
  return best === 0 ? null : best; // state 0 = "not painted" -> object's own filament
}
