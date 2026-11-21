// The client session: one player's view of a hosted room. Sends intents, keeps the latest
// room, keeps at most one unconfirmed move so it can be re-sent after a reconnect or a host
// change, and stores the latest room as an automatic save on this device.

import type { Conn } from '../net/conn';
import type { Action } from '../engine/actions';
import type { Room, RoomSettings, SeatColor } from './room';
import type { ClientMsg, ClosedWhy, HostMsg, MovesBlock, WireError } from './protocol';
import { PROTOCOL, parseHostMsg } from './protocol';
import type { Scheduler } from './scheduler';
import { randomId, realScheduler } from './scheduler';
import { acceptHostRoom } from './save';
import type { SaveStore } from './store';
import { readJournal, writeJournal, writeSave } from './store';
import type { JournalData } from './journal';
import {
  capJournal, copyJournal, extendJournal, journalEnd, journalFrom, journalSeed, partialJournal,
} from './journal';
import type { HostOptions } from './hostSession';
import { HostSession } from './hostSession';
import { chooseSuccessor } from './seating';

export { chooseSuccessor };

export type ActResult = { ok: true } | { ok: false; error: WireError };

export interface ClientOptions {
  name: string;
  /** 16 to 64 characters; keep it in this browser's storage so a reload gets the seat back. */
  token: string;
  store?: SaveStore;
  /** This device's clock; injectable for tests. */
  now?: () => number;
  /** Timers (the throttled journal write); defaults to the real clock. */
  scheduler?: Scheduler;
  appVersion?: string;
}

/**
 * The stored journal is written at most this often while moves arrive (it can be 100 KB or
 * more). A crash loses at most this much of it; the host fills such a gap on the next visit.
 */
export const JOURNAL_WRITE_MS = 2000;

/** The move waiting for the host's answer. */
export interface PendingMove {
  id: string;
  action: Action;
  /** room.seq when the move was first sent (null until it has been sent). */
  seq: number | null;
}

/** A move of this player that the host (or the engine behind it) refused. */
export interface RefusedMove {
  action: Action;
  error: WireError;
  /** room.seq when it was refused. */
  seq: number;
}

type CommandMsg = Exclude<ClientMsg, { t: 'hello' | 'act' }>;
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

const closedError = (message: string): ActResult => ({ ok: false, error: { code: 'CLOSED', message } });

export class ClientSession {
  status: 'connecting' | 'joined' | 'closed' = 'connecting';
  closedWhy: ClosedWhy | null = null;
  room: Room | null = null;
  seat: number | null = null;
  /** A move sent (or about to be sent) but not yet confirmed by the host. */
  pending: PendingMove | null = null;
  /** The last move of ours the host refused in this session (for a rules-problem report). */
  lastRefused: RefusedMove | null = null;
  /**
   * Set when a new host turned out to be behind this device: it never received the last moves this
   * device saw (the old host closed while sending them), so the game goes on without them. The
   * interface says so once (see takeRollback); nothing else is lost or applied twice.
   */
  rolledBack: { from: number; to: number } | null = null;
  private seen: { seed: number; seq: number } | null = null;
  /**
   * This device's copy of the game's moves (see journal.ts). It reaches room.seq, except
   * briefly while the missing part is being fetched from the host.
   */
  private moveJournal: JournalData | null = null;
  private journalAsk: string | null = null;      // id of the unanswered journal request
  private storedJournalTried = false;
  private persisted: { j: JournalData; end: number; code: string } | null = null;
  private lastJournalWrite = -Infinity;
  private journalTimer: unknown = null;
  private readonly sched: Scheduler;

  private conn: Conn;
  private readonly name: string;
  private readonly token: string;
  private readonly store: SaveStore | undefined;
  private readonly clock: () => number;
  private readonly app: string;
  private offset = 0;              // host clock minus this device's clock
  private pendingDone: ((r: ActResult) => void) | null = null;
  private readonly commands = new Map<string, (r: ActResult) => void>();
  private readonly listeners = new Set<() => void>();
  private readonly hostLost = new Set<() => void>();

  constructor(conn: Conn, opts: ClientOptions) {
    this.name = opts.name;
    this.token = opts.token;
    this.store = opts.store;
    this.clock = opts.now ?? ((): number => Date.now());
    this.sched = opts.scheduler ?? realScheduler;
    this.app = opts.appVersion ?? 'dev';
    this.conn = conn;
    this.attach(conn);
  }

  // --- Connection ----------------------------------------------------------------

  private attach(conn: Conn): void {
    conn.onmessage = (m): void => { if (this.conn === conn) this.onMessage(m); };
    conn.onclose = (): void => { if (this.conn === conn) this.onConnClose(); };
    // Returning with a seat: name the seat and use its (possibly de-duplicated) name, so the
    // host can match us even when our token is new to it (after a host change).
    const seatName = this.seat !== null ? this.room?.seats[this.seat]?.name : undefined;
    const hello: ClientMsg = this.seat !== null && seatName
      ? { t: 'hello', v: PROTOCOL, name: seatName, token: this.token, seat: this.seat }
      : { t: 'hello', v: PROTOCOL, name: this.name, token: this.token };
    conn.send(hello);
  }

  /** After a reconnect or a host change: say hello again; the pending move is re-sent if the host lacks it. */
  reattach(conn: Conn): void {
    if (this.status === 'closed' && this.closedWhy === null) return; // disposed
    const old = this.conn;
    this.conn = conn;
    if (old !== conn && old.open) old.close();
    this.status = 'connecting';
    this.closedWhy = null;
    this.journalAsk = null; // a request to the old connection will not be answered
    this.flushJournal();
    this.attach(conn);
    this.emit();
  }

  /** The last undone moves, once (see rolledBack). */
  takeRollback(): { from: number; to: number } | null {
    const r = this.rolledBack;
    this.rolledBack = null;
    return r;
  }

  /** A copy of this device's journal of the current game, or null. */
  get journal(): JournalData | null {
    return this.moveJournal ? copyJournal(this.moveJournal) : null;
  }

  /** True while this device's journal reaches the room's current move. */
  get journalCurrent(): boolean {
    const j = this.moveJournal;
    return !!j && !!this.room?.game && journalEnd(j) === this.room.seq;
  }

  /** The connection closed without the host saying why (the host is gone). */
  onHostLost(fn: () => void): () => void {
    this.hostLost.add(fn);
    return () => { this.hostLost.delete(fn); };
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }

  /** Leave for good: close the connection; a waiting move and commands settle as CLOSED. */
  dispose(): void {
    if (this.status === 'closed' && this.closedWhy === null) return;
    this.flushJournal();
    this.status = 'closed';
    this.closedWhy = null;
    this.failAll('This session was closed.', true);
    if (this.conn.open) this.conn.close();
    this.emit();
    this.listeners.clear();
    this.hostLost.clear();
  }

  /** Milliseconds until a host-clock deadline, corrected for the clock difference. */
  msLeft(deadline: number | null): number | null {
    if (deadline === null) return null;
    return Math.max(0, deadline - (this.clock() + this.offset));
  }

  // --- Moves -----------------------------------------------------------------------

  /** Ask the host to make a move. One move at a time; resolves when the host confirms or refuses. */
  act(action: Action): Promise<ActResult> {
    if (this.status === 'closed') return Promise.resolve(closedError('The room is closed.'));
    if (this.pending) {
      return Promise.resolve({ ok: false, error: { code: 'BUSY', message: 'Still waiting for the host to confirm the last move.' } });
    }
    this.pending = { id: randomId(), action, seq: null };
    const result = new Promise<ActResult>(resolve => { this.pendingDone = resolve; });
    // Before the welcome (or while reconnecting) it is sent once the host has welcomed us.
    if (this.status === 'joined' && this.conn.open) this.sendPending();
    this.emit();
    return result;
  }

  /** First send carries the room.seq we saw; a re-send says so, keeping the original seq. */
  private sendPending(): void {
    const p = this.pending;
    if (!p) return;
    if (p.seq === null) {
      p.seq = this.room?.seq ?? 0;
      this.conn.send({ t: 'act', id: p.id, action: p.action, seq: p.seq } satisfies ClientMsg);
    } else {
      this.conn.send({ t: 'act', id: p.id, action: p.action, seq: p.seq, resend: true } satisfies ClientMsg);
    }
  }

  // --- Commands --------------------------------------------------------------------

  setReady(ready: boolean): Promise<ActResult> { return this.command({ t: 'ready', ready }); }
  setColor(color: SeatColor): Promise<ActResult> { return this.command({ t: 'color', color }); }
  sync(): Promise<ActResult> { return this.command({ t: 'sync' }); }
  configure(settings: Partial<RoomSettings>): Promise<ActResult> { return this.command({ t: 'cfg', settings }); }
  setSeat(index: number, kind: 'bot' | 'open', botId?: string): Promise<ActResult> {
    return this.command(botId === undefined ? { t: 'setSeat', index, kind } : { t: 'setSeat', index, kind, botId });
  }
  start(): Promise<ActResult> { return this.command({ t: 'start' }); }
  resumeGame(): Promise<ActResult> { return this.command({ t: 'resume' }); }
  assign(waitingId: string, seat: number): Promise<ActResult> { return this.command({ t: 'assign', waitingId, seat }); }
  /** The host may set any seat; a player may only turn their own autopilot off. */
  setAutopilot(seat: number, on: boolean): Promise<ActResult> { return this.command({ t: 'autopilot', seat, on }); }
  kick(seat: number): Promise<ActResult> { return this.command({ t: 'kick', seat }); }

  private command(msg: DistributiveOmit<CommandMsg, 'id'>): Promise<ActResult> {
    if (this.status === 'closed' || !this.conn.open) return Promise.resolve(closedError('Not connected to the host.'));
    const id = randomId();
    const result = new Promise<ActResult>(resolve => { this.commands.set(id, resolve); });
    this.conn.send({ ...msg, id } as ClientMsg);
    return result;
  }

  // --- Inbound ---------------------------------------------------------------------

  private onMessage(raw: unknown): void {
    if (this.status === 'closed') return;
    const msg: HostMsg | null = parseHostMsg(raw);
    if (!msg) return;
    switch (msg.t) {
      case 'welcome': {
        // The host is another browser: a room of the wrong shape is refused, seats are cleaned.
        const room = acceptHostRoom(msg.room);
        if (!room || (msg.seat !== null && (msg.seat < 0 || msg.seat >= room.seats.length))) return;
        this.seat = msg.seat;
        this.status = 'joined';
        this.setRoom(room, msg.now, null, msg.moves ?? null);
        // Send the unconfirmed move: for the first time, or again if the host never applied it.
        if (this.pending && this.conn.open && this.seat !== null) this.sendPending();
        break;
      }
      case 'room': {
        const room = acceptHostRoom(msg.room);
        if (!room) return;
        this.setRoom(room, msg.now, msg.re ?? null, msg.moves ?? null);
        break;
      }
      case 'journal':
        this.onJournal(msg);
        break;
      case 'nope':
        if (msg.id !== null && msg.id === this.journalAsk) {
          // A host without journal support: keep a journal from this position on.
          this.journalAsk = null;
          this.startPartialJournal();
        } else if (msg.id !== null && this.pending?.id === msg.id) {
          const p = this.pending;
          this.lastRefused = { action: p.action, error: msg.error, seq: this.room?.seq ?? 0 };
          this.finishPending({ ok: false, error: msg.error });
        } else if (msg.id !== null) this.finishCommand(msg.id, { ok: false, error: msg.error });
        break;
      case 'closed':
        // A deliberate end (full, kicked, replaced, ...): not a lost host.
        this.status = 'closed';
        this.closedWhy = msg.why;
        this.failAll(`The room closed (${msg.why}).`, true);
        break;
    }
    this.emit();
  }

  private setRoom(room: Room, hostNow: number, re: string | null, moves: MovesBlock | null): void {
    const g = room.game;
    if (g && this.seen && this.seen.seed === g.seed && room.seq < this.seen.seq) {
      this.rolledBack = { from: this.seen.seq, to: room.seq };
    }
    this.seen = g ? { seed: g.seed, seq: room.seq } : null;
    this.room = room;
    this.offset = hostNow - this.clock();
    const p = this.pending;
    if (p && (re === p.id || room.recent.some(r => r.id === p.id && r.seat === this.seat))) {
      this.finishPending({ ok: true });
    }
    if (re !== null) this.finishCommand(re, { ok: true });
    this.syncJournal(moves);
    if (this.store && room.phase !== 'lobby' && room.game) {
      writeSave(this.store, room, { savedAt: this.clock(), app: this.app });
    }
  }

  // --- The move journal --------------------------------------------------------------

  /** Follow the room: add the broadcast's moves, and ask the host for anything missing. */
  private syncJournal(moves: MovesBlock | null): void {
    const room = this.room;
    const game = room?.game;
    if (!room || !game || room.phase === 'lobby') { this.moveJournal = null; this.journalAsk = null; return; }
    let j = this.moveJournal;
    // A journal of another game, or one that went further than this room, is of no use.
    if (j && (journalSeed(j) !== game.seed || journalEnd(j) > room.seq)) j = null;
    if (!j && !this.storedJournalTried && this.store) {
      // After a reload, this device's stored journal of the room usually only lacks the last moves.
      this.storedJournalTried = true;
      const stored = readJournal(this.store, room.code);
      if (stored && journalSeed(stored) === game.seed && journalEnd(stored) <= room.seq) j = stored;
    }
    if (j && moves) extendJournal(j, moves.from, moves.list);
    this.moveJournal = j;
    if (j && journalEnd(j) === room.seq) {
      this.moveJournal = capJournal(j, game, room.seq);
      this.persistJournal();
      return;
    }
    this.askForJournal();
  }

  private askForJournal(): void {
    const game = this.room?.game;
    if (!game || this.journalAsk !== null || this.status !== 'joined' || !this.conn.open) return;
    const j = this.moveJournal;
    const id = randomId();
    this.journalAsk = id;
    this.conn.send({ t: 'journal', seed: game.seed, have: j ? journalEnd(j) : null, id } satisfies ClientMsg);
  }

  private onJournal(msg: Extract<HostMsg, { t: 'journal' }>): void {
    if (msg.re !== undefined && msg.re !== this.journalAsk) return; // an answer to an older request
    this.journalAsk = null;
    const room = this.room;
    const game = room?.game;
    if (!room || !game) return;
    const before = this.moveJournal ? journalEnd(this.moveJournal) : -1;
    if (msg.from !== undefined && msg.moves) {
      if (msg.start) {
        const theirs: JournalData = { start: msg.start, moves: [...msg.moves] };
        const mine = this.moveJournal;
        const mineOk = mine && journalEnd(mine) === room.seq;
        if (!mineOk && journalSeed(theirs) === game.seed && journalEnd(theirs) === room.seq) this.moveJournal = theirs;
      } else if (this.moveJournal && journalSeed(this.moveJournal) === game.seed) {
        extendJournal(this.moveJournal, msg.from, msg.moves);
      }
    }
    const j = this.moveJournal;
    if (j && journalEnd(j) === room.seq) {
      this.moveJournal = capJournal(j, game, room.seq);
      this.persistJournal();
    } else if (j && journalEnd(j) < room.seq && journalEnd(j) > before) {
      // The game moved on while the answer was on its way: ask again for the rest.
      this.askForJournal();
    } else {
      // The host does not have the missing part either: keep a journal from this position on.
      this.startPartialJournal();
    }
  }

  private startPartialJournal(): void {
    const room = this.room;
    if (!room?.game || room.phase === 'lobby') return;
    this.moveJournal = partialJournal(room.game, room.seq);
    this.persistJournal();
  }

  /** Store the journal: at once when the game is over, otherwise at most every JOURNAL_WRITE_MS. */
  private persistJournal(): void {
    if (!this.store || !this.moveJournal || !this.room) return;
    if (this.room.game?.gameOver) { this.flushJournal(); return; }
    if (this.journalTimer !== null) return; // a write is already due
    const wait = this.lastJournalWrite + JOURNAL_WRITE_MS - this.sched.now();
    if (wait <= 0) { this.flushJournal(); return; }
    this.journalTimer = this.sched.setTimeout(() => { this.journalTimer = null; this.flushJournal(); }, wait);
  }

  /**
   * Write this device's journal now, if it changed since the last write. The app calls this
   * when the page is hidden or closed; the session calls it when it ends or changes host.
   */
  flushJournal(): void {
    if (this.journalTimer !== null) { this.sched.clearTimeout(this.journalTimer); this.journalTimer = null; }
    const j = this.moveJournal;
    const room = this.room;
    if (!this.store || !j || !room) return;
    const end = journalEnd(j);
    const p = this.persisted;
    if (p && p.j === j && p.end === end && p.code === room.code) return;
    writeJournal(this.store, room.code, j);
    this.persisted = { j, end, code: room.code };
    this.lastJournalWrite = this.sched.now();
  }

  /** The move number this device's journal starts from (0 for the whole game), or null. */
  get journalStart(): number | null {
    return this.moveJournal ? journalFrom(this.moveJournal) : null;
  }

  private onConnClose(): void {
    if (this.status === 'closed') return;
    this.status = 'connecting';
    this.failAll('Lost the connection to the host.', false);
    for (const fn of [...this.hostLost]) fn();
    this.emit();
  }

  private finishPending(r: ActResult): void {
    const done = this.pendingDone;
    this.pending = null;
    this.pendingDone = null;
    done?.(r);
  }

  private finishCommand(id: string, r: ActResult): void {
    const done = this.commands.get(id);
    if (!done) return;
    this.commands.delete(id);
    done(r);
  }

  /** Commands are not re-sent after a reconnect, so they fail; the pending move fails only when the session ends. */
  private failAll(message: string, includingMove: boolean): void {
    for (const id of [...this.commands.keys()]) this.finishCommand(id, closedError(message));
    if (includingMove && this.pending) this.finishPending(closedError(message));
  }

  private emit(): void {
    for (const fn of [...this.listeners]) fn();
  }
}

/** Turn this client's copy of the room into the new host (when the old host is gone). */
export function promoteToHost(
  room: Room,
  mySeat: number,
  opts: Omit<HostOptions, 'code' | 'room' | 'mode' | 'hostSeat' | 'hostName'> & { hostName?: string },
): HostSession {
  return new HostSession({
    ...opts,
    code: room.code,
    hostName: opts.hostName ?? room.seats[mySeat]?.name ?? 'Host',
    room,
    mode: 'takeover',
    hostSeat: mySeat,
  });
}
