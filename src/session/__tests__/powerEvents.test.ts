// A roll that activates several Power Plants: each plant's "activated" event carries the Power
// Tokens that plant gave, not the owner's total for the roll, so the roll line names each plant's
// own number, the table flies the right number of tokens, and a plant that found its owner at the
// cap says so. The sum of the events always equals the owner's real change.

import { describe, it, expect } from 'vitest';
import { POWER_TOKEN_CAP } from '../../engine/config';
import { applyAction } from '../../engine/reducer';
import { createGame } from '../../engine/rules/setup';
import { withTeleporter } from '../../engine/rules/teleporters';
import type { GameState, Material, PlayerId } from '../../engine/state';
import { planTransition } from '../../table/transition';
import { outcomeOf, outcomeText } from '../../ui/game/rollOutcome';
import { moveEvents } from '../events';
import type { TableEvent } from '../room';

type Activated = Extract<TableEvent, { kind: 'activated' }>;

/**
 * The roller's roll step; the Power Plants listed get the owner and the input given, on Control
 * Module 5; every other building is unclaimed. Players start with `tokens` Power Tokens.
 */
function staged(players: 2 | 3 | 4, plants: { owner: PlayerId; input: Material | null; tele?: boolean }[], tokens: number[]): { s: GameState; ids: string[] } {
  const g = createGame(7, players);
  const pps = g.board.filter(p => p.type === 'powerPlant');
  expect(pps.length).toBeGreaterThanOrEqual(plants.length);
  const ids = pps.slice(0, plants.length).map(p => p.id);
  const s: GameState = {
    ...g, phase: 'roll', activePlayerIndex: 0, pendingFactoryOps: [],
    board: g.board.map(p => {
      const k = ids.indexOf(p.id);
      if (k >= 0) {
        const pl = plants[k]!;
        const input = { ...p.input!, slots: [pl.input] };
        return { ...p, claims: [{ ownerId: pl.owner, controlModule: 5 }], input: pl.tele ? withTeleporter(input, 0, pl.owner) : input };
      }
      return p.type === 'mine' || p.type === 'blank' ? p : { ...p, claims: [] };
    }),
    players: g.players.map(p => ({ ...p, powerTokens: tokens[p.id] ?? 0, teleportersRemaining: p.teleportersRemaining - plants.filter(x => x.tele && x.owner === p.id).length })),
    globalTeleporterCount: plants.filter(x => x.tele).length,
  };
  return { s, ids };
}

function roll(s: GameState): { after: GameState; events: TableEvent[]; act: Activated[] } {
  const action = { type: 'ROLL_DICE' as const, rolls: [5] };
  const r = applyAction(s, action);
  if (!r.ok) throw new Error(r.error.message);
  const events = moveEvents(s, r.state, action, s.turnOrder[0]!);
  return { after: r.state, events, act: events.filter((e): e is Activated => e.kind === 'activated') };
}

const gainOf = (a: GameState, b: GameState, p: PlayerId): number => b.players[p]!.powerTokens - a.players[p]!.powerTokens;
const sumFor = (act: Activated[], p: PlayerId): number => act.filter(e => e.seat === p).reduce((t, e) => t + e.amount, 0);

describe('Power Plants activated by one roll', () => {
  it('two plants of one player: each event carries its own plant\'s Power Tokens', () => {
    const { s, ids } = staged(2, [{ owner: 0, input: 'plate' }, { owner: 0, input: 'ore' }], [0, 0]);
    const { after, act } = roll(s);
    expect(gainOf(s, after, 0)).toBe(7);
    expect(act.map(e => [e.pieceId, e.outcome, e.amount])).toEqual([[ids[0], 'power', 5], [ids[1], 'power', 2]]);
    expect(sumFor(act, 0)).toBe(gainOf(s, after, 0));
  });

  it('three plants where the cap is reached on the second: the second gives what fits, the third gives nothing', () => {
    const { s, ids } = staged(3, [{ owner: 0, input: 'plate' }, { owner: 0, input: 'plate' }, { owner: 0, input: 'ore' }], [3, 0, 0]);
    const { after, act } = roll(s);
    expect(after.players[0]!.powerTokens).toBe(POWER_TOKEN_CAP);
    expect(act.map(e => [e.pieceId, e.outcome, e.amount])).toEqual([
      [ids[0], 'power', 5], [ids[1], 'power', POWER_TOKEN_CAP - 8], [ids[2], 'power-capped', 0],
    ]);
    expect(sumFor(act, 0)).toBe(gainOf(s, after, 0));
  });

  it('plants of two players on the same number: each player\'s events add up to their own change', () => {
    const { s } = staged(2, [{ owner: 0, input: 'ore' }, { owner: 1, input: 'plate' }], [1, 4]);
    const { after, act } = roll(s);
    expect(act.map(e => [e.seat, e.amount])).toEqual([[0, 2], [1, 5]]);
    for (const p of [0, 1] as PlayerId[]) expect(sumFor(act, p)).toBe(gainOf(s, after, p));
  });

  it('a plant with its owner\'s Teleporter on an empty input waits for the owner\'s choice, as before', () => {
    const { s, ids } = staged(2, [{ owner: 0, input: null, tele: true }, { owner: 0, input: 'ore' }], [0, 0]);
    const { after, act } = roll(s);
    expect(act.find(e => e.pieceId === ids[0])).toMatchObject({ outcome: 'awaiting-choice', amount: 0 });
    expect(act.find(e => e.pieceId === ids[1])).toMatchObject({ outcome: 'power', amount: 2 });
    expect(sumFor(act, 0)).toBe(gainOf(s, after, 0));
  });

  it('the roll line names each plant with its own number, and the table flies that many tokens from each', () => {
    const { s, ids } = staged(2, [{ owner: 0, input: 'plate' }, { owner: 0, input: 'ore' }], [0, 0]);
    const { after, events } = roll(s);
    const line = outcomeText(outcomeOf(1, events)!, n => ['Ann', 'Bea'][n]!, 0);
    expect(line).toContain('You rolled 5: Your Power Plant gave 5 Power Tokens; your Power Plant gave 2 Power Tokens.');
    const flights = planTransition(s, after, events).steps.filter(x => x.kind === 'toPlayer' && x.item === 'power');
    expect(flights.map(f => [f.kind === 'toPlayer' && f.from?.kind === 'piece' ? f.from.pieceId : null, f.kind === 'toPlayer' ? f.count : 0]))
      .toEqual([[ids[0], 5], [ids[1], 2]]);
  });
});
