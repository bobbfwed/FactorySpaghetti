// Read-only facts about a game state that the controller needs for labels, costs and
// "why not" reasons. Nothing here decides legality: that is always legalActions.

import type { Action } from '../engine/actions';
import type { BoardPiece, GameState, Material, Player, PlayerId } from '../engine/state';
import {
  FACTORY_POWER_COST,
  INVENTORY_CAP,
  MATERIAL_VALUES,
  POWER_PLANT_BASE_YIELD,
  POWER_PLANT_MATERIAL_YIELD,
  POWER_TOKEN_CAP,
} from '../engine/config';
import { legalActions } from '../engine/reducer';
import { findInputCompletion, factoryExpectedProduct } from '../engine/rules/production';
import { factoryProduct } from '../engine/rules/recipes';

export const MATERIALS: readonly Material[] = ['ore', 'plate', 'sphere', 'tesseract'];

// ── legalActions, cached per immutable state ──────────────────────────────────

const legalCache = new WeakMap<GameState, Map<PlayerId, Action[]>>();

/** legalActions(game, me), memoised on the (immutable) state object. */
export function legalFor(game: GameState, me: PlayerId): Action[] {
  let m = legalCache.get(game);
  if (!m) { m = new Map(); legalCache.set(game, m); }
  let list = m.get(me);
  if (!list) { list = legalActions(game, me); m.set(me, list); }
  return list;
}

/** Canonical key of an action (field order independent), for set membership. */
export function actionKey(a: Action): string {
  const o = a as unknown as Record<string, unknown>;
  return JSON.stringify(Object.keys(o).sort().map(k => [k, o[k]]));
}

// ── Players and pieces ────────────────────────────────────────────────────────

export function activeId(game: GameState): PlayerId | null {
  return game.turnOrder[game.activePlayerIndex] ?? null;
}

export function inventoryValue(p: Player): number {
  return MATERIALS.reduce((s, m) => s + p.inventory[m] * MATERIAL_VALUES[m], 0);
}

export function pieceById(game: GameState, id: string): BoardPiece | undefined {
  return game.board.find(p => p.id === id);
}

export function isBuilding(p: BoardPiece): boolean {
  return p.type !== 'mine' && p.type !== 'blank';
}

/** The next Mine's price, or null when none are left. */
export function nextMinePrice(game: GameState, prices: readonly number[]): number | null {
  if (game.unplacedMines.length === 0) return null;
  return prices[2 - game.unplacedMines.length] ?? null;
}

// ── Operating a building ──────────────────────────────────────────────────────

export interface RunPreview {
  power: number;          // Power Tokens paid (factories) — 0 for a Power Plant
  gain: number;           // Power Tokens gained (Power Plant) — 0 for a factory
  consumed: Material[];
  product: Material | null; // null for a Power Plant
}

/**
 * What running this building would cost and make for `player`, or null if it cannot run.
 * Mirrors the engine: an input teleporter owned by the player completes missing inputs
 * from their materials (cheapest completion first).
 */
export function runPreview(piece: BoardPiece, player: Player): RunPreview | null {
  if (piece.type === 'powerPlant') {
    const inMat = piece.input?.slots[0] ?? null;
    const gain = inMat && inMat !== 'tesseract'
      ? POWER_PLANT_MATERIAL_YIELD[inMat]
      : POWER_PLANT_BASE_YIELD;
    return { power: 0, gain, consumed: inMat ? [inMat] : [], product: null };
  }
  if (!piece.input || !piece.output) return null;
  let slots: ReadonlyArray<Material | null> = piece.input.slots;
  if (slots.some(s => s === null)) {
    if (piece.input.teleporterOwner !== player.id) return null;
    const c = findInputCompletion(piece.type, slots, player.inventory);
    if (!c) return null;
    slots = c.newSlots;
  }
  const product = factoryProduct(piece.type, slots);
  if (!product) return null;
  const power = product === 'ore' ? 0 : FACTORY_POWER_COST[product];
  return { power, gain: 0, consumed: slots.filter((s): s is Material => s !== null), product };
}

export type RunBlock = 'alreadyRan' | 'powerFull' | 'outputFull' | 'loadFirst' | 'badRecipe' | 'needPower';

/** Why the meeple building cannot be run now (round end), or null if nothing is in the way. */
export function runBlock(piece: BoardPiece, player: Player): { why: RunBlock; need?: number } | null {
  if (player.meepleOperatedThisRound) return { why: 'alreadyRan' };
  if (piece.type === 'powerPlant') {
    return player.powerTokens >= POWER_TOKEN_CAP ? { why: 'powerFull' } : null;
  }
  if (!piece.input || !piece.output) return null;
  if (piece.output.slots.some(s => s !== null)) return { why: 'outputFull' };
  if (piece.input.slots.some(s => s === null)) return { why: 'loadFirst' };
  const product = factoryExpectedProduct(piece);
  if (!product) return { why: 'badRecipe' };
  const need = product === 'ore' ? 0 : FACTORY_POWER_COST[product];
  if (player.powerTokens < need) return { why: 'needPower', need };
  return null;
}

/** Materials in the output buffer that the player has room for. */
export function collectable(piece: BoardPiece, player: Player): Material[] {
  return (piece.output?.slots ?? []).filter((s): s is Material => s !== null && player.inventory[s] < INVENTORY_CAP);
}

// ── Exchange ──────────────────────────────────────────────────────────────────

/** The engine's break-down table (production.ts EXCHANGE_DOWN), for labels only. */
export const EXCHANGE_GETS: Readonly<Record<'plate' | 'sphere' | 'tesseract', Partial<Record<Material, number>>>> = {
  plate: { ore: 3 },
  sphere: { plate: 2, ore: 1 },
  tesseract: { sphere: 3, ore: 2 },
};
