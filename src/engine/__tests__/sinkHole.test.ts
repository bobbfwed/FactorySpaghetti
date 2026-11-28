// Sink Hole sends the belts on the removed piece to the bank (RULES_CHANGES.md #56): no owner gets
// them back, not even for a belt laid this turn (Sink Hole is not a take-back), Undo belts cannot
// bring them back, and the one-Mine-belt mark is worked out again as after picking a belt up (#52).

import { describe, expect, it } from 'vitest';
import { createGame } from '../rules/setup';
import { applyAction } from '../reducer';
import type { Belt, BoardPiece, GameState, PlayerId } from '../state';
import { expectOk } from './helpers';

// Mine 1 at (0,0), its lean hex at (1,0). Blank A at (2,0): its point 0 faces a lean-hex ore exit,
// so a belt 0-7 on A is a Mine belt. Blank B at (2,-1) is away from the Mine's exits.
const MINE: BoardPiece = { id: 'mine-1', type: 'mine', coord: { q: 0, r: 0 }, rotation: 0, claims: [], input: null, output: { slots: [null], teleporters: [] } };
const blank = (id: string, q: number, r: number): BoardPiece => ({ id, type: 'blank', coord: { q, r }, rotation: 0, claims: [], input: null, output: null });
const A = blank('A', 2, 0);
const B = blank('B', 3, -1);

function actions(belts: Belt[] = []): GameState {
  const g = createGame(1, 2);
  return {
    ...g, board: [MINE, A, B], belts, turnOrder: [0, 1], activePlayerIndex: 0, phase: 'actions', pendingFactoryOps: [],
    cardsPlayedThisTurn: 0,
    players: g.players.map(p => ({ ...p, beltsRemaining: 3, hand: p.id === 0 ? ['sinkHole' as const] : [] })),
  };
}
const sink = (s: GameState, pieceId: string): GameState => expectOk(applyAction(s, { type: 'PLAY_CARD', cardType: 'sinkHole', pieceId }));
const belt = (owner: PlayerId, pieceId: string, a: number, b: number): Belt => ({ id: `belt-p${owner}-${pieceId}-${a}-${b}`, ownerId: owner, pieceId, fromPoint: a, toPoint: b });

describe('Sink Hole: the belts on the removed piece go to the bank (#56)', () => {
  it('belts of any player laid on earlier turns: nobody gets them back', () => {
    const s = actions([belt(0, 'B', 0, 6), belt(1, 'B', 2, 8)]);
    const after = sink(s, 'B');
    expect(after.board.some(p => p.id === 'B')).toBe(false);
    expect(after.belts).toEqual([]);
    expect(after.players[0]!.beltsRemaining).toBe(3);
    expect(after.players[1]!.beltsRemaining).toBe(3);
  });

  it('a belt laid this turn goes to the bank too, and Undo belts cannot bring it back', () => {
    let s = actions();
    s = expectOk(applyAction(s, { type: 'PLACE_BELT', pieceId: 'B', fromPoint: 0, toPoint: 6 }));
    s = expectOk(applyAction(s, { type: 'PLACE_BELT', pieceId: 'A', fromPoint: 3, toPoint: 9 }));
    expect(s.players[0]!.beltsRemaining).toBe(1);
    const after = sink(s, 'B');
    expect(after.players[0]!.beltsRemaining).toBe(1);
    expect(after.beltsPlacedThisTurn).toEqual([belt(0, 'A', 3, 9).id]);
    // Undo returns only the belt still lying (the one on A).
    const undone = expectOk(applyAction(after, { type: 'UNDO_BELTS' }));
    expect(undone.players[0]!.beltsRemaining).toBe(2);
    expect(undone.belts).toEqual([]);
  });

  it('the Mine belt laid this turn sunk with its piece frees the one-Mine-belt limit, as picking it up does (#52)', () => {
    let s = actions();
    s = expectOk(applyAction(s, { type: 'PLACE_BELT', pieceId: 'A', fromPoint: 0, toPoint: 7 }));
    expect(s.mineBeltPlacedThisTurn).toBe(true);
    const after = sink(s, 'A');
    expect(after.mineBeltPlacedThisTurn).toBe(false);
    expect(after.players[0]!.beltsRemaining).toBe(2); // the belt is gone to the bank
  });

  it('sinking a piece with no belt of this turn leaves the Mine-belt mark as it was', () => {
    let s = actions([belt(1, 'B', 0, 6)]);
    s = expectOk(applyAction(s, { type: 'PLACE_BELT', pieceId: 'A', fromPoint: 0, toPoint: 7 }));
    const after = sink(s, 'B');
    expect(after.mineBeltPlacedThisTurn).toBe(true);
    expect(after.beltsPlacedThisTurn).toEqual([belt(0, 'A', 0, 7).id]);
  });
});
