// Board reading shared by the play-style bots: what each building makes, what feeds its inputs
// (a Mine ore exit or another building's output, directly or along the player's own belts),
// how often it fires, and what a human would think it is worth. Consumers of the engine only:
// these helpers read the state through the engine's own geometry (adjAt, getRole) and never
// decide what is legal — every move a bot makes is still checked by applyAction.

import type { BoardPiece, GameState, HexCoord, Material, PieceType, Player, PlayerId } from '../../engine/state';
import { MATERIAL_VALUES, POWER_PLANT_MATERIAL_YIELD, pieceTemplate } from '../../engine/config';
import { adjAt, getRole, isReservedPoint } from '../../engine/rules/flow';
import { canLoadMaterial } from '../../engine/rules/recipes';
import { hexNeighbours, isCoordsOccupied, mineSecondaryCoord } from '../../engine/rules/pieces';
import { plannedHitChance } from './dice';

export const MATS: readonly Material[] = ['ore', 'plate', 'sphere', 'tesseract'];

/** What a building puts in its output buffer. */
export const PRODUCT: Partial<Record<PieceType, Material>> = {
  plateFact: 'plate',
  sphereFact: 'sphere',
  tesseractFact: 'tesseract',
};

/** Power Tokens spent to run a factory, by product. */
export const POWER_COST: Record<Material, number> = { ore: 0, plate: 1, sphere: 2, tesseract: 3 };

export function isBuilding(p: BoardPiece): boolean {
  return p.type !== 'mine' && p.type !== 'blank';
}

export function owns(p: BoardPiece, me: PlayerId): boolean {
  return p.claims.some(c => c.ownerId === me);
}

export function myModules(p: BoardPiece, me: PlayerId): number[] {
  return p.claims.filter(c => c.ownerId === me).map(c => c.controlModule);
}

export function myBuildings(state: GameState, me: PlayerId): BoardPiece[] {
  return state.board.filter(p => isBuilding(p) && owns(p, me));
}

export function hexDistance(a: HexCoord, b: HexCoord): number {
  const dq = a.q - b.q;
  const dr = a.r - b.r;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}

/** Sorted positions of a piece's points with the given role. */
export function pointsWithRole(p: { type: PieceType; id: string }, role: string): number[] {
  return pieceTemplate(p).points.filter(pt => pt.enabled && pt.role === role).map(pt => pt.position).sort((a, b) => a - b);
}

// ── What feeds an input ───────────────────────────────────────────────────────

/** Where material entering an input comes from: Mine ore, or the output of a building. */
export interface Feed {
  readonly material: Material;
  readonly fromPieceId: string;
  readonly viaBelts: number; // 0 = directly adjacent
}

/**
 * The source that reaches input point `pos` of `piece`: across the shared edge directly, or
 * along a chain of `me`'s belts (belts of one player only join each other). null when nothing
 * delivers there.
 */
export function feedAt(state: GameState, piece: BoardPiece, pos: number, me: PlayerId): Feed | null {
  let n = adjAt(piece.coord, piece.rotation ?? 0, pos, state.board);
  let belts = 0;
  const seen = new Set<string>();
  while (n) {
    const role = getRole(n.piece, n.pos);
    if (role === 'ore_output') return { material: 'ore', fromPieceId: n.piece.id, viaBelts: belts };
    if (role === 'output_buffer') {
      if (belts > 0 && isReservedPoint(n.piece, n.pos, me)) return null; // a dead end for my belt
      const product = PRODUCT[n.piece.type];
      return product ? { material: product, fromPieceId: n.piece.id, viaBelts: belts } : null;
    }
    if (role !== 'belt') return null;
    const at = n;
    const belt = state.belts.find(b => b.ownerId === me && b.pieceId === at.piece.id &&
      (b.fromPoint === at.pos || b.toPoint === at.pos));
    if (!belt) return null;
    const k = `${belt.id}`;
    if (seen.has(k)) return null;
    seen.add(k);
    belts++;
    const other = belt.fromPoint === at.pos ? belt.toPoint : belt.fromPoint;
    n = adjAt(at.piece.coord, at.piece.rotation ?? 0, other, state.board);
  }
  return null;
}

/** The feed of every input slot of a building, in slot order (null = unfed). */
export function inputFeeds(state: GameState, piece: BoardPiece, me: PlayerId): Array<Feed | null> {
  return pointsWithRole(piece, 'input_buffer').map(pos => feedAt(state, piece, pos, me));
}

/**
 * How much of the building's recipe arrives by itself, 0–1: the fed inputs that can be part of
 * one valid recipe, over the number of input slots. A Power Plant counts as fed when ore (or
 * better) reaches it. An input teleporter of the owner counts as a full feed from inventory.
 */
export function fedFraction(state: GameState, piece: BoardPiece, me: PlayerId): number {
  if (!piece.input) return 0;
  if (piece.input.teleporterOwner === me) return 1;
  const feeds = inputFeeds(state, piece, me);
  // Material already waiting in a slot counts as arrived (it may have come along a co-owner's belt).
  const slots: Array<Material | null> = feeds.map(() => null);
  let fed = 0;
  feeds.forEach((f, i) => {
    const m = f?.material ?? piece.input!.slots[i] ?? null;
    if (m && canLoadMaterial(piece.type, slots, m)) { slots[i] = m; fed++; }
  });
  if (piece.type === 'powerPlant') return fed > 0 ? 1 : 0;
  return fed / feeds.length;
}

/** The input positions of a building that nothing feeds yet, with the materials that would fit. */
export function unfedInputs(state: GameState, piece: BoardPiece, me: PlayerId): Array<{ pos: number; wants: Material[] }> {
  if (!piece.input) return [];
  const positions = pointsWithRole(piece, 'input_buffer');
  const feeds = positions.map(pos => feedAt(state, piece, pos, me));
  const slots: Array<Material | null> = feeds.map(() => null);
  feeds.forEach((f, i) => { if (f && canLoadMaterial(piece.type, slots, f.material)) slots[i] = f.material; });
  const out: Array<{ pos: number; wants: Material[] }> = [];
  positions.forEach((pos, i) => {
    if (slots[i] !== null) return;
    const wants = (['ore', 'plate', 'sphere'] as Material[]).filter(m => canLoadMaterial(piece.type, slots, m));
    if (wants.length > 0) out.push({ pos, wants });
  });
  return out;
}

// ── Worth ─────────────────────────────────────────────────────────────────────

/** What one run of a building is worth to its owner, in material value (a Power Token ≈ powerValue). */
export function runWorth(type: PieceType, powerValue: number): number {
  switch (type) {
    case 'plateFact': return MATERIAL_VALUES.plate - powerValue * POWER_COST.plate;
    case 'sphereFact': return MATERIAL_VALUES.sphere - powerValue * POWER_COST.sphere;
    case 'tesseractFact': return MATERIAL_VALUES.tesseract - powerValue * POWER_COST.tesseract;
    case 'powerPlant': return 1.5 * powerValue;
    default: return 0;
  }
}

/**
 * Expected runs per round of a building with `modules` (every turn is a roll that can fire
 * it). `futureWeight` blends in the dice of the next Mine (see dice.plannedHitChance).
 */
export function runsPerRound(state: GameState, modules: readonly number[], futureWeight: number): number {
  let p = 0;
  for (const m of modules) p += plannedHitChance(state, m, futureWeight);
  return p * state.playerCount;
}

/**
 * A human's rough value per round of holding `piece` with `modules`: runs per round × worth of
 * a run × how much of its recipe arrives by itself (an unfed building can still be run from the
 * inventory through the meeple or an input teleporter, so it keeps part of its value).
 */
export function buildingValue(
  state: GameState, piece: BoardPiece, me: PlayerId, powerValue: number,
  modules: readonly number[], futureWeight: number,
): number {
  if (modules.length === 0) return 0;
  const fed = fedFraction(state, piece, me);
  const outTele = piece.output?.teleporterOwner === me || piece.type === 'powerPlant';
  // A full output buffer blocks the next run until someone collects it; an output teleporter
  // (or a chain that carries the output away) keeps it running.
  // Without either, a run is only worth something when the meeple comes to collect it.
  const carriesAway = outTele || outputFeedsMine(state, piece, me);
  const outputFactor = carriesAway ? 1 : 0.25;
  return runsPerRound(state, modules, futureWeight) * runWorth(piece.type, powerValue) * (0.35 + 0.65 * fed) * outputFactor;
}

/** True when the building's output reaches an input of one of `me`'s buildings (directly or by belt). */
export function outputFeedsMine(state: GameState, piece: BoardPiece, me: PlayerId): boolean {
  if (!piece.output) return false;
  for (const b of state.board) {
    if (b.id === piece.id || !isBuilding(b) || !owns(b, me) || !b.input) continue;
    for (const pos of pointsWithRole(b, 'input_buffer')) {
      const f = feedAt(state, b, pos, me);
      if (f && f.fromPieceId === piece.id) return true;
    }
  }
  return false;
}

/** Value of material sitting in the output buffers of `me`'s buildings. */
export function bufferedValue(state: GameState, me: PlayerId): number {
  let v = 0;
  for (const p of state.board) {
    if (!p.output || !owns(p, me) || p.type === 'mine') continue;
    for (const s of p.output.slots) if (s !== null) v += MATERIAL_VALUES[s];
  }
  return v;
}

export function inventoryWorth(inv: Readonly<Record<Material, number>>): number {
  let v = 0;
  for (const m of MATS) v += inv[m] * MATERIAL_VALUES[m];
  return v;
}

/** Power Tokens a Power Plant run yields with `material` loaded (null = nothing loaded). */
export function powerYield(material: Material | null): number {
  if (material === null || material === 'tesseract') return 1;
  return POWER_PLANT_MATERIAL_YIELD[material];
}

// ── Placement geometry ───────────────────────────────────────────────────────

/** All free cells next to the board. */
export function freeCells(state: GameState): HexCoord[] {
  const seen = new Map<string, HexCoord>();
  const add = (c: HexCoord): void => {
    for (const n of hexNeighbours(c)) {
      const k = `${n.q},${n.r}`;
      if (!seen.has(k) && !isCoordsOccupied(n, state.board)) seen.set(k, n);
    }
  };
  for (const p of state.board) {
    add(p.coord);
    if (p.type === 'mine') add(mineSecondaryCoord(p.coord, p.rotation ?? 0));
  }
  return [...seen.values()];
}

/** The point across the edge from `pos` of a (possibly hypothetical) piece, with its role. */
export function across(board: ReadonlyArray<BoardPiece>, coord: HexCoord, rotation: number, pos: number): { piece: BoardPiece; pos: number; role: string } | null {
  const n = adjAt(coord, rotation, pos, board);
  if (!n) return null;
  return { piece: n.piece, pos: n.pos, role: getRole(n.piece, n.pos) };
}

export function player(state: GameState, me: PlayerId): Player {
  return state.players[me]!;
}
