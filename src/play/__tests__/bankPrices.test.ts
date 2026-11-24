// The bank shows the engine's prices, carried as numbers in the play view.

import { describe, it, expect } from 'vitest';
import { PlayController } from '../controller';
import { createBotGame, playUntil } from '../../table/botGame';
import type { GameState, PlayerId } from '../../engine/state';
import { BELT_COST, MINE_COSTS, cardCost, teleporterCost } from '../../engine/config';
import type { Material } from '../../engine/config';
import { keepText } from '../controller';
import { paymentWithChange } from '../info';
import { W } from '../words';
import { atActions, harness } from './helpers';

function bankOf(g: GameState, me: PlayerId): Map<string, number | undefined> {
  const c = new PlayController({ send: (): void => undefined });
  c.update(g, me);
  return new Map(c.view.bank.map(b => [b.id, b.price]));
}

describe('bank prices in the play view', () => {
  it('belt, Leverage card, Mine and teleporter prices match the engine', () => {
    const g = playUntil(createBotGame(4, 3, 'random'), s => s.round >= 3, 3000);
    const b = bankOf(g, 0);
    expect(b.get('bank:buyBelt')).toBe(BELT_COST);
    expect(b.get('bank:buyCard')).toBe(cardCost(g.mineCount));
    expect(b.get('bank:teleporter')).toBe(teleporterCost(g.globalTeleporterCount));
    // The next Mine follows the unplaced Mines, not the Mines on the board.
    expect(b.get('bank:buyMine')).toBe(g.unplacedMines.length === 0 ? undefined : MINE_COSTS[2 - g.unplacedMines.length]);
  });

  it('a Mine that entered play by itself moves the price on; with all Mines in there is none', () => {
    const base = playUntil(createBotGame(4, 3, 'random'), s => s.round >= 3, 3000);
    const one = { ...base, unplacedMines: base.unplacedMines.slice(1), mineCount: 2 } as GameState;
    expect(bankOf(one, 0).get('bank:buyMine')).toBe(MINE_COSTS[1]);
    const none = { ...base, unplacedMines: [], mineCount: 3 } as GameState;
    expect(bankOf(none, 0).get('bank:buyMine')).toBeUndefined();
  });

  it('hand items carry their count as a number', () => {
    const g = playUntil(createBotGame(9, 2, 'random'), s => s.players.some(p => p.hand.length > 0), 6000);
    const me = g.players.find(p => p.hand.length > 0)!.id;
    const c = new PlayController({ send: (): void => undefined });
    c.update(g, me);
    const total = c.view.hand.reduce((s, it) => s + (it.count ?? 0), 0);
    expect(total).toBe(g.players[me]!.hand.length);
  });
});

describe('what a purchase with change leaves ("You keep ...")', () => {
  const inv = (ore: number, plate: number, sphere: number, tesseract: number): Record<Material, number> => ({ ore, plate, sphere, tesseract });

  it('says what is kept only when change comes back, from the engine\'s own payment', () => {
    expect(paymentWithChange(inv(1, 0, 1, 0), [3])).toEqual({ kept: inv(2, 1, 0, 0), lost: 0 });
    expect(paymentWithChange(inv(3, 0, 0, 0), [3])).toBeNull();     // paid exactly: no change
    expect(paymentWithChange(inv(2, 0, 0, 0), [3])).toBeNull();     // cannot pay
    // Several belts, one purchase each: a Plate pays the first and its change pays the second.
    expect(paymentWithChange(inv(0, 1, 0, 0), [1, 1])).toEqual({ kept: inv(1, 0, 0, 0), lost: 0 });
    expect(paymentWithChange(inv(0, 1, 0, 0), [1, 1, 1, 1])).toBeNull(); // 4 belts: a Plate is not enough
  });

  it('the bank items carry it in their details', () => {
    const { state, player } = atActions(5, 3);
    const s = { ...state, mineCount: 2, players: state.players.map(p => (p.id === player ? { ...p, inventory: inv(1, 0, 1, 0) } : p)) };
    const p = s.players[player]!;
    expect(keepText(p, [cardCost(2)])).toBe(W.payKeep('1 Plate and 2 Ore', 0));
    expect(keepText(p, [8])).toBe(''); // all of it, exactly
    const { c } = harness(s, player);
    const card = c.view.bank.find(b => b.id === 'bank:buyCard')!;
    expect(card.detail).toContain('You keep 1 Plate and 2 Ore');
    // A belt is paid exactly with the Ore: nothing to add.
    expect(c.view.bank.find(b => b.id === 'bank:buyBelt')!.detail).toBe(W.price(BELT_COST));
    // A lone Sphere buying a belt: 2 Plates come back.
    expect(keepText({ ...p, inventory: inv(0, 0, 1, 0) }, [BELT_COST])).toBe(W.payKeep('2 Plates', 0));
  });
});
