// The host accepts a player's move only when the move list offers it (RULES_CHANGES.md #40):
// the engine's own refusal comes first, with its specific reason; a move the engine would take
// but the list does not offer is refused with NOT_LISTED and changes nothing.

import { describe, it, expect, vi, afterEach } from 'vitest';
import type { GameState, Player } from '../../engine/state';
import * as engine from '../../engine';
import { HostSession } from '../hostSession';
import { ClientSession } from '../clientSession';
import { activeSeat } from '../room';
import { ManualScheduler, findState, join, playingRoom, settle } from './helpers';

// The list check goes through the engine's public isListedMove; one test makes it say "no".
vi.mock('../../engine', async importOriginal => {
  const real = await importOriginal<typeof import('../../engine')>();
  return { ...real, isListedMove: vi.fn(real.isListedMove) };
});
const listedMock = vi.mocked(engine.isListedMove);

const NO_TIMERS = { factoryOpTimeoutMs: 0, roundEndTimeoutMs: 0, awayPolicy: 'wait' as const, botDelayMs: 0 };

/** A 2-player room around `game`; Ann hosts the seat that is NOT active, Bea plays the active seat. */
async function room(game: GameState): Promise<{ host: HostSession; bea: ClientSession; active: number }> {
  const active = activeSeat(game)!;
  const hostSeat = 1 - active;
  const sched = new ManualScheduler();
  const names = hostSeat === 0 ? ['Ann', 'Bea'] : ['Bea', 'Ann'];
  const r = playingRoom(game, names.map(name => ({ kind: 'human' as const, name })), hostSeat, NO_TIMERS);
  const host = new HostSession({ code: 'ROOMA', hostName: 'Ann', hostToken: 'tok-ann-0123456789', room: r, mode: 'takeover', hostSeat, scheduler: sched });
  new ClientSession(host.connectLocal(), { name: 'Ann', token: 'tok-ann-0123456789' });
  const bea = join(host, 'Bea', 'tok-bea-0123456789').client;
  await settle();
  expect(bea.seat).toBe(active);
  return { host, bea, active };
}

const withPlayer = (g: GameState, seat: number, patch: Partial<Player>): GameState =>
  ({ ...g, players: g.players.map((p, i) => (i === seat ? { ...p, ...patch } : p)) });

afterEach(() => { listedMock.mockClear(); });

describe('the host accepts only listed moves', () => {
  it('refuses a move the engine would take but the list does not offer (NOT_LISTED), and changes nothing', async () => {
    const game = findState(2, s => s.phase === 'actions' && s.pendingFactoryOps.length === 0);
    const { host, bea } = await room(game);
    const before = JSON.stringify(host.room);
    expect(engine.applyAction(game, { type: 'END_ACTIONS' }).ok).toBe(true);
    listedMock.mockReturnValueOnce(false);
    const res = await bea.act({ type: 'END_ACTIONS' });
    expect(res).toEqual({ ok: false, error: { code: 'NOT_LISTED', message: 'That move is not available right now.' } });
    await settle();
    expect(JSON.stringify(host.room)).toBe(before);
    // The same move, listed, goes through.
    expect(await bea.act({ type: 'END_ACTIONS' })).toEqual({ ok: true });
  });

  it("gives the engine's own reason first: a pending decision of the player's own (DECISION_PENDING)", async () => {
    const game = findState(2, s => s.phase === 'actions' && s.pendingFactoryOps.some(e => e.ownerId === activeSeat(s)));
    const { host, bea } = await room(game);
    const seq = host.room.seq;
    expect(await bea.act({ type: 'BUY_BELT' })).toMatchObject({ ok: false, error: { code: 'DECISION_PENDING' } });
    expect(host.room.seq).toBe(seq);
  });

  it('a roll is listed for the active player although the list never names dice', async () => {
    const game = findState(2, s => s.phase === 'roll');
    const { host, bea } = await room(game);
    expect(await bea.act({ type: 'ROLL_DICE', rolls: [] })).toEqual({ ok: true });
    expect(host.room.game!.phase).toBe('actions');
  });

  it('a Scouting Drone play naming a later copy of a piece type is accepted, and takes the first copy', async () => {
    const found = findState(2, s => s.phase === 'actions' && s.pendingFactoryOps.length === 0 && s.stacks[0].pieces.length > 6);
    const active = activeSeat(found)!;
    const game = withPlayer({ ...found, cardsPlayedThisTurn: 0 }, active, { hand: ['scoutingDrone'] });
    const stack = game.stacks[0];
    const later = stack.pieces.findIndex((p, i) => stack.pieces.findIndex(q => q.type === p.type) < i);
    const first = stack.pieces.findIndex(p => p.type === stack.pieces[later]!.type);
    const listed = engine.legalActions(game, active).find(a => a.type === 'PLAY_CARD' && a.cardType === 'scoutingDrone' && a.stackIndex === 0 && a.pieceIndex === first)!;
    const { host, bea } = await room(game);
    expect(await bea.act({ ...listed, pieceIndex: later } as engine.Action)).toEqual({ ok: true });
    expect(host.room.game!.board.at(-1)!.id).toBe(stack.pieces[first]!.id);
  });
});
