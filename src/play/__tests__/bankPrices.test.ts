// The bank shows the engine's prices, carried as numbers in the play view.

import { describe, it, expect } from 'vitest';
import { PlayController } from '../controller';
import { createBotGame, playUntil } from '../../table/botGame';
import type { GameState, PlayerId } from '../../engine/state';
import { BELT_COST, MINE_COSTS, cardCost, teleporterCost } from '../../engine/config';

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
