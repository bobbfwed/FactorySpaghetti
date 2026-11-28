// A bot judges a Leverage card purchase on what a player at the table can know. The deck is face
// down and the other players' hands are hidden, so moving a card between the deck and another
// player's hand must not change what the bot expects from a purchase.

import { describe, expect, it } from 'vitest';
import type { CardType, GameState } from '../../engine/state';
import { createGame } from '../../engine/rules/setup';
import { cardsABuyMayBring } from '../styles/analysis';

const sorted = (cards: readonly CardType[]): CardType[] => [...cards].sort();

/** The same game with the top `n` cards of the deck in the hand of player `to`. */
function dealt(s: GameState, to: number, n: number): GameState {
  return {
    ...s,
    cardDeck: s.cardDeck.slice(n),
    players: s.players.map((p, i) => (i === to ? { ...p, hand: [...p.hand, ...s.cardDeck.slice(0, n)] } : p)),
  };
}

describe('cardsABuyMayBring', () => {
  const base = createGame(11, 3);

  it("does not change when cards move from the deck into another player's hand", () => {
    expect(base.cardDeck.length).toBeGreaterThan(6);
    const before = sorted(cardsABuyMayBring(base, 0));
    expect(sorted(cardsABuyMayBring(dealt(base, 1, 4), 0))).toEqual(before);
    expect(sorted(cardsABuyMayBring(dealt(dealt(base, 1, 2), 2, 3), 0))).toEqual(before);
  });

  it("leaves out the player's own hand and the face-up discard pile", () => {
    const mine = dealt(base, 0, 3);
    expect(cardsABuyMayBring(mine, 0)).toHaveLength(base.cardDeck.length - 3);
    const discarded: GameState = { ...base, cardDeck: base.cardDeck.slice(2), cardDiscard: base.cardDeck.slice(0, 2) };
    expect(cardsABuyMayBring(discarded, 0)).toHaveLength(base.cardDeck.length - 2);
  });

  it('is the discard pile once the deck is empty, because a purchase refills the deck from it', () => {
    const empty: GameState = { ...dealt(base, 1, 2), cardDeck: [], cardDiscard: base.cardDeck.slice(2, 7) };
    expect(sorted(cardsABuyMayBring(empty, 0))).toEqual(sorted(base.cardDeck.slice(2, 7)));
  });
});
