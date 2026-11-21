// Fixes from the session-layer review: moves rebuilt from known fields only, a capped waiting
// list, rooms from a host trimmed rather than refused, journals checked on promotion and after
// splicing, storage that fills up, journal requests limited, dice checked in replays, old bot
// speed settings, and errors that must not roll back what everyone already received.

import { describe, it, expect, vi } from 'vitest';
import type { Action } from '../../engine/actions';
import type { GameState, PlayerId } from '../../engine/state';
import { applyAction, createGame, legalActions } from '../../engine';
import { chooseAction as randomBot } from '../../bots/randomBot';
import { chooseAction as greedy } from '../../bots/greedyBot';
import type { Room } from '../room';
import { activeSeat } from '../room';
import { HostSession, MAX_WAITING } from '../hostSession';
import { ClientSession, promoteToHost } from '../clientSession';
import { memoryPair } from '../memoryConn';
import { normalizeAction } from '../normalize';
import { acceptHostRoom, parseSaveFile, serializeSaveFile, toSave } from '../save';
import type { SaveStore } from '../store';
import { JOURNALS_KEPT, journalKey, memoryStore, saveKey, writeSave } from '../store';
import { diceRngFromSeed, rollDice } from '../dice';
import type { JournalData } from '../journal';
import { fullJournal, journalFrom, replayTo } from '../journal';

/** Another legal move than the journal's at position `pos` (from the same position). */
function otherMove(j: JournalData, pos: number): Action {
  const before = replayTo(j, pos)!;
  const real = j.moves[pos]!;
  const seat = before.pendingFactoryOps[0]?.ownerId ?? activeSeat(before)!;
  const other = legalActions(before, seat as PlayerId).find(a => JSON.stringify(a) !== JSON.stringify(real) && a.type === real.type)
    ?? legalActions(before, seat as PlayerId).find(a => JSON.stringify(a) !== JSON.stringify(real));
  if (!other) throw new Error('no other move');
  return other;
}
import { actorOf, makeReplay, verifyReplay } from '../replay';
import { ManualScheduler, findState, join, newLobby, playingRoom, rejoin, settle } from './helpers';

const QUIET = { factoryOpTimeoutMs: 0, roundEndTimeoutMs: 0, botDelayMs: 0 };

/** Ann hosts, Bea plays from her own device; both people. */
async function two(): Promise<{ host: HostSession; sched: ManualScheduler; me: ClientSession; bea: ReturnType<typeof join> }> {
  const { host, sched, me } = await newLobby({ settings: { playerCount: 2, ...QUIET, awayPolicy: 'wait' } });
  const bea = join(host, 'Bea', 'tok-bea-0123456789');
  await settle();
  for (const c of [me, bea.client]) expect((await c.setReady(true)).ok).toBe(true);
  expect((await me.start()).ok).toBe(true);
  await settle();
  return { host, sched, me, bea };
}

async function playUntil(host: HostSession, clients: ClientSession[], pred: (g: GameState) => boolean): Promise<void> {
  for (let n = 0; n < 3000 && !pred(host.room.game!); n++) {
    const g = host.room.game!;
    const seat = g.pendingFactoryOps[0]?.ownerId ?? activeSeat(g)!;
    const res = await clients[seat]!.act(greedy(g, seat as PlayerId));
    if (!res.ok) throw new Error(res.error.code);
    await settle();
  }
  expect(pred(host.room.game!)).toBe(true);
}

describe('moves from other browsers are rebuilt from their known fields (normalizeAction)', () => {
  it('rebuilds every move the engine offers to itself, over many games of 2, 3 and 4 players', () => {
    let checked = 0;
    for (const pc of [2, 3, 4] as const) {
      for (const seed of [11, 12]) {
        let s = createGame(seed, pc);
        let dice = diceRngFromSeed(seed);
        for (let n = 0; n < 500 && !s.gameOver; n++) {
          const seats = new Set<number>([activeSeat(s)!, ...s.pendingFactoryOps.map(e => e.ownerId)]);
          for (const seat of seats) {
            for (const a of legalActions(s, seat as PlayerId)) {
              expect(normalizeAction(a)).toEqual(a);
              checked++;
            }
          }
          const actor = s.pendingFactoryOps[0]?.ownerId ?? activeSeat(s)!;
          let a: Action = randomBot(s, actor as PlayerId);
          if (a.type === 'ROLL_DICE') { const [r, next] = rollDice(dice, s.mineCount); dice = next; a = { type: 'ROLL_DICE', rolls: r }; }
          expect(normalizeAction(a)).toEqual(a);
          const res = applyAction(s, a);
          if (!res.ok) break;
          s = res.state;
        }
      }
    }
    expect(checked).toBeGreaterThan(10_000);
    expect(normalizeAction({ type: 'ROLL_DICE', rolls: [] })).toEqual({ type: 'ROLL_DICE', rolls: [] });
    expect(normalizeAction({ type: 'NOT_A_MOVE' })).toBeNull();
    expect(normalizeAction({ type: 'PLACE_PIECE', stackIndex: 0 })).toBeNull();
    expect(normalizeAction({ type: 'PLACE_BELT', pieceId: 'p', fromPoint: 1.5, toPoint: 2 })).toBeNull();
    expect(normalizeAction({ type: 'SETUP_CLAIM', pieceId: 'x'.repeat(65) })).toBeNull();
  });

  it('the host keeps only the known fields: a move with extra data does not stop anyone\'s journal', async () => {
    const { host, me, bea } = await two();
    await playUntil(host, [me, bea.client], g => activeSeat(g) === 1 && g.phase === 'roll' && g.pendingFactoryOps.length === 0);
    const junk = { type: 'ROLL_DICE', rolls: [], x: 'a'.repeat(100_000), nested: { deep: [1, 2, 3] } } as unknown as Action;
    expect((await bea.client.act(junk)).ok).toBe(true);
    await settle();
    const last = host.journal!.moves.at(-1)!;
    expect(Object.keys(last).sort()).toEqual(['rolls', 'type']);
    expect(me.journalCurrent).toBe(true);
    expect(bea.client.journalCurrent).toBe(true);
    expect(bea.client.journal).toEqual(host.journal);
    // A move that cannot be read is refused and changes nothing.
    const seq = host.room.seq;
    const g = host.room.game!;
    const bad = { type: 'PLACE_PIECE', stackIndex: 0 } as unknown as Action;
    const seat = activeSeat(g)!;
    expect(await [me, bea.client][seat]!.act(bad)).toMatchObject({ ok: false, error: { code: 'BAD_ACTION' } });
    expect(host.room.seq).toBe(seq);
    host.dispose();
  }, 60_000);

  it('a round-end Operate keeps no owner taken from the sender, so the replay names the right player', async () => {
    const game = findState(2, s => s.phase === 'roundEnd' && legalActions(s, activeSeat(s)!).some(a => a.type === 'OPERATE_BUILDING'));
    const active = activeSeat(game)!;
    const other = 1 - active;
    const room = playingRoom(game, [{ kind: 'human', name: 'Ann' }, { kind: 'human', name: 'Bea' }], active, { ...QUIET, awayPolicy: 'wait' });
    const host = new HostSession({ code: 'ROOMA', hostName: room.seats[active]!.name, hostToken: 'tok-ann-0123456789', room, mode: 'takeover', hostSeat: active, scheduler: new ManualScheduler() });
    const me = new ClientSession(host.connectLocal(), { name: room.seats[active]!.name, token: 'tok-ann-0123456789' });
    await settle();
    const op = legalActions(game, active as PlayerId).find(a => a.type === 'OPERATE_BUILDING')!;
    expect((await me.act({ ...op, ownerId: other } as Action)).ok).toBe(true);
    const stored = host.journal!.moves.at(-1)!;
    expect(stored).toEqual(op);
    expect(actorOf(game, stored)).toBe(active);
    host.dispose();
  }, 60_000);
});

describe('the waiting list, and rooms from a host', () => {
  it('the host lets at most a few people wait for a seat; more are told the room is full', async () => {
    const game = findState(2, s => s.round >= 2);
    const room = playingRoom(game, [{ kind: 'human', name: 'Ann' }, { kind: 'human', name: 'Bea' }], 0, { ...QUIET, awayPolicy: 'wait' });
    const host = new HostSession({ code: 'ROOMA', hostName: 'Ann', hostToken: 'tok-ann-0123456789', room, mode: 'takeover', hostSeat: 0, scheduler: new ManualScheduler() });
    const closed: unknown[] = [];
    for (let i = 0; i < MAX_WAITING + 3; i++) {
      const [h, c] = memoryPair();
      host.accept(h);
      c.onmessage = (m): void => { if ((m as { t: string }).t === 'closed') closed.push(m); };
      c.send({ t: 'hello', v: 1, name: `Visitor ${i}`, token: `tok-visitor-${i}-0123456789` });
    }
    await settle();
    expect(host.room.waiting).toHaveLength(MAX_WAITING);
    expect(closed).toEqual([{ t: 'closed', why: 'full' }, { t: 'closed', why: 'full' }, { t: 'closed', why: 'full' }]);
    host.dispose();
  });

  it('long display lists and malformed events are trimmed, not a reason to ignore the room', () => {
    const game = findState(2, s => s.round >= 2);
    const base = playingRoom(game, [{ kind: 'human', name: 'Ann' }, { kind: 'human', name: 'Bea' }], 0);
    const huge: Room = {
      ...base,
      waiting: Array.from({ length: 60 }, (_, i) => ({ id: `w${i}`, name: `V${i}` })),
      log: Array.from({ length: 700 }, (_, i) => ({ seq: i, seat: null, text: `line ${i}` })),
      lastEvents: [
        { kind: 'roll', seat: 9, dice: 'six', total: 6 } as never,
        { kind: 'roll', seat: 0, dice: [3], total: 3 },
        { kind: 'explode', seat: 0 } as never,
        { kind: 'cardPlayed', seat: 1, card: 'notACard' } as never,
        { kind: 'gameOver', winner: null, tied: [0, 1], reason: null },
      ],
    };
    const ok = acceptHostRoom(JSON.parse(JSON.stringify(huge)))!;
    expect(ok).not.toBeNull();
    expect(ok.waiting).toHaveLength(50);
    expect(ok.log).toHaveLength(500);
    expect(ok.log.at(-1)!.text).toBe('line 699');
    expect(ok.lastEvents).toEqual([{ kind: 'roll', seat: 0, dice: [3], total: 3 }, { kind: 'gameOver', winner: null, tied: [0, 1], reason: null }]);
  });
});

describe('journals that do not belong to the game', () => {
  it('a new host does not take a journal of the right length that leads somewhere else', async () => {
    const { host, me, bea } = await two();
    await playUntil(host, [me, bea.client], g => g.round >= 2 && g.phase === 'roll' && g.pendingMineIds.length === 0);
    const room = bea.client.room!;
    const journal = bea.client.journal!;
    // Same seed, same length, but the last move is another legal one: it leads to another game.
    journal.moves[journal.moves.length - 1] = otherMove(journal, room.seq - 1);
    host.dispose();
    await settle();
    const next = promoteToHost(room, 1, { hostToken: 'tok-bea-0123456789', scheduler: new ManualScheduler(), journal });
    expect(journalFrom(next.journal!)).toBe(room.seq); // started afresh from the room's position
    next.dispose();
  }, 60_000);

  it('a device whose own beginning differs further back than the overlap keeps a journal from here on', async () => {
    const { host, me, bea } = await two();
    await playUntil(host, [me, bea.client], g => g.round >= 3);
    // Bea's copy differs at an early move (the overlap with the host only covers the last ones).
    const priv = bea.client as unknown as { moveJournal: JournalData };
    const k = priv.moveJournal.moves.findIndex(m => m.type === 'PLACE_PIECE');
    priv.moveJournal.moves[k] = otherMove(priv.moveJournal, k);
    bea.hostEnd.close();
    await settle();
    rejoin(host, bea);
    for (let n = 0; n < 4; n++) await settle();
    expect(bea.client.journalCurrent).toBe(true);
    expect(bea.client.journalStart).toBe(host.room.seq);
    host.dispose();
  }, 60_000);
});

describe('storage that fills up', () => {
  /** A store that refuses durable writes beyond `quota` characters in total. */
  function quotaStore(quota: number): SaveStore & { size(): number } {
    const m = memoryStore();
    const size = (): number => m.keys().reduce((n, k) => n + (m.get(k)?.length ?? 0), 0);
    return {
      ...m,
      size,
      tryPersist(k, v): boolean {
        if (size() - (m.get(k)?.length ?? 0) + v.length > quota) return false;
        m.set(k, v);
        return true;
      },
    };
  }

  it('gives up older journals for the save, and says when even then the save cannot be stored', async () => {
    const { host, bea } = await two();
    const room = host.room;
    const saveLen = serializeSaveFile(toSave(room, { savedAt: 1, app: 't' })).length;
    const store = quotaStore(saveLen + 5000);
    for (let i = 0; i < 4; i++) store.set(journalKey(`OLD${i}X`), 'j'.repeat(4000));
    expect(writeSave(store, room, { savedAt: 1, app: 't' })).toBe(true);
    expect(store.get(saveKey(room.code))).not.toBeNull();
    expect(store.keys().filter(k => k.startsWith('fs.journal.')).length).toBeLessThan(4);
    // Too small for the save itself: false, and the save is kept for this page only.
    const tiny = quotaStore(100);
    expect(writeSave(tiny, room, { savedAt: 1, app: 't' })).toBe(false);
    // The client session reports it, for the interface to warn the player: Bea's device is full.
    bea.hostEnd.close();
    await settle();
    const full = join(host, 'Bea', 'tok-bea-0123456789', tiny);
    await settle();
    await settle();
    expect(full.client.seat).toBe(1);
    expect(full.client.storageFailed).toBe(true);
    host.dispose();
  }, 60_000);

  it('keeps the journals of the five newest saved games only', async () => {
    const store = memoryStore();
    const { host, me, bea } = await two();
    for (let i = 0; i < 8; i++) {
      const code = `OLD${String.fromCharCode(65 + i)}Q`;
      store.set(saveKey(code), serializeSaveFile(toSave({ ...host.room, code }, { savedAt: 100 + i, app: 't' })));
      store.set(journalKey(code), '{}');
    }
    const watcher = join(host, 'Bea', 'tok-bea-0123456789', store);
    await settle();
    await playUntil(host, [me, watcher.client], g => g.round >= 2);
    watcher.client.flushJournal();
    const journals = store.keys().filter(k => k.startsWith('fs.journal.'));
    expect(journals).toContain(journalKey(host.room.code));
    expect(journals.length).toBeLessThanOrEqual(JOURNALS_KEPT + 1);
    void bea;
    host.dispose();
  }, 60_000);
});

describe('journal requests are limited', () => {
  it('only players may ask, at most once every 5 s per connection; a refused client asks again later', async () => {
    const game = findState(2, s => s.round >= 2);
    const room = playingRoom(game, [{ kind: 'human', name: 'Ann' }, { kind: 'human', name: 'Bea' }], 0, { ...QUIET, awayPolicy: 'wait' });
    const sched = new ManualScheduler();
    const host = new HostSession({ code: 'ROOMA', hostName: 'Ann', hostToken: 'tok-ann-0123456789', room, mode: 'takeover', hostSeat: 0, scheduler: sched });
    const answers: { t: string; error?: { code: string } }[] = [];
    const [h, c] = memoryPair();
    host.accept(h);
    c.onmessage = (m): void => { const t = (m as { t: string }).t; if (t === 'journal' || t === 'nope') answers.push(m as never); };
    c.send({ t: 'hello', v: 1, name: 'Visitor', token: 'tok-visitor-0123456789' });
    await settle();
    c.send({ t: 'journal', seed: game.seed, have: null, id: 'v1' });
    await settle();
    expect(answers).toMatchObject([{ t: 'nope', error: { code: 'NO_SEAT' } }]);

    // Bea, a player: her own request is the second within 5 s, so it is refused; she asks again later.
    const [h2, c2] = memoryPair();
    host.accept(h2);
    const beaClient = new ClientSession(c2, { name: 'Bea', token: 'tok-bea-0123456789', scheduler: sched, now: (): number => sched.now() });
    c2.send({ t: 'journal', seed: game.seed, have: null, id: 'early' });
    await settle();
    await settle();
    expect(beaClient.journalCurrent).toBe(false);
    await sched.advance(5000);
    await settle();
    expect(beaClient.journalCurrent).toBe(true);
    host.dispose();
  }, 60_000);
});

describe('replays, old settings and errors', () => {
  it('a replay from the start checks its dice against the seeded stream', async () => {
    let s = createGame(5, 2);
    let dice = diceRngFromSeed(5);
    const j = fullJournal(5, 2);
    for (let n = 0; n < 120 && !s.gameOver; n++) {
      const actor = s.pendingFactoryOps[0]?.ownerId ?? activeSeat(s)!;
      let a: Action = greedy(s, actor as PlayerId);
      if (a.type === 'ROLL_DICE') { const [r, next] = rollDice(dice, s.mineCount); dice = next; a = { type: 'ROLL_DICE', rolls: r }; }
      s = (applyAction(s, a) as { ok: true; state: GameState }).state;
      j.moves.push(a);
    }
    const room = playingRoom(s, [{ kind: 'human', name: 'Ann' }, { kind: 'bot', name: 'Bot' }], 0);
    const good = await verifyReplay(makeReplay(room, j, { savedAt: 1, app: 't' }), { yieldEvery: 0 });
    expect(good.dice).toEqual({ status: 'ok', firstMismatch: null });
    const k = j.moves.findIndex(m => m.type === 'ROLL_DICE');
    const edited = { ...j, moves: [...j.moves] };
    edited.moves[k] = { type: 'ROLL_DICE', rolls: (j.moves[k] as unknown as { rolls: number[] }).rolls.map(d => (d % 6) + 1) };
    const bad = await verifyReplay(makeReplay(room, edited, { savedAt: 1, app: 't' }), { yieldEvery: 0 });
    expect(bad.dice).toEqual({ status: 'mismatch', firstMismatch: k + 1 });
    const part = await verifyReplay(makeReplay(room, { start: { state: s, seq: 120 }, moves: [] }, { savedAt: 1, app: 't' }), { yieldEvery: 0 });
    expect(part.dice.status).toBe('unchecked');
  });

  it('an old save with a pause of 0 and no bot speed resumes with Instant bots', () => {
    const game = findState(2, s => s.round >= 2);
    const room = playingRoom(game, [{ kind: 'human', name: 'Ann' }, { kind: 'bot', name: 'Bot' }], 0);
    const raw = JSON.parse(serializeSaveFile(toSave(room, { savedAt: 1, app: 't' }))) as { room: { settings: Record<string, unknown> } };
    raw.room.settings.botDelayMs = 0;
    delete raw.room.settings.botSpeed;
    const h = new HostSession({ code: 'NEWRM', hostName: 'Ann', hostToken: 'tok-ann-0123456789', room: parseSaveFile(JSON.stringify(raw)).room, mode: 'resume', scheduler: new ManualScheduler() });
    expect(h.room.settings.botSpeed).toBe('instant');
    h.dispose();
  });

  it('an interface listener that throws does not roll back a move everyone already received', async () => {
    const { host, me, bea } = await two();
    host.subscribe(() => { throw new Error('a broken listener'); });
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const g = host.room.game!;
      const seat = g.pendingFactoryOps[0]?.ownerId ?? activeSeat(g)!;
      const before = host.room.seq;
      expect((await [me, bea.client][seat]!.act(greedy(g, seat as PlayerId))).ok).toBe(true);
      await settle();
      expect(host.room.seq).toBe(before + 1);
      expect(bea.client.room!.seq).toBe(host.room.seq);
      expect(host.journal!.moves.length).toBe(host.room.seq);
    } finally {
      quiet.mockRestore();
    }
    host.dispose();
  }, 60_000);
});
