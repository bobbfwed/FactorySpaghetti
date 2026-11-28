// Belt routing — the one real algorithm shared by the smart bot and (later) a human
// "route from A to B" helper. Pure & deterministic.
//
// Goal: given a SOURCE output (a mine ore-output or a building output buffer) and a
// DEST input buffer, find the cheapest set of belt placements that carries material
// from source to dest, where "cheapest" = fewest belts. Returns null if unroutable.
//
// Model (from the rules):
//   • A belt links two belt points ON ONE piece, with circular distance > 2.
//   • Material crosses a shared edge between the two *aligned* points of touching pieces
//     (this "seam" is free — no belt). adjAt() computes the aligned neighbour.
//   • So a route is: source → (seam) → belt-point → [belt] → belt-point → (seam) →
//     belt-point → … → [belt] → belt-point → (seam) → dest. Each [belt] costs 1.
// A breadth-first search over belt points therefore yields the minimum belt count.
//
// Constraints honoured (rules): belts only on enabled belt points; > 2 apart; a point
// already used by an existing belt is unavailable; belt points facing an input or output of
// a building claimed only by other players are off-limits (reserved), as are points facing
// another player's belt; so you can't feed a building you hold no claim on once it's claimed.
//
// NOTE: adjAt() is only ever evaluated FROM a belt point (always on a non-mine piece) or
// from the destination building — never from a mine, where its geometry doesn't apply.

import type { GameState, BoardPiece, PlayerId } from './state';
import { pieceTemplate } from './config';
import { adjAt, getRole, beltEndpointBlocked } from './rules/flow';

export interface RoutePoint {
  readonly pieceId: string;
  readonly position: number;
}

export interface BeltPlacement {
  readonly pieceId: string;
  readonly fromPoint: number;
  readonly toPoint: number;
}

export interface Route {
  readonly belts: ReadonlyArray<BeltPlacement>;
  readonly cost: number; // number of belts (belts.length)
}

// ── source/destination enumeration (for the UI route picker) ──────────────────

// Every point a belt route may originate from: any mine ore-output (neutral) or an
// output buffer on a building `me` owns.
export function routeSources(state: GameState, me: PlayerId): RoutePoint[] {
  const out: RoutePoint[] = [];
  for (const piece of state.board) {
    const mine = piece.type === 'mine';
    const owned = piece.claims.some(c => c.ownerId === me);
    for (const pt of pieceTemplate(piece).points) {
      if (!pt.enabled) continue;
      if (pt.role === 'ore_output' && mine) out.push({ pieceId: piece.id, position: pt.position });
      else if (pt.role === 'output_buffer' && owned) out.push({ pieceId: piece.id, position: pt.position });
    }
  }
  return out;
}

// Every input-buffer point on a building `me` owns (a route's possible destination).
export function routeDests(state: GameState, me: PlayerId): RoutePoint[] {
  const out: RoutePoint[] = [];
  for (const piece of state.board) {
    if (!piece.claims.some(c => c.ownerId === me)) continue;
    for (const pt of pieceTemplate(piece).points) {
      if (pt.enabled && pt.role === 'input_buffer') out.push({ pieceId: piece.id, position: pt.position });
    }
  }
  return out;
}

// Every belt connection point `me` could currently place a belt on (the route picker
// highlights all of these): an enabled belt point that isn't already used by a belt and
// isn't blocked (joining an opponent's belt / a point reserved for a building's owners). The player picks any
// two of these and findBeltPath fills in the belts between them.
export function usableBeltPoints(state: GameState, me: PlayerId): RoutePoint[] {
  const out: RoutePoint[] = [];
  for (const piece of state.board) {
    for (const pt of pieceTemplate(piece).points) {
      if (pt.enabled && pt.role === 'belt' && usableBeltPoint(state, piece, pt.position, me)) {
        out.push({ pieceId: piece.id, position: pt.position });
      }
    }
  }
  return out;
}

// ── small helpers ───────────────────────────────────────────────────────────

function pieceById(state: GameState, id: string): BoardPiece | undefined {
  return state.board.find(p => p.id === id);
}

function totalPositions(piece: BoardPiece): number {
  return pieceTemplate(piece).hexCount * 12;
}

function circularDistance(a: number, b: number, n: number): number {
  const d = Math.abs(a - b);
  return Math.min(d, n - d);
}

function beltPositions(piece: BoardPiece): number[] {
  return pieceTemplate(piece).points
    .filter(p => p.enabled && p.role === 'belt')
    .map(p => p.position);
}

// The aligned point on the touching piece across `pos`'s edge (or null at a board edge).
function seam(state: GameState, piece: BoardPiece, pos: number): { piece: BoardPiece; pos: number } | null {
  return adjAt(piece.coord, piece.rotation ?? 0, pos, state.board);
}

// Is this point already used by an existing belt on the piece?
function pointOccupied(state: GameState, pieceId: string, pos: number): boolean {
  return state.belts.some(b => b.pieceId === pieceId && (b.fromPoint === pos || b.toPoint === pos));
}

// A belt point we may attach a belt to right now. Uses the same placement-legality
// predicate as the engine (beltEndpointBlocked) so every route the router returns can
// actually be placed: enabled belt point, not already used, and not joining an opponent's
// belt or using a point reserved for the owners of the building it faces.
function usableBeltPoint(state: GameState, piece: BoardPiece, pos: number, me: PlayerId): boolean {
  const def = pieceTemplate(piece).points.find(p => p.position === pos);
  if (!def || def.role !== 'belt' || !def.enabled) return false;
  if (pointOccupied(state, piece.id, pos)) return false;
  if (beltEndpointBlocked(state, piece, pos, me)) return false;
  return true;
}

// Points on `pieceId` already used by belts earlier in the CURRENT search path (walk the
// parent chain). `pointOccupied` only sees pre-existing belts; this catches a route that
// loops back onto a piece and would otherwise place a second belt reusing a point it already
// used there — which the engine rejects as POINT_OCCUPIED. One belt per point per piece.
function consumedOnPiece(
  parent: Map<string, { belt?: BeltPlacement; parentKey: string | null }>,
  startKey: string,
  pieceId: string,
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

// ── findRoute ─────────────────────────────────────────────────────────────────

/**
 * Cheapest (fewest-belt) belt route carrying material from `source` (a mine ore-output
 * or building output buffer) to `dest` (a building input buffer) for `me`.
 * Returns the ordered belt placements + count, a 0-belt route if already directly
 * adjacent, or null if no route exists within `maxBelts`.
 */
export function findRoute(
  state: GameState,
  source: RoutePoint,
  dest: RoutePoint,
  me: PlayerId,
  maxBelts: number = Infinity,
): Route | null {
  const srcPiece = pieceById(state, source.pieceId);
  const destPiece = pieceById(state, dest.pieceId);
  if (!srcPiece || !destPiece) return null;

  // dest must be an input buffer; source must be an ore/output source.
  if (getRole(destPiece, dest.position) !== 'input_buffer') return null;
  const srcRole = getRole(srcPiece, source.position);
  if (srcRole !== 'ore_output' && srcRole !== 'output_buffer') return null;

  // Can't feed another player's building (its input points are reserved for its owner).
  if (destPiece.claims.length > 0 && !destPiece.claims.some(c => c.ownerId === me)) return null;

  const isSource = (n: { piece: BoardPiece; pos: number }) =>
    n.piece.id === source.pieceId && n.pos === source.position;
  const isDest = (n: { piece: BoardPiece; pos: number }) =>
    n.piece.id === dest.pieceId && n.pos === dest.position;

  // 0 belts: the source output already directly faces the dest input. Checked from the
  // dest side because adjAt must run from a non-mine piece, and dest is always a building.
  const destSeam = seam(state, destPiece, dest.position);
  if (destSeam && isSource(destSeam)) return { belts: [], cost: 0 };

  if (maxBelts < 1) return null;

  const key = (pieceId: string, pos: number) => `${pieceId}:${pos}`;
  interface Node { pieceId: string; pos: number; cost: number }
  const visited = new Set<string>();
  const parent = new Map<string, { belt?: BeltPlacement; parentKey: string | null }>();
  const queue: Node[] = [];

  // Entry belt points: belt points whose seam faces the source.
  for (const piece of state.board) {
    if (piece.type === 'mine') continue; // mines have no belt points
    for (const pos of beltPositions(piece)) {
      if (!usableBeltPoint(state, piece, pos, me)) continue;
      const n = seam(state, piece, pos);
      if (!n || !isSource(n)) continue;
      const k = key(piece.id, pos);
      if (visited.has(k)) continue;
      visited.add(k);
      parent.set(k, { parentKey: null });
      queue.push({ pieceId: piece.id, pos, cost: 0 });
    }
  }

  // BFS: each step places one belt (entry → exit) on the current piece, then the exit's
  // seam either reaches the dest or becomes the next piece's entry point.
  while (queue.length > 0) {
    const node = queue.shift()!;
    if (node.cost + 1 > maxBelts) continue;
    const piece = pieceById(state, node.pieceId)!;
    const total = totalPositions(piece);
    // Points this route already used on THIS piece — never place a belt reusing one.
    const usedHere = consumedOnPiece(parent, key(node.pieceId, node.pos), piece.id);
    if (usedHere.has(node.pos)) continue; // entry point already consumed → can't start a belt here

    for (const r of beltPositions(piece)) {
      if (r === node.pos) continue;
      if (circularDistance(node.pos, r, total) <= 2) continue;
      if (!usableBeltPoint(state, piece, r, me)) continue;
      if (usedHere.has(r)) continue; // toPoint already used by an earlier belt on this piece

      const belt: BeltPlacement = { pieceId: piece.id, fromPoint: node.pos, toPoint: r };
      const rn = seam(state, piece, r);
      if (!rn) continue;

      if (isDest(rn)) {
        return buildRoute(parent, key(node.pieceId, node.pos), belt, node.cost + 1);
      }
      if (rn.piece.type === 'mine') continue; // can't continue a belt onto a mine
      if (!usableBeltPoint(state, rn.piece, rn.pos, me)) continue;

      const rk = key(rn.piece.id, rn.pos);
      if (visited.has(rk)) continue;
      visited.add(rk);
      parent.set(rk, { belt, parentKey: key(node.pieceId, node.pos) });
      queue.push({ pieceId: rn.piece.id, pos: rn.pos, cost: node.cost + 1 });
    }
  }

  return null;
}

function buildRoute(
  parent: Map<string, { belt?: BeltPlacement; parentKey: string | null }>,
  lastEntryKey: string,
  finalBelt: BeltPlacement,
  cost: number,
): Route {
  const belts: BeltPlacement[] = [finalBelt];
  let k: string | null = lastEntryKey;
  while (k !== null) {
    const p = parent.get(k);
    if (!p) break;
    if (p.belt) belts.push(p.belt);
    k = p.parentKey;
  }
  belts.reverse();
  return { belts, cost };
}

// ── findBeltPath ──────────────────────────────────────────────────────────────

/**
 * Cheapest (fewest-belt) belt path connecting two belt connection points. Both must be
 * usable belt points (the kind usableBeltPoints returns). The first belt uses `from`, the
 * last uses `to`; intermediate belts chain across piece seams. Returns the ordered belt
 * placements + count, or null if unconnectable within `maxBelts`.
 *
 * This is the human picker's primitive: the player clicks two belt points (typically next
 * to a source and an input) and this fills in the belts between them.
 */
export function findBeltPath(
  state: GameState,
  from: RoutePoint,
  to: RoutePoint,
  me: PlayerId,
  maxBelts: number = Infinity,
): Route | null {
  const fromPiece = pieceById(state, from.pieceId);
  const toPiece = pieceById(state, to.pieceId);
  if (!fromPiece || !toPiece) return null;
  if (from.pieceId === to.pieceId && from.position === to.position) return null;
  if (!usableBeltPoint(state, fromPiece, from.position, me)) return null;
  if (!usableBeltPoint(state, toPiece, to.position, me)) return null;
  if (maxBelts < 1) return null;

  const key = (pieceId: string, pos: number) => `${pieceId}:${pos}`;
  interface Node { pieceId: string; pos: number; cost: number }
  const visited = new Set<string>([key(from.pieceId, from.position)]);
  const parent = new Map<string, { belt?: BeltPlacement; parentKey: string | null }>();
  parent.set(key(from.pieceId, from.position), { parentKey: null });
  const queue: Node[] = [{ pieceId: from.pieceId, pos: from.position, cost: 0 }];

  while (queue.length > 0) {
    const node = queue.shift()!;
    if (node.cost + 1 > maxBelts) continue;
    const piece = pieceById(state, node.pieceId)!;
    const total = totalPositions(piece);
    // Points this path already used on THIS piece — never place a belt reusing one.
    const usedHere = consumedOnPiece(parent, key(node.pieceId, node.pos), piece.id);
    if (usedHere.has(node.pos)) continue; // entry point already consumed → can't start a belt here

    for (const c of beltPositions(piece)) {
      if (c === node.pos) continue;
      if (circularDistance(node.pos, c, total) <= 2) continue;
      if (!usableBeltPoint(state, piece, c, me)) continue;
      if (usedHere.has(c)) continue; // toPoint already used by an earlier belt on this piece

      const belt: BeltPlacement = { pieceId: piece.id, fromPoint: node.pos, toPoint: c };
      if (piece.id === to.pieceId && c === to.position) {
        return buildRoute(parent, key(node.pieceId, node.pos), belt, node.cost + 1);
      }
      const n = seam(state, piece, c);
      if (!n || n.piece.type === 'mine') continue; // dead edge / can't belt onto a mine
      if (!usableBeltPoint(state, n.piece, n.pos, me)) continue;

      const nk = key(n.piece.id, n.pos);
      if (visited.has(nk)) continue;
      visited.add(nk);
      parent.set(nk, { belt, parentKey: key(node.pieceId, node.pos) });
      queue.push({ pieceId: n.piece.id, pos: n.pos, cost: node.cost + 1 });
    }
  }

  return null;
}
