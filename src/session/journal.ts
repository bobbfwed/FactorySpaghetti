// The move journal: every engine action applied in a game, in order, with the host's dice
// filled in. `applyAction` over the journal's moves, from its start, reproduces the game with
// no randomness at all, which is what the replay tool and the rules-problem report rely on.
//
// The journal is NOT part of the room (the room travels in save links, which must stay short).
// The host keeps one next to the room, every room broadcast carries the moves applied since the
// previous broadcast, and every client keeps its own copy, so a new host already has it.
//
// A journal starts either from the seed (the whole game, from move 0) or, when the early moves
// are not known (a device joined late, a game resumed from a save link), from a snapshot of
// the engine state at some move number: a "partial" journal.

import type { Action } from '../engine/actions';
import type { GameState } from '../engine/state';
import { applyAction, createGame } from '../engine';
import { isGameState } from './save';

/** Where a journal (or a replay) begins: a new game from its seed, or a snapshot at move `seq`. */
export type ReplayStart =
  | { seed: number; playerCount: 2 | 3 | 4 }
  | { state: GameState; seq: number };

export interface JournalData {
  start: ReplayStart;
  /** moves[i] is move number from + i + 1 (room.seq after it was applied). */
  moves: Action[];
}

/**
 * The longest journal kept. Measured bot games: a 4-player game of smart bots is about 650
 * moves (31 KB as JSON), of random bots about 1,900 moves (115 KB). Beyond this cap the journal
 * starts again as a partial journal from the current position, so storage stays bounded.
 */
export const MAX_JOURNAL_MOVES = 10_000;

/** Every engine action type. A move of any other type is not accepted from a file or a message. */
export const ACTION_TYPES: ReadonlySet<string> = new Set([
  'SETUP_CLAIM', 'PLACE_PIECE', 'ROLL_DICE', 'END_ACTIONS', 'PLACE_MEEPLE', 'END_TURN', 'PLACE_BELT',
  'REMOVE_BELT', 'UNDO_BELTS', 'PLACE_TELEPORTER', 'CLAIM_BUILDING', 'UPGRADE_BUILDING', 'BUY_MINE',
  'PLACE_MINE', 'BUY_CARD', 'PLAY_CARD', 'PLACE_OVERSTOCK_PIECE', 'BUY_BELT', 'LOAD_BUILDING_INPUT',
  'OPERATE_BUILDING', 'COLLECT_OUTPUT', 'SKIP_FACTORY_ROLL', 'EXCHANGE_MATERIALS', 'DRAW_PIECE',
] satisfies Action['type'][]);

// ── Reading a journal ───────────────────────────────────────────────────────────

/** Move number of the start (0 for a whole game). */
export function startSeq(start: ReplayStart): number {
  return 'seed' in start ? 0 : start.seq;
}

/** The game's seed, which identifies the game a journal belongs to. */
export function startSeed(start: ReplayStart): number {
  return 'seed' in start ? start.seed : start.state.seed;
}

export function startPlayerCount(start: ReplayStart): 2 | 3 | 4 {
  return 'seed' in start ? start.playerCount : start.state.playerCount;
}

/** The engine state at the start. */
export function startState(start: ReplayStart): GameState {
  return 'seed' in start ? createGame(start.seed, start.playerCount) : start.state;
}

export function journalFrom(j: JournalData): number {
  return startSeq(j.start);
}

/** The move number the journal reaches (room.seq after its last move). */
export function journalEnd(j: JournalData): number {
  return startSeq(j.start) + j.moves.length;
}

export function journalSeed(j: JournalData): number {
  return startSeed(j.start);
}

export function isPartial(j: { start: ReplayStart }): boolean {
  return !('seed' in j.start);
}

// ── Building a journal ──────────────────────────────────────────────────────────

export function fullJournal(seed: number, playerCount: 2 | 3 | 4): JournalData {
  return { start: { seed, playerCount }, moves: [] };
}

export function partialJournal(state: GameState, seq: number): JournalData {
  return { start: { state, seq }, moves: [] };
}

/** A copy that shares no array with the original (each session appends to its own). */
export function copyJournal(j: JournalData): JournalData {
  return { start: j.start, moves: [...j.moves] };
}

/**
 * Add the moves `list`, which follow move number `from`, to `j` (in place). Moves the journal
 * already has are skipped. Returns false when they do not join up (a gap or a journal that is
 * ahead), in which case nothing changes.
 */
export function extendJournal(j: JournalData, from: number, list: readonly Action[]): boolean {
  const end = journalEnd(j);
  if (end < from || end > from + list.length) return false;
  for (let i = end - from; i < list.length; i++) j.moves.push(list[i]!);
  return true;
}

/** The moves after move number `after` (which must be within the journal), as a new array. */
export function movesAfter(j: JournalData, after: number): Action[] {
  return j.moves.slice(after - journalFrom(j));
}

/** Over the cap: start again from the current position (`game` at move `seq`). */
export function capJournal(j: JournalData, game: GameState, seq: number): JournalData {
  return j.moves.length > MAX_JOURNAL_MOVES ? partialJournal(game, seq) : j;
}

/**
 * Apply the journal's moves up to move number `seq`; null if a move is refused or `seq` is
 * outside the journal. Deterministic: no dice are rolled, they are in the moves.
 */
export function replayTo(j: JournalData, seq: number): GameState | null {
  const from = journalFrom(j);
  if (seq < from || seq > journalEnd(j)) return null;
  try {
    let s = startState(j.start);
    for (let i = 0; i < seq - from; i++) {
      const res = applyAction(s, j.moves[i]!);
      if (!res.ok) return null;
      s = res.state;
    }
    return s;
  } catch {
    return null;
  }
}

/**
 * The full check that a journal really leads to `game` at move `seq` (used before a journal
 * from a file or another save is attached to a game). A journal that goes further than `seq`
 * is cut back to it. Returns the journal to use, or null.
 */
export function journalMatches(j: JournalData, game: GameState, seq: number): JournalData | null {
  if (journalSeed(j) !== game.seed || journalFrom(j) > seq || journalEnd(j) < seq) return null;
  const cut: JournalData = { start: j.start, moves: j.moves.slice(0, seq - journalFrom(j)) };
  const s = replayTo(cut, seq);
  return s && JSON.stringify(s) === JSON.stringify(game) ? cut : null;
}

// ── Checking a journal from a file or another browser ───────────────────────────

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => typeof x === 'object' && x !== null && !Array.isArray(x);
const isInt = (x: unknown): x is number => typeof x === 'number' && Number.isInteger(x);

const MAX_STRING = 64;
const MAX_KEYS = 12;

/** A plain value of small, bounded size: what any engine action field can be. */
function isSmallValue(x: unknown, depth: number): boolean {
  if (x === null || typeof x === 'boolean') return true;
  if (typeof x === 'number') return Number.isFinite(x);
  if (typeof x === 'string') return x.length <= MAX_STRING;
  if (depth >= 2) return false;
  if (Array.isArray(x)) return x.length <= 8 && x.every(v => isSmallValue(v, depth + 1));
  if (isObj(x)) {
    const keys = Object.keys(x);
    return keys.length <= MAX_KEYS && keys.every(k => k.length <= 32 && isSmallValue(x[k], depth + 1));
  }
  return false;
}

/**
 * True when `x` looks like an engine action: a known type and small plain fields. Whether the
 * move is legal is the engine's question; a replay asks it for every move.
 */
export function isActionLike(x: unknown): x is Action {
  if (!isObj(x) || typeof x.type !== 'string' || !ACTION_TYPES.has(x.type)) return false;
  if (!isSmallValue(x, 0)) return false;
  if (x.type === 'ROLL_DICE') return Array.isArray(x.rolls) && x.rolls.length <= 3 && x.rolls.every(isInt);
  return true;
}

export function parseStart(x: unknown): ReplayStart | null {
  if (!isObj(x)) return null;
  if ('seed' in x) {
    const pc = x.playerCount;
    return isInt(x.seed) && x.seed >= 0 && x.seed <= 0xffffffff && (pc === 2 || pc === 3 || pc === 4)
      ? { seed: x.seed, playerCount: pc } : null;
  }
  return isInt(x.seq) && x.seq >= 0 && isGameState(x.state) ? { state: x.state, seq: x.seq } : null;
}

/** A journal from outside (a file, a save, another browser), checked; null if it is not usable. */
export function parseJournal(x: unknown, maxMoves = MAX_JOURNAL_MOVES): JournalData | null {
  if (!isObj(x)) return null;
  const start = parseStart(x.start);
  if (!start || !Array.isArray(x.moves) || x.moves.length > maxMoves) return null;
  if (!x.moves.every(isActionLike)) return null;
  return { start, moves: x.moves };
}

/** Moves from outside, checked; null if any is not an action. */
export function parseMoves(x: unknown, maxMoves = MAX_JOURNAL_MOVES): Action[] | null {
  return Array.isArray(x) && x.length <= maxMoves && x.every(isActionLike) ? x : null;
}
