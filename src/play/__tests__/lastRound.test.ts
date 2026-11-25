// The last round and the Leverage deck reshuffle, as the interface tells them (RULES_CHANGES.md #44, #48).

import { describe, expect, it } from 'vitest';
import type { GameState } from '../../engine/state';
import { applyAction, legalActions, piecesExhausted } from '../../engine';
import { gameOverWords, phaseWords } from '../../app/gameText';
import type { Room } from '../../session/room';
import { reshuffledBy } from '../info';
import { W } from '../words';
import { active, findState, harness } from './helpers';

const noPieces = (s: GameState): GameState => ({ ...s, stacks: s.stacks.map(x => ({ ...x, pieces: [] })) as unknown as GameState['stacks'] });

describe('the last round', () => {
  it('with no piece left the turn starts at the roll, and the roll step says why', () => {
    const { state, player } = findState((s, p) => s.phase === 'roll' && active(s) === p && s.pendingFactoryOps.length === 0 && s.round >= 2);
    const s = noPieces(state);
    expect(piecesExhausted(s)).toBe(true);
    const { c } = harness(s, player);
    expect(c.view.instruction).toBe(W.rollNoPieces);
    expect(c.view.primary?.enabled).toBe(true);
    expect(phaseWords(s)).toBe('Step 2: roll the dice (no pieces are left to place)');
  });

  it('a place-a-piece step with nothing to draw is skipped by the engine (the interface never sees it)', () => {
    const { state, player } = findState((s, p) => s.phase === 'placeMeeple' && active(s) === p && legalActions(s, p).some(a => a.type === 'PLACE_MEEPLE')
      && s.activePlayerIndex < s.turnOrder.length - 1);
    let s = noPieces(state);
    for (const a of [legalActions(s, player).find(x => x.type === 'PLACE_MEEPLE')!, { type: 'END_TURN' } as const]) {
      const r = applyAction(s, a);
      if (!r.ok) throw new Error(r.error.code);
      s = r.state;
    }
    expect(s.phase).toBe('roll');
    expect(harness(s, active(s)).c.view.instruction).toBe(W.rollNoPieces);
  });

  it('the game-over words say how the game ended', () => {
    const { state } = findState(s => s.phase === 'actions' && s.round >= 2);
    const over: GameState = { ...state, gameOver: true, winner: 0, gameOverReason: 'boardExhausted' };
    const { c } = harness(over, 0);
    expect(c.view.instruction).toBe(W.gameOverWinner('Player 1', W.gameOverHow('boardExhausted')));
    expect(c.view.instruction).toMatch(/the pieces ran out, the last round was finished/);
    const room = { game: over, seats: over.players.map((_, i) => ({ name: `P${i + 1}` })) } as unknown as Room;
    expect(gameOverWords(room)).toBe('P1 wins on points (the pieces ran out, the last round was finished and material value was counted).');
    const t = harness({ ...over, gameOverReason: 'tesseracts' }, 0).c.view.instruction;
    expect(t).toBe('The game is over. Player 1 wins with 4 Tesseracts.');
  });
});

describe('the Leverage deck reshuffle', () => {
  it('is told only for a card bought from an empty deck', () => {
    const { state } = findState(s => s.phase === 'actions');
    const empty: GameState = { ...state, cardDeck: [], cardDiscard: ['embezzlement', 'sinkHole', 'shortSale'] };
    expect(reshuffledBy(empty, [{ kind: 'cardBought' }])).toBe(3);
    expect(reshuffledBy(empty, [{ kind: 'cardPlayed' }])).toBe(0);
    expect(reshuffledBy({ ...empty, cardDeck: ['embezzlement'] }, [{ kind: 'cardBought' }])).toBe(0);
    expect(W.reshuffled(3)).toBe('The Leverage deck was empty, so the discard pile (3 cards) was shuffled into a new deck.');
  });
});
