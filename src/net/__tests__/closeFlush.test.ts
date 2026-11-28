// A message sent just before close() reaches the other side, on every transport. The host sends
// a removed player `closed {why:'kicked'}` and closes the connection right after; if the close
// overtook the message, the removed player would never learn why the game stopped.

import { describe, it, expect, afterEach, vi } from 'vitest';
import type { Conn } from '../conn';
import type { DataLink } from '../peer';
import { FLUSH_CLOSE_MS, wrapData } from '../peer';
import { localTransport } from '../local';
import { makeRoomCode } from '../roomCode';
import { createMemoryHub } from '../memory';

const tick = (): Promise<void> => new Promise(r => setImmediate(r));
async function flush(n = 10): Promise<void> { for (let i = 0; i < n; i++) await tick(); }

/**
 * One end of a PeerJS JSON data connection, as PeerJS behaves: a sent message is on its way
 * until `deliver()`; close() ends the connection at once and drops what is still on its way;
 * close({flush:true}) sends a close marker behind it, and the receiving side closes on reading it.
 */
class FakeData implements DataLink {
  other: FakeData | null = null;
  inFlight: unknown[] = [];
  open = true;
  closeCalls: Array<{ flush?: boolean } | undefined> = [];
  private readonly handlers: Record<string, Array<(m?: unknown) => void>> = {};

  on(event: string, fn: (m?: unknown) => void): this {
    (this.handlers[event] ??= []).push(fn);
    return this;
  }

  private emit(event: string, m?: unknown): void {
    for (const fn of this.handlers[event] ?? []) fn(m);
  }

  send(data: unknown): void {
    if (this.open) this.inFlight.push(data);
  }

  close(options?: { flush?: boolean }): void {
    this.closeCalls.push(options);
    if (options?.flush) { this.send({ __peerData: { type: 'close' } }); return; }
    this.end();
  }

  /** The connection is gone: both ends close, and nothing on its way arrives. */
  private end(): void {
    for (const end of [this, this.other]) {
      if (!end || !end.open) continue;
      end.open = false;
      end.inFlight = [];
      end.emit('close');
    }
  }

  /** The network carries everything this end has sent so far to the other end. */
  deliver(): void {
    const other = this.other;
    for (const m of this.inFlight.splice(0)) {
      if (!other?.open) return;
      if ((m as { __peerData?: { type?: string } }).__peerData?.type === 'close') { other.end(); return; }
      other.emit('data', m);
    }
  }
}

function fakePair(): [FakeData, FakeData] {
  const a = new FakeData();
  const b = new FakeData();
  a.other = b;
  b.other = a;
  return [a, b];
}

const cleanup: Array<() => void> = [];
afterEach(() => { for (const f of cleanup.splice(0)) f(); vi.useRealTimers(); });

describe('a message sent just before close() is delivered', () => {
  it('over PeerJS: the close waits behind what was sent', () => {
    const [hostDc, clientDc] = fakePair();
    const host = wrapData(hostDc);
    const client = wrapData(clientDc);
    const got: unknown[] = [];
    let clientClosed = 0;
    client.onmessage = (m): void => { got.push(m); };
    client.onclose = (): void => { clientClosed++; };

    host.send({ t: 'closed', why: 'kicked' });
    host.close();
    expect(host.open).toBe(false);
    hostDc.deliver(); // the network catches up
    expect(got).toEqual([{ t: 'closed', why: 'kicked' }]);
    expect(clientClosed).toBe(1);
    expect(client.open).toBe(false);
  });

  it('over PeerJS: a channel whose other side never answers is still ended after a while', () => {
    vi.useFakeTimers();
    const [hostDc] = fakePair();
    const host = wrapData(hostDc);
    host.send({ t: 'closed', why: 'kicked' });
    host.close();
    expect(hostDc.open).toBe(true); // waiting for the other side to read the close marker
    vi.advanceTimersByTime(FLUSH_CLOSE_MS);
    expect(hostDc.open).toBe(false);
    expect(hostDc.closeCalls).toEqual([{ flush: true }, undefined]);
  });

  it('between tabs of one browser', async () => {
    const code = makeRoomCode();
    const conns: Conn[] = [];
    const fast = { probeMs: 50, joinTimeoutMs: 400, heartbeatMs: 50, deadAfterMs: 300 };
    const handle = await localTransport(fast).host(code, c => conns.push(c));
    cleanup.push(() => handle.close());
    const j = await localTransport(fast).join(code);
    cleanup.push(() => j.close());
    const got: unknown[] = [];
    let closed = false;
    j.onmessage = (m): void => { got.push(m); };
    j.onclose = (): void => { closed = true; };
    for (let i = 0; i < 200 && conns.length === 0; i++) await new Promise(r => setTimeout(r, 5));
    const host = conns[0]!;
    host.send({ t: 'closed', why: 'kicked' });
    host.close();
    for (let i = 0; i < 200 && !closed; i++) await new Promise(r => setTimeout(r, 5));
    expect(closed).toBe(true);
    expect(got).toEqual([{ t: 'closed', why: 'kicked' }]);
  });

  it('in memory', async () => {
    const hub = createMemoryHub();
    const conns: Conn[] = [];
    await hub.transport().host('ABCDE', c => conns.push(c));
    const j = await hub.transport().join('ABCDE');
    await flush();
    const got: unknown[] = [];
    let closed = false;
    j.onmessage = (m): void => { got.push(m); };
    j.onclose = (): void => { closed = true; };
    conns[0]!.send({ t: 'closed', why: 'kicked' });
    conns[0]!.close();
    await flush();
    expect(got).toEqual([{ t: 'closed', why: 'kicked' }]);
    expect(closed).toBe(true);
  });
});
