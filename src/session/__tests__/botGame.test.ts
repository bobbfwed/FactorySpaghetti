import { describe, it, expect } from 'vitest';
import { HostSession } from '../hostSession';
import { ClientSession } from '../clientSession';
import { memoryStore, saveKey } from '../store';
import type { SaveStore } from '../store';
import { packLink, parseSaveFile, toSave, unpackLink, validateSave } from '../save';
import type { Room } from '../room';
import { ManualScheduler, settle } from './helpers';

interface Run { host: HostSession; me: ClientSession; sched: ManualScheduler; store: SaveStore }

/** A 4-seat room: the host's own seat on autopilot, three bot seats, started with `seed`. */
async function startBotGame(seed: number, botDelayMs: number): Promise<Run> {
  const sched = new ManualScheduler();
  const store = memoryStore();
  const host = new HostSession({
    code: 'BOTSS', hostName: 'Ann', hostToken: 'tok-ann', scheduler: sched, store, randomSeed: (): number => seed,
  });
  const me = new ClientSession(host.connectLocal(), { name: 'Ann', token: 'tok-ann' });
  await settle();
  expect((await me.configure({ playerCount: 4, botDelayMs })).ok).toBe(true);
  for (const i of [1, 2, 3]) expect((await me.setSeat(i, 'bot', 'greedy')).ok).toBe(true);
  expect((await me.setAutopilot(0, true)).ok).toBe(true);
  expect((await me.setReady(true)).ok).toBe(true);
  expect((await me.start()).ok).toBe(true);
  return { host, me, sched, store };
}

async function playToEnd(seed: number, botDelayMs: number): Promise<Room> {
  const run = await startBotGame(seed, botDelayMs);
  run.sched.runUntil(() => run.host.room.phase === 'finished');
  await settle();
  run.host.dispose();
  return run.host.room;
}

describe('a full game through the host', () => {
  it('finishes with every seat played by bots, and the same seed gives the same game', async () => {
    const a = await playToEnd(777, 0);
    expect(a.phase).toBe('finished');
    expect(a.game?.gameOver).toBe(true);
    expect(a.seq).toBeGreaterThan(100);
    expect(a.log.some(e => e.text.startsWith('Game over'))).toBe(true);
    expect(a.lastEvents.some(e => e.kind === 'gameOver')).toBe(true);

    const b = await playToEnd(777, 0);
    expect(JSON.stringify(b.game)).toBe(JSON.stringify(a.game));

    // Pacing the bots does not change the game: only the host's seeded dice decide rolls.
    const c = await playToEnd(777, 250);
    expect(JSON.stringify(c.game)).toBe(JSON.stringify(a.game));

    // A different seed gives a different game.
    const d = await playToEnd(778, 0);
    expect(JSON.stringify(d.game)).not.toBe(JSON.stringify(a.game));
  }, 60_000);

  it('saves mid-game; a resumed host plays on to exactly the same end', async () => {
    const straight = await playToEnd(31337, 0);

    const run = await startBotGame(31337, 100);
    run.sched.runUntil(() => run.host.room.seq >= 180);
    await settle();
    const savedText = run.store.get(saveKey('BOTSS'));
    expect(savedText).not.toBeNull();
    const save = parseSaveFile(savedText!);
    expect(save.room.seq).toBe(run.host.room.seq);
    expect(save.room.phase).toBe('playing');
    // The host player's own client stored the same position.
    run.host.dispose();

    // Resume on "another device": a fresh host from the save, under a new room code.
    const sched = new ManualScheduler();
    const host2 = new HostSession({
      code: 'NEWRM', hostName: 'ann', hostToken: 'tok-ann-phone', room: save.room, mode: 'resume', scheduler: sched,
    });
    expect(host2.room.hold).toBe(true);
    expect(host2.room.hostSeat).toBe(0);
    const me2 = new ClientSession(host2.connectLocal(), { name: 'ann', token: 'tok-ann-phone' });
    await settle();
    expect(me2.seat).toBe(0);
    expect(await me2.act({ type: 'END_TURN' })).toMatchObject({ ok: false, error: { code: 'ON_HOLD' } });
    sched.runUntil(() => false);
    expect(host2.room.seq).toBe(save.room.seq); // nothing moves while on hold

    expect((await me2.setAutopilot(0, true)).ok).toBe(true);
    expect((await me2.resumeGame()).ok).toBe(true);
    expect(host2.room.hold).toBe(false);
    sched.runUntil(() => host2.room.phase === 'finished');
    await settle();

    expect(host2.room.phase).toBe('finished');
    expect(host2.room.seq).toBe(straight.seq);
    expect(JSON.stringify(host2.room.game)).toBe(JSON.stringify(straight.game));
    host2.dispose();
  }, 60_000);

  it('keeps a 4-player end-of-game save link under 6,000 characters, and it round-trips', async () => {
    const end = await playToEnd(2024, 0);
    const save = toSave(end, { savedAt: 1_700_000_000_000, app: 'test' }, { forLink: true });
    const link = await packLink(save);
    expect(link.startsWith('v1.')).toBe(true);
    expect(link.length).toBeLessThan(6000);
    expect(await unpackLink(link)).toEqual(save);
    // The full end state also passes validation.
    expect(validateSave(toSave(end, { savedAt: 1, app: 'test' })).room.game).toEqual(end.game);
  }, 60_000);
});
