// A message put back together from parts has a size limit: a peer announcing or sending more is
// cut off, so it cannot make the other side hold gigabytes. A host takes far less from a client.

import { describe, it, expect } from 'vitest';
import { memoryPair } from '../../session/memoryConn';
import { MAX_TO_HOST_BYTES, PART, chunked } from '../chunk';

const tick = (): Promise<void> => new Promise(r => setTimeout(r, 0));

describe('the size of a message put back together', () => {
  it('a part announcing far too many parts closes the connection', async () => {
    const [a, b] = memoryPair();
    const wrapped = chunked(b, 1000, 10_000);
    const got: unknown[] = [];
    wrapped.onmessage = (m): void => { got.push(m); };
    a.send({ t: PART, id: 1, i: 0, n: 999_999, d: 'x' });
    await tick();
    await tick();
    expect(wrapped.open).toBe(false);
    expect(got).toEqual([]);
  });

  it('parts adding up to more than the limit close the connection', async () => {
    const [a, b] = memoryPair();
    const wrapped = chunked(b, 1000, 10_000);
    wrapped.onmessage = (): void => undefined;
    for (let i = 0; i < 12; i++) a.send({ t: PART, id: 7, i, n: 12, d: 'y'.repeat(950) });
    await tick();
    await tick();
    expect(wrapped.open).toBe(false);
  });

  it('a message within the limit still arrives whole, and a host-side limit is much smaller', async () => {
    const [a, b] = memoryPair();
    const sender = chunked(a, 1000);
    const receiver = chunked(b, 1000, 50_000);
    const got: unknown[] = [];
    receiver.onmessage = (m): void => { got.push(m); };
    sender.send({ t: 'room', text: 'z'.repeat(20_000) });
    await tick();
    await tick();
    expect(got).toEqual([{ t: 'room', text: 'z'.repeat(20_000) }]);
    expect(receiver.open).toBe(true);
    expect(MAX_TO_HOST_BYTES).toBeLessThanOrEqual(256 * 1024);
  });
});
