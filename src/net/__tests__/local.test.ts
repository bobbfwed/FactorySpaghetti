// The same-browser transport, end to end over Node's own BroadcastChannel.
import { describe, it, expect, afterEach } from 'vitest';
import type { Conn, HostHandle } from '../conn';
import { JoinError } from '../conn';
import { localTransport } from '../local';
import { makeRoomCode } from '../roomCode';

const wait = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms));
async function until(cond: () => boolean, ms = 3000): Promise<void> {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error('timed out');
    await wait(5);
  }
}

const cleanup: Array<() => void> = [];
afterEach(() => { for (const f of cleanup.splice(0)) f(); });

const fast = { probeMs: 50, joinTimeoutMs: 400, heartbeatMs: 50, deadAfterMs: 300 };

async function hostRoom(code: string): Promise<{ handle: HostHandle; conns: Conn[] }> {
  const conns: Conn[] = [];
  const handle = await localTransport(fast).host(code, c => conns.push(c));
  cleanup.push(() => handle.close());
  return { handle, conns };
}

describe('same-browser transport (BroadcastChannel)', () => {
  it('hosts, joins, and carries messages both ways, including ones split into parts', async () => {
    const code = makeRoomCode();
    const { conns } = await hostRoom(code);
    const j = await localTransport(fast).join(code);
    cleanup.push(() => j.close());
    await until(() => conns.length === 1);
    const host = conns[0]!;
    const atHost: unknown[] = [];
    const atJoiner: unknown[] = [];
    host.onmessage = (m): void => { atHost.push(m); };
    j.onmessage = (m): void => { atJoiner.push(m); };
    const big = { room: 'ä'.repeat(40_000) };
    j.send({ t: 'hello' });
    host.send(big);
    host.send({ t: 'after' });
    await until(() => atHost.length === 1 && atJoiner.length === 2);
    expect(atHost).toEqual([{ t: 'hello' }]);
    expect(atJoiner).toEqual([big, { t: 'after' }]);
  });

  it('says no-room after the join timeout when nobody hosts the code', async () => {
    const started = Date.now();
    const err = await localTransport(fast).join(makeRoomCode()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(JoinError);
    expect((err as JoinError).kind).toBe('no-room');
    expect(Date.now() - started).toBeGreaterThanOrEqual(350);
  });

  it('uses a 3 second join timeout by default', async () => {
    const started = Date.now();
    const err = await localTransport().join(makeRoomCode()).catch((e: unknown) => e);
    expect((err as JoinError).kind).toBe('no-room');
    expect(Date.now() - started).toBeGreaterThanOrEqual(2900);
  }, 10_000);

  it('refuses a second host of the same code with code-taken', async () => {
    const code = makeRoomCode();
    await hostRoom(code);
    const err = await localTransport(fast).host(code, () => undefined).catch((e: unknown) => e);
    expect((err as JoinError).kind).toBe('code-taken');
  });

  it('closes every connection when the host closes, and either side closing reaches the other', async () => {
    const code = makeRoomCode();
    const { handle, conns } = await hostRoom(code);
    const j1 = await localTransport(fast).join(code);
    const j2 = await localTransport(fast).join(code);
    await until(() => conns.length === 2);
    let hostSaw = 0;
    conns[0]!.onclose = (): void => { hostSaw++; };
    conns[1]!.onclose = (): void => { hostSaw++; };
    let joinersSaw = 0;
    j1.onclose = (): void => { joinersSaw++; };
    j2.onclose = (): void => { joinersSaw++; };
    j1.close();
    await until(() => hostSaw === 1);
    handle.close();
    await until(() => joinersSaw === 2);
    expect(j2.open).toBe(false);
    // The code is free again.
    await hostRoom(code);
  });

  it('notices a host that vanished without a word (heartbeat)', async () => {
    const code = makeRoomCode();
    const ch = new BroadcastChannel(`factory-spaghetti-${code}`);
    cleanup.push(() => ch.close());
    // A fake host that accepts and then goes silent.
    ch.onmessage = (ev: MessageEvent): void => {
      const w = ev.data as { k: string; from: string };
      if (w.k === 'join') ch.postMessage({ k: 'accept', to: w.from, from: 'tab-ghost' });
    };
    const j = await localTransport(fast).join(code);
    let closed = false;
    j.onclose = (): void => { closed = true; };
    await until(() => closed, 2000);
  });
});
