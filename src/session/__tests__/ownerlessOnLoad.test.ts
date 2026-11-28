// A save made under the older rules may hold a building with no owner that still has material in
// it (RULES_CHANGES.md #58). It is settled as it loads, so nobody can claim the old owner's
// material or take it with Asset Forfeiture, and journals and replays starting from such a state
// still match the game they lead to.

import { describe, it, expect } from 'vitest';
import type { Action } from '../../engine/actions';
import type { GameState } from '../../engine/state';
import { applyAction, legalActions } from '../../engine';
import { settleLostClaims } from '../../engine/rules/ownership';
import { toSave, validateSave } from '../save';
import { journalMatches, parseJournal, partialJournal } from '../journal';
import { makeReplay, verifyReplay } from '../replay';
import type { Room } from '../room';
import { findState, playingRoom } from './helpers';

const META = { savedAt: 1, app: 'test' };

// An actions step; one of the active player's Plate Factories was left under the old rules: no
// claim any more (its Control Module back in the tray), but Ore in its input and a Plate in its output.
const base = findState(2, s => s.phase === 'actions' && s.pendingFactoryOps.length === 0 && s.round >= 2
  && s.board.some(p => p.type === 'plateFact' && p.claims.length === 1 && p.claims[0]!.ownerId === s.turnOrder[s.activePlayerIndex]
    && p.input!.teleporters.length === 0 && p.output!.teleporters.length === 0));
const me = base.turnOrder[base.activePlayerIndex]!;
const left = base.board.find(p => p.type === 'plateFact' && p.claims.length === 1 && p.claims[0]!.ownerId === me
  && p.input!.teleporters.length === 0 && p.output!.teleporters.length === 0)!;
const old: GameState = {
  ...base,
  board: base.board.map(p => (p.id === left.id ? { ...p, claims: [], input: { slots: ['ore'], teleporters: [] }, output: { slots: ['plate'], teleporters: [] } } : p)),
  players: base.players.map(p => (p.id === me ? { ...p, controlModules: [...p.controlModules, left.claims[0]!.controlModule].sort((a, b) => a - b) } : p)),
};
const room = (g: GameState, seq = 40): Room => ({ ...playingRoom(g, [{ kind: 'human', name: 'Ann' }, { kind: 'human', name: 'Bea' }], 0), seq });
const emptied = (g: GameState): boolean => {
  const x = g.board.find(p => p.id === left.id)!;
  return x.input!.slots.every(m => m === null) && x.output!.slots.every(m => m === null);
};

describe('an older save with an ownerless building holding material (#58)', () => {
  it('is accepted and already settled when it loads', () => {
    expect(emptied(old)).toBe(false);
    const loaded = validateSave(JSON.parse(JSON.stringify(toSave(room(old), META))));
    expect(emptied(loaded.room.game!)).toBe(true);
    expect(loaded.room.game).toEqual(settleLostClaims(old));
    // A save that needs nothing settled loads as it was.
    expect(validateSave(JSON.parse(JSON.stringify(toSave(room(base), META)))).room.game).toEqual(base);
  });

  it('a journal starting from that state still matches the game it leads to', () => {
    // The journal starts at the old position; one move was made from it (by the engine, which
    // settles the state it is given first).
    const move = legalActions(old, me).find((a): a is Action => a.type === 'BUY_BELT' || a.type === 'END_ACTIONS')!;
    const r = applyAction(old, move);
    if (!r.ok) throw new Error(r.error.code);
    const journal = { start: { state: old, seq: 40 }, moves: [move] };
    const save = { ...toSave(room(r.state, 41), META), journal };
    const loaded = validateSave(JSON.parse(JSON.stringify(save)));
    expect(loaded.journal).toBeDefined();
    expect(journalMatches(loaded.journal!, loaded.room.game!, 41)).not.toBeNull();
    // A journal with no moves yet, starting at the saved position itself, also matches.
    const atStart = validateSave(JSON.parse(JSON.stringify({ ...toSave(room(old), META), journal: partialJournal(old, 40) })));
    expect(atStart.journal).toBeDefined();
    expect(journalMatches(atStart.journal!, atStart.room.game!, 40)).not.toBeNull();
    // Its starting state is the settled one.
    const start = parseJournal(partialJournal(old, 40))!.start;
    expect('state' in start && emptied(start.state)).toBe(true);
  });

  it('a replay starting from that state replays every move and ends on the same game', async () => {
    const move = legalActions(old, me).find((a): a is Action => a.type === 'BUY_BELT' || a.type === 'END_ACTIONS')!;
    const r = applyAction(old, move);
    if (!r.ok) throw new Error(r.error.code);
    const replay = JSON.parse(JSON.stringify(makeReplay(room(r.state, 41), { start: { state: old, seq: 40 }, moves: [move] }, META)));
    const cursor = await verifyReplay(replay);
    expect(cursor.refused).toBeNull();
    expect(cursor.stateAt(cursor.length)).toEqual(r.state);
  });
});
