// When a new state shown on the table starts the view afresh (the camera re-frames and the piles
// are laid out again) and when it is the same game going on. Sink Hole takes a piece off the
// board, so within one game a smaller board is normal: the player's pan and zoom and the piles stay.

import { describe, it, expect } from 'vitest';
import { applyAction } from '../../engine/reducer';
import { createGame } from '../../engine/rules/setup';
import { makeBuffers } from '../../engine/rules/pieces';
import type { GameState } from '../../engine/state';
import { freshView, shownGame } from '../framing';

/** Player 0 in their actions step with a Sink Hole in hand and a blank piece of their own to sink. */
function sinkHoleMove(): { before: GameState; after: GameState } {
  const g = createGame(7, 2);
  const b = makeBuffers('blank');
  const blank = { id: 'b', type: 'blank' as const, coord: { q: -1, r: 0 }, rotation: 0, claims: [], input: b.input, output: b.output };
  const before: GameState = {
    ...g, board: [...g.board, blank], phase: 'actions', activePlayerIndex: g.turnOrder.indexOf(0), lastRoll: [5],
    players: g.players.map(p => (p.id === 0 ? { ...p, hand: ['sinkHole'] } : p)),
  };
  const r = applyAction(before, { type: 'PLAY_CARD', cardType: 'sinkHole', pieceId: 'b' });
  if (!r.ok) throw new Error(r.error.message);
  return { before, after: r.state };
}

describe('starting the view afresh', () => {
  it('the first game shown frames the table', () => {
    expect(freshView(null, createGame(7, 2))).toBe(true);
  });

  it('a Sink Hole (one piece fewer, same game) keeps the view and the piles', () => {
    const { before, after } = sinkHoleMove();
    expect(after.board.length).toBe(before.board.length - 1);
    expect(freshView(shownGame(before), after)).toBe(false);
  });

  it('the board growing in the same game keeps the view', () => {
    const g = createGame(7, 3);
    expect(freshView(shownGame({ ...g, board: g.board.slice(0, -2) }), g)).toBe(false);
  });

  it('another game frames afresh, smaller or larger', () => {
    const a = createGame(7, 2), b = createGame(8, 2), c = createGame(7, 3);
    expect(freshView(shownGame(a), b)).toBe(true);
    expect(freshView(shownGame(a), c)).toBe(true);
    expect(freshView(shownGame({ ...a, board: a.board.slice(0, 3) }), b)).toBe(true);
  });

  it('a jump back in the same game (a save or a replay going back several moves) frames afresh', () => {
    const g = createGame(7, 4);
    expect(freshView(shownGame(g), { ...g, board: g.board.slice(0, -3) })).toBe(true);
  });
});
