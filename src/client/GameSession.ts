// Manages a single game session: state transitions, bot automation, and the game log.

import type { GameState, PlayerId } from '../engine/state';
import type { Action } from '../engine/actions';
import type { BotFn } from '../bots/botInterface';
import { createGame } from '../engine/rules/setup';
import { applyAction, legalActions } from '../engine/reducer';
import { factoryOperatePowerCost, factoryExpectedProduct } from '../engine/rules/production';
import { PLAY_ON_DRAW_CARDS, FACTORY_OP_TIMEOUT_MS, ROUND_END_TIMEOUT_MS } from '../engine/config';
import { PLAYER_NAMES } from './render/colors';

export type StateListener = (state: GameState) => void;

// One seat per player id (index = player id). Humans act through the UI; bots step
// automatically using their chosen personality.
export type Seat =
  | { readonly kind: 'human'; readonly label?: string }
  | { readonly kind: 'bot'; readonly bot: BotFn; readonly label: string };

// Display-only view of a seat (no bot function) — the UI only needs kind + label.
// Both the local GameSession and the networked NetworkSession expose seats as these.
export interface SeatView {
  readonly kind: 'human' | 'bot';
  readonly label?: string;
}

// The surface the client UI (main.ts) drives a game through, satisfied by both the
// local GameSession and the LAN NetworkSession. This is the seam that lets the same
// board/panel/render code run local hot-seat or networked play unchanged.
export interface ClientSession {
  readonly state: GameState;
  readonly seats: readonly SeatView[];
  readonly lastRollEvents: readonly string[];
  readonly lastDrawnCardInfo: { readonly cardType: string; readonly playedOnDraw: boolean } | null;
  readonly viewPlayerId: PlayerId;
  // Epoch ms when the current timed auto-action (operate / round-end) fires, or null.
  readonly actionDeadline: number | null;
  subscribe(fn: StateListener): () => void;
  getLog(): readonly string[];
  isHumanTurn(): boolean;
  applyHumanAction(action: Action): boolean;
  setBotDelay(ms: number): void;
  start(): void;
  stop(): void;
}

export class GameSession implements ClientSession {
  state: GameState;
  readonly seats: readonly Seat[];
  lastRollEvents: readonly string[] = [];
  lastDrawnCardInfo: { cardType: string; playedOnDraw: boolean } | null = null;
  private readonly log: string[] = [];
  private listeners: StateListener[] = [];
  private botDelayMs: number = 400;
  private stopped = false;
  private pendingTimeoutMs: number = FACTORY_OP_TIMEOUT_MS;
  private pendingTimer: ReturnType<typeof setTimeout> | null = null;
  private roundEndTimeoutMs: number = ROUND_END_TIMEOUT_MS;
  private roundEndTimer: ReturnType<typeof setTimeout> | null = null;
  // Epoch ms when the current auto-advance timer fires (null = none). Exposed for the UI countdown.
  private deadline: number | null = null;

  constructor(seed: number, seats: readonly Seat[]) {
    const playerCount = seats.length as 2 | 3 | 4;
    this.state = createGame(seed, playerCount);
    this.seats = seats;
    const summary = seats.map((s, i) => `P${i + 1}:${s.kind === 'human' ? 'Human' : s.label}`).join(', ');
    this.addLog(`Game started (seed: ${seed}, ${playerCount} players — ${summary})`);
  }

  setBotDelay(ms: number): void { this.botDelayMs = ms; }

  /** Timeout before an undecided factory activation auto-operates (host-adjustable). */
  setPendingTimeout(ms: number): void { this.pendingTimeoutMs = ms; }

  /** Timeout before an idle round-end turn auto-ends (host-adjustable). */
  setRoundEndTimeout(ms: number): void { this.roundEndTimeoutMs = ms; }

  /** Epoch ms when the current auto-advance timer fires, or null. Drives the UI countdown. */
  get actionDeadline(): number | null { return this.deadline; }

  /** Call once after all subscribers are attached to kick off any initial bot turns. */
  start(): void { this.scheduleBotTurns(); }

  /** Stop scheduling bot turns (used when replacing the session with a new game). */
  stop(): void { this.stopped = true; this.clearAllTimers(); }

  subscribe(fn: StateListener): () => void {
    this.listeners.push(fn);
    return () => { this.listeners = this.listeners.filter(l => l !== fn); };
  }

  private emit(): void { for (const fn of this.listeners) fn(this.state); }

  getLog(): readonly string[] { return this.log; }

  /** The player id whose turn it currently is. */
  get activePlayerId(): PlayerId {
    return (this.state.turnOrder[this.state.activePlayerIndex] ?? 0) as PlayerId;
  }

  /** Which player's perspective the UI should show: the active player when a human is
   *  acting (or spectating an all-bot/hotseat game), but a lone human keeps watching their
   *  own panel while bots move. */
  get viewPlayerId(): PlayerId {
    const active = this.activePlayerId;
    if (this.seats[active]?.kind === 'human') return active;
    const humanIds = this.seats
      .map((s, i) => (s.kind === 'human' ? i : -1))
      .filter(i => i >= 0);
    return (humanIds.length === 1 ? humanIds[0]! : active) as PlayerId;
  }

  isHumanTurn(): boolean {
    if (this.state.gameOver) return false;
    return this.seats[this.activePlayerId]?.kind === 'human';
  }

  // A human may resolve their OWN pending factory activation even when it isn't their turn
  // (a roll on anyone's turn activates their factories).
  private isOwnPendingOp(action: Action): boolean {
    if (action.type !== 'OPERATE_BUILDING' && action.type !== 'SKIP_FACTORY_ROLL') return false;
    const owner = action.ownerId;
    if (owner === undefined || this.seats[owner]?.kind !== 'human') return false;
    return this.state.pendingFactoryOps.some(e => e.pieceId === action.pieceId && e.ownerId === owner);
  }

  /** Apply a human-chosen action. Returns true on success. */
  applyHumanAction(action: Action): boolean {
    // Normal actions require it to be the human's turn; pending factory activations are
    // owner-gated instead, so they resolve on anyone's turn.
    if (!this.isHumanTurn() && !this.isOwnPendingOp(action)) return false;
    const prevState = this.state;
    // Clear drawn-card notice at start of any non-BUY_CARD action
    if (action.type !== 'BUY_CARD') {
      this.lastDrawnCardInfo = null;
    }
    const result = applyAction(this.state, action);
    if (!result.ok) return false;
    if (action.type === 'ROLL_DICE') {
      this.lastRollEvents = computeRollEvents(prevState, result.state, action.rolls);
    }
    if (action.type === 'BUY_CARD' && prevState.cardDeck.length > 0) {
      const drawnCard = prevState.cardDeck[0]!;
      this.lastDrawnCardInfo = { cardType: drawnCard, playedOnDraw: PLAY_ON_DRAW_CARDS.has(drawnCard) };
    }
    this.logAction(prevState.turnOrder[prevState.activePlayerIndex] ?? 0, action, this.state);
    if (action.type === 'PLACE_BELT' || action.type === 'CLAIM_BUILDING') {
      this.logFlowEvents(prevState, result.state);
    }
    if (action.type === 'OPERATE_BUILDING' || action.type === 'COLLECT_OUTPUT') {
      this.logBuildingActionResult(action.type, action.pieceId, prevState, result.state);
    }
    this.state = result.state;
    // Any human action resets the round-end inactivity timer (advance re-arms it fresh),
    // so an actively-playing human is never auto-advanced mid-sequence.
    this.clearRoundEndTimer();
    this.advance();
    return true;
  }

  // ── Pending factory-activation resolution ─────────────────────────────────────

  private humanPendingExists(): boolean {
    return this.state.pendingFactoryOps.some(e => this.seats[e.ownerId]?.kind === 'human');
  }

  // Off-turn human pending is the case the timeout guards (a roll on someone else's turn
  // activated your factory). On your own turn you decide at your own pace — no timer.
  private hasOffTurnHumanPending(): boolean {
    const active = this.activePlayerId;
    return this.state.pendingFactoryOps.some(
      e => this.seats[e.ownerId]?.kind === 'human' && e.ownerId !== active,
    );
  }

  // Resolve every bot-owned pending activation immediately using that bot's own policy.
  private settleBotPendingOps(): void {
    let guard = 0;
    while (!this.stopped && !this.state.gameOver && guard++ < 1000) {
      const entry = this.state.pendingFactoryOps.find(e => this.seats[e.ownerId]?.kind === 'bot');
      if (!entry) break;
      const seat = this.seats[entry.ownerId];
      if (!seat || seat.kind !== 'bot') break;
      let action: Action;
      try {
        action = seat.bot(this.state, entry.ownerId);
      } catch {
        action = { type: 'SKIP_FACTORY_ROLL', pieceId: entry.pieceId, ownerId: entry.ownerId };
      }
      const res = applyAction(this.state, action);
      if (!res.ok) {
        // Fall back to a guaranteed-legal skip so we never stall on a bad bot action.
        const skip = applyAction(this.state, { type: 'SKIP_FACTORY_ROLL', pieceId: entry.pieceId, ownerId: entry.ownerId });
        if (!skip.ok) break;
        this.state = skip.state;
      } else {
        if (action.type === 'OPERATE_BUILDING') {
          this.logBuildingActionResult('OPERATE_BUILDING', action.pieceId, this.state, res.state);
        }
        this.state = res.state;
      }
    }
  }

  // Advance after any state change: settle bots' activations, update the countdown timers,
  // render, then resume bot turns unless we're waiting on a human.
  private advance(): void {
    this.settleBotPendingOps();
    this.updateTurnTimers();
    this.emit();
    if (!this.humanPendingExists() && !this.isHumanTurn()) this.scheduleBotTurns();
  }

  // ── Timed events (countdowns) ─────────────────────────────────────────────────
  // Two auto-advance timers, never active at once (different phases):
  //   • pending factory op — an OFF-TURN human activation auto-operates after a timeout.
  //   • round-end turn      — an idle human's claim/upgrade turn auto-ends after a timeout.
  // `deadline` is the epoch-ms fire time of whichever is armed (null = none), exposed so the
  // UI can show a countdown; it's set once on arm and left alone while counting down.

  // Decide which timer should be running for the current state and arm/clear accordingly.
  private updateTurnTimers(): void {
    if (this.stopped || this.state.gameOver) { this.clearAllTimers(); return; }
    if (this.hasOffTurnHumanPending()) { this.clearRoundEndTimer(); this.armPendingTimer(); return; }
    if (this.isHumanTurn() && this.state.phase === 'roundEnd') { this.clearPendingTimer(); this.armRoundEndTimer(); return; }
    this.clearAllTimers();
  }

  private armPendingTimer(): void {
    if (this.pendingTimer !== null) return;          // already counting down
    if (this.pendingTimeoutMs <= 0) { this.resolvePendingByTimeout(); return; }
    this.deadline = this.now() + this.pendingTimeoutMs;
    this.pendingTimer = setTimeout(() => { this.pendingTimer = null; this.resolvePendingByTimeout(); }, this.pendingTimeoutMs);
  }

  private armRoundEndTimer(): void {
    if (this.roundEndTimer !== null) return;
    if (this.roundEndTimeoutMs <= 0) return; // <=0 disables the round-end timer (no auto-end)
    this.deadline = this.now() + this.roundEndTimeoutMs;
    this.roundEndTimer = setTimeout(() => { this.roundEndTimer = null; this.resolveRoundEndByTimeout(); }, this.roundEndTimeoutMs);
  }

  private clearPendingTimer(): void {
    if (this.pendingTimer !== null) { clearTimeout(this.pendingTimer); this.pendingTimer = null; this.deadline = null; }
  }
  private clearRoundEndTimer(): void {
    if (this.roundEndTimer !== null) { clearTimeout(this.roundEndTimer); this.roundEndTimer = null; this.deadline = null; }
  }
  private clearAllTimers(): void { this.clearPendingTimer(); this.clearRoundEndTimer(); }

  private now(): number { return Date.now(); }

  // Timeout default: OPERATE each undecided OFF-TURN human activation when affordable, else
  // SKIP. The active player's own activations are left for them to decide at their own pace.
  private resolvePendingByTimeout(): void {
    if (this.stopped) return;
    this.deadline = null;
    const active = this.activePlayerId;
    for (const entry of this.state.pendingFactoryOps.filter(
      e => this.seats[e.ownerId]?.kind === 'human' && e.ownerId !== active,
    )) {
      const op: Action = { type: 'OPERATE_BUILDING', pieceId: entry.pieceId, ownerId: entry.ownerId };
      const res = applyAction(this.state, op);
      if (res.ok) {
        this.logBuildingActionResult('OPERATE_BUILDING', entry.pieceId, this.state, res.state);
        this.addLog(`${PLAYER_NAMES[entry.ownerId] ?? `P${entry.ownerId}`}: auto-operated (no response)`);
        this.state = res.state;
      } else {
        const skip = applyAction(this.state, { type: 'SKIP_FACTORY_ROLL', pieceId: entry.pieceId, ownerId: entry.ownerId });
        if (skip.ok) this.state = skip.state;
      }
    }
    this.advance();
  }

  // Timeout default for an idle round-end turn: end it (advance to the next player).
  private resolveRoundEndByTimeout(): void {
    if (this.stopped) return;
    this.deadline = null;
    const activeId = this.activePlayerId;
    const res = applyAction(this.state, { type: 'END_ACTIONS' });
    if (res.ok) {
      this.addLog(`${PLAYER_NAMES[activeId] ?? `P${activeId}`}: round-end turn timed out — auto-ended`);
      this.state = res.state;
    }
    this.advance();
  }

  /** Called after a human action to auto-advance bot turns.
   *  delay > 0: one step per timer tick (animated). delay <= 0: run all pending bot
   *  turns synchronously and render once ("instant"). */
  private scheduleBotTurns(): void {
    if (this.stopped || this.state.gameOver) return;
    if (this.humanPendingExists() || this.isHumanTurn()) { this.updateTurnTimers(); return; }
    if (this.botDelayMs <= 0) { this.runBotsInstantly(); return; }
    setTimeout(() => this.stepBot(), this.botDelayMs);
  }

  // Animated path: perform one bot action, render, then schedule the next.
  private stepBot(): void {
    if (this.stopped || this.state.gameOver) return;
    if (this.humanPendingExists() || this.isHumanTurn()) { this.updateTurnTimers(); return; }
    if (this.botDelayMs <= 0) { this.runBotsInstantly(); return; }
    if (!this.doOneBotStep()) return;
    this.settleBotPendingOps();
    if (this.humanPendingExists() || this.isHumanTurn()) { this.updateTurnTimers(); this.emit(); return; }
    this.emit();
    setTimeout(() => this.stepBot(), this.botDelayMs);
  }

  // Instant path: run bot turns back-to-back with no timers or intermediate renders,
  // stopping at the next human turn / human decision / game over, then render once. The step
  // cap is a safety net against an engine or bot stall (should never be reached in practice).
  private runBotsInstantly(): void {
    const MAX_STEPS = 100_000;
    let steps = 0;
    while (!this.stopped && !this.state.gameOver && !this.isHumanTurn() && !this.humanPendingExists() && steps < MAX_STEPS) {
      if (!this.doOneBotStep()) break; // no legal action / bot error — avoid spinning
      this.settleBotPendingOps();
      steps++;
    }
    this.updateTurnTimers();
    this.emit();
  }

  // Apply a single bot action (no render). Returns false if the active seat can't act,
  // so callers can stop. Mirrors the logging done for human actions.
  private doOneBotStep(): boolean {
    if (this.state.gameOver || this.isHumanTurn()) return false;
    const playerId = this.state.turnOrder[this.state.activePlayerIndex];
    if (playerId === undefined) return false;
    const seat = this.seats[playerId];
    if (!seat || seat.kind !== 'bot') return false;

    let action: Action;
    if (this.state.phase === 'roll') {
      const rolls = Array.from({ length: this.state.mineCount }, () =>
        Math.floor(Math.random() * 6) + 1,
      );
      action = { type: 'ROLL_DICE', rolls };
    } else {
      const actions = legalActions(this.state, playerId);
      if (actions.length === 0) return false;
      try {
        action = seat.bot(this.state, playerId);
      } catch {
        return false;
      }
    }

    const prevState = this.state;
    const result = applyAction(this.state, action);
    if (!result.ok) return false;
    if (action.type === 'ROLL_DICE') {
      this.lastRollEvents = computeRollEvents(prevState, result.state, action.rolls);
    }
    this.logAction(playerId, action, this.state);
    if (action.type === 'PLACE_BELT' || action.type === 'CLAIM_BUILDING') {
      this.logFlowEvents(prevState, result.state);
    }
    this.state = result.state;
    return true;
  }

  private logFlowEvents(before: GameState, after: GameState): void {
    for (const afterPiece of after.board) {
      if (!afterPiece.input) continue;
      const beforePiece = before.board.find(p => p.id === afterPiece.id);
      if (!beforePiece?.input) continue;
      for (let i = 0; i < afterPiece.input.slots.length; i++) {
        const bSlot = beforePiece.input.slots[i];
        const aSlot = afterPiece.input.slots[i];
        if (bSlot === null && aSlot !== null) {
          const typeLabel = PIECE_TYPE_LABEL[afterPiece.type] ?? afterPiece.type;
          this.addLog(`→ ${aSlot} flowed into ${typeLabel} input`);
        }
      }
    }
  }

  // Narrate the result of operating a building (product → output buffer, power
  // tokens, or teleporter-diverted) or collecting its output buffer to inventory.
  private logBuildingActionResult(
    actionType: 'OPERATE_BUILDING' | 'COLLECT_OUTPUT',
    pieceId: string,
    before: GameState,
    after: GameState,
  ): void {
    const activeId = before.turnOrder[before.activePlayerIndex] ?? 0;
    const prevPlayer = before.players[activeId];
    const afterPlayer = after.players[activeId];
    if (!prevPlayer || !afterPlayer) return;

    const piece = before.board.find(p => p.id === pieceId);
    const name = PIECE_TYPE_LABEL[piece?.type ?? ''] ?? pieceId;
    const MATS = ['ore', 'plate', 'sphere', 'tesseract'] as const;

    const invDelta = (mat: typeof MATS[number]) =>
      (afterPlayer.inventory[mat] ?? 0) - (prevPlayer.inventory[mat] ?? 0);

    if (actionType === 'COLLECT_OUTPUT') {
      for (const mat of MATS) {
        const d = invDelta(mat);
        if (d > 0) this.addLog(`⬇ ${name}: collected ${d} ${mat} → inventory`);
      }
      return;
    }

    // OPERATE_BUILDING
    const powerDelta = afterPlayer.powerTokens - prevPlayer.powerTokens;
    if (piece?.type === 'powerPlant') {
      if (powerDelta > 0) this.addLog(`⚙ ${name}: +${powerDelta} power token(s)`);
      return;
    }

    // Output teleporter may have diverted the product straight to inventory.
    let diverted = false;
    for (const mat of MATS) {
      const d = invDelta(mat);
      if (d > 0) { this.addLog(`⚙ ${name}: +${d} ${mat} → inventory (teleporter)`); diverted = true; }
    }
    if (diverted) return;

    const afterPiece = after.board.find(p => p.id === pieceId);
    const product = afterPiece?.output?.slots.find(s => s !== null);
    if (product) {
      this.addLog(`⚙ ${name}: produced ${product} → output buffer (collect it with a meeple)`);
    }
  }

  private addLog(msg: string): void {
    this.log.push(msg);
    if (this.log.length > 400) this.log.splice(0, this.log.length - 400);
  }

  private logAction(playerId: PlayerId, action: Action, _prevState: GameState): void {
    const name = PLAYER_NAMES[playerId] ?? `P${playerId}`;
    this.addLog(`${name}: ${describeAction(action)}`);
  }
}

const PIECE_TYPE_LABEL: Partial<Record<string, string>> = {
  plateFact:     'Plate Factory',
  sphereFact:    'Sphere Factory',
  tesseractFact: 'Tesseract Factory',
  powerPlant:    'Power Plant',
};

function computeRollEvents(before: GameState, after: GameState, rolls: readonly number[]): string[] {
  const events: string[] = [];
  const sum = rolls.reduce((a, b) => a + b, 0);
  events.push(`Rolled [${rolls.join(', ')}] → ${sum}`);

  for (const afterPiece of after.board) {
    const beforePiece = before.board.find(p => p.id === afterPiece.id);
    if (!beforePiece) continue;

    // Check if this piece had a claim activating on this roll
    const activatingClaim = beforePiece.claims.find(c => c.controlModule === sum);
    if (!activatingClaim) continue;

    const owner = PLAYER_NAMES[activatingClaim.ownerId] ?? `P${activatingClaim.ownerId + 1}`;
    const typeLabel = PIECE_TYPE_LABEL[beforePiece.type] ?? beforePiece.type;

    if (afterPiece.output && beforePiece.output) {
      // Factory activated — deferred to its owner's operate/skip decision.
      if (after.pendingFactoryOps.some(e => e.pieceId === afterPiece.id)) {
        const product = factoryExpectedProduct(afterPiece);
        const cost = factoryOperatePowerCost(afterPiece);
        events.push(`${owner}'s ${typeLabel}: activated — pay ${cost} 🔋 to produce${product ? ` 1 ${product}` : ''}`);
        continue;
      }
      const beforeFilled = beforePiece.output.slots.filter(s => s !== null).length;
      const afterFilled = afterPiece.output.slots.filter(s => s !== null).length;
      if (afterFilled > beforeFilled) {
        events.push(`${owner}'s ${typeLabel} produced`);
        continue;
      }
      // Produced nothing — explain why (use afterPiece.input: ore may have loaded from mine during roll)
      if (beforePiece.output.slots.some(s => s !== null)) {
        events.push(`${owner}'s ${typeLabel}: output buffer full, no production`);
      } else if (!afterPiece.input || afterPiece.input.slots.some(s => s === null)) {
        events.push(`${owner}'s ${typeLabel}: input not fully loaded, no production`);
      } else {
        const cost = factoryOperatePowerCost(afterPiece);
        const player = before.players[activatingClaim.ownerId];
        const have = player?.powerTokens ?? 0;
        events.push(`${owner}'s ${typeLabel}: need ${cost} power token(s), have ${have} — no production`);
      }
    } else if (beforePiece.type === 'powerPlant') {
      const before_pt = before.players[activatingClaim.ownerId]?.powerTokens ?? 0;
      const after_pt = after.players[activatingClaim.ownerId]?.powerTokens ?? 0;
      if (after_pt > before_pt) {
        events.push(`${owner}'s ${typeLabel} generated ${after_pt - before_pt} power token(s)`);
      } else {
        events.push(`${owner}'s ${typeLabel}: already at power token cap`);
      }
    }
  }

  return events;
}

function describeAction(action: Action): string {
  switch (action.type) {
    case 'SETUP_CLAIM':   return `setup-claimed ${action.pieceId}`;
    case 'PLACE_PIECE':   return `placed piece from stack ${action.stackIndex + 1} at (${action.coord.q},${action.coord.r}) r${action.rotation ?? 0}`;
    case 'ROLL_DICE':     return `rolled [${action.rolls.join(', ')}]`;
    case 'END_ACTIONS':   return 'ended actions';
    case 'PLACE_MEEPLE':  return `placed meeple on ${action.pieceId}`;
    case 'END_TURN':      return 'ended turn';
    case 'PLACE_BELT':    return `placed belt on ${action.pieceId}`;
    case 'REMOVE_BELT':   return `removed belt ${action.beltId}`;
    case 'UNDO_BELTS':    return 'undid all belt placements this turn';
    case 'PLACE_TELEPORTER': return `placed teleporter on ${action.pieceId} ${action.bufferType}`;
    case 'CLAIM_BUILDING':   return `claimed ${action.pieceId} with module ${action.controlModule}`;
    case 'UPGRADE_BUILDING': return `upgraded ${action.pieceId} ${action.oldModule}→${action.newModule}`;
    case 'BUY_MINE':      return 'bought mine';
    case 'PLACE_MINE':    return `placed mine at (${action.coord.q},${action.coord.r}) r${action.rotation ?? 0}`;
    case 'BUY_CARD':      return 'bought card';
    case 'PLAY_CARD':     return `played ${action.cardType}`;
    case 'PLACE_OVERSTOCK_PIECE': return `placed overstock piece at (${action.coord.q},${action.coord.r})`;
    case 'BUY_BELT':             return 'bought belt from bank';
    case 'LOAD_BUILDING_INPUT':  return `loaded ${action.material} into ${action.pieceId} input`;
    case 'OPERATE_BUILDING':     return `operated ${action.pieceId}`;
    case 'COLLECT_OUTPUT':       return `collected output from ${action.pieceId}`;
    case 'SKIP_FACTORY_ROLL':    return `skipped factory roll for ${action.pieceId}`;
    case 'EXCHANGE_MATERIALS':   return `exchanged 1 ${action.give} for lower-tier materials`;
  }
}
