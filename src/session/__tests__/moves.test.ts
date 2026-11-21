import { describe, it, expect } from 'vitest';
import type { GameState } from '../../engine/state';
import { chooseAction as greedy } from '../../bots/greedyBot';
import { HostSession } from '../hostSession';
import { ClientSession } from '../clientSession';
import { activeSeat } from '../room';
import { rollDice } from '../dice';
import { memoryPair } from '../memoryConn';
import type { HostMsg } from '../protocol';
import { PROTOCOL } from '../protocol';
import { ManualScheduler, driveHumans, findState, join, newLobby, playingRoom, rejoin, settle } from './helpers';

const NO_TIMERS = { factoryOpTimeoutMs: 0, roundEndTimeoutMs: 0, awayPolicy: 'wait' as const, botDelayMs: 0 };

/** A 2-player room around `game`, hosted by seat `hostSeat` ("Ann"), with "Bea" in the other seat. */
async function twoHumans(game: GameState, hostSeat: number): Promise<{ host: HostSession; ann: ClientSession; bea: ClientSession; sched: ManualScheduler }> {
  const sched = new ManualScheduler();
  const names = hostSeat === 0 ? ['Ann', 'Bea'] : ['Bea', 'Ann'];
  const room = playingRoom(game, names.map(name => ({ kind: 'human' as const, name })), hostSeat, NO_TIMERS);
  const host = new HostSession({ code: 'ROOMA', hostName: 'Ann', hostToken: 'tok-ann', room, mode: 'takeover', hostSeat, scheduler: sched });
  const ann = new ClientSession(host.connectLocal(), { name: 'Ann', token: 'tok-ann' });
  const bea = join(host, 'Bea', 'tok-bea').client;
  await settle();
  expect(ann.seat).toBe(hostSeat);
  expect(bea.seat).toBe(1 - hostSeat);
  return { host, ann, bea, sched };
}

describe('moves', () => {
  it('rolls the dice itself: a client cannot choose its own dice', async () => {
    const game = findState(2, s => s.phase === 'roll' && s.mineCount >= 1);
    const active = activeSeat(game)!;
    const { host, bea } = await twoHumans(game, 1 - active); // Bea is the active player
    const before = host.room;
    const [expected, nextRng] = rollDice(before.diceRng, game.mineCount);
    const chosen = expected.map(d => (d === 6 ? 1 : 6));

    const res = await bea.act({ type: 'ROLL_DICE', rolls: chosen });
    expect(res).toEqual({ ok: true });
    expect(host.room.game!.lastRoll).toEqual(expected);
    expect(host.room.game!.lastRoll).not.toEqual(chosen);
    expect(host.room.diceRng).toBe(nextRng);
    expect(host.room.seq).toBe(before.seq + 1);
    const roll = host.room.lastEvents.find(e => e.kind === 'roll');
    expect(roll).toMatchObject({ kind: 'roll', seat: active, dice: expected });
    expect(host.room.log.at(-1)?.text).toMatch(/^Bea rolled /);
  });

  it('refuses a move from a seat whose turn it is not, and changes nothing', async () => {
    const game = findState(2, s => s.phase === 'actions' && s.pendingFactoryOps.length === 0);
    const active = activeSeat(game)!;
    const { host, ann } = await twoHumans(game, 1 - active); // Ann (the host) is NOT active
    const before = JSON.stringify(host.room);
    const res = await ann.act({ type: 'END_ACTIONS' });
    expect(res).toEqual({ ok: false, error: { code: 'NOT_YOUR_TURN', message: 'It is not your turn.' } });
    await settle();
    expect(JSON.stringify(host.room)).toBe(before);
  });

  it('lets the owner of an activated factory answer on someone else\'s turn, and only for themselves', async () => {
    const game = findState(2, s => s.phase === 'actions'
      && s.pendingFactoryOps.some(e => e.ownerId !== activeSeat(s)));
    const active = activeSeat(game)!;
    const owner = 1 - active;
    const entry = game.pendingFactoryOps.find(e => e.ownerId === owner)!;
    const { host, ann, bea } = await twoHumans(game, active); // Ann active, Bea owns the activation

    // The active player cannot answer for the owner (the host stamps the sender as owner).
    const stolen = await ann.act({ type: 'SKIP_FACTORY_ROLL', pieceId: entry.pieceId, ownerId: owner as 0 | 1 });
    expect(stolen).toMatchObject({ ok: false, error: { code: 'NOT_PENDING' } });

    // The owner, off-turn, can — without even naming themselves.
    const seq = host.room.seq;
    const res = await bea.act({ type: 'OPERATE_BUILDING', pieceId: entry.pieceId });
    expect(res).toEqual({ ok: true });
    expect(host.room.seq).toBe(seq + 1);
    expect(host.room.game!.pendingFactoryOps.some(e => e.ownerId === owner && e.pieceId === entry.pieceId)).toBe(false);
    expect(host.room.lastEvents[0]).toMatchObject({ kind: 'operated', seat: owner, pieceId: entry.pieceId });

    // Any other move from the off-turn owner is still refused.
    expect(await bea.act({ type: 'END_ACTIONS' })).toMatchObject({ ok: false, error: { code: 'NOT_YOUR_TURN' } });
  });

  it('acknowledges a repeated move id without applying it twice', async () => {
    const game = findState(2, s => s.phase === 'placePiece');
    const active = activeSeat(game)!;
    const sched = new ManualScheduler();
    const room = playingRoom(game, [{ kind: 'human', name: 'Ann' }, { kind: 'human', name: 'Bea' }], 1 - active, NO_TIMERS);
    const host = new HostSession({ code: 'ROOMA', hostName: 'Ann', hostToken: 'tok-ann', room, mode: 'takeover', hostSeat: 1 - active, scheduler: sched });
    const [hostEnd, raw] = memoryPair();
    host.accept(hostEnd);
    const got: HostMsg[] = [];
    raw.onmessage = (m): void => { got.push(m as HostMsg); };
    raw.send({ t: 'hello', v: PROTOCOL, name: 'Bea', token: 'tok-bea' });
    const action = greedy(game, active);
    raw.send({ t: 'act', id: 'move-1', action });
    raw.send({ t: 'act', id: 'move-1', action });
    await settle();
    expect(host.room.seq).toBe(1);
    expect(host.room.recent).toEqual([{ seat: active, id: 'move-1' }]);
    const replies = got.filter(m => m.t === 'room');
    expect(replies).toHaveLength(2);
    expect(replies.every(m => m.t === 'room' && m.re === 'move-1' && m.room.seq === 1)).toBe(true);
    expect(got.some(m => m.t === 'nope')).toBe(false);
  });
});

describe('re-sending a move across a reconnect', () => {
  async function startTwoPlayer(): Promise<{ host: HostSession; ann: ClientSession; bea: ReturnType<typeof join> }> {
    const { host, me } = await newLobby({ settings: { playerCount: 2, ...NO_TIMERS } });
    const bea = join(host, 'Bea', 'tok-bea');
    await settle();
    await me.setReady(true);
    await bea.client.setReady(true);
    expect((await me.start()).ok).toBe(true);
    return { host, ann: me, bea };
  }

  it('a move applied by the host whose reply was lost is not applied again, and still resolves', async () => {
    const { host, ann, bea } = await startTwoPlayer();
    await driveHumans(host, { 0: ann, 1: bea.client }, r => activeSeat(r.game) === 1 && r.game!.pendingFactoryOps.length === 0);
    const seq = host.room.seq;

    bea.clientEnd.dropIncoming = true;            // the host's replies never arrive
    const result = bea.client.act(greedy(host.room.game!, 1));
    await settle();
    expect(host.room.seq).toBe(seq + 1);         // the host did apply it
    expect(bea.client.pending).not.toBeNull();   // but Bea does not know yet

    bea.clientEnd.close();
    await settle();
    expect(host.room.seats[1]!.connected).toBe(false);
    const again = rejoin(host, bea);
    await settle();
    expect(await result).toEqual({ ok: true });
    expect(bea.client.pending).toBeNull();
    expect(host.room.seq).toBe(seq + 1);         // not applied twice
    expect(host.room.seats[1]!.connected).toBe(true);
    expect(again.client.seat).toBe(1);
  });

  it('a move that never reached the host is sent again after reconnecting, and applied once', async () => {
    const { host, ann, bea } = await startTwoPlayer();
    await driveHumans(host, { 0: ann, 1: bea.client }, r => activeSeat(r.game) === 1 && r.game!.pendingFactoryOps.length === 0);
    const seq = host.room.seq;

    bea.clientEnd.dropOutgoing = true;           // the move is lost on the way
    const result = bea.client.act(greedy(host.room.game!, 1));
    await settle();
    expect(host.room.seq).toBe(seq);

    bea.clientEnd.close();
    await settle();
    rejoin(host, bea);
    expect(await result).toEqual({ ok: true });
    await settle();
    expect(host.room.seq).toBe(seq + 1);
    expect(host.room.recent.at(-1)).toMatchObject({ seat: 1 });
  });
});
