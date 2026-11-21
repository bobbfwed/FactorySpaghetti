// Liveness for links that do not notice a vanished peer by themselves. A WebRTC data channel
// whose other browser was killed (crash, closed laptop, lost wifi) can stay "open" for minutes:
// measured with PeerJS and Chromium, no close event arrived within 150 seconds. So each end sends
// a tiny beat while idle, and a link that has heard nothing for `deadAfterMs` is closed.
// Both ends must be wrapped. Beats are never handed to the session.

import type { Conn } from './conn';
import type { Scheduler } from '../session/scheduler';
import { realScheduler } from '../session/scheduler';

/** The `t` of a beat. Reserved: no session message may use it. */
export const BEAT = '~beat';

export interface HeartbeatOptions {
  intervalMs?: number;  // default 2000
  deadAfterMs?: number; // default 10000
  scheduler?: Scheduler;
}

class HeartbeatConn implements Conn {
  onclose: (() => void) | null = null;
  private handler: ((msg: unknown) => void) | null = null;
  private queue: unknown[] = [];
  private lastHeard: number;
  private lastSent: number;
  private timer: unknown = null;
  private readonly interval: number;
  private readonly deadAfter: number;
  private readonly sched: Scheduler;

  constructor(private readonly raw: Conn, opts: HeartbeatOptions) {
    this.interval = opts.intervalMs ?? 2000;
    this.deadAfter = opts.deadAfterMs ?? 10_000;
    this.sched = opts.scheduler ?? realScheduler;
    this.lastHeard = this.sched.now();
    this.lastSent = this.lastHeard;
    raw.onmessage = (m): void => this.receive(m);
    raw.onclose = (): void => { this.stop(); this.onclose?.(); };
    if (raw.open) this.arm();
  }

  get open(): boolean { return this.raw.open; }
  get onmessage(): ((msg: unknown) => void) | null { return this.handler; }
  set onmessage(fn: ((msg: unknown) => void) | null) {
    this.handler = fn;
    while (this.handler && this.queue.length > 0) this.handler(this.queue.shift());
  }

  send(msg: unknown): void {
    if (!this.raw.open) return;
    this.lastSent = this.sched.now();
    this.raw.send(msg);
  }

  close(): void {
    this.stop();
    this.raw.close();
  }

  private receive(m: unknown): void {
    this.lastHeard = this.sched.now();
    if (typeof m === 'object' && m !== null && (m as { t?: unknown }).t === BEAT) return;
    if (this.handler) this.handler(m); else this.queue.push(m);
  }

  private arm(): void {
    this.timer = this.sched.setTimeout(() => this.check(), this.interval);
  }

  private check(): void {
    this.timer = null;
    if (!this.raw.open) return;
    const now = this.sched.now();
    if (now - this.lastHeard >= this.deadAfter) { this.raw.close(); return; } // raw.onclose reports it
    if (now - this.lastSent >= this.interval) { this.lastSent = now; this.raw.send({ t: BEAT }); }
    this.arm();
  }

  private stop(): void {
    if (this.timer !== null) { this.sched.clearTimeout(this.timer); this.timer = null; }
  }
}

/** Wrap a raw link so a silent peer is noticed: the link closes after `deadAfterMs` of silence. */
export function heartbeat(raw: Conn, opts: HeartbeatOptions = {}): Conn {
  return new HeartbeatConn(raw, opts);
}
