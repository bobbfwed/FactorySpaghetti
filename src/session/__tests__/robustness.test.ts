import { describe, it, expect, vi } from 'vitest';
import { HostSession } from '../hostSession';
import { ClientSession } from '../clientSession';
import { memoryStore, saveKey } from '../store';
import { parseSaveFile } from '../save';
import { ManualScheduler, join, newLobby, settle } from './helpers';

const TOK = 'tok-ann-0123456789';

describe('host robustness', () => {
  it('an unexpected error leaves the room unchanged, answers INTERNAL, and the host keeps working', async () => {
    const sched = new ManualScheduler();
    let boom = false;
    const flaky = {
      now: (): number => { if (boom) { boom = false; throw new Error('clock failure'); } return sched.now(); },
      setTimeout: (fn: () => void, ms: number): unknown => sched.setTimeout(fn, ms),
      clearTimeout: (h: unknown): void => sched.clearTimeout(h),
    };
    const host = new HostSession({ code: 'KQMTV', hostName: 'Ann', hostToken: TOK, scheduler: flaky });
    const me = new ClientSession(host.connectLocal(), { name: 'Ann', token: TOK });
    await settle();
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    boom = true;
    expect(await me.setReady(true)).toMatchObject({ ok: false, error: { code: 'INTERNAL' } });
    expect(quiet).toHaveBeenCalled();
    quiet.mockRestore();
    expect(host.room.seats[0]!.ready).toBe(false);
    expect(await me.setReady(true)).toEqual({ ok: true });
    expect(host.room.seats[0]!.ready).toBe(true);
  });

  it('instant bots play in batches so the page stays responsive, with the same result', async () => {
    const { host, me, sched } = await newLobby({ settings: { playerCount: 2, botDelayMs: 0 } });
    await me.setSeat(1, 'bot');
    await me.setAutopilot(0, true);
    await me.setReady(true);
    expect(await me.start()).toEqual({ ok: true });
    expect(host.room.seq).toBe(40);            // one batch, then the room went out
    expect(me.room!.seq).toBe(40);
    sched.runUntil(() => host.room.phase === 'finished');
    expect(host.room.phase).toBe('finished');
  });

  it('saves on seat changes during play, not only on moves', async () => {
    const store = memoryStore();
    const { host, me, sched } = await newLobby({ store, settings: { playerCount: 2, botDelayMs: 0, factoryOpTimeoutMs: 0, roundEndTimeoutMs: 0, awayPolicy: 'wait' } });
    const bea = join(host, 'Bea', 'tok-bea-0123456789');
    await settle();
    await me.setReady(true);
    await bea.client.setReady(true);
    await me.start();
    await sched.flushDue();
    const seq = host.room.seq;
    bea.clientEnd.close();
    await settle();
    expect(await me.setSeat(1, 'bot', 'random')).toEqual({ ok: true });
    await sched.flushDue();
    const saved = parseSaveFile(store.get(saveKey('KQMTV'))!);
    expect(saved.room.seats[1]).toMatchObject({ kind: 'bot', botId: 'random' });
    expect(saved.room.log.some(e => e.text.includes("now plays Bea's seat"))).toBe(true);
    expect(saved.room.seq).toBeGreaterThanOrEqual(seq);
    host.dispose();
  });
});

describe('client dispose', () => {
  it('settles a waiting move as CLOSED and ignores later messages', async () => {
    const { host, me } = await newLobby({ settings: { playerCount: 2, botDelayMs: 0 } });
    const bea = join(host, 'Bea', 'tok-bea-0123456789');
    await settle();
    bea.clientEnd.dropOutgoing = true;
    const pending = bea.client.act({ type: 'END_TURN' });
    bea.client.dispose();
    expect(await pending).toEqual({ ok: false, error: { code: 'CLOSED', message: 'This session was closed.' } });
    expect(bea.client.status).toBe('closed');
    expect(await bea.client.act({ type: 'END_TURN' })).toMatchObject({ ok: false, error: { code: 'CLOSED' } });
    await settle();
    expect(bea.clientEnd.open).toBe(false);
    expect(host.room.seats[1]!.kind).toBe('open'); // in the lobby the seat opened again
    expect(me.status).toBe('joined');
  });
});
