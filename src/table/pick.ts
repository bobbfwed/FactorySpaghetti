// Resolving taps into Targets, and finding where a Target is on the table. Pure maths on the
// layout (no Three.js), so it can be tested without WebGL.

import type { BoardPiece, GameState } from '../engine/state';
import type { Target } from './types';
import {
  BELT_THICKNESS, CARD, HEX_RADIUS, APOTHEM, TELEPORTER_HEIGHT, TELEPORTER_SCALE, TILE_TOP, beltCurve, bezierAt,
  bufferAnchorWorld, bufferSlotWorld, distanceToCurve, mineSlotWorld, pieceCells, piecePlacement, pointCount, pointRole,
  pointWorld, portalWorld, teleporterPlacement, worldToAxial, axialToWorld, type SideLayout,
} from './layout';
import { teleporterOn } from '../engine/rules/teleporters';

export interface V3 { readonly x: number; readonly y: number; readonly z: number }

/** Height at which belts are hit-tested and anchored (the chain lies 1.5 mm thick on the tile; its pegs are in the holes). */
export const BELT_PICK_Y = TILE_TOP + BELT_THICKNESS;
/** Height at which teleporters are hit-tested: half-way up the model as drawn. */
export const TELEPORTER_PICK_Y = TILE_TOP + (TELEPORTER_HEIGHT * TELEPORTER_SCALE) / 2;

/** Heights of things beside the board (they change with the state). */
export interface SideHeights {
  stackTop(i: number): number;
  pile(which: 'deck' | 'discard'): number;
}

export function targetKey(t: Target): string {
  switch (t.kind) {
    case 'cell': return `cell:${t.q},${t.r}`;
    case 'piece': return `piece:${t.pieceId}`;
    case 'point': return `point:${t.pieceId}:${t.point}`;
    case 'buffer': return `buffer:${t.pieceId}:${t.buffer}${t.slot === undefined ? '' : `:${t.slot}`}`;
    case 'mineSlot': return `mineSlot:${t.pieceId}:${t.slot}`;
    case 'belt': return `belt:${t.beltId}`;
    case 'stack': return `stack:${t.index}`;
    case 'deck': return 'deck';
  }
}

export function pieceAt(board: ReadonlyArray<BoardPiece>, q: number, r: number): BoardPiece | null {
  return board.find(p => pieceCells(p).some(c => c.q === q && c.r === r)) ?? null;
}

interface Candidate { target: Target; score: number }

// Pick radii (mm). A score is distance / radius; the lowest wins, the piece itself scores 1.
const R_POINT = 4.5;
const R_BELT = 3.5;
const R_BUFFER = 7.5;
const R_SLOT = 12;

/**
 * Everything on the board that a tap at table point (x, z) could mean, most specific first.
 * `beltAt` is where the same tap ray crosses belt mid-height (belts stand ~5 mm proud of the tile,
 * so in a tilted view that is a few millimetres from (x, z)); defaults to (x, z). `teleporterAt`
 * is where it crosses TELEPORTER_PICK_Y, half-way up a teleporter; defaults to (x, z).
 */
export function boardCandidates(
  game: Pick<GameState, 'board' | 'belts'>, x: number, z: number, beltAt: { x: number; z: number } = { x, z },
  teleporterAt: { x: number; z: number } = { x, z },
): Candidate[] {
  const cell = worldToAxial(x, z);
  const piece = pieceAt(game.board, cell.q, cell.r);
  if (!piece) return [{ target: { kind: 'cell', q: cell.q, r: cell.r }, score: 1 }];
  const out: Candidate[] = [];
  for (let pos = 0; pos < pointCount(piece); pos++) {
    const role = pointRole(piece, pos);
    if (role === 'disabled') continue;
    const p = pointWorld(piece, pos);
    const d = Math.hypot(p.x - x, p.z - z);
    // Input/output points sit right next to their buffer's material; the buffer wins unless the
    // tap is on the hole itself.
    const bias = role === 'input_buffer' || role === 'output_buffer' ? 0.2 : 0;
    if (d < R_POINT) out.push({ target: { kind: 'point', pieceId: piece.id, point: pos }, score: d / R_POINT + bias });
  }
  for (const b of game.belts) {
    if (b.pieceId !== piece.id) continue;
    const d = distanceToCurve(beltCurve(piece, b.fromPoint, b.toPoint), beltAt.x, beltAt.z);
    if (d < R_BELT) out.push({ target: { kind: 'belt', beltId: b.id }, score: d / R_BELT + 0.05 });
  }
  for (const which of ['input', 'output'] as const) {
    const buf = which === 'input' ? piece.input : piece.output;
    if (!buf || piece.type === 'mine') continue;
    // The buffer's own anchor (between its slots, used for popovers) counts too.
    const anchor = bufferAnchorWorld(piece, which);
    let best = Math.hypot(anchor.x - x, anchor.z - z);
    for (let i = 0; i < buf.slots.length; i++) {
      const s = bufferSlotWorld(piece, which, i);
      // A teleporter stands on the stub of its own input (or of the output), its material beside
      // it; a tap on either means that input. It is hit-tested where the tap ray crosses its mid-height.
      const t = teleporterOn(buf, i) !== null ? teleporterPlacement(piece, which, i) : null;
      const d = Math.min(Math.hypot(s.x - x, s.z - z), t ? Math.hypot(t.x - teleporterAt.x, t.z - teleporterAt.z) : Infinity);
      best = Math.min(best, d);
      // Each input is also a target of its own (where a teleporter goes, #55). It ranks just after
      // the whole buffer, so it is picked where it is lit (a current target wins) and the buffer
      // otherwise, as before.
      if (which === 'input' && d < R_BUFFER) {
        out.push({ target: { kind: 'buffer', pieceId: piece.id, buffer: which, slot: i }, score: d / R_BUFFER + 0.11 });
      }
    }
    if (best < R_BUFFER) out.push({ target: { kind: 'buffer', pieceId: piece.id, buffer: which }, score: best / R_BUFFER + 0.1 });
  }
  if (piece.type === 'mine') {
    for (const slot of [0, 1]) {
      const s = mineSlotWorld(piece, slot);
      const d = Math.hypot(s.x - x, s.z - z);
      if (d < R_SLOT) out.push({ target: { kind: 'mineSlot', pieceId: piece.id, slot }, score: d / R_SLOT + 0.1 });
    }
  }
  out.push({ target: { kind: 'piece', pieceId: piece.id }, score: 1 });
  return out.sort((a, b) => a.score - b.score);
}

/** Pick one: a candidate that is a current target wins; otherwise the most specific one. */
export function choose(cands: readonly Candidate[], targets: ReadonlySet<string>): Target | null {
  if (cands.length === 0) return null;
  if (targets.size > 0) {
    const hit = cands.find(c => targets.has(targetKey(c.target)));
    if (hit) return hit.target;
  }
  return cands[0]!.target;
}

/** Axis-aligned boxes of the things beside the board, for ray picking. */
export function sideBoxes(side: SideLayout, h: SideHeights, game: Pick<GameState, 'stacks'>): Array<{ target: Target; min: V3; max: V3 }> {
  const boxes: Array<{ target: Target; min: V3; max: V3 }> = [];
  side.stacks.forEach((s, i) => {
    if (!game.stacks[i]) return;
    const top = Math.max(h.stackTop(i), TILE_TOP);
    boxes.push({ target: { kind: 'stack', index: i }, min: { x: s.x - APOTHEM, y: 0, z: s.z - HEX_RADIUS }, max: { x: s.x + APOTHEM, y: top, z: s.z + HEX_RADIUS } });
  });
  const d = side.deck;
  boxes.push({ target: { kind: 'deck' }, min: { x: d.x - CARD.w / 2, y: 0, z: d.z - CARD.d / 2 }, max: { x: d.x + CARD.w / 2, y: h.pile('deck'), z: d.z + CARD.d / 2 } });
  return boxes;
}

/** Distance along the ray to an axis-aligned box, or null when it misses. */
export function rayBox(o: V3, dir: V3, min: V3, max: V3): number | null {
  let t0 = -Infinity, t1 = Infinity;
  for (const k of ['x', 'y', 'z'] as const) {
    if (Math.abs(dir[k]) < 1e-12) {
      if (o[k] < min[k] || o[k] > max[k]) return null;
      continue;
    }
    let a = (min[k] - o[k]) / dir[k], b = (max[k] - o[k]) / dir[k];
    if (a > b) [a, b] = [b, a];
    t0 = Math.max(t0, a);
    t1 = Math.min(t1, b);
    if (t0 > t1) return null;
  }
  return t1 < 0 ? null : Math.max(0, t0);
}

/** Where a target is on the table (for popovers and glow), or null if it does not exist. */
export function targetAnchor(game: GameState | null, side: SideLayout, h: SideHeights, t: Target): V3 | null {
  if (t.kind === 'cell') {
    const c = axialToWorld({ q: t.q, r: t.r });
    return { x: c.x, y: 0, z: c.z };
  }
  if (t.kind === 'stack') {
    const s = side.stacks[t.index];
    return s ? { x: s.x, y: h.stackTop(t.index), z: s.z } : null;
  }
  if (t.kind === 'deck') return { x: side.deck.x, y: h.pile('deck'), z: side.deck.z };
  if (!game) return null;
  if (t.kind === 'belt') {
    const b = game.belts.find(x => x.id === t.beltId);
    const piece = b && game.board.find(p => p.id === b.pieceId);
    if (!b || !piece) return null;
    const m = bezierAt(beltCurve(piece, b.fromPoint, b.toPoint), 0.5);
    return { x: m.x, y: BELT_PICK_Y, z: m.z };
  }
  const piece = game.board.find(p => p.id === t.pieceId);
  if (!piece) return null;
  switch (t.kind) {
    case 'piece': {
      const pl = piecePlacement(piece);
      return { x: pl.x, y: TILE_TOP, z: pl.z };
    }
    case 'point': {
      if (t.point < 0 || t.point >= pointCount(piece)) return null;
      const p = pointWorld(piece, t.point);
      return { x: p.x, y: TILE_TOP, z: p.z };
    }
    case 'buffer': {
      const buf = t.buffer === 'input' ? piece.input : piece.output;
      if (!buf) return null;
      if (t.slot !== undefined && (t.slot < 0 || t.slot >= buf.slots.length)) return null;
      if (t.portal) return portalWorld(piece, t.buffer, t.slot ?? 0);
      const p = t.slot === undefined ? bufferAnchorWorld(piece, t.buffer) : bufferSlotWorld(piece, t.buffer, t.slot);
      return { x: p.x, y: TILE_TOP + 3, z: p.z };
    }
    case 'mineSlot': {
      if (piece.type !== 'mine') return null;
      const p = mineSlotWorld(piece, t.slot);
      return { x: p.x, y: TILE_TOP, z: p.z };
    }
  }
}
