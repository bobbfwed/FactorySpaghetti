// Messages between a client session and the host session. Plain JSON over a Conn.
// The host sends the whole room after every change; clients send intents.

import type { Action } from '../engine/actions';
import type { Room, RoomSettings, SeatColor } from './room';
import { SEAT_COLORS } from './room';
import type { ReplayStart } from './journal';
import { parseMoves, parseStart } from './journal';

// The move journal (N11) only added optional fields and one request/answer pair, which older
// builds ignore or refuse with BAD_MESSAGE, so the protocol version did not change.
export const PROTOCOL = 1;

/** Error codes the host uses for refusals it makes itself (the engine adds its own codes). */
export type SessionErrorCode =
  | 'BAD_MESSAGE'     // not a message this protocol knows
  | 'HELLO_FIRST'     // a message arrived before `hello`
  | 'NOT_HOST'        // a host-only command from someone else
  | 'NOT_IN_LOBBY'    // a lobby command after the game started
  | 'NOT_PLAYING'     // a move or play command outside a game in progress
  | 'ON_HOLD'         // a resumed game waits for the host to continue
  | 'NO_SEAT'         // the sender has no seat (a waiting visitor)
  | 'NOT_YOUR_TURN'   // a move from a seat that may not act now
  | 'BAD_SETTINGS'
  | 'BAD_SEAT'        // that seat cannot be changed that way
  | 'SEAT_OCCUPIED'   // the change would remove or replace a seated human
  | 'COLOR_TAKEN'
  | 'SEATS_OPEN'      // start refused: a seat is still open
  | 'NOT_READY'       // start refused: a connected human is not ready
  | 'NOT_WAITING'     // assign refused: no such waiting visitor
  | 'SEATS_ABSENT'    // start refused: a player's seat has nobody connected
  | 'SEAT_REQUIRED'   // a resumed host could not be matched to a seat
  | 'STALE'           // a re-sent move arrived after the game moved on; it was not applied
  | 'INTERNAL'        // the host hit an unexpected error; nothing changed
  | 'BAD_ACTION'      // the move could not be read
  | 'BUSY'            // client side: a move is already waiting for the host
  | 'CLOSED';         // client side: the room closed

export interface WireError { code: string; message: string }

// ── Client → host ─────────────────────────────────────────────────────────────
// Commands carry an optional `id`; a refusal echoes it in `nope`, and the room sent
// back to the sender after an accepted command carries it as `re`.

export type ClientMsg =
  // `seat`: on a reconnect, the seat this client held (a hint; the host checks the name).
  | { t: 'hello'; v: number; name: string; token: string; seat?: number }
  // `seq`: room.seq when the move was first sent. `resend`: sent again after a reconnect;
  // the host refuses it (STALE) if it was not applied and the game has moved on since.
  | { t: 'act'; id: string; action: Action; seq?: number; resend?: boolean }
  | { t: 'ready'; ready: boolean; id?: string }
  | { t: 'color'; color: SeatColor; id?: string }
  | { t: 'sync'; id?: string }
  // Ask for the moves this client's journal is missing. `have`: the move number its journal of
  // the game with this `seed` reaches, or null when it has none. Answered with `journal`.
  | { t: 'journal'; seed: number; have: number | null; id?: string }
  // host only
  | { t: 'cfg'; settings: Partial<RoomSettings>; id?: string }
  | { t: 'setSeat'; index: number; kind: 'bot' | 'open'; botId?: string; id?: string }
  | { t: 'start'; id?: string }
  | { t: 'resume'; id?: string }
  | { t: 'assign'; waitingId: string; seat: number; id?: string }
  | { t: 'autopilot'; seat: number; on: boolean; id?: string }
  | { t: 'kick'; seat: number; id?: string };

// ── Host → client ─────────────────────────────────────────────────────────────

export type ClosedWhy = 'full' | 'version' | 'kicked' | 'ended' | 'replaced' | 'invalid';
export const CLOSED_WHY: readonly ClosedWhy[] = ['full', 'version', 'kicked', 'ended', 'replaced', 'invalid'];

/** Moves applied since the previous broadcast: list[i] is move number from + i + 1. */
export interface MovesBlock { from: number; list: Action[] }

export type HostMsg =
  | { t: 'welcome'; v: number; seat: number | null; room: Room; now: number; moves?: MovesBlock }
  | { t: 'room'; room: Room; now: number; re?: string; moves?: MovesBlock }
  | { t: 'nope'; id: string | null; error: WireError }
  | { t: 'closed'; why: ClosedWhy }
  // The answer to `journal`. With `start`: the host's whole journal (the client's could not be
  // continued). Without: the moves after move number `from`. With neither: the host has none.
  | { t: 'journal'; re?: string; from?: number; moves?: Action[]; start?: ReplayStart };

// ── Parsing (messages arrive from other browsers, so check their shape) ────────

function isObj(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}
const isInt = (x: unknown): x is number => typeof x === 'number' && Number.isInteger(x);
const optId = (x: unknown): boolean => x === undefined || typeof x === 'string';

/** Returns the message if it has a known shape, else null. Action legality is the engine's job. */
export function parseClientMsg(raw: unknown): ClientMsg | null {
  if (!isObj(raw) || typeof raw.t !== 'string' || !optId(raw.id)) return null;
  switch (raw.t) {
    case 'hello':
      return isInt(raw.v) && typeof raw.name === 'string' && typeof raw.token === 'string'
        && (raw.seat === undefined || isInt(raw.seat))
        ? (raw as ClientMsg) : null;
    case 'act':
      return typeof raw.id === 'string' && raw.id.length > 0 && raw.id.length <= 64
        && isObj(raw.action) && typeof raw.action.type === 'string'
        && (raw.seq === undefined || isInt(raw.seq)) && (raw.resend === undefined || typeof raw.resend === 'boolean')
        ? (raw as ClientMsg) : null;
    case 'ready':
      return typeof raw.ready === 'boolean' ? (raw as ClientMsg) : null;
    case 'color':
      return SEAT_COLORS.includes(raw.color as SeatColor) ? (raw as ClientMsg) : null;
    case 'sync': case 'start': case 'resume':
      return raw as ClientMsg;
    case 'journal':
      return isInt(raw.seed) && (raw.have === null || isInt(raw.have)) ? (raw as ClientMsg) : null;
    case 'cfg':
      return isObj(raw.settings) ? (raw as ClientMsg) : null;
    case 'setSeat':
      return isInt(raw.index) && (raw.kind === 'bot' || raw.kind === 'open')
        && (raw.botId === undefined || typeof raw.botId === 'string')
        ? (raw as ClientMsg) : null;
    case 'assign':
      return typeof raw.waitingId === 'string' && isInt(raw.seat) ? (raw as ClientMsg) : null;
    case 'autopilot':
      return isInt(raw.seat) && typeof raw.on === 'boolean' ? (raw as ClientMsg) : null;
    case 'kick':
      return isInt(raw.seat) ? (raw as ClientMsg) : null;
    default:
      return null;
  }
}

/** A room message, with its moves block only when that block is well formed (the room counts more). */
function withMoves(raw: Record<string, unknown>): HostMsg {
  if (raw.moves === undefined) return raw as HostMsg;
  const { moves, ...rest } = raw;
  const block = isObj(moves) && isInt(moves.from) && moves.from >= 0 ? parseMoves(moves.list) : null;
  return (block && isObj(moves) ? { ...rest, moves: { from: moves.from, list: block } } : rest) as HostMsg;
}

export function parseHostMsg(raw: unknown): HostMsg | null {
  if (!isObj(raw) || typeof raw.t !== 'string') return null;
  switch (raw.t) {
    case 'welcome':
      return isInt(raw.v) && (raw.seat === null || isInt(raw.seat)) && isObj(raw.room) && typeof raw.now === 'number'
        ? withMoves(raw) : null;
    case 'room':
      return isObj(raw.room) && typeof raw.now === 'number' ? withMoves(raw) : null;
    case 'journal': {
      if (!optId(raw.re)) return null;
      if (raw.from === undefined) return { t: 'journal', ...(typeof raw.re === 'string' ? { re: raw.re } : {}) };
      const moves = parseMoves(raw.moves);
      const start = raw.start === undefined ? undefined : parseStart(raw.start);
      if (!isInt(raw.from) || raw.from < 0 || !moves || start === null) return null;
      return {
        t: 'journal', from: raw.from, moves,
        ...(start ? { start } : {}), ...(typeof raw.re === 'string' ? { re: raw.re } : {}),
      };
    }
    case 'nope':
      return (raw.id === null || typeof raw.id === 'string') && isObj(raw.error)
        && typeof raw.error.code === 'string' && typeof raw.error.message === 'string'
        ? (raw as HostMsg) : null;
    case 'closed':
      return CLOSED_WHY.includes(raw.why as ClosedWhy) ? (raw as HostMsg) : null;
    default:
      return null;
  }
}
