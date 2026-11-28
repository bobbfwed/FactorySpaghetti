// A save from app 0.1.1 (rules revision 2, room format 1) made before rule #37: Changing
// Priorities moved a player's last Control Module off a building and left their Teleporter there.
// Such a save loads, and the Teleporter goes back to its owner on loading (settled, as the engine
// settles every state), with the counts right; the same for a journal or replay starting from such
// a state. A save of today's format with a Teleporter on a building its owner does not hold is
// still refused as damaged, and the other Teleporter checks hold for every format.

import { describe, it, expect } from 'vitest';
import type { BoardPiece, GameState, PlayerId } from '../../engine/state';
import { applyAction, legalActions } from '../../engine';
import { TELEPORTER_COUNT } from '../../engine/config';
import { parseStart } from '../journal';
import { SaveError, asGameState, validateSave } from '../save';
import { findState, playingRoom } from './helpers';

const g = findState(2, s => s.phase === 'actions' && s.pendingFactoryOps.length === 0 && s.round >= 2);
const me = g.turnOrder[g.activePlayerIndex]! as PlayerId;
const them = (1 - me) as PlayerId;
// The building Changing Priorities emptied (under the old rules), and the one its module went to.
const target = g.board.find(p => p.type === 'plateFact' && p.claims.some(c => c.ownerId === me))!;
const other = g.board.find(p => p.id !== target.id && (p.type === 'plateFact' || p.type === 'powerPlant')
  && p.claims.length > 0 && p.claims.every(c => c.ownerId === me) && p.claims.length < 3)!;
const moved = target.claims[0]!;

type Shape = 'legacy' | 'current';
/** A buffer as a build of that format writes it, with `owner`'s Teleporter on it (or none). */
const buf = (b: BoardPiece['input'], owner: PlayerId | null, shape: Shape): unknown =>
  (b ? (shape === 'legacy' ? { slots: b.slots, teleporterOwner: owner } : { slots: b.slots, teleporters: owner === null ? [] : [owner] }) : null);

/**
 * The game with `teleOwner`'s Teleporter on the emptied building's input; `claimsOnTarget` stay on
 * it (none: the old Changing Priorities case). No other Teleporter is on the board; counts fit.
 */
function stateWith(shape: Shape, teleOwner: PlayerId, claimsOnTarget: BoardPiece['claims'] = []): Record<string, unknown> {
  const board = g.board.map(p => {
    if (p.id === target.id) return { ...p, claims: claimsOnTarget, input: buf(p.input, teleOwner, shape), output: buf(p.output, null, shape) };
    if (p.id === other.id && claimsOnTarget.length === 0) return { ...p, claims: [...p.claims, moved], input: buf(p.input, null, shape), output: buf(p.output, null, shape) };
    return { ...p, input: buf(p.input, null, shape), output: buf(p.output, null, shape) };
  });
  const players = g.players.map(p => ({ ...p, teleportersRemaining: TELEPORTER_COUNT - (p.id === teleOwner ? 1 : 0) }));
  return { ...g, board, players, globalTeleporterCount: 1 };
}

const NAMES = [{ kind: 'human' as const, name: 'Ann' }, { kind: 'human' as const, name: 'Bea' }];
const envelope = (v: 1 | 2, game: unknown, app = '0.1.1+abc1234'): unknown =>
  ({ format: 'factory-spaghetti-save', v: 1, savedAt: 1, app, rules: 'old', room: { ...playingRoom(g, NAMES, 0), v, game } });
const kindOf = (f: () => unknown): string | null => { try { f(); return null; } catch (e) { return e instanceof SaveError ? e.kind : 'other'; } };
const onTarget = (s: GameState): BoardPiece => s.board.find(p => p.id === target.id)!;

describe('a 0.1.1 save with a Teleporter left on a building its player no longer holds', () => {
  it('loads; the Teleporter is back with its owner, the price count drops, and the game plays on', () => {
    const save = validateSave(envelope(1, stateWith('legacy', me)));
    const s = save.room.game!;
    expect(onTarget(s).input!.teleporters).toEqual([]);
    expect(s.players[me]!.teleportersRemaining).toBe(TELEPORTER_COUNT);
    expect(s.globalTeleporterCount).toBe(0);
    expect(legalActions(s, me).length).toBeGreaterThan(0);
    const first = legalActions(s, me)[0]!;
    expect(applyAction(s, first).ok).toBe(true);
  });

  it('a journal or replay starting from such a state starts from the same settled state', () => {
    const loaded = validateSave(envelope(1, stateWith('legacy', me))).room.game!;
    const start = parseStart({ seq: 7, state: stateWith('legacy', me) });
    expect(start).not.toBeNull();
    expect('state' in start! ? start.state : null).toEqual(loaded);
    expect(asGameState(stateWith('legacy', me))).toEqual(loaded);
  });

  it('also when the building is still held by the other player (their claim stays, the Teleporter goes home)', () => {
    const s = validateSave(envelope(1, stateWith('legacy', me, [{ ownerId: them, controlModule: 6 }]))).room.game!;
    expect(onTarget(s).claims).toEqual([{ ownerId: them, controlModule: 6 }]);
    expect(onTarget(s).input!.teleporters).toEqual([]);
    expect(s.players[me]!.teleportersRemaining).toBe(TELEPORTER_COUNT);
  });
});

describe('the Teleporter checks still hold', () => {
  it('a save of today\'s format with a Teleporter on a building its owner does not hold is refused as damaged', () => {
    expect(kindOf(() => validateSave(envelope(2, stateWith('current', me), '0.1.5')))).toBe('invalid');
    expect(kindOf(() => validateSave(envelope(2, stateWith('current', me, [{ ownerId: them, controlModule: 6 }]), '0.1.5')))).toBe('invalid');
    expect(asGameState(stateWith('current', me))).toBeNull();
    expect(parseStart({ seq: 7, state: stateWith('current', me) })).toBeNull();
  });

  it('in an old save too: wrong Teleporter totals, a wrong price count, wrong slot counts, a Teleporter on a Mine', () => {
    const base = stateWith('legacy', me);
    const players = (base.players as GameState['players']).map(p => (p.id === me ? { ...p, teleportersRemaining: TELEPORTER_COUNT } : p));
    expect(kindOf(() => validateSave(envelope(1, { ...base, players })))).toBe('invalid');
    expect(kindOf(() => validateSave(envelope(1, { ...base, globalTeleporterCount: 2 })))).toBe('invalid');
    const slots = (base.board as Record<string, unknown>[]).map(p => (p.id === target.id ? { ...p, input: { slots: [null, null], teleporterOwner: me } } : p));
    expect(kindOf(() => validateSave(envelope(1, { ...base, board: slots })))).toBe('invalid');
    const mine = g.board.find(p => p.type === 'mine')!;
    const onMine = (base.board as Record<string, unknown>[]).map(p => (p.id === mine.id ? { ...p, output: { slots: (mine.output?.slots ?? []), teleporterOwner: me } }
      : p.id === target.id ? { ...p, input: { slots: target.input!.slots, teleporterOwner: null } } : p));
    expect(kindOf(() => validateSave(envelope(1, { ...base, board: onMine })))).toBe('invalid');
  });

  it('one owner per building is still enforced in an old save', () => {
    const shared = stateWith('legacy', me, [{ ownerId: me, controlModule: 4 }, { ownerId: them, controlModule: 6 }]);
    expect(kindOf(() => validateSave(envelope(1, shared)))).toBe('shared-building');
  });
});
