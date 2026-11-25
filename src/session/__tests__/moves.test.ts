import { describe, it, expect } from 'vitest';
import type { GameState } from '../../engine/state';
import { chooseAction as greedy } from '../../bots/greedyBot';
import { legalActions } from '../../engine';
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
  const host = new HostSession({ code: 'ROOMA', hostName: 'Ann', hostToken: 'tok-ann-0123456789', room, mode: 'takeover', hostSeat, scheduler: sched });
  const ann = new ClientSession(host.connectLocal(), { name: 'Ann', token: 'tok-ann-0123456789' });
  const bea = join(host, 'Bea', 'tok-bea-0123456789').client;
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

  // RULES_CHANGES.md #45: what a player supplies through their input teleporter reaches the
  // engine, off-turn (the host stamps the owner) and in the round-end turn (the host drops the
  // owner field but keeps the supply).
  it('carries the supply through an input teleporter, off-turn and at round end', async () => {
    const found = findState(2, s => s.phase === 'actions' && s.pendingFactoryOps.length === 0);
    const active = activeSeat(found)!;
    const owner = (1 - active) as 0 | 1;
    const tpf: GameState['board'][number] = {
      id: 'tpf', type: 'plateFact', coord: { q: 60, r: 0 }, rotation: 0, claims: [{ ownerId: owner, controlModule: 9 }],
      input: { slots: [null], teleporterOwner: owner }, output: { slots: [null], teleporterOwner: null },
    };
    // The factory takes the place of a piece of the first stack, so the pieces still add up.
    const withOre = (g: GameState): GameState => ({
      ...g, board: [...g.board.filter(p => p.id !== 'tpf'), tpf],
      stacks: [{ ...g.stacks[0], pieces: g.stacks[0].pieces.slice(1) }, g.stacks[1], g.stacks[2]],
      players: g.players.map(p => (p.id === owner ? { ...p, powerTokens: 5, inventory: { ore: 2, plate: 0, sphere: 0, tesseract: 0 } } : p)),
    });
    const offTurn: GameState = { ...withOre(found), pendingFactoryOps: [{ pieceId: 'tpf', ownerId: owner }] };
    const a = await twoHumans(offTurn, active); // Bea owns the activation
    expect(await a.bea.act({ type: 'OPERATE_BUILDING', pieceId: 'tpf', supply: ['ore'] })).toEqual({ ok: true });
    expect(a.host.room.game!.players[owner]!.inventory.ore).toBe(1);
    expect(a.host.room.log.at(-1)?.text).toMatch(/^Bea ran the Plate Factory.*, supplying 1 Ore through its teleporter$/);

    const roundEnd: GameState = withOre({
      ...found, phase: 'roundEnd', activePlayerIndex: found.turnOrder.indexOf(owner),
      players: found.players.map(p => (p.id === owner ? { ...p, meepleOnPieceId: 'tpf', meepleSlotIndex: null, meepleOperatedThisRound: false } : p)),
    });
    const b = await twoHumans(roundEnd, active);
    expect(await b.bea.act({ type: 'OPERATE_BUILDING', pieceId: 'tpf', ownerId: owner, supply: ['ore'] })).toEqual({ ok: true });
    expect(b.host.room.game!.board.find(p => p.id === 'tpf')!.output!.slots).toEqual(['plate']);
    expect(b.host.room.game!.players[owner]!.inventory.ore).toBe(1);
  });

  it('acknowledges a repeated move id without applying it twice', async () => {
    const game = findState(2, s => s.phase === 'placePiece');
    const active = activeSeat(game)!;
    const sched = new ManualScheduler();
    const room = playingRoom(game, [{ kind: 'human', name: 'Ann' }, { kind: 'human', name: 'Bea' }], 1 - active, NO_TIMERS);
    const host = new HostSession({ code: 'ROOMA', hostName: 'Ann', hostToken: 'tok-ann-0123456789', room, mode: 'takeover', hostSeat: 1 - active, scheduler: sched });
    const [hostEnd, raw] = memoryPair();
    host.accept(hostEnd);
    const got: HostMsg[] = [];
    raw.onmessage = (m): void => { got.push(m as HostMsg); };
    raw.send({ t: 'hello', v: PROTOCOL, name: 'Bea', token: 'tok-bea-0123456789' });
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

describe('recorded moves and stale re-sends', () => {
  /** A 2-player room in an actions phase where the active player can lay and lift belts at will. */
  async function beltRoom(): Promise<{ host: HostSession; active: number; other: number; raw: (msg: unknown) => void; got: HostMsg[]; ann: ClientSession }> {
    const game = findState(2, s => s.phase === 'actions' && s.pendingFactoryOps.length === 0
      && legalActions(s, activeSeat(s)!).some(a => a.type === 'PLACE_BELT'));
    const active = activeSeat(game)!;
    const other = 1 - active;
    const sched = new ManualScheduler();
    const names = active === 0 ? ['Ann', 'Bea'] : ['Bea', 'Ann'];
    const room = playingRoom(game, names.map(name => ({ kind: 'human' as const, name })), active, NO_TIMERS);
    // Bea's earlier move is on record.
    const host = new HostSession({ code: 'ROOMA', hostName: 'Ann', hostToken: 'tok-ann-0123456789', room: { ...room, recent: [{ seat: other, id: 'bea-move-1' }] }, mode: 'takeover', hostSeat: active, scheduler: sched });
    const ann = new ClientSession(host.connectLocal(), { name: 'Ann', token: 'tok-ann-0123456789' });
    const [hostEnd, beaEnd] = memoryPair();
    host.accept(hostEnd);
    const got: HostMsg[] = [];
    beaEnd.onmessage = (m): void => { got.push(m as HostMsg); };
    beaEnd.send({ t: 'hello', v: PROTOCOL, name: 'Bea', token: 'tok-bea-0123456789' });
    await settle();
    return { host, active, other, raw: m => beaEnd.send(m), got, ann };
  }

  it('remembers each seat\'s recent moves no matter how many moves others make', async () => {
    const { host, active, other, raw, got, ann } = await beltRoom();
    for (let i = 0; i < 20; i++) {
      const g = host.room.game!;
      const place = legalActions(g, active as 0 | 1).find(a => a.type === 'PLACE_BELT')!;
      expect(await ann.act(place)).toEqual({ ok: true });
      const belt = host.room.game!.belts.at(-1)!;
      expect(await ann.act({ type: 'REMOVE_BELT', beltId: belt.id })).toEqual({ ok: true });
    }
    expect(host.room.seq).toBe(40);
    expect(host.room.recent.filter(r => r.seat === active)).toHaveLength(4);
    expect(host.room.recent).toContainEqual({ seat: other, id: 'bea-move-1' });

    got.length = 0;
    raw({ t: 'act', id: 'bea-move-1', action: { type: 'END_ACTIONS' }, seq: 0, resend: true });
    await settle();
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ t: 'room', re: 'bea-move-1' }); // acknowledged, not applied, not refused
    expect(host.room.seq).toBe(40);
  });

  it('refuses a re-sent move as stale once the game has moved on, and applies nothing', async () => {
    const { host, active, raw, got, ann } = await beltRoom();
    const place = legalActions(host.room.game!, active as 0 | 1).find(a => a.type === 'PLACE_BELT')!;
    expect(await ann.act(place)).toEqual({ ok: true });
    const before = JSON.stringify(host.room);
    got.length = 0;
    raw({ t: 'act', id: 'bea-move-2', action: { type: 'END_ACTIONS' }, seq: 0, resend: true });
    await settle();
    expect(got).toEqual([{ t: 'nope', id: 'bea-move-2', error: { code: 'STALE', message: 'The game moved on; that move was not applied.' } }]);
    expect(JSON.stringify(host.room)).toBe(before);
  });

  it('does not refuse a first send for an older seq (off-turn answers race with other moves)', async () => {
    const game = findState(2, s => s.phase === 'actions' && s.pendingFactoryOps.some(e => e.ownerId !== activeSeat(s)));
    const active = activeSeat(game)!;
    const entry = game.pendingFactoryOps.find(e => e.ownerId !== active)!;
    const { host } = await twoHumans(game, active);
    const [hostEnd, raw] = memoryPair();
    host.accept(hostEnd);
    const got: HostMsg[] = [];
    raw.onmessage = (m): void => { got.push(m as HostMsg); };
    raw.send({ t: 'hello', v: PROTOCOL, name: 'Bea', token: 'tok-bea-0123456789' }); // replaces Bea's first connection
    raw.send({ t: 'act', id: 'late-answer', action: { type: 'SKIP_FACTORY_ROLL', pieceId: entry.pieceId }, seq: host.room.seq - 5 });
    await settle();
    expect(got.some(m => m.t === 'nope')).toBe(false);
    expect(host.room.recent).toContainEqual({ seat: entry.ownerId, id: 'late-answer' });
  });

  it('sends a refusal only to the sender', async () => {
    const game = findState(2, s => s.phase === 'actions' && s.pendingFactoryOps.length === 0);
    const active = activeSeat(game)!;
    const { host, ann, bea } = await twoHumans(game, 1 - active); // Ann is not active
    let beaHeard = 0;
    bea.subscribe(() => { beaHeard++; });
    const seq = host.room.seq;
    expect(await ann.act({ type: 'END_ACTIONS' })).toMatchObject({ ok: false, error: { code: 'NOT_YOUR_TURN' } });
    expect(await ann.act({ type: 'PLACE_BELT', pieceId: 'nope', fromPoint: 0, toPoint: 6 })).toMatchObject({ ok: false });
    await settle();
    expect(beaHeard).toBe(0);
    expect(host.room.seq).toBe(seq);
  });

  it('never runs a bot for a connected player who is not on autopilot', async () => {
    const game = findState(3, s => s.phase === 'placePiece');
    const active = activeSeat(game)!;
    const sched = new ManualScheduler();
    const seats = [0, 1, 2].map(i => (i === active ? { kind: 'human' as const, name: 'Bea' } : { kind: 'bot' as const, name: `Bot ${i}` }));
    const hostSeat = active;
    seats[hostSeat] = { kind: 'human', name: 'Bea' };
    for (const delay of [0, 300]) {
      const room = playingRoom(game, seats, hostSeat, { ...NO_TIMERS, botDelayMs: delay });
      const host = new HostSession({ code: 'ROOMA', hostName: 'Bea', hostToken: 'tok-bea-0123456789', room, mode: 'takeover', hostSeat, scheduler: sched });
      new ClientSession(host.connectLocal(), { name: 'Bea', token: 'tok-bea-0123456789' });
      await settle();
      await sched.advance(60_000);
      expect(host.room.seq).toBe(0);
      expect(activeSeat(host.room.game)).toBe(active);
      host.dispose();
    }
  });
});

describe('re-sending a move across a reconnect', () => {
  async function startTwoPlayer(): Promise<{ host: HostSession; ann: ClientSession; bea: ReturnType<typeof join> }> {
    const { host, me } = await newLobby({ settings: { playerCount: 2, ...NO_TIMERS } });
    const bea = join(host, 'Bea', 'tok-bea-0123456789');
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
