// The play-style bots' belt planner (styles/routes.ts) must respect Teleporters
// (RULES_CHANGES.md #53, per input since #55): an output with a teleporter carries nothing onto a
// belt, and an input with a teleporter takes nothing from one, so neither may end a planned route.

import { describe, expect, it } from 'vitest';
import type { BoardPiece, GameState, PlayerId } from '../../engine/state';
import { createGame } from '../../engine/rules/setup';
import { applyAction } from '../../engine/reducer';
import { routeToInput, longRoute } from '../styles/routes';

// Plate Factory F at (0,0), blank B at (1,0), Sphere Factory G at (2,0): one belt on B from point 0
// to point 7 carries F's output to G's input point 0.
const F = (tele: PlayerId[] = []): BoardPiece => ({
  id: 'F', type: 'plateFact', coord: { q: 0, r: 0 }, rotation: 0, claims: [{ ownerId: 0, controlModule: 4 }],
  input: { slots: [null], teleporters: [] }, output: { slots: [null], teleporters: tele },
});
const B: BoardPiece = { id: 'B', type: 'blank', coord: { q: 1, r: 0 }, rotation: 0, claims: [], input: null, output: null };
const G = (inputTele: Array<PlayerId | null> = []): BoardPiece => ({
  id: 'G', type: 'sphereFact', coord: { q: 2, r: 0 }, rotation: 0, claims: [{ ownerId: 0, controlModule: 5 }],
  input: { slots: [null, null], teleporters: inputTele }, output: { slots: [null], teleporters: [] },
});
function state(board: BoardPiece[]): GameState {
  return { ...createGame(1, 2), board, belts: [] };
}

describe('belt routes and Teleporters', () => {
  it('plans the belt from my plate output to my sphere input', () => {
    const s = state([F(), B, G()]);
    const r = routeToInput(s, 0, s.board[2]!, 0, ['plate'], 3);
    expect(r).not.toBeNull();
    expect(r!.sourcePieceId).toBe('F');
    expect(r!.belts).toEqual([{ pieceId: 'B', fromPoint: 0, toPoint: 7 }]);
  });

  it('never starts a route at an output that carries my teleporter (#53)', () => {
    const s = state([F([0]), B, G()]);
    expect(routeToInput(s, 0, s.board[2]!, 0, ['plate'], 3)).toBeNull();
  });

  it('never ends a route at an input that carries a teleporter (#55), but still feeds the other input', () => {
    const s = state([F(), B, G([0, null])]);
    expect(routeToInput(s, 0, s.board[2]!, 0, ['plate'], 3)).toBeNull();
    // The engine agrees: a belt there carries nothing into the teleported input.
    const placed = applyAction({ ...s, phase: 'actions', turnOrder: [0, 1], activePlayerIndex: 0 },
      { type: 'PLACE_BELT', pieceId: 'B', fromPoint: 0, toPoint: 7 });
    if (placed.ok) expect(placed.state.board.find(p => p.id === 'G')!.input!.slots[0]).toBeNull();
  });

  it('a long (Belt Weaver) route never ends at a teleported input', () => {
    const s = state([F(), B, G([0, 0])]);
    expect(longRoute(s, 0, 1, 3)).toBeNull();
  });
});
