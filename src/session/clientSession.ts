// The client session: one player's view of a hosted room. Sends intents, keeps the latest
// room, keeps at most one unconfirmed move so it can be re-sent after a reconnect or a host
// change, and stores the latest room as an automatic save on this device.

import type { Conn } from '../net/conn';
import type { Action } from '../engine/actions';
import type { Room, RoomSettings, SeatColor } from './room';
import type { ClientMsg, ClosedWhy, HostMsg, WireError } from './protocol';
import { PROTOCOL, parseHostMsg } from './protocol';
import { randomId } from './scheduler';
import type { SaveStore } from './store';
import { writeSave } from './store';
import type { HostOptions } from './hostSession';
import { HostSession } from './hostSession';
import { chooseSuccessor } from './seating';

export { chooseSuccessor };

export type ActResult = { ok: true } | { ok: false; error: WireError };

export interface ClientOptions {
  name: string;
  token: string;
  store?: SaveStore;
  /** This device's clock; injectable for tests. */
  now?: () => number;
  appVersion?: string;
}

type CommandMsg = Exclude<ClientMsg, { t: 'hello' | 'act' }>;
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

const closedError = (message: string): ActResult => ({ ok: false, error: { code: 'CLOSED', message } });

export class ClientSession {
  status: 'connecting' | 'joined' | 'closed' = 'connecting';
  closedWhy: ClosedWhy | null = null;
  room: Room | null = null;
  seat: number | null = null;
  /** A move sent but not yet confirmed by the host. */
  pending: { id: string; action: Action } | null = null;

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
    this.app = opts.appVersion ?? 'dev';
    this.conn = conn;
    this.attach(conn);
  }

  // ── Connection ────────────────────────────────────────────────────────────────

  private attach(conn: Conn): void {
    conn.onmessage = (m): void => { if (this.conn === conn) this.onMessage(m); };
    conn.onclose = (): void => { if (this.conn === conn) this.onConnClose(); };
    conn.send({ t: 'hello', v: PROTOCOL, name: this.name, token: this.token } satisfies ClientMsg);
  }

  /** After a reconnect or a host change: say hello again; the pending move is re-sent if the host lacks it. */
  reattach(conn: Conn): void {
    const old = this.conn;
    this.conn = conn;
    if (old !== conn && old.open) old.close();
    this.status = 'connecting';
    this.closedWhy = null;
    this.attach(conn);
    this.emit();
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

  /** Milliseconds until a host-clock deadline, corrected for the clock difference. */
  msLeft(deadline: number | null): number | null {
    if (deadline === null) return null;
    return Math.max(0, deadline - (this.clock() + this.offset));
  }

  // ── Moves ─────────────────────────────────────────────────────────────────────

  /** Ask the host to make a move. One move at a time; resolves when the host confirms or refuses. */
  act(action: Action): Promise<ActResult> {
    if (this.status === 'closed') return Promise.resolve(closedError('The room is closed.'));
    if (this.pending) {
      return Promise.resolve({ ok: false, error: { code: 'BUSY', message: 'Still waiting for the host to confirm the last move.' } });
    }
    const id = randomId();
    this.pending = { id, action };
    const result = new Promise<ActResult>(resolve => { this.pendingDone = resolve; });
    // Before the welcome (or while reconnecting) it is sent once the host has welcomed us.
    if (this.status === 'joined' && this.conn.open) this.conn.send({ t: 'act', id, action } satisfies ClientMsg);
    this.emit();
    return result;
  }

  // ── Commands ──────────────────────────────────────────────────────────────────

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
  setAutopilot(seat: number, on: boolean): Promise<ActResult> { return this.command({ t: 'autopilot', seat, on }); }
  kick(seat: number): Promise<ActResult> { return this.command({ t: 'kick', seat }); }

  private command(msg: DistributiveOmit<CommandMsg, 'id'>): Promise<ActResult> {
    if (this.status === 'closed' || !this.conn.open) return Promise.resolve(closedError('Not connected to the host.'));
    const id = randomId();
    const result = new Promise<ActResult>(resolve => { this.commands.set(id, resolve); });
    this.conn.send({ ...msg, id } as ClientMsg);
    return result;
  }

  // ── Inbound ───────────────────────────────────────────────────────────────────

  private onMessage(raw: unknown): void {
    const msg: HostMsg | null = parseHostMsg(raw);
    if (!msg) return;
    switch (msg.t) {
      case 'welcome':
        this.seat = msg.seat;
        this.status = 'joined';
        this.setRoom(msg.room, msg.now, null);
        // Re-send the unconfirmed move only if the host never applied it.
        if (this.pending && this.conn.open) {
          this.conn.send({ t: 'act', id: this.pending.id, action: this.pending.action } satisfies ClientMsg);
        }
        break;
      case 'room':
        this.setRoom(msg.room, msg.now, msg.re ?? null);
        break;
      case 'nope':
        if (msg.id !== null && this.pending?.id === msg.id) this.finishPending({ ok: false, error: msg.error });
        else if (msg.id !== null) this.finishCommand(msg.id, { ok: false, error: msg.error });
        break;
      case 'closed':
        this.status = 'closed';
        this.closedWhy = msg.why;
        this.failAll(`The room closed (${msg.why}).`, true);
        break;
    }
    this.emit();
  }

  private setRoom(room: Room, hostNow: number, re: string | null): void {
    this.room = room;
    this.offset = hostNow - this.clock();
    if (this.pending && (re === this.pending.id || room.recent.some(r => r.id === this.pending!.id))) {
      this.finishPending({ ok: true });
    }
    if (re !== null) this.finishCommand(re, { ok: true });
    if (this.store && room.phase !== 'lobby' && room.game) {
      writeSave(this.store, room, { savedAt: this.clock(), app: this.app });
    }
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

  /** Commands are not re-sent after a reconnect, so they fail; the pending move fails only when the room closed. */
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
