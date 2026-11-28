// Teleporters per input (RULES_CHANGES.md #55): saves, rooms, replays and moves from before it.
// A buffer saved with one `teleporterOwner` for the whole buffer loads with that teleporter on its
// first slot (input 1, or the output); a move that names only the input buffer means input 1. The
// room format is 2 and the protocol 2, so a build from before #55 never runs a game of this shape.

import { describe, it, expect } from 'vitest';
import type { BoardPiece, GameState, PlayerId } from '../../engine/state';
import type { Action } from '../../engine/actions';
import { applyAction, isListedMove, legalActions } from '../../engine';
import { normalizeAction } from '../normalize';
import { parseStart } from '../journal';
import { PROTOCOL } from '../protocol';
import { ROOM_FORMAT, SaveError, packLink, toSave, unpackLink, validateSave } from '../save';
import type { Room } from '../room';
import { findState, playingRoom } from './helpers';

const NAMES = ['Ann', 'Bea', 'Cy', 'Dee'];
const META = { savedAt: 1, app: 'test' };

/** A 2-player game in its actions step, with one of the active player's Plate Factories made a Sphere Factory. */
const base = findState(2, s => s.phase === 'actions' && s.pendingFactoryOps.length === 0 && s.round >= 2);
const me = base.turnOrder[base.activePlayerIndex]! as PlayerId;
const sfId = base.board.find(p => p.type === 'plateFact' && p.claims.some(c => c.ownerId === me))!.id;
const game: GameState = {
  ...base,
  board: base.board.map(p => (p.id === sfId ? { ...p, type: 'sphereFact' as const, input: { slots: [null, null], teleporters: [] } } : p)),
  players: base.players.map(p => (p.id === me ? { ...p, inventory: { ore: 6, plate: 2, sphere: 0, tesseract: 0 } } : p)),
};

/** The game as a build from before #55 saved it: one `teleporterOwner` per buffer. */
function legacy(g: GameState, owners: { input?: PlayerId; output?: PlayerId } = {}): unknown {
  const old = (b: BoardPiece['input'], o: PlayerId | undefined): unknown =>
    (b ? { slots: b.slots, teleporterOwner: o ?? null } : null);
  return {
    ...g,
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
    expect(() => validateSave(toSave(bad([null, 1]), META))).not.toThrow();
  });

  it('a save link of format 2 travels and loads', async () => {
    const withTp: GameState = { ...game, board: game.board.map(p => (p.id === sfId ? { ...p, input: { slots: [null, 'plate'], teleporters: [null, me] } } : p)) };
    const room = playingRoom(withTp, NAMES.slice(0, 2).map(name => ({ kind: 'human' as const, name })), 0);
    const back = await unpackLink(await packLink(toSave(room, META, { forLink: true })));
    expect(sf(back.room.game!).input).toEqual({ slots: [null, 'plate'], teleporters: [null, me] });
  });

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
