// Where material travels on the table: from a source (a mine's ore points or a building's output)
// along the chain of belts that touches a building's input, as a polyline in world millimetres.
// Pure geometry on the drawn table (which belts touch which holes); it decides nothing about the
// rules: the engine already moved the material, this only shows the way it went. The one rule it
// needs — a belt end facing a building it may not serve is a dead end — is the engine's own
// predicate (isReservedPoint), so the drawn way never passes where the material could not.

import type { BoardPiece, GameState } from '../engine/state';
import { isReservedPoint } from '../engine/rules/flow';
import {
  beltCurve, bufferSlotWorld, pointWorld, positionsWithRole, sampleCurve, type XZ,
} from './layout';

/** Two connection points closer than this (mm, on the tile edges) are the same hole pair. */
const SAME_POINT_MM = 3;

export interface FlowSource { readonly pieceId: string; readonly kind: 'mine' | 'output'; readonly slot: number }
export interface FlowTrace { readonly source: number; readonly points: XZ[]; readonly belts: number }

type Game = Pick<GameState, 'board' | 'belts'>;

const near = (a: XZ, b: XZ): boolean => Math.hypot(a.x - b.x, a.z - b.z) < SAME_POINT_MM;

/** Where a source's material sits (mine: the rayed disc; building: its output slot). */
export function sourceWorld(game: Game, s: FlowSource): XZ | null {
  const p = game.board.find(b => b.id === s.pieceId);
  if (!p) return null;
  return bufferSlotWorld(p, 'output', s.kind === 'mine' ? 0 : s.slot);
}

function sourcePositions(piece: BoardPiece, kind: 'mine' | 'output'): number[] {
  return positionsWithRole(piece, kind === 'mine' ? 'ore_output' : 'output_buffer');
}

/**
 * The way material reached input `slot` of building `toPieceId` from one of `sources` (the first
 * reachable one, fewest belts first). Null when no source touches it directly or by belts.
 */
export function traceFlow(game: Game, toPieceId: string, slot: number, sources: readonly FlowSource[]): FlowTrace | null {
  const dest = game.board.find(p => p.id === toPieceId);
  if (!dest) return null;
  const inputs = positionsWithRole(dest, 'input_buffer');
  if (inputs.length === 0) return null;
  const destPos = inputs[Math.min(slot, inputs.length - 1)]!;
  const destEdge = pointWorld(dest, destPos, 0);
  const destSlot = bufferSlotWorld(dest, 'input', slot);

  const srcPts: { i: number; p: XZ; piece: BoardPiece; pos: number }[] = [];
  sources.forEach((s, i) => {
    const piece = game.board.find(b => b.id === s.pieceId);
    if (!piece) return;
    for (const pos of sourcePositions(piece, s.kind)) srcPts.push({ i, p: pointWorld(piece, pos, 0), piece, pos });
  });
  const startOf = (i: number): XZ => sourceWorld(game, sources[i]!)!;

  // Directly adjacent: a source hole meets the input hole.
  const direct = srcPts.find(s => near(s.p, destEdge));
  if (direct) return { source: direct.i, points: [startOf(direct.i), destEdge, destSlot], belts: 0 };

  // Belts: each has two ends on tile edges. Walk from the input outwards, breadth first.
  const belts = game.belts.flatMap(b => {
    const piece = game.board.find(p => p.id === b.pieceId);
    return piece ? [{ b, piece, ends: [pointWorld(piece, b.fromPoint, 0), pointWorld(piece, b.toPoint, 0)] as const }] : [];
  });
  interface Node { belt: number; enter: 0 | 1; parent: Node | null }
  const seen = new Set<string>();
  let frontier: Node[] = [];
  // A belt end facing an input or output reserved against the belt's owner (a building with
  // claims, none of them theirs) is a dead end: no material passes there (the engine's rule,
  // isReservedPoint; RULES_CHANGES.md #38).
  belts.forEach((x, k) => {
    if (isReservedPoint(dest, destPos, x.b.ownerId)) return;
    for (const e of [0, 1] as const) {
      if (near(x.ends[e], destEdge)) { frontier.push({ belt: k, enter: e, parent: null }); seen.add(`${k}`); }
    }
  });
  let found: { node: Node; src: number } | null = null;
  for (let depth = 0; depth < 64 && frontier.length > 0 && !found; depth++) {
    const next: Node[] = [];
    for (const n of frontier) {
      const owner = belts[n.belt]!.b.ownerId;
      const out = belts[n.belt]!.ends[n.enter === 0 ? 1 : 0];
      const s = srcPts.find(sp => near(sp.p, out) && !isReservedPoint(sp.piece, sp.pos, owner));
      if (s) { found = { node: n, src: s.i }; break; }
      belts.forEach((x, k) => {
        if (seen.has(`${k}`)) return;
        for (const e of [0, 1] as const) {
          if (near(x.ends[e], out)) { seen.add(`${k}`); next.push({ belt: k, enter: e, parent: n }); return; }
        }
      });
    }
    frontier = next;
  }
  if (!found) return null;

  // Points from the source to the input: the chain is stored input-first, so walk it backwards.
  const points: XZ[] = [startOf(found.src)];
  let n: Node | null = found.node;
  let count = 0;
  while (n) {
    const x = belts[n.belt]!;
    const curve = sampleCurve(beltCurve(x.piece, x.b.fromPoint, x.b.toPoint), 12).pts;
    // The material enters this belt at the end away from the input (`enter` is the input side).
    const ordered = n.enter === 1 ? curve : [...curve].reverse();
    points.push(...ordered);
    n = n.parent;
    count++;
  }
  points.push(destSlot);
  return { source: found.src, points, belts: count };
}

/** Total length of a polyline. */
export function pathLength(points: readonly XZ[]): number {
  let len = 0;
  for (let i = 1; i < points.length; i++) len += Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.z - points[i - 1]!.z);
  return len;
}

/** Point at fraction t (0..1) of a polyline's length. */
export function pointAlong(points: readonly XZ[], t: number): XZ {
  if (points.length === 0) return { x: 0, z: 0 };
  if (points.length === 1 || t <= 0) return points[0]!;
  const total = pathLength(points);
  let target = Math.min(1, t) * total;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!, b = points[i]!;
    const d = Math.hypot(b.x - a.x, b.z - a.z);
    if (target <= d && d > 0) return { x: a.x + (b.x - a.x) * (target / d), z: a.z + (b.z - a.z) * (target / d) };
    target -= d;
  }
  return points[points.length - 1]!;
}
