// Command-line bot tournament: `npm run sim -- [options]`. Plays the seeded schedule from
// tournament.ts, prints a table per player count and can write every game to a JSON file.
//
//   --mode field|all     field: each bot alone against a table of --baseline bots (default);
//                        all: every table of distinct bots ("everyone against everyone");
//                        mirror: tables of one bot only, one game per seed (seat effects)
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
import { fileURLToPath, pathToFileURL } from 'node:url';
import { BOT_TYPES } from '../bots/registry';
import type { BotFn } from '../bots/botInterface';
import type { Entrant, GameRecord, GameSpec, PlayerCount } from './tournament';
import { aggregate, fieldSchedule, formatReport, mirrorSchedule, playGame, roundRobinSchedule } from './tournament';

interface Opts {
  mode: 'field' | 'all' | 'mirror';
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
    mode: 'field', bots: [], baseline: 'greedy', players: [2, 3, 4], seeds: 10, start: 1,
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
      case '--mode': { const m = v(); if (m !== 'field' && m !== 'all' && m !== 'mirror') throw new Error('--mode is field, all or mirror'); o.mode = m; break; }
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
  const m = new Map<string, BotFn>(BOT_TYPES.map(b => [b.id, b.fn]));
  for (const f of o.imports) {
    const mod = (await import(pathToFileURL(resolve(f)).href)) as { default?: readonly Entrant[] };
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
    else specs.push(...fieldSchedule(ids.filter(id => id !== o.baseline), o.baseline, pc, o.seeds, o.start));
  }
  return specs;
}

function label(id: string): string {
  return BOT_TYPES.find(b => b.id === id)?.label ?? id;
}

function report(records: readonly GameRecord[]): void {
  const agg = aggregate(records);
  write(formatReport(agg, label));
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
    report(records);
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
    for (const spec of specs) records.push(playGame(spec, bots, o.maxActions, () => performance.now()));
  }
  if (!o.shard) report(records);
  if (o.out) save(o.out, o, records);
}

main().catch((e: unknown) => {
  process.stderr.write(`${(e as Error).stack ?? String(e)}\n`);
  process.exit(1);
});
