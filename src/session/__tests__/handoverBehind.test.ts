// Moves a new host never received. Seen over the real PeerJS service (N10 check): the old host's
// last broadcast reached some players but not the one who took over, so the new host's game is a
// move or more behind them. Each seat's own device makes its own lost moves again (a roll without
// dice: the host rolls them from the same point of the seeded stream, so the same dice come out),
// and devices wait for other seats' devices to do the same. Nothing is ever applied twice, nobody
// vouches for another seat's move, and the notice appears only when something could not be made
// again. See recovery.ts.

import { describe, it, expect } from 'vitest';
import type { Action } from '../../engine/actions';
import type { GameState, PlayerId } from '../../engine/state';
import { legalActions } from '../../engine';
import { chooseAction as greedy } from '../../bots/greedyBot';
import type { RoomSettings } from '../room';
import { activeSeat } from '../room';
import { ClientSession, promoteToHost } from '../clientSession';
import { memoryPair } from '../memoryConn';
import type { HostSession } from '../hostSession';
import { journalEnd, journalFrom, replayTo } from '../journal';
import { RECOVERY_WAIT_MS, sameAction } from '../recovery';
import type { Joined } from './helpers';
import { ManualScheduler, newLobby, rejoin, settle } from './helpers';
import { rollbackText } from '../../app/controller';
import { RECOVERY_DEADLINE_MS } from '../clientSession';

// Seed 4 gives the turn order Cy, Bea, Ann, Dee: Dee plays just before Cy.
const SEED = 4;
const ANN = 0, BEA = 1, CY = 2, DEE = 3;

interface Table { host: HostSession; sched: ManualScheduler; me: ClientSession; bea: Joined; cy: Joined; dee: Joined }

async function table(settings: Partial<RoomSettings> = {}): Promise<Table> {
  const { host, me, sched } = await newLobby({
    settings: { playerCount: 4, factoryOpTimeoutMs: 0, roundEndTimeoutMs: 0, botDelayMs: 0, awayPolicy: 'wait', ...settings },
    randomSeed: () => SEED,
  });
  // Every device on the test's clock (the 10 s wait is a timer).
  const bea = joinOn(host, sched, 'Bea', 'tok-bea-0123456789');
  const cy = joinOn(host, sched, 'Cy', 'tok-cy-0123456789xx');
  const dee = joinOn(host, sched, 'Dee', 'tok-dee-0123456789x');
  await settle();
  for (const c of [me, bea.client, cy.client, dee.client]) expect((await c.setReady(true)).ok).toBe(true);
  expect((await me.start()).ok).toBe(true);
  await settle();
  expect(host.room.game!.turnOrder).toEqual([CY, BEA, ANN, DEE]); // round 1; the order turns each round
  return { host, sched, me, bea, cy, dee };
}

function joinOn(host: HostSession, sched: ManualScheduler, name: string, token: string): Joined {
  const [hostEnd, clientEnd] = memoryPair();
  host.accept(hostEnd);
  const client = new ClientSession(clientEnd, { name, token, scheduler: sched, now: (): number => sched.now() });
  return { client, hostEnd, clientEnd };
}

const clients = (t: Table): ClientSession[] => [t.me, t.bea.client, t.cy.client, t.dee.client];
const actor = (g: GameState): number => g.pendingFactoryOps[0]?.ownerId ?? activeSeat(g)!;

/** One move by whoever must act, through their own device (greedy, unless `choose` says otherwise). */
async function playOne(t: Table, choose?: (g: GameState, seat: number) => Action): Promise<{ seat: number; action: Action }> {
  const g = t.host.room.game!;
  const seat = actor(g);
  const action = choose ? choose(g, seat) : greedy(g, seat as PlayerId);
  const res = await clients(t)[seat]!.act(action);
  if (!res.ok) throw new Error(`${res.error.code} ${res.error.message}`);
  await settle();
  return { seat, action };
}

async function playUntil(t: Table, pred: (g: GameState) => boolean): Promise<void> {
  for (let n = 0; n < 3000 && !pred(t.host.room.game!); n++) await playOne(t);
  expect(pred(t.host.room.game!)).toBe(true);
}

/** Bea stops hearing the host; the given moves are made (Bea hears none of them). */
async function lose(t: Table, n: number, choose?: (g: GameState, seat: number) => Action): Promise<{ seat: number; action: Action }[]> {
  t.bea.clientEnd.dropIncoming = true;
  const out = [];
  for (let i = 0; i < n; i++) out.push(await playOne(t, choose));
  return out;
}

/** The host's tab closes; Bea (one or more moves behind) takes over; the given players come back. */
/** How the new host answers journal requests, for the tests of hosts that cannot help. */
type JournalAnswer = (conn: { send(m: unknown): void }, msg: { id?: string }) => void;

async function handOver(t: Table, back: Joined[], answer?: JournalAnswer): Promise<{ next: HostSession; sched: ManualScheduler }> {
  t.host.dispose();
  await settle();
  const sched = t.sched;
  const next = promoteToHost(t.bea.client.room!, BEA, { hostToken: 'tok-bea-0123456789', scheduler: sched, journal: t.bea.client.journal });
  if (answer) (next as unknown as { sendJournal: (c: unknown, m: unknown, id: string | null) => void }).sendJournal = (c, m): void => answer(c as { send(m: unknown): void }, m as { id?: string });
  t.bea.client.reattach(next.connectLocal());
  for (const j of back) rejoin(next, j);
  for (let i = 0; i < 4; i++) await settle();
  return { next, sched };
}

/** Every listed device holds the host's journal, and it replays to the host's game. */
function expectSameGame(next: HostSession, devices: ClientSession[]): void {
  const j = next.journal!;
  expect(journalFrom(j)).toBe(0);
  expect(journalEnd(j)).toBe(next.room.seq);
  expect(replayTo(j, next.room.seq)).toEqual(next.room.game);
  for (const d of devices) {
    expect(d.room!.seq).toBe(next.room.seq);
    expect(d.journal).toEqual(j);
  }
}

describe('moves a new host never received', () => {
  it('own move lost and made again silently; the move in flight then goes through; nothing twice', async () => {
    const t = await table();
    await playUntil(t, g => activeSeat(g) === CY && g.phase === 'placePiece' && g.pendingFactoryOps.length === 0);
    const s = t.host.room.seq;
    const [lostMove] = await lose(t, 1);
    expect(lostMove!.seat).toBe(CY);
    // Cy presses Roll just as the host's tab closes: the host never gets it.
    t.cy.hostEnd.dropIncoming = true;
    const rolled = t.cy.client.act({ type: 'ROLL_DICE', rolls: [] });
    await settle();
    expect(t.cy.client.pending).not.toBeNull();
    const { next } = await handOver(t, [t.cy, t.dee]);
    expect(await rolled).toEqual({ ok: true });
    for (let i = 0; i < 3; i++) await settle();
    expect(next.room.seq).toBeGreaterThanOrEqual(s + 2);
    const moves = next.journal!.moves;
    expect(sameAction(moves[s]!, lostMove!.action)).toBe(true);    // the lost move, made again
    expect(moves[s + 1]!.type).toBe('ROLL_DICE');                   // then the roll that was in flight
    expect(t.cy.client.takeRollback()).toBeNull();                   // all recovered: no notice
    expect(t.cy.client.pending).toBeNull();
    // The re-sent move was taken as new (a fresh move id) and the per-seat id list stays short.
    expect(next.room.recent.filter(r => r.seat === CY).length).toBeLessThanOrEqual(4);
    expectSameGame(next, [t.bea.client, t.cy.client, t.dee.client]);
    next.dispose();
  }, 60_000);

  it('two own moves lost (a piece and a roll): made again, with the very same dice', async () => {
    const t = await table();
    await playUntil(t, g => activeSeat(g) === CY && g.phase === 'placePiece' && g.pendingFactoryOps.length === 0);
    const s = t.host.room.seq;
    const lost = await lose(t, 2);
    expect(lost.map(m => m.seat)).toEqual([CY, CY]);
    expect(lost[1]!.action.type).toBe('ROLL_DICE');
    const original = t.cy.client.journal!.moves.slice(s, s + 2);
    const { next } = await handOver(t, [t.cy, t.dee]);
    for (let i = 0; i < 3; i++) await settle();
    expect(next.room.seq).toBe(s + 2);
    expect(next.journal!.moves.slice(s, s + 2)).toEqual(original);  // dice included
    expect(t.cy.client.takeRollback()).toBeNull();
    expectSameGame(next, [t.bea.client, t.cy.client, t.dee.client]);
    next.dispose();
  }, 60_000);

  it('another seat\'s lost move is made again by that seat\'s device, then this device continues', async () => {
    const t = await table();
    await playUntil(t, g => activeSeat(g) === DEE && g.pendingFactoryOps.length === 0 && g.phase === 'placeMeeple' && g.turnOrder[g.activePlayerIndex + 1] === CY);
    const s = t.host.room.seq;
    const lost = await lose(t, 3);
    expect(lost.map(m => m.seat)).toEqual([DEE, DEE, CY]);
    const { next } = await handOver(t, [t.cy, t.dee]);
    for (let i = 0; i < 4; i++) await settle();
    expect(next.room.seq).toBe(s + 3);
    expect(t.cy.client.takeRollback()).toBeNull();
    expect(t.dee.client.takeRollback()).toBeNull();
    expectSameGame(next, [t.bea.client, t.cy.client, t.dee.client]);
    next.dispose();
  }, 60_000);

  it('another seat\'s lost move whose device never comes back: after 10 s the notice, and the game goes on', async () => {
    const t = await table();
    await playUntil(t, g => activeSeat(g) === DEE && g.pendingFactoryOps.length === 0 && g.phase === 'placeMeeple' && g.turnOrder[g.activePlayerIndex + 1] === CY);
    const s = t.host.room.seq;
    await lose(t, 3);
    const { next, sched } = await handOver(t, [t.cy]); // Dee's tab closed too
    expect(next.room.seq).toBe(s);
    // Cy waits for Dee's move, showing a move in flight, and makes no new move meanwhile.
    expect(t.cy.client.pending?.recovery).toBe('wait');
    expect(await t.cy.client.act({ type: 'END_TURN' })).toMatchObject({ ok: false, error: { code: 'BUSY' } });
    await sched.advance(RECOVERY_WAIT_MS - 1);
    expect(t.cy.client.takeRollback()).toBeNull();
    await sched.advance(1);
    expect(t.cy.client.takeRollback()).toEqual({ at: s, lost: 3 });
    expect(t.cy.client.pending).toBeNull();
    // The game goes on: the host gives Dee's seat to a bot.
    expect((await t.bea.client.setSeat(DEE, 'bot')).ok).toBe(true);
    await sched.flushDue();
    await settle();
    expect(next.room.seq).toBeGreaterThan(s);
    expect(t.cy.client.journal).toEqual(next.journal);
    next.dispose();
  }, 60_000);

  it('a bot moves first at that position with a different move: the notice', async () => {
    const t = await table({ awayPolicy: 'bot', awayGraceMs: 0 });
    await playUntil(t, g => activeSeat(g) === DEE && g.phase === 'placePiece' && g.pendingFactoryOps.length === 0);
    const s = t.host.room.seq;
    // Dee places a piece somewhere the bot would not.
    const [lost] = await lose(t, 1, (g, seat) => {
      const best = greedy(g, seat as PlayerId);
      return legalActions(g, seat as PlayerId).find(a => !sameAction(a, best)) ?? best;
    });
    expect(lost!.seat).toBe(DEE);
    const { next, sched } = await handOver(t, [t.cy]); // Dee does not come back; a bot plays Dee's seat
    await sched.flushDue();
    for (let i = 0; i < 3; i++) await settle();
    expect(next.room.seq).toBeGreaterThan(s);
    expect(sameAction(next.journal!.moves[s]!, lost!.action)).toBe(false);
    // Cy had seen Dee's own move; the game went another way: told once, with the right count.
    const told = t.cy.client.takeRollback()!;
    expect(told).toEqual({ at: s, lost: 1 });
    expect(rollbackText(told)).toBe(`The new host had not received a move seen on this device after move ${s}, so the game went on without it. Make your move again if still allowed.`);
    expect(t.cy.client.takeRollback()).toBeNull();
    expect(t.cy.client.journal).toEqual(next.journal);
    next.dispose();
  }, 60_000);

  it('the lost move was the old host\'s own: nobody can make it again, so the notice', async () => {
    const t = await table();
    await playUntil(t, g => activeSeat(g) === ANN && g.pendingFactoryOps.length === 0);
    const s = t.host.room.seq;
    const [lost] = await lose(t, 1);
    expect(lost!.seat).toBe(ANN);
    const { next, sched } = await handOver(t, [t.cy, t.dee]);
    expect(t.cy.client.pending?.recovery).toBe('wait');
    await sched.advance(RECOVERY_WAIT_MS);
    expect(t.cy.client.takeRollback()).toEqual({ at: s, lost: 1 });
    expect(t.dee.client.takeRollback()).toEqual({ at: s, lost: 1 });
    expect(next.room.seq).toBe(s);
    expectSameGame(next, [t.bea.client, t.cy.client, t.dee.client]);
    next.dispose();
  }, 60_000);

  for (const [what, answer] of [
    ['refuses the journal request (an older host)', (c, m): void => c.send({ t: 'nope', id: m.id ?? null, error: { code: 'BAD_MESSAGE', message: 'That message was not understood.' } })],
    ['has no journal', (c, m): void => c.send({ t: 'journal', re: m.id })],
    ['answers with a journal that cannot be read', (c, m): void => c.send({ t: 'journal', re: m.id, from: 'x', moves: 7 })],
  ] as [string, JournalAnswer][]) {
    it(`a new host that ${what}: recovery ends with the notice, and input is free`, async () => {
      const t = await table();
      await playUntil(t, g => activeSeat(g) === CY && g.phase === 'placePiece' && g.pendingFactoryOps.length === 0);
      const s = t.host.room.seq;
      await lose(t, 1);
      const { next } = await handOver(t, [t.cy, t.dee], answer);
      for (let i = 0; i < 3; i++) await settle();
      expect(t.cy.client.takeRollback()).toEqual({ at: s, lost: 1 });
      expect(t.cy.client.pending).toBeNull();
      expect(t.cy.client.journalStart).toBe(s); // a journal from the host's position on
      const g = next.room.game!;
      expect((await t.cy.client.act(greedy(g, CY as PlayerId))).ok).toBe(true);
      next.dispose();
    }, 60_000);
  }

  it('a new host that never answers: recovery ends after the 30 s deadline, and input is free', async () => {
    const t = await table();
    await playUntil(t, g => activeSeat(g) === CY && g.phase === 'placePiece' && g.pendingFactoryOps.length === 0);
    const s = t.host.room.seq;
    await lose(t, 1);
    const { next, sched } = await handOver(t, [t.cy, t.dee], () => undefined);
    expect(t.cy.client.pending?.recovery).toBe('wait');
    expect(await t.cy.client.act({ type: 'END_TURN' })).toMatchObject({ ok: false, error: { code: 'BUSY' } });
    await sched.advance(RECOVERY_DEADLINE_MS - 1);
    expect(t.cy.client.pending?.recovery).toBe('wait');
    await sched.advance(1);
    expect(t.cy.client.takeRollback()).toEqual({ at: s, lost: 1 });
    expect(t.cy.client.pending).toBeNull();
    next.dispose();
  }, 60_000);

  it('a device keeps its own beginning when the new host only has a journal from later on', async () => {
    const t = await table();
    await playUntil(t, g => g.round >= 2 && activeSeat(g) === CY && g.phase === 'placePiece');
    const s = t.host.room.seq;
    // The host's tab closes; Bea takes over without any journal (from a save link, say).
    t.host.dispose();
    await settle();
    const next = promoteToHost(t.bea.client.room!, BEA, { hostToken: 'tok-bea-0123456789', scheduler: t.sched, journal: null });
    expect(journalFrom(next.journal!)).toBe(s);
    t.bea.client.reattach(next.connectLocal());
    rejoin(next, t.cy);
    for (let i = 0; i < 4; i++) await settle();
    // Cy's journal still starts at the beginning of the game, and goes on with the host's moves.
    expect(t.cy.client.journalStart).toBe(0);
    expect(t.cy.client.journalCurrent).toBe(true);
    expect(t.cy.client.takeRollback()).toBeNull();
    next.dispose();
  }, 60_000);
});
