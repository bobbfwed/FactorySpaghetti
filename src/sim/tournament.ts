// Headless bot tournament: seeded games for 2, 3 and 4 players with every bot sitting in every
// seat equally, and per-bot statistics (wins with a 95% confidence interval, rounds, how games
// ended, final points, Bonus Tesseracts, win rate by turn position).
//
// Fair and reproducible: the dice are rolled here from a stream seeded by the game seed (a bot's
// own dice are ignored), and a seat rotation replays the same seed, so every line-up of a table
// meets the same board, the same stacks and the same dice. A game is (seed, seating) → result.
// Pure apart from the optional clock reading for speed figures (GameRecord.ms).

import type { Action } from '../engine/actions';
import type { GameState, PlayerId } from '../engine/state';
import type { BotFn } from '../bots/botInterface';
import { createGame } from '../engine/rules/setup';
import { applyAction } from '../engine/reducer';
import { createRng, nextIntBelow } from '../engine/rng';
import type { RngState } from '../engine/rng';
import { resourcePoints } from '../engine/rules/scoring';

export type PlayerCount = 2 | 3 | 4;

export interface Entrant {
  readonly id: string;
  readonly fn: BotFn;
}

export interface GameSpec {
  readonly seed: number;
  readonly playerCount: PlayerCount;
  /** Entrant id for each player id (seat). */
  readonly seats: readonly string[];
}

export type Ending = 'tesseracts' | 'boardExhausted' | 'actionLimit' | 'error';

export interface GameRecord {
  readonly seed: number;
  readonly playerCount: PlayerCount;
  readonly seats: readonly string[];
  /** For each seat, its place in the first round's turn order (0 = starting player). */
  readonly turnPosition: readonly number[];
  /** Winning seats: one, several for a shared board-exhaustion win, none if unfinished. */
  readonly winners: readonly number[];
  readonly ending: Ending;
  readonly rounds: number;
  readonly actions: number;
  /** Final inventory points (the board-exhaustion score) per seat. */
  readonly points: readonly number[];
  /** Real Tesseracts in inventory at the end, per seat. */
  readonly tesseracts: readonly number[];
  /** Bonus Tesseracts face-up at the end, per seat (0–3). */
  readonly bonuses: readonly number[];
  /** Holder of each Bonus Tesseract at the end (seat), or -1. */
  readonly bonusHolders: { readonly investor: number; readonly beltWeaver: number; readonly factoryEmpire: number };
  /** What went wrong, with the action number, when ending = 'error'. */
  readonly error?: string;
  /** Wall-clock milliseconds (speed only; not part of the result). */
  readonly ms?: number;
}

// ── Schedules ─────────────────────────────────────────────────────────────────

/** The cyclic shifts of a line-up: each entrant sits in each seat exactly once. */
export function seatRotations<T>(lineup: readonly T[]): T[][] {
  return lineup.map((_, k) => lineup.map((__, i) => lineup[(i + k) % lineup.length]!));
}

/** All k-element subsets of `items`, in order. */
export function combinations<T>(items: readonly T[], k: number): T[][] {
  const out: T[][] = [];
  const pick = (start: number, acc: T[]): void => {
    if (acc.length === k) { out.push([...acc]); return; }
    for (let i = start; i < items.length; i++) { acc.push(items[i]!); pick(i + 1, acc); acc.pop(); }
  };
  pick(0, []);
  return out;
}

/**
 * "Everyone against everyone": every table of distinct entrants (all combinations), each
 * played on `seedsPerTable` seeds, each seed in every seat rotation.
 */
export function roundRobinSchedule(ids: readonly string[], playerCount: PlayerCount, seedsPerTable: number, startSeed: number): GameSpec[] {
  const specs: GameSpec[] = [];
  const tables = ids.length >= playerCount ? combinations(ids, playerCount) : [];
  let seed = startSeed;
  for (const table of tables) {
    for (let s = 0; s < seedsPerTable; s++, seed++) {
      for (const seats of seatRotations(table)) specs.push({ seed, playerCount, seats });
    }
  }
  return specs;
}

/**
 * "One against the field": each challenger at a table of `baseline` bots, on `seeds` seeds,
 * in every seat rotation. The same seeds are used for every challenger.
 */
export function fieldSchedule(challengers: readonly string[], baseline: string, playerCount: PlayerCount, seeds: number, startSeed: number): GameSpec[] {
  const specs: GameSpec[] = [];
  for (const c of challengers) {
    const lineup = [c, ...new Array<string>(playerCount - 1).fill(baseline)];
    for (let s = 0; s < seeds; s++) {
      for (const seats of seatRotations(lineup)) specs.push({ seed: startSeed + s, playerCount, seats });
    }
  }
  return specs;
}

// ── Playing a game ────────────────────────────────────────────────────────────

/** The dice stream for a game: seeded by the game seed, independent of the engine's shuffles. */
export function diceStream(seed: number): RngState {
  return createRng((Math.imul(seed, 0x9e3779b1) ^ 0x5bd1e995) >>> 0);
}

function roll(rng: RngState, count: number): [number[], RngState] {
  const dice: number[] = [];
  let s = rng;
  for (let i = 0; i < count; i++) {
    const [v, n] = nextIntBelow(s, 6);
    dice.push(v + 1);
    s = n;
  }
  return [dice, s];
}

/** Whose move it is: an owner's pending operate-or-skip decision comes first. */
function mover(state: GameState): PlayerId | undefined {
  const pend = state.pendingFactoryOps[0];
  return pend ? pend.ownerId : state.turnOrder[state.activePlayerIndex];
}

export function playGame(spec: GameSpec, entrants: ReadonlyMap<string, BotFn>, maxActions = 12_000, clock?: () => number): GameRecord {
  const t0 = clock?.();
  let state = createGame(spec.seed, spec.playerCount);
  const turnPosition = spec.seats.map((_, seat) => state.turnOrder.indexOf(seat as PlayerId));
  let dice = diceStream(spec.seed);
  let actions = 0;
  let error: string | undefined;
  const bots = spec.seats.map(id => {
    const fn = entrants.get(id);
    if (!fn) throw new Error(`unknown bot "${id}"`);
    return fn;
  });

  while (!state.gameOver && actions < maxActions) {
    const who = mover(state);
    if (who === undefined) { error = `no player to move at action ${actions}`; break; }
    let action: Action;
    if (state.phase === 'roll' && state.pendingFactoryOps.length === 0) {
      const [d, next] = roll(dice, state.mineCount);
      dice = next;
      action = { type: 'ROLL_DICE', rolls: d };
    } else {
      try {
        action = bots[who]!(state, who);
      } catch (e) {
        error = `bot ${spec.seats[who]} (seat ${who}) threw at action ${actions}: ${(e as Error).message}`;
        break;
      }
    }
    const res = applyAction(state, action);
    if (!res.ok) {
      error = `bot ${spec.seats[who]} (seat ${who}) sent a refused move at action ${actions} ` +
        `(round ${state.round}, ${state.phase}): ${res.error.code} ${JSON.stringify(action)}`;
      break;
    }
    state = res.state;
    actions++;
  }

  const ending: Ending = error ? 'error' : state.gameOver ? (state.gameOverReason ?? 'boardExhausted') : 'actionLimit';
  const winners = !state.gameOver ? [] : state.winner !== null ? [state.winner] : [...state.tiedWinners];
  const holder = (k: 'investor' | 'beltWeaver' | 'factoryEmpire'): number => state.players.findIndex(p => p.bonusTesseracts[k]);
  const rec: GameRecord = {
    seed: spec.seed,
    playerCount: spec.playerCount,
    seats: spec.seats,
    turnPosition,
    winners,
    ending,
    rounds: state.round,
    actions,
    points: state.players.map(p => resourcePoints(p)),
    tesseracts: state.players.map(p => p.inventory.tesseract),
    bonuses: state.players.map(p => (p.bonusTesseracts.investor ? 1 : 0) + (p.bonusTesseracts.beltWeaver ? 1 : 0) + (p.bonusTesseracts.factoryEmpire ? 1 : 0)),
    bonusHolders: { investor: holder('investor'), beltWeaver: holder('beltWeaver'), factoryEmpire: holder('factoryEmpire') },
    ...(error ? { error } : {}),
    ...(t0 !== undefined && clock ? { ms: clock() - t0 } : {}),
  };
  return rec;
}

// ── Statistics ────────────────────────────────────────────────────────────────

/** Wilson score interval (95% by default) for `wins` successes in `n` trials. */
export function wilson(wins: number, n: number, z = 1.96): { low: number; high: number } {
  if (n <= 0) return { low: 0, high: 1 };
  const p = wins / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return { low: Math.max(0, center - half), high: Math.min(1, center + half) };
}

export interface BotStats {
  readonly id: string;
  readonly playerCount: PlayerCount;
  readonly games: number;
  /** Wins; a shared win counts 1/k for each of k winners. */
  readonly wins: number;
  readonly winRate: number;
  readonly ci: { readonly low: number; readonly high: number };
  /** winRate ÷ the even share (1 / players). */
  readonly vsShare: number;
  readonly avgRounds: number;
  readonly endings: Record<Ending, number>;
  /** Of its wins, how many came by four Tesseracts / board exhaustion. */
  readonly winsBy: { readonly tesseracts: number; readonly boardExhausted: number };
  readonly avgPoints: number;
  readonly avgTesseracts: number;
  readonly avgBonuses: number;
  /** Share of games ending with each Bonus Tesseract in this bot's hands. */
  readonly bonusRate: { readonly investor: number; readonly beltWeaver: number; readonly factoryEmpire: number };
  /** Games and wins by turn position (0 = starting player). */
  readonly byPosition: ReadonlyArray<{ readonly games: number; readonly wins: number }>;
}

export interface SeatStats {
  readonly playerCount: PlayerCount;
  readonly games: number;
  readonly byPosition: ReadonlyArray<{ readonly wins: number; readonly rate: number; readonly ci: { low: number; high: number } }>;
}

export function aggregate(records: readonly GameRecord[]): { bots: BotStats[]; seats: SeatStats[] } {
  interface Acc {
    games: number; wins: number; rounds: number; points: number; tess: number; bonuses: number;
    endings: Record<Ending, number>; winsBy: { tesseracts: number; boardExhausted: number };
    bonus: { investor: number; beltWeaver: number; factoryEmpire: number };
    pos: Array<{ games: number; wins: number }>;
  }
  const accs = new Map<string, Acc>();
  const seatAcc = new Map<PlayerCount, { games: number; wins: number[] }>();
  for (const r of records) {
    const share = r.winners.length > 0 ? 1 / r.winners.length : 0;
    const sa = seatAcc.get(r.playerCount) ?? { games: 0, wins: new Array<number>(r.playerCount).fill(0) };
    sa.games++;
    for (const w of r.winners) sa.wins[r.turnPosition[w]!]! += share;
    seatAcc.set(r.playerCount, sa);
    r.seats.forEach((id, seat) => {
      const key = `${id}|${r.playerCount}`;
      const a = accs.get(key) ?? {
        games: 0, wins: 0, rounds: 0, points: 0, tess: 0, bonuses: 0,
        endings: { tesseracts: 0, boardExhausted: 0, actionLimit: 0, error: 0 },
        winsBy: { tesseracts: 0, boardExhausted: 0 },
        bonus: { investor: 0, beltWeaver: 0, factoryEmpire: 0 },
        pos: Array.from({ length: r.playerCount }, () => ({ games: 0, wins: 0 })),
      };
      const won = r.winners.includes(seat) ? share : 0;
      a.games++;
      a.wins += won;
      a.rounds += r.rounds;
      a.points += r.points[seat] ?? 0;
      a.tess += r.tesseracts[seat] ?? 0;
      a.bonuses += r.bonuses[seat] ?? 0;
      a.endings[r.ending]++;
      if (won > 0 && r.ending === 'tesseracts') a.winsBy.tesseracts += won;
      if (won > 0 && r.ending === 'boardExhausted') a.winsBy.boardExhausted += won;
      if (r.bonusHolders.investor === seat) a.bonus.investor++;
      if (r.bonusHolders.beltWeaver === seat) a.bonus.beltWeaver++;
      if (r.bonusHolders.factoryEmpire === seat) a.bonus.factoryEmpire++;
      const pos = a.pos[r.turnPosition[seat]!]!;
      pos.games++;
      pos.wins += won;
      accs.set(key, a);
    });
  }
  const bots: BotStats[] = [];
  for (const [key, a] of accs) {
    const [id, pc] = key.split('|') as [string, string];
    const playerCount = Number(pc) as PlayerCount;
    const winRate = a.wins / a.games;
    bots.push({
      id, playerCount, games: a.games, wins: a.wins, winRate,
      ci: wilson(a.wins, a.games),
      vsShare: winRate * playerCount,
      avgRounds: a.rounds / a.games,
      endings: a.endings,
      winsBy: a.winsBy,
      avgPoints: a.points / a.games,
      avgTesseracts: a.tess / a.games,
      avgBonuses: a.bonuses / a.games,
      bonusRate: { investor: a.bonus.investor / a.games, beltWeaver: a.bonus.beltWeaver / a.games, factoryEmpire: a.bonus.factoryEmpire / a.games },
      byPosition: a.pos,
    });
  }
  bots.sort((x, y) => x.playerCount - y.playerCount || y.winRate - x.winRate || x.id.localeCompare(y.id));
  const seats: SeatStats[] = [...seatAcc.entries()].sort((x, y) => x[0] - y[0]).map(([playerCount, s]) => ({
    playerCount,
    games: s.games,
    byPosition: s.wins.map(w => ({ wins: w, rate: w / s.games, ci: wilson(w, s.games) })),
  }));
  return { bots, seats };
}

// ── Report ────────────────────────────────────────────────────────────────────

const pct = (x: number): string => `${(100 * x).toFixed(1)}%`;

function pad(cells: readonly string[], widths: readonly number[]): string {
  return cells.map((c, i) => (i === 0 ? c.padEnd(widths[i]!) : c.padStart(widths[i]!))).join('  ');
}

/** A plain-text report: one table per player count, then first-player advantage. */
export function formatReport(agg: { bots: BotStats[]; seats: SeatStats[] }, label: (id: string) => string = id => id): string {
  const lines: string[] = [];
  for (const pc of [2, 3, 4] as const) {
    const rows = agg.bots.filter(b => b.playerCount === pc);
    if (rows.length === 0) continue;
    lines.push(`\n${pc} players (even share ${pct(1 / pc)})`);
    const head = ['bot', 'games', 'wins', 'win rate', '95% CI', 'x share', 'rounds', 'won 4T', 'won pts', 'points', 'tess', 'bonus', 'Inv', 'Belt', 'Emp', 'limit', 'error', 'by turn position'];
    const table = rows.map(b => [
      label(b.id), String(b.games), b.wins.toFixed(1), pct(b.winRate), `${pct(b.ci.low)}–${pct(b.ci.high)}`,
      b.vsShare.toFixed(2), b.avgRounds.toFixed(1), b.winsBy.tesseracts.toFixed(0), b.winsBy.boardExhausted.toFixed(0),
      b.avgPoints.toFixed(1), b.avgTesseracts.toFixed(2), b.avgBonuses.toFixed(2),
      pct(b.bonusRate.investor), pct(b.bonusRate.beltWeaver), pct(b.bonusRate.factoryEmpire),
      String(b.endings.actionLimit), String(b.endings.error),
      b.byPosition.map(p => (p.games ? pct(p.wins / p.games) : '-')).join(' / '),
    ]);
    const widths = head.map((h, i) => Math.max(h.length, ...table.map(r => r[i]!.length)));
    lines.push(pad(head, widths));
    for (const r of table) lines.push(pad(r, widths));
  }
  if (agg.seats.length > 0) {
    lines.push('\nWin rate by turn position (all bots; 1st = starting player)');
    for (const s of agg.seats) {
      lines.push(`  ${s.playerCount} players, ${s.games} games: ` +
        s.byPosition.map((p, i) => `${i + 1}st ${pct(p.rate)} (${pct(p.ci.low)}–${pct(p.ci.high)})`.replace(/^(\d)st/, (_m, d: string) => `${d}${d === '1' ? 'st' : d === '2' ? 'nd' : d === '3' ? 'rd' : 'th'}`)).join(', '));
    }
  }
  return lines.join('\n');
}
