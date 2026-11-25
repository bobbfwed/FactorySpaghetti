// The few numbers the guide states that are not in the engine's config — what exchanging down
// gives, what a Mine's meeple points give, and how paying with change comes out — checked against the engine.

import { describe, it, expect } from 'vitest';
import { MINE_UPGRADE_REWARDS, applyAction, createGame, payMaterials } from '../../../engine';
import type { BoardPiece, GameState, Material, PlayerId } from '../../../engine';
import { MATERIALS, MINE_RESOURCE_REWARD, exchangeDown } from '../content/facts';
import { BELT_COST, INVENTORY_CAP, cardCost, teleporterCost } from '../../../engine/config';

const EMPTY: Record<Material, number> = { ore: 0, plate: 0, sphere: 0, tesseract: 0 };

function actionsState(inventory: Record<Material, number>): GameState {
  const g = createGame(7, 2);
  const active = g.turnOrder[g.activePlayerIndex]!;
  return { ...g, phase: 'actions', players: g.players.map(p => (p.id === active ? { ...p, inventory } : p)) };
}

function mine(id: string, q: number): BoardPiece {
  return { id, type: 'mine', coord: { q, r: 20 }, rotation: 0, claims: [], input: null, output: { slots: [null], teleporterOwner: null } };
}

/** The state after the round's last turn ends, with each player's meeple on the given Mine point. */
function roundEndWith(mines: number, meeples: { mine: number; slot: 0 | 1 }[]): GameState {
  const g = createGame(11, 2);
  const extra = Array.from({ length: mines - 1 }, (_, i) => mine(`mine-${i + 2}`, 20 + 4 * i));
  const ids = ['mine-1', ...extra.map(m => m.id)];
  const s: GameState = {
    ...g,
    board: [...g.board, ...extra],
    mineCount: mines,
    unplacedMines: g.unplacedMines.slice(mines - 1),
    phase: 'placeMeeple',
    activePlayerIndex: g.turnOrder.length - 1,
    players: g.players.map((p, i) => ({ ...p, meepleOnPieceId: ids[meeples[i]!.mine]!, meepleSlotIndex: meeples[i]!.slot })),
  };
  const r = applyAction(s, { type: 'END_TURN' });
  if (!r.ok) throw new Error(r.error.message);
  return r.state;
}

describe('numbers the guide states, checked against the engine', () => {
  it('exchanging down gives what the guide says', () => {
    for (const m of MATERIALS) {
      const got = exchangeDown(m);
      const r = applyAction(actionsState({ ...EMPTY, [m]: 1 }), { type: 'EXCHANGE_MATERIALS', give: m });
      if (got === null) { expect(r.ok, m).toBe(false); continue; }
      expect(r.ok, m).toBe(true);
      if (!r.ok) continue;
      const active = r.state.turnOrder[r.state.activePlayerIndex]!;
      expect(r.state.players[active]!.inventory, m).toEqual({ ...EMPTY, ...got });
    }
  });

  it('a Mine\'s resource point gives what the guide says, by the order the Mine came into play', () => {
    for (let i = 0; i < MINE_RESOURCE_REWARD.length; i++) {
      const s = roundEndWith(MINE_RESOURCE_REWARD.length, [{ mine: i, slot: 0 }, { mine: (i + 1) % MINE_RESOURCE_REWARD.length, slot: 1 }]);
      const reward = MINE_RESOURCE_REWARD[i]!;
      expect(s.players[0 as PlayerId]!.inventory, `Mine ${i + 1}`).toEqual({ ...EMPTY, [reward.material]: reward.n });
    }
  });

  // RULES_CHANGES.md #49: the upgrade point now gives the number printed on its Mine (2, 3, 4),
  // whatever the number of Mines. The guide's `mineCredits` (Mines + 1) and its wording still
  // state the old rule and are to be rewritten with the interface for these rules; until then
  // this checks the engine's number, MINE_UPGRADE_REWARDS.
  it('a Mine\'s upgrade point gives the number printed on that Mine, however many Mines are in play', () => {
    for (const mines of [1, 2, 3]) {
      for (let m = 0; m < mines; m++) {
        const s = roundEndWith(mines, [{ mine: m, slot: 1 }, { mine: m, slot: 0 }]);
        expect(s.players[0]!.freeActionCredits, `${mines} Mines, Mine ${m + 1}`).toBe(MINE_UPGRADE_REWARDS[m]);
        expect(s.players[0]!.freeUpgradesRemaining).toBe(mines);
      }
    }
  });

  it('the payment examples in the guide are what the engine charges', () => {
    // A Sphere and an Ore paying for a Leverage card with two Mines: a Plate and 2 Ore are kept.
    expect(payMaterials({ ...EMPTY, sphere: 1, ore: 1 }, cardCost(2))).toEqual({ ...EMPTY, plate: 1, ore: 2 });
    // 6 Plates and a Sphere buying a belt: a Plate is handed in, 2 Ore come back, the Sphere is kept.
    expect(payMaterials({ ...EMPTY, plate: INVENTORY_CAP, sphere: 1 }, BELT_COST)).toEqual({ ...EMPTY, plate: INVENTORY_CAP - 1, sphere: 1, ore: 2 });
    // A lone Sphere pays for the third teleporter.
    expect(payMaterials({ ...EMPTY, sphere: 1 }, teleporterCost(2))).not.toBeNull();
  });
});
