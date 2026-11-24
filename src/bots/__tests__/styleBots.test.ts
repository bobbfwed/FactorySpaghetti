// The play-style bots: registered for the lobby, finish whole games at every table size without
// a single refused move, only ever send moves the move list offers, and are deterministic.
// Set FS_LONG_SIM=1 to run the long version (a few hundred seeded games per bot).

import { describe, expect, it } from 'vitest';
import type { Action } from '../../engine/actions';
import type { GameState, PlayerId } from '../../engine/state';
import { createGame } from '../../engine/rules/setup';
import { applyAction } from '../../engine/reducer';
import { isListedMove } from '../../engine/rules/legalActions';
import { BOT_TYPES, botById } from '../registry';
import type { BotFn } from '../botInterface';
import { STYLES, STYLE_BOTS } from '../styles/profiles';
import { makeStyleBot } from '../styles/styleBot';
import { combinations, playGame, seatRotations } from '../../sim/tournament';
import type { PlayerCount } from '../../sim/tournament';

const LONG = typeof process !== 'undefined' && process.env.FS_LONG_SIM === '1';
const ids = STYLES.map(s => s.id);
const entrants = new Map<string, BotFn>(STYLE_BOTS.map(b => [b.style.id, b.fn]));

describe('registry', () => {
  it('keeps Smart Bot first (the default) and Random Bot, and adds at least five styles', () => {
    expect(BOT_TYPES[0]).toMatchObject({ id: 'greedy', label: 'Smart Bot' });
    expect(BOT_TYPES.some(b => b.id === 'random' && b.label === 'Random Bot')).toBe(true);
    expect(STYLES.length).toBeGreaterThanOrEqual(5);
    const all = BOT_TYPES.map(b => b.id);
    expect(new Set(all).size).toBe(all.length);
    for (const s of STYLES) {
      expect(botById(s.id).label).toBe(s.label);
      expect(s.label).toMatch(/ Bot$/);
    }
  });
});

/** Mixed tables: every combination of distinct styles in turn, each seating rotated, each game on its own seed. */
function mixedTables(pc: PlayerCount, games: number, seed0: number): Array<{ seed: number; playerCount: PlayerCount; seats: string[] }> {
  const tables = combinations(ids, pc);
  return Array.from({ length: games }, (_, k) => {
    const t = tables[k % tables.length]!;
    return { seed: seed0 + k, playerCount: pc, seats: seatRotations(t)[k % pc]! };
  });
}

describe('style bots finish whole games', () => {
  for (const pc of [2, 3, 4] as const) {
    it(`${pc} players: every game ends (four Tesseracts or an empty board) with no refused move`, () => {
      const perBot = LONG ? 300 : 3;
      const games = Math.ceil((perBot * ids.length) / pc);
      const seen = new Map<string, number>();
      for (const spec of mixedTables(pc, games, 7000 + pc * 1000)) {
        const r = playGame(spec, entrants);
        expect(r.error, `seed ${spec.seed} [${spec.seats.join(', ')}]`).toBeUndefined();
        expect(['tesseracts', 'boardExhausted']).toContain(r.ending);
        for (const id of spec.seats) seen.set(id, (seen.get(id) ?? 0) + 1);
      }
      for (const id of ids) expect(seen.get(id) ?? 0).toBeGreaterThanOrEqual(LONG ? perBot * 0.8 : 1);
    }, LONG ? 3_600_000 : 120_000);
  }
});

/** Plays a game, calling `check` before each bot move (dice are rolled from a fixed sequence). */
function play(seed: number, seats: readonly BotFn[], check: (s: GameState, me: PlayerId, a: Action) => void): GameState {
  let s = createGame(seed, seats.length as PlayerCount);
  let n = 0;
  let d = seed;
  while (!s.gameOver && n < 12_000) {
    const me = (s.pendingFactoryOps[0]?.ownerId ?? s.turnOrder[s.activePlayerIndex])!;
    let a: Action;
    if (s.phase === 'roll' && s.pendingFactoryOps.length === 0) {
      a = { type: 'ROLL_DICE', rolls: Array.from({ length: s.mineCount }, () => { d = (d * 1103515245 + 12345) >>> 0; return 1 + (d >>> 16) % 6; }) };
    } else {
      a = seats[me]!(s, me);
      check(s, me, a);
    }
    const r = applyAction(s, a);
    if (!r.ok) throw new Error(`refused ${r.error.code}: ${JSON.stringify(a)}`);
    s = r.state;
    n++;
  }
  return s;
}

describe('style bots play only listed moves, deterministically', () => {
  it('every move is one the move list offers (the online host accepts only those)', () => {
    for (const pc of [2, 3, 4] as const) {
      const seats = STYLE_BOTS.slice(pc - 2, pc - 2 + pc).map(b => b.fn);
      let moves = 0;
      const end = play(31 + pc, seats, (s, me, a) => {
        moves++;
        expect(isListedMove(s, me, a), `${JSON.stringify(a)} in ${s.phase}`).toBe(true);
      });
      expect(end.gameOver).toBe(true);
      expect(moves).toBeGreaterThan(50);
    }
  }, 120_000);

  it('the same state gives the same move (also from a copied state), and a game replays exactly', () => {
    const seats = [STYLE_BOTS[0]!.fn, STYLE_BOTS[3]!.fn, STYLE_BOTS[5]!.fn];
    const fresh = [makeStyleBot(STYLES[0]!), makeStyleBot(STYLES[3]!), makeStyleBot(STYLES[5]!)];
    let i = 0;
    const log: string[] = [];
    const end = play(77, seats, (s, me, a) => {
      log.push(JSON.stringify(a));
      if (i++ % 3 !== 0) return;
      const copy = JSON.parse(JSON.stringify(s)) as GameState;
      expect(fresh[me]!(copy, me)).toEqual(a);
    });
    const again: string[] = [];
    const end2 = play(77, fresh, (_s, _me, a) => { again.push(JSON.stringify(a)); });
    expect(again).toEqual(log);
    expect(end2.winner).toBe(end.winner);
  }, 120_000);

  it('a roll request carries one die per Mine, 1–6, from the state (no Math.random)', () => {
    const real = Math.random;
    Math.random = (): number => { throw new Error('Math.random used'); };
    try {
      let s = createGame(5, 2);
      while (s.phase !== 'roll') {
        const me = s.turnOrder[s.activePlayerIndex]!;
        const r = applyAction(s, STYLE_BOTS[0]!.fn(s, me));
        if (!r.ok) throw new Error(r.error.code);
        s = r.state;
      }
      const me = s.turnOrder[s.activePlayerIndex]!;
      for (const { fn } of STYLE_BOTS) {
        const a = fn(s, me);
        expect(a.type).toBe('ROLL_DICE');
        if (a.type === 'ROLL_DICE') {
          expect(a.rolls).toHaveLength(s.mineCount);
          for (const d of a.rolls) expect(d >= 1 && d <= 6).toBe(true);
        }
      }
    } finally {
      Math.random = real;
    }
  });
});
