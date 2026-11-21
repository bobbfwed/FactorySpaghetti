// Replays: a game written as its start plus every move, exactly as applied (dice included).
// A replay file (`.fsreplay`) is plain JSON. Before it is shown it is verified: every move is
// put to the engine again, and a refused move stops the replay at that move with the engine's
// error (itself useful to the designer). Stepping uses state checkpoints, so going back is
// instant however long the game.

import type { Action, RulesError } from '../engine/actions';
import type { GameState, PlayerId } from '../engine/state';
import { applyAction } from '../engine';
import type { Room, SeatColor } from './room';
import { SEAT_COLORS, activeSeat, cleanName, NAME_MAX } from './room';
import type { JournalData, ReplayStart } from './journal';
import { MAX_JOURNAL_MOVES, isActionLike, parseStart, startSeq, startState } from './journal';
import { rulesFingerprint } from './save';
import { describeAction } from './describe';
import { diceRngFromSeed, rollDice } from './dice';

export const REPLAY_KIND = 'factory-spaghetti-replay';
export const REPLAY_EXT = '.fsreplay';

export interface ReplayPlayer {
  seat: number;
  name: string;
  color: SeatColor;
  /** The bot that played the seat, or null for a person. */
  bot: string | null;
}

export interface ReplayFile {
  kind: typeof REPLAY_KIND;
  v: 1;
  /** The rules fingerprint of the build that played the game (see save.ts). */
  rules: string;
  app: string;
  savedAt: number;
  code: string;
  start: ReplayStart;
  players: ReplayPlayer[];
  /** Every move after the start, in order, as applied (rolls carry the host's dice). */
  moves: Action[];
}

/** Largest replay or report text accepted (pasted or from a file). */
export const MAX_REPLAY_BYTES = 4 * 1024 * 1024;

export type ReplayErrorKind = 'empty' | 'too-large' | 'not-replay' | 'unsupported-version' | 'damaged';

export class ReplayError extends Error {
  constructor(public readonly kind: ReplayErrorKind, message: string) {
    super(message);
    this.name = 'ReplayError';
  }
}

const REPLAY_ERROR_TEXT: Record<ReplayErrorKind, string> = {
  empty: 'Paste the text of a replay file first, or choose the file.',
  'too-large': 'This file is too large to be a Factory Spaghetti replay.',
  'not-replay': 'This is not a Factory Spaghetti replay, report or save file.',
  'unsupported-version': 'This file was made by a newer version of the game. Reload the page to update, then try again.',
  damaged: 'This replay is damaged and cannot be opened.',
};

export function replayFail(kind: ReplayErrorKind, detail?: string): never {
  throw new ReplayError(kind, detail ? `${REPLAY_ERROR_TEXT[kind]} (${detail})` : REPLAY_ERROR_TEXT[kind]);
}

// ── Making a replay ─────────────────────────────────────────────────────────────

export function replayPlayers(room: Room): ReplayPlayer[] {
  return room.seats.map(s => ({
    seat: s.index, name: s.name || `Seat ${s.index + 1}`, color: s.color, bot: s.kind === 'bot' ? s.botId ?? 'bot' : null,
  }));
}

/** A replay of `room`'s game from a journal that reaches the room's current move. */
export function makeReplay(room: Room, journal: JournalData, meta: { savedAt: number; app: string }): ReplayFile {
  return {
    kind: REPLAY_KIND, v: 1, rules: rulesFingerprint(), app: meta.app, savedAt: meta.savedAt, code: room.code,
    start: journal.start, players: replayPlayers(room), moves: [...journal.moves],
  };
}

export function serializeReplay(r: ReplayFile): string {
  return JSON.stringify(r);
}

export function replayFileName(r: ReplayFile, final: GameState | null): string {
  const what = final?.gameOver ? 'final' : `round-${final?.round ?? 0}`;
  return `factory-spaghetti-${r.code}-${what}${REPLAY_EXT}`;
}

// ── Checking a replay from outside ──────────────────────────────────────────────

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => typeof x === 'object' && x !== null && !Array.isArray(x);
const isInt = (x: unknown): x is number => typeof x === 'number' && Number.isInteger(x);

function check(cond: boolean, what: string): asserts cond {
  if (!cond) replayFail('damaged', what);
}

/** Names and colours from a file are never trusted: names are cleaned and clipped. */
export function parsePlayers(x: unknown, playerCount: number): ReplayPlayer[] {
  check(Array.isArray(x) && x.length === playerCount, 'players');
  const colors = new Set<string>();
  return x.map((p, i): ReplayPlayer => {
    check(isObj(p) && p.seat === i, `player ${i + 1}`);
    check(SEAT_COLORS.includes(p.color as SeatColor) && !colors.has(p.color as string), `player ${i + 1} colour`);
    colors.add(p.color as string);
    const name = cleanName(p.name).slice(0, NAME_MAX).trim() || `Seat ${i + 1}`;
    const bot = typeof p.bot === 'string' ? p.bot.slice(0, 32) : null;
    return { seat: i, name, color: p.color as SeatColor, bot };
  });
}

/** Check the shape of a replay object (not the moves' legality: verifyReplay does that). */
export function validateReplay(x: unknown): ReplayFile {
  if (!isObj(x) || x.kind !== REPLAY_KIND) replayFail('not-replay');
  if (isInt(x.v) && x.v > 1) replayFail('unsupported-version', `replay format ${x.v}`);
  check(x.v === 1, 'replay format');
  check(typeof x.rules === 'string' && x.rules.length <= 100, 'rules');
  check(typeof x.app === 'string' && x.app.length <= 100, 'version');
  check(typeof x.savedAt === 'number' && Number.isFinite(x.savedAt), 'date');
  check(typeof x.code === 'string' && x.code.length <= 16, 'room code');
  const start = parseStart(x.start);
  check(start !== null, 'start');
  const pc = 'seed' in start ? start.playerCount : start.state.playerCount;
  const players = parsePlayers(x.players, pc);
  check(Array.isArray(x.moves) && x.moves.length <= MAX_JOURNAL_MOVES, 'moves');
  x.moves.forEach((m, i) => check(isActionLike(m), `move ${startSeq(start) + i + 1}`));
  return {
    kind: REPLAY_KIND, v: 1, rules: x.rules, app: x.app, savedAt: x.savedAt, code: x.code.replace(/[^A-Z]/g, '').slice(0, 5) || 'ROOM',
    start, players, moves: x.moves as Action[],
  };
}

/** Parse JSON text from a paste or a file, with the size cap applied first. */
export function parseJsonText(text: string): unknown {
  if (typeof text !== 'string') replayFail('not-replay');
  const t = text.trim();
  if (t.length === 0) replayFail('empty');
  if (t.length > MAX_REPLAY_BYTES) replayFail('too-large');
  if (!t.startsWith('{')) replayFail('not-replay');
  try {
    return JSON.parse(t);
  } catch {
    replayFail('damaged', 'not complete JSON; the text may have been cut off');
  }
}

// ── Verifying and stepping ──────────────────────────────────────────────────────

/** A state is kept every this many moves; stepping recomputes at most this many minus one. */
export const CHECKPOINT_EVERY = 16;

export interface RefusedReplayMove {
  /** Position of the refused move in the replay (1 = the first move after the start). */
  index: number;
  /** Its move number in the game (room.seq it would have reached). */
  seq: number;
  action: Action;
  error: RulesError;
}

/**
 * A verified replay, ready to step through. Positions run from 0 (the start) to `length`
 * (after the last accepted move); position p shows the game after move number `seqAt(p)`.
 */
export class ReplayCursor {
  readonly replay: ReplayFile;
  readonly sameRules: boolean;
  /** The first move the engine refused, or null when every move was accepted. */
  readonly refused: RefusedReplayMove | null;
  /**
   * Whether the rolls match the seeded dice stream of the game. Only a replay from the start can
   * be checked ('unchecked' otherwise); 'mismatch' names the first move whose dice differ.
   */
  readonly dice: { status: 'ok' | 'mismatch' | 'unchecked'; firstMismatch: number | null };
  /** The accepted moves. */
  readonly moves: readonly Action[];
  private readonly checkpoints: GameState[];
  /** turnKeys[p]: round and active player at position p (to find the next turn). */
  private readonly turnKeys: number[];
  /** actors[i]: the seat that made move i (0-based into moves). */
  private readonly actors: number[];
  private cache: { pos: number; state: GameState };

  constructor(parts: {
    replay: ReplayFile; checkpoints: GameState[]; turnKeys: number[]; actors: number[]; moves: Action[];
    refused: RefusedReplayMove | null; last: GameState;
    dice: { status: 'ok' | 'mismatch' | 'unchecked'; firstMismatch: number | null };
  }) {
    this.replay = parts.replay;
    this.sameRules = parts.replay.rules === rulesFingerprint();
    this.refused = parts.refused;
    this.dice = parts.dice;
    this.moves = parts.moves;
    this.checkpoints = parts.checkpoints;
    this.turnKeys = parts.turnKeys;
    this.actors = parts.actors;
    this.cache = { pos: parts.moves.length, state: parts.last };
  }

  get length(): number { return this.moves.length; }
  get partial(): boolean { return !('seed' in this.replay.start); }
  /** Move number at the start (0 for a whole game). */
  get firstSeq(): number { return startSeq(this.replay.start); }

  seqAt(pos: number): number { return this.firstSeq + this.clamp(pos); }

  clamp(pos: number): number {
    return Math.max(0, Math.min(this.length, Math.round(pos)));
  }

  /** The engine state at a position: from the nearest checkpoint, at most CHECKPOINT_EVERY - 1 moves. */
  stateAt(pos: number): GameState {
    const p = this.clamp(pos);
    if (p === this.cache.pos) return this.cache.state;
    let at = Math.floor(p / CHECKPOINT_EVERY) * CHECKPOINT_EVERY;
    let s = this.checkpoints[at / CHECKPOINT_EVERY]!;
    // Stepping forward from the last shown position is cheaper than from the checkpoint.
    if (this.cache.pos < p && this.cache.pos > at) { at = this.cache.pos; s = this.cache.state; }
    for (let i = at; i < p; i++) {
      const res = applyAction(s, this.moves[i]!);
      if (!res.ok) throw new Error(`replay: move ${i + 1} was accepted before and refused now`);
      s = res.state;
    }
    this.cache = { pos: p, state: s };
    return s;
  }

  /** The move that led to position `pos` (null at the start). */
  moveAt(pos: number): Action | null {
    const p = this.clamp(pos);
    return p === 0 ? null : this.moves[p - 1]!;
  }

  /** The seat that made the move leading to `pos`. */
  actorAt(pos: number): number | null {
    const p = this.clamp(pos);
    return p === 0 ? null : this.actors[p - 1]!;
  }

  /** The log line of the move leading to `pos`, in rulebook words. */
  lineAt(pos: number): string {
    const p = this.clamp(pos);
    if (p === 0) {
      return this.partial ? `The replay starts at move ${this.firstSeq}, in round ${this.stateAt(0).round}.` : 'The game begins.';
    }
    const before = this.stateAt(p - 1);
    const actor = this.actors[p - 1]!;
    try {
      return describeAction(before, this.moves[p - 1]!, this.replay.players[actor]?.name ?? `Seat ${actor + 1}`);
    } catch {
      return `Move ${this.seqAt(p)}`;
    }
  }

  /** The position just after the next roll (where the roll's result shows), or null. */
  nextRoll(pos: number): number | null {
    for (let p = this.clamp(pos) + 1; p <= this.length; p++) if (this.moves[p - 1]!.type === 'ROLL_DICE') return p;
    return null;
  }

  /** The position just after the previous roll before `pos`, or null. */
  prevRoll(pos: number): number | null {
    for (let p = this.clamp(pos) - 1; p >= 1; p--) if (this.moves[p - 1]!.type === 'ROLL_DICE') return p;
    return null;
  }

  /** The first position where another player's turn (or a new round) has begun, or null. */
  nextTurn(pos: number): number | null {
    const p0 = this.clamp(pos);
    const key = this.turnKeys[p0];
    for (let p = p0 + 1; p <= this.length; p++) if (this.turnKeys[p] !== key) return p;
    return null;
  }

  /** The start of the current turn, or of the previous one when already at a turn's start. */
  prevTurn(pos: number): number | null {
    let p = this.clamp(pos);
    if (p === 0) return null;
    if (this.turnKeys[p - 1] !== this.turnKeys[p]) p--;
    const key = this.turnKeys[p];
    while (p > 0 && this.turnKeys[p - 1] === key) p--;
    return p;
  }
}

const turnKey = (s: GameState): number => s.round * 8 + s.activePlayerIndex;

/** Who makes `action` in `s`: the owner of an operate-or-skip choice, else the active player. */
export function actorOf(s: GameState, action: Action): number {
  if ((action.type === 'OPERATE_BUILDING' || action.type === 'SKIP_FACTORY_ROLL') && action.ownerId !== undefined) return action.ownerId;
  return (activeSeat(s) ?? 0) as PlayerId;
}

/**
 * Put every move of the replay to the engine again. Stops at the first refused move. Yields
 * to the page every `yieldEvery` moves (long games) and reports progress.
 */
export async function verifyReplay(
  replay: ReplayFile,
  opts: { yieldEvery?: number; onProgress?: (done: number, total: number) => void; pause?: () => Promise<void> } = {},
): Promise<ReplayCursor> {
  const yieldEvery = opts.yieldEvery ?? 250;
  let s: GameState;
  try {
    s = startState(replay.start);
  } catch {
    replayFail('damaged', 'the start position');
  }
  const checkpoints: GameState[] = [s];
  const turnKeys: number[] = [turnKey(s)];
  const actors: number[] = [];
  const moves: Action[] = [];
  let refused: RefusedReplayMove | null = null;
  // A game from its seed rolls its dice from a seeded stream: every roll in the file must match it.
  let diceRng = 'seed' in replay.start ? diceRngFromSeed(replay.start.seed) : null;
  let firstMismatch: number | null = null;
  const first = startSeq(replay.start);
  for (let i = 0; i < replay.moves.length; i++) {
    const action = replay.moves[i]!;
    if (diceRng !== null && action.type === 'ROLL_DICE') {
      const [expected, next] = rollDice(diceRng, s.mineCount);
      diceRng = next;
      const same = expected.length === action.rolls.length && expected.every((d, k) => d === action.rolls[k]);
      if (!same && firstMismatch === null) firstMismatch = first + i + 1;
    }
    let res: ReturnType<typeof applyAction>;
    try {
      res = applyAction(s, action);
    } catch {
      res = { ok: false, error: { code: 'BAD_ACTION', message: 'The move could not be read.' } };
    }
    if (!res.ok) {
      refused = { index: i + 1, seq: first + i + 1, action, error: { code: res.error.code, message: res.error.message } };
      break;
    }
    actors.push(actorOf(s, action));
    s = res.state;
    moves.push(action);
    turnKeys.push(turnKey(s));
    if (moves.length % CHECKPOINT_EVERY === 0) checkpoints.push(s);
    if (yieldEvery > 0 && (i + 1) % yieldEvery === 0) {
      opts.onProgress?.(i + 1, replay.moves.length);
      await (opts.pause ? opts.pause() : new Promise<void>(r => setTimeout(r, 0)));
    }
  }
  opts.onProgress?.(moves.length, replay.moves.length);
  const dice = {
    status: 'seed' in replay.start ? (firstMismatch === null ? 'ok' as const : 'mismatch' as const) : 'unchecked' as const,
    firstMismatch,
  };
  return new ReplayCursor({ replay, checkpoints, turnKeys, actors, moves, refused, last: s, dice });
}
