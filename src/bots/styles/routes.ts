// Belt planning for the play-style bots. The engine's findRoute answers "one source to one
// input"; a player thinks "where is the nearest ore (or Plate) I can bring to this input?",
// so this searches from every usable source at once with the same model as findRoute
// (a belt joins two points of one piece more than two apart; material crosses a shared edge
// for free; points facing a building reserved for its owner (one owner per building, #57), or
// another player's belt, are off limits; an output carrying a teleporter is no source and a
// teleported input no destination, #53/#55). It also finds deliberately long routes for the Belt
// Weaver bonus.
// Plans only: every belt is still placed through applyAction, which has the last word.

import type { BoardPiece, GameState, Material, PlayerId } from '../../engine/state';
import type { BeltPlacement } from '../../engine/routing';
import { pieceTemplate } from '../../engine/config';
import { adjAt, getRole, beltEndpointBlocked, inputIndexAt, teleporterCutsOff } from '../../engine/rules/flow';
import { PRODUCT, feedAt, owns } from './analysis';

export interface PlannedRoute {
  readonly belts: ReadonlyArray<BeltPlacement>;
  readonly material: Material;
  readonly sourcePieceId: string;
}

interface Ctx {
  readonly state: GameState;
  readonly me: PlayerId;
  readonly byId: Map<string, BoardPiece>;
  readonly used: Set<string>; // piece:pos taken by any belt
  readonly beltPts: Map<string, number[]>;
}

function ctxOf(state: GameState, me: PlayerId): Ctx {
  const used = new Set<string>();
  for (const b of state.belts) { used.add(`${b.pieceId}:${b.fromPoint}`); used.add(`${b.pieceId}:${b.toPoint}`); }
  const beltPts = new Map<string, number[]>();
  for (const p of state.board) {
    if (p.type === 'mine') continue;
    beltPts.set(p.id, pieceTemplate(p).points.filter(pt => pt.enabled && pt.role === 'belt').map(pt => pt.position));
  }
  return { state, me, byId: new Map(state.board.map(p => [p.id, p])), used, beltPts };
}

function usable(c: Ctx, piece: BoardPiece, pos: number): boolean {
  if (c.used.has(`${piece.id}:${pos}`)) return false;
  if (getRole(piece, pos) !== 'belt') return false;
  return !beltEndpointBlocked(c.state, piece, pos, c.me);
}

function circ(a: number, b: number, n: number): number {
  const d = Math.abs(a - b);
  return Math.min(d, n - d);
}

function seam(c: Ctx, piece: BoardPiece, pos: number): { piece: BoardPiece; pos: number } | null {
  return adjAt(piece.coord, piece.rotation ?? 0, pos, c.state.board);
}

/** What material a seam point supplies to `me`, if it is a source (a Mine ore exit or my building's output). */
// An output with a teleporter carries nothing onto a belt: only the teleporter drains it (#53).
function sourceMaterial(c: Ctx, n: { piece: BoardPiece; pos: number }): Material | null {
  const role = getRole(n.piece, n.pos);
  if (role === 'ore_output') return 'ore';
  if (role === 'output_buffer' && owns(n.piece, c.me) && !teleporterCutsOff(n.piece, 'output')) return PRODUCT[n.piece.type] ?? null;
  return null;
}

/** An input that carries a teleporter takes nothing from a belt (#53, per input since #55). */
function teleportedInput(piece: BoardPiece, pos: number): boolean {
  return teleporterCutsOff(piece, 'input', inputIndexAt(piece, pos));
}

interface Node { pieceId: string; pos: number; cost: number }

/**
 * The fewest-belt route that brings one of `materials` to input point `destPos` of `dest`,
 * from any Mine ore exit or any output of `me`'s buildings (not `dest` itself), or null.
 */
export function routeToInput(
  state: GameState, me: PlayerId, dest: BoardPiece, destPos: number,
  materials: readonly Material[], maxBelts: number,
): PlannedRoute | null {
  if (maxBelts < 1) return null;
  if (teleportedInput(dest, destPos)) return null; // a belt there would carry nothing
  const c = ctxOf(state, me);
  const parent = new Map<string, { belt?: BeltPlacement; parentKey: string | null; material: Material; source: string }>();
  const queue: Node[] = [];
  const key = (id: string, pos: number): string => `${id}:${pos}`;

  for (const piece of state.board) {
    if (piece.type === 'mine') continue;
    for (const pos of c.beltPts.get(piece.id) ?? []) {
      if (!usable(c, piece, pos)) continue;
      const n = seam(c, piece, pos);
      if (!n || n.piece.id === dest.id) continue;
      const mat = sourceMaterial(c, n);
      if (!mat || !materials.includes(mat)) continue;
      const k = key(piece.id, pos);
      if (parent.has(k)) continue;
      parent.set(k, { parentKey: null, material: mat, source: n.piece.id });
      queue.push({ pieceId: piece.id, pos, cost: 0 });
    }
  }
  // The open end of one of my belt chains that already carries material is a source too, so a
  // route laid over several steps (or turns) is continued rather than started again.
  for (const end of chainEnds(c)) {
    if (!materials.includes(end.material) || end.sourcePieceId === dest.id) continue;
    const k = key(end.piece.id, end.pos);
    if (parent.has(k)) continue;
    parent.set(k, { parentKey: null, material: end.material, source: end.sourcePieceId });
    queue.push({ pieceId: end.piece.id, pos: end.pos, cost: 0 });
  }

  let head = 0;
  while (head < queue.length) {
    const node = queue[head++]!;
    if (node.cost + 1 > maxBelts) continue;
    const piece = c.byId.get(node.pieceId)!;
    const total = pieceTemplate(piece).hexCount * 12;
    const usedHere = consumedOnPiece(parent, key(node.pieceId, node.pos), piece.id);
    if (usedHere.has(node.pos)) continue;
    for (const r of c.beltPts.get(piece.id) ?? []) {
      if (r === node.pos || circ(node.pos, r, total) <= 2) continue;
      if (usedHere.has(r) || !usable(c, piece, r)) continue;
      const belt: BeltPlacement = { pieceId: piece.id, fromPoint: node.pos, toPoint: r };
      const rn = seam(c, piece, r);
      if (!rn) continue;
      if (rn.piece.id === dest.id && rn.pos === destPos) {
        const meta = parent.get(key(node.pieceId, node.pos))!;
        return { belts: unwind(parent, key(node.pieceId, node.pos), belt), material: meta.material, sourcePieceId: meta.source };
      }
      if (rn.piece.type === 'mine' || !usable(c, rn.piece, rn.pos)) continue;
      const rk = key(rn.piece.id, rn.pos);
      if (parent.has(rk)) continue;
      const meta = parent.get(key(node.pieceId, node.pos))!;
      parent.set(rk, { belt, parentKey: key(node.pieceId, node.pos), material: meta.material, source: meta.source });
      queue.push({ pieceId: rn.piece.id, pos: rn.pos, cost: node.cost + 1 });
    }
  }
  return null;
}

interface ChainEnd { piece: BoardPiece; pos: number; material: Material; sourcePieceId: string }

/** The free point just past the far end of each of `me`'s belt chains that a source feeds. */
function chainEnds(c: Ctx): ChainEnd[] {
  const out: ChainEnd[] = [];
  for (const b of c.state.belts) {
    if (b.ownerId !== c.me) continue;
    const piece = c.byId.get(b.pieceId);
    if (!piece) continue;
    for (const [x, y] of [[b.fromPoint, b.toPoint], [b.toPoint, b.fromPoint]] as const) {
      const f = feedAt(c.state, piece, x, c.me);
      if (!f) continue;
      const n = seam(c, piece, y);
      if (!n || n.piece.type === 'mine' || !usable(c, n.piece, n.pos)) continue;
      out.push({ piece: n.piece, pos: n.pos, material: f.material, sourcePieceId: f.fromPieceId });
    }
  }
  return out;
}

/** Where the chain of belts laid this turn ends (for continuing a long route), if anywhere. */
export function thisTurnChainEnd(state: GameState, me: PlayerId): { piece: BoardPiece; pos: number; length: number } | null {
  const ids = state.beltsPlacedThisTurn;
  if (ids.length === 0) return null;
  const last = state.belts.find(b => b.id === ids[ids.length - 1]);
  if (!last || last.ownerId !== me) return null;
  const piece = state.board.find(p => p.id === last.pieceId);
  if (!piece) return null;
  const n = adjAt(piece.coord, piece.rotation ?? 0, last.toPoint, state.board);
  if (!n || n.piece.type === 'mine') return null;
  return { piece: n.piece, pos: n.pos, length: ids.length };
}

function consumedOnPiece(
  parent: Map<string, { belt?: BeltPlacement; parentKey: string | null }>, startKey: string, pieceId: string,
): Set<number> {
  const used = new Set<number>();
  let k: string | null = startKey;
  while (k !== null) {
    const p = parent.get(k);
    if (!p) break;
    if (p.belt && p.belt.pieceId === pieceId) { used.add(p.belt.fromPoint); used.add(p.belt.toPoint); }
    k = p.parentKey;
  }
  return used;
}

function unwind(
  parent: Map<string, { belt?: BeltPlacement; parentKey: string | null }>, lastKey: string, last: BeltPlacement,
): BeltPlacement[] {
  const belts: BeltPlacement[] = [last];
  let k: string | null = lastKey;
  while (k !== null) {
    const p = parent.get(k);
    if (!p) break;
    if (p.belt) belts.push(p.belt);
    k = p.parentKey;
  }
  return belts.reverse();
}

/**
 * A deliberately long belt route — between `minBelts` and `maxBelts` belts — from a Mine ore
 * exit or one of `me`'s outputs to an input of one of `me`'s buildings, for the Belt Weaver
 * bonus (a chain of 8+ belts joining a Mine and a building, or two buildings). A depth-first
 * search that prefers to wander away from the start, bounded by `budget` expansions so a
 * decision stays fast; null when none is found within the budget.
 */
export function longRoute(
  state: GameState, me: PlayerId, minBelts: number, maxBelts: number, budget = 6000,
  cont: { piece: BoardPiece; pos: number; length: number } | null = null,
): BeltPlacement[] | null {
  // The search reads only the pieces (with their claims and teleporters), the belts and the
  // arguments, so an identical position gives an identical answer: remember recent answers. A
  // failed search costs the whole budget and is otherwise repeated at every step of a turn.
  const key = longRouteKey(state, me, minBelts, maxBelts, budget, cont);
  const hit = longRouteMemo.get(key);
  if (hit !== undefined) return hit === null ? null : [...hit];
  const found = longRouteSearch(state, me, minBelts, maxBelts, budget, cont);
  if (longRouteMemo.size >= 256) longRouteMemo.clear();
  longRouteMemo.set(key, found === null ? null : [...found]);
  return found;
}

const longRouteMemo = new Map<string, BeltPlacement[] | null>();

function longRouteKey(
  state: GameState, me: PlayerId, minBelts: number, maxBelts: number, budget: number,
  cont: { piece: BoardPiece; pos: number; length: number } | null,
): string {
  const parts: string[] = [`${me}|${minBelts}|${maxBelts}|${budget}|${cont ? `${cont.piece.id}:${cont.pos}:${cont.length}` : '-'}`];
  for (const p of state.board) {
    parts.push(`${p.id}@${p.coord.q},${p.coord.r},${p.rotation ?? 0}:${p.claims.map(c => c.ownerId).join('')}:${JSON.stringify(p.input?.teleporters ?? [])}${JSON.stringify(p.output?.teleporters ?? [])}`);
  }
  for (const b of state.belts) parts.push(`${b.ownerId}${b.pieceId}:${b.fromPoint}-${b.toPoint}`);
  return parts.join(';');
}

function longRouteSearch(
  state: GameState, me: PlayerId, minBelts: number, maxBelts: number, budget: number,
  cont: { piece: BoardPiece; pos: number; length: number } | null,
): BeltPlacement[] | null {
  const c = ctxOf(state, me);
  const destKeys = new Set<string>();
  for (const p of state.board) {
    if (p.type === 'mine' || p.type === 'blank' || !owns(p, me) || !p.input) continue;
    for (const pt of pieceTemplate(p).points) {
      if (pt.enabled && pt.role === 'input_buffer' && !teleportedInput(p, pt.position)) destKeys.add(`${p.id}:${pt.position}`);
    }
  }
  if (destKeys.size === 0) return null;

  const starts: Array<{ piece: BoardPiece; pos: number; src: string }> = [];
  // Continue the chain begun this turn: its end is the only start, and its belts count.
  const offset = cont ? cont.length : 0;
  if (cont && usable(c, cont.piece, cont.pos)) starts.push({ piece: cont.piece, pos: cont.pos, src: '' });
  for (const piece of cont ? [] : state.board) {
    if (piece.type === 'mine') continue;
    for (const pos of c.beltPts.get(piece.id) ?? []) {
      if (!usable(c, piece, pos)) continue;
      const n = seam(c, piece, pos);
      if (!n || !sourceMaterial(c, n)) continue;
      starts.push({ piece, pos, src: n.piece.id });
    }
  }

  let steps = 0;
  const path: BeltPlacement[] = [];
  const usedPts = new Set<string>();
  const visitedPieces = new Map<string, number>();

  const dfs = (piece: BoardPiece, pos: number, src: string): boolean => {
    if (++steps > budget) return false;
    const total = pieceTemplate(piece).hexCount * 12;
    const options: Array<{ r: number; rn: { piece: BoardPiece; pos: number } }> = [];
    for (const r of c.beltPts.get(piece.id) ?? []) {
      if (r === pos || circ(pos, r, total) <= 2) continue;
      if (usedPts.has(`${piece.id}:${r}`) || !usable(c, piece, r)) continue;
      const rn = seam(c, piece, r);
      if (!rn) continue;
      options.push({ r, rn });
    }
    // Wander: prefer pieces not yet visited.
    options.sort((a, b) => (visitedPieces.get(a.rn.piece.id) ?? 0) - (visitedPieces.get(b.rn.piece.id) ?? 0));
    for (const { r, rn } of options) {
      const belt: BeltPlacement = { pieceId: piece.id, fromPoint: pos, toPoint: r };
      const len = offset + path.length + 1;
      if (destKeys.has(`${rn.piece.id}:${rn.pos}`) && rn.piece.id !== src) {
        if (len >= minBelts) { path.push(belt); return true; }
        continue;
      }
      if (len >= maxBelts || rn.piece.type === 'mine' || !usable(c, rn.piece, rn.pos)) continue;
      const k = `${rn.piece.id}:${rn.pos}`;
      if (usedPts.has(k)) continue;
      path.push(belt);
      usedPts.add(`${piece.id}:${pos}`); usedPts.add(`${piece.id}:${r}`); usedPts.add(k);
      visitedPieces.set(rn.piece.id, (visitedPieces.get(rn.piece.id) ?? 0) + 1);
      if (dfs(rn.piece, rn.pos, src)) return true;
      visitedPieces.set(rn.piece.id, (visitedPieces.get(rn.piece.id) ?? 1) - 1);
      usedPts.delete(`${piece.id}:${pos}`); usedPts.delete(`${piece.id}:${r}`); usedPts.delete(k);
      path.pop();
      if (steps > budget) return false;
    }
    return false;
  };

  for (const s of starts) {
    usedPts.clear(); visitedPieces.clear(); path.length = 0;
    usedPts.add(`${s.piece.id}:${s.pos}`);
    visitedPieces.set(s.piece.id, 1);
    if (dfs(s.piece, s.pos, s.src)) return [...path];
    if (steps > budget) break;
  }
  return null;
}
