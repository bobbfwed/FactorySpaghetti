// An in-process Conn pair. Used by HostSession.connectLocal() for the host player's own
// client, and by tests. Delivery is asynchronous (a microtask) and every message is copied
// through JSON, so it behaves like a real transport: no shared objects, no re-entrancy.

import type { Conn } from '../net/conn';

export class MemoryConn implements Conn {
  peer: MemoryConn | null = null;
  /** Test hook: messages this end sends are silently lost. */
  dropOutgoing = false;
  /** Test hook: messages arriving at this end are silently lost. */
  dropIncoming = false;
  onclose: (() => void) | null = null;
  private handler: ((msg: unknown) => void) | null = null;
  private queue: unknown[] = [];
  private isOpen = true;

  get open(): boolean { return this.isOpen; }

  get onmessage(): ((msg: unknown) => void) | null { return this.handler; }
  set onmessage(fn: ((msg: unknown) => void) | null) {
    this.handler = fn;
    if (fn && this.queue.length > 0) {
      const queued = this.queue;
      this.queue = [];
      for (const m of queued) if (this.isOpen && this.handler) this.handler(m);
    }
  }

  send(msg: unknown): void {
    if (!this.isOpen || this.dropOutgoing || !this.peer) return;
    const peer = this.peer;
    const copy: unknown = JSON.parse(JSON.stringify(msg));
    queueMicrotask(() => peer.deliver(copy));
  }

  /** Messages already sent by this end are still delivered before the other end sees the close. */
  close(): void {
    if (!this.isOpen) return;
    const peer = this.peer;
    this.shut();
    if (peer) queueMicrotask(() => peer.shut());
  }

  private deliver(msg: unknown): void {
    if (!this.isOpen || this.dropIncoming) return;
    if (this.handler) this.handler(msg);
    else this.queue.push(msg);
  }

  private shut(): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.queue = [];
    queueMicrotask(() => this.onclose?.());
  }
}

/** Two connected ends: whatever one sends, the other receives. */
export function memoryPair(): [MemoryConn, MemoryConn] {
  const a = new MemoryConn();
  const b = new MemoryConn();
  a.peer = b;
  b.peer = a;
  return [a, b];
}
