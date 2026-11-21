// LAN protocol: the message types exchanged between the authoritative host and its
// browser clients. This module is pure types + a tiny (de)serialize helper — no IO,
// no ws import — so both the server and the client can depend on it.
//
// Model: the host runs the authoritative engine (a GameSession). Clients send ACTION
// REQUESTS; the host validates (right seat + right turn + legal move) and broadcasts a
// full state snapshot after every change. Reconnection is just "send the snapshot
// again", so a dropped client re-syncs by reconnecting — no incremental replay needed.

import type { Action } from '../engine/actions';
import type { GameState, PlayerId, HexCoord, PieceType } from '../engine/state';

export const PROTOCOL_VERSION = 1;

// A lobby seat's configured kind: an open seat awaiting a remote human, or a bot by id.
// 'open' seats are claimed by connected clients; 'bot:<id>' seats are run by the host.
export type SeatKind = 'open' | `bot:${string}`;

// ── Lobby view (sent while the room is in the lobby phase) ──────────────────────

export interface LobbySeatView {
  readonly index: number;
  readonly kind: SeatKind;
  readonly claimedByClientId: string | null;
  readonly claimedByName: string | null;
}

export interface LobbyClientView {
  readonly clientId: string;
  readonly name: string;
  readonly seatIndex: number | null; // which seat they've claimed, if any
}

export interface LobbyView {
  readonly phase: 'lobby';
  readonly playerCount: 2 | 3 | 4;
  readonly seats: readonly LobbySeatView[];
  readonly clients: readonly LobbyClientView[];
  readonly hostClientId: string | null;
  readonly canStart: boolean;        // host may start now (empty open seats become bots)
  readonly allSeatsClaimed: boolean; // every open seat has a human — no bot fill needed
}

// ── In-game snapshot (sent while the room is playing) ───────────────────────────

// Per-seat descriptor the client renders (kind + label + who controls a human seat).
export interface SeatInfo {
  readonly kind: 'human' | 'bot';
  readonly label: string;          // 'Human' or the bot's label
  readonly ownerName: string | null; // remote player's name for a human seat
}

export interface StateSnapshot {
  readonly phase: 'playing';
  readonly state: GameState;
  readonly seats: readonly SeatInfo[];
  // The player id this client controls, or null if they're a spectator.
  readonly yourPlayerId: PlayerId | null;
  readonly log: readonly string[];
  readonly lastRollEvents: readonly string[];
  readonly lastDrawnCardInfo: { readonly cardType: string; readonly playedOnDraw: boolean } | null;
  readonly hostClientId: string | null;
  readonly gameOver: boolean;
  // Milliseconds remaining on the current auto-advance timer at broadcast time (null = none).
  // The client turns this into a local deadline so its countdown survives clock skew.
  readonly actionTimeoutRemainingMs: number | null;
}

// ── Presence (ephemeral, non-authoritative) ──────────────────────────────────────
// The active player's in-progress UI intent so other clients can watch them work
// (hovering a hex, holding a ghost piece, previewing a belt route). This is NOT game
// state: the host relays it verbatim, it never touches the engine or the action log.

export interface PresencePoint { readonly pieceId: string; readonly position: number; }
export interface PresenceBelt { readonly pieceId: string; readonly fromPoint: number; readonly toPoint: number; }

export interface PresenceState {
  readonly hoveredCoord: HexCoord | null;
  readonly ghost: { readonly coord: HexCoord; readonly pieceType: PieceType; readonly rotation: number } | null;
  readonly selectedCoord: HexCoord | null;
  readonly route: {
    readonly source: PresencePoint | null;
    readonly hover: PresencePoint | null;
    readonly belts: ReadonlyArray<PresenceBelt>;
  } | null;
}

// ── Client → Server ─────────────────────────────────────────────────────────────

export type ClientMessage =
  // First message on (re)connect. A returning client replays its token to reclaim its
  // identity/seat (even mid-game) so it re-syncs seamlessly.
  | { readonly type: 'hello'; readonly name: string; readonly token?: string; readonly protocol?: number }
  | { readonly type: 'claimSeat'; readonly seatIndex: number }
  | { readonly type: 'releaseSeat' }
  // Host-only: reconfigure the lobby (player count + each seat's kind).
  | { readonly type: 'configure'; readonly playerCount: 2 | 3 | 4; readonly seatKinds: readonly SeatKind[] }
  | { readonly type: 'start' }                    // host-only: begin the game
  | { readonly type: 'action'; readonly action: Action }
  | { readonly type: 'presence'; readonly presence: PresenceState } // ephemeral UI intent
  | { readonly type: 'resync' }                   // please resend current state/lobby
  | { readonly type: 'returnToLobby' };           // host-only: after game over, new lobby

// ── Server → Client ─────────────────────────────────────────────────────────────

export type ServerMessage =
  | {
      readonly type: 'welcome';
      readonly clientId: string;
      readonly token: string;    // persist and replay on reconnect
      readonly isHost: boolean;
      readonly protocol: number;
    }
  | { readonly type: 'lobby'; readonly lobby: LobbyView }
  | { readonly type: 'snapshot'; readonly snapshot: StateSnapshot }
  // Relayed presence of another player (the one whose id is given) — for spectating.
  | { readonly type: 'presence'; readonly playerId: PlayerId; readonly presence: PresenceState }
  | { readonly type: 'rejected'; readonly reason: string } // an action request was refused
  | { readonly type: 'error'; readonly message: string };

// ── (de)serialize ───────────────────────────────────────────────────────────────
// Messages are plain JSON (GameState is pure data — no Maps/Sets/functions).

export function encode(msg: ServerMessage | ClientMessage): string {
  return JSON.stringify(msg);
}

export function decodeClientMessage(raw: string): ClientMessage | null {
  try {
    const obj = JSON.parse(raw) as unknown;
    if (obj && typeof obj === 'object' && typeof (obj as { type?: unknown }).type === 'string') {
      return obj as ClientMessage;
    }
  } catch {
    /* fall through */
  }
  return null;
}

export function decodeServerMessage(raw: string): ServerMessage | null {
  try {
    const obj = JSON.parse(raw) as unknown;
    if (obj && typeof obj === 'object' && typeof (obj as { type?: unknown }).type === 'string') {
      return obj as ServerMessage;
    }
  } catch {
    /* fall through */
  }
  return null;
}
