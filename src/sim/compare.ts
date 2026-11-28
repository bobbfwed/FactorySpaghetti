// Comparing two versions of a bot fairly: schedules that put one "hero" bot against a field of
// other bots, head-to-head tables between two bots, stand-in (takeover) games, and the paired
// statistics that judge whether a change to a bot is better than noise.
//
// Paired: both versions of the hero play exactly the same games — the same seed (board, stacks,
// dice), the same opponents in the same seats, the hero in the same seat — so the difference
// between them is measured game by game and the luck of the seeds cancels out as far as it can.
// Pure: no clock, no randomness; the records come from tournament.playGame.

import type { GameRecord, GameSpec, PlayerCount } from './tournament';
import { combinations, seatRotations, wilson } from './tournament';

// ── Schedules ─────────────────────────────────────────────────────────────────

/**
 * "Gauntlet": `hero` alone at a table of other bots drawn from `field`. For each seed one table
 * of distinct field bots is used (the tables are cycled through in order, so over enough seeds
 * every table appears equally often), and the hero sits in every seat of it.
 */
export function gauntletSchedule(hero: string, field: readonly string[], playerCount: PlayerCount, seeds: number, startSeed: number): GameSpec[] {
  const tables = combinations(field, playerCount - 1);
  if (tables.length === 0) return [];
  const specs: GameSpec[] = [];
  for (let s = 0; s < seeds; s++) {
    const table = tables[s % tables.length]!;
    for (const seats of seatRotations([hero, ...table])) specs.push({ seed: startSeed + s, playerCount, seats });
  }
  return specs;
}

/**
 * Head-to-head between `a` and `b`: at 2 players both seat orders; at 3 and 4 players each bot
 * alone against a table of the other, in every seat. Over the schedule each bot fills the same
 * number of seats, so a bot as strong as the other wins half of the games.
 */
export function headToHeadSchedule(a: string, b: string, playerCount: PlayerCount, seeds: number, startSeed: number): GameSpec[] {
  const specs: GameSpec[] = [];
  for (let s = 0; s < seeds; s++) {
    const seed = startSeed + s;
    if (playerCount === 2) {
      for (const seats of seatRotations([a, b])) specs.push({ seed, playerCount, seats });
      continue;
    }
    for (const [x, y] of [[a, b], [b, a]] as const) {
      for (const seats of seatRotations([x, ...new Array<string>(playerCount - 1).fill(y)])) specs.push({ seed, playerCount, seats });
    }
  }
  return specs;
}

/**
 * Stand-in games: a table of `field` bots plays until action `atAction` (a seeded spread over the
 * middle of a game), then `hero` takes over one seat for the rest of the game.
 */
export function takeoverSchedule(hero: string, field: readonly string[], playerCount: PlayerCount, seeds: number, startSeed: number): GameSpec[] {
  const tables = combinations(field, playerCount);
  if (tables.length === 0) return [];
  const specs: GameSpec[] = [];
  for (let s = 0; s < seeds; s++) {
    const table = tables[s % tables.length]!;
    const seed = startSeed + s;
    // 150–450 moves in: a few rounds in, buildings claimed and belts laid, far from the end.
    const atAction = 150 + ((Math.imul(seed, 2654435761) >>> 0) % 301);
    for (let seat = 0; seat < playerCount; seat++) specs.push({ seed, playerCount, seats: table, takeover: { atAction, seat, bot: hero } });
  }
  return specs;
}

// ── Paired statistics ─────────────────────────────────────────────────────────

/** The hero's seat in a game: the takeover seat, or the one seat holding `hero`. */
export function heroSeat(r: GameRecord, hero: string): number {
  if (r.takeover) return r.takeover.bot === hero ? r.takeover.seat : -1;
  const seats = r.seats.flatMap((id, i) => (id === hero ? [i] : []));
  return seats.length === 1 ? seats[0]! : -1;
}

/** Share of the win the seat got (1, 1/k for a shared win, 0). */
export function winShare(r: GameRecord, seat: number): number {
  if (seat < 0 || !r.winners.includes(seat)) return 0;
  return 1 / r.winners.length;
}

/** A key that is equal for the same game with a different hero in the hero's seat. */
function pairKey(r: GameRecord, hero: string): string {
  const seat = heroSeat(r, hero);
  const seats = r.seats.map((id, i) => (i === seat ? '*' : id));
  return `${r.playerCount}|${r.seed}|${seat}|${seats.join(',')}`;
}

export interface PairedRow {
  readonly playerCount: PlayerCount | 'all';
  readonly games: number;
  readonly rateA: number;
  readonly rateB: number;
  /** Mean of (win of A − win of B) per game; for 'all', each game's difference times the player count. */
  readonly diff: number;
  /** 95% interval of the mean paired difference (normal approximation). */
  readonly low: number;
  readonly high: number;
}

/** Mean and 95% interval of a list of paired differences. */
export function meanInterval(d: readonly number[], z = 1.96): { mean: number; low: number; high: number } {
  const n = d.length;
  if (n === 0) return { mean: 0, low: 0, high: 0 };
  const mean = d.reduce((s, x) => s + x, 0) / n;
  if (n === 1) return { mean, low: -Infinity, high: Infinity };
  const variance = d.reduce((s, x) => s + (x - mean) * (x - mean), 0) / (n - 1);
  const half = z * Math.sqrt(variance / n);
  return { mean, low: mean - half, high: mean + half };
}

/**
 * Paired comparison of hero `a` with hero `b` over the games both played. Per player count the
 * difference in win rate; over all player counts the difference in "times the even share"
 * (a win at 4 players counts 4, at 2 players 2), so every player count weighs the same per game.
 */
export function pairedCompare(records: readonly GameRecord[], a: string, b: string): PairedRow[] {
  const byKeyA = new Map<string, GameRecord>();
  for (const r of records) if (heroSeat(r, a) >= 0) byKeyA.set(pairKey(r, a), r);
  const pairs: Array<{ pc: PlayerCount; wa: number; wb: number }> = [];
  for (const r of records) {
    if (heroSeat(r, b) < 0) continue;
    const ra = byKeyA.get(pairKey(r, b));
    if (!ra || ra === r) continue;
    pairs.push({ pc: r.playerCount, wa: winShare(ra, heroSeat(ra, a)), wb: winShare(r, heroSeat(r, b)) });
  }
  const rows: PairedRow[] = [];
  const row = (pc: PlayerCount | 'all', ps: typeof pairs): PairedRow => {
    const scale = (p: { pc: PlayerCount }): number => (pc === 'all' ? p.pc : 1);
    const iv = meanInterval(ps.map(p => (p.wa - p.wb) * scale(p)));
    const n = Math.max(1, ps.length);
    return {
      playerCount: pc, games: ps.length,
      rateA: ps.reduce((s, p) => s + p.wa * scale(p), 0) / n,
      rateB: ps.reduce((s, p) => s + p.wb * scale(p), 0) / n,
      diff: iv.mean, low: iv.low, high: iv.high,
    };
  };
  for (const pc of [2, 3, 4] as const) {
    const ps = pairs.filter(p => p.pc === pc);
    if (ps.length > 0) rows.push(row(pc, ps));
  }
  if (pairs.length > 0) rows.push(row('all', pairs));
  return rows;
}

/** Head-to-head summary: share of the games won by each bot's seats, per player count. */
export function headToHead(records: readonly GameRecord[], a: string, b: string): Array<{ playerCount: PlayerCount; games: number; winsA: number; winsB: number; rateA: number; ci: { low: number; high: number } }> {
  const out = [];
  for (const pc of [2, 3, 4] as const) {
    const rs = records.filter(r => r.playerCount === pc && r.seats.includes(a) && r.seats.includes(b) && r.seats.every(s => s === a || s === b));
    if (rs.length === 0) continue;
    let wa = 0;
    let wb = 0;
    for (const r of rs) {
      for (const w of r.winners) {
        if (r.seats[w] === a) wa += 1 / r.winners.length;
        else wb += 1 / r.winners.length;
      }
    }
    out.push({ playerCount: pc, games: rs.length, winsA: wa, winsB: wb, rateA: wa / rs.length, ci: wilson(wa, rs.length) });
  }
  return out;
}

// ── Speed and pace ────────────────────────────────────────────────────────────

export interface SpeedRow {
  readonly id: string;
  readonly playerCount: PlayerCount;
  readonly decisions: number;
  readonly median: number;
  readonly p95: number;
  readonly max: number;
  /** Decisions per own turn (round-end turns included in the decisions, not in the turns). */
  readonly perTurn: number;
}

function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return NaN;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1));
  return sorted[i]!;
}

/** Decision time (ms) and decisions per turn, per bot and player count. */
export function speedTable(records: readonly GameRecord[]): SpeedRow[] {
  const acc = new Map<string, { times: number[]; moves: number; turns: number }>();
  for (const r of records) {
    r.seats.forEach((id, seat) => {
      if (r.takeover && r.takeover.seat === seat) return; // a seat played by two bots says nothing about either
      const k = `${id}|${r.playerCount}`;
      const a = acc.get(k) ?? { times: [], moves: 0, turns: 0 };
      if (r.timing) a.times.push(...(r.timing[seat] ?? []));
      a.moves += r.moves?.[seat] ?? 0;
      a.turns += r.turns?.[seat] ?? 0;
      acc.set(k, a);
    });
  }
  const rows: SpeedRow[] = [];
  for (const [k, a] of acc) {
    const [id, pc] = k.split('|') as [string, string];
    const t = [...a.times].sort((x, y) => x - y);
    rows.push({
      id, playerCount: Number(pc) as PlayerCount, decisions: t.length,
      median: quantile(t, 0.5), p95: quantile(t, 0.95), max: t.length ? t[t.length - 1]! : NaN,
      perTurn: a.turns > 0 ? a.moves / a.turns : NaN,
    });
  }
  return rows.sort((x, y) => x.playerCount - y.playerCount || x.id.localeCompare(y.id));
}

const pct = (x: number): string => (Number.isFinite(x) ? `${(100 * x).toFixed(1)}%` : '-');
const sgn = (x: number, d = 1): string => (Number.isFinite(x) ? `${x >= 0 ? '+' : ''}${(100 * x).toFixed(d)}` : '-');

/** Text report of a paired comparison. */
export function formatPaired(rows: readonly PairedRow[], a: string, b: string): string {
  const lines = [`\nPaired comparison: ${a} (A) against ${b} (B) on the same games`];
  for (const r of rows) {
    if (r.playerCount === 'all') {
      lines.push(`  all player counts, ${r.games} pairs: A ${r.rateA.toFixed(3)} x share, B ${r.rateB.toFixed(3)} x share; ` +
        `difference ${(r.diff >= 0 ? '+' : '')}${r.diff.toFixed(3)} x share (95% ${r.low.toFixed(3)} to ${r.high.toFixed(3)})`);
    } else {
      lines.push(`  ${r.playerCount} players, ${r.games} pairs: A ${pct(r.rateA)}, B ${pct(r.rateB)}; ` +
        `difference ${sgn(r.diff)} points (95% ${sgn(r.low)} to ${sgn(r.high)})`);
    }
  }
  return lines.join('\n');
}

export function formatSpeed(rows: readonly SpeedRow[]): string {
  const lines = ['\nDecision time (ms) and decisions per own turn'];
  for (const r of rows) {
    lines.push(`  ${r.playerCount}p ${r.id}: ${r.decisions} decisions, median ${r.median.toFixed(2)}, 95th ${r.p95.toFixed(2)}, worst ${r.max.toFixed(1)}; ${r.perTurn.toFixed(1)} decisions per turn`);
  }
  return lines.join('\n');
}

export function formatHeadToHead(rows: ReturnType<typeof headToHead>, a: string, b: string): string {
  const lines = [`\nHead-to-head: ${a} against ${b} (share of games won by ${a}'s seats; each bot fills half the seats)`];
  for (const r of rows) {
    lines.push(`  ${r.playerCount} players, ${r.games} games: ${a} ${r.winsA.toFixed(1)}, ${b} ${r.winsB.toFixed(1)}; ${a} ${pct(r.rateA)} (95% ${pct(r.ci.low)}–${pct(r.ci.high)})`);
  }
  return lines.join('\n');
}
