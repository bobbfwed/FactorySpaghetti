// The draw step (RULES_CHANGES.md #33): with more than one open stack, a player first draws from
// one (DRAW_PIECE) and must then place that stack's top piece. Also the two public helpers the
// interface reads: revealedStack and upcomingTurnOrder.

import { describe, it, expect } from 'vitest';
import { applyAction, legalActions, revealedStack, upcomingTurnOrder } from '../index';
import type { Action } from '../actions';
import type { GameState, PieceStack, UnplacedPiece } from '../state';
import { activePlayer, completeSetup, expectOk } from './helpers';
import { chooseAction as randomBot } from '../../bots/randomBot';

const types = (acts: Action[]): string[] => [...new Set(acts.map(a => a.type))];
const legal = (s: GameState): Action[] => legalActions(s, activePlayer(s));
const code = (s: GameState, a: Action): string | null => { const r = applyAction(s, a); return r.ok ? null : r.error.code; };

// Start of a place-a-piece step with stack 0 open, and stack 1 open too when `twoOpen`.
function atPlacePiece(twoOpen: boolean, stack1: UnplacedPiece[] | null = null): GameState {
  const s = completeSetup(3, 3);
  expect(s.phase).toBe('placePiece');
  const s1: PieceStack = {
    ...s.stacks[1],
    available: twoOpen,
    pieces: stack1 ?? s.stacks[1].pieces,
  };
  return { ...s, stacks: [s.stacks[0], s1, s.stacks[2]] };
}

const anyPlacement = (s: GameState, stackIndex: 0 | 1 | 2): Action => {
  const p = legal(s).find(a => a.type === 'PLACE_PIECE');
  if (!p || p.type !== 'PLACE_PIECE') throw new Error('no placement');
  return { ...p, stackIndex };
};

describe('the draw step', () => {
  it('one open stack: place its top piece at once, no draw', () => {
    const s = atPlacePiece(false);
    expect(s.drawnStackIndex).toBeNull();
    const acts = legal(s);
    expect(types(acts)).toEqual(['PLACE_PIECE']);
    expect(acts.every(a => a.type === 'PLACE_PIECE' && a.stackIndex === 0)).toBe(true);
    expect(code(s, { type: 'DRAW_PIECE', stackIndex: 0 })).toBe('NO_DRAW_NEEDED');
    expect(revealedStack(s)).toBe(0);
    const after = expectOk(applyAction(s, acts[0]!));
    expect(after.phase).toBe('roll');
    expect(after.board.at(-1)!.id).toBe(s.stacks[0].pieces[0]!.id);
  });

  it('several open stacks: only drawing is legal, then only placing from the drawn stack', () => {
    const s = atPlacePiece(true);
    expect(legal(s)).toEqual([{ type: 'DRAW_PIECE', stackIndex: 0 }, { type: 'DRAW_PIECE', stackIndex: 1 }]);
    expect(revealedStack(s)).toBeNull();
    expect(code(s, anyPlacement(atPlacePiece(false), 0))).toBe('MUST_DRAW');
    expect(code(s, { type: 'DRAW_PIECE', stackIndex: 2 })).toBe('STACK_LOCKED');

    const drawn = expectOk(applyAction(s, { type: 'DRAW_PIECE', stackIndex: 1 }));
    expect(drawn.drawnStackIndex).toBe(1);
    expect(drawn.phase).toBe('placePiece');
    expect(drawn.stacks).toEqual(s.stacks); // drawing moves nothing until the piece is placed
    expect(revealedStack(drawn)).toBe(1);
    const acts = legal(drawn);
    expect(types(acts)).toEqual(['PLACE_PIECE']);
    expect(acts.every(a => a.type === 'PLACE_PIECE' && a.stackIndex === 1)).toBe(true);
    // The draw cannot be changed.
    expect(code(drawn, { type: 'DRAW_PIECE', stackIndex: 0 })).toBe('ALREADY_DRAWN');
    expect(code(drawn, anyPlacement(drawn, 0))).toBe('NOT_DRAWN_STACK');

    const placed = expectOk(applyAction(drawn, acts[0]!));
    expect(placed.drawnStackIndex).toBeNull();
    expect(placed.phase).toBe('roll');
    expect(placed.board.at(-1)!.id).toBe(s.stacks[1].pieces[0]!.id);
    expect(placed.stacks[1].pieces).toHaveLength(s.stacks[1].pieces.length - 1);
    expect(revealedStack(placed)).toBeNull(); // not the placePiece phase any more
  });

  it('a Mine waiting to be placed comes first: no draw, nothing revealed', () => {
    const s: GameState = { ...atPlacePiece(true), pendingMineIds: ['mine-2'], unplacedMines: [{ id: 'mine-3', type: 'mine' }] };
    expect(types(legal(s))).toEqual(['PLACE_MINE']);
    expect(code(s, { type: 'DRAW_PIECE', stackIndex: 0 })).toBe('PENDING_MINE');
    expect(revealedStack(s)).toBeNull();
    const placed = expectOk(applyAction(s, legal(s)[0]!));
    expect(placed.phase).toBe('roll');
    expect(placed.drawnStackIndex ?? null).toBeNull();
  });

  it('an emptied stack is not offered; drawing the last piece of a stack still drops the next Mine', () => {
    // Stack 1 open but empty: only stack 0 is open, so no draw.
    const empty = atPlacePiece(true, []);
    expect(types(legal(empty))).toEqual(['PLACE_PIECE']);
    expect(code(empty, { type: 'DRAW_PIECE', stackIndex: 1 })).toBe('STACK_EMPTY');
    expect(revealedStack(empty)).toBe(0);

    // Stack 1 holds its last piece and Mine 3 is still off the board.
    const base = atPlacePiece(true, [{ id: 'last', type: 'blank' }]);
    const s: GameState = { ...base, unplacedMines: [{ id: 'mine-3', type: 'mine' }] };
    const drawn = expectOk(applyAction(s, { type: 'DRAW_PIECE', stackIndex: 1 }));
    const placed = expectOk(applyAction(drawn, legal(drawn)[0]!));
    expect(placed.board.at(-1)!.id).toBe('last');
    expect(placed.stacks[1].pieces).toHaveLength(0);
    expect(placed.pendingMineIds).toEqual(['mine-3']);
    expect(placed.stacks[2].available).toBe(true);
    expect(placed.drawnStackIndex).toBeNull();
  });

  it('a state from an older save (no drawnStackIndex) reads as "not drawn yet"', () => {
    const strip = (g: GameState): GameState => {
      const old: { -readonly [K in keyof GameState]?: GameState[K] } = { ...g };
      delete old.drawnStackIndex;
      return old as GameState;
    };
    const one = strip(atPlacePiece(false));
    expect('drawnStackIndex' in one).toBe(false);
    expect(types(legal(one))).toEqual(['PLACE_PIECE']);
    expect(revealedStack(one)).toBe(0);
    expect(expectOk(applyAction(one, legal(one)[0]!)).phase).toBe('roll');

    const two = strip(atPlacePiece(true));
    expect(types(legal(two))).toEqual(['DRAW_PIECE']);
    expect(revealedStack(two)).toBeNull();
    expect(code(two, anyPlacement(atPlacePiece(false), 0))).toBe('MUST_DRAW');
    expect(expectOk(applyAction(two, { type: 'DRAW_PIECE', stackIndex: 0 })).drawnStackIndex).toBe(0);
  });

  it('revealedStack is null outside the placePiece phase', () => {
    const s = atPlacePiece(false);
    for (const phase of ['setupClaimPF', 'setupClaimPP', 'roll', 'actions', 'placeMeeple', 'roundEnd'] as const) {
      expect(revealedStack({ ...s, phase })).toBeNull();
    }
  });
});

describe('upcomingTurnOrder', () => {
  it('outside round end it is the turn order with the first player moved to the end', () => {
    const s = { ...atPlacePiece(false), turnOrder: [2, 0, 1] as const };
    expect(upcomingTurnOrder(s)).toEqual([0, 1, 2]);
    expect(upcomingTurnOrder({ ...s, phase: 'actions' })).toEqual([0, 1, 2]);
    expect(upcomingTurnOrder({ ...s, phase: 'roundEnd' })).toEqual([2, 0, 1]);
  });

  it('matches the order the engine actually uses for the round-end turns and the next round', () => {
    let s = completeSetup(11, 4);
    let predicted = upcomingTurnOrder(s);
    let checked = 0;
    for (let guard = 0; guard < 5000 && checked < 3 && !s.gameOver; guard++) {
      const who = s.pendingFactoryOps[0]?.ownerId ?? activePlayer(s);
      const before = s;
      s = expectOk(applyAction(s, randomBot(s, who)));
      if (before.phase !== 'roundEnd' && s.phase === 'roundEnd') {
        expect(s.turnOrder).toEqual(predicted);   // the round-end turns
        expect(upcomingTurnOrder(s)).toEqual(predicted);
      }
      if (before.phase === 'roundEnd' && s.phase === 'placePiece') {
        expect(s.turnOrder).toEqual(predicted);   // and the next round
        checked++;
        predicted = upcomingTurnOrder(s);
      }
      if (s.phase !== 'roundEnd') expect(upcomingTurnOrder(s)).toEqual(predicted);
    }
    expect(checked).toBe(3);
  });
});
