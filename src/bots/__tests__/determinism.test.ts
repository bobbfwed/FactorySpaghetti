// CLAUDE.md: "Use the seeded RNG for everything random. A game is fully described by (seed,
// action[])." No bot invents dice or any other random value: in the simulator the dice come from
// a stream seeded by the game seed and owned by the runner (online, the host rolls them), and every
// bot chooses deterministically from the state. So the same seed gives the identical game twice,
// for every kind of bot, and Math.random never appears in the bots' or the simulator's code.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { BotFn } from '../botInterface';
import { BOT_TYPES, SIM_ONLY_BOTS } from '../registry';
import { playGame } from '../../sim/tournament';
import type { GameRecord } from '../../sim/tournament';
import { runGame } from '../../sim/runGames';

const ALL = [...BOT_TYPES, ...SIM_ONLY_BOTS];
const entrants = new Map<string, BotFn>(ALL.map(b => [b.id, b.fn]));

/** The record without its wall-clock fields (speed only, not part of the result). */
function strip(r: GameRecord): Record<string, unknown> {
  const copy: Record<string, unknown> = { ...r };
  delete copy.ms;
  delete copy.timing;
  return copy;
}

describe('the same seed gives the identical game twice', () => {
  for (const bot of ALL) {
    it(`${bot.label} (${bot.id})`, () => {
      // A short random-fuzzer game can run long; cap it, the comparison still covers every move.
      const max = bot.id === 'random' ? 1500 : 12_000;
      const spec = { seed: 4242, playerCount: 3 as const, seats: [bot.id, 'planner', bot.id] };
      const a = playGame(spec, entrants, max);
      const b = playGame(spec, entrants, max);
      expect(strip(b)).toEqual(strip(a));
      expect(a.actions).toBeGreaterThan(100);
    }, 120_000);
  }

  it('the headless runner (runGames) rolls its own seeded dice: a game replays exactly', () => {
    const fns = [entrants.get('greedy')!, entrants.get('random')!];
    expect(runGame(17, 2, fns, 3000)).toEqual(runGame(17, 2, fns, 3000));
  }, 120_000);
});

describe('no Math.random in the bots or the simulator', () => {
  const root = join(__dirname, '..', '..');
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) { if (name !== '__tests__') walk(p); } else if (p.endsWith('.ts')) files.push(p);
    }
  };
  walk(join(root, 'bots'));
  walk(join(root, 'sim'));

  it('scans the source files of src/bots and src/sim', () => {
    expect(files.length).toBeGreaterThan(10);
    const pattern = new RegExp(['Math', 'random'].join('\\.') + '\\s*\\(');
    const offenders = files.filter(f => {
      // Comments may name it (to say it is not used); code may not call it.
      const code = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      return pattern.test(code);
    });
    expect(offenders).toEqual([]);
  });
});
