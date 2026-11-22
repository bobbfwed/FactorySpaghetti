// Planning a belt route: any two points, the shortest chain between them whatever it costs, and
// how much of it can be laid now. Every rule comes from the engine: the end points from
// legalActions, the chain from findBeltPath, what fits in the supply and what can be bought from
// applyAction dry-runs. Nothing here prices or validates anything itself.

import type { Action, PlaceBeltAction, RulesError } from '../engine/actions';
import type { BoardPiece, GameState, PlayerId } from '../engine/state';
import { pieceTemplate } from '../engine/config';
import { applyAction, legalActions } from '../engine/reducer';
import { adjAt, beltEndpointBlocked } from '../engine/rules/flow';
import { findBeltPath, type RoutePoint } from '../engine/routing';

/** One belt of a route: on which piece, between which two connection points. */
export interface Seg { readonly pieceId: string; readonly from: number; readonly to: number }
/** own: from the supply; buy: can be bought now; cant: neither, yet. */
export type Tier = 'own' | 'buy' | 'cant';
export interface RouteSeg extends Seg { readonly tier: Tier }

/** Belts in the supply for planning (more than any route on the board can use). */
const PLAN_BELTS = 999;

const planCache = new WeakMap<GameState, Map<PlayerId, GameState>>();

/**
 * The state as if `me` had all the belts they could want and no Mine belt yet this turn: what a
 * route could use some day. Only for asking the engine; never sent anywhere.
 */
export function planningState(g: GameState, me: PlayerId): GameState {
  let m = planCache.get(g);
  if (!m) { m = new Map(); planCache.set(g, m); }
  let s = m.get(me);
  if (!s) {
    s = {
      ...g,
      mineBeltPlacedThisTurn: false,
      players: g.players.map(p => (p.id === me ? { ...p, beltsRemaining: PLAN_BELTS } : p)),
    };
    m.set(me, s);
  }
  return s;
}

const key = (p: RoutePoint): string => `${p.pieceId}:${p.position}`;
const endsCache = new WeakMap<GameState, Map<PlayerId, RoutePoint[]>>();

/** Every point where a belt of mine could end if I had belts enough (from legalActions). */
export function routeEnds(g: GameState, me: PlayerId): RoutePoint[] {
  let m = endsCache.get(g);
  if (!m) { m = new Map(); endsCache.set(g, m); }
  const hit = m.get(me);
  if (hit) return hit;
  const seen = new Map<string, RoutePoint>();
  for (const a of legalActions(planningState(g, me), me)) {
    if (a.type !== 'PLACE_BELT') continue;
    for (const position of [a.fromPoint, a.toPoint]) {
      const p = { pieceId: a.pieceId, position };
      seen.set(key(p), p);
    }
  }
  const out = [...seen.values()];
  m.set(me, out);
  return out;
}

/** The shortest chain of belts from `start` to `end`, whatever it costs; null when there is none. */
export function planRoute(g: GameState, me: PlayerId, start: RoutePoint, end: RoutePoint): Seg[] | null {
  const r = findBeltPath(planningState(g, me), start, end, me);
  if (!r || r.cost === 0) return null;
  return r.belts.map(b => ({ pieceId: b.pieceId, from: b.fromPoint, to: b.toPoint }));
}

const reachCache = new WeakMap<GameState, Map<string, RoutePoint[]>>();

/**
 * The ends a route from `start` can reach: exactly the ends for which findBeltPath finds a path,
 * worked out in one search instead of one search per end (about 100 times faster on a big board).
 * Cached per state, player and start.
 */
export function reachableEnds(g: GameState, me: PlayerId, start: RoutePoint): RoutePoint[] {
  let m = reachCache.get(g);
  if (!m) { m = new Map(); reachCache.set(g, m); }
  const k = `${me}|${key(start)}`;
  const hit = m.get(k);
  if (hit) return hit;
  const reach = beltReach(planningState(g, me), start, me);
  const out = routeEnds(g, me).filter(p => reach.has(key(p)));
  m.set(k, out);
  return out;
}

// ── One search for every end ──────────────────────────────────────────────────
// findBeltPath (engine/routing.ts) is a breadth-first search whose visited set does not depend
// on the target: the target only stops it early. So running the same search to the end and
// collecting every point it could have finished on gives exactly the points findBeltPath can
// reach. This copies its steps using the engine's own exported rules (pieceTemplate, adjAt,
// beltEndpointBlocked); route.test.ts checks the result against findBeltPath end by end, so a
// change in the engine's search shows up there. (Better: the engine exports this search.)

function usablePoint(g: GameState, piece: BoardPiece, pos: number, me: PlayerId): boolean {
  const def = pieceTemplate(piece).points.find(p => p.position === pos);
  if (!def || def.role !== 'belt' || !def.enabled) return false;
  if (g.belts.some(b => b.pieceId === piece.id && (b.fromPoint === pos || b.toPoint === pos))) return false;
  return !beltEndpointBlocked(g, piece, pos, me);
}

/** Every point findBeltPath(g, start, point, me) would find a path to, as `pieceId:position` keys. */
export function beltReach(g: GameState, start: RoutePoint, me: PlayerId): Set<string> {
  const out = new Set<string>();
  const byId = new Map(g.board.map(p => [p.id, p]));
  const first = byId.get(start.pieceId);
  if (!first || !usablePoint(g, first, start.position, me)) return out;
  // Usable points are asked about many times: remember the answers for this search.
  const usableMemo = new Map<string, boolean>();
  const usable = (piece: BoardPiece, pos: number): boolean => {
    const k = `${piece.id}:${pos}`;
    let u = usableMemo.get(k);
    if (u === undefined) { u = usablePoint(g, piece, pos, me); usableMemo.set(k, u); }
    return u;
  };
  interface Link { belt?: { pieceId: string; from: number; to: number }; parent: string | null }
  const startKey = key(start);
  const parent = new Map<string, Link>([[startKey, { parent: null }]]);
  const visited = new Set<string>([startKey]);
  const queue: { pieceId: string; pos: number }[] = [{ pieceId: start.pieceId, pos: start.position }];
  const usedOn = (fromKey: string, pieceId: string): Set<number> => {
    const used = new Set<number>();
    for (let k: string | null = fromKey; k !== null;) {
      const l = parent.get(k);
      if (!l) break;
      if (l.belt && l.belt.pieceId === pieceId) { used.add(l.belt.from); used.add(l.belt.to); }
      k = l.parent;
    }
    return used;
  };
  for (let qi = 0; qi < queue.length; qi++) {
    const node = queue[qi]!;
    const piece = byId.get(node.pieceId)!;
    const tpl = pieceTemplate(piece);
    const total = tpl.hexCount * 12;
    const nodeKey = `${node.pieceId}:${node.pos}`;
    const usedHere = usedOn(nodeKey, piece.id);
    if (usedHere.has(node.pos)) continue;
    for (const pt of tpl.points) {
      if (!pt.enabled || pt.role !== 'belt') continue;
      const c = pt.position;
      if (c === node.pos) continue;
      const d = Math.abs(node.pos - c);
      if (Math.min(d, total - d) <= 2) continue;
      if (!usable(piece, c)) continue;
      if (usedHere.has(c)) continue;
      // findBeltPath would stop here if this were its target.
      out.add(`${piece.id}:${c}`);
      const n = adjAt(piece.coord, piece.rotation ?? 0, c, g.board);
      if (!n || n.piece.type === 'mine') continue;
      if (!usable(n.piece, n.pos)) continue;
      const nk = `${n.piece.id}:${n.pos}`;
      if (visited.has(nk)) continue;
      visited.add(nk);
      parent.set(nk, { belt: { pieceId: piece.id, from: node.pos, to: c }, parent: nodeKey });
      queue.push({ pieceId: n.piece.id, pos: n.pos });
    }
  }
  out.delete(startKey);
  return out;
}

export const placeAction = (s: Seg): PlaceBeltAction => ({ type: 'PLACE_BELT', pieceId: s.pieceId, fromPoint: s.from, toPoint: s.to });

const laid = (g: GameState, me: PlayerId, s: Seg): boolean =>
  g.belts.some(b => b.ownerId === me && b.pieceId === s.pieceId
    && ((b.fromPoint === s.from && b.toPoint === s.to) || (b.fromPoint === s.to && b.toPoint === s.from)));

/** The part of a planned route not yet on the board (in route order). */
export function remaining(g: GameState, me: PlayerId, segs: readonly Seg[]): Seg[] {
  return segs.filter(s => !laid(g, me, s));
}

/**
 * Can the whole (remaining) route still be laid some day: nothing in the way? A plan spans turns,
 * so the once-per-turn limit on belts touching a Mine is reset between its belts.
 */
export function stillPossible(g: GameState, me: PlayerId, segs: readonly Seg[]): boolean {
  let s = planningState(g, me);
  for (const seg of segs) {
    const r = applyAction(s, placeAction(seg));
    if (!r.ok) return false;
    s = { ...r.state, mineBeltPlacedThisTurn: false };
  }
  return true;
}

/** How many belts I can buy now, one after another (asked of the engine, up to `max`). */
export function buyable(g: GameState, max: number): number {
  let s = g, n = 0;
  while (n < max) {
    const r = applyAction(s, { type: 'BUY_BELT' });
    if (!r.ok) break;
    s = r.state;
    n++;
  }
  return n;
}

/** The route split, in order from its start: from the supply, buyable now, and the rest. */
export function tiers(g: GameState, me: PlayerId, segs: readonly Seg[]): RouteSeg[] {
  const have = g.players[me]?.beltsRemaining ?? 0;
  const own = Math.min(have, segs.length);
  const buy = buyable(g, segs.length - own);
  return segs.map((s, i) => ({ ...s, tier: i < own ? 'own' : i < own + buy ? 'buy' : 'cant' }));
}

export interface Placement {
  /** The actions to send, in order (BUY_BELT first, then PLACE_BELT). */
  actions: Action[];
  /** How many belts will be laid. */
  placed: number;
  /** Why the next belt could not be laid, when the plan stops early. */
  refusal: RulesError | null;
}

/**
 * Lay the route from its start: from the supply only, or buying as many as can be bought first.
 * Everything is dry-run in order; a belt the engine refuses stops the placement there.
 */
export function placement(g: GameState, me: PlayerId, segs: readonly Seg[], withBuy: boolean): Placement {
  const t = tiers(g, me, segs);
  const own = t.filter(x => x.tier === 'own').length;
  const buyN = withBuy ? t.filter(x => x.tier === 'buy').length : 0;
  const tryWith = (buys: number, want: number): Placement => {
    const actions: Action[] = [];
    let s = g;
    for (let i = 0; i < buys; i++) {
      const r = applyAction(s, { type: 'BUY_BELT' });
      if (!r.ok) return { actions: [], placed: 0, refusal: r.error };
      s = r.state;
      actions.push({ type: 'BUY_BELT' });
    }
    let placed = 0;
    let refusal: RulesError | null = null;
    for (const seg of segs.slice(0, want)) {
      const a = placeAction(seg);
      const r = applyAction(s, a);
      if (!r.ok) { refusal = r.error; break; }
      s = r.state;
      actions.push(a);
      placed++;
    }
    return { actions, placed, refusal };
  };
  const first = tryWith(buyN, own + buyN);
  // Stopped early: buy only what the belts that can be laid need.
  if (first.placed < own + buyN && buyN > 0) {
    const need = Math.max(0, first.placed - own);
    const again = tryWith(need, first.placed);
    return { ...again, refusal: first.refusal };
  }
  return first;
}
