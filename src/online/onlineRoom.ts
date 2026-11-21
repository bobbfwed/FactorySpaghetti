// The online room: hosting, joining, reconnecting and host hand-over, on top of the session
// layer and any Transport. It never looks inside the game; it only decides who hosts and who
// connects to whom.
//
// When a client loses its host it first tries the same code once (perhaps only its own link
// dropped). If nobody answers, every client applies the same rule to its copy of the room: the
// first connected human seat that is not the old host takes over and registers the same code
// again; the others wait a little and then rejoin it. If the successor never appears, the
// waiting clients pass over it, one seat at a time, so the next in line takes over. The
// transport lets only one browser register a code, so two hosts can never both be reachable:
// a would-be host that finds the code taken checks whether someone is hosting it and joins.

import type { Conn, HostHandle, JoinErrorKind, Transport } from '../net/conn';
import { JoinError } from '../net/conn';
import { makeRoomCode, normalizeCode } from '../net/roomCode';
import type { Room } from '../session/room';
import type { SaveEnvelope } from '../session/save';
import type { SaveStore } from '../session/store';
import type { Scheduler } from '../session/scheduler';
import { realScheduler } from '../session/scheduler';
import type { HostOptions } from '../session/hostSession';
import { HostSession } from '../session/hostSession';
import { ClientSession, chooseSuccessor, promoteToHost } from '../session/clientSession';

export interface OnlineOptions {
  transport: Transport;
  name: string;
  token: string;
  store?: SaveStore;
  scheduler?: Scheduler;
  appVersion?: string;
  retryMs?: number;       // default 2000
  retries?: number;       // default 30
  rejoinDelayMs?: number; // default 1500
  /** How long a joiner waits for the host's welcome after connecting. Default 15000. */
  welcomeTimeoutMs?: number;
  /** uint32 seed source for a new game (tests). */
  randomSeed?: () => number;
}

export type OnlineStatus =
  | 'online'        // connected (or hosting)
  | 'reconnecting'  // lost the host; trying to get back in
  | 'taking-over'   // this browser is becoming the new host
  | 'lost'          // nobody could host; this browser still holds the last room
  | 'closed';       // the host ended it on purpose (see closedWhy), or this browser left

/** How many times a new host tries fresh codes when it picked the code itself. */
const FRESH_CODE_TRIES = 6;

interface Settings {
  transport: Transport;
  name: string;
  token: string;
  store: SaveStore | undefined;
  sched: Scheduler;
  appVersion: string | undefined;
  retryMs: number;
  retries: number;
  rejoinDelayMs: number;
  welcomeTimeoutMs: number;
  randomSeed: (() => number) | undefined;
}

function settingsFrom(o: OnlineOptions): Settings {
  return {
    transport: o.transport,
    name: o.name,
    token: o.token,
    store: o.store,
    sched: o.scheduler ?? realScheduler,
    appVersion: o.appVersion,
    retryMs: o.retryMs ?? 2000,
    retries: Math.max(1, o.retries ?? 30),
    rejoinDelayMs: o.rejoinDelayMs ?? 1500,
    welcomeTimeoutMs: o.welcomeTimeoutMs ?? 15_000,
    randomSeed: o.randomSeed,
  };
}

function clientSession(conn: Conn, s: Settings): ClientSession {
  return new ClientSession(conn, {
    name: s.name, token: s.token, now: (): number => s.sched.now(), scheduler: s.sched,
    ...(s.store ? { store: s.store } : {}),
    ...(s.appVersion !== undefined ? { appVersion: s.appVersion } : {}),
  });
}

/** Accepts connections as soon as the code is registered, before the session exists. */
class Doorway {
  session: HostSession | null = null;
  private waiting: Conn[] = [];
  readonly onConnection = (conn: Conn): void => {
    if (this.session) this.session.accept(conn);
    else this.waiting.push(conn);
  };
  open(session: HostSession): void {
    this.session = session;
    const queued = this.waiting;
    this.waiting = [];
    for (const c of queued) if (c.open) session.accept(c);
  }
  turnAway(): void {
    for (const c of this.waiting) c.close();
    this.waiting = [];
  }
}

export class OnlineRoom {
  /** The same object for the whole life of the room, across reconnects and hand-overs. */
  readonly client: ClientSession;
  readonly code: string;
  role: 'host' | 'client';
  status: OnlineStatus = 'online';
  /** Why the room closed, when status is 'closed' because of the host (from the session layer). */
  closedWhy: string | null = null;
  /** The host session this browser runs, while role is 'host'. */
  hostSession: HostSession | null;
  /** The last transport failure seen while reconnecting or taking over (for the interface). */
  lastError: JoinErrorKind | null = null;

  private readonly s: Settings;
  private handle: HostHandle | null;
  private conn: Conn | null;
  private left = false;
  private joining = false;
  private epoch = 0;
  private readonly timers = new Set<unknown>();
  private readonly listeners = new Set<() => void>();
  private readonly offClient: () => void;
  private readonly offLost: () => void;

  private constructor(s: Settings, code: string, client: ClientSession, parts: { host?: HostSession; handle?: HostHandle; conn?: Conn }) {
    this.s = s;
    this.code = code;
    this.client = client;
    this.hostSession = parts.host ?? null;
    this.handle = parts.handle ?? null;
    this.conn = parts.conn ?? null;
    this.role = parts.host ? 'host' : 'client';
    this.offLost = client.onHostLost(() => this.onHostLost());
    this.offClient = client.subscribe(() => this.onClientChange());
  }

  // ── Creating a room ───────────────────────────────────────────────────────────

  /**
   * Host a room: a new game, or a saved one (`resume`). Without `code`, a fresh code is picked,
   * and picked again if it is taken. `seat` names the host's seat in a resumed game when the
   * host's name does not match one.
   */
  static async host(opts: OnlineOptions & { code?: string; resume?: SaveEnvelope; seat?: number }): Promise<OnlineRoom> {
    const s = settingsFrom(opts);
    const fixed = opts.code !== undefined;
    let code = fixed ? normalizeCode(opts.code!) : makeRoomCode();
    if (code === null) throw new JoinError('other', 'A room code is five letters (no I or O).');
    const door = new Doorway();
    let handle: HostHandle | null = null;
    for (let attempt = 1; !handle; attempt++) {
      try {
        handle = await s.transport.host(code, door.onConnection);
      } catch (e) {
        if (!fixed && e instanceof JoinError && e.kind === 'code-taken' && attempt < FRESH_CODE_TRIES) {
          code = makeRoomCode();
          continue;
        }
        throw e;
      }
    }
    let session: HostSession;
    try {
      const hostOpts: HostOptions = {
        code, hostName: s.name, hostToken: s.token, scheduler: s.sched,
        ...(s.appVersion !== undefined ? { appVersion: s.appVersion } : {}),
        ...(s.randomSeed ? { randomSeed: s.randomSeed } : {}),
        ...(opts.resume ? { room: opts.resume.room, mode: 'resume' as const, journal: opts.resume.journal ?? null } : {}),
        ...(opts.resume && opts.seat !== undefined ? { hostSeat: opts.seat } : {}),
      };
      session = new HostSession(hostOpts);
    } catch (e) {
      door.turnAway();
      handle.close();
      throw e;
    }
    door.open(session);
    const client = clientSession(session.connectLocal(), s);
    const room = new OnlineRoom(s, code, client, { host: session, handle });
    await room.untilWelcomed(false);
    return room;
  }

  /** Join a room by code. Rejects with JoinError (transport failures, or the host turning us away). */
  static async join(opts: OnlineOptions & { code: string }): Promise<OnlineRoom> {
    const s = settingsFrom(opts);
    const code = normalizeCode(opts.code);
    if (code === null) throw new JoinError('no-room', 'A room code is five letters (no I or O).');
    const conn = await s.transport.join(code);
    const client = clientSession(conn, s);
    const room = new OnlineRoom(s, code, client, { conn });
    try {
      await room.untilWelcomed(true);
    } catch (e) {
      room.leave();
      throw e;
    }
    return room;
  }

  /** Resolve once the host has welcomed this client; reject if it refuses or never answers. */
  private untilWelcomed(timed: boolean): Promise<void> {
    if (this.client.status === 'joined') return Promise.resolve();
    this.joining = true;
    return new Promise<void>((resolve, reject) => {
      let timer: unknown = null;
      const finish = (err: JoinError | null): void => {
        off();
        offLost();
        if (timer !== null) { this.s.sched.clearTimeout(timer); this.timers.delete(timer); }
        this.joining = false;
        if (err) reject(err); else resolve();
      };
      const off = this.client.subscribe(() => {
        if (this.client.status === 'joined') finish(null);
        else if (this.client.status === 'closed') finish(refusal(this.client.closedWhy));
      });
      const offLost = this.client.onHostLost(() => finish(new JoinError('other', 'The host closed the connection before letting us in.')));
      if (timed) timer = this.after(this.s.welcomeTimeoutMs, () => finish(new JoinError('timeout', 'Connected, but the host never let us in.')));
    });
  }

  // ── Public surface ────────────────────────────────────────────────────────────

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }

  /**
   * Leave on purpose. A host that leaves hands the room over to the next player unless
   * `endRoom` is set, which ends it for everyone.
   */
  leave(opts: { endRoom?: boolean } = {}): void {
    if (this.left) return;
    this.left = true;
    this.epoch++;
    for (const t of this.timers) this.s.sched.clearTimeout(t);
    this.timers.clear();
    this.offLost();
    if (this.hostSession) this.hostSession.dispose(opts.endRoom ? { notify: true } : {});
    this.handle?.close();
    this.conn?.close();
    this.hostSession = null;
    this.handle = null;
    this.conn = null;
    (this.client as { dispose?: () => void }).dispose?.();
    this.offClient();
    this.status = 'closed';
    this.emit();
    this.listeners.clear();
  }

  // ── Losing the host ───────────────────────────────────────────────────────────

  private onClientChange(): void {
    if (this.left) return;
    if (this.client.status === 'closed' && this.status !== 'closed' && !this.joining) {
      // The host ended the room, turned us away, or our seat was taken over elsewhere.
      this.closedWhy = this.client.closedWhy ?? null;
      this.epoch++;
      this.status = 'closed';
    }
    this.emit();
  }

  private onHostLost(): void {
    if (this.left || this.joining || this.role !== 'client' || this.status === 'closed') return;
    const epoch = ++this.epoch;
    void this.recover(epoch);
  }

  private stale(epoch: number): boolean {
    return this.left || epoch !== this.epoch;
  }

  private async recover(epoch: number): Promise<void> {
    this.setStatus('reconnecting');
    // Perhaps only this browser's link dropped: try the host straight away.
    const first = await this.tryJoin();
    if (this.stale(epoch)) { first?.close(); return; }
    if (first) { this.reattach(first); return; }

    const room = this.client.room;
    const me = this.client.seat;
    const passedOver = new Set<number>();
    if (room && me !== null && this.successor(room, me, passedOver) === me) {
      await this.takeOver(epoch);
      return;
    }

    await this.wait(this.s.rejoinDelayMs);
    if (this.stale(epoch)) return;
    const half = Math.max(1, Math.floor(this.s.retries / 2));
    for (let n = 1; ; n++) {
      const conn = await this.tryJoin();
      if (this.stale(epoch)) { conn?.close(); return; }
      if (conn) { this.reattach(conn); return; }
      // Every `half` failures, pass over the seat that should have taken over by now.
      if (room && me !== null && n % half === 0) {
        const expected = this.successor(room, me, passedOver);
        if (expected !== null && expected !== me) passedOver.add(expected);
        if (this.successor(room, me, passedOver) === me) {
          await this.takeOver(epoch);
          return;
        }
      }
      if (n >= this.s.retries) { this.setStatus('lost'); return; }
      await this.wait(this.s.retryMs);
      if (this.stale(epoch)) return;
    }
  }

  /**
   * The seat that should host now, by the session layer's rule, from this client's copy of the
   * room: this client counts as connected (it knows it is alive) and passed-over seats do not.
   */
  private successor(room: Room, me: number, passedOver: ReadonlySet<number>): number | null {
    const seats = room.seats.map(seat => ({
      ...seat,
      connected: (seat.connected || seat.index === me) && !passedOver.has(seat.index),
    }));
    return chooseSuccessor({ ...room, seats });
  }

  private async takeOver(epoch: number): Promise<void> {
    this.setStatus('taking-over');
    this.client.flushJournal(); // the journal goes to the new host session; keep this device's copy current too
    const door = new Doorway();
    let handle: HostHandle | null = null;
    for (let n = 1; ; n++) {
      let kind: JoinErrorKind | null = null;
      try {
        handle = await this.s.transport.host(this.code, door.onConnection);
      } catch (e) {
        kind = e instanceof JoinError ? e.kind : 'other';
        this.lastError = kind;
      }
      if (this.stale(epoch)) { door.turnAway(); handle?.close(); return; }
      if (handle) break;
      if (kind === 'code-taken') {
        // Usually the old host's registration not yet released; but someone else may be hosting.
        const conn = await this.tryJoin();
        if (this.stale(epoch)) { conn?.close(); return; }
        if (conn) { this.reattach(conn); return; }
      }
      if (n >= this.s.retries) { this.setStatus('lost'); return; }
      await this.wait(this.s.retryMs);
      if (this.stale(epoch)) return;
    }

    const room = this.client.room;
    const me = this.client.seat;
    let session: HostSession;
    try {
      if (!room || me === null) throw new Error('no room to take over');
      session = promoteToHost(room, me, {
        hostToken: this.s.token, scheduler: this.s.sched,
        // The moves so far, which every client keeps, so the replay survives the hand-over.
        journal: this.client.journal,
        ...(this.s.appVersion !== undefined ? { appVersion: this.s.appVersion } : {}),
        ...(this.s.randomSeed ? { randomSeed: this.s.randomSeed } : {}),
      });
    } catch {
      door.turnAway();
      handle.close();
      this.setStatus('lost');
      return;
    }
    door.open(session);
    this.hostSession = session;
    this.handle = handle;
    this.role = 'host';
    const old = this.conn;
    this.conn = null;
    old?.close();
    this.client.reattach(session.connectLocal());
    this.setStatus('online');
  }

  private async tryJoin(): Promise<Conn | null> {
    try {
      return await this.s.transport.join(this.code);
    } catch (e) {
      this.lastError = e instanceof JoinError ? e.kind : 'other';
      return null;
    }
  }

  private reattach(conn: Conn): void {
    this.conn = conn;
    this.lastError = null;
    this.client.reattach(conn);
    this.setStatus('online');
  }

  // ── Helpers ───────────────────────────────────────────────────────────────────

  private after(ms: number, fn: () => void): unknown {
    const h = this.s.sched.setTimeout(() => { this.timers.delete(h); fn(); }, ms);
    this.timers.add(h);
    return h;
  }

  private wait(ms: number): Promise<void> {
    return new Promise<void>(resolve => { this.after(ms, resolve); });
  }

  private setStatus(status: OnlineStatus): void {
    if (this.status === status) return;
    this.status = status;
    this.emit();
  }

  private emit(): void {
    for (const fn of [...this.listeners]) fn();
  }
}

function refusal(why: string | null): JoinError {
  const text: Record<string, string> = {
    full: 'The game is full.',
    version: 'The host runs a different version of the game. Reload the page to get the newest version.',
    kicked: 'The host removed you from this game.',
    ended: 'The host ended the game.',
    replaced: 'This seat was taken over from another tab or device.',
    invalid: 'The host did not accept this player name or device.',
  };
  return new JoinError('other', (why && text[why]) || 'The host turned the connection away.');
}
