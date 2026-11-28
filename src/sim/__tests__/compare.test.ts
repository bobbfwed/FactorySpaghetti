import { describe, expect, it } from 'vitest';
import type { GameRecord } from '../tournament';
import { playGame } from '../tournament';
import {
  gauntletSchedule, headToHead, headToHeadSchedule, heroSeat, meanInterval, pairedCompare, speedTable, takeoverSchedule,
} from '../compare';
import { PLANNER, HOARDER } from '../../bots/styles/profiles';
import { makeStyleBot } from '../../bots/styles/styleBot';
import type { BotFn } from '../../bots/botInterface';

function rec(over: Partial<GameRecord>): GameRecord {
  return {
    seed: 1, playerCount: 2, seats: ['a', 'x'], turnPosition: [0, 1], winners: [0], ending: 'tesseracts',
    rounds: 10, actions: 100, points: [0, 0], tesseracts: [0, 0], bonuses: [0, 0],
    bonusHolders: { investor: -1, beltWeaver: -1, factoryEmpire: -1 },
    bonusFirst: { investor: null, beltWeaver: null, factoryEmpire: null },
    bonusMoves: { investor: 0, beltWeaver: 0, factoryEmpire: 0 },
    firstTesseractRound: [-1, -1], mines: [], cardsBought: [0, 0], coClaims: [0, 0],
    ...over,
  };
}

describe('schedules', () => {
  it('gauntlet: the hero alone at one field table per seed, in every seat, tables cycled', () => {
    const specs = gauntletSchedule('h', ['a', 'b', 'c'], 3, 4, 10);
    expect(specs).toHaveLength(4 * 3);
    for (const s of specs) expect(s.seats.filter(x => x === 'h')).toHaveLength(1);
    const tables = [...new Set(specs.map(s => `${s.seed}:${[...s.seats].filter(x => x !== 'h').sort().join('')}`))];
    expect(tables).toEqual(['10:ab', '11:ac', '12:bc', '13:ab']);
    for (let seat = 0; seat < 3; seat++) expect(specs.filter(s => s.seats[seat] === 'h')).toHaveLength(4);
  });

  it('head-to-head: each bot fills half of all seats', () => {
    for (const pc of [2, 3, 4] as const) {
      const specs = headToHeadSchedule('a', 'b', pc, 2, 1);
      const a = specs.reduce((n, s) => n + s.seats.filter(x => x === 'a').length, 0);
      const b = specs.reduce((n, s) => n + s.seats.filter(x => x === 'b').length, 0);
      expect(a).toBe(b);
    }
  });

  it('takeover: every seat of a field table, from the same seeded move', () => {
    const specs = takeoverSchedule('h', ['a', 'b', 'c'], 2, 2, 5);
    expect(specs).toHaveLength(2 * 2);
    expect(specs[0]!.takeover!.atAction).toBe(specs[1]!.takeover!.atAction);
    expect(specs.map(s => s.takeover!.seat)).toEqual([0, 1, 0, 1]);
    for (const s of specs) expect(s.takeover!.atAction).toBeGreaterThanOrEqual(150);
  });
});

describe('paired comparison', () => {
  it('pairs the same game played by two heroes and measures the difference', () => {
    const records = [
      rec({ seats: ['a', 'x'], winners: [0] }), rec({ seats: ['b', 'x'], winners: [1] }),
      rec({ seed: 2, seats: ['x', 'a'], winners: [1] }), rec({ seed: 2, seats: ['x', 'b'], winners: [1] }),
      rec({ seed: 3, playerCount: 3, seats: ['x', 'y', 'a'], winners: [0] }),
      rec({ seed: 3, playerCount: 3, seats: ['x', 'y', 'b'], winners: [2] }),
    ];
    const rows = pairedCompare(records, 'a', 'b');
    const two = rows.find(r => r.playerCount === 2)!;
    expect(two.games).toBe(2);
    expect(two.rateA).toBe(1);
    expect(two.rateB).toBe(0.5);
    expect(two.diff).toBe(0.5);
    const all = rows.find(r => r.playerCount === 'all')!;
    expect(all.games).toBe(3);
    // Differences in "times the even share": +2, 0, −3.
    expect(all.diff).toBeCloseTo(-1 / 3, 6);
  });

  it('a takeover game belongs to the bot that took over', () => {
    const r = rec({ seats: ['x', 'y'], takeover: { atAction: 200, seat: 1, bot: 'h' } });
    expect(heroSeat(r, 'h')).toBe(1);
    expect(heroSeat(r, 'x')).toBe(-1);
  });

  it('mean interval', () => {
    const iv = meanInterval([1, 0, 1, 0]);
    expect(iv.mean).toBe(0.5);
    expect(iv.low).toBeLessThan(0.5);
    expect(iv.high).toBeGreaterThan(0.5);
  });

  it('head-to-head shares', () => {
    const rows = headToHead([rec({ seats: ['a', 'b'], winners: [0] }), rec({ seats: ['b', 'a'], winners: [0] })], 'a', 'b');
    expect(rows[0]!.rateA).toBe(0.5);
  });
});

describe('playGame extras', () => {
  const bots = new Map<string, BotFn>([['planner', makeStyleBot(PLANNER)], ['hoarder', makeStyleBot(HOARDER)]]);
  it('counts moves and turns, times decisions, and hands a seat over mid-game', () => {
    let t = 0;
    const r = playGame({ seed: 3, playerCount: 2, seats: ['planner', 'planner'], takeover: { atAction: 100, seat: 1, bot: 'hoarder' } },
      bots, 12_000, () => (t += 1), true);
    expect(r.ending === 'tesseracts' || r.ending === 'boardExhausted').toBe(true);
    expect(r.takeover).toEqual({ atAction: 100, seat: 1, bot: 'hoarder' });
    expect(r.moves![0]).toBeGreaterThan(0);
    expect(r.turns![0]).toBeGreaterThan(5);
    expect(r.timing![0]).toHaveLength(r.moves![0]!);
    const speed = speedTable([r]);
    expect(speed.map(s => s.id)).toEqual(['planner']); // the taken-over seat is left out
    expect(speed[0]!.median).toBe(1);
  });
});
