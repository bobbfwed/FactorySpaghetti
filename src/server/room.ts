// The authoritative game room — socket-agnostic so it can be unit-tested without ws.
//
// It owns the lobby (seat claiming + host configuration) and, once started, a headless
// GameSession (the same authoritative engine the local client uses). Clients send action
// REQUESTS; the room validates that the requester owns the active seat and lets the engine
// judge legality, then broadcasts a full StateSnapshot after every change. Reconnection is
// token-based: a returning client replays its token to reclaim its identity/seat mid-game
// and immediately receives the current snapshot — "reconnect just re-syncs".
//
// The ws server (server.ts) is a thin adapter: it maps each socket to a stable connection
// id, forwards decoded messages to handleMessage / handleDisconnect, and implements the
// RoomTransport sink used for sends/broadcasts.

import type { Action } from '../engine/actions';
import type { PlayerId } from '../engine/state';
import { GameSession } from '../client/GameSession';
import type { Seat } from '../client/GameSession';
import { botById } from '../bots/registry';
import {
  PROTOCOL_VERSION,
  type ClientMessage,
  type ServerMessage,
  type SeatKind,
  type LobbyView,
  type LobbySeatView,
  type LobbyClientView,
  type SeatInfo,
  type StateSnapshot,
  type PresenceState,
  decodeClientMessage,
} from './protocol';

// The room sends messages by connection id; the ws server wires this to real sockets.
export interface RoomTransport {
  send(clientId: string, msg: ServerMessage): void;
}

export interface RoomOptions {
  /** Delay between server-run bot actions (ms). 0 = run bots instantly (tests). */
  readonly botDelayMs?: number;
  /** Seed source for a new game. Defaults to Date.now(); inject a constant in tests. */
  readonly createSeed?: () => number;
  /** Host-adjustable timeout before an undecided factory activation auto-operates. */
  readonly factoryOpTimeoutMs?: number;
  /** Host-adjustable timeout before an idle round-end turn auto-ends (<=0 disables). */
  readonly roundEndTimeoutMs?: number;
}

interface Participant {
  clientId: string;      // the CURRENT connection id (updates on reconnect)
  name: string;
  token: string;         // stable reconnect key
  seatIndex: number | null;
  connected: boolean;
  joinOrder: number;     // lowest connected joinOrder is the host
}

const DEFAULT_BOT_DELAY_MS = 300;
// Bot used to fill an open seat that no human claimed by the time the host starts.
const DEFAULT_FILL_BOT = 'greedy';

export class Room {
  private readonly transport: RoomTransport;
  private readonly botDelayMs: number;
  private readonly createSeed: () => number;
  private readonly factoryOpTimeoutMs: number | undefined;
  private readonly roundEndTimeoutMs: number | undefined;

  private readonly clients = new Map<string, Participant>(); // keyed by current clientId
  private idCounter = 0;
  private joinCounter = 0;

  private phase: 'lobby' | 'playing' = 'lobby';
  private playerCount: 2 | 3 | 4 = 2;
  private seatKinds: SeatKind[] = ['open', 'open'];

  private session: GameSession | null = null;
  private unsubSession: (() => void) | null = null;

  constructor(transport: RoomTransport, opts: RoomOptions = {}) {
    this.transport = transport;
    this.botDelayMs = opts.botDelayMs ?? DEFAULT_BOT_DELAY_MS;
    this.createSeed = opts.createSeed ?? (() => Date.now());
    this.factoryOpTimeoutMs = opts.factoryOpTimeoutMs;
    this.roundEndTimeoutMs = opts.roundEndTimeoutMs;
  }

  // ── Inbound ────────────────────────────────────────────────────────────────

  /** Handle a raw text frame from the socket identified by `connId`. */
  handleMessage(connId: string, raw: string): void {
    const msg = decodeClientMessage(raw);
    if (!msg) {
      this.transport.send(connId, { type: 'error', message: 'malformed message' });
      return;
    }
    if (msg.type === 'hello') {
      this.handleHello(connId, msg);
      return;
    }
    const p = this.clients.get(connId);
    if (!p) {
      this.transport.send(connId, { type: 'error', message: 'send "hello" first' });
      return;
    }
    this.dispatch(p, msg);
  }

  /** The socket for `connId` closed. */
  handleDisconnect(connId: string): void {
    const p = this.clients.get(connId);
    if (!p) return;
    p.connected = false;
    if (this.phase === 'lobby') {
      // In the lobby a dropped client frees its seat and leaves the roster.
      this.clients.delete(connId);
      this.broadcastLobby();
    } else {
      // Mid-game we keep the participant (seat reserved) so a token rejoin can resume.
      this.broadcastSnapshot();
    }
  }

  private dispatch(p: Participant, msg: Exclude<ClientMessage, { type: 'hello' }>): void {
    switch (msg.type) {
      case 'claimSeat':    this.handleClaimSeat(p, msg.seatIndex); break;
      case 'releaseSeat':  this.handleReleaseSeat(p); break;
      case 'configure':    this.handleConfigure(p, msg.playerCount, msg.seatKinds); break;
      case 'start':        this.handleStart(p); break;
      case 'action':       this.handleAction(p, msg.action); break;
      case 'presence':     this.handlePresence(p, msg.presence); break;
      case 'resync':       this.sendCurrentTo(p.clientId); break;
      case 'returnToLobby': this.handleReturnToLobby(p); break;
    }
  }

  // ── hello / identity ─────────────────────────────────────────────────────────

  private handleHello(connId: string, msg: Extract<ClientMessage, { type: 'hello' }>): void {
    const name = (msg.name || '').trim().slice(0, 24) || 'Player';

    // Reconnect: a known token reclaims the existing participant (and its seat).
    const existing = msg.token
      ? [...this.clients.values()].find(c => c.token === msg.token)
      : undefined;

    let p: Participant;
    if (existing) {
      if (existing.clientId !== connId) {
        this.clients.delete(existing.clientId);
        existing.clientId = connId;
        this.clients.set(connId, existing);
      }
      existing.connected = true;
      existing.name = name;
      // A rejoining lobby client whose seat was cleared can re-grab a free seat below.
      p = existing;
    } else {
      p = {
        clientId: connId,
        name,
        token: `k${++this.idCounter}`,
        seatIndex: null,
        connected: true,
        joinOrder: ++this.joinCounter,
      };
      this.clients.set(connId, p);
      // Convenience: a fresh lobby client auto-claims the lowest free open seat.
      if (this.phase === 'lobby') {
        const free = this.firstFreeOpenSeat();
        if (free !== null) p.seatIndex = free;
      }
    }

    const host = this.getHost();
    this.transport.send(connId, {
      type: 'welcome',
      clientId: connId,
      token: p.token,
      isHost: host?.clientId === connId,
      protocol: PROTOCOL_VERSION,
    });
    // Everyone sees the roster change; the joiner gets the current lobby/snapshot.
    if (this.phase === 'lobby') this.broadcastLobby();
    else this.broadcastSnapshot();
  }

  // ── Lobby actions ──────────────────────────────────────────────────────────

  private handleClaimSeat(p: Participant, seatIndex: number): void {
    if (this.phase !== 'lobby') { this.reject(p, 'game already started'); return; }
    if (!Number.isInteger(seatIndex) || seatIndex < 0 || seatIndex >= this.playerCount) {
      this.reject(p, 'invalid seat'); return;
    }
    if (this.seatKinds[seatIndex] !== 'open') { this.reject(p, 'seat is a bot'); return; }
    const taken = [...this.clients.values()].some(
      c => c.connected && c !== p && c.seatIndex === seatIndex,
    );
    if (taken) { this.reject(p, 'seat already claimed'); return; }
    p.seatIndex = seatIndex;
    this.broadcastLobby();
  }

  private handleReleaseSeat(p: Participant): void {
    if (this.phase !== 'lobby') return;
    p.seatIndex = null;
    this.broadcastLobby();
  }

  private handleConfigure(p: Participant, playerCount: 2 | 3 | 4, seatKinds: readonly SeatKind[]): void {
    if (!this.isHost(p)) { this.reject(p, 'only the host can configure'); return; }
    if (this.phase !== 'lobby') { this.reject(p, 'game already started'); return; }
    if (![2, 3, 4].includes(playerCount)) { this.reject(p, 'invalid player count'); return; }
    // Normalise seatKinds to exactly playerCount entries.
    const kinds: SeatKind[] = [];
    for (let i = 0; i < playerCount; i++) {
      const k = seatKinds[i];
      kinds.push(k === 'open' || (typeof k === 'string' && k.startsWith('bot:')) ? k : 'open');
    }
    this.playerCount = playerCount;
    this.seatKinds = kinds;
    // Drop any claim that no longer points at a valid open seat.
    for (const c of this.clients.values()) {
      if (c.seatIndex !== null && (c.seatIndex >= playerCount || kinds[c.seatIndex] !== 'open')) {
        c.seatIndex = null;
      }
    }
    this.broadcastLobby();
  }

  private handleStart(p: Participant): void {
    if (!this.isHost(p)) { this.reject(p, 'only the host can start'); return; }
    if (this.phase !== 'lobby') { this.reject(p, 'already started'); return; }

    // Seat kinds → engine seats. A seat explicitly set to a bot uses that bot; an open
    // seat claimed by a connected player is a human; an open seat nobody claimed is filled
    // with the default bot so the host can always start (bots are first-class LAN players).
    const seats: Seat[] = this.seatKinds.map((kind, index) => {
      if (kind !== 'open') {
        const bt = botById(kind.slice('bot:'.length));
        return { kind: 'bot', bot: bt.fn, label: bt.label } as Seat;
      }
      const claimed = [...this.clients.values()].some(c => c.connected && c.seatIndex === index);
      if (claimed) return { kind: 'human' } as Seat;
      const bt = botById(DEFAULT_FILL_BOT);
      return { kind: 'bot', bot: bt.fn, label: bt.label } as Seat;
    });

    const session = new GameSession(this.createSeed(), seats);
    session.setBotDelay(this.botDelayMs);
    if (this.factoryOpTimeoutMs !== undefined) session.setPendingTimeout(this.factoryOpTimeoutMs);
    if (this.roundEndTimeoutMs !== undefined) session.setRoundEndTimeout(this.roundEndTimeoutMs);
    this.session = session;
    this.phase = 'playing';
    this.unsubSession = session.subscribe(() => this.broadcastSnapshot());
    this.broadcastSnapshot();  // initial state (subscribe won't fire until an action)
    session.start();           // kick off any leading bot turns
  }

  private handleReturnToLobby(p: Participant): void {
    if (!this.isHost(p)) { this.reject(p, 'only the host can return to lobby'); return; }
    this.teardownSession();
    this.phase = 'lobby';
    // Keep seat claims so a rematch is one click; drop stale ones just in case.
    for (const c of this.clients.values()) {
      if (c.seatIndex !== null && (c.seatIndex >= this.playerCount || this.seatKinds[c.seatIndex] !== 'open')) {
        c.seatIndex = null;
      }
    }
    this.broadcastLobby();
  }

  // ── In-game action requests ──────────────────────────────────────────────────

  private handleAction(p: Participant, action: Action): void {
    if (this.phase !== 'playing' || !this.session) { this.reject(p, 'no game in progress'); return; }
    const session = this.session;
    if (p.seatIndex === null || session.seats[p.seatIndex]?.kind !== 'human') {
      this.reject(p, 'you are a spectator'); return;
    }
    if (session.state.gameOver) { this.reject(p, 'game is over'); return; }
    // A factory activation is resolved by its OWNER, even on another player's turn; the
    // GameSession validates ownership. All other actions require it to be your turn.
    const isOwnPendingOp =
      (action.type === 'OPERATE_BUILDING' || action.type === 'SKIP_FACTORY_ROLL') &&
      action.ownerId === (p.seatIndex as PlayerId) &&
      session.state.pendingFactoryOps.some(e => e.pieceId === action.pieceId && e.ownerId === p.seatIndex);
    if (!isOwnPendingOp && session.activePlayerId !== (p.seatIndex as PlayerId)) {
      this.reject(p, 'not your turn'); return;
    }
    // The engine is the source of truth for legality; a false return means illegal.
    const ok = session.applyHumanAction(action);
    if (!ok) this.reject(p, 'illegal move');
    // On success the session emits → broadcastSnapshot (via the subscription). Bot turns
    // that follow also emit and broadcast, so remote players see the whole sequence.
  }

  // Relay a seated player's ephemeral UI intent to everyone else so they can watch it live.
  // Pure pass-through: never touches the engine, snapshot, or action log. Tagged with the
  // sender's seat so receivers only render the CURRENT player's presence.
  private handlePresence(p: Participant, presence: PresenceState): void {
    if (this.phase !== 'playing' || p.seatIndex === null) return;
    const playerId = p.seatIndex as PlayerId;
    for (const c of this.clients.values()) {
      if (c.connected && c.clientId !== p.clientId) {
        this.transport.send(c.clientId, { type: 'presence', playerId, presence });
      }
    }
  }

  // ── Broadcasting ─────────────────────────────────────────────────────────────

  private broadcastLobby(): void {
    const lobby = this.buildLobbyView();
    for (const c of this.clients.values()) {
      if (c.connected) this.transport.send(c.clientId, { type: 'lobby', lobby });
    }
  }

  private broadcastSnapshot(): void {
    if (!this.session) return;
    for (const c of this.clients.values()) {
      if (c.connected) {
        this.transport.send(c.clientId, { type: 'snapshot', snapshot: this.buildSnapshot(c) });
      }
    }
  }

  private sendCurrentTo(clientId: string): void {
    const c = this.clients.get(clientId);
    if (!c) return;
    if (this.phase === 'lobby') {
      this.transport.send(clientId, { type: 'lobby', lobby: this.buildLobbyView() });
    } else if (this.session) {
      this.transport.send(clientId, { type: 'snapshot', snapshot: this.buildSnapshot(c) });
    }
  }

  private buildLobbyView(): LobbyView {
    const seats: LobbySeatView[] = this.seatKinds.map((kind, index) => {
      const claimant = [...this.clients.values()].find(c => c.connected && c.seatIndex === index) ?? null;
      return {
        index,
        kind,
        claimedByClientId: claimant?.clientId ?? null,
        claimedByName: claimant?.name ?? null,
      };
    });
    const clients: LobbyClientView[] = [...this.clients.values()]
      .filter(c => c.connected)
      .sort((a, b) => a.joinOrder - b.joinOrder)
      .map(c => ({ clientId: c.clientId, name: c.name, seatIndex: c.seatIndex }));
    return {
      phase: 'lobby',
      playerCount: this.playerCount,
      seats,
      clients,
      hostClientId: this.getHost()?.clientId ?? null,
      canStart: this.canStart(),
      allSeatsClaimed: this.allSeatsClaimed(),
    };
  }

  private buildSnapshot(forClient: Participant): StateSnapshot {
    const session = this.session!;
    const seats: SeatInfo[] = session.seats.map((s, i) => {
      const owner = s.kind === 'human'
        ? [...this.clients.values()].find(c => c.seatIndex === i) ?? null
        : null;
      return {
        kind: s.kind,
        label: s.kind === 'human' ? 'Human' : s.label,
        ownerName: owner?.name ?? null,
      };
    });
    const yourPlayerId: PlayerId | null =
      forClient.seatIndex !== null && session.seats[forClient.seatIndex]?.kind === 'human'
        ? (forClient.seatIndex as PlayerId)
        : null;
    return {
      phase: 'playing',
      state: session.state,
      seats,
      yourPlayerId,
      log: [...session.getLog()],
      lastRollEvents: [...session.lastRollEvents],
      lastDrawnCardInfo: session.lastDrawnCardInfo,
      hostClientId: this.getHost()?.clientId ?? null,
      gameOver: session.state.gameOver,
      actionTimeoutRemainingMs: session.actionDeadline !== null
        ? Math.max(0, session.actionDeadline - Date.now())
        : null,
    };
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────

  private reject(p: Participant, reason: string): void {
    this.transport.send(p.clientId, { type: 'rejected', reason });
  }

  private getHost(): Participant | null {
    let host: Participant | null = null;
    for (const c of this.clients.values()) {
      if (!c.connected) continue;
      if (!host || c.joinOrder < host.joinOrder) host = c;
    }
    return host;
  }

  private isHost(p: Participant): boolean {
    return this.getHost()?.clientId === p.clientId;
  }

  private firstFreeOpenSeat(): number | null {
    for (let i = 0; i < this.playerCount; i++) {
      if (this.seatKinds[i] !== 'open') continue;
      const taken = [...this.clients.values()].some(c => c.connected && c.seatIndex === i);
      if (!taken) return i;
    }
    return null;
  }

  // The host can start whenever the room is set up; any open seat left unclaimed is filled
  // with a bot at start (see handleStart). We surface `allSeatsClaimed` separately so the UI
  // can tell the host how empty seats will be filled, without blocking the Start button.
  private canStart(): boolean {
    return this.phase === 'lobby' && this.getHost() !== null && this.seatKinds.length === this.playerCount;
  }

  private allSeatsClaimed(): boolean {
    for (let i = 0; i < this.playerCount; i++) {
      if (this.seatKinds[i] !== 'open') continue;
      const claimed = [...this.clients.values()].some(c => c.connected && c.seatIndex === i);
      if (!claimed) return false;
    }
    return true;
  }

  private teardownSession(): void {
    this.unsubSession?.();
    this.unsubSession = null;
    this.session?.stop();
    this.session = null;
  }
}
