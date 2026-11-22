// The turn queue, read from the state: this round's order, who is done, who plays, who is next,
// the end of the round and who starts the next round; the set-up claims; the round-end turns.

import { describe, expect, it } from 'vitest';
import type { GameState, PlayerId } from '../../engine/state';
import { turnQueue, type QueueItem } from '../queue';
import { findState } from './helpers';

const names = (p: PlayerId): string => ['Ann', 'Bea', 'Cid', 'Dot'][p]!;
const turns = (items: QueueItem[]): Extract<QueueItem, { kind: 'turn' }>[] => items.filter((x): x is Extract<QueueItem, { kind: 'turn' }> => x.kind === 'turn');
const marks = (items: QueueItem[]): string[] => items.filter(x => x.kind === 'mark').map(x => (x as { text: string }).text);

describe('turn queue', () => {
  it('during a normal turn: done, active (with its step), next, later; first marker; end of round', () => {
    const { state } = findState(s => s.phase === 'actions' && s.playerCount >= 3 && s.activePlayerIndex === 1);
    const q = turnQueue(state, names);
    const t = turns(q.items);
    expect(t.map(x => x.seat)).toEqual([...state.turnOrder]);
    expect(t.map(x => x.status)).toEqual(['done', 'active', 'next', ...Array(state.turnOrder.length - 3).fill('later')]);
    expect(t[1]!.step).toBe('Actions');
    expect(t[0]!.first).toBe(true);
    expect(t.slice(1).every(x => !x.first)).toBe(true);
    expect(q.next).toBe(state.turnOrder[2]);
    expect(marks(q.items)).toEqual([`Round ${state.round}`, 'End of round']);
  });

  it('names who starts the next round when the engine gives the next order', () => {
    const { state } = findState(s => s.phase === 'roll');
    const upcoming = [...state.turnOrder.slice(1), state.turnOrder[0]!];
    expect(marks(turnQueue(state, names, upcoming).items)).toContain(`Round ${state.round + 1}: ${names(upcoming[0]!)} starts`);
  });

  it('the last player of the round has no next player: the end of the round comes next', () => {
    const { state } = findState(s => s.phase === 'placeMeeple' && s.activePlayerIndex === s.turnOrder.length - 1);
    const q = turnQueue(state, names);
    expect(q.next).toBeNull();
    expect(turns(q.items).at(-1)!.status).toBe('active');
  });

  it('end of round: the round-end turns in the (new) order, then who starts the round', () => {
    const { state } = findState(s => s.phase === 'roundEnd' && s.activePlayerIndex === 0);
    const q = turnQueue(state, names);
    expect(q.items[0]).toMatchObject({ kind: 'mark', text: 'End of round', status: 'active' });
    const t = turns(q.items);
    expect(t.map(x => x.seat)).toEqual([...state.turnOrder]);
    expect(t[0]).toMatchObject({ status: 'active', step: 'End-of-round turn' });
    expect(marks(q.items).at(-1)).toBe(`Round ${state.round}: ${names(state.turnOrder[0]!)} starts`);
  });

  it('set-up: Plate Factory claims in order, then Power Plant claims back the other way', () => {
    const { state } = findState(s => s.phase === 'setupClaimPF' && s.activePlayerIndex === 0);
    const q = turnQueue(state, names);
    expect(marks(q.items)).toEqual(['Set-up: Plate Factories', 'Power Plants', `Round 1: ${names(state.turnOrder[0]!)} starts`]);
    const t = turns(q.items);
    const n = state.turnOrder.length;
    expect(t.slice(0, n).map(x => x.seat)).toEqual([...state.turnOrder]);
    expect(t.slice(n).map(x => x.seat)).toEqual([...state.turnOrder].reverse());
    expect(t[0]).toMatchObject({ status: 'active', step: 'Claim a Plate Factory' });
    // In Power Plant claims, the one now claiming is active and the Plate Factory claims are all done.
    const pp: GameState = { ...state, phase: 'setupClaimPP', activePlayerIndex: n - 1 };
    const tp = turns(turnQueue(pp, names).items);
    expect(tp.slice(0, n).every(x => x.status === 'done')).toBe(true);
    expect(tp[n]).toMatchObject({ status: 'active', step: 'Claim a Power Plant', seat: state.turnOrder[n - 1] });
  });

  it('game over is one line', () => {
    const { state } = findState(s => s.phase === 'actions');
    expect(turnQueue({ ...state, gameOver: true }, names).items).toEqual([{ kind: 'mark', text: 'Game over', status: 'active', role: 'round' }]);
  });
});
