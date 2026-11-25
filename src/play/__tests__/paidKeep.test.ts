// What a purchase paid with change leaves is said right after the purchase (a hint the table shows
// as a toast), not only in a tooltip on the bank chip.

import { describe, expect, it } from 'vitest';
import type { GameState, Player, PlayerId } from '../../engine/state';
import { W } from '../words';
import { atActions, harness } from './helpers';

function patchPlayer(s: GameState, p: PlayerId, patch: Partial<Player>): GameState {
  return { ...s, players: s.players.map((x, i) => (i === p ? { ...x, ...patch } : x)) };
}

describe('what a purchase leaves', () => {
  it('buying a Leverage card with a Sphere and an Ore at price 3: "Paid 3. You keep 1 Plate and 2 Ore."', () => {
    const { state, player } = atActions(5, 3);
    // Price 3 = Mines + 1 with two Mines.
    const s = patchPlayer({ ...state, mineCount: 2 }, player, { inventory: { ore: 1, plate: 0, sphere: 1, tesseract: 0 } });
    const { c, sent } = harness(s, player);
    c.choose('bank:buyCard');
    expect(sent).toEqual([{ type: 'BUY_CARD' }]);
    expect(c.view.hint).toBe(W.paidKeep(3, '1 Plate and 2 Ore', 0));
    expect(c.view.hint).toBe('Paid 3. You keep 1 Plate and 2 Ore.');
  });

  it('paid exactly: nothing to say', () => {
    const { state, player } = atActions(5, 3);
    const s = patchPlayer({ ...state, mineCount: 2 }, player, { inventory: { ore: 3, plate: 0, sphere: 0, tesseract: 0 } });
    const { c, sent } = harness(s, player);
    c.choose('bank:buyCard');
    expect(sent).toEqual([{ type: 'BUY_CARD' }]);
    expect(c.view.hint).toBeNull();
  });
});
