import { describe, it, expect } from 'vitest';
import { createGame } from '../rules/setup';
import { oreConnectionCost, BELT_W, PIECE_W } from '../connectivity';
import type { GameState, BoardPiece, PieceType } from '../state';

// connectionCost reads only board coords/types, so fixtures can be minimal.
function mk(id: string, type: PieceType, q: number, r: number, rotation = 0): BoardPiece {
  return { id, type, coord: { q, r }, rotation, claims: [], input: null, output: null };
}
function fixture(board: BoardPiece[]): GameState {
  return { ...createGame(1, 2), board };
}
// Mine at (0,0) rot 0 occupies hexes (0,0) and (1,0).

describe('oreConnectionCost', () => {
  it('is zero (no belts, no pieces) when the building is adjacent to a mine', () => {
    const s = fixture([mk('mine', 'mine', 0, 0), mk('pf', 'plateFact', 2, 0)]); // (2,0) borders mine hex (1,0)
    expect(oreConnectionCost(s, 'pf')).toEqual({ belts: 0, newPieces: 0, cost: 0 });
  });

  it('needs one belt when a placed piece sits between building and mine', () => {
    const s = fixture([mk('mine', 'mine', 0, 0), mk('bk', 'blank', 2, 0), mk('pf', 'plateFact', 3, 0)]);
    expect(oreConnectionCost(s, 'pf')).toEqual({ belts: 1, newPieces: 0, cost: BELT_W });
  });

  it('needs a future blank + belt when the gap hex is empty', () => {
    const s = fixture([mk('mine', 'mine', 0, 0), mk('pf', 'plateFact', 3, 0)]); // (2,0) is empty
    expect(oreConnectionCost(s, 'pf')).toEqual({ belts: 1, newPieces: 1, cost: BELT_W + PIECE_W });
  });

  it('an empty gap costs more than a placed one (same geometry)', () => {
    const placed = fixture([mk('mine', 'mine', 0, 0), mk('bk', 'blank', 2, 0), mk('pf', 'plateFact', 3, 0)]);
    const empty  = fixture([mk('mine', 'mine', 0, 0), mk('pf', 'plateFact', 3, 0)]);
    expect(oreConnectionCost(empty, 'pf')!.cost).toBeGreaterThan(oreConnectionCost(placed, 'pf')!.cost);
  });

  it('farther buildings cost more (two empty gaps)', () => {
    const near = fixture([mk('mine', 'mine', 0, 0), mk('pf', 'plateFact', 3, 0)]);      // 1 gap
    const far  = fixture([mk('mine', 'mine', 0, 0), mk('pf', 'plateFact', 4, 0)]);      // 2 gaps
    expect(oreConnectionCost(far, 'pf')!.cost).toBeGreaterThan(oreConnectionCost(near, 'pf')!.cost);
    expect(oreConnectionCost(far, 'pf')).toEqual({ belts: 2, newPieces: 2, cost: 2 * (BELT_W + PIECE_W) });
  });

  it('prefers a cheaper placed route over a longer/empty one', () => {
    // Building at (3,0): a placed blank at (2,0) gives a 1-belt route; without it, an empty gap.
    const withPath = fixture([mk('mine', 'mine', 0, 0), mk('bk', 'blank', 2, 0), mk('pf', 'plateFact', 3, 0)]);
    expect(oreConnectionCost(withPath, 'pf')).toEqual({ belts: 1, newPieces: 0, cost: BELT_W });
  });

  it('is deterministic', () => {
    const s = fixture([mk('mine', 'mine', 0, 0), mk('pf', 'plateFact', 4, 0)]);
    const first = oreConnectionCost(s, 'pf');
    for (let i = 0; i < 5; i++) expect(oreConnectionCost(s, 'pf')).toEqual(first);
  });

  it('returns null when there is no mine', () => {
    const s = fixture([mk('pf', 'plateFact', 0, 0)]);
    expect(oreConnectionCost(s, 'pf')).toBeNull();
  });

  it('returns null for an unknown building id', () => {
    const s = fixture([mk('mine', 'mine', 0, 0)]);
    expect(oreConnectionCost(s, 'nope')).toBeNull();
  });
});
