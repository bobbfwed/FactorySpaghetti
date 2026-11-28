// Teleporters per input (RULES_CHANGES.md #55): saves, rooms, replays and moves from before it.
// A buffer saved with one `teleporterOwner` for the whole buffer loads with that teleporter on its
// first slot (input 1, or the output); a move that names only the input buffer means input 1. The
// room format is 2 and the protocol 2, so a build from before #55 never runs a game of this shape.

import { describe, it, expect } from 'vitest';
import type { BoardPiece, GameState, PlayerId } from '../../engine/state';
import type { Action } from '../../engine/actions';
import { applyAction, createGame, isListedMove, legalActions } from '../../engine';
import { TELEPORTER_COUNT } from '../../engine/config';
import { createRng, nextIntBelow } from '../../engine/rng';
import { BOT_TYPES } from '../../bots/registry';
import { normalizeAction } from '../normalize';
import { parseStart } from '../journal';
import { PROTOCOL } from '../protocol';
import { ROOM_FORMAT, SaveError, asGameState, packLink, toSave, unpackLink, validateSave } from '../save';
import type { Room } from '../room';
import { findState, playingRoom } from './helpers';

const NAMES = ['Ann', 'Bea', 'Cy', 'Dee'];
const META = { savedAt: 1, app: 'test' };

/** A 2-player game in its actions step, with one of the active player's Plate Factories made a Sphere Factory. */
const base = findState(2, s => s.phase === 'actions' && s.pendingFactoryOps.length === 0 && s.round >= 2);
const me = base.turnOrder[base.activePlayerIndex]! as PlayerId;
const sfId = base.board.find(p => p.type === 'plateFact' && p.claims.some(c => c.ownerId === me))!.id;
/** No teleporter anywhere yet (so the old-save form below can express every one). */
const game: GameState = {
  ...base,
  board: base.board.map(p => {
    const clear = (b: BoardPiece['input']): BoardPiece['input'] => (b ? { ...b, teleporters: [] } : null);
    return p.id === sfId
      ? { ...p, type: 'sphereFact' as const, input: { slots: [null, null], teleporters: [] }, output: clear(p.output) }
      : { ...p, input: clear(p.input), output: clear(p.output) };
  }),
  players: base.players.map(p => ({ ...p, teleportersRemaining: TELEPORTER_COUNT, ...(p.id === me ? { inventory: { ore: 6, plate: 2, sphere: 0, tesseract: 0 } } : {}) })),
  globalTeleporterCount: 0,
};

/**
 * `g` with the teleporter counts made to fit its board, as the engine keeps them: each player's
 * teleporters in hand are the 4 less those on the board, and the price count is the board's total.
 */
function consistent(g: GameState): GameState {
  const on = g.players.map(pl => g.board.reduce((n, p) => n + [p.input, p.output].reduce((k, b) => k + (b?.teleporters.filter(o => o === pl.id).length ?? 0), 0), 0));
  return {
    ...g,
    players: g.players.map((pl, i) => ({ ...pl, teleportersRemaining: TELEPORTER_COUNT - on[i]! })),
    globalTeleporterCount: on.reduce((a, b) => a + b, 0),
  };
}

/** `game` with the Sphere Factory's teleporters set (input per slot, output) and the counts made to fit. */
function withSf(input: Array<PlayerId | null>, output: Array<PlayerId | null> = [], slots: BoardPiece['input'] = null): GameState {
  return consistent({
    ...game,
    board: game.board.map(p => (p.id === sfId
      ? { ...p, input: { slots: slots?.slots ?? p.input!.slots, teleporters: input }, output: { ...p.output!, teleporters: output } }
      : p)),
  });
}

/** The game as a build from before #55 saved it: one `teleporterOwner` per buffer. */
function legacy(g: GameState, owners: { input?: PlayerId; output?: PlayerId } = {}): unknown {
  const old = (b: BoardPiece['input'], o: PlayerId | undefined): unknown =>
    (b ? { slots: b.slots, teleporterOwner: o ?? null } : null);
  const counted = consistent({
    ...g,
    board: g.board.map(p => (p.id === sfId
      ? { ...p, input: { ...p.input!, teleporters: owners.input === undefined ? [] : [owners.input] }, output: { ...p.output!, teleporters: owners.output === undefined ? [] : [owners.output] } }
      : p)),
  });
  return {
    ...counted,
    board: g.board.map(p => (p.id === sfId
      ? { ...p, input: old(p.input, owners.input), output: old(p.output, owners.output) }
      : { ...p, input: old(p.input, undefined), output: old(p.output, undefined) })),
  };
}

/** A room as a build from before #55 saved it (room format 1). */
const legacyRoom = (owners: { input?: PlayerId; output?: PlayerId } = {}): unknown => {
  const room = playingRoom(game, NAMES.slice(0, 2).map(name => ({ kind: 'human' as const, name })), 0);
  return { ...room, v: 1, game: legacy(game, owners) };
};
const envelope = (room: unknown): unknown => ({ format: 'factory-spaghetti-save', v: 1, savedAt: 1, app: 'old', rules: 'old', room });
const sf = (g: GameState): BoardPiece => g.board.find(p => p.id === sfId)!;
const room = (g: GameState): Room => playingRoom(g, NAMES.slice(0, 2).map(name => ({ kind: 'human' as const, name })), 0);

describe('saves and rooms from before #55', () => {
  it('a whole-input teleporter loads on input 1, an output teleporter stays on the output', () => {
    const save = validateSave(envelope(legacyRoom({ input: me, output: me })));
    expect(save.room.v).toBe(ROOM_FORMAT);
    const g = save.room.game!;
    expect(sf(g).input).toEqual({ slots: [null, null], teleporters: [me] });
    expect(sf(g).output!.teleporters).toEqual([me]);
    expect(JSON.stringify(g)).not.toContain('teleporterOwner');
    // Every other buffer loads with no teleporter, and the game plays on.
    expect(g.board.filter(p => p.id !== sfId).every(p => [p.input, p.output].every(b => !b || b.teleporters.length === 0))).toBe(true);
    const listed = legalActions(g, me).filter(a => a.type === 'PLACE_TELEPORTER' && a.pieceId === sfId);
    expect(listed).toEqual([{ type: 'PLACE_TELEPORTER', pieceId: sfId, bufferType: 'input', inputIndex: 1 }]);
  });

  it('a room of format 2 is kept as it is, and a newer format is refused as made by a newer version', () => {
    const now = playingRoom(game, NAMES.slice(0, 2).map(name => ({ kind: 'human' as const, name })), 0);
    expect(now.v).toBe(2);
    const save = validateSave(toSave(now, META));
    expect(save.room.game).toEqual(game);
    expect(() => validateSave(envelope({ ...now, v: 3 }))).toThrow(SaveError);
    try { validateSave(envelope({ ...now, v: 3 })); } catch (e) { expect((e as SaveError).kind).toBe('unsupported-version'); }
  });

  it('a damaged teleporter list is refused: longer than the slots, or not a player of the game', () => {
    const bad = (teleporters: unknown): Room => ({
      ...playingRoom(game, NAMES.slice(0, 2).map(name => ({ kind: 'human' as const, name })), 0),
      game: { ...game, board: game.board.map(p => (p.id === sfId ? { ...p, input: { slots: [null, null], teleporters } } : p)) } as GameState,
    });
    expect(() => validateSave(toSave(bad([0, 1, 0]), META))).toThrow(SaveError);
    expect(() => validateSave(toSave(bad([3]), META))).toThrow(SaveError);
    expect(() => validateSave(toSave(bad('x'), META))).toThrow(SaveError);
    expect(() => validateSave(toSave(room(withSf([null, me])), META))).not.toThrow();
  });

  it('a save link of format 2 travels and loads', async () => {
    const back = await unpackLink(await packLink(toSave(room(withSf([null, me], [], { slots: [null, 'plate'], teleporters: [] })), META, { forLink: true })));
    expect(sf(back.room.game!).input).toEqual({ slots: [null, 'plate'], teleporters: [null, me] });
  });

  it('loading always gives the engine\'s shape: trailing nulls trimmed, no stray teleporterOwner', () => {
    const shape = (input: unknown, output: unknown): unknown => {
      const g = withSf([me], [me]);
      return { ...room(g), game: { ...g, board: g.board.map(p => (p.id === sfId ? { ...p, input, output } : p)) } };
    };
    const clean = validateSave(toSave(room(withSf([me], [me])), META)).room.game;
    const untrimmed = validateSave(envelope(shape({ slots: [null, null], teleporters: [me, null] }, { slots: [null], teleporters: [me, null].slice(0, 1) }))).room.game;
    const stray = validateSave(envelope(shape({ slots: [null, null], teleporters: [me], teleporterOwner: 1 }, { slots: [null], teleporters: [me], teleporterOwner: null }))).room.game;
    expect(untrimmed).toEqual(clean);
    expect(stray).toEqual(clean);
    expect(JSON.stringify(stray)).not.toContain('teleporterOwner');
    // A buffer whose only entry is null loads as no teleporter at all.
    const g0 = consistent(game);
    const nulls = { ...room(g0), game: { ...g0, board: g0.board.map(p => (p.id === sfId ? { ...p, input: { slots: [null, null], teleporters: [null, null] }, output: { slots: [null], teleporters: [null] } } : p)) } };
    expect(validateSave(envelope(nulls)).room.game).toEqual(validateSave(toSave(room(g0), META)).room.game);
  });
});

describe('a save whose buffers or teleporters do not add up is refused', () => {
  const refused = (g: GameState): void => { expect(() => validateSave(toSave(room(g), META))).toThrow(SaveError); };
  const accepted = (g: GameState): void => { expect(() => validateSave(toSave(room(g), META))).not.toThrow(); };
  const other = (1 - me) as PlayerId;

  it('a teleporter on a Mine or a blank tile', () => {
    const mine = game.board.find(p => p.type === 'mine')!;
    refused(consistent({ ...game, board: game.board.map(p => (p.id === mine.id ? { ...p, output: { slots: p.output!.slots, teleporters: [me] } } : p)) }));
    const blank = game.board.find(p => p.type === 'blank');
    if (blank) refused(consistent({ ...game, board: game.board.map(p => (p.id === blank.id ? { ...p, input: { slots: [null], teleporters: [me] } } : p)) }));
  });

  it('a teleporter of a player who holds no claim on the building; one of a co-owner is fine', () => {
    refused(withSf([other]));
    const shared = consistent({
      ...withSf([me, other]),
      board: withSf([me, other]).board.map(p => (p.id === sfId ? { ...p, claims: [...p.claims, { ownerId: other, controlModule: 9 }] } : p)),
    });
    accepted(shared);
  });

  it('slot counts that do not match the piece type (a Plate Factory with four inputs)', () => {
    const pf = game.board.find(p => p.type === 'plateFact' && p.claims.length > 0)!;
    const o = pf.claims[0]!.ownerId;
    refused(consistent({ ...game, board: game.board.map(p => (p.id === pf.id ? { ...p, input: { slots: [null, null, null, null], teleporters: [o, o, o, o] } } : p)) }));
    refused({ ...game, board: game.board.map(p => (p.id === pf.id ? { ...p, input: { slots: [null, null], teleporters: [] } } : p)) });
    refused({ ...game, board: game.board.map(p => (p.id === pf.id ? { ...p, output: null } : p)) });
  });

  it('teleporters in hand and on the board that do not make 4, or a price count that is not the number on the board', () => {
    const g = withSf([me], [me]);
    accepted(g);
    refused({ ...g, players: g.players.map(p => (p.id === me ? { ...p, teleportersRemaining: TELEPORTER_COUNT } : p)) });
    refused({ ...g, players: g.players.map(p => (p.id === me ? { ...p, teleportersRemaining: TELEPORTER_COUNT - 3 } : p)) });
    refused({ ...g, globalTeleporterCount: 1 });
    refused({ ...g, globalTeleporterCount: 3 });
  });
});

describe('every state the engine reaches passes the save checks', () => {
  it('whole games of every kind of bot, at 2, 3 and 4 players, every state after every move', () => {
    let states = 0;
    for (let g = 0; g < 6; g++) {
      const pc = (2 + (g % 3)) as 2 | 3 | 4;
      let s: GameState = createGame(500 + g, pc);
      const seats = Array.from({ length: pc }, (_, i) => BOT_TYPES[(g + i * 3) % BOT_TYPES.length]!.fn);
      let rng = createRng(500 + g);
      for (let n = 0; n < 6000 && !s.gameOver; n++) {
        const pending = s.pendingFactoryOps[0];
        const who = (pending ? pending.ownerId : s.turnOrder[s.activePlayerIndex]) as PlayerId;
        let a: Action;
        if (s.phase === 'roll' && !pending) {
          const rolls: number[] = [];
          for (let d = 0; d < s.mineCount; d++) { const [v, nx] = nextIntBelow(rng, 6); rng = nx; rolls.push(v + 1); }
          a = { type: 'ROLL_DICE', rolls };
        } else a = seats[who]!(s, who);
        const r = applyAction(s, a);
        if (!r.ok) throw new Error(r.error.message);
        s = r.state;
        states++;
        expect(asGameState(JSON.parse(JSON.stringify(s))), `game ${g}, move ${n} (${a.type})`).not.toBeNull();
      }
    }
    expect(states).toBeGreaterThan(1000);
  }, 120_000);
});

describe('saves and rooms from before #55, continued', () => {
  it('a replay or journal that starts from a state saved before #55 gets its teleporters on their slots', () => {
    const start = parseStart({ state: legacy(game, { input: me }), seq: 12 });
    expect(start).not.toBeNull();
    const state = (start as { state: GameState }).state;
    expect(sf(state).input!.teleporters).toEqual([me]);
    expect(JSON.stringify(state)).not.toContain('teleporterOwner');
  });
});

describe('moves from before #55', () => {
  const old: Action = { type: 'PLACE_TELEPORTER', pieceId: sfId, bufferType: 'input' };

  it('a move naming only the input survives the host\'s rebuilding and is listed as input 1', () => {
    expect(normalizeAction(old)).toEqual(old);
    expect(isListedMove(game, me, old)).toBe(true);
    const r = applyAction(game, old);
    expect(r.ok).toBe(true);
    if (r.ok) expect(sf(r.state).input!.teleporters).toEqual([me]);
  });

  it('a move naming an input keeps it; an input beyond the third or not a number is not a move', () => {
    const a: Action = { type: 'PLACE_TELEPORTER', pieceId: sfId, bufferType: 'input', inputIndex: 1 };
    expect(normalizeAction(a)).toEqual(a);
    expect(normalizeAction({ ...a, inputIndex: 3 })).toBeNull();
    expect(normalizeAction({ ...a, inputIndex: 'x' })).toBeNull();
    const card = { type: 'PLAY_CARD', cardType: 'rdTaxWriteOff', pieceId: sfId, bufferType: 'input', inputIndex: 1 };
    expect(normalizeAction(card)).toEqual(card);
  });

  it('the protocol is 2: a build from before #55 is turned away at hello', () => {
    expect(PROTOCOL).toBe(2);
  });
});
