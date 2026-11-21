import { describe, it, expect } from 'vitest';
import type { Conn } from '../conn';
import { MAX_OPEN_MESSAGES, PART, chunked, splitText, utf8Length } from '../chunk';

/** A raw pair that records every raw message and delivers synchronously through JSON. */
function rawPair(): { a: Conn; b: Conn; sentByA: string[]; pushToB: (m: unknown) => void } {
  const sentByA: string[] = [];
  const mk = (): Conn & { peer: Conn | null; deliver: (m: unknown) => void } => {
    let handler: ((m: unknown) => void) | null = null;
    const queue: unknown[] = [];
    let open = true;
    const c = {
      peer: null as Conn | null,
      onclose: null as (() => void) | null,
      get open(): boolean { return open; },
      get onmessage(): ((m: unknown) => void) | null { return handler; },
      set onmessage(fn: ((m: unknown) => void) | null) { handler = fn; while (handler && queue.length) handler(queue.shift()); },
      send(m: unknown): void {
        const text = JSON.stringify(m);
        if (c === a) sentByA.push(text);
        (c.peer as unknown as { deliver: (m: unknown) => void }).deliver(JSON.parse(text));
      },
      close(): void { open = false; c.onclose?.(); },
      deliver(m: unknown): void { if (handler) handler(m); else queue.push(m); },
    };
    return c;
  };
  const a = mk();
  const b = mk();
  a.peer = b;
  b.peer = a;
  return { a, b, sentByA, pushToB: (m): void => b.deliver(m) };
}

function wrapped(max: number): { send: Conn; recv: Conn; got: unknown[]; raw: string[]; inject: (m: unknown) => void } {
  const { a, b, sentByA, pushToB } = rawPair();
  const send = chunked(a, max);
  const recv = chunked(b, max);
  const got: unknown[] = [];
  recv.onmessage = (m): void => { got.push(m); };
  return { send, recv, got, raw: sentByA, inject: pushToB };
}

const bytes = (s: string): number => new TextEncoder().encode(s).length;

describe('utf8Length', () => {
  it('matches TextEncoder, including multi-byte letters, emoji and lone surrogates', () => {
    for (const s of ['', 'abc', 'ñandú', '日本語', 'a😀b', '\ud800x', 'x\udc00', ' ']) {
      expect(utf8Length(s)).toBe(bytes(s));
    }
  });
});

describe('chunked', () => {
  it('passes small messages through untouched', () => {
    const t = wrapped(1000);
    t.send.send({ t: 'hello', n: 1 });
    expect(t.raw).toEqual(['{"t":"hello","n":1}']);
    expect(t.got).toEqual([{ t: 'hello', n: 1 }]);
  });

  it('round-trips multi-byte text, with every raw part within the limit', () => {
    const t = wrapped(300);
    const msg = { text: 'Größe 日本語 😀😀😀 "quoted" back\\slash \n newline \u0001 ctrl '.repeat(40) };
    t.send.send(msg);
    expect(t.raw.length).toBeGreaterThan(5);
    for (const r of t.raw) expect(bytes(r)).toBeLessThanOrEqual(300);
    expect(t.got).toEqual([msg]);
  });

  it('never cuts an emoji in half', () => {
    const t = wrapped(120);
    const msg = { s: '😀'.repeat(500) };
    t.send.send(msg);
    for (const r of t.raw) {
      const part = JSON.parse(r) as { d: string };
      expect(part.d).not.toMatch(/[\ud800-\udbff]$/);
      expect(part.d).not.toMatch(/^[\udc00-\udfff]/);
    }
    expect(t.got).toEqual([msg]);
  });

  it('sends a message of exactly the limit whole, and one byte more in parts', () => {
    const max = 500;
    const pad = (n: number): { p: string } => ({ p: 'x'.repeat(n - '{"p":""}'.length) });
    const exact = wrapped(max);
    exact.send.send(pad(max));
    expect(exact.raw).toHaveLength(1);
    expect(bytes(exact.raw[0]!)).toBe(max);
    expect(exact.got).toEqual([pad(max)]);

    const over = wrapped(max);
    over.send.send(pad(max + 1));
    expect(over.raw.length).toBeGreaterThan(1);
    for (const r of over.raw) expect(bytes(r)).toBeLessThanOrEqual(max);
    expect(over.got).toEqual([pad(max + 1)]);
  });

  it('carries a 100 KB message within a 15 KiB limit', () => {
    const t = wrapped(15 * 1024);
    const msg = { rows: Array.from({ length: 2000 }, (_, i) => ({ i, name: `piece-${i}`, note: 'Ünïcödé "x"' })) };
    const size = bytes(JSON.stringify(msg));
    expect(size).toBeGreaterThan(100_000);
    t.send.send(msg);
    expect(t.raw.length).toBeGreaterThanOrEqual(Math.ceil(size / (15 * 1024)));
    for (const r of t.raw) expect(bytes(r)).toBeLessThanOrEqual(15 * 1024);
    expect(t.got).toEqual([msg]);
  });

  it('reassembles interleaved messages and ignores duplicate parts', () => {
    const t = wrapped(200);
    const m1 = { a: 'first '.repeat(100) };
    const m2 = { b: 'second '.repeat(100) };
    const p1 = splitText(JSON.stringify(m1), 101, 200);
    const p2 = splitText(JSON.stringify(m2), 102, 200);
    expect(p1.length).toBeGreaterThan(2);
    const order: unknown[] = [];
    for (let i = 0; i < Math.max(p1.length, p2.length); i++) {
      if (p2[i]) order.push(p2[i], p2[i]); // every part of m2 twice
      if (p1[i]) order.push(p1[i]);
    }
    order.push(p1[0]); // a late duplicate after m1 completed: opens a stray message, never completes
    for (const m of order) t.inject(m);
    expect(t.got).toEqual(expect.arrayContaining([m1, m2]));
    expect(t.got).toHaveLength(2);
  });

  it('delivers parts received out of order', () => {
    const t = wrapped(150);
    const msg = { z: 'out of order '.repeat(50) };
    const parts = splitText(JSON.stringify(msg), 7, 150);
    for (const p of [...parts].reverse()) t.inject(p);
    expect(t.got).toEqual([msg]);
  });

  it(`drops the oldest incomplete message when more than ${MAX_OPEN_MESSAGES} are open`, () => {
    const t = wrapped(100);
    const msgs = Array.from({ length: MAX_OPEN_MESSAGES + 1 }, (_, i) => ({ k: `${i}-`.repeat(60) }));
    const parts = msgs.map((m, i) => splitText(JSON.stringify(m), 1000 + i, 100));
    for (const p of parts) t.inject(p[0]); // open nine messages
    for (const p of parts.slice(1)) for (const x of p.slice(1)) t.inject(x);
    // The first one was forgotten when the ninth opened; the rest complete.
    expect(t.got).toEqual(msgs.slice(1));
    // Its remaining parts now start a fresh, incomplete message: nothing half-built comes out.
    for (const x of parts[0]!.slice(1)) t.inject(x);
    expect(t.got).toHaveLength(MAX_OPEN_MESSAGES);
  });

  it('ignores malformed parts and passes other messages through', () => {
    const t = wrapped(100);
    t.inject({ t: PART, id: 1, i: 5, n: 2, d: 'x' });
    t.inject({ t: PART, id: 'x', i: 0, n: 1, d: 'x' });
    t.inject({ t: PART, id: 2, i: 0, n: 1, d: '{not json' });
    t.inject({ t: 'other' });
    expect(t.got).toEqual([{ t: 'other' }]);
  });

  it('queues messages until a handler is set, and forwards close once', () => {
    const { a, b } = rawPair();
    const send = chunked(a, 100);
    const recv = chunked(b, 100);
    send.send({ big: 'y'.repeat(500) });
    send.send({ small: 1 });
    const got: unknown[] = [];
    let closes = 0;
    recv.onclose = (): void => { closes++; };
    recv.onmessage = (m): void => { got.push(m); };
    expect(got).toEqual([{ big: 'y'.repeat(500) }, { small: 1 }]);
    expect(recv.open).toBe(true);
    recv.close();
    expect(recv.open).toBe(false);
    expect(closes).toBe(1);
    recv.send({ after: true }); // ignored after close
  });
});
