import { describe, it, expect } from 'vitest';
import type { Conn } from '../conn';
import { JoinError } from '../conn';
import { createMemoryHub } from '../memory';

const tick = (): Promise<void> => new Promise(r => setImmediate(r));
async function flush(n = 10): Promise<void> { for (let i = 0; i < n; i++) await tick(); }

async function joinError(p: Promise<unknown>): Promise<string> {
  try { await p; } catch (e) { return e instanceof JoinError ? e.kind : 'not-a-join-error'; }
  return 'resolved';
}

describe('memory hub', () => {
  it('connects a joiner to the host of a code, both ways, asynchronously and in order', async () => {
    const hub = createMemoryHub();
    const a = hub.transport();
    const b = hub.transport();
    const accepted: Conn[] = [];
    await a.host('ABCDE', c => accepted.push(c));
    const joined = await b.join('ABCDE');
    await flush();
    expect(accepted).toHaveLength(1);
    const host = accepted[0]!;
    const atHost: unknown[] = [];
    const atJoiner: unknown[] = [];
    host.onmessage = (m): void => { atHost.push(m); };
    joined.onmessage = (m): void => { atJoiner.push(m); };

    const msg = { n: 1, nested: { list: [1, 2] } };
    joined.send(msg);
    for (let i = 2; i <= 5; i++) joined.send({ n: i });
    host.send({ reply: true });
    expect(atHost).toEqual([]); // nothing arrives synchronously
    await flush();
    expect(atHost).toEqual([msg, { n: 2 }, { n: 3 }, { n: 4 }, { n: 5 }]);
    expect(atHost[0]).not.toBe(msg); // a copy, as over a network
    expect(atJoiner).toEqual([{ reply: true }]);
    expect(hub.inFlight).toBe(0);
  });

  it('refuses an unknown code with no-room and a registered one with code-taken', async () => {
    const hub = createMemoryHub();
    const a = hub.transport();
    expect(await joinError(a.join('ZZZZZ'))).toBe('no-room');
    await a.host('ABCDE', () => undefined);
    expect(await joinError(hub.transport().host('ABCDE', () => undefined))).toBe('code-taken');
  });

  it('closing the host closes every connection after delivering what was sent, and frees the code', async () => {
    const hub = createMemoryHub();
    const conns: Conn[] = [];
    const handle = await hub.transport().host('ABCDE', c => conns.push(c));
    const j1 = await hub.transport().join('ABCDE');
    const j2 = await hub.transport().join('ABCDE');
    await flush();
    const got: unknown[] = [];
    let closed = 0;
    for (const j of [j1, j2]) { j.onmessage = (m): void => { got.push(m); }; j.onclose = (): void => { closed++; }; }
    for (const c of conns) c.send({ bye: true });
    handle.close();
    await flush();
    expect(got).toEqual([{ bye: true }, { bye: true }]);
    expect(closed).toBe(2);
    expect(j1.open || j2.open).toBe(false);
    expect(hub.isTaken('ABCDE')).toBe(false);
    expect(await joinError(hub.transport().join('ABCDE'))).toBe('no-room');
  });

  it('fires onclose exactly once on each side', async () => {
    const hub = createMemoryHub();
    let hostSide: Conn | null = null;
    await hub.transport().host('ABCDE', c => { hostSide = c; });
    const j = await hub.transport().join('ABCDE');
    await flush();
    let a = 0;
    let b = 0;
    hostSide!.onclose = (): void => { a++; };
    j.onclose = (): void => { b++; };
    j.close();
    j.close();
    hostSide!.close();
    await flush();
    expect([a, b]).toEqual([1, 1]);
  });

  it('severs one link abruptly: messages in flight are lost, other links carry on', async () => {
    const hub = createMemoryHub();
    const conns: Conn[] = [];
    await hub.transport().host('ABCDE', c => conns.push(c));
    const t1 = hub.transport();
    const j1 = await t1.join('ABCDE');
    const j2 = await hub.transport().join('ABCDE');
    await flush();
    const got: unknown[] = [];
    j1.onmessage = (m): void => { got.push(['j1', m]); };
    j2.onmessage = (m): void => { got.push(['j2', m]); };
    for (const c of conns) c.send({ x: 1 });
    hub.sever(t1);
    await flush();
    expect(got).toEqual([['j2', { x: 1 }]]);
    expect(j1.open).toBe(false);
    expect(conns[0]!.open).toBe(false);
    expect(j2.open).toBe(true);
    // The severed joiner can come back.
    const again = await t1.join('ABCDE');
    expect(again.open).toBe(true);
  });

  it('kill takes a browser offline; with a release delay its code stays taken for a while', async () => {
    let now = 0;
    const timers: Array<{ at: number; fn: () => void }> = [];
    const sched = {
      now: (): number => now,
      setTimeout: (fn: () => void, ms: number): unknown => { const t = { at: now + ms, fn }; timers.push(t); return t; },
      clearTimeout: (h: unknown): void => { const i = timers.indexOf(h as never); if (i >= 0) timers.splice(i, 1); },
    };
    const hub = createMemoryHub({ releaseDelayMs: 5000, scheduler: sched });
    const host = hub.transport();
    await host.host('ABCDE', () => undefined);
    const j = await hub.transport().join('ABCDE');
    let closed = false;
    j.onclose = (): void => { closed = true; };
    hub.kill(host);
    await flush();
    expect(closed).toBe(true);
    expect(host.alive).toBe(false);
    expect(await joinError(host.join('QQQQQ'))).toBe('broker-unreachable');
    expect(await joinError(hub.transport().join('ABCDE'))).toBe('no-room');
    expect(await joinError(hub.transport().host('ABCDE', () => undefined))).toBe('code-taken');
    now = 5000;
    for (const t of timers.splice(0)) t.fn();
    expect(hub.isTaken('ABCDE')).toBe(false);
    await hub.transport().host('ABCDE', () => undefined);
  });

  it('enforces a raw size limit, and chunking keeps big messages under it', async () => {
    const plain = createMemoryHub({ maxMessageBytes: 1000 });
    let hostSide: Conn | null = null;
    await plain.transport().host('ABCDE', c => { hostSide = c; });
    const j = await plain.transport().join('ABCDE');
    await flush();
    j.send({ big: 'x'.repeat(2000) });
    await flush();
    expect(plain.oversize).toBe(1);
    expect(j.open).toBe(false);

    const split = createMemoryHub({ maxMessageBytes: 1000, chunkBytes: 900 });
    const got: unknown[] = [];
    await split.transport().host('ABCDE', c => { c.onmessage = (m): void => { got.push(m); }; });
    const j2 = await split.transport().join('ABCDE');
    const big = { big: 'ü'.repeat(3000) };
    j2.send(big);
    await flush(20);
    expect(split.oversize).toBe(0);
    expect(got).toEqual([big]);
    void hostSide;
  });

  it('can deliver by microtask or on a scheduler delay', async () => {
    const micro = createMemoryHub({ delivery: 'microtask' });
    const got: unknown[] = [];
    await micro.transport().host('ABCDE', c => { c.onmessage = (m): void => { got.push(m); }; });
    const j = await micro.transport().join('ABCDE');
    j.send(1);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(got).toEqual([1]);

    const timers: Array<() => void> = [];
    const sched = { now: (): number => 0, setTimeout: (fn: () => void): unknown => timers.push(fn), clearTimeout: (): void => undefined };
    const slow = createMemoryHub({ delivery: { delayMs: 50 }, scheduler: sched });
    const p = slow.transport().host('ABCDE', () => undefined);
    await flush();
    expect(timers).toHaveLength(1); // the registration waits for the clock
    timers.shift()!();
    await p;
  });
});
