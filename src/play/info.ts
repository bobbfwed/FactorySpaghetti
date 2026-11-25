// Read-only facts about a game state that the controller needs for labels, costs and
// "why not" reasons. Nothing here decides legality: that is always legalActions.

import type { Action } from '../engine/actions';
import type { BoardPiece, GameState, Material, Player, PlayerId } from '../engine/state';
import {
  FACTORY_POWER_COST,
  FACTORY_RECIPES,
  INVENTORY_CAP,
  MATERIAL_VALUES,
  POWER_PLANT_BASE_YIELD,
  POWER_PLANT_INPUTS,
  POWER_PLANT_MATERIAL_YIELD,
  POWER_TOKEN_CAP,
} from '../engine/config';
import { applyAction, legalActions } from '../engine/reducer';
import { payMaterials } from '../engine/rules/flow';
import { factoryExpectedProduct } from '../engine/rules/production';
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

const spotCache = new WeakMap<GameState, Map<PlayerId, boolean>>();

/**
 * Would the engine list a teleporter for `me` if materials were no object? (Same state, the
 * player's materials replaced by plenty of Ore.) Tells "too poor" apart from "no free buffer"
 * without a copy of the rules; memoised on the (immutable) state object.
 */
export function teleporterSpotFree(game: GameState, me: PlayerId): boolean {
  let m = spotCache.get(game);
  if (!m) { m = new Map(); spotCache.set(game, m); }
  let v = m.get(me);
  if (v === undefined) {
    const rich: GameState = {
      ...game,
      players: game.players.map((p, i) => (i === me ? { ...p, inventory: { ore: 999, plate: 0, sphere: 0, tesseract: 0 } } : p)),
    };
    v = legalActions(rich, me).some(a => a.type === 'PLACE_TELEPORTER');
    m.set(me, v);
  }
  return v;
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

/**
 * What paying `prices` one after the other (each with change, the engine's payMaterials) leaves
 * in `inv`, when change is involved: the materials kept and the value of change lost to the limit.
 * Null when no change comes back (the price is paid with exactly what is handed in) or when the
 * materials do not cover it.
 */
export function paymentWithChange(inv: Readonly<Record<Material, number>>, prices: readonly number[]):
  { kept: Record<Material, number>; lost: number } | null {
  let cur: Record<Material, number> = { ...inv };
  let change = false;
  let paid = 0;
  for (const price of prices) {
    const next = payMaterials(cur, price);
    if (!next) return null;
    if (MATERIALS.some(m => next[m] > cur[m])) change = true;
    cur = next;
    paid += price;
  }
  if (!change) return null;
  const value = (x: Readonly<Record<Material, number>>): number => MATERIALS.reduce((s, m) => s + x[m] * MATERIAL_VALUES[m], 0);
  return { kept: cur, lost: Math.max(0, value(inv) - paid - value(cur)) };
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
  gain: number;           // Power Tokens gained (Power Plant), as the limit lets them in — 0 for a factory
  nominal: number;        // Power Tokens the chart gives (Power Plant), before the limit — 0 for a factory
  consumed: Material[];
  product: Material | null; // null for a Power Plant
}

/**
 * What running this building would cost and make for `player`, with `supply` (materials they hand
 * over through their input teleporter into its empty slots) — or null when that does not make a
 * full recipe. Nothing is ever taken from the inventory unless it is named in `supply`
 * (RULES_CHANGES.md #45). Whether the run is allowed at all is legalActions' business.
 */
export function runPreview(piece: BoardPiece, player: Player, supply: readonly Material[] = []): RunPreview | null {
  if (piece.type === 'powerPlant') {
    const inMat = piece.input?.slots[0] ?? supply[0] ?? null;
    const nominal = inMat && inMat !== 'tesseract'
      ? POWER_PLANT_MATERIAL_YIELD[inMat]
      : POWER_PLANT_BASE_YIELD;
    const gain = Math.max(0, Math.min(nominal, POWER_TOKEN_CAP - player.powerTokens));
    return { power: 0, gain, nominal, consumed: inMat ? [inMat] : [], product: null };
  }
  if (!piece.input || !piece.output) return null;
  let i = 0;
  const slots = piece.input.slots.map(s => (s === null && i < supply.length ? supply[i++]! : s));
  if (slots.some(s => s === null)) return null;
  const product = factoryProduct(piece.type, slots);
  if (!product) return null;
  const power = product === 'ore' ? 0 : FACTORY_POWER_COST[product];
  return { power, gain: 0, nominal: 0, consumed: slots.filter((s): s is Material => s !== null), product };
}

/** The player's own teleporter sits on this building's input and an input slot is empty: they may supply it. */
export function canSupply(piece: BoardPiece, player: PlayerId): boolean {
  return !!piece.input && piece.input.teleporterOwner === player && piece.input.slots.some(s => s === null);
}

/**
 * The materials that would complete one of this factory's recipes, given what lies in its input
 * (the recipe table in config, for the words only): each distinct set, largest material first.
 * A Power Plant: any one Ore, Plate or Sphere.
 */
export function neededSets(piece: BoardPiece): Material[][] {
  if (piece.type === 'powerPlant') return POWER_PLANT_INPUTS.map(m => [m]);
  const recipes = FACTORY_RECIPES[piece.type]?.inputs ?? [];
  const filled = (piece.input?.slots ?? []).filter((s): s is Material => s !== null);
  const out: Material[][] = [];
  const seen = new Set<string>();
  for (const r of recipes) {
    const left = [...r];
    let fits = true;
    for (const m of filled) {
      const k = left.indexOf(m);
      if (k < 0) { fits = false; break; }
      left.splice(k, 1);
    }
    if (!fits || left.length === 0) continue;
    left.sort((a, b) => MATERIAL_VALUES[b] - MATERIAL_VALUES[a]);
    const key = left.join(',');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(left);
  }
  return out;
}

/** The Power Tokens a factory pays to run (by its product), or 0. */
export function factoryRunCost(piece: BoardPiece): number {
  const product = FACTORY_RECIPES[piece.type]?.product;
  return !product || product === 'ore' ? 0 : FACTORY_POWER_COST[product];
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

export interface ExchangeOutcome {
  /** What breaking one down gives, largest material first, before the limit. */
  gets: [Material, number][];
  /** Of `gets`, the materials the limit would cut now: how many of each would actually arrive. */
  cut: [Material, number, number][]; // material, nominal, arriving
}

/**
 * What exchanging one `give` would give `me` now, asked of the engine itself: once with an
 * inventory holding only that one material (what the exchange gives), once with the real
 * inventory (what arrives under the limit). null when the engine refuses the exchange.
 */
export function exchangeOutcome(game: GameState, me: PlayerId, give: Material): ExchangeOutcome | null {
  const p = game.players[me];
  if (!p) return null;
  const a: Action = { type: 'EXCHANGE_MATERIALS', give };
  const real = applyAction(game, a);
  const only: Record<Material, number> = { ore: 0, plate: 0, sphere: 0, tesseract: 0, [give]: 1 };
  const bare = applyAction({ ...game, players: game.players.map((x, i) => (i === me ? { ...x, inventory: only } : x)) }, a);
  if (!real.ok || !bare.ok) return null;
  const after = real.state.players[me]!.inventory;
  const nominal = bare.state.players[me]!.inventory;
  const gets: [Material, number][] = [...MATERIALS].reverse()
    .filter(m => m !== give && nominal[m] > 0).map(m => [m, nominal[m]]);
  const cut: [Material, number, number][] = gets
    .map(([m, n]): [Material, number, number] => [m, n, after[m] - p.inventory[m]])
    .filter(([, n, got]) => got < n);
  return { gets, cut };
}

/** The engine's break-down table (production.ts EXCHANGE_DOWN), for labels only. */
export const EXCHANGE_GETS: Readonly<Record<'plate' | 'sphere' | 'tesseract', Partial<Record<Material, number>>>> = {
  plate: { ore: 3 },
  sphere: { plate: 2, ore: 1 },
  tesseract: { sphere: 3, ore: 2 },
};
