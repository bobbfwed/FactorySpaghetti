import { describe, expect, it } from 'vitest';
import type { GameRecord } from '../tournament';
import {
  aggregate, combinations, diceStream, fieldSchedule, formatReport, playGame, roundRobinSchedule, seatRotations, wilson,
} from '../tournament';
import { HOARDER, TELEPORTER } from '../../bots/styles/profiles';
import { makeStyleBot } from '../../bots/styles/styleBot';
import type { BotFn } from '../../bots/botInterface';

describe('seat rotation and schedules', () => {
  it('rotates a line-up so every entrant sits in every seat exactly once', () => {
    const rot = seatRotations(['a', 'b', 'c']);
    expect(rot).toEqual([['a', 'b', 'c'], ['b', 'c', 'a'], ['c', 'a', 'b']]);
    for (let seat = 0; seat < 3; seat++) expect(new Set(rot.map(r => r[seat])).size).toBe(3);
  });

  it('lists every table of distinct entrants', () => {
    expect(combinations(['a', 'b', 'c', 'd'], 2)).toHaveLength(6);
    expect(combinations(['a', 'b', 'c', 'd'], 3)).toEqual([['a', 'b', 'c'], ['a', 'b', 'd'], ['a', 'c', 'd'], ['b', 'c', 'd']]);
    expect(combinations(['a'], 2)).toEqual([]);
  });

  it('round robin: same seed for all rotations of a table, each bot equally in each seat', () => {
    const specs = roundRobinSchedule(['a', 'b', 'c', 'd'], 3, 2, 100);
    expect(specs).toHaveLength(4 * 2 * 3);
    // Each seed is played in all three rotations of one table.
    const bySeed = new Map<number, string[][]>();
    for (const s of specs) bySeed.set(s.seed, [...(bySeed.get(s.seed) ?? []), [...s.seats]]);
    expect(bySeed.size).toBe(8);
    for (const seatings of bySeed.values()) expect(seatings).toHaveLength(3);
    for (const id of ['a', 'b', 'c', 'd']) {
      const perSeat = [0, 1, 2].map(seat => specs.filter(s => s.seats[seat] === id).length);
      expect(new Set(perSeat).size).toBe(1);
    }
  });

  it('field: each challenger in every seat against the baseline, on the same seeds', () => {
    const specs = fieldSchedule(['x', 'y'], 'base', 4, 3, 7);
    expect(specs).toHaveLength(2 * 3 * 4);
    for (const c of ['x', 'y']) {
      const mine = specs.filter(s => s.seats.includes(c));
      expect(mine.map(s => s.seed).sort()).toEqual([7, 7, 7, 7, 8, 8, 8, 8, 9, 9, 9, 9]);
      for (let seat = 0; seat < 4; seat++) expect(mine.filter(s => s.seats[seat] === c)).toHaveLength(3);
      for (const s of mine) expect(s.seats.filter(id => id === 'base')).toHaveLength(3);
    }
  });
});

describe('confidence interval', () => {
  it('matches the Wilson score interval', () => {
    const ci = wilson(50, 100);
    expect(ci.low).toBeCloseTo(0.4038, 3);
    expect(ci.high).toBeCloseTo(0.5962, 3);
    const zero = wilson(0, 20);
    expect(zero.low).toBe(0);
    expect(zero.high).toBeCloseTo(0.1611, 3);
    expect(wilson(0, 0)).toEqual({ low: 0, high: 1 });
  });
});

function rec(over: Partial<GameRecord>): GameRecord {
  return {
    seed: 1, playerCount: 2, seats: ['a', 'b'], turnPosition: [0, 1], winners: [0], ending: 'tesseracts',
    rounds: 10, actions: 100, points: [10, 20], tesseracts: [4, 0], bonuses: [0, 1],
    bonusHolders: { investor: -1, beltWeaver: 1, factoryEmpire: -1 },
    bonusFirst: { investor: null, beltWeaver: { round: 3, seat: 1 }, factoryEmpire: null },
    bonusMoves: { investor: 0, beltWeaver: 0, factoryEmpire: 0 },
    firstTesseractRound: [5, -1],
    mines: [{ round: 4, boughtBy: 0 }, { round: 8, boughtBy: -1 }],
    cardsBought: [2, 0],
    coClaims: [0, 1],
    ...over,
  };
}

describe('aggregation', () => {
  it('counts wins, shared wins, endings, bonuses and turn positions per bot', () => {
    const records = [
      rec({}),
      rec({ seats: ['b', 'a'], turnPosition: [1, 0], winners: [1], points: [5, 7], tesseracts: [0, 4] }),
      rec({
        winners: [0, 1], ending: 'boardExhausted', points: [30, 30], tesseracts: [0, 0], bonuses: [0, 0],
        bonusHolders: { investor: 0, beltWeaver: -1, factoryEmpire: -1 },
        bonusFirst: { investor: { round: 6, seat: 1 }, beltWeaver: { round: 3, seat: 1 }, factoryEmpire: null },
        bonusMoves: { investor: 1, beltWeaver: 0, factoryEmpire: 0 },
        firstTesseractRound: [-1, -1],
      }),
      rec({ winners: [], ending: 'actionLimit', rounds: 40 }),
    ];
    const summary = aggregate(records);
    const { bots, seats } = summary;
    const a = bots.find(b => b.id === 'a')!;
    const b = bots.find(b => b.id === 'b')!;
    expect(a.games).toBe(4);
    expect(a.wins).toBeCloseTo(2.5);
    expect(b.wins).toBeCloseTo(0.5);
    expect(a.winRate).toBeCloseTo(0.625);
    expect(a.vsShare).toBeCloseTo(1.25);
    expect(a.endings).toEqual({ tesseracts: 2, boardExhausted: 1, actionLimit: 1, error: 0 });
    expect(a.winsBy).toEqual({ tesseracts: 2, boardExhausted: 0.5 });
    expect(a.avgRounds).toBeCloseTo((10 + 10 + 10 + 40) / 4);
    expect(a.avgPoints).toBeCloseTo((10 + 7 + 30 + 10) / 4);
    expect(a.bonusRate.investor).toBeCloseTo(0.25);
    expect(b.bonusRate.beltWeaver).toBeCloseTo(0.5); // games 1 and 4 (seat 1 is b there)
    // 'a' was the starting player (position 0) in all four games.
    expect(a.byPosition[0]).toEqual({ games: 4, wins: 2.5 });
    expect(a.byPosition[1]).toEqual({ games: 0, wins: 0 });
    expect(b.byPosition[1]).toEqual({ games: 4, wins: 0.5 });
    expect(seats).toHaveLength(1);
    expect(seats[0]!.games).toBe(4);
    expect(seats[0]!.byPosition.map(p => p.wins)).toEqual([2.5, 0.5]);
    // Per-bot facts: cards, Mines bought, claims onto others' buildings, first Tesseract.
    expect(a.avgCardsBought).toBeCloseTo((2 + 0 + 2 + 2) / 4);
    expect(a.minesBought).toBeCloseTo(0.75);
    expect(b.avgCoClaims).toBeCloseTo(0.75);
    expect(a.avgFirstTesseractRound).toBeCloseTo(5);
    expect(Number.isNaN(b.avgFirstTesseractRound)).toBe(false);
    // Bonus Tesseracts: Belt Weaver taken in round 3 in three games and kept; the Investor changed hands once.
    const weaver = summary.bonuses.find(x => x.kind === 'beltWeaver')!;
    expect(weaver.heldAtEnd).toBeCloseTo(0.75);
    expect(weaver.avgFirstRound).toBeCloseTo(3);
    expect(weaver.keptByFirst).toBeCloseTo(0.75);
    const investor = summary.bonuses.find(x => x.kind === 'investor')!;
    expect(investor.avgMoves).toBeCloseTo(0.25);
    expect(investor.keptByFirst).toBe(0);
    expect(investor.holderWinRate).toBeCloseTo(0.5);
    const text = formatReport(summary);
    expect(text).toContain('2 players');
    expect(text).toContain('Bonus Tesseracts');
  });
});

function strip(r: GameRecord): Omit<GameRecord, 'ms'> {
  const rest: { -readonly [K in keyof GameRecord]?: GameRecord[K] } = { ...r };
  delete rest.ms;
  return rest as Omit<GameRecord, 'ms'>;
}

describe('playing a game', () => {
  const bots = new Map<string, BotFn>([['hoarder', makeStyleBot(HOARDER)], ['teleporter', makeStyleBot(TELEPORTER)]]);

  it('is reproducible: same seed and seating give the same game', () => {
    const spec = { seed: 42, playerCount: 2 as const, seats: ['hoarder', 'teleporter'] };
    const a = playGame(spec, bots, 12_000, () => 0);
    expect(a.ending === 'tesseracts' || a.ending === 'boardExhausted').toBe(true);
    expect(strip(playGame(spec, bots))).toEqual(strip(a));
    expect(a.turnPosition.slice().sort()).toEqual([0, 1]);
  });

  it('rolls its own dice from the seed (a bot cannot choose them)', () => {
    const s1 = diceStream(9);
    const s2 = diceStream(9);
    expect(s1).toBe(s2);
    expect(diceStream(10)).not.toBe(s1);
    // A bot that asks for double sixes every roll still gets the seeded dice.
    const cheat: BotFn = (state, me) => state.phase === 'roll' ? { type: 'ROLL_DICE', rolls: [6, 6, 6].slice(0, state.mineCount) } : bots.get('hoarder')!(state, me);
    const withCheat = new Map(bots);
    withCheat.set('cheat', cheat);
    const r1 = playGame({ seed: 5, playerCount: 2, seats: ['cheat', 'teleporter'] }, withCheat);
    const r2 = playGame({ seed: 5, playerCount: 2, seats: ['hoarder', 'teleporter'] }, withCheat);
    expect({ ...strip(r1), seats: [] }).toEqual({ ...strip(r2), seats: [] });
  });

  it('collects the extra balance statistics consistently with the rest of the record', () => {
    const r = playGame({ seed: 42, playerCount: 2, seats: ['hoarder', 'teleporter'] }, bots);
    const x = r.extra!;
    expect(x).toBeDefined();
    for (let seat = 0; seat < 2; seat++) {
      const placed = Object.values(x.meeple[seat]!).reduce((s, n) => s + n, 0);
      // One meeple decision (a spot or none) per own turn, at most; a game can end mid-turn.
      expect(placed).toBeGreaterThan(0);
      expect(placed).toBeLessThanOrEqual(r.turns![seat]!);
      expect(x.turnsAtPowerCap[seat]).toBeLessThanOrEqual(r.turns![seat]!);
      expect(x.powerAtTurnStart[seat]).toBeLessThanOrEqual(10 * r.turns![seat]!);
      expect(x.finalPower[seat]).toBeGreaterThanOrEqual(0);
      expect(x.cardsPlayed[seat]).toBeGreaterThanOrEqual(0);
      expect(x.buildings[seat]).toBeGreaterThanOrEqual(1); // the two setup claims (unless lost)
      expect(x.topModule[seat]).toBeGreaterThanOrEqual(2);
    }
    // The Teleporter Bot places teleporters.
    expect(x.teleportersPlaced[1]).toBeGreaterThan(0);
  });

  it('records a refused move as an error with its action number', () => {
    const bad: BotFn = () => ({ type: 'END_TURN' });
    const r = playGame({ seed: 3, playerCount: 2, seats: ['bad', 'hoarder'] }, new Map([...bots, ['bad', bad]]));
    expect(r.ending).toBe('error');
    expect(r.error).toMatch(/action \d+/);
  });
});
