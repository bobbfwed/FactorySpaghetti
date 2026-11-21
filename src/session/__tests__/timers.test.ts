import { describe, it, expect } from 'vitest';
import type { GameState } from '../../engine/state';
import { legalActions } from '../../engine';
import { HostSession } from '../hostSession';
import { ClientSession } from '../clientSession';
import type { RoomSettings } from '../room';
import { activeSeat } from '../room';
import { ManualScheduler, findState, join, playingRoom, settle } from './helpers';

async function host2(game: GameState, hostSeat: number, settings: Partial<RoomSettings>): Promise<{ host: HostSession; ann: ClientSession; bea: ClientSession; sched: ManualScheduler }> {
  const sched = new ManualScheduler();
  const names = hostSeat === 0 ? ['Ann', 'Bea'] : ['Bea', 'Ann'];
  const room = playingRoom(game, names.map(name => ({ kind: 'human' as const, name })), hostSeat,
    { awayPolicy: 'wait', botDelayMs: 0, ...settings });
  const host = new HostSession({ code: 'ROOMA', hostName: 'Ann', hostToken: 'tok-ann-0123456789', room, mode: 'takeover', hostSeat, scheduler: sched });
  const ann = new ClientSession(host.connectLocal(), { name: 'Ann', token: 'tok-ann-0123456789', now: (): number => sched.now() });
  const bea = join(host, 'Bea', 'tok-bea-0123456789').client;
  await settle();
  return { host, ann, bea, sched };
}

// A roll on the active player's turn activated the other player's factory.
const offTurnState = (): GameState => findState(2, s => s.phase === 'actions'
  && s.pendingFactoryOps.some(e => e.ownerId !== activeSeat(s)));

// A round-end turn where the player has something to do besides ending it.
const roundEndState = (): GameState => findState(2, s => s.phase === 'roundEnd'
  && legalActions(s, activeSeat(s)!).some(a => a.type !== 'END_ACTIONS'));

describe('off-turn operate-or-skip timer', () => {
  it('answers for an off-turn owner who does not choose in time (operate when affordable)', async () => {
    const game = offTurnState();
    const active = activeSeat(game)!;
    const owner = 1 - active;
    const { host, ann, sched } = await host2(game, active, { factoryOpTimeoutMs: 8000, roundEndTimeoutMs: 0 });
    const start = sched.now();
    expect(host.room.opDeadline).toBe(start + 8000);
    expect(ann.msLeft(host.room.opDeadline)).toBe(8000);

    await sched.advance(7999);
    expect(host.room.game!.pendingFactoryOps.some(e => e.ownerId === owner)).toBe(true);
    expect(ann.msLeft(ann.room!.opDeadline)).toBe(1);

    await sched.advance(1);
    const g = host.room.game!;
    expect(g.pendingFactoryOps.some(e => e.ownerId === owner)).toBe(false);
    expect(host.room.opDeadline).toBeNull();
    expect(host.room.log.some(e => e.text === 'Bea did not choose in time.')).toBe(true);
    expect(host.room.log.some(e => e.seat === owner && /^Bea ran the /.test(e.text))).toBe(true);
    expect(host.room.lastEvents).toContainEqual({ kind: 'timeout', seat: owner, what: 'factory-op' });
  });

  it('does not run for the active player\'s own activations', async () => {
    const game = findState(2, s => s.phase === 'actions' && s.pendingFactoryOps.length > 0
      && s.pendingFactoryOps.every(e => e.ownerId === activeSeat(s)));
    const active = activeSeat(game)!;
    const { host, sched } = await host2(game, active, { factoryOpTimeoutMs: 8000, roundEndTimeoutMs: 0 });
    expect(host.room.opDeadline).toBeNull();
    const before = JSON.stringify(host.room.game);
    await sched.advance(10 * 60_000);
    expect(JSON.stringify(host.room.game)).toBe(before);
    expect(host.room.log.some(e => e.text.includes('did not choose'))).toBe(false);
  });

  it('does not run when disabled', async () => {
    const game = offTurnState();
    const active = activeSeat(game)!;
    const { host, sched } = await host2(game, active, { factoryOpTimeoutMs: 0, roundEndTimeoutMs: 0 });
    expect(host.room.opDeadline).toBeNull();
    const before = JSON.stringify(host.room.game);
    await sched.advance(10 * 60_000);
    expect(JSON.stringify(host.room.game)).toBe(before);
    expect(sched.pending).toBe(0);
  });

  it('is cancelled when the owner answers in time', async () => {
    const game = offTurnState();
    const active = activeSeat(game)!;
    const owner = 1 - active;
    const { host, bea, sched } = await host2(game, active, { factoryOpTimeoutMs: 8000, roundEndTimeoutMs: 0 });
    await sched.advance(5000);
    for (const e of host.room.game!.pendingFactoryOps.filter(p => p.ownerId === owner)) {
      expect(await bea.act({ type: 'SKIP_FACTORY_ROLL', pieceId: e.pieceId })).toEqual({ ok: true });
    }
    expect(host.room.opDeadline).toBeNull();
    const seq = host.room.seq;
    await sched.advance(60_000);
    expect(host.room.seq).toBe(seq);
    expect(host.room.log.some(e => e.text.includes('did not choose'))).toBe(false);
  });

  it('skips when running the factory is not affordable', async () => {
    const found = offTurnState();
    const owner = 1 - activeSeat(found)!;
    // The owner has spent their Power Tokens since the roll: operating is no longer possible.
    const game: GameState = { ...found, players: found.players.map(p => (p.id === owner ? { ...p, powerTokens: 0 } : p)) };
    const { host, sched } = await host2(game, activeSeat(game)!, { factoryOpTimeoutMs: 8000, roundEndTimeoutMs: 0 });
    await sched.advance(8000);
    expect(host.room.game!.pendingFactoryOps.some(e => e.ownerId === owner)).toBe(false);
    expect(host.room.log.some(e => e.seat === owner && /^Bea chose not to run the /.test(e.text))).toBe(true);
    expect(host.room.log.some(e => e.text === 'Bea did not choose in time.')).toBe(true);
    expect(host.room.game!.players[owner]!.powerTokens).toBe(0);
  });

  it('also answers for an owner who is away', async () => {
    const game = offTurnState();
    const active = activeSeat(game)!;
    const owner = 1 - active;
    const sched = new ManualScheduler();
    const room = playingRoom(game, active === 0
      ? [{ kind: 'human', name: 'Ann' }, { kind: 'human', name: 'Bea' }]
      : [{ kind: 'human', name: 'Bea' }, { kind: 'human', name: 'Ann' }], active,
    { awayPolicy: 'wait', botDelayMs: 0, factoryOpTimeoutMs: 8000, roundEndTimeoutMs: 0 });
    const host = new HostSession({ code: 'ROOMA', hostName: 'Ann', hostToken: 'tok-ann-0123456789', room, mode: 'takeover', hostSeat: active, scheduler: sched });
    new ClientSession(host.connectLocal(), { name: 'Ann', token: 'tok-ann-0123456789' });
    await settle();
    expect(host.room.seats[owner]).toMatchObject({ connected: false, autopilot: false }); // Bea never came back
    await sched.advance(8000);
    expect(host.room.game!.pendingFactoryOps.some(e => e.ownerId === owner)).toBe(false);
    expect(host.room.lastEvents).toContainEqual({ kind: 'timeout', seat: owner, what: 'factory-op' });
  });
});

describe('round-end idle timer', () => {
  it('ends an idle round-end turn, and each action restarts the clock', async () => {
    const game = roundEndState();
    const active = activeSeat(game)!;
    const { host, bea, sched } = await host2(game, 1 - active, { factoryOpTimeoutMs: 0, roundEndTimeoutMs: 20_000 });
    const t0 = sched.now();
    expect(host.room.roundEndDeadline).toBe(t0 + 20_000);

    await sched.advance(15_000);
    const move = legalActions(host.room.game!, active).find(a => a.type !== 'END_ACTIONS')!;
    expect(await bea.act(move)).toEqual({ ok: true });
    expect(activeSeat(host.room.game)).toBe(active);
    expect(host.room.roundEndDeadline).toBe(sched.now() + 20_000);

    await sched.advance(15_000); // past the first deadline: still Bea's turn
    expect(activeSeat(host.room.game)).toBe(active);
    expect(host.room.game!.phase).toBe('roundEnd');
    const round = host.room.game!.round;
    const index = host.room.game!.activePlayerIndex;

    await sched.advance(5_000);
    const g = host.room.game!;
    expect(g.phase !== 'roundEnd' || g.activePlayerIndex !== index || g.round !== round).toBe(true);
    expect(host.room.log.some(e => e.text === "Bea's round-end turn timed out.")).toBe(true);
    expect(host.room.lastEvents).toContainEqual({ kind: 'timeout', seat: active, what: 'round-end' });
  });

  it('does nothing when disabled', async () => {
    const game = roundEndState();
    const active = activeSeat(game)!;
    const { host, sched } = await host2(game, 1 - active, { factoryOpTimeoutMs: 0, roundEndTimeoutMs: -1 });
    expect(host.room.roundEndDeadline).toBeNull();
    const before = JSON.stringify(host.room.game);
    await sched.advance(10 * 60_000);
    expect(JSON.stringify(host.room.game)).toBe(before);
  });
});
