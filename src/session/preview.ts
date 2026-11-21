// What the active player is considering before they confirm: a board piece (or the dropped Mine)
// at a space and turned some way, or their meeple on a building or a Mine spot. Every other
// player's table shows it, as if watching across a real table.
//
// A preview is NOT game state: it is never in the room, a save, a save link or the move journal,
// never changes the move number, and losing one does no harm. The host passes it on only from
// the active player, only while they are placing a piece, a Mine or their meeple, and only for
// the current move number; anything else is dropped without a word.

import type { GameState } from '../engine/state';

export type Preview =
  // The board piece (or pending Mine) about to be placed, considered at space (q, r), turned rot
  // (0..5). Which piece it is follows from the game state, so it is not sent.
  | { k: 'piece'; q: number; r: number; rot: number }
  // The meeple considered on a building (slot null) or on a Mine spot (slot 0 or 1).
  | { k: 'meeple'; pieceId: string; slot: 0 | 1 | null };

/** A preview message larger than this (as JSON) is refused before anything else is read. */
export const PREVIEW_MAX_BYTES = 300;
/** At most one preview leaves a device, and one is passed on per player, this often (ms). */
export const PREVIEW_INTERVAL_MS = 80;
/** Furthest a previewed space may be from the centre of the table (in either coordinate). */
const MAX_COORD = 64;

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const isInt = (x: unknown, lo: number, hi: number): x is number => typeof x === 'number' && Number.isInteger(x) && x >= lo && x <= hi;
const onlyKeys = (o: Record<string, unknown>, keys: readonly string[]): boolean => Object.keys(o).every(k => keys.includes(k));

/** A preview from another browser, checked strictly: known fields only, in bounds; else null. */
export function normalizePreview(raw: unknown): Preview | null {
  if (!isObj(raw)) return null;
  if (raw.k === 'piece') {
    if (!onlyKeys(raw, ['k', 'q', 'r', 'rot'])) return null;
    if (!isInt(raw.q, -MAX_COORD, MAX_COORD) || !isInt(raw.r, -MAX_COORD, MAX_COORD) || !isInt(raw.rot, 0, 5)) return null;
    return { k: 'piece', q: raw.q, r: raw.r, rot: raw.rot };
  }
  if (raw.k === 'meeple') {
    if (!onlyKeys(raw, ['k', 'pieceId', 'slot'])) return null;
    if (typeof raw.pieceId !== 'string' || raw.pieceId.length === 0 || raw.pieceId.length > 64) return null;
    if (raw.slot !== null && raw.slot !== 0 && raw.slot !== 1) return null;
    return { k: 'meeple', pieceId: raw.pieceId, slot: raw.slot };
  }
  return null;
}

/** True when `seat` may show a preview in `game` now: the active player, placing a piece, a Mine or their meeple. */
export function mayPreview(game: GameState, seat: number): boolean {
  if (game.gameOver || game.pendingFactoryOps.length > 0) return false;
  if (game.turnOrder[game.activePlayerIndex] !== seat) return false;
  return game.phase === 'placePiece' || game.phase === 'placeMeeple';
}

/** The size of a message as JSON (for the limit above); Infinity when it cannot be written. */
export function jsonSize(x: unknown): number {
  try {
    return JSON.stringify(x)?.length ?? Infinity;
  } catch {
    return Infinity;
  }
}
