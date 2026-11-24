// What a meeple on a Mine earns at the end of the round. One place for the numbers, used by the
// round-end collection (production.ts collectMeepleBenefits) and by the interface, which tells the
// player what a Mine point will give before they confirm the meeple there. Pure, no IO.

import type { GameState, Material } from '../state';
import { INVENTORY_CAP } from '../config';

/**
 * The resource point of a Mine, by the Mine's order on the board (1st, 2nd, 3rd): 2 Ore, 1 Plate,
 * 1 Sphere. A Mine beyond the list gives what the last entry gives.
 */
export const MINE_RESOURCE_REWARDS: readonly { readonly material: Material; readonly amount: number }[] = [
  { material: 'ore', amount: 2 },
  { material: 'plate', amount: 1 },
  { material: 'sphere', amount: 1 },
];

/** The upgrade point of a Mine gives this many Control Module upgrade credits per Mine in play, plus `UPGRADE_POINT_BONUS`. */
export const UPGRADE_POINT_PER_MINE = 1;
export const UPGRADE_POINT_BONUS = 1;

export type MineSlotReward =
  | { readonly kind: 'material'; readonly material: Material; readonly amount: number }
  | { readonly kind: 'credits'; readonly amount: number };

/**
 * What a meeple on `slot` (0 = resource point, 1 = upgrade point) of the Mine `mineId` would earn
 * if the round ended in `state`. null when `mineId` is not a Mine on the board or the slot is not 0 or 1.
 * The material reward is the full amount; `cappedAmount` says how much of it fits under the limit.
 */
export function mineSlotReward(state: Pick<GameState, 'board' | 'mineCount'>, mineId: string, slot: number): MineSlotReward | null {
  const mines = state.board.filter(p => p.type === 'mine');
  const idx = mines.findIndex(m => m.id === mineId);
  if (idx < 0) return null;
  if (slot === 0) {
    const r = MINE_RESOURCE_REWARDS[Math.min(idx, MINE_RESOURCE_REWARDS.length - 1)]!;
    return { kind: 'material', material: r.material, amount: r.amount };
  }
  if (slot === 1) return { kind: 'credits', amount: state.mineCount * UPGRADE_POINT_PER_MINE + UPGRADE_POINT_BONUS };
  return null;
}

/** How much of `amount` more `material` fits in an inventory under the limit (INVENTORY_CAP). */
export function cappedAmount(inventory: Readonly<Record<Material, number>>, material: Material, amount: number): number {
  return Math.max(0, Math.min(inventory[material] + amount, INVENTORY_CAP) - inventory[material]);
}
