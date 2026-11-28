// Belt arrows on the table: drawn ends (from = the arrow tip = the belt's head) for placed belts and
// for a planned route, which shows the direction its belts will have once laid.

import { describe, it, expect } from 'vitest';
import type { BoardPiece, PieceType } from '../../engine/state';
import { arrowEnds, beltHeadMap, orientRoute } from '../beltArrows';

function piece(id: string, type: PieceType, q: number, r: number, rotation = 0): BoardPiece {
  const factory = type === 'plateFact';
  return {
    id, type, coord: { q, r }, rotation, claims: [],
    input: factory ? { slots: [null], teleporters: [] } : null,
    output: factory || type === 'mine' ? { slots: [null], teleporters: [] } : null,
  };
}

// Mine 1 at (0,0) (second hex (1,0)), blanks A (2,0), B (3,0); point 0 of a blank faces west, 7 east.
const MINE = piece('mine-1', 'mine', 0, 0), A = piece('A', 'blank', 2, 0), B = piece('B', 'blank', 3, 0);
const F = piece('F', 'plateFact', 4, 0); // its input faces B's point 7

describe('arrowEnds', () => {
  it('draws the arrow at the head; without one, at the second point tapped', () => {
    expect(arrowEnds({ fromPoint: 0, toPoint: 7 }, 7)).toEqual({ from: 7, to: 0 });
    expect(arrowEnds({ fromPoint: 0, toPoint: 7 }, 0)).toEqual({ from: 0, to: 7 });
    expect(arrowEnds({ fromPoint: 0, toPoint: 7 })).toEqual({ from: 7, to: 0 });
  });
});

describe('beltHeadMap', () => {
  it('maps belt ids to heads', () => {
    const belts = [{ id: 'x', pieceId: 'A', ownerId: 0 as const, fromPoint: 7, toPoint: 0 }];
    expect(beltHeadMap({ board: [MINE, A], belts }).get('x')).toBe(7);
  });
});

describe('orientRoute (the planned route preview)', () => {
  it('a route out of a Mine points away from it, whichever end was tapped first', () => {
    const fwd = orientRoute({ board: [MINE, A, B], belts: [] }, [{ pieceId: 'A', from: 0, to: 7, tier: 'own' }, { pieceId: 'B', from: 0, to: 7, tier: 'buy' }]);
    expect(fwd.map(s => [s.from, s.to, s.tier])).toEqual([[7, 0, 'own'], [7, 0, 'buy']]);
    const rev = orientRoute({ board: [MINE, A, B], belts: [] }, [{ pieceId: 'B', from: 7, to: 0, tier: 'own' }, { pieceId: 'A', from: 7, to: 0, tier: 'own' }]);
    expect(rev.map(s => [s.from, s.to])).toEqual([[7, 0], [7, 0]]);
  });

  it('an undecided route points from the first tap to the second', () => {
    const r = orientRoute({ board: [A, B], belts: [] }, [{ pieceId: 'B', from: 7, to: 0, tier: 'own' }, { pieceId: 'A', from: 7, to: 0, tier: 'own' }]);
    // Tapped east to west: arrows at point 0 (west).
    expect(r.map(s => [s.from, s.to])).toEqual([[0, 7], [0, 7]]);
  });

  it('a route extending a belt already laid follows it; one reaching an input points at the input', () => {
    const laid = [{ id: 'old', pieceId: 'A', ownerId: 0 as const, fromPoint: 7, toPoint: 0 }]; // points west
    expect(orientRoute({ board: [A, B], belts: laid }, [{ pieceId: 'B', from: 0, to: 7, tier: 'own' }]).map(s => [s.from, s.to])).toEqual([[0, 7]]);
    expect(orientRoute({ board: [A, B, F], belts: laid }, [{ pieceId: 'B', from: 0, to: 7, tier: 'own' }]).map(s => [s.from, s.to])).toEqual([[7, 0]]);
  });

  it('no game, no route', () => {
    expect(orientRoute(null, [])).toEqual([]);
    expect(orientRoute(null, [{ pieceId: 'A', from: 0, to: 7 }])).toEqual([{ pieceId: 'A', from: 7, to: 0 }]);
  });
});
