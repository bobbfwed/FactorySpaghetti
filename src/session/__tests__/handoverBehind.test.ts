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
async function handOver(t: Table, back: Joined[]): Promise<{ next: HostSession; sched: ManualScheduler }> {
  t.host.dispose();
  await settle();
  const sched = t.sched;
  const next = promoteToHost(t.bea.client.room!, BEA, { hostToken: 'tok-bea-0123456789', scheduler: sched, journal: t.bea.client.journal });
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
    expect(t.cy.client.takeRollback()).toEqual({ from: s + 3, to: s });
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
    // Cy had seen Dee's own move; the game went another way: told once.
    expect(t.cy.client.takeRollback()).toMatchObject({ from: s + 1 });
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
    expect(t.cy.client.takeRollback()).toEqual({ from: s + 1, to: s });
    expect(t.dee.client.takeRollback()).toEqual({ from: s + 1, to: s });
    expect(next.room.seq).toBe(s);
    expectSameGame(next, [t.bea.client, t.cy.client, t.dee.client]);
    next.dispose();
  }, 60_000);
});
