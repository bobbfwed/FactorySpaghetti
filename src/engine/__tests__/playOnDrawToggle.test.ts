// RULES_CHANGES.md #36 with its config toggle switched OFF (PLAY_ON_DRAW_COUNTS_TOWARD_LIMIT =
// false): a play-on-draw card still resolves when drawn, but does not use up one of the turn's
// Leverage card plays. The toggle is a config constant, so this file mocks the config module
// (the "on" behaviour, the default, is covered in designerDecisions.test.ts).

import { describe, it, expect, vi } from 'vitest';

vi.mock('../config', async importOriginal => {
  const real = await importOriginal<typeof import('../config')>();
  return { ...real, PLAY_ON_DRAW_COUNTS_TOWARD_LIMIT: false };
});

import { applyAction, legalActions } from '../reducer';
import { MAX_CARDS_PLAYED_PER_TURN, PLAY_ON_DRAW_COUNTS_TOWARD_LIMIT } from '../config';
import { sameMove } from '../actions';
import type { GameState, Player, PlayerId } from '../state';
import { activePlayer, reachActionsPhase, expectOk } from './helpers';

function patchPlayer(s: GameState, p: PlayerId, patch: Partial<Player>): GameState {
  return { ...s, players: s.players.map((x, i) => (i === p ? { ...x, ...patch } : x)) };
}

describe('play-on-draw cards with the toggle switched off (#36)', () => {
  const base = reachActionsPhase(42, 2);
  const me = activePlayer(base);
  const ready = (played: number): GameState =>
    patchPlayer({ ...base, cardsPlayedThisTurn: played, cardDeck: ['solarFlare', ...base.cardDeck] }, me,
      { inventory: { ore: 6, plate: 0, sphere: 0, tesseract: 0 }, hand: ['embezzlement'] });

  it('the mock is in effect', () => {
    expect(PLAY_ON_DRAW_COUNTS_TOWARD_LIMIT).toBe(false);
  });

  it('a play-on-draw card resolves but does not count toward the limit', () => {
    for (const played of [0, 1]) {
      const s = ready(played);
      const after = expectOk(applyAction(s, { type: 'BUY_CARD' }));
      expect(after.cardsPlayedThisTurn).toBe(played);
      // Solar Flare resolved: every player got 2 Power Tokens (up to the cap of 10).
      expect(after.players.every((p, i) => p.powerTokens === Math.min(10, s.players[i]!.powerTokens + 2))).toBe(true);
      expect(after.cardDiscard[after.cardDiscard.length - 1]).toBe('solarFlare');
    }
  });

  it('so the card in hand can still be played after it, up to the limit', () => {
    const s = ready(MAX_CARDS_PLAYED_PER_TURN - 1);
    const after = expectOk(applyAction(s, { type: 'BUY_CARD' }));
    const play = { type: 'PLAY_CARD', cardType: 'embezzlement' } as const;
    expect(legalActions(after, me).some(l => sameMove(l, play))).toBe(true);
    const played = expectOk(applyAction(after, play));
    expect(played.cardsPlayedThisTurn).toBe(MAX_CARDS_PLAYED_PER_TURN);
  });
});
