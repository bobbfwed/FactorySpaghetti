// The drawn stack (DRAW_PIECE, `drawnStackIndex`) in rooms received from a host and in loaded
// saves: a value that cannot be used (no such stack, a locked or empty one, the wrong phase, a
// Mine waiting) would leave the game with no legal move, so it is reset to null and the player
// draws again. A usable one survives every way a room travels; saves from before the draw step
// (no field) load as they are.

import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import type { GameState, PlayerId } from '../../engine/state';
import { legalActions } from '../../engine';
import { HostSession } from '../hostSession';
import { ClientSession, promoteToHost } from '../clientSession';
import { activeSeat } from '../room';
import type { Room } from '../room';
import type { SaveEnvelope } from '../save';
import { acceptHostRoom, packLink, parseSaveFile, serializeSaveFile, toSave, unpackLink, validateSave, withTeleporterSlots } from '../save';
import { ManualScheduler, findState, join, playingRoom, settle } from './helpers';

const NAMES = ['Ann', 'Bea', 'Cy', 'Dee'];
const META = { savedAt: 1, app: 'test' };
const QUIET = { factoryOpTimeoutMs: 0, roundEndTimeoutMs: 0, awayPolicy: 'wait' as const, botDelayMs: 0 };

/** A 4-player game in which the active player has just drawn from one of several open stacks. */
const drawn = findState(4, s => s.phase === 'placePiece' && s.drawnStackIndex != null);
const D = drawn.drawnStackIndex!;
const active = activeSeat(drawn)! as PlayerId;
const roomOf = (game: GameState): Room => playingRoom(game, NAMES.map(name => ({ kind: 'human' as const, name })), (active + 1) % 4, QUIET);

/** Every way a room or save arrives, each giving the game it ends up with. */
const arrivals: Array<[string, (room: Room) => Promise<GameState>]> = [
  ['a room from the host', async (room): Promise<GameState> => acceptHostRoom(JSON.parse(JSON.stringify(room)))!.game!],
  ['a save', async (room): Promise<GameState> => validateSave(JSON.parse(JSON.stringify(toSave(room, META)))).room.game!],
  ['a save file', async (room): Promise<GameState> => parseSaveFile(serializeSaveFile(toSave(room, META))).room.game!],
  ['a save link', async (room): Promise<GameState> => (await unpackLink(await packLink(toSave(room, META, { forLink: true })))).room.game!],
];

function variants(): Array<[string, GameState]> {
  const g = drawn;
  const as = (x: object): GameState => x as unknown as GameState;
  const locked = drawn.stacks.findIndex(s => !s.available);
  const out: Array<[string, GameState]> = [
    ['no such stack (5)', as({ ...g, drawnStackIndex: 5 })],
    ['not a number', as({ ...g, drawnStackIndex: '1' })],
    ['negative', as({ ...g, drawnStackIndex: -1 })],
    ['a locked stack', locked >= 0
      ? as({ ...g, drawnStackIndex: locked })
      : as({ ...g, stacks: g.stacks.map((s, i) => (i === D ? { ...s, available: false } : s)) })],
    ['an empty stack', as({ ...g, stacks: g.stacks.map((s, i) => (i === D ? { ...s, pieces: [] } : s)) })],
    ['the wrong phase', as({ ...g, phase: 'actions' })],
  ];
  if (drawn.unplacedMines.length > 0) {
    const [mine, ...rest] = drawn.unplacedMines;
    out.push(['a Mine waiting to be placed', as({ ...g, unplacedMines: rest, pendingMineIds: [mine!.id] })]);
  }
  return out;
}

describe('the drawn stack in received rooms and loaded saves', () => {
  it('the fixture is a real draw: the player must place from that stack', () => {
    expect(D === 0 || D === 1 || D === 2).toBe(true);
    const moves = legalActions(drawn, active);
    expect(moves.length).toBeGreaterThan(0);
    expect(moves.every(m => m.type !== 'PLACE_PIECE' || m.stackIndex === D)).toBe(true);
  });

  for (const [what, bad] of variants()) {
    it(`${what}: reset to null, and the game has legal moves again`, async () => {
      if (bad.phase === 'placePiece' && bad.pendingMineIds.length === 0) {
        expect(legalActions(bad, active)).toEqual([]); // stuck as it came
      }
      for (const [how, arrive] of arrivals) {
        const game = await arrive(roomOf(bad));
        expect(game.drawnStackIndex, how).toBeNull();
        expect(legalActions(game, active).length, how).toBeGreaterThan(0);
        expect({ ...game, drawnStackIndex: undefined }, how).toEqual({ ...bad, drawnStackIndex: undefined });
      }
    });
  }

  it('a usable drawn stack survives a room, a save, a save file and a save link unchanged', async () => {
    for (const [how, arrive] of arrivals) expect(await arrive(roomOf(drawn)), how).toEqual(drawn);
  });

  it('a usable drawn stack survives a host hand-over, and the player places the drawn piece', async () => {
    const sched = new ManualScheduler();
    const room = roomOf(drawn);
    const hostSeat = room.hostSeat;
    const host = new HostSession({
      code: 'ROOMA', hostName: NAMES[hostSeat]!, hostToken: `tok-${NAMES[hostSeat]!.toLowerCase()}-0123456789`, room,
      mode: 'takeover', hostSeat, scheduler: sched,
    });
    const me = new ClientSession(host.connectLocal(), { name: NAMES[hostSeat]!, token: `tok-${NAMES[hostSeat]!.toLowerCase()}-0123456789` });
    const player = join(host, NAMES[active]!, `tok-${NAMES[active]!.toLowerCase()}-0123456789`);
    await settle();
    expect(player.client.room!.game).toEqual(drawn);

    // The host leaves; the drawing player's device takes over from its own copy of the room.
    host.dispose();
    me.dispose();
    const next = promoteToHost(player.client.room!, active, { hostToken: `tok-${NAMES[active]!.toLowerCase()}-0123456789`, scheduler: sched });
    expect(next.room.game).toEqual(drawn);
    const mine = new ClientSession(next.connectLocal(), { name: NAMES[active]!, token: `tok-${NAMES[active]!.toLowerCase()}-0123456789` });
    await settle();
    expect(mine.room!.game!.drawnStackIndex).toBe(D);
    const place = legalActions(mine.room!.game!, active).find(m => m.type === 'PLACE_PIECE')!;
    expect(place).toMatchObject({ stackIndex: D });
    expect(await mine.act(place)).toEqual({ ok: true });
    expect(next.room.game!.drawnStackIndex).toBeNull();
    next.dispose();
  });

  it('a save from before the draw step (no field) still loads as it is', () => {
    const text = readFileSync(new URL('../../app/__tests__/fixtures/before-draw-step.fsreport', import.meta.url), 'utf8');
    const old = (JSON.parse(text) as { room: SaveEnvelope }).room;
    const save = validateSave(old);
    expect(save.room.game).not.toHaveProperty('drawnStackIndex');
    // As it is, but for the teleporter shape of #55 (room format 1 to 2: no teleporters there).
    expect(save.room.game).toEqual(withTeleporterSlots(old.room.game as never));
    expect(JSON.stringify(save.room.game)).not.toContain('teleporterOwner');
    const g = save.room.game!;
    expect(legalActions(g, activeSeat(g)! as PlayerId).length).toBeGreaterThan(0);
  });
});
