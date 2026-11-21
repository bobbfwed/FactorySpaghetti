// Browser WebSocket client for LAN play. Thin transport: it connects, (re)sends the
// `hello` handshake (replaying a stored token so a dropped connection reclaims its seat),
// decodes server messages into typed callbacks, and exposes request senders. All game
// state lives in the snapshots it hands to NetworkSession — this file holds no rules.

import {
  encode,
  decodeServerMessage,
  type ClientMessage,
  type SeatKind,
  type LobbyView,
  type StateSnapshot,
  type PresenceState,
} from '../server/protocol';
import type { Action } from '../engine/actions';
import type { PlayerId } from '../engine/state';

export interface NetHandlers {
  onOpen?(): void;
  onWelcome?(m: { clientId: string; token: string; isHost: boolean }): void;
  onLobby?(lobby: LobbyView): void;
  onSnapshot?(snapshot: StateSnapshot): void;
  onPresence?(playerId: PlayerId, presence: PresenceState): void;
  onRejected?(reason: string): void;
  onError?(message: string): void;
  onClose?(willReconnect: boolean): void;
}

const RECONNECT_DELAY_MS = 1000;
const MAX_RECONNECT_ATTEMPTS = 10;

export class NetClient {
  private ws: WebSocket | null = null;
  private url = '';
  private name = 'Player';
  private token: string | undefined;
  private closedByUser = false;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly handlers: NetHandlers) {}

  /** Open a connection. `token` (if known) reclaims a prior identity on the host. */
  connect(url: string, name: string, token?: string): void {
    this.url = url;
    this.name = name;
    this.token = token;
    this.closedByUser = false;
    this.reconnectAttempts = 0;
    this.open();
  }

  isHost = false;

  get currentToken(): string | undefined { return this.token; }

  private open(): void {
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.url);
    } catch {
      this.handlers.onError?.(`invalid server address: ${this.url}`);
      return;
    }
    this.ws = ws;

    ws.onopen = () => {
      this.reconnectAttempts = 0;
      this.sendMsg({
        type: 'hello',
        name: this.name,
        ...(this.token ? { token: this.token } : {}),
      });
      this.handlers.onOpen?.();
    };

    ws.onmessage = ev => this.receive(String(ev.data));

    ws.onerror = () => this.handlers.onError?.('connection error');

    ws.onclose = () => {
      this.ws = null;
      const willReconnect = !this.closedByUser && this.reconnectAttempts < MAX_RECONNECT_ATTEMPTS;
      this.handlers.onClose?.(willReconnect);
      if (willReconnect) this.scheduleReconnect();
    };
  }

  private scheduleReconnect(): void {
    this.reconnectAttempts++;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => this.open(), RECONNECT_DELAY_MS);
  }

  private receive(raw: string): void {
    const msg = decodeServerMessage(raw);
    if (!msg) return;
    switch (msg.type) {
      case 'welcome':
        this.token = msg.token;   // persist across reconnects
        this.isHost = msg.isHost;
        this.handlers.onWelcome?.({ clientId: msg.clientId, token: msg.token, isHost: msg.isHost });
        break;
      case 'lobby':    this.handlers.onLobby?.(msg.lobby); break;
      case 'snapshot': this.handlers.onSnapshot?.(msg.snapshot); break;
      case 'presence': this.handlers.onPresence?.(msg.playerId, msg.presence); break;
      case 'rejected': this.handlers.onRejected?.(msg.reason); break;
      case 'error':    this.handlers.onError?.(msg.message); break;
    }
  }

  private sendMsg(m: ClientMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(encode(m));
  }

  // ── Requests ──────────────────────────────────────────────────────────────
  claimSeat(seatIndex: number): void { this.sendMsg({ type: 'claimSeat', seatIndex }); }
  releaseSeat(): void { this.sendMsg({ type: 'releaseSeat' }); }
  configure(playerCount: 2 | 3 | 4, seatKinds: SeatKind[]): void {
    this.sendMsg({ type: 'configure', playerCount, seatKinds });
  }
  start(): void { this.sendMsg({ type: 'start' }); }
  sendAction(action: Action): void { this.sendMsg({ type: 'action', action }); }
  sendPresence(presence: PresenceState): void { this.sendMsg({ type: 'presence', presence }); }
  resync(): void { this.sendMsg({ type: 'resync' }); }
  returnToLobby(): void { this.sendMsg({ type: 'returnToLobby' }); }

  disconnect(): void {
    this.closedByUser = true;
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    this.ws?.close();
    this.ws = null;
  }
}
