import { describe, it, expect } from 'vitest';
import { adjAt, getRole } from '../rules/flow';
import { mineSecondaryCoord, hexNeighbours } from '../rules/pieces';
import type { BoardPiece } from '../state';

// direction index → vertex edge (renderer/engine shared convention).
const HEX_DIR_TO_VE = [0, 3, 1, 4, 5, 2];

// For a mine at the given rotation, return the sorted vertex edges of the lean (second)
// hex that expose ore — discovered the way flow does, by probing adjAt from a neighbour.
function leanOreVertexEdges(rotation: number): number[] {
  const mine: BoardPiece = { id: 'm', type: 'mine', coord: { q: 0, r: 0 }, rotation, claims: [], input: null, output: null };
  const lean = mineSecondaryCoord({ q: 0, r: 0 }, rotation);
  const ves: number[] = [];
  hexNeighbours(lean).forEach((n, dirIdx) => {
    if (n.q === 0 && n.r === 0) return; // the rich hex, not an external ore edge
    const blank: BoardPiece = { id: 'b', type: 'blank', coord: n, rotation: 0, claims: [], input: null, output: null };
    for (let p = 0; p < 12; p++) {
      const a = adjAt(blank.coord, 0, p, [mine, blank]);
      if (a && a.piece.id === 'm' && a.pos >= 12 && getRole(a.piece, a.pos) === 'ore_output') {
        ves.push(HEX_DIR_TO_VE[dirIdx]!);
        break;
      }
    }
  });
  return ves.sort((a, b) => a - b);
}

describe('mine lean-hex ore geometry (bug: only correct at rotation 0)', () => {
  it('exposes exactly 3 ore edges at every-other positions for ALL rotations', () => {
    for (let r = 0; r < 6; r++) {
      const ves = leanOreVertexEdges(r);
      expect(ves, `rotation ${r}`).toHaveLength(3);
      // every-other = the three edges share one parity (alternate around the hex)
      const allEven = ves.every(v => v % 2 === 0);
      const allOdd = ves.every(v => v % 2 === 1);
      expect(allEven || allOdd, `rotation ${r} ore edges ${JSON.stringify(ves)} should alternate`).toBe(true);
    }
  });

  it('keeps the known-correct rotation-0 layout (ore at vertex edges 0,2,4)', () => {
    expect(leanOreVertexEdges(0)).toEqual([0, 2, 4]);
  });
});
