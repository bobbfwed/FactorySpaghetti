// Belt endpoint order is a deliberate contract (actions.ts PlaceBeltAction): applyPlaceBelt accepts
// both orders and stores the belt as given (the arrowhead is drawn at fromPoint), legalActions
// lists each belt once with the lower point first, and the two orders have the same effect on
// every rule. sameMove / canonicalAction treat them as one move.

import { describe, it, expect } from 'vitest';
import { createGame } from '../rules/setup';
import { applyAction, legalActions } from '../reducer';
import { canonicalAction, sameMove } from '../index';
import type { Action, PlaceBeltAction } from '../actions';
import type { BoardPiece, GameState, PieceType, PlayerId } from '../state';
import { resolveDirectAdjacency } from '../rules/flow';
import { longestBeltChain } from '../rules/beltWeaver';
import { findRoute } from '../routing';
import { sameUpToBeltOrder } from './beltOrderHelpers';

function piece(id: string, type: PieceType, q: number, r: number, claims: BoardPiece['claims'] = []): BoardPiece {
  const inputs = type === 'plateFact' ? 1 : 0;
  return {
    id, type, coord: { q, r }, rotation: 0, claims,
    input: inputs ? { slots: [null], teleporterOwner: null } : null,
    output: type === 'plateFact' || type === 'mine' ? { slots: [null], teleporterOwner: null } : null,
  };
}

// Mine 1 layout at (0,0) (lean hex (1,0)); blanks A (2,0) and B (3,0); player 0's Plate Factory
// at (4,0) whose input faces B. A 0–7 then B 0–7 carries ore from the mine into the factory.
function base(): GameState {
  const g = createGame(1, 2);
  return {
    ...g, phase: 'actions', turnOrder: [0, 1], activePlayerIndex: 0,
    board: [piece('mine', 'mine', 0, 0), piece('A', 'blank', 2, 0), piece('B', 'blank', 3, 0),
      piece('F', 'plateFact', 4, 0, [{ ownerId: 0, controlModule: 4 }])],
    players: g.players.map(p => ({ ...p, beltsRemaining: 10 })),
  };
}

const belt = (pieceId: string, fromPoint: number, toPoint: number): PlaceBeltAction => ({ type: 'PLACE_BELT', pieceId, fromPoint, toPoint });
function play(s: GameState, ...acts: Action[]): GameState {
  for (const a of acts) {
    const r = applyAction(s, a);
    if (!r.ok) throw new Error(`${JSON.stringify(a)}: ${r.error.code}`);
    s = r.state;
  }
  return s;
}

describe('belt endpoint order', () => {
  it('canonicalAction and sameMove: the two orders of a belt are one move; nothing else changes', () => {
    expect(canonicalAction(belt('A', 7, 0))).toEqual(belt('A', 0, 7));
    expect(canonicalAction(belt('A', 0, 7))).toEqual(belt('A', 0, 7));
    expect(sameMove(belt('A', 7, 0), belt('A', 0, 7))).toBe(true);
    expect(sameMove(belt('A', 7, 0), belt('A', 0, 6))).toBe(false);
    expect(sameMove(belt('A', 7, 0), belt('B', 0, 7))).toBe(false);
    const draw: Action = { type: 'DRAW_PIECE', stackIndex: 1 };
    expect(canonicalAction(draw)).toBe(draw);
    // Field order does not matter, nor an optional field present as undefined (as after JSON round trips).
    expect(sameMove({ type: 'PLACE_MINE', rotation: 2, coord: { q: 1, r: 2 } }, { type: 'PLACE_MINE', coord: { q: 1, r: 2 }, rotation: 2 })).toBe(true);
    expect(sameMove({ type: 'PLACE_MINE', coord: { q: 1, r: 2 } }, { type: 'PLACE_MINE', coord: { q: 1, r: 2 }, rotation: undefined } as unknown as Action)).toBe(true);
    expect(sameMove({ type: 'PLACE_MINE', coord: { q: 1, r: 2 } }, { type: 'PLACE_MINE', coord: { q: 1, r: 2 }, rotation: 1 })).toBe(false);
  });

  it('the reversed belt is accepted, stored as given, and listed only in its lower-first form', () => {
    const s = base();
    const listed = legalActions(s, 0).filter((a): a is PlaceBeltAction => a.type === 'PLACE_BELT');
    expect(listed.length).toBeGreaterThan(0);
    expect(listed.every(a => a.fromPoint < a.toPoint)).toBe(true);
    expect(listed.some(a => sameMove(a, belt('A', 7, 0)))).toBe(true);
    const after = play(s, belt('A', 7, 0));
    const stored = after.belts.at(-1)!;
    expect([stored.fromPoint, stored.toPoint]).toEqual([7, 0]); // kept as given (arrowhead end first)
  });

  it('both orders have the same effect on flow, Belt Weaver, routing, removal and undo', () => {
    const fwd = play(base(), belt('A', 0, 7), belt('B', 0, 7));
    const rev = play(base(), belt('A', 7, 0), belt('B', 7, 0));
    expect(sameUpToBeltOrder(fwd, rev)).toBe(true);
    // The stored order and the belt id differ, and nothing else.
    expect(rev.belts.map(b => [b.fromPoint, b.toPoint])).toEqual([[7, 0], [7, 0]]);
    expect(rev.belts.map(b => b.id)).not.toEqual(fwd.belts.map(b => b.id));

    // Material flow: ore reaches the factory either way.
    const fFlow = resolveDirectAdjacency(fwd), rFlow = resolveDirectAdjacency(rev);
    expect(fFlow.board.find(p => p.id === 'F')!.input!.slots[0]).toBe('ore');
    expect(sameUpToBeltOrder(fFlow, rFlow)).toBe(true);
    // Ending the actions resolves flow the same way too.
    expect(sameUpToBeltOrder(play(fwd, { type: 'END_ACTIONS' }), play(rev, { type: 'END_ACTIONS' }))).toBe(true);

    // Belt Weaver chain length.
    for (const p of [0, 1] as PlayerId[]) expect(longestBeltChain(rev, p)).toBe(longestBeltChain(fwd, p));

    // Routing sees the same occupied points: every route from a mine ore exit to F (whose input
    // the belts already use) or to a second factory G (behind blank C, west of the mine) is the
    // same in both states.
    const withG = (s: GameState): GameState => ({
      ...s, board: [...s.board, piece('C', 'blank', -1, 0), { ...piece('G', 'plateFact', -2, 0, [{ ownerId: 0, controlModule: 5 }]), rotation: 3 }],
    });
    const sources = [...Array.from({ length: 24 }, (_, i) => ({ pieceId: 'mine', position: i })), { pieceId: 'F', position: 7 }];
    const routes = (s: GameState): Array<ReturnType<typeof findRoute>> => sources.flatMap(src => ['F', 'G'].map(dest => findRoute(withG(s), src, { pieceId: dest, position: 0 }, 0, 6)));
    expect(routes(fwd).some(r => r !== null && r.cost > 0)).toBe(true);
    expect(routes(rev)).toEqual(routes(fwd));

    // Removal by id and undo of the turn's belts.
    const removeFirst = (s: GameState): GameState => play(s, { type: 'REMOVE_BELT', beltId: s.belts[0]!.id });
    expect(sameUpToBeltOrder(removeFirst(fwd), removeFirst(rev))).toBe(true);
    expect(sameUpToBeltOrder(play(fwd, { type: 'UNDO_BELTS' }), play(rev, { type: 'UNDO_BELTS' }))).toBe(true);
    expect(play(rev, { type: 'UNDO_BELTS' }).belts).toEqual([]);
  });
});
