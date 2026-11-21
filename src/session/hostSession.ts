// The host session: owns the room, runs the engine, decides who may speak, rolls the
// dice, runs bot seats and timers, and sends the whole room to everyone after a change.
// The engine judges whether a move is legal; the host judges who may make it.

import type { Conn } from '../net/conn';
import type { Action } from '../engine/actions';
import type { GameState, PlayerId } from '../engine/state';
import { applyAction, createGame, legalActions } from '../engine';
import { botById } from '../bots/registry';
import type { LogEntry, Room, RoomSettings, Seat, TableEvent } from './room';
import {
  NAME_MAX, STAND_IN_BOT, activeSeat, appendLog, cleanName, clipName, isBotControlled,
  isHumanControlled, newLobbyRoom, openSeat, recordRecent, sameName,
} from './room';
import type { ClientMsg, ClosedWhy, HostMsg, WireError } from './protocol';
import { PROTOCOL, parseClientMsg } from './protocol';
import { dedupeName, firstOpenSeat, hasAwayHumanSeat, namesInUse, resizeSeats } from './seating';
import { describeAction } from './describe';
import { moveEvents } from './events';
import { diceRngFromSeed, rollDice } from './dice';
import type { Scheduler } from './scheduler';
import { cryptoUint32, realScheduler } from './scheduler';
import type { SaveStore } from './store';
import { writeSave } from './store';
import { memoryPair } from './memoryConn';
import { normalizeAction } from './normalize';
import { BOT_SPEEDS, botPauseMs, botSpeedOf, lastMoveOf, normalizeSettings } from './pacing';
import type { Preview } from './preview';
import { PREVIEW_INTERVAL_MS, mayPreview } from './preview';
import type { JournalData } from './journal';
import {
  capJournal, copyJournal, fullJournal, journalEnd, journalFrom, journalMatches, journalSeed, movesAfter, partialJournal,
} from './journal';

export interface HostOptions {
  code: string;
  hostName: string;
  hostToken: string;
  /** Present for 'resume' and 'takeover'. */
  room?: Room;
  mode?: 'new' | 'resume' | 'takeover';
  /**
   * Take-over: the new host's seat (otherwise found by `hostName`).
   * Resume: the host's seat; its name becomes `hostName`. Without it the seat is found by
   * `hostName`, and construction throws SessionError('SEAT_REQUIRED') if no player seat matches.
   */
  hostSeat?: number;
  /** Saves on every room change while a game is on. */
  store?: SaveStore;
  scheduler?: Scheduler;
  /** uint32 seed source for a new game; injected so tests are deterministic. */
  randomSeed?: () => number;
  appVersion?: string;
  /**
   * Resume and take-over: the moves of the game so far (the new host's own copy, or the one in
   * a save file). Used when it is of this game and reaches room.seq; otherwise the host starts
   * a partial journal from the room's position.
   */
  journal?: JournalData | null;
}

/** Thrown when a HostSession cannot be built from its options. */
export class SessionError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'SessionError';
  }
}

interface ConnInfo {
  token: string | null;     // null until `hello`
  seat: number | null;
  waitingId: string | null;
  name: string;             // the name given in `hello` (a waiting visitor's shown name may be de-duplicated)
  journalAt: number | null; // host clock when this connection's last journal request was answered
}

type MoveResult = { ok: true } | { ok: false; error: WireError };
type MoveSource = 'human' | 'bot' | 'auto';
interface BotTurn { seat: number; pendingPieceId: string | null }
interface Reply { conn: Conn; id: string | null }
/** Previews from one connection: when the last was passed on, and the latest one held back meanwhile. */
interface PeekRelay { last: number; next: { seq: number; p: Preview | null } | null; timer: unknown }

/** Instant bots (delay 0) play at most this many moves before the room is sent and the page breathes. */
const BOT_BATCH = 40;
/** lastEvents keeps at most this many events from a run of bot moves. */
const EVENTS_CAP = 100;
/** A deliberate close waits this long so the `closed` message goes out first. */
const CLOSE_DELAY_MS = 50;
/** Most people waiting for a seat at once; more are told the room is full. */
export const MAX_WAITING = 8;
/** A connection gets at most one journal answer this often. */
export const JOURNAL_ANSWER_MS = 5000;
const TOKEN_MIN = 16;
const TOKEN_MAX = 64;

const SETTING_RANGES = {
  factoryOpTimeoutMs: [0, 120_000],
  roundEndTimeoutMs: [0, 600_000],
  awayGraceMs: [0, 3_600_000],
  botDelayMs: [0, 5_000],
} as const;

const err = (code: string, message: string): WireError => ({ code, message });

export class HostSession {
  room: Room;

  private readonly hostToken: string;
  private readonly store: SaveStore | undefined;
  private readonly sched: Scheduler;
  private readonly randomSeed: () => number;
  private readonly app: string;

  private readonly conns = new Map<Conn, ConnInfo>();
  private readonly seatConn = new Map<number, Conn>();
  private readonly tokens = new Map<string, number>();
  private readonly kicked = new Set<string>();
  /** Seats of kicked players: no token, hint or name can reclaim them until the host assigns one. */
  private readonly locked = new Set<number>();
  private readonly closing = new Set<Conn>();
  private readonly welcomes = new Set<Conn>();
  private readonly listeners = new Set<() => void>();

  private opTimer: unknown = null;
  private roundEndTimer: unknown = null;
  private roundEndKey: string | null = null;
  private botTimer: unknown = null;
  private readonly awayTimers = new Map<number, unknown>();
  /** Previews being passed on, by the connection they came from (see preview.ts). */
  private readonly peeks = new Map<Conn, PeekRelay>();

  private burst = false;                 // moves applied since the last broadcast
  private botStalledAt: number | null = null;
  private savedRoom: Room | null = null;
  private waitingSeq = 0;
  private disposed = false;
  /** Every move applied in this game (see journal.ts); null outside a game. */
  private moveJournal: JournalData | null = null;
  /** The move number the last broadcast reached (its moves block ends there). */
  private broadcastSeq: number | null = null;
  /** Broadcasts sent so far (guard() never rolls back past one). */
  private broadcasts = 0;

  constructor(opts: HostOptions) {
    this.hostToken = opts.hostToken;
    this.store = opts.store;
    this.sched = opts.scheduler ?? realScheduler;
    this.randomSeed = opts.randomSeed ?? cryptoUint32;
    this.app = opts.appVersion ?? 'dev';
    const hostName = clipName(opts.hostName);
    const mode = opts.mode ?? (opts.room ? 'resume' : 'new');

    if (mode === 'new' || !opts.room) {
      this.room = newLobbyRoom(opts.code, hostName);
      this.tokens.set(opts.hostToken, 0);
      return;
    }

    const base = opts.room;
    const now = this.sched.now();
    if (mode === 'resume') {
      let seats = base.seats.map(s => ({
        ...s, connected: false, ready: false, awaySince: null, autopilot: false,
        botId: s.kind === 'human' ? null : s.botId,
      }));
      let hostSeat: number;
      if (opts.hostSeat !== undefined) {
        if (seats[opts.hostSeat]?.kind !== 'human') {
          throw new SessionError('SEAT_REQUIRED', `Seat ${opts.hostSeat + 1} is not a player seat.`);
        }
        hostSeat = opts.hostSeat;
        seats = seats.map(s => (s.index === hostSeat ? { ...s, name: hostName } : s));
      } else {
        const match = seats.find(s => s.kind === 'human' && sameName(s.name, hostName));
        if (!match) throw new SessionError('SEAT_REQUIRED', `No player seat is named ${hostName}; choose your seat.`);
        hostSeat = match.index;
      }
      this.room = {
        ...base, settings: normalizeSettings(base.settings), code: opts.code, seats, hostSeat, hold: true, waiting: [], recent: [],
        lastEvents: [], opDeadline: null, roundEndDeadline: null,
      };
      this.tokens.set(opts.hostToken, hostSeat);
      this.note(null, 'The game was loaded from a save. It continues when the host says so.');
    } else {
      const hostSeat = opts.hostSeat
        ?? base.seats.find(s => s.kind === 'human' && sameName(s.name, hostName))?.index
        ?? base.hostSeat;
      const away = base.phase === 'lobby' ? null : now;
      const seats = base.seats.map(s => {
        if (s.kind !== 'human') return s;
        if (s.index === hostSeat) return { ...s, connected: true, awaySince: null };
        return { ...s, connected: false, awaySince: s.connected ? away : (s.awaySince ?? away) };
      });
      this.room = {
        ...base, settings: normalizeSettings(base.settings), code: opts.code, seats, hostSeat, hold: base.hold, waiting: [],
        opDeadline: null, roundEndDeadline: null,
      };
      this.tokens.set(opts.hostToken, hostSeat);
      this.note(null, `${seats[hostSeat]?.name ?? 'A player'} took over as host.`);
      for (const s of seats) if (s.kind === 'human' && !s.connected) this.armAway(s.index);
    }
    this.moveJournal = this.initialJournal(opts.journal ?? null);
    this.broadcastSeq = this.moveJournal ? journalEnd(this.moveJournal) : null;
    this.afterChange();
  }

  /** The given journal when it is of this game and reaches room.seq; else a partial one from here. */
  private initialJournal(given: JournalData | null): JournalData | null {
    const g = this.room.game;
    if (!g) return null;
    // The journal must lead to this very game, not only have its seed and length: it is replayed
    // (about 0.1 s for 2,000 moves). One that does not is replaced by a journal from here on.
    const fits = given && journalSeed(given) === g.seed && journalEnd(given) === this.room.seq ? journalMatches(given, g, this.room.seq) : null;
    if (fits) return copyJournal(fits);
    return partialJournal(g, this.room.seq);
  }

  /** A copy of the host's journal (for tests and for a host that is also a player). */
  get journal(): JournalData | null {
    return this.moveJournal ? copyJournal(this.moveJournal) : null;
  }

  // --- Public surface ------------------------------------------------------------

  /** A client connected. */
  accept(conn: Conn): void {
    if (this.disposed) { conn.close(); return; }
    this.conns.set(conn, { token: null, seat: null, waitingId: null, name: '', journalAt: null });
    conn.onmessage = (m): void => this.onMessage(conn, m);
    conn.onclose = (): void => this.guard(() => this.onClose(conn));
  }

  /** The client end of an in-process pair, for the host player's own ClientSession. */
  connectLocal(): Conn {
    const [hostEnd, clientEnd] = memoryPair();
    this.accept(hostEnd);
    return clientEnd;
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }

  /** Stop everything. With `notify`, clients are told the room ended; otherwise they just lose the host. */
  dispose(opts: { notify?: boolean } = {}): void {
    if (this.disposed) return;
    this.disposed = true;
    this.clearTimer('op');
    this.clearTimer('roundEnd');
    this.clearTimer('bot');
    for (const h of this.awayTimers.values()) this.sched.clearTimeout(h);
    this.awayTimers.clear();
    for (const conn of [...this.peeks.keys()]) this.dropPeeks(conn);
    for (const conn of [...this.conns.keys()]) {
      if (opts.notify) this.send(conn, { t: 'closed', why: 'ended' });
      conn.close();
    }
    for (const conn of this.closing) conn.close();
    this.closing.clear();
    this.conns.clear();
    this.listeners.clear();
  }

  // --- Safety net --------------------------------------------------------------------

  /** Run `fn`; an unexpected exception restores the room, is logged, and is answered with INTERNAL. */
  private guard(fn: () => void, reply?: Reply): void {
    const snapshot = this.room;
    const journal = this.moveJournal;
    const journalLength = journal?.moves.length ?? 0;
    const broadcastSeq = this.broadcastSeq;
    const broadcasts = this.broadcasts;
    try {
      fn();
    } catch (e) {
      // What was already sent to everyone stands; otherwise the host goes back to where it was.
      if (this.broadcasts === broadcasts) {
        this.room = snapshot;
        this.moveJournal = journal;
        if (journal) journal.moves.length = journalLength;
        this.broadcastSeq = broadcastSeq;
      }
      this.burst = false;
      this.welcomes.clear();
      // eslint-disable-next-line no-console
      console.error('HostSession: unexpected error', e);
      if (reply) this.nope(reply.conn, reply.id, err('INTERNAL', 'The host hit an unexpected error; nothing changed.'));
    }
  }

  private timer(fn: () => void, ms: number): unknown {
    return this.sched.setTimeout(() => { if (!this.disposed) this.guard(fn); }, ms);
  }

  // --- Inbound -------------------------------------------------------------------

  private onMessage(conn: Conn, raw: unknown): void {
    if (this.disposed || !this.conns.has(conn)) return;
    const rawId = (raw as { id?: unknown } | null)?.id;
    const id = typeof rawId === 'string' ? rawId.slice(0, 64) : null;
    this.guard(() => this.handle(conn, raw, id), { conn, id });
  }

  private handle(conn: Conn, raw: unknown, rawId: string | null): void {
    const info = this.conns.get(conn);
    if (!info) return;
    // A preview is never answered: one that may not be shown is dropped without a word.
    if (typeof raw === 'object' && raw !== null && (raw as { t?: unknown }).t === 'peek') { this.onPeek(conn, info, raw); return; }
    const msg = parseClientMsg(raw);
    if (!msg) { this.nope(conn, rawId, err('BAD_MESSAGE', 'That message was not understood.')); return; }
    if (msg.t === 'hello') { this.onHello(conn, info, msg); return; }
    const id = msg.t === 'act' ? msg.id : (msg.id ?? null);
    if (info.token === null) { this.nope(conn, id, err('HELLO_FIRST', 'Say hello first.')); return; }

    if (msg.t === 'act') { this.onAct(conn, info, msg); return; }
    if (msg.t === 'sync') { this.sendRoom(conn, id); return; }
    if (msg.t === 'journal') {
      // Only players may ask, and not too often: a whole journal can be large.
      if (info.seat === null) { this.nope(conn, id, err('NO_SEAT', 'You do not have a seat in this game.')); return; }
      const now = this.sched.now();
      if (info.journalAt !== null && now - info.journalAt < JOURNAL_ANSWER_MS) {
        this.nope(conn, id, err('BUSY', 'Too many journal requests; ask again shortly.'));
        return;
      }
      info.journalAt = now;
      this.sendJournal(conn, msg, id);
      return;
    }

    const refusal = this.command(conn, info, msg);
    if (refusal) this.nope(conn, id, refusal);
  }

  private onHello(conn: Conn, info: ConnInfo, msg: Extract<ClientMsg, { t: 'hello' }>): void {
    if (msg.v !== PROTOCOL) { this.closeWith(conn, 'version'); return; }
    const name = cleanName(msg.name);
    if (msg.token.length < TOKEN_MIN || msg.token.length > TOKEN_MAX || name.length < 1 || name.length > NAME_MAX) {
      this.closeWith(conn, 'invalid');
      return;
    }
    if (this.kicked.has(msg.token)) { this.closeWith(conn, 'kicked'); return; }
    if (info.token !== null) { this.welcomes.add(conn); this.afterChange(); return; } // repeated hello: re-welcome

    const r = this.room;
    info.token = msg.token;
    info.name = name;
    const seat = this.findSeat(msg.token, msg.seat, name);
    if (seat === null) {
      // A few people may wait for a seat; more are turned away (the room is full).
      if (hasAwayHumanSeat(r) && r.waiting.length < MAX_WAITING) {
        const id = `w${++this.waitingSeq}`;
        info.waitingId = id;
        this.room = { ...r, waiting: [...r.waiting, { id, name: dedupeName(name, namesInUse(r)) }] };
        this.welcomes.add(conn);
        this.afterChange();
        return;
      }
      this.closeWith(conn, 'full');
      return;
    }
    this.attach(conn, info, seat, name);
    this.afterChange();
  }

  /**
   * The seat for a hello, in this order: (1) a known token; (2) the hinted seat, if it is an
   * away player seat with that name; (3) any away player seat with that name; (4) in the
   * lobby, the first open seat. Locked (kicked) seats and the host's own seat are never
   * taken by name.
   */
  private findSeat(token: string, hint: number | undefined, name: string): number | null {
    const r = this.room;
    const known = this.tokens.get(token);
    if (known !== undefined) {
      const s = r.seats[known];
      const holder = this.seatConn.get(known);
      const heldByOther = holder !== undefined && this.conns.get(holder)?.token !== token;
      if (s && !this.locked.has(known) && !heldByOther && (s.kind === 'human' || (r.phase === 'lobby' && s.kind === 'open'))) {
        return known;
      }
      if (token !== this.hostToken) this.tokens.delete(token);
    }
    const awayMatch = (i: number): boolean => {
      const s = r.seats[i];
      return !!s && s.kind === 'human' && !s.connected && i !== r.hostSeat && !this.locked.has(i) && sameName(s.name, name);
    };
    if (hint !== undefined && awayMatch(hint)) return hint;
    const byName = r.seats.find(s => awayMatch(s.index));
    if (byName) return byName.index;
    return r.phase === 'lobby' ? firstOpenSeat(r) : null;
  }

  // --- Previews (preview.ts): passed on, never stored ----------------------------------

  /** True when the player on `conn` may show a preview for move number `seq` now. */
  private peekAllowed(conn: Conn, info: ConnInfo, seq: number): boolean {
    const r = this.room;
    const seat = info.seat;
    if (info.token === null || seat === null || this.seatConn.get(seat) !== conn) return false;
    if (r.phase !== 'playing' || r.hold || !r.game || seq !== r.seq) return false;
    const s = r.seats[seat];
    if (!s || s.kind !== 'human' || s.autopilot) return false;
    return mayPreview(r.game, seat);
  }

  private onPeek(conn: Conn, info: ConnInfo, raw: unknown): void {
    const msg = parseClientMsg(raw);
    if (!msg || msg.t !== 'peek' || !this.peekAllowed(conn, info, msg.seq)) return;
    let relay = this.peeks.get(conn);
    if (!relay) { relay = { last: -Infinity, next: null, timer: null }; this.peeks.set(conn, relay); }
    relay.next = { seq: msg.seq, p: msg.p };
    if (relay.timer !== null) return; // the latest goes when the timer fires
    const wait = relay.last + PREVIEW_INTERVAL_MS - this.sched.now();
    if (wait <= 0) { this.relayPeek(conn); return; }
    relay.timer = this.timer(() => {
      const r = this.peeks.get(conn);
      if (!r) return;
      r.timer = null;
      this.relayPeek(conn);
    }, wait);
  }

  /** Pass the held preview of `conn` on to everyone else, if it is still for the current move. */
  private relayPeek(conn: Conn): void {
    const relay = this.peeks.get(conn);
    const info = this.conns.get(conn);
    const next = relay?.next;
    if (!relay || !next) return;
    relay.next = null;
    if (!info || info.seat === null || !this.peekAllowed(conn, info, next.seq)) return;
    relay.last = this.sched.now();
    const msg: HostMsg = { t: 'peek', seat: info.seat, seq: next.seq, p: next.p };
    for (const [other, o] of this.conns) {
      if (other !== conn && o.token !== null) this.send(other, msg);
    }
  }

  private dropPeeks(conn: Conn): void {
    const relay = this.peeks.get(conn);
    if (relay?.timer != null) this.sched.clearTimeout(relay.timer);
    this.peeks.delete(conn);
  }

  /** The move number moved on: previews held back for an older one are forgotten. */
  private forgetOldPeeks(): void {
    for (const relay of this.peeks.values()) {
      if (relay.next && relay.next.seq !== this.room.seq) relay.next = null;
    }
  }

  private onClose(conn: Conn): void {
    this.dropPeeks(conn);
    const info = this.conns.get(conn);
    this.conns.delete(conn);
    this.welcomes.delete(conn);
    if (!info || this.disposed) return;
    if (info.waitingId !== null) {
      const id = info.waitingId;
      this.room = { ...this.room, waiting: this.room.waiting.filter(w => w.id !== id) };
      this.afterChange();
      return;
    }
    if (info.seat === null || this.seatConn.get(info.seat) !== conn) return;
    this.seatConn.delete(info.seat);
    this.markLeft(info.seat);
    this.afterChange();
  }

  // --- Moves -----------------------------------------------------------------------

  private onAct(conn: Conn, info: ConnInfo, msg: Extract<ClientMsg, { t: 'act' }>): void {
    const seat = info.seat;
    if (seat === null) { this.nope(conn, msg.id, err('NO_SEAT', 'You do not have a seat in this game.')); return; }
    const r = this.room;
    // Already applied (the reply was lost): acknowledge with the current room, apply nothing.
    if (r.recent.some(x => x.seat === seat && x.id === msg.id)) { this.sendRoom(conn, msg.id); return; }
    // A re-sent move that never arrived is only applied if nothing happened in between.
    if (msg.resend && msg.seq !== r.seq) {
      this.nope(conn, msg.id, err('STALE', 'The game moved on; that move was not applied.'));
      return;
    }
    if (r.phase !== 'playing' || !r.game) { this.nope(conn, msg.id, err('NOT_PLAYING', 'No game is in progress.')); return; }
    if (r.hold) { this.nope(conn, msg.id, err('ON_HOLD', 'The game is paused until the host continues it.')); return; }

    const game = r.game;
    // Only the known fields of a move are kept (see normalize.ts); anything else is refused.
    const read = normalizeAction(msg.action);
    if (!read) { this.nope(conn, msg.id, err('BAD_ACTION', 'That move could not be read.')); return; }
    let action: Action = read;
    let ownChoice = false;
    if (action.type === 'OPERATE_BUILDING' || action.type === 'SKIP_FACTORY_ROLL') {
      if (game.phase === 'actions') {
        // An activated factory is answered by its owner, on anyone's turn, and only for themselves.
        action = { ...action, ownerId: seat as PlayerId };
        const pieceId = action.pieceId;
        ownChoice = game.pendingFactoryOps.some(e => e.pieceId === pieceId && e.ownerId === seat);
      } else {
        // Elsewhere the active player operates: no owner field is taken from the sender.
        action = { type: action.type, pieceId: action.pieceId };
      }
    }
    if (!ownChoice && activeSeat(game) !== seat) {
      this.nope(conn, msg.id, err('NOT_YOUR_TURN', 'It is not your turn.'));
      return;
    }
    const res = this.applyMove(seat, action, msg.id, 'human');
    if (!res.ok) { this.nope(conn, msg.id, res.error); return; }
    this.afterChange({ conn, id: msg.id });
  }

  /** Apply one move for `seat`. Rolls the dice itself. On refusal nothing changes. */
  private applyMove(seat: number, action: Action, id: string | null, source: MoveSource): MoveResult {
    const r = this.room;
    const game = r.game;
    if (!game) return { ok: false, error: err('NOT_PLAYING', 'No game is in progress.') };
    // Bots and timers too: only a well-formed move is applied and kept in the journal.
    const clean = normalizeAction(action);
    if (!clean) return { ok: false, error: err('BAD_ACTION', 'That move could not be read.') };
    action = clean;
    let diceRng = r.diceRng;
    if (action.type === 'ROLL_DICE') {
      const [dice, next] = rollDice(diceRng, game.mineCount);
      action = { type: 'ROLL_DICE', rolls: dice };
      diceRng = next;
    }
    let res: ReturnType<typeof applyAction>;
    try {
      res = applyAction(game, action);
    } catch {
      return { ok: false, error: err('BAD_ACTION', 'That move could not be read.') };
    }
    if (!res.ok) return { ok: false, error: { code: res.error.code, message: res.error.message } };

    const after = res.state;
    const seq = r.seq + 1;
    const log: LogEntry[] = [{ seq, seat, text: describeAction(game, action, this.seatName(seat)) }];
    const events = moveEvents(game, after, action, seat);
    let phase = r.phase;
    if (after.gameOver) {
      phase = 'finished';
      events.push({ kind: 'gameOver', winner: after.winner, tied: [...after.tiedWinners], reason: after.gameOverReason });
      log.push({ seq, seat: null, text: this.gameOverText(after.winner, after.tiedWinners, after.gameOverReason) });
    }
    this.room = {
      ...r,
      game: after,
      seq,
      diceRng,
      phase,
      recent: id !== null && source === 'human' ? recordRecent(r.recent, seat, id) : r.recent,
      log: appendLog(r.log, log),
      lastEvents: this.mergeEvents(events),
    };
    // The journal records the move exactly as applied, dice included, so it replays without chance.
    if (!this.moveJournal || journalEnd(this.moveJournal) !== r.seq || journalSeed(this.moveJournal) !== game.seed) {
      this.moveJournal = partialJournal(game, r.seq);
    }
    this.moveJournal.moves.push(action);
    this.moveJournal = capJournal(this.moveJournal, after, seq);
    this.burst = true;
    if (source === 'human') this.clearTimer('roundEnd'); // any move by the player restarts their idle clock
    return { ok: true };
  }

  private mergeEvents(events: TableEvent[]): TableEvent[] {
    const all = this.burst ? [...this.room.lastEvents, ...events] : events;
    return all.length > EVENTS_CAP ? all.slice(all.length - EVENTS_CAP) : all;
  }

  // --- Commands --------------------------------------------------------------------

  /** Handle a non-move command. Returns a refusal, or null after applying it. */
  private command(conn: Conn, info: ConnInfo, msg: Exclude<ClientMsg, { t: 'hello' | 'act' | 'sync' | 'journal' }>): WireError | null {
    const r = this.room;
    const done = (): null => {
      this.afterChange({ conn, id: msg.id ?? null });
      return null;
    };
    const mySeat = info.seat === null ? undefined : r.seats[info.seat];

    switch (msg.t) {
      case 'ready':
        if (r.phase !== 'lobby') return err('NOT_IN_LOBBY', 'The game has already started.');
        if (!mySeat || mySeat.kind !== 'human') return err('NO_SEAT', 'You do not have a seat.');
        this.patchSeat(mySeat.index, { ready: msg.ready });
        return done();

      case 'color': {
        if (r.phase !== 'lobby') return err('NOT_IN_LOBBY', 'The game has already started.');
        if (!mySeat || mySeat.kind !== 'human') return err('NO_SEAT', 'You do not have a seat.');
        // A colour held by another player is taken; one held by an open or bot seat is swapped.
        const holder = r.seats.find(s => s.index !== mySeat.index && s.color === msg.color);
        if (holder?.kind === 'human') return err('COLOR_TAKEN', 'Another player already uses that colour.');
        if (holder) this.patchSeat(holder.index, { color: mySeat.color });
        this.patchSeat(mySeat.index, { color: msg.color });
        return done();
      }

      case 'autopilot':
        // A player may take their own seat back from the bot; everything else is the host's call.
        if (!this.isHost(info) && mySeat && mySeat.index === msg.seat && !msg.on && mySeat.kind === 'human') {
          this.clearAway(mySeat.index);
          this.patchSeat(mySeat.index, { autopilot: false, botId: null });
          if (r.phase !== 'lobby') this.note(mySeat.index, `${mySeat.name} plays their own seat again.`);
          return done();
        }
        break;
    }

    if (!this.isHost(info)) return err('NOT_HOST', 'Only the host can do that.');

    switch (msg.t) {
      case 'cfg': {
        const next = mergeSettings(r.settings, msg.settings);
        if (!next) return err('BAD_SETTINGS', 'Those settings are not valid.');
        if (r.phase !== 'lobby') {
          // During a game only the bot speed may change; it applies from the next bot move.
          if (Object.keys(msg.settings).some(k => k !== 'botSpeed')) return err('NOT_IN_LOBBY', 'Settings can only change in the lobby.');
          this.room = { ...r, settings: next };
          this.clearTimer('bot');
          return done();
        }
        let seats: Seat[] | null = r.seats;
        if (next.playerCount !== r.settings.playerCount) {
          seats = resizeSeats(r.seats, next.playerCount);
          if (!seats) return err('SEAT_OCCUPIED', 'A player is sitting in a seat that would be removed.');
        }
        // Ready means "I agree to play this game". A change to the game itself (the number of
        // players) asks the other players again; pacing, timers and the away rule do not. The
        // host, who made the change, stays ready.
        const changesGame = next.playerCount !== r.settings.playerCount;
        this.room = { ...r, settings: next, seats: changesGame ? unreadyOthers(seats, r.hostSeat) : seats };
        this.seatWaiting();
        return done();
      }

      case 'setSeat': {
        const seat = r.seats[msg.index];
        if (!seat) return err('BAD_SEAT', 'There is no such seat.');
        if (seat.kind === 'human' && seat.connected) return err('SEAT_OCCUPIED', 'That player is still connected.');
        const bot = botById(msg.botId ?? STAND_IN_BOT);
        if (r.phase === 'lobby') {
          this.forgetSeatTokens(seat.index);
          const next: Seat = msg.kind === 'open'
            ? openSeat(seat.index, seat.color)
            : { ...openSeat(seat.index, seat.color), kind: 'bot', botId: bot.id, name: dedupeName(bot.label, namesInUse(r, seat.index)) };
          this.room = { ...r, seats: unreadyOthers(r.seats, r.hostSeat).map(s => (s.index === seat.index ? next : s)) };
          this.seatWaiting();
          return done();
        }
        if (msg.kind === 'open') return err('BAD_SEAT', 'A seat cannot be emptied once the game has started.');
        this.forgetSeatTokens(seat.index);
        this.clearAway(seat.index);
        this.locked.delete(seat.index);
        this.patchSeat(seat.index, { kind: 'bot', botId: bot.id, autopilot: false, awaySince: null, connected: false, ready: false });
        this.note(seat.index, `${bot.label} now plays ${seat.name}'s seat.`);
        return done();
      }

      case 'start': {
        if (r.phase !== 'lobby') return err('NOT_IN_LOBBY', 'The game has already started.');
        if (r.seats.some(s => s.kind === 'open')) return err('SEATS_OPEN', 'Every seat needs a player or a bot.');
        if (r.seats.some(s => s.kind === 'human' && !s.connected)) {
          return err('SEATS_ABSENT', 'A player is not connected. Wait for them, or open their seat or give it to a bot.');
        }
        // Bots are always ready, and a host playing alone with bots can always start.
        if (!onlyHostPlays(r) && r.seats.some(s => s.kind === 'human' && !s.ready)) return err('NOT_READY', 'Every player must be ready.');
        const seed = this.randomSeed() >>> 0;
        const game = createGame(seed, r.settings.playerCount);
        const names = r.seats.map(s => s.name).join(', ');
        this.room = {
          ...r, phase: 'playing', game, seq: 0, diceRng: diceRngFromSeed(seed),
          recent: [], lastEvents: [], log: [
            { seq: 0, seat: null, text: `The game begins: ${names}.` },
            { seq: 0, seat: null, text: firstPlayerText(game, r.seats) },
          ],
        };
        this.moveJournal = fullJournal(seed, r.settings.playerCount);
        return done();
      }

      case 'resume': {
        if (r.phase === 'lobby') return err('NOT_PLAYING', 'There is no game to continue.');
        if (r.hold) {
          const now = this.sched.now();
          this.room = {
            ...r, hold: false,
            seats: r.seats.map(s => (s.kind === 'human' && !s.connected ? { ...s, awaySince: now } : s)),
          };
          this.note(null, 'The host continued the game.');
          for (const s of this.room.seats) if (s.kind === 'human' && !s.connected) this.armAway(s.index);
        }
        return done();
      }

      case 'assign': {
        const visitor = r.waiting.find(w => w.id === msg.waitingId);
        const target = [...this.conns].find(([, i]) => i.waitingId === msg.waitingId);
        if (!visitor || !target) return err('NOT_WAITING', 'That person is no longer waiting.');
        const seat = r.seats[msg.seat];
        if (!seat) return err('BAD_SEAT', 'There is no such seat.');
        if (seat.kind === 'human' && seat.connected) return err('SEAT_OCCUPIED', 'That player is still connected.');
        this.seatVisitor(target[0], target[1], seat.index);
        return done();
      }

      case 'autopilot': {
        const seat = r.seats[msg.seat];
        if (!seat || seat.kind !== 'human') return err('BAD_SEAT', 'Only a player seat can be put on autopilot.');
        this.clearAway(seat.index);
        this.patchSeat(seat.index, { autopilot: msg.on, botId: msg.on ? STAND_IN_BOT : null });
        if (r.phase !== 'lobby') {
          this.note(seat.index, msg.on ? `A bot now plays for ${seat.name}.` : `${seat.name} plays their own seat again.`);
        }
        return done();
      }

      case 'kick': {
        const seat = r.seats[msg.seat];
        if (!seat || seat.kind !== 'human' || seat.index === r.hostSeat) return err('BAD_SEAT', 'That seat cannot be removed.');
        const conn = this.seatConn.get(seat.index);
        if (conn) {
          this.seatConn.delete(seat.index);
          this.closeWith(conn, 'kicked');
        }
        for (const token of this.forgetSeatTokens(seat.index)) this.kicked.add(token);
        if (r.phase === 'lobby') {
          this.patchSeat(seat.index, openSeat(seat.index, seat.color));
          this.seatWaiting();
        } else {
          this.locked.add(seat.index);
          this.clearAway(seat.index);
          this.patchSeat(seat.index, {
            connected: false, ready: false, awaySince: seat.awaySince ?? this.sched.now(), autopilot: true, botId: STAND_IN_BOT,
          });
          this.note(seat.index, `${seat.name} was removed from the game; a bot plays their seat.`);
        }
        return done();
      }
    }
    return null;
  }

  // --- Seats and connections -------------------------------------------------------

  private isHost(info: ConnInfo): boolean {
    return info.token === this.hostToken && info.seat !== null && info.seat === this.room.hostSeat;
  }

  /** Put a connection in a seat (reattaching a returning player, or seating a newcomer). */
  private attach(conn: Conn, info: ConnInfo, seat: number, name: string, rename = false): void {
    const old = this.seatConn.get(seat);
    if (old && old !== conn) this.closeWith(old, 'replaced'); // the same seat connected again
    this.seatConn.set(seat, conn);
    info.seat = seat;
    if (info.token !== null) this.tokens.set(info.token, seat);
    this.clearAway(seat);
    this.welcomes.add(conn);

    const r = this.room;
    const s = r.seats[seat]!;
    if (r.phase === 'lobby' || rename) {
      const keep = s.kind === 'human' && sameName(s.name, name);
      this.patchSeat(seat, {
        kind: 'human', name: keep ? s.name : dedupeName(name, namesInUse(r, seat)),
        connected: true, ready: false, awaySince: null, autopilot: false, botId: null,
      });
    } else {
      const wasAway = !s.connected;
      this.patchSeat(seat, { connected: true, awaySince: null, autopilot: false, botId: null });
      if (wasAway) this.note(seat, `${s.name} is back.`);
    }
  }

  /**
   * Seat a waiting visitor: the host's `assign` (a new person takes the seat, under their own
   * name), or an automatic match by name (the same person returning; the seat keeps its name).
   */
  private seatVisitor(conn: Conn, info: ConnInfo, seat: number, samePerson = false): void {
    const visitor = this.room.waiting.find(w => w.id === info.waitingId);
    if (!visitor) return;
    info.waitingId = null;
    this.room = { ...this.room, waiting: this.room.waiting.filter(w => w.id !== visitor.id) };
    this.forgetSeatTokens(seat);
    this.locked.delete(seat);
    if (samePerson) {
      this.attach(conn, info, seat, info.name);
      return;
    }
    this.attach(conn, info, seat, visitor.name, true);
    if (this.room.phase !== 'lobby') this.note(seat, `${this.seatName(seat)} takes over seat ${seat + 1}.`);
  }

  /** A waiting visitor's connection, chosen by the name they gave in `hello`. */
  private waitingConn(pred: (helloName: string) => boolean): [Conn, ConnInfo] | null {
    for (const w of this.room.waiting) {
      const entry = [...this.conns].find(([, i]) => i.waitingId === w.id);
      if (entry && pred(entry[1].name)) return entry;
    }
    return null;
  }

  /** In the lobby, waiting visitors fill seats that open up. */
  private seatWaiting(): void {
    if (this.room.phase !== 'lobby') return;
    for (;;) {
      const open = firstOpenSeat(this.room);
      const visitor = open === null ? null : this.waitingConn(() => true);
      if (open === null || !visitor) return;
      this.seatVisitor(visitor[0], visitor[1], open);
    }
  }

  /** A seated player's connection went away. */
  private markLeft(seat: number): void {
    const r = this.room;
    const s = r.seats[seat];
    if (!s) return;
    if (r.phase === 'lobby') {
      if (seat === r.hostSeat) {
        // The host's seat is kept for the host to come back to.
        this.patchSeat(seat, { connected: false, ready: false });
        return;
      }
      this.forgetSeatTokens(seat);
      this.patchSeat(seat, openSeat(seat, s.color));
      this.seatWaiting();
      return;
    }
    if (s.kind !== 'human') return;
    this.patchSeat(seat, { connected: false, ready: false, awaySince: s.awaySince ?? this.sched.now() });
    this.note(seat, `${s.name} left the table.`);
    // Someone already waiting under this seat's name (a second device) takes it at once.
    const visitor = seat === r.hostSeat || this.locked.has(seat) ? null : this.waitingConn(n => sameName(n, s.name));
    if (visitor) { this.seatVisitor(visitor[0], visitor[1], seat, true); return; }
    this.armAway(seat);
  }

  /** Forget every token pointing at a seat (except the host's own); returns the forgotten tokens. */
  private forgetSeatTokens(seat: number): string[] {
    const out: string[] = [];
    for (const [token, s] of [...this.tokens]) {
      if (s === seat && token !== this.hostToken) { this.tokens.delete(token); out.push(token); }
    }
    return out;
  }

  /** Under the 'bot' away policy, a bot takes an away seat once the grace period ends. */
  private armAway(seat: number): void {
    const r = this.room;
    if (r.phase !== 'playing' || r.hold || r.settings.awayPolicy !== 'bot') return;
    const s = r.seats[seat];
    if (!s || s.kind !== 'human' || s.connected || s.autopilot || this.awayTimers.has(seat)) return;
    const takeOver = (): void => {
      const cur = this.room.seats[seat];
      if (!cur || cur.kind !== 'human' || cur.connected || cur.autopilot) return;
      if (this.room.phase !== 'playing' || this.room.hold) return;
      this.patchSeat(seat, { autopilot: true, botId: STAND_IN_BOT });
      this.note(seat, `A bot plays for ${cur.name} until they return.`);
    };
    if (r.settings.awayGraceMs <= 0) { takeOver(); return; }
    this.awayTimers.set(seat, this.timer(() => {
      this.awayTimers.delete(seat);
      takeOver();
      this.afterChange();
    }, r.settings.awayGraceMs));
  }

  private clearAway(seat: number): void {
    const h = this.awayTimers.get(seat);
    if (h !== undefined) { this.sched.clearTimeout(h); this.awayTimers.delete(seat); }
  }

  private patchSeat(index: number, patch: Partial<Seat>): void {
    this.room = { ...this.room, seats: this.room.seats.map(s => (s.index === index ? { ...s, ...patch, index } : s)) };
  }

  private seatName(seat: number): string {
    return this.room.seats[seat]?.name || `Seat ${seat + 1}`;
  }

  private note(seat: number | null, text: string): void {
    this.room = { ...this.room, log: appendLog(this.room.log, [{ seq: this.room.seq, seat, text }]) };
  }

  private gameOverText(winner: number | null, tied: readonly number[], reason: string | null): string {
    const how = reason === 'tesseracts' ? 'with 4 Tesseracts' : 'on points';
    if (winner !== null) return `Game over: ${this.seatName(winner)} wins ${how}.`;
    if (tied.length > 0) return `Game over: ${tied.map(t => this.seatName(t)).join(' and ')} share the win ${how}.`;
    return 'Game over.';
  }

  // --- After every change: bots, timers, save, broadcast ---------------------------

  private afterChange(re?: Reply): void {
    if (this.disposed) return;
    if (botSpeedOf(this.room.settings) === 'instant') this.runBots(BOT_BATCH);
    this.updateTimers();
    this.scheduleBot();
    this.save();
    this.broadcast(re);
    this.burst = false;
    for (const fn of [...this.listeners]) {
      // A listener (the interface) that throws must not undo a change everyone already received.
      try { fn(); } catch (e) {
        // eslint-disable-next-line no-console
        console.error('HostSession: a listener failed', e);
      }
    }
  }

  /** The next seat the host must play with a bot, if any. */
  private nextBotTurn(): BotTurn | null {
    const r = this.room;
    const g = r.game;
    if (r.phase !== 'playing' || r.hold || !g || g.gameOver) return null;
    for (const e of g.pendingFactoryOps) {
      if (isBotControlled(r.seats[e.ownerId])) return { seat: e.ownerId, pendingPieceId: e.pieceId };
    }
    if (g.pendingFactoryOps.length > 0) return null; // people are still choosing
    const a = activeSeat(g);
    if (a !== null && isBotControlled(r.seats[a])) return { seat: a, pendingPieceId: null };
    return null;
  }

  private runBots(limit: number): void {
    for (let i = 0; i < limit; i++) {
      if (this.botStalledAt === this.room.seq) return;
      const turn = this.nextBotTurn();
      if (!turn) return;
      if (!this.botStep(turn)) { this.botStalledAt = this.room.seq; return; }
    }
  }

  /** Bots with a delay play one move per tick; instant bots continue their batch on the next tick. */
  private scheduleBot(): void {
    if (this.botTimer !== null || this.botStalledAt === this.room.seq || !this.nextBotTurn()) return;
    const instant = botSpeedOf(this.room.settings) === 'instant';
    const delay = instant ? 0 : this.botPause();
    this.botTimer = this.timer(() => {
      this.botTimer = null;
      if (!instant) this.runBots(1);
      this.afterChange(); // instant bots play their next run here
    }, delay);
  }

  /** How long the next bot waits, so the previous move can be followed on the table (pacing.ts). */
  private botPause(): number {
    const turn = this.nextBotTurn();
    const g = this.room.game;
    if (!turn || !g) return 0;
    const offTurn = turn.pendingPieceId !== null && activeSeat(g) !== turn.seat;
    return botPauseMs(this.room.settings, lastMoveOf(this.room.lastEvents), offTurn);
  }

  /** One bot move. Falls back to a safe move if the bot fails; false if nothing worked. */
  private botStep(turn: BotTurn): boolean {
    const g = this.room.game!;
    const seat = turn.seat;
    const bot = botById(this.room.seats[seat]?.botId ?? STAND_IN_BOT).fn;
    let action: Action | null = null;
    try { action = bot(g, seat as PlayerId); } catch { action = null; }
    if (action && this.applyMove(seat, action, null, 'bot').ok) return true;

    if (turn.pendingPieceId !== null) {
      return this.applyMove(seat, { type: 'SKIP_FACTORY_ROLL', pieceId: turn.pendingPieceId, ownerId: seat as PlayerId }, null, 'bot').ok;
    }
    if (g.phase === 'roll') return this.applyMove(seat, { type: 'ROLL_DICE', rolls: [] }, null, 'bot').ok;
    for (const a of legalActions(g, seat as PlayerId)) {
      if (this.applyMove(seat, a, null, 'bot').ok) return true;
    }
    this.note(seat, `The bot for ${this.seatName(seat)} found no move.`);
    return false;
  }

  // --- Timers ----------------------------------------------------------------------

  private clearTimer(which: 'op' | 'roundEnd' | 'bot'): void {
    if (which === 'op' && this.opTimer !== null) { this.sched.clearTimeout(this.opTimer); this.opTimer = null; }
    if (which === 'roundEnd' && this.roundEndTimer !== null) {
      this.sched.clearTimeout(this.roundEndTimer);
      this.roundEndTimer = null;
      this.roundEndKey = null;
    }
    if (which === 'bot' && this.botTimer !== null) { this.sched.clearTimeout(this.botTimer); this.botTimer = null; }
  }

  /** Arm or clear the two default-move timers to match the current state. */
  private updateTimers(): void {
    const r = this.room;
    const g = r.game;
    const live = r.phase === 'playing' && !r.hold && !!g && !g.gameOver;
    const now = this.sched.now();
    const active = activeSeat(g);
    let { opDeadline, roundEndDeadline } = r;

    // Off-turn operate-or-skip: only decisions owed by people (present or away), not by the active player.
    const offTurn = live && g!.pendingFactoryOps.some(e => e.ownerId !== active && isHumanControlled(r.seats[e.ownerId]));
    const opMs = r.settings.factoryOpTimeoutMs;
    if (offTurn && opMs > 0) {
      if (this.opTimer === null) {
        opDeadline = now + opMs;
        this.opTimer = this.timer(() => this.onOpTimeout(), opMs);
      }
    } else {
      this.clearTimer('op');
      opDeadline = null;
    }

    // Idle round-end turn of a person.
    const reMs = r.settings.roundEndTimeoutMs;
    const key = live && g!.phase === 'roundEnd' && active !== null && isHumanControlled(r.seats[active]) && reMs > 0
      ? `${g!.round}:${g!.activePlayerIndex}` : null;
    if (key !== null) {
      if (this.roundEndTimer === null || this.roundEndKey !== key) {
        this.clearTimer('roundEnd');
        this.roundEndKey = key;
        roundEndDeadline = now + reMs;
        this.roundEndTimer = this.timer(() => this.onRoundEndTimeout(), reMs);
      }
    } else {
      this.clearTimer('roundEnd');
      roundEndDeadline = null;
    }

    if (opDeadline !== r.opDeadline || roundEndDeadline !== r.roundEndDeadline) {
      this.room = { ...r, opDeadline, roundEndDeadline };
    }
  }

  /** Default for unanswered off-turn activations: operate when affordable, otherwise skip. */
  private onOpTimeout(): void {
    this.opTimer = null;
    const r = this.room;
    const g = r.game;
    if (r.phase === 'playing' && !r.hold && g && !g.gameOver) {
      const active = activeSeat(g);
      const owed = g.pendingFactoryOps.filter(e => e.ownerId !== active && isHumanControlled(r.seats[e.ownerId]));
      for (const e of owed) {
        const applied = this.applyMove(e.ownerId, { type: 'OPERATE_BUILDING', pieceId: e.pieceId, ownerId: e.ownerId }, null, 'auto').ok
          || this.applyMove(e.ownerId, { type: 'SKIP_FACTORY_ROLL', pieceId: e.pieceId, ownerId: e.ownerId }, null, 'auto').ok;
        if (!applied) continue;
        this.note(e.ownerId, `${this.seatName(e.ownerId)} did not choose in time.`);
        this.room = { ...this.room, lastEvents: this.mergeEvents([{ kind: 'timeout', seat: e.ownerId, what: 'factory-op' }]) };
      }
    }
    this.afterChange();
  }

  /** Default for an idle round-end turn: end it. */
  private onRoundEndTimeout(): void {
    this.roundEndTimer = null;
    this.roundEndKey = null;
    const r = this.room;
    const g = r.game;
    const active = activeSeat(g);
    if (r.phase === 'playing' && !r.hold && g && !g.gameOver && g.phase === 'roundEnd'
      && active !== null && isHumanControlled(r.seats[active])) {
      if (this.applyMove(active, { type: 'END_ACTIONS' }, null, 'auto').ok) {
        this.note(active, `${this.seatName(active)}'s round-end turn timed out.`);
        this.room = { ...this.room, lastEvents: this.mergeEvents([{ kind: 'timeout', seat: active, what: 'round-end' }]) };
      }
    }
    this.afterChange();
  }

  // --- Output ----------------------------------------------------------------------

  /** Save on every room change while a game is on (moves, seats, hold, log). */
  private save(): void {
    const r = this.room;
    if (!this.store || r.phase === 'lobby' || !r.game || r === this.savedRoom) return;
    writeSave(this.store, r, { savedAt: this.sched.now(), app: this.app });
    this.savedRoom = r;
  }

  private broadcast(re?: Reply): void {
    const now = this.sched.now();
    const moves = this.movesSinceBroadcast();
    for (const [conn, info] of this.conns) {
      if (info.token === null) continue;
      if (this.welcomes.has(conn)) {
        this.send(conn, { t: 'welcome', v: PROTOCOL, seat: info.seat, room: this.room, now, ...moves });
      } else {
        const id = re && re.conn === conn ? re.id : null;
        this.send(conn, id !== null ? { t: 'room', room: this.room, now, re: id, ...moves } : { t: 'room', room: this.room, now, ...moves });
      }
    }
    this.welcomes.clear();
    this.broadcastSeq = this.moveJournal ? journalEnd(this.moveJournal) : null;
    this.broadcasts++;
    this.forgetOldPeeks();
  }

  private sendRoom(conn: Conn, re: string | null): void {
    const now = this.sched.now();
    this.send(conn, re !== null ? { t: 'room', room: this.room, now, re } : { t: 'room', room: this.room, now });
  }

  /** The moves a client's journal lacks; the whole journal when its own cannot be continued. */
  private sendJournal(conn: Conn, msg: Extract<ClientMsg, { t: 'journal' }>, re: string | null): void {
    const j = this.moveJournal;
    const reId = re !== null ? { re } : {};
    if (!j || !this.room.game) { this.send(conn, { t: 'journal', ...reId }); return; }
    const have = msg.have;
    if (have !== null && msg.seed === journalSeed(j) && have >= journalFrom(j) && have <= journalEnd(j)) {
      this.send(conn, { t: 'journal', ...reId, from: have, moves: movesAfter(j, have) });
      return;
    }
    this.send(conn, { t: 'journal', ...reId, from: journalFrom(j), moves: [...j.moves], start: j.start });
  }

  /** The moves applied since the last broadcast, when the journal still holds them. */
  private movesSinceBroadcast(): { moves?: { from: number; list: Action[] } } {
    const j = this.moveJournal;
    const from = this.broadcastSeq;
    if (!j || from === null || from < journalFrom(j) || from >= journalEnd(j)) return {};
    return { moves: { from, list: movesAfter(j, from) } };
  }

  private send(conn: Conn, msg: HostMsg): void {
    conn.send(msg);
  }

  private nope(conn: Conn, id: string | null, error: WireError): void {
    this.send(conn, { t: 'nope', id, error });
  }

  /** Tell a connection why it is being closed, then close it shortly after so the message gets out. */
  private closeWith(conn: Conn, why: ClosedWhy): void {
    this.dropPeeks(conn);
    this.conns.delete(conn);
    this.welcomes.delete(conn);
    this.send(conn, { t: 'closed', why });
    this.closing.add(conn);
    this.sched.setTimeout(() => { this.closing.delete(conn); conn.close(); }, CLOSE_DELAY_MS);
  }
}

/** Every seat's ready flag cleared, except the host's own. */
function unreadyOthers(seats: readonly Seat[], hostSeat: number): Seat[] {
  return seats.map(s => (s.index === hostSeat ? s : { ...s, ready: false }));
}

/** The host is the only person at the table (the other seats are bots or open). */
export function onlyHostPlays(room: Room): boolean {
  const humans = room.seats.filter(s => s.kind === 'human');
  return humans.length === 1 && humans[0]!.index === room.hostSeat;
}

/** The first line of a game's log: who goes first, as the rulebook decides it, by a roll. */
export function firstPlayerText(game: GameState, seats: readonly Seat[]): string {
  const first = game.turnOrder[0];
  const name = first === undefined ? 'A player' : seats[first]?.name || `Seat ${first + 1}`;
  return `${name} goes first: a roll of the dice decided the order of play.`;
}

/** Apply a partial settings change, clamped to sensible ranges; null if a value is not usable. */
function mergeSettings(cur: RoomSettings, patch: Partial<RoomSettings>): RoomSettings | null {
  const next: RoomSettings = { ...cur };
  if (patch.playerCount !== undefined) {
    if (patch.playerCount !== 2 && patch.playerCount !== 3 && patch.playerCount !== 4) return null;
    next.playerCount = patch.playerCount;
  }
  for (const k of Object.keys(SETTING_RANGES) as (keyof typeof SETTING_RANGES)[]) {
    const v: unknown = patch[k];
    if (v === undefined) continue;
    if (typeof v !== 'number' || !Number.isFinite(v)) return null;
    const [lo, hi] = SETTING_RANGES[k];
    next[k] = Math.min(hi, Math.max(lo, v));
  }
  if (patch.awayPolicy !== undefined) {
    if (patch.awayPolicy !== 'bot' && patch.awayPolicy !== 'wait') return null;
    next.awayPolicy = patch.awayPolicy;
  }
  if (patch.botSpeed !== undefined) {
    if (!BOT_SPEEDS.includes(patch.botSpeed)) return null;
    next.botSpeed = patch.botSpeed;
  } else if (patch.botDelayMs !== undefined) {
    // A fixed pause asked for directly (tests, the network bench): 0 is instant, more is fast.
    next.botSpeed = next.botDelayMs > 0 ? 'fast' : 'instant';
  }
  return next;
}
