// What a meeple on a Mine earns at the end of the round. One place for the numbers, used by the
// round-end collection (production.ts collectMeepleBenefits) and by the interface, which tells the
// player what a Mine point will give before they confirm the meeple there. Pure, no IO.

import type { GameState, Material } from '../state';
import { INVENTORY_CAP } from '../config';

/**
 * The resource point of a Mine, by the Mine (Mine 1, 2, 3): 2 Ore, 1 Plate, 1 Sphere. A Mine
 * beyond the list gives what the last entry gives.
 */
export const MINE_RESOURCE_REWARDS: readonly { readonly material: Material; readonly amount: number }[] = [
  { material: 'ore', amount: 2 },
  { material: 'plate', amount: 1 },
  { material: 'sphere', amount: 1 },
];

/**
 * The upgrade point of a Mine, by the Mine (Mine 1, 2, 3): the Control Module upgrade credits
 * printed on it — 2, 3, 4 — whatever the number of Mines in play (RULES_CHANGES.md #49). A Mine
 * beyond the list gives what the last entry gives.
 */
export const MINE_UPGRADE_REWARDS: readonly number[] = [2, 3, 4];

export type MineSlotReward =
  | { readonly kind: 'material'; readonly material: Material; readonly amount: number }
  | { readonly kind: 'credits'; readonly amount: number };

/**
 * Which Mine `mineId` is, counted from 0 (Mine 1 = 0): by its piece ('mine-1', 'mine-2', 'mine-3'),
 * else by its order among the Mines on the board (the order they were put down, which is the same).
 * -1 when it is not a Mine on the board.
 */
function mineIndex(state: Pick<GameState, 'board'>, mineId: string): number {
  const mines = state.board.filter(p => p.type === 'mine');
  const idx = mines.findIndex(m => m.id === mineId);
  if (idx < 0) return -1;
  const printed = /^mine-(\d+)$/.exec(mineId);
  return printed ? Math.max(0, Number(printed[1]) - 1) : idx;
}

/**
 * What a meeple on `slot` (0 = resource point, 1 = upgrade point) of the Mine `mineId` would earn
 * if the round ended in `state`. null when `mineId` is not a Mine on the board or the slot is not 0 or 1.
 * The material reward is the full amount; `cappedAmount` says how much of it fits under the limit.
 */
export function mineSlotReward(state: Pick<GameState, 'board' | 'mineCount'>, mineId: string, slot: number): MineSlotReward | null {
  const idx = mineIndex(state, mineId);
  if (idx < 0) return null;
  if (slot === 0) {
    const r = MINE_RESOURCE_REWARDS[Math.min(idx, MINE_RESOURCE_REWARDS.length - 1)]!;
    return { kind: 'material', material: r.material, amount: r.amount };
  }
  if (slot === 1) return { kind: 'credits', amount: MINE_UPGRADE_REWARDS[Math.min(idx, MINE_UPGRADE_REWARDS.length - 1)]! };
  return null;
}

/** How much of `amount` more `material` fits in an inventory under the limit (INVENTORY_CAP). */
export function cappedAmount(inventory: Readonly<Record<Material, number>>, material: Material, amount: number): number {
  return Math.max(0, Math.min(inventory[material] + amount, INVENTORY_CAP) - inventory[material]);
}
