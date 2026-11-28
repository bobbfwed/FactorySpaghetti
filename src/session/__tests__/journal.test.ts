// The move journal: kept by the host, carried by every room broadcast, copied by every client,
// filled in on request, carried over a host hand-over, stored with the automatic save, and in the
// save file but never in the save link. Replaying it reproduces the game exactly.

import { PROTOCOL } from '../protocol';
import { describe, it, expect } from 'vitest';
import type { GameState } from '../../engine/state';
import type { HostSession } from '../hostSession';
import { HostSession as Host } from '../hostSession';
import { ClientSession, JOURNAL_OVERLAP, JOURNAL_WRITE_MS, promoteToHost } from '../clientSession';
import type { JournalData } from '../journal';
import {
  MAX_JOURNAL_MOVES, extendJournal, fullJournal, journalEnd, journalFrom, journalMatches, parseJournal, replayTo,
} from '../journal';
import { memoryPair } from '../memoryConn';
import type { SaveStore } from '../store';
import { journalKey, memoryStore, readJournal, saveKey } from '../store';
import { packLink, parseSaveFile, serializeSaveFile, toSave, unpackLink } from '../save';
import type { Room } from '../room';
import type { Joined } from './helpers';
import { ManualScheduler, driveHumans, join, newLobby, rejoin, settle } from './helpers';

const QUIET = { factoryOpTimeoutMs: 0, roundEndTimeoutMs: 0, botDelayMs: 0 };

interface Table { host: HostSession; sched: ManualScheduler; me: ClientSession; others: Joined[] }

/**
 * Ann hosts (seat 0, on autopilot); Bea and Cy join from their own devices; any further seat is
 * a bot. With `bots`, the host also puts Bea's and Cy's seats on autopilot, so the host's bots
 * play the whole game while every device follows it.
 */
async function table(playerCount: 2 | 3 | 4, seed = 4242, extra: Record<string, unknown> = {}, bots = true): Promise<Table> {
  const { host, sched, me } = await newLobby({ settings: { playerCount, ...QUIET, ...extra }, randomSeed: () => seed });
  const names = ['Bea', 'Cy'].slice(0, playerCount - 1);
  const others = names.map(n => join(host, n, `tok-${n.toLowerCase()}-0123456789`));
  await settle();
  for (let i = 1 + names.length; i < playerCount; i++) expect((await me.setSeat(i, 'bot', 'greedy')).ok).toBe(true);
  for (const c of [me, ...others.map(o => o.client)]) expect((await c.setReady(true)).ok).toBe(true);
  expect((await me.start()).ok).toBe(true);
  for (let i = 0; i <= (bots ? names.length : 0); i++) expect((await me.setAutopilot(i, true)).ok).toBe(true);
  await settle();
  return { host, sched, me, others };
}

/** Let the host's bots play (one timer at a time, messages delivered in between) until `until` holds. */
async function botsUntil(host: HostSession, sched: ManualScheduler, until: (r: Room) => boolean): Promise<void> {
  for (let i = 0; i < 100_000; i++) {
    await quick();
    if (until(host.room)) { await settle(); return; }
    if (sched.pending === 0) throw new Error('botsUntil: nothing left to happen');
    sched.runUntil(() => until(host.room), 1);
  }
  throw new Error('botsUntil: too many steps');
}

/** Deliver in-flight messages without waiting on timers (a timer tick is about 15 ms on Windows). */
async function quick(): Promise<void> {
  for (let i = 0; i < 3; i++) await new Promise<void>(r => setImmediate(r));
}

/** Replaying a journal from its start reproduces `game` exactly. */
function expectReplays(j: JournalData | null, game: GameState | null, seq: number): void {
  expect(j).not.toBeNull();
  expect(journalEnd(j!)).toBe(seq);
  expect(replayTo(j!, seq)).toEqual(game);
}

describe('the move journal through a host and its clients', () => {
  for (const pc of [2, 3, 4] as const) {
    it(`${pc} players: every device holds the host's journal, and it replays to the final state`, async () => {
      // 3 players: bots pause between moves, so every broadcast carries one move; otherwise
      // bots play in runs and a broadcast carries many.
      const t = await table(pc, 900 + pc, pc === 3 ? { botDelayMs: 100 } : {});
      await botsUntil(t.host, t.sched, r => r.phase === 'finished');
      await settle();
      const room = t.host.room;
      expect(room.game!.gameOver).toBe(true);
      const hostJournal = t.host.journal!;
      expect(journalFrom(hostJournal)).toBe(0);
      expect('seed' in hostJournal.start).toBe(true);
      expectReplays(hostJournal, room.game, room.seq);
      for (const c of [t.me, ...t.others.map(o => o.client)]) {
        expect(c.journalCurrent).toBe(true);
        expect(c.journal).toEqual(hostJournal);
      }
      // Rolls carry the host's dice, so nothing in the journal is left to chance.
      const rolls = hostJournal.moves.filter(m => m.type === 'ROLL_DICE');
      expect(rolls.length).toBeGreaterThan(10);
      expect(rolls.every(m => m.type === 'ROLL_DICE' && m.rolls.length > 0)).toBe(true);
      t.host.dispose();
    }, 60_000);
  }

  it('survives a host hand-over: the successor already holds the whole journal', async () => {
    const t = await table(3, 5151, { awayGraceMs: 0 });
    await botsUntil(t.host, t.sched, r => r.seq >= 120);
    const [bea, cy] = t.others as [Joined, Joined];
    // The host's browser vanishes.
    t.host.dispose();
    await settle();
    const beaRoom = bea.client.room!;
    const sched = new ManualScheduler();
    const before = bea.client.journal!;
    expect(journalEnd(before)).toBe(beaRoom.seq);
    const next = promoteToHost(beaRoom, 1, { hostToken: 'tok-bea-0123456789', scheduler: sched, journal: before });
    // The new host's bots may already have moved on; what Bea held is the journal's beginning.
    expect(next.journal!.start).toEqual(before.start);
    expect(next.journal!.moves.slice(0, before.moves.length)).toEqual(before.moves);
    bea.client.reattach(next.connectLocal());
    const cy2 = rejoin(next, cy);
    await settle();
    // Coming back hands a seat back to its player; let the bots play on for them.
    for (const i of [1, 2]) expect((await bea.client.setAutopilot(i, true)).ok).toBe(true);
    await botsUntil(next, sched, r => r.phase === 'finished');
    await settle();
    const final = next.room;
    const j = next.journal!;
    expect(journalFrom(j)).toBe(0);
    expectReplays(j, final.game, final.seq);
    expect(bea.client.journal).toEqual(j);
    expect(cy2.client.journal).toEqual(j);
    next.dispose();
  }, 60_000);

  it('a client that missed broadcasts asks for the missing moves when it comes back', async () => {
    const t = await table(3, 6262, { awayGraceMs: 0 }, false);
    const cy = t.others[1]!;
    // A few moves made by the people themselves, through their own devices.
    await driveHumans(t.host, { 1: t.others[0]!.client, 2: cy.client }, r => r.seq >= 30, 5000, t.sched);
    await settle();
    // Cy's link drops; a bot plays Cy's seat while the game goes on.
    cy.hostEnd.close();
    await settle();
    const seqBefore = cy.client.room!.seq;
    expect((await t.me.setAutopilot(1, true)).ok).toBe(true);
    await botsUntil(t.host, t.sched, r => r.seq >= seqBefore + 30);
    expect(cy.client.room!.seq).toBe(seqBefore);
    expect(cy.client.journalCurrent).toBe(true); // still complete up to the room it last saw
    const back = rejoin(t.host, cy);
    await settle();
    await settle();
    expect(back.client.room!.seq).toBe(t.host.room.seq);
    expect(back.client.journal).toEqual(t.host.journal);
    t.host.dispose();
  }, 60_000);

  it('a device that joins mid-game with nothing gets the whole journal from the host', async () => {
    const t = await table(3, 7373, { awayPolicy: 'wait' });
    await botsUntil(t.host, t.sched, r => r.seq >= 60);
    const cy = t.others[1]!;
    cy.hostEnd.close(); // Cy's phone dies
    await settle();
    // Cy picks up a tablet: a new device, a new token, the same name.
    const tablet = join(t.host, 'Cy', 'tok-cy-tablet-0123456789');
    await settle();
    await settle();
    expect(tablet.client.seat).toBe(2);
    expect(tablet.client.journalStart).toBe(0);
    expect(tablet.client.journal).toEqual(t.host.journal);
    t.host.dispose();
  }, 60_000);

  it('a game resumed from a save link has a partial journal from the save, on every device', async () => {
    const t = await table(3, 8484);
    await botsUntil(t.host, t.sched, r => r.seq >= 70);
    const link = await packLink(toSave(t.host.room, { savedAt: 1, app: 'test' }, { forLink: true, journal: t.host.journal }));
    t.host.dispose();
    const save = await unpackLink(link);
    expect(save.journal).toBeUndefined();

    const sched = new ManualScheduler();
    const host = new Host({ code: 'NEWRM', hostName: 'Ann', hostToken: 'tok-ann-0123456789', room: save.room, mode: 'resume', scheduler: sched });
    const me = new ClientSession(host.connectLocal(), { name: 'Ann', token: 'tok-ann-0123456789' });
    const bea = join(host, 'Bea', 'tok-bea-phone-0123456789');
    const cy = join(host, 'Cy', 'tok-cy-phone-0123456789');
    await settle();
    for (const i of [0, 1, 2]) expect((await me.setAutopilot(i, true)).ok).toBe(true);
    expect((await me.resumeGame()).ok).toBe(true);
    await botsUntil(host, sched, r => r.phase === 'finished');
    await settle();
    const j = host.journal!;
    expect(journalFrom(j)).toBe(save.room.seq);
    expectReplays(j, host.room.game, host.room.seq);
    for (const c of [me, bea.client, cy.client]) {
      expect(c.journalStart).toBe(save.room.seq);
      expect(c.journal).toEqual(j);
    }
    host.dispose();
  }, 60_000);

  it('a host that does not know the journal request: the client keeps a partial journal from its position', async () => {
    const t = await table(2, 9595);
    await botsUntil(t.host, t.sched, r => r.seq >= 20);
    const room = t.host.room;
    t.host.dispose();
    // An older host: answers the journal request with BAD_MESSAGE, and sends rooms without moves.
    const [hostEnd, clientEnd] = memoryPair();
    hostEnd.onmessage = (raw): void => {
      const m = raw as { t: string; id?: string };
      if (m.t === 'hello') hostEnd.send({ t: 'welcome', v: PROTOCOL, seat: 1, room, now: 1 });
      else if (m.t === 'journal') hostEnd.send({ t: 'nope', id: m.id ?? null, error: { code: 'BAD_MESSAGE', message: 'That message was not understood.' } });
    };
    const c = new ClientSession(clientEnd, { name: 'Bea', token: 'tok-bea-other-0123456789' });
    await settle();
    expect(c.journalStart).toBe(room.seq);
    expect(c.journalCurrent).toBe(true);
    c.dispose();
  });

  /** Bea's device, with its own storage, on the test's clock; counts the writes of her stored journal. */
  function beaDevice(host: HostSession, sched: ManualScheduler, store: SaveStore, token = 'tok-bea-0123456789'): Joined & { writes: () => number } {
    const [hostEnd, clientEnd] = memoryPair();
    host.accept(hostEnd);
    let writes = 0;
    const counting: SaveStore = {
      ...store,
      set: (k, v): void => { if (k === journalKey('KQMTV')) writes++; store.set(k, v); },
    };
    const client = new ClientSession(clientEnd, { name: 'Bea', token, store: counting, scheduler: sched, now: (): number => sched.now() });
    return { client, hostEnd, clientEnd, writes: () => writes };
  }

  async function storedGame(botDelayMs: number): Promise<{ host: HostSession; sched: ManualScheduler; me: ClientSession; bea: ReturnType<typeof beaDevice>; store: SaveStore }> {
    const store = memoryStore();
    const { host, sched, me } = await newLobby({ settings: { playerCount: 2, ...QUIET, botDelayMs, awayGraceMs: 0 } });
    const bea = beaDevice(host, sched, store);
    await settle();
    for (const c of [me, bea.client]) expect((await c.setReady(true)).ok).toBe(true);
    expect((await me.start()).ok).toBe(true);
    for (const i of [0, 1]) expect((await me.setAutopilot(i, true)).ok).toBe(true);
    await settle();
    return { host, sched, me, bea, store };
  }

  it('is stored beside the automatic save at most every 2 seconds, and at once when the game ends', async () => {
    const { host, sched, bea, store } = await storedGame(100); // one move every 100 ms
    const t0 = sched.now();
    let broadcasts = 0;
    bea.client.subscribe(() => { broadcasts++; });
    await botsUntil(host, sched, r => r.phase === 'finished');
    const elapsed = sched.now() - t0;
    // The room save keeps its timing (every update); the journal is written far less often.
    expect(store.get(saveKey('KQMTV'))).not.toBeNull();
    expect(JSON.parse(store.get(saveKey('KQMTV'))!).room.seq).toBe(host.room.seq);
    expect(bea.writes()).toBeLessThanOrEqual(Math.ceil(elapsed / JOURNAL_WRITE_MS) + 3);
    expect(bea.writes()).toBeLessThan(broadcasts / 5);
    // The game is over: the whole journal was written without waiting.
    expect(readJournal(store, 'KQMTV')).toEqual(host.journal);
    host.dispose();
  }, 60_000);

  it('is written at once when the session ends or the app asks (page hidden)', async () => {
    const { host, sched, bea, store } = await storedGame(0);
    await botsUntil(host, sched, r => r.seq >= 60);
    // Bots played many moves without the clock moving: the stored copy is behind.
    expect(journalEnd(readJournal(store, 'KQMTV')!)).toBeLessThan(host.room.seq);
    bea.client.flushJournal();
    expect(readJournal(store, 'KQMTV')).toEqual(bea.client.journal);
    await botsUntil(host, sched, r => r.seq >= 90);
    bea.client.dispose();
    expect(journalEnd(readJournal(store, 'KQMTV')!)).toBe(bea.client.room!.seq);
    host.dispose();
  }, 60_000);

  it('after a crash that missed the last write, a reload fills the gap from the host', async () => {
    const { host, sched, bea, store } = await storedGame(0);
    await botsUntil(host, sched, r => r.seq >= 80);
    const stored = readJournal(store, 'KQMTV')!;
    expect(journalEnd(stored)).toBeLessThan(host.room.seq); // the last moves never reached storage
    // The tab dies: no flush, the connection just drops.
    bea.hostEnd.close();
    await settle();
    await botsUntil(host, sched, r => r.seq >= 110);
    const again = beaDevice(host, sched, store);
    const asked: unknown[] = [];
    const send = again.clientEnd.send.bind(again.clientEnd);
    again.clientEnd.send = (m: unknown): void => { if ((m as { t: string }).t === 'journal') asked.push(m); send(m); };
    await settle();
    await settle();
    // It asks from a few moves before its end, so the overlap shows the games agree.
    expect(asked).toMatchObject([{ t: 'journal', have: Math.max(journalFrom(stored), journalEnd(stored) - JOURNAL_OVERLAP) }]);
    expect(again.client.journalStart).toBe(0);
    expect(again.client.journal).toEqual(host.journal);
    again.client.flushJournal();
    expect(readJournal(store, 'KQMTV')).toEqual(host.journal);
    host.dispose();
  }, 60_000);

  it('after a crash, when the host cannot fill the gap, the device keeps a correct partial journal', async () => {
    const { host, sched, bea, store } = await storedGame(0);
    await botsUntil(host, sched, r => r.seq >= 80);
    const stored = readJournal(store, 'KQMTV')!;
    bea.hostEnd.close();
    await settle();
    await botsUntil(host, sched, r => r.seq >= 110);
    // The game goes on from a save link (no moves in it), hosted again under the same code.
    const save = await unpackLink(await packLink(toSave(host.room, { savedAt: 1, app: 't' }, { forLink: true })));
    host.dispose();
    const sched2 = new ManualScheduler();
    const host2 = new Host({ code: 'KQMTV', hostName: 'Ann', hostToken: 'tok-ann-0123456789', room: save.room, mode: 'resume', scheduler: sched2 });
    expect(journalFrom(host2.journal!)).toBe(save.room.seq);
    const again = beaDevice(host2, sched2, store);
    await settle();
    await settle();
    // Bea's stored journal (to move journalEnd(stored)) cannot be continued: she takes the host's.
    expect(journalEnd(stored)).toBeLessThan(save.room.seq);
    expect(again.client.journalStart).toBe(save.room.seq);
    expect(again.client.journal).toEqual(host2.journal);
    expect(replayTo(again.client.journal!, save.room.seq)).toEqual(save.room.game);
    host2.dispose();
  }, 60_000);
});

describe('journal pieces', () => {
  it('joins moves only when they continue the journal', () => {
    const j = fullJournal(1, 2);
    const a = { type: 'END_TURN' } as const;
    expect(extendJournal(j, 0, [a, a])).toBe(true);
    expect(journalEnd(j)).toBe(2);
    expect(extendJournal(j, 1, [a, a])).toBe(true); // overlaps by one
    expect(journalEnd(j)).toBe(3);
    expect(extendJournal(j, 5, [a])).toBe(false);   // a gap
    expect(journalEnd(j)).toBe(3);
  });

  it('refuses damaged journals and moves', () => {
    expect(parseJournal({ start: { seed: 1, playerCount: 5 }, moves: [] })).toBeNull();
    expect(parseJournal({ start: { seed: 1, playerCount: 2 }, moves: [{ type: 'NOT_A_MOVE' }] })).toBeNull();
    expect(parseJournal({ start: { seed: 1, playerCount: 2 }, moves: [{ type: 'ROLL_DICE', rolls: 'six' }] })).toBeNull();
    expect(parseJournal({ start: { seed: 1, playerCount: 2 }, moves: [{ type: 'END_TURN', x: 'y'.repeat(100) }] })).toBeNull();
    expect(parseJournal({ start: { state: { nope: true }, seq: 3 }, moves: [] })).toBeNull();
    const big = Array.from({ length: MAX_JOURNAL_MOVES + 1 }, () => ({ type: 'END_TURN' }));
    expect(parseJournal({ start: { seed: 1, playerCount: 2 }, moves: big })).toBeNull();
    expect(parseJournal({ start: { seed: 1, playerCount: 2 }, moves: [{ type: 'END_TURN' }] })).not.toBeNull();
  });
});

describe('the journal in saves', () => {
  async function midGame(): Promise<{ room: Room; journal: JournalData }> {
    const t = await table(2, 1234);
    await botsUntil(t.host, t.sched, r => r.seq >= 40);
    const out = { room: t.host.room, journal: t.host.journal! };
    t.host.dispose();
    return out;
  }

  it('round-trips in a save file, with and without a journal, and never goes into a link', async () => {
    const { room, journal } = await midGame();
    const withJ = parseSaveFile(serializeSaveFile(toSave(room, { savedAt: 5, app: 't' }, { journal })));
    expect(withJ.journal).toEqual(journal);
    const without = parseSaveFile(serializeSaveFile(toSave(room, { savedAt: 5, app: 't' })));
    expect(without.journal).toBeUndefined();
    expect(without.room).toEqual(withJ.room);

    const linkSave = toSave(room, { savedAt: 5, app: 't' }, { forLink: true, journal });
    expect('journal' in linkSave).toBe(false);
    const link = await packLink(linkSave);
    expect((await unpackLink(link)).journal).toBeUndefined();
    const linkWithout = await packLink(toSave(room, { savedAt: 5, app: 't' }, { forLink: true }));
    expect(link).toBe(linkWithout);
  });

  it('a damaged or foreign journal is dropped, and the save still loads', async () => {
    const { room, journal } = await midGame();
    const base = JSON.parse(serializeSaveFile(toSave(room, { savedAt: 5, app: 't' }))) as Record<string, unknown>;
    const damaged = parseSaveFile(JSON.stringify({ ...base, journal: { start: 'x', moves: 3 } }));
    expect(damaged.journal).toBeUndefined();
    expect(damaged.room.game).toEqual(room.game);
    const short = parseSaveFile(JSON.stringify({ ...base, journal: { ...journal, moves: journal.moves.slice(1) } }));
    expect(short.journal).toBeUndefined();
  });

  it('journalMatches replays a journal to the saved position, cutting back one that went further', async () => {
    const { room, journal } = await midGame();
    expect(journalMatches(journal, room.game!, room.seq)).toEqual(journal);
    const earlier = replayTo(journal, room.seq - 5)!;
    expect(journalMatches(journal, earlier, room.seq - 5)!.moves).toHaveLength(room.seq - 5);
    // A journal that does not lead to the saved position does not match.
    expect(journalMatches(journal, { ...room.game!, round: room.game!.round + 1 }, room.seq)).toBeNull();
    expect(journalMatches(journal, room.game!, room.seq + 1)).toBeNull();
  });
});
