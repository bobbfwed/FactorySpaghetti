// Command-line bot tournament: `npm run sim -- [options]`. Plays the seeded schedule from
// tournament.ts, prints a table per player count and can write every game to a JSON file.
//
//   --mode field|all     field: each bot alone against a table of --baseline bots (default);
//                        all: every table of distinct bots ("everyone against everyone");
//                        mirror: tables of one bot only, one game per seed (seat effects)
//                        gauntlet: each bot alone at tables of --field bots (one table per seed,
//                        cycled; every seat); with two or more bots, a paired comparison of the
//                        first bot with each other one on the same games
//                        h2h: the first two bots head-to-head (2p both orders; 3p/4p each alone
//                        against a table of the other)
//                        takeover: --field tables play until a seeded move 150-450, then each bot
//                        in turn takes over one seat (stand-in test); paired like gauntlet
//   --field a,b,c        the gauntlet / takeover field (default: the six play styles)
//   --timing             record the time of every decision; report median / 95th / worst
//   --bots a,b,c         bot ids (default: every registry bot except Random Bot)
//   --baseline id        the field's bot (default greedy = Smart Bot)
//   --players 2,3,4      player counts (default 2,3,4)
//   --seeds N            seeds per challenger (field) or per table (all); default 10
//   --start S            first seed (default 1)
//   --max-actions N      action limit per game (default 12000)
//   --jobs N             split the games over N processes (default 1)
//   --import file.ts     load a module first: its default export (Entrant[]) adds bots, and any
//                        side effect applies (e.g. a config variant for this run); repeatable
//   --out file.json      write the games and the summary
//   --merge a.json,b.json  summarise saved runs instead of playing
//
// A config variant changes the object-valued tunables of engine/config.ts in place for this
// process only (arrays and tables such as MINE_COSTS, CARD_COUNTS, STACK_COMPOSITION,
// BONUS_THRESHOLDS); plain numbers and functions exported from config cannot be changed this way.

import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BOT_TYPES, SIM_ONLY_BOTS } from '../bots/registry';
import { STYLES } from '../bots/styles/profiles';
import type { BotFn } from '../bots/botInterface';
import type { Entrant, GameRecord, GameSpec, PlayerCount } from './tournament';
import { aggregate, fieldSchedule, formatReport, mirrorSchedule, playGame, roundRobinSchedule } from './tournament';
import {
  formatHeadToHead, formatPaired, formatSpeed, gauntletSchedule, headToHead, headToHeadSchedule, pairedCompare,
  speedTable, takeoverSchedule,
} from './compare';

interface Opts {
  mode: 'field' | 'all' | 'mirror' | 'gauntlet' | 'h2h' | 'takeover';
  field: string[];
  timing: boolean;
  bots: string[];
  baseline: string;
  players: PlayerCount[];
  seeds: number;
  start: number;
  maxActions: number;
  jobs: number;
  shard: [number, number] | null;
  imports: string[];
  out: string | null;
  merge: string[];
}

function parse(argv: readonly string[]): Opts {
  const o: Opts = {
    mode: 'field', field: [], timing: false, bots: [], baseline: 'greedy', players: [2, 3, 4], seeds: 10, start: 1,
    maxActions: 12_000, jobs: 1, shard: null, imports: [], out: null, merge: [],
  };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i]!;
    const v = (): string => {
      const x = argv[++i];
      if (x === undefined) throw new Error(`${k} needs a value`);
      return x;
    };
    switch (k) {
      case '--mode': {
        const m = v();
        if (m !== 'field' && m !== 'all' && m !== 'mirror' && m !== 'gauntlet' && m !== 'h2h' && m !== 'takeover') {
          throw new Error('--mode is field, all, mirror, gauntlet, h2h or takeover');
        }
        o.mode = m;
        break;
      }
      case '--field': o.field = v().split(',').filter(Boolean); break;
      case '--timing': o.timing = true; break;
      case '--bots': o.bots = v().split(',').filter(Boolean); break;
      case '--baseline': o.baseline = v(); break;
      case '--players': o.players = v().split(',').map(Number).filter((n): n is PlayerCount => n === 2 || n === 3 || n === 4); break;
      case '--seeds': o.seeds = Number(v()); break;
      case '--start': o.start = Number(v()); break;
      case '--max-actions': o.maxActions = Number(v()); break;
      case '--jobs': o.jobs = Math.max(1, Number(v())); break;
      case '--shard': { const [a, b] = v().split('/').map(Number); o.shard = [a!, b!]; break; }
      case '--import': o.imports.push(v()); break;
      case '--out': o.out = v(); break;
      case '--merge': o.merge = v().split(',').filter(Boolean); break;
      case '--': break;
      default: throw new Error(`unknown option ${k}`);
    }
  }
  return o;
}

const write = (s: string): void => { process.stdout.write(`${s}\n`); };

async function entrants(o: Opts): Promise<Map<string, BotFn>> {
  const m = new Map<string, BotFn>([...BOT_TYPES, ...SIM_ONLY_BOTS].map(b => [b.id, b.fn]));
  for (const f of o.imports) {
    // A plain path, not a file URL: vite-node cannot load a file URL whose path has a space
    // (it is percent-encoded), and the repo sits in "Factory Spaghetti".
    const mod = (await import(/* @vite-ignore */ resolve(f).replace(/\\/g, '/'))) as { default?: readonly Entrant[] };
    for (const e of mod.default ?? []) m.set(e.id, e.fn);
  }
  return m;
}

function schedule(o: Opts): GameSpec[] {
  const ids = o.bots.length > 0 ? o.bots : BOT_TYPES.map(b => b.id).filter(id => id !== 'random');
  const specs: GameSpec[] = [];
  for (const pc of o.players) {
    if (o.mode === 'all') specs.push(...roundRobinSchedule(ids, pc, o.seeds, o.start));
    else if (o.mode === 'mirror') specs.push(...mirrorSchedule(ids, pc, o.seeds, o.start));
    else if (o.mode === 'gauntlet') for (const id of ids) specs.push(...gauntletSchedule(id, fieldOf(o), pc, o.seeds, o.start));
    else if (o.mode === 'takeover') for (const id of ids) specs.push(...takeoverSchedule(id, fieldOf(o), pc, o.seeds, o.start));
    else if (o.mode === 'h2h') specs.push(...headToHeadSchedule(ids[0]!, ids[1]!, pc, o.seeds, o.start));
    else specs.push(...fieldSchedule(ids.filter(id => id !== o.baseline), o.baseline, pc, o.seeds, o.start));
  }
  return specs;
}

function fieldOf(o: Opts): string[] {
  return o.field.length > 0 ? o.field : STYLES.map(s => s.id);
}

function label(id: string): string {
  return [...BOT_TYPES, ...SIM_ONLY_BOTS].find(b => b.id === id)?.label ?? id;
}

function report(records: readonly GameRecord[], o: Opts): void {
  const agg = aggregate(records.filter(r => !r.takeover));
  if (agg.bots.length > 0) write(formatReport(agg, label));
  const heroes = o.bots;
  if (o.mode === 'gauntlet' || o.mode === 'takeover') {
    for (const h of heroes.slice(1)) write(formatPaired(pairedCompare(records, heroes[0]!, h), heroes[0]!, h));
  }
  if (o.mode === 'takeover') {
    for (const h of heroes) {
      const rs = records.filter(r => r.takeover?.bot === h);
      const won = rs.reduce((s, r) => s + (r.takeover && r.winners.includes(r.takeover.seat) ? 1 / r.winners.length : 0), 0);
      const unfinished = rs.filter(r => r.ending === 'actionLimit').length;
      const errors = rs.filter(r => r.ending === 'error').length;
      write(`  stand-in ${h}: ${rs.length} games, won ${won.toFixed(1)}, unfinished ${unfinished}, errors ${errors}`);
    }
  }
  if (o.mode === 'h2h' && heroes.length >= 2) write(formatHeadToHead(headToHead(records, heroes[0]!, heroes[1]!), heroes[0]!, heroes[1]!));
  if (records.some(r => r.moves)) write(formatSpeed(speedTable(records)));
  const errors = records.filter(r => r.ending === 'error');
  for (const r of errors.slice(0, 20)) write(`ERROR seed ${r.seed} ${r.playerCount}p [${r.seats.join(', ')}]: ${r.error ?? ''}`);
  const timed = records.filter(r => r.ms !== undefined);
  if (timed.length > 0) {
    const total = timed.reduce((s, r) => s + r.ms!, 0);
    write(`\n${records.length} games; ${(total / timed.length / 1000).toFixed(2)} s per game on average (one process).`);
  }
}

function save(file: string, o: Opts | null, records: readonly GameRecord[]): void {
  writeFileSync(file, JSON.stringify({ options: o, summary: aggregate(records), games: records }, null, 1));
}

async function runChildren(o: Opts, argv: readonly string[]): Promise<GameRecord[]> {
  const dir = mkdtempSync(join(tmpdir(), 'fs-sim-'));
  const script = fileURLToPath(import.meta.url);
  const runner = process.argv[1]!;
  const base: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--jobs' || argv[i] === '--out' || argv[i] === '--shard') { i++; continue; }
    if (argv[i] !== '--') base.push(argv[i]!);
  }
  const files: string[] = [];
  await Promise.all(Array.from({ length: o.jobs }, (_, i) => new Promise<void>((done, fail) => {
    const file = join(dir, `shard-${i}.json`);
    files.push(file);
    const child = spawn(process.execPath, [runner, script, '--', ...base, '--shard', `${i}/${o.jobs}`, '--out', file], { stdio: ['ignore', 'ignore', 'inherit'] });
    child.on('exit', code => (code === 0 ? done() : fail(new Error(`shard ${i} exited with ${String(code)}`))));
  })));
  const records: GameRecord[] = [];
  for (const f of files) records.push(...(JSON.parse(readFileSync(f, 'utf8')) as { games: GameRecord[] }).games);
  return records;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const o = parse(argv);
  if (o.merge.length > 0) {
    const records: GameRecord[] = [];
    for (const f of o.merge) records.push(...(JSON.parse(readFileSync(f, 'utf8')) as { games: GameRecord[] }).games);
    report(records, o);
    if (o.out) save(o.out, null, records);
    return;
  }
  let records: GameRecord[];
  if (o.jobs > 1 && !o.shard) {
    const t0 = Date.now();
    records = await runChildren(o, argv);
    write(`(${o.jobs} processes, ${((Date.now() - t0) / 1000).toFixed(0)} s wall clock)`);
  } else {
    const bots = await entrants(o);
    const specs = schedule(o).filter((_, i) => !o.shard || i % o.shard[1] === o.shard[0]);
    records = [];
    for (const spec of specs) records.push(playGame(spec, bots, o.maxActions, () => performance.now(), o.timing));
  }
  if (!o.shard) report(records, o);
  if (o.out) save(o.out, o, records);
}

main().catch((e: unknown) => {
  process.stderr.write(`${(e as Error).stack ?? String(e)}\n`);
  process.exit(1);
});
