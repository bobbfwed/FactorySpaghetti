// The same-browser transport: tabs of one browser talk over a BroadcastChannel named
// `factory-spaghetti-<CODE>`. For testing multiplayer on one computer without the internet.
// There is no broker, so the host asks "is anyone hosting?" before taking a code, and both
// sides send a heartbeat so a closed tab is noticed.

import type { Conn, HostHandle, Transport } from './conn';
import { JoinError } from './conn';
import { MAX_TO_HOST_BYTES, chunked } from './chunk';

export const LOCAL_CHANNEL_PREFIX = 'factory-spaghetti-';

export interface LocalTransportOptions {
  /** A join with no answer within this time fails with 'no-room'. */
  joinTimeoutMs?: number;   // default 3000
  /** How long a new host listens for an existing host of the same code. */
  probeMs?: number;         // default 150
  heartbeatMs?: number;     // default 1000
  /** A link silent for this long is treated as closed (the other tab went away). */
  deadAfterMs?: number;     // default 5000
  /** Split messages above this size, as the internet transport does. 0 = never. */
  chunkBytes?: number;      // default 15 KiB
}

type Wire =
  | { k: 'who'; from: string }
  | { k: 'here'; to: string }
  | { k: 'join'; from: string }
  | { k: 'accept'; to: string; from: string }
  | { k: 'msg'; from: string; to: string; d: unknown }
  | { k: 'bye'; from: string; to: string }
  | { k: 'ping'; from: string; to: string | null };

function randomTabId(): string {
  const a = new Uint8Array(8);
  globalThis.crypto.getRandomValues(a);
  return `tab-${Array.from(a, b => b.toString(16).padStart(2, '0')).join('')}`;
}

function wire(data: unknown): Wire | null {
  return typeof data === 'object' && data !== null && typeof (data as { k?: unknown }).k === 'string' ? data as Wire : null;
}

/** One end of a tab-to-tab link. */
class TabConn implements Conn {
  onclose: (() => void) | null = null;
  lastHeard: number;
  private handler: ((msg: unknown) => void) | null = null;
  private queue: unknown[] = [];
  private isOpen = true;

  constructor(
    private readonly post: (w: Wire) => void,
    private readonly me: string,
    readonly other: string,
    private readonly onShut: () => void,
  ) {
    this.lastHeard = Date.now();
  }

  get open(): boolean { return this.isOpen; }
  get onmessage(): ((msg: unknown) => void) | null { return this.handler; }
  set onmessage(fn: ((msg: unknown) => void) | null) {
    this.handler = fn;
    while (this.handler && this.queue.length > 0) this.handler(this.queue.shift());
  }

  send(msg: unknown): void {
    if (!this.isOpen) return;
    // Copy through JSON like the other transports, so no transport accepts what another refuses.
    const text = JSON.stringify(msg);
    if (text === undefined) return;
    this.post({ k: 'msg', from: this.me, to: this.other, d: JSON.parse(text) as unknown });
  }

  close(): void {
    if (!this.isOpen) return;
    this.post({ k: 'bye', from: this.me, to: this.other });
    this.shut();
  }

  receive(d: unknown): void {
    if (!this.isOpen) return;
    if (this.handler) this.handler(d); else this.queue.push(d);
  }

  shut(): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.queue = [];
    this.onShut();
    this.onclose?.();
  }
}

function onPageHide(fn: () => void): () => void {
  const g = globalThis as { addEventListener?: (t: string, f: () => void) => void; removeEventListener?: (t: string, f: () => void) => void };
  if (typeof g.addEventListener !== 'function') return () => undefined;
  g.addEventListener('pagehide', fn);
  return () => g.removeEventListener?.('pagehide', fn);
}

class LocalTransport implements Transport {
  private readonly joinTimeout: number;
  private readonly probe: number;
  private readonly beat: number;
  private readonly deadAfter: number;
  private readonly chunkBytes: number;

  constructor(opts: LocalTransportOptions) {
    this.joinTimeout = opts.joinTimeoutMs ?? 3000;
    this.probe = opts.probeMs ?? 150;
    this.beat = opts.heartbeatMs ?? 1000;
    this.deadAfter = opts.deadAfterMs ?? 5000;
    this.chunkBytes = opts.chunkBytes ?? 15 * 1024;
  }

  private wrap(c: Conn, maxMessage?: number): Conn {
    return this.chunkBytes > 0 ? chunked(c, this.chunkBytes, maxMessage) : c;
  }

  host(code: string, onConnection: (conn: Conn) => void): Promise<HostHandle> {
    return new Promise<HostHandle>((resolve, reject) => {
      const ch = new BroadcastChannel(LOCAL_CHANNEL_PREFIX + code);
      const me = randomTabId();
      const conns = new Map<string, TabConn>();
      const post = (w: Wire): void => { try { ch.postMessage(w); } catch { /* channel closed */ } };
      let state: 'probing' | 'hosting' | 'closed' = 'probing';
      let beatTimer: ReturnType<typeof setInterval> | null = null;
      let offHide = (): void => undefined;

      const close = (): void => {
        if (state === 'closed') return;
        state = 'closed';
        if (beatTimer !== null) clearInterval(beatTimer);
        offHide();
        for (const c of [...conns.values()]) c.close();
        ch.close();
      };

      ch.onmessage = (ev: MessageEvent): void => {
        const w = wire(ev.data);
        if (!w || state === 'closed') return;
        if (state === 'probing') {
          if (w.k === 'here' && w.to === me) {
            close();
            reject(new JoinError('code-taken', `The room code ${code} is already open in this browser.`));
          }
          return;
        }
        switch (w.k) {
          case 'who': post({ k: 'here', to: w.from }); break;
          case 'join': {
            if (conns.has(w.from)) { post({ k: 'accept', to: w.from, from: me }); break; }
            const c = new TabConn(post, me, w.from, () => conns.delete(w.from));
            conns.set(w.from, c);
            post({ k: 'accept', to: w.from, from: me });
            onConnection(this.wrap(c, MAX_TO_HOST_BYTES));
            break;
          }
          case 'msg': if (w.to === me) { const c = conns.get(w.from); if (c) { c.lastHeard = Date.now(); c.receive(w.d); } } break;
          case 'ping': if (w.to === me) { const c = conns.get(w.from); if (c) c.lastHeard = Date.now(); } break;
          case 'bye': if (w.to === me) conns.get(w.from)?.shut(); break;
          default: break;
        }
      };

      post({ k: 'who', from: me });
      setTimeout(() => {
        if (state !== 'probing') return;
        state = 'hosting';
        beatTimer = setInterval(() => {
          post({ k: 'ping', from: me, to: null });
          const now = Date.now();
          for (const c of [...conns.values()]) if (now - c.lastHeard > this.deadAfter) c.shut();
        }, this.beat);
        offHide = onPageHide(close);
        resolve({ close });
      }, this.probe);
    });
  }

  join(code: string): Promise<Conn> {
    return new Promise<Conn>((resolve, reject) => {
      const ch = new BroadcastChannel(LOCAL_CHANNEL_PREFIX + code);
      const me = randomTabId();
      const post = (w: Wire): void => { try { ch.postMessage(w); } catch { /* channel closed */ } };
      let conn: TabConn | null = null;
      let beatTimer: ReturnType<typeof setInterval> | null = null;
      let offHide = (): void => undefined;
      const cleanup = (): void => {
        if (beatTimer !== null) clearInterval(beatTimer);
        offHide();
        ch.close();
      };
      const timer = setTimeout(() => {
        if (conn) return;
        cleanup();
        reject(new JoinError('no-room', `No game with the code ${code} is open in this browser.`));
      }, this.joinTimeout);

      ch.onmessage = (ev: MessageEvent): void => {
        const w = wire(ev.data);
        if (!w) return;
        if (!conn) {
          if (w.k !== 'accept' || w.to !== me) return;
          clearTimeout(timer);
          const c = new TabConn(post, me, w.from, cleanup);
          conn = c;
          beatTimer = setInterval(() => {
            post({ k: 'ping', from: me, to: c.other });
            if (Date.now() - c.lastHeard > this.deadAfter) c.shut();
          }, this.beat);
          offHide = onPageHide(() => c.close());
          resolve(this.wrap(c));
          return;
        }
        if (w.k === 'ping' && w.from === conn.other) conn.lastHeard = Date.now();
        else if (w.k === 'msg' && w.to === me && w.from === conn.other) { conn.lastHeard = Date.now(); conn.receive(w.d); }
        else if (w.k === 'bye' && w.to === me && w.from === conn.other) conn.shut();
      };
      post({ k: 'join', from: me });
    });
  }
}

/** Tabs of one browser, over BroadcastChannel. */
export function localTransport(opts: LocalTransportOptions = {}): Transport {
  return new LocalTransport(opts);
}
