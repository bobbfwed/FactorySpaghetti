// Bot speed: at Normal the host spaces bot moves so each can be followed on the table; Instant is
// today's runs of moves; the host may change it during a game; it survives a hand-over and a save.

import { describe, it, expect } from 'vitest';
import type { PlayerId } from '../../engine/state';
import { chooseAction as greedy } from '../../bots/greedyBot';
import type { Room } from '../room';
import { activeSeat, defaultSettings } from '../room';
import { HostSession } from '../hostSession';
import { ClientSession, promoteToHost } from '../clientSession';
import { packLink, parseSaveFile, serializeSaveFile, toSave, unpackLink, rulesFingerprint } from '../save';
import { NORMAL_PAUSE, botPauseMs, botSpeedOf, lastMoveOf } from '../pacing';
import { ManualScheduler, findState, join, newLobby, playingRoom, settle } from './helpers';

const QUIET = { factoryOpTimeoutMs: 0, roundEndTimeoutMs: 0 };

async function quick(): Promise<void> {
  for (let i = 0; i < 3; i++) await new Promise<void>(r => setImmediate(r));
}

/** Ann hosts; Bea joins as a person; seat 2 is a bot. Ann's seat is played by the host's stand-in bot. */
async function table(settings: Record<string, unknown> = {}): Promise<{ host: HostSession; sched: ManualScheduler; me: ClientSession; bea: ClientSession }> {
  const { host, sched, me } = await newLobby({ settings: { playerCount: 3, ...QUIET, ...settings }, randomSeed: () => 3131 });
  const bea = join(host, 'Bea', 'tok-bea-0123456789').client;
  await settle();
  expect((await me.setSeat(2, 'bot', 'greedy')).ok).toBe(true);
  for (const c of [me, bea]) expect((await c.setReady(true)).ok).toBe(true);
  expect((await me.start()).ok).toBe(true);
  expect((await me.setAutopilot(0, true)).ok).toBe(true);
  await settle();
  return { host, sched, me, bea };
}

interface Step { t: number; room: Room }

describe('bot speed', () => {
  it('is Normal by default, not part of the rules, and kept in saves (an old save gets the default)', async () => {
    expect(defaultSettings().botSpeed).toBe('normal');
    const fp = rulesFingerprint();
    const { host, me } = await table();
    expect(host.room.settings.botSpeed).toBe('normal');
    const save = toSave(host.room, { savedAt: 1, app: 't' });
    expect(parseSaveFile(serializeSaveFile(save)).room.settings.botSpeed).toBe('normal');
    expect((await unpackLink(await packLink({ ...save, room: { ...save.room, log: [] } }))).room.settings.botSpeed).toBe('normal');
    expect(rulesFingerprint()).toBe(fp);
    host.dispose();
    me.dispose();

    // A save from before the setting existed, and one with a value this build does not know.
    const old = JSON.parse(serializeSaveFile(save)) as { room: { settings: Record<string, unknown> } };
    delete old.room.settings.botSpeed;
    const odd = JSON.parse(serializeSaveFile(save)) as { room: { settings: Record<string, unknown> } };
    odd.room.settings.botSpeed = 'warp';
    for (const raw of [old, odd]) {
      const loaded = parseSaveFile(JSON.stringify(raw));
      const h = new HostSession({ code: 'NEWRM', hostName: 'Ann', hostToken: 'tok-ann-0123456789', room: loaded.room, mode: 'resume', scheduler: new ManualScheduler() });
      expect(h.room.settings.botSpeed).toBe('normal');
      h.dispose();
    }
    expect(botSpeedOf({})).toBe('normal');
  });

  it('at Normal, every bot move waits for the previous one to be shown; a whole game with a person completes', async () => {
    const { host, sched, bea } = await table();
    const steps: Step[] = [];
    let lastSeq = host.room.seq;
    host.subscribe(() => {
      if (host.room.seq !== lastSeq) { lastSeq = host.room.seq; steps.push({ t: sched.now(), room: host.room }); }
    });
    const start: Step = { t: sched.now(), room: host.room };
    let humanMoves = 0;
    for (let i = 0; i < 20_000 && host.room.phase !== 'finished'; i++) {
      await quick();
      const r = host.room;
      const g = r.game!;
      const owner = g.pendingFactoryOps.find(e => e.ownerId === 1)?.ownerId;
      const mustAct = owner === 1 || (g.pendingFactoryOps.length === 0 && activeSeat(g) === 1);
      if (mustAct && !bea.pending) {
        await bea.act(greedy(g, 1 as PlayerId));
        humanMoves++;
        continue;
      }
      if (sched.pending === 0) throw new Error('nothing left to happen');
      sched.runUntil(() => false, 1);
    }
    await settle();
    expect(host.room.phase).toBe('finished');
    expect(humanMoves).toBeGreaterThan(20);

    // Each bot move (Ann's stand-in at seat 0, the bot at seat 2) came exactly its pause after the move before it.
    const seen = new Set<number>();
    let botMoves = 0;
    let prev = start;
    for (const s of steps) {
      const before = prev.room;
      const g = before.game!;
      const pending = g.pendingFactoryOps.find(e => e.ownerId !== 1);
      const botSeat = pending ? pending.ownerId : activeSeat(g);
      const byBot = (pending !== undefined || g.pendingFactoryOps.length === 0) && botSeat !== 1 && s.t > prev.t;
      if (byBot) {
        const offTurn = pending !== undefined && activeSeat(g) !== pending.ownerId;
        const want = botPauseMs(before.settings, lastMoveOf(before.lastEvents), offTurn);
        expect(s.t - prev.t).toBe(want);
        seen.add(want);
        botMoves++;
      }
      prev = s;
    }
    expect(botMoves).toBeGreaterThan(100);
    // (Operate choices on another player's turn are rare in bot games; the next test sets one up.)
    for (const want of [NORMAL_PAUSE.rollQuiet, NORMAL_PAUSE.rollActive, NORMAL_PAUSE.other]) expect(seen).toContain(want);
    host.dispose();
  }, 60_000);

  it("a bot answers an operate choice on another player's turn after a short pause", async () => {
    const game = findState(2, g => g.phase === 'actions' && g.pendingFactoryOps.some(e => e.ownerId !== activeSeat(g)));
    const active = activeSeat(game)!;
    const owner = game.pendingFactoryOps.find(e => e.ownerId !== active)!.ownerId;
    const seats = [0, 1].map(i => ({ kind: i === owner ? 'bot' as const : 'human' as const, name: i === owner ? 'Smart Bot' : 'Ann' }));
    const room = playingRoom(game, seats, active, { ...QUIET, awayPolicy: 'wait', botSpeed: 'normal' });
    const sched = new ManualScheduler();
    const t0 = sched.now();
    const host = new HostSession({ code: 'ROOMA', hostName: 'Ann', hostToken: 'tok-ann-0123456789', room, mode: 'takeover', hostSeat: active, scheduler: sched });
    expect(host.room.seq).toBe(room.seq);
    sched.runUntil(() => host.room.seq > room.seq);
    expect(sched.now() - t0).toBe(NORMAL_PAUSE.offTurn);
    expect(host.room.game!.pendingFactoryOps.some(e => e.ownerId === owner)).toBe(false);
    host.dispose();
  });

  it('Instant plays bots in runs without the clock moving, as before; Fast waits its fixed pause', async () => {
    const instant = await table({ botSpeed: 'instant' });
    instant.sched.runUntil(() => instant.host.room.phase === 'finished' || activeSeat(instant.host.room.game) === 1);
    expect(instant.sched.now()).toBe(1_000_000);
    instant.host.dispose();
    // The option the tests pass (a fixed pause) still means what it did: 0 is instant.
    const legacy = await table({ botDelayMs: 0 });
    expect(legacy.host.room.settings.botSpeed).toBe('instant');
    legacy.host.dispose();
    const fast = await table({ botDelayMs: 250 });
    expect(fast.host.room.settings.botSpeed).toBe('fast');
    const t0 = fast.sched.now();
    const seq0 = fast.host.room.seq;
    fast.sched.runUntil(() => fast.host.room.seq > seq0, 5);
    expect(fast.sched.now() - t0).toBe(250);
    fast.host.dispose();
  });

  it('the host can change it during the game, from the next bot move; nobody else can, and nothing else changes mid-game', async () => {
    const { host, sched, me, bea } = await table();
    // Run until a bot is about to move.
    for (let i = 0; i < 50 && activeSeat(host.room.game) === 1; i++) {
      await bea.act(greedy(host.room.game!, 1 as PlayerId));
      await quick();
    }
    expect((await bea.configure({ botSpeed: 'instant' }))).toMatchObject({ ok: false, error: { code: 'NOT_HOST' } });
    expect((await me.configure({ botSpeed: 'warp' as never }))).toMatchObject({ ok: false, error: { code: 'BAD_SETTINGS' } });
    expect((await me.configure({ playerCount: 2 }))).toMatchObject({ ok: false, error: { code: 'NOT_IN_LOBBY' } });
    const seq0 = host.room.seq;
    const t0 = sched.now();
    expect((await me.configure({ botSpeed: 'instant' })).ok).toBe(true);
    await sched.flushDue(); // no time passes
    expect(host.room.settings.botSpeed).toBe('instant');
    expect(host.room.seq).toBeGreaterThan(seq0);
    expect(sched.now()).toBe(t0);
    expect((await me.configure({ botSpeed: 'normal' })).ok).toBe(true);
    expect(host.room.settings.botSpeed).toBe('normal');
    host.dispose();
  }, 60_000);

  it('a new host after a hand-over keeps the room\'s bot speed', async () => {
    const { host, me } = await table({ botSpeed: 'fast' });
    await settle();
    const room = me.room!;
    host.dispose();
    const next = promoteToHost(room, 0, { hostToken: 'tok-ann-0123456789', scheduler: new ManualScheduler() });
    expect(next.room.settings.botSpeed).toBe('fast');
    next.dispose();
  });
});
