import { describe, it, expect } from 'vitest';
import type { Conn } from '../conn';
import { BEAT, heartbeat } from '../heartbeat';
import { memoryPair } from '../../session/memoryConn';

class Clock {
  t = 0;
  private timers: Array<{ at: number; fn: () => void; id: number }> = [];
  private n = 0;
  now = (): number => this.t;
  setTimeout = (fn: () => void, ms: number): unknown => { const id = ++this.n; this.timers.push({ at: this.t + ms, fn, id }); return id; };
  clearTimeout = (h: unknown): void => { this.timers = this.timers.filter(x => x.id !== h); };
  advance(ms: number): void {
    const end = this.t + ms;
    for (;;) {
      this.timers.sort((a, b) => a.at - b.at);
      const next = this.timers[0];
      if (!next || next.at > end) break;
      this.timers.shift();
      this.t = next.at;
      next.fn();
    }
    this.t = end;
  }
}

const flush = async (): Promise<void> => { for (let i = 0; i < 5; i++) await Promise.resolve(); };

describe('heartbeat', () => {
  it('keeps a quiet link alive while both ends beat, and never hands beats to the session', async () => {
    const clock = new Clock();
    const [a, b] = memoryPair();
    const ha = heartbeat(a, { scheduler: clock });
    const hb = heartbeat(b, { scheduler: clock });
    const got: unknown[] = [];
    hb.onmessage = (m): void => { got.push(m); };
    for (let i = 0; i < 30; i++) { clock.advance(1000); await flush(); }
    expect(ha.open && hb.open).toBe(true);
    ha.send({ t: 'room' });
    await flush();
    expect(got).toEqual([{ t: 'room' }]);
    expect(got.some(m => (m as { t: string }).t === BEAT)).toBe(false);
  });

  it('closes a link whose other end went silent', async () => {
    const clock = new Clock();
    const [a, b] = memoryPair();
    const ha: Conn = heartbeat(a, { scheduler: clock, intervalMs: 2000, deadAfterMs: 10_000 });
    b.dropIncoming = true; // the far browser vanished: nothing comes back
    b.dropOutgoing = true;
    let closed = 0;
    ha.onclose = (): void => { closed++; };
    clock.advance(9000);
    await flush();
    expect(ha.open).toBe(true);
    clock.advance(2000);
    await flush();
    expect(ha.open).toBe(false);
    expect(closed).toBe(1);
  });
});
