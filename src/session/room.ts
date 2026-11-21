// The room: one plain-JSON object the host owns and sends, whole, to every client.
// Everything needed to continue a game (engine state, dice stream, seats, settings) is
// inside it, which is what makes host take-over and resume-from-a-save possible.
// Host-private data (tokens, connections, timers) never goes in here.

import type { GameState, PlayerId } from '../engine/state';
import type { CardType, Material, PieceType } from '../engine/config';
import type { RngState } from '../engine/rng';
import { FACTORY_OP_TIMEOUT_MS, ROUND_END_TIMEOUT_MS } from '../engine/config';
import type { BotSpeed } from './pacing';
import { DEFAULT_BOT_SPEED } from './pacing';

export type SeatColor = 'blue' | 'red' | 'orange' | 'green';
export const SEAT_COLORS: readonly SeatColor[] = ['blue', 'red', 'orange', 'green'];

export interface Seat {
  index: number;             // equals the engine PlayerId of this seat
  kind: 'human' | 'bot' | 'open';
  name: string;              // '' when open
  color: SeatColor;          // unique per seat
  botId: string | null;      // bots/registry id for a bot seat, or the stand-in bot while autopilot is on
  connected: boolean;        // humans only
  ready: boolean;
  awaySince: number | null;  // host clock (ms) when a human dropped during play
  autopilot: boolean;        // a bot is currently playing this human's seat
}

export interface RoomSettings {
  playerCount: 2 | 3 | 4;
  factoryOpTimeoutMs: number;   // off-turn operate-or-skip default; <= 0 disables
  roundEndTimeoutMs: number;    // idle round-end turn auto-ends; <= 0 disables
  awayPolicy: 'bot' | 'wait';   // what happens to a seat whose player dropped
  awayGraceMs: number;          // how long an away seat waits before a bot plays it
  botDelayMs: number;           // the pause at "fast" bot speed (see pacing.ts)
  botSpeed: BotSpeed;           // how fast bots move: instant, fast, or paced to the animations
}

/** One line of the game log, in rulebook words. `seat` is null for table-wide notes. */
export interface LogEntry {
  seq: number;
  seat: number | null;
  text: string;
}

/** Why an activated building did or did not produce on a roll. */
export type ActivationOutcome =
  | 'awaiting-choice'  // a factory: its owner now chooses to operate or skip
  | 'power'            // a Power Plant produced Power Tokens (amount)
  | 'power-capped'     // a Power Plant's owner already holds the maximum Power Tokens
  | 'output-full'      // a factory's output buffer is still full
  | 'input-missing'    // a factory's input buffer does not hold a complete recipe
  | 'no-power';        // a factory's owner cannot pay the Power Tokens

/** What an accepted move caused on the table, for animation and notices. */
export type TableEvent =
  | { kind: 'roll'; seat: number; dice: number[]; total: number }
  | { kind: 'activated'; seat: number; pieceId: string; building: PieceType; outcome: ActivationOutcome; amount: number }
  | { kind: 'piecePlaced'; seat: number; pieceId: string; building: PieceType }
  // A draw from one of several open stacks (DRAW_PIECE): the top piece of `stack` is now face up
  // for everyone, and it is the piece this player places next.
  | { kind: 'pieceDrawn'; seat: number; stack: 0 | 1 | 2; pieceId: string; building: PieceType }
  | { kind: 'operated'; seat: number; pieceId: string; building: PieceType; product: Material | null; powerChange: number; teleported: boolean }
  | { kind: 'skipped'; seat: number; pieceId: string; building: PieceType }
  | { kind: 'collected'; seat: number; pieceId: string; materials: Material[] }
  | { kind: 'cardBought'; seat: number; card: CardType | null; playedOnDraw: boolean }
  | { kind: 'cardPlayed'; seat: number; card: CardType }
  | { kind: 'timeout'; seat: number; what: 'factory-op' | 'round-end' }
  | { kind: 'gameOver'; winner: number | null; tied: number[]; reason: 'tesseracts' | 'boardExhausted' | null };

export interface Room {
  v: 1;
  code: string;
  phase: 'lobby' | 'playing' | 'finished';
  hold: boolean;                // a resumed game is paused until the host continues
  hostSeat: number;
  seats: Seat[];                // length === settings.playerCount
  waiting: { id: string; name: string }[];   // connected people without a seat (resume lobby)
  settings: RoomSettings;
  game: GameState | null;
  seq: number;                  // +1 per accepted move
  diceRng: RngState;
  recent: { seat: number; id: string }[];    // last RECENT_PER_SEAT accepted client move ids of each seat
  log: LogEntry[];              // capped at 60
  lastEvents: TableEvent[];     // what the last accepted move(s) caused (for animation)
  opDeadline: number | null;        // host clock ms: off-turn operate-or-skip default fires
  roundEndDeadline: number | null;  // host clock ms: idle round-end turn auto-ends
}

export const LOG_CAP = 60;
/** Accepted client move ids remembered per seat, so a re-sent move is never applied twice. */
export const RECENT_PER_SEAT = 4;
/** Longest player name (after trimming). */
export const NAME_MAX = 20;
export const DEFAULT_PLAYER_COUNT = 4;
/** The bot that stands in for an away human. */
export const STAND_IN_BOT = 'greedy';

export function defaultSettings(): RoomSettings {
  return {
    playerCount: DEFAULT_PLAYER_COUNT,
    factoryOpTimeoutMs: FACTORY_OP_TIMEOUT_MS,
    roundEndTimeoutMs: ROUND_END_TIMEOUT_MS,
    awayPolicy: 'bot',
    awayGraceMs: 90_000,
    botDelayMs: 300,
    botSpeed: DEFAULT_BOT_SPEED,
  };
}

export function openSeat(index: number, color: SeatColor): Seat {
  return {
    index, kind: 'open', name: '', color, botId: null,
    connected: false, ready: false, awaySince: null, autopilot: false,
  };
}

/** A fresh lobby: seat 0 belongs to the host (not yet connected), the rest are open. */
export function newLobbyRoom(code: string, hostName: string, settings: RoomSettings = defaultSettings()): Room {
  const seats: Seat[] = [];
  for (let i = 0; i < settings.playerCount; i++) seats.push(openSeat(i, SEAT_COLORS[i]!));
  seats[0] = { ...seats[0]!, kind: 'human', name: hostName };
  return {
    v: 1,
    code,
    phase: 'lobby',
    hold: false,
    hostSeat: 0,
    seats,
    waiting: [],
    settings,
    game: null,
    seq: 0,
    diceRng: 0,
    recent: [],
    log: [],
    lastEvents: [],
    opDeadline: null,
    roundEndDeadline: null,
  };
}

/** The seat whose turn it is, or null outside play. */
export function activeSeat(game: GameState | null): PlayerId | null {
  if (!game) return null;
  return game.turnOrder[game.activePlayerIndex] ?? null;
}

/** A human seat that a person (not a bot) is currently responsible for. */
export function isHumanControlled(seat: Seat | undefined): boolean {
  return !!seat && seat.kind === 'human' && !seat.autopilot;
}

/** A seat the host plays with a bot: a bot seat, or a human seat on autopilot. */
export function isBotControlled(seat: Seat | undefined): boolean {
  return !!seat && (seat.kind === 'bot' || (seat.kind === 'human' && seat.autopilot));
}

export function sameName(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/** A name without control characters or repeated spaces, trimmed. May be empty or too long. */
export function cleanName(raw: unknown): string {
  return typeof raw === 'string' ? raw.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim() : '';
}

/** A usable name from trusted input (the host's own options): cleaned, clipped, never empty. */
export function clipName(raw: unknown, fallback = 'Host'): string {
  return cleanName(raw).slice(0, NAME_MAX).trim() || fallback;
}

/** Record an accepted client move id, keeping only the last few ids of that seat. */
export function recordRecent(recent: readonly { seat: number; id: string }[], seat: number, id: string): { seat: number; id: string }[] {
  const next = [...recent, { seat, id }];
  let drop = next.filter(r => r.seat === seat).length - RECENT_PER_SEAT;
  return next.filter(r => {
    if (r.seat !== seat || drop <= 0) return true;
    drop--;
    return false;
  });
}

export function appendLog(log: readonly LogEntry[], entries: readonly LogEntry[]): LogEntry[] {
  const next = [...log, ...entries];
  return next.length > LOG_CAP ? next.slice(next.length - LOG_CAP) : next;
}
