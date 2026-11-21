// Read-only facts about a game state that the controller needs for labels, costs and
// "why not" reasons. Nothing here decides legality: that is always legalActions.

import type { Action } from '../engine/actions';
import type { BoardPiece, GameState, Material, Player, PlayerId } from '../engine/state';
import {
  FACTORY_POWER_COST,
  INVENTORY_CAP,
  MATERIAL_VALUES,
  PIECE_TEMPLATES,
  POWER_PLANT_BASE_YIELD,
  POWER_PLANT_MATERIAL_YIELD,
  POWER_TOKEN_CAP,
} from '../engine/config';
import { legalActions } from '../engine/reducer';
import { findInputCompletion, factoryExpectedProduct } from '../engine/rules/production';
import { factoryProduct } from '../engine/rules/recipes';
import { adjAt } from '../engine/rules/flow';
import { usableBeltPoints, type RoutePoint } from '../engine/routing';

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

// ── Belt routes ───────────────────────────────────────────────────────────────

export const pointKey = (pieceId: string, pos: number): string => `${pieceId}:${pos}`;

const reachCache = new WeakMap<GameState, Map<string, Set<string>>>();

/**
 * Every belt point that the engine's router (findBeltPath) can reach from `start` for `me`.
 * This is findBeltPath's own breadth-first search run to exhaustion instead of stopping at
 * one target, so `findBeltPath(start, T) !== null` exactly when T is in the returned set.
 */
export function routeReach(game: GameState, start: RoutePoint, me: PlayerId): Set<string> {
  let byStart = reachCache.get(game);
  if (!byStart) { byStart = new Map(); reachCache.set(game, byStart); }
  const ck = `${me}|${pointKey(start.pieceId, start.position)}`;
  const hit = byStart.get(ck);
  if (hit) return hit;

  const usableKey = `${me}|usable`;
  const usable: Set<string> = byStart.get(usableKey)
    ?? new Set(usableBeltPoints(game, me).map(p => pointKey(p.pieceId, p.position)));
  byStart.set(usableKey, usable);
  const reach = new Set<string>();
  const pieces = new Map(game.board.map(p => [p.id, p]));
  if (!usable.has(pointKey(start.pieceId, start.position))) { byStart.set(ck, reach); return reach; }

  interface Link { belt?: { pieceId: string; from: number; to: number }; parent: string | null }
  const parent = new Map<string, Link>();
  const startKey = pointKey(start.pieceId, start.position);
  parent.set(startKey, { parent: null });
  const visited = new Set<string>([startKey]);
  const queue: { pieceId: string; pos: number }[] = [{ pieceId: start.pieceId, pos: start.position }];

  const usedOn = (fromKey: string, pieceId: string): Set<number> => {
    const used = new Set<number>();
    let k: string | null = fromKey;
    while (k !== null) {
      const l = parent.get(k);
      if (!l) break;
      if (l.belt && l.belt.pieceId === pieceId) { used.add(l.belt.from); used.add(l.belt.to); }
      k = l.parent;
    }
    return used;
  };

  while (queue.length > 0) {
    const node = queue.shift()!;
    const piece = pieces.get(node.pieceId);
    if (!piece) continue;
    const tmpl = PIECE_TEMPLATES[piece.type];
    const total = tmpl.hexCount * 12;
    const nodeKey = pointKey(node.pieceId, node.pos);
    const usedHere = usedOn(nodeKey, piece.id);
    if (usedHere.has(node.pos)) continue;
    for (const def of tmpl.points) {
      if (!def.enabled || def.role !== 'belt') continue;
      const c = def.position;
      if (c === node.pos) continue;
      const d = Math.abs(node.pos - c);
      if (Math.min(d, total - d) <= 2) continue;
      if (!usable.has(pointKey(piece.id, c))) continue;
      if (usedHere.has(c)) continue;
      reach.add(pointKey(piece.id, c));
      const n = adjAt(piece.coord, piece.rotation ?? 0, c, game.board);
      if (!n || n.piece.type === 'mine') continue;
      const nk = pointKey(n.piece.id, n.pos);
      if (!usable.has(nk) || visited.has(nk)) continue;
      visited.add(nk);
      parent.set(nk, { belt: { pieceId: piece.id, from: node.pos, to: c }, parent: nodeKey });
      queue.push({ pieceId: n.piece.id, pos: n.pos });
    }
  }
  byStart.set(ck, reach);
  return reach;
}
