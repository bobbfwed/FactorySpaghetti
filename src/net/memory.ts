// An in-memory "matchmaking service" for tests: transports made from one hub can host and
// join each other by room code, like browsers through the PeerJS broker. Delivery is
// asynchronous by default, every message is copied through JSON, and tests can drop a link,
// kill a whole browser, delay the release of a room code, and enforce a message size limit.

import type { Conn, HostHandle, Transport } from './conn';
import { JoinError } from './conn';
import { chunked, utf8Length } from './chunk';
import type { Scheduler } from '../session/scheduler';
import { realScheduler } from '../session/scheduler';

export type Delivery =
  | 'microtask'          // queueMicrotask
  | 'macrotask'          // setImmediate where available, otherwise setTimeout(0) (the default)
  | { delayMs: number }; // the hub's scheduler, so a test clock controls it

export interface MemoryHubOptions {
  delivery?: Delivery;
  /** Timers for `delayMs` delivery and code release. Defaults to the real clock. */
  scheduler?: Scheduler;
  /** After a host stops (or its browser dies), its code stays taken this long. Infinity = forever. */
  releaseDelayMs?: number;
  /** A raw message bigger than this (UTF-8 JSON) breaks its connection, as PeerJS does. */
  maxMessageBytes?: number;
  /** Wrap every connection with `chunked(conn, chunkBytes)`, as the PeerJS transport does. */
  chunkBytes?: number;
}

/** One live link between a joiner and a host, for tests that want to drop it. */
export interface HubLink {
  readonly code: string;
  readonly host: MemoryTransport;
  readonly joiner: MemoryTransport;
  /** Drop the link abruptly: messages in flight are lost and both sides see it close. */
  sever(): void;
}

export interface MemoryTransport extends Transport {
  readonly id: number;
  /** False once the hub has killed this transport. */
  readonly alive: boolean;
}

export interface MemoryHub {
  transport(): MemoryTransport;
  links(): HubLink[];
  /** Drop every link this transport joined (its host stays up and keeps its own players). */
  sever(t: MemoryTransport): void;
  /** The browser vanishes: every link it has is dropped and it can no longer host or join. */
  kill(t: MemoryTransport): void;
  /** Whether a code is registered (including a code still held after its host stopped). */
  isTaken(code: string): boolean;
  /** Messages sent but not yet delivered. */
  readonly inFlight: number;
  /** Raw messages that broke the size limit. */
  readonly oversize: number;
}

interface Registration {
  owner: Transport_;
  onConnection: ((conn: Conn) => void) | null; // null once stopped (the code may still be held)
  links: Set<Link>;
}

class End implements Conn {
  peer: End | null = null;
  onclose: (() => void) | null = null;
  private handler: ((msg: unknown) => void) | null = null;
  private queue: unknown[] = [];
  private isOpen = true;
  private closeFired = false;

  constructor(private readonly hub: Hub, private readonly link: Link) {}

  get open(): boolean { return this.isOpen; }
  get onmessage(): ((msg: unknown) => void) | null { return this.handler; }
  set onmessage(fn: ((msg: unknown) => void) | null) {
    this.handler = fn;
    while (this.handler && this.queue.length > 0) this.handler(this.queue.shift());
  }

  send(msg: unknown): void {
    if (!this.isOpen || !this.peer) return;
    const text = JSON.stringify(msg);
    if (text === undefined) return;
    if (this.hub.maxBytes !== undefined && utf8Length(text) > this.hub.maxBytes) {
      this.hub.oversizeCount++;
      this.link.sever();
      return;
    }
    const peer = this.peer;
    this.hub.later(() => peer.deliver(JSON.parse(text) as unknown));
  }

  /** A deliberate close: what this end already sent still arrives before the other end closes. */
  close(): void {
    if (!this.isOpen) return;
    const peer = this.peer;
    this.shut();
    if (peer) this.hub.later(() => peer.shut());
    this.link.ended();
  }

  deliver(msg: unknown): void {
    if (!this.isOpen) return;
    if (this.handler) this.handler(msg);
    else this.queue.push(msg);
  }

  shut(): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.queue = [];
    queueMicrotask(() => {
      if (this.closeFired) return;
      this.closeFired = true;
      this.onclose?.();
    });
  }
}

class Link implements HubLink {
  readonly hostEnd: End;
  readonly joinEnd: End;
  constructor(private readonly hub: Hub, readonly code: string, readonly host: Transport_, readonly joiner: Transport_) {
    this.hostEnd = new End(hub, this);
    this.joinEnd = new End(hub, this);
    this.hostEnd.peer = this.joinEnd;
    this.joinEnd.peer = this.hostEnd;
  }
  sever(): void {
    this.hostEnd.shut();
    this.joinEnd.shut();
    this.ended();
  }
  ended(): void {
    this.hub.allLinks.delete(this);
    this.hub.registry.get(this.code)?.links.delete(this);
  }
}

class Transport_ implements MemoryTransport {
  alive = true;
  constructor(private readonly hub: Hub, readonly id: number) {}

  host(code: string, onConnection: (conn: Conn) => void): Promise<HostHandle> {
    return this.hub.settle(() => {
      if (!this.alive) throw new JoinError('broker-unreachable', 'This browser is offline.');
      if (this.hub.registry.has(code)) throw new JoinError('code-taken', `The room code ${code} is already in use.`);
      const reg: Registration = { owner: this, onConnection, links: new Set() };
      this.hub.registry.set(code, reg);
      return { close: (): void => this.hub.stopHosting(code, reg, true) };
    });
  }

  join(code: string): Promise<Conn> {
    return this.hub.settle(() => {
      if (!this.alive) throw new JoinError('broker-unreachable', 'This browser is offline.');
      const reg = this.hub.registry.get(code);
      if (!reg || !reg.onConnection) throw new JoinError('no-room', `No game with the code ${code}.`);
      const link = new Link(this.hub, code, reg.owner, this);
      reg.links.add(link);
      this.hub.allLinks.add(link);
      const deliver = reg.onConnection;
      const hostSide = this.hub.wrap(link.hostEnd);
      this.hub.later(() => { if (link.hostEnd.open) deliver(hostSide); });
      return this.hub.wrap(link.joinEnd);
    });
  }
}

class Hub implements MemoryHub {
  readonly transports = new Set<Transport_>();
  readonly registry = new Map<string, Registration>();
  readonly allLinks = new Set<Link>();
  readonly maxBytes: number | undefined;
  oversizeCount = 0;
  pending = 0;
  private nextId = 1;
  private readonly delivery: Delivery;
  private readonly sched: Scheduler;
  private readonly releaseDelay: number;
  private readonly chunkBytes: number | undefined;

  constructor(opts: MemoryHubOptions) {
    this.delivery = opts.delivery ?? 'macrotask';
    this.sched = opts.scheduler ?? realScheduler;
    this.releaseDelay = opts.releaseDelayMs ?? 0;
    this.maxBytes = opts.maxMessageBytes;
    this.chunkBytes = opts.chunkBytes;
  }

  get inFlight(): number { return this.pending; }
  get oversize(): number { return this.oversizeCount; }

  transport(): MemoryTransport {
    const t = new Transport_(this, this.nextId++);
    this.transports.add(t);
    return t;
  }

  links(): HubLink[] { return [...this.allLinks]; }

  sever(t: MemoryTransport): void {
    for (const link of [...this.allLinks]) if (link.joiner === t) link.sever();
  }

  kill(t: MemoryTransport): void {
    const tr = t as Transport_;
    tr.alive = false;
    for (const link of [...this.allLinks]) if (link.joiner === tr || link.host === tr) link.sever();
    for (const [code, reg] of [...this.registry]) if (reg.owner === tr) this.stopHosting(code, reg, false);
  }

  isTaken(code: string): boolean { return this.registry.has(code); }

  /** Run `fn` asynchronously, as a network round trip would. */
  settle<T>(fn: () => T): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.later(() => {
        try { resolve(fn()); } catch (e) { reject(e); }
      });
    });
  }

  later(fn: () => void): void {
    this.pending++;
    const run = (): void => { this.pending--; fn(); };
    const d = this.delivery;
    if (d === 'microtask') queueMicrotask(run);
    else if (d === 'macrotask') {
      const si = (globalThis as { setImmediate?: (f: () => void) => unknown }).setImmediate;
      if (si) si(run); else globalThis.setTimeout(run, 0);
    } else this.sched.setTimeout(run, d.delayMs);
  }

  wrap(end: End): Conn {
    return this.chunkBytes === undefined ? end : chunked(end, this.chunkBytes);
  }

  stopHosting(code: string, reg: Registration, graceful: boolean): void {
    if (this.registry.get(code) !== reg || !reg.onConnection) return;
    reg.onConnection = null;
    for (const link of [...reg.links]) {
      if (graceful) link.hostEnd.close(); else link.sever();
    }
    const release = (): void => { if (this.registry.get(code) === reg) this.registry.delete(code); };
    if (this.releaseDelay <= 0) release();
    else if (Number.isFinite(this.releaseDelay)) this.sched.setTimeout(release, this.releaseDelay);
  }
}

export function createMemoryHub(opts: MemoryHubOptions = {}): MemoryHub {
  return new Hub(opts);
}
