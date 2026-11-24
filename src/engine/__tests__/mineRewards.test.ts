// What a meeple on a Mine point earns: the helper, and the round-end collection that uses it.

import { describe, expect, it } from 'vitest';
import { applyAction } from '../reducer';
import { cappedAmount, mineSlotReward } from '../rules/mineRewards';
import type { BoardPiece, GameState, Player } from '../state';
import { expectOk, reachActionsPhase } from './helpers';

/** A state with three Mines on the board (copies of the first, in board order m1, m2, m3). */
function threeMines(): GameState {
  const s = reachActionsPhase(1, 3);
  const first = s.board.find(p => p.type === 'mine')!;
  const extra: BoardPiece[] = [
    { ...first, id: 'mine-two', coord: { q: 40, r: 0 } },
    { ...first, id: 'mine-three', coord: { q: 80, r: 0 } },
  ];
  return { ...s, board: [...s.board, ...extra], mineCount: 3 };
}

describe('mineSlotReward', () => {
  it('the resource point gives 2 Ore, 1 Plate, 1 Sphere by Mine order; the upgrade point Mines + 1 credits', () => {
    const s = threeMines();
    const [m1, m2, m3] = s.board.filter(p => p.type === 'mine');
    expect(mineSlotReward(s, m1!.id, 0)).toEqual({ kind: 'material', material: 'ore', amount: 2 });
    expect(mineSlotReward(s, m2!.id, 0)).toEqual({ kind: 'material', material: 'plate', amount: 1 });
    expect(mineSlotReward(s, m3!.id, 0)).toEqual({ kind: 'material', material: 'sphere', amount: 1 });
    expect(mineSlotReward(s, m2!.id, 1)).toEqual({ kind: 'credits', amount: 4 });
    expect(mineSlotReward({ ...s, mineCount: 1 }, m1!.id, 1)).toEqual({ kind: 'credits', amount: 2 });
  });

  it('is null for a piece that is not a Mine, or a slot that does not exist', () => {
    const s = threeMines();
    const building = s.board.find(p => p.type !== 'mine')!;
    expect(mineSlotReward(s, building.id, 0)).toBeNull();
    expect(mineSlotReward(s, 'nope', 0)).toBeNull();
    expect(mineSlotReward(s, s.board.find(p => p.type === 'mine')!.id, 2)).toBeNull();
  });

  it('cappedAmount: how much fits under the limit of 6', () => {
    const inv = { ore: 5, plate: 6, sphere: 0, tesseract: 0 };
    expect(cappedAmount(inv, 'ore', 2)).toBe(1);
    expect(cappedAmount(inv, 'plate', 1)).toBe(0);
    expect(cappedAmount(inv, 'sphere', 1)).toBe(1);
  });

  it('the round end pays exactly what the helper says (capped at 6)', () => {
    const s0 = threeMines();
    const [m1, m2, m3] = s0.board.filter(p => p.type === 'mine');
    const seats: Partial<Player>[] = [
      { meepleOnPieceId: m1!.id, meepleSlotIndex: 0, inventory: { ore: 5, plate: 0, sphere: 0, tesseract: 0 } },
      { meepleOnPieceId: m2!.id, meepleSlotIndex: 0, inventory: { ore: 0, plate: 2, sphere: 0, tesseract: 0 }, freeActionCredits: 0 },
      { meepleOnPieceId: m3!.id, meepleSlotIndex: 1, freeActionCredits: 1 },
    ];
    // The round's last player ends their turn in step 4.
    const s: GameState = {
      ...s0,
      phase: 'placeMeeple',
      activePlayerIndex: s0.turnOrder.length - 1,
      players: s0.players.map((p, i) => ({ ...p, ...seats[i] })),
    };
    const after = expectOk(applyAction(s, { type: 'END_TURN' }));
    expect(after.phase).toBe('roundEnd');
    expect(after.players[0]!.inventory.ore).toBe(6); // 5 + 2, capped
    expect(after.players[1]!.inventory.plate).toBe(3);
    expect(after.players[2]!.freeActionCredits).toBe(1 + 4);
  });
});
