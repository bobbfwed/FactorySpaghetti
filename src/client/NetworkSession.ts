// A ClientSession backed by the LAN host. It mirrors GameSession's surface so the board,
// action panel, and render loop run unchanged whether play is local or networked.
//
// Model: the host is authoritative. On a human action we optimistically apply it locally
// (via the same pure engine) so the UI stays responsive and multi-step sequences — belt
// routes, load→operate→collect — validate against the just-updated state; simultaneously
// we send the action request to the host. The host validates and broadcasts a full
// snapshot, which we adopt verbatim (last-writer-wins). Because the engine is deterministic
// and the host replays the identical action, the optimistic state matches the echo; the
// echo also carries any following bot turns, so we simply jump forward. If the host ever
// rejects (a stale optimistic apply), we resync to the authoritative state.

import type { GameState, PlayerId } from '../engine/state';
import type { Action } from '../engine/actions';
import { applyAction } from '../engine/reducer';
import { PLAY_ON_DRAW_CARDS } from '../engine/config';
import type { ClientSession, SeatView, StateListener } from './GameSession';
import type { NetClient } from './net';
import type { StateSnapshot } from '../server/protocol';

export class NetworkSession implements ClientSession {
  state: GameState;
  seats: readonly SeatView[] = [];
  lastRollEvents: readonly string[] = [];
  lastDrawnCardInfo: { readonly cardType: string; readonly playedOnDraw: boolean } | null = null;

  private myPlayerId: PlayerId | null = null;
  private gameOver = false;
  private log: readonly string[] = [];
  private listeners: StateListener[] = [];
  // Local epoch-ms deadline for the current timed auto-action, derived from the snapshot's
  // remaining time (so the countdown is immune to host/client clock skew). null = none.
  actionDeadline: number | null = null;

  constructor(private readonly net: NetClient, initial: StateSnapshot) {
    this.state = initial.state;
    this.adopt(initial);
  }

  // Replace all local view state with an authoritative host snapshot.
  private adopt(snap: StateSnapshot): void {
    this.state = snap.state;
    this.seats = snap.seats.map(s => ({ kind: s.kind, ...(s.label ? { label: s.label } : {}) }));
    this.myPlayerId = snap.yourPlayerId;
    this.log = snap.log;
    this.lastRollEvents = snap.lastRollEvents;
    this.lastDrawnCardInfo = snap.lastDrawnCardInfo;
    this.gameOver = snap.gameOver;
    this.actionDeadline = snap.actionTimeoutRemainingMs !== null
      ? Date.now() + snap.actionTimeoutRemainingMs
      : null;
  }

  /** Called by main.ts whenever the host broadcasts a new snapshot. */
  applySnapshot(snap: StateSnapshot): void {
    this.adopt(snap);
    this.emit();
  }

  subscribe(fn: StateListener): () => void {
    this.listeners.push(fn);
    return () => { this.listeners = this.listeners.filter(l => l !== fn); };
  }

  private emit(): void { for (const fn of this.listeners) fn(this.state); }

  getLog(): readonly string[] { return this.log; }

  private get activePlayerId(): PlayerId {
    return (this.state.turnOrder[this.state.activePlayerIndex] ?? 0) as PlayerId;
  }

  // A spectator (no seat) watches the active player's board; a seated player sees their own.
  get viewPlayerId(): PlayerId {
    return this.myPlayerId ?? this.activePlayerId;
  }

  isHumanTurn(): boolean {
    if (this.gameOver || this.myPlayerId === null) return false;
    return this.activePlayerId === this.myPlayerId;
  }

  // A human may resolve their own pending factory activation off-turn (roll on anyone's turn).
  private isOwnPendingOp(action: Action): boolean {
    if (action.type !== 'OPERATE_BUILDING' && action.type !== 'SKIP_FACTORY_ROLL') return false;
    return this.myPlayerId !== null && action.ownerId === this.myPlayerId &&
      this.state.pendingFactoryOps.some(e => e.pieceId === action.pieceId && e.ownerId === this.myPlayerId);
  }

  applyHumanAction(action: Action): boolean {
    if (!this.isHumanTurn() && !this.isOwnPendingOp(action)) return false;
    const prev = this.state;
    const result = applyAction(prev, action);
    if (!result.ok) return false; // illegal — don't send; matches local GameSession behaviour

    // Optimistic local apply so the UI updates immediately and chained actions validate.
    this.state = result.state;
    if (action.type === 'BUY_CARD' && prev.cardDeck.length > 0) {
      const drawn = prev.cardDeck[0]!;
      this.lastDrawnCardInfo = { cardType: drawn, playedOnDraw: PLAY_ON_DRAW_CARDS.has(drawn) };
    } else {
      this.lastDrawnCardInfo = null;
    }
    // The authoritative log/roll events arrive with the host's echo snapshot.
    this.net.sendAction(action);
    this.emit();
    return true;
  }

  // Bot pacing is decided by the host; local no-op keeps the ClientSession contract.
  setBotDelay(_ms: number): void { /* host-controlled */ }
  start(): void { /* the game is already running on the host */ }
  stop(): void { this.net.disconnect(); }
}
