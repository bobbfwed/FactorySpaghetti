// Balance-study tables (2026-11-28, rules v0.70) from saved tournament files.
// Usage (repo root): npx vite-node docs/bot-study/2026-11-28/analyze.ts -- Label=file.json [Label2=a.json+b.json ...]
// Prints Markdown tables per data set and player count. Reads only; plays no game.
import { readFileSync } from 'node:fs';
import type { GameRecord, MeepleSpot } from '../../../src/sim/tournament';
import { MEEPLE_SPOTS, wilson } from '../../../src/sim/tournament';

type BonusKind = 'investor' | 'beltWeaver' | 'factoryEmpire';
const BONUS: readonly BonusKind[] = ['investor', 'factoryEmpire', 'beltWeaver'];
const BONUS_NAME: Record<BonusKind, string> = { investor: 'The Investor', factoryEmpire: 'Factory Empire', beltWeaver: 'Belt Weaver' };
const SPOT_NAME: Record<MeepleSpot, string> = {
  mineResource: 'Mine resource point', mineUpgrade: 'Mine upgrade point', plateFact: 'Plate Factory', sphereFact: 'Sphere Factory',
  tesseractFact: 'Tesseract Factory', powerPlant: 'Power Plant', none: 'no meeple',
};

const args = process.argv.slice(2).filter(a => a !== '--');
const sets: Array<[string, GameRecord[]]> = args.map(a => {
  const [label, files] = a.split('=') as [string, string];
  const games: GameRecord[] = [];
  for (const f of files.split('+')) games.push(...(JSON.parse(readFileSync(f, 'utf8')) as { games: GameRecord[] }).games);
  return [label, games];
});

const out = (s = ''): void => { process.stdout.write(`${s}\n`); };
const pct = (x: number, d = 1): string => (Number.isFinite(x) ? `${(100 * x).toFixed(d)}%` : '-');
const ci = (k: number, n: number): string => { const w = wilson(k, n); return `${pct(k / n)} (${(100 * w.low).toFixed(0)}–${(100 * w.high).toFixed(0)})`; };
const q = (xs: readonly number[], p: number): number => {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil(p * s.length) - 1))]!;
};
const mean = (xs: readonly number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const f1 = (x: number): string => (Number.isFinite(x) ? x.toFixed(1) : '-');
const f2 = (x: number): string => (Number.isFinite(x) ? x.toFixed(2) : '-');
const spread = (xs: readonly number[]): string => `${q(xs, 0.5)} (${q(xs, 0.1)}–${q(xs, 0.9)})`;
const row = (cells: readonly (string | number)[]): void => out(`| ${cells.join(' | ')} |`);
const head = (cells: readonly string[]): void => { row(cells); row(cells.map(() => '---')); };
const share = (g: GameRecord, seat: number): number => (g.winners.includes(seat) ? 1 / g.winners.length : 0);
const finished = (g: GameRecord): boolean => g.ending === 'tesseracts' || g.ending === 'boardExhausted';
const totalTurns = (g: GameRecord): number => (g.turns ?? []).reduce((a, b) => a + b, 0);

for (const [label, all] of sets) {
  out(`\n## ${label}: ${all.length} games`);
  const bad = all.filter(g => !finished(g));
  out(`Unfinished (move limit): ${all.filter(g => g.ending === 'actionLimit').length}; refused moves or bot errors: ${all.filter(g => g.ending === 'error').length}; claims onto another player's building: ${all.reduce((s, g) => s + g.coClaims.reduce((a, b) => a + b, 0), 0)}`);
  for (const g of bad.slice(0, 5)) out(`  - seed ${g.seed} ${g.playerCount}p [${g.seats.join(', ')}] ${g.ending} ${g.error ?? ''}`);

  out('\n### Game length and endings');
  head(['Players', 'Games', 'Rounds, median (10th–90th)', 'Rounds, mean', 'Turns per game, median (10th–90th)', 'Turns per player, median', 'Ended by 4 Tesseracts (95% CI)', 'Ended on points']);
  for (const pc of [2, 3, 4]) {
    const gs = all.filter(g => g.playerCount === pc && finished(g));
    if (!gs.length) continue;
    const t4 = gs.filter(g => g.ending === 'tesseracts').length;
    row([pc, gs.length, spread(gs.map(g => g.rounds)), f1(mean(gs.map(g => g.rounds))), spread(gs.map(totalTurns)),
      q(gs.map(g => totalTurns(g) / pc), 0.5).toFixed(1), ci(t4, gs.length), pct((gs.length - t4) / gs.length)]);
  }

  out('\n### How the 4-Tesseract wins were made (winner\'s real Tesseracts + Bonus Tesseracts)');
  head(['Players', '4-Tesseract wins', 'Winner\'s real Tesseracts, mean', 'Bonus, mean', '4 real', '3 real + 1 bonus', '2 real + 2 bonus', '1 real + 3 bonus', 'Most common winning hands']);
  for (const pc of [2, 3, 4]) {
    const gs = all.filter(g => g.playerCount === pc && g.ending === 'tesseracts' && g.winners.length === 1);
    if (!gs.length) continue;
    const mix = new Map<string, number>();
    const byB = [0, 0, 0, 0];
    for (const g of gs) {
      const w = g.winners[0]!;
      const held = BONUS.filter(k => g.bonusHolders[k] === w).map(k => BONUS_NAME[k]);
      byB[Math.min(3, held.length)]!++;
      const k = `${g.tesseracts[w]} real${held.length ? ` + ${held.join(' + ')}` : ''}`;
      mix.set(k, (mix.get(k) ?? 0) + 1);
    }
    const top = [...mix.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${k} ${pct(v / gs.length, 0)}`).join('; ');
    row([pc, gs.length, f2(mean(gs.map(g => g.tesseracts[g.winners[0]!]!))), f2(mean(gs.map(g => g.bonuses[g.winners[0]!]!))),
      ...byB.map(n => pct(n / gs.length, 0)), top]);
  }
  out('\nPoints wins (board exhausted): winner\'s points, median; runner-up, median');
  for (const pc of [2, 3, 4]) {
    const gs = all.filter(g => g.playerCount === pc && g.ending === 'boardExhausted');
    if (!gs.length) continue;
    out(`- ${pc} players: ${gs.length} games; winner ${q(gs.map(g => Math.max(...g.points)), 0.5)}, runner-up ${q(gs.map(g => [...g.points].sort((a, b) => b - a)[1]!), 0.5)}; shared wins ${gs.filter(g => g.winners.length > 1).length}`);
  }

  out('\n### Each Bonus Tesseract');
  out('Held at end: share of games someone holds it at the end. Winner holds: share of games with one winner in which the winner holds it. First taken: round, over games where it was taken. Changes of hands: mean per game. Win rate of holders / non-holders: per player, at the end of the game (correlation, not cause). Lift: holder rate ÷ non-holder rate.');
  head(['Players', 'Bonus', 'Held at end (95% CI)', 'Winner holds (95% CI)', 'Taken at all', 'First taken, round median (10th–90th)', 'Changes of hands, mean', 'Kept by first holder', 'Holder wins (95% CI)', 'Non-holder wins', 'Lift']);
  for (const pc of [2, 3, 4]) {
    const gs = all.filter(g => g.playerCount === pc && finished(g));
    if (!gs.length) continue;
    const solo = gs.filter(g => g.winners.length === 1);
    for (const k of BONUS) {
      const held = gs.filter(g => g.bonusHolders[k] >= 0);
      const winHolds = solo.filter(g => g.bonusHolders[k] === g.winners[0]).length;
      const taken = gs.filter(g => g.bonusFirst[k] !== null);
      const kept = taken.filter(g => g.bonusHolders[k] === g.bonusFirst[k]!.seat && g.bonusMoves[k] === 0).length;
      let hw = 0; let hn = 0; let nw = 0; let nn = 0;
      for (const g of gs) for (let s = 0; s < pc; s++) {
        if (g.bonusHolders[k] === s) { hn++; hw += share(g, s); } else { nn++; nw += share(g, s); }
      }
      row([pc, BONUS_NAME[k], ci(held.length, gs.length), ci(winHolds, solo.length), pct(taken.length / gs.length, 0),
        taken.length ? spread(taken.map(g => g.bonusFirst[k]!.round)) : '-', f2(mean(gs.map(g => g.bonusMoves[k]))),
        taken.length ? pct(kept / taken.length, 0) : '-', hn ? ci(hw, hn) : '-', pct(nw / nn), hn ? f2((hw / hn) / (nw / nn)) : '-']);
    }
  }

  out('\n### Win rate by turn position (1st = starting player)');
  const ids = [...new Set(all.flatMap(g => g.seats))];
  const mirrorIds = ids.filter(id => all.some(g => g.seats.every(s => s === id)));
  head(['Table', 'Players', 'Games', ...['1st', '2nd', '3rd', '4th']]);
  for (const pc of [2, 3, 4]) {
    const groups: Array<[string, GameRecord[]]> = [['all games', all.filter(g => g.playerCount === pc)]];
    for (const id of mirrorIds) groups.push([`${id} × ${pc}`, all.filter(g => g.playerCount === pc && g.seats.every(s => s === id))]);
    for (const [name, gs] of groups) {
      if (!gs.length) continue;
      const w = new Array<number>(pc).fill(0);
      for (const g of gs) for (const s of g.winners) w[g.turnPosition[s]!]! += 1 / g.winners.length;
      row([name, pc, gs.length, ...w.map(x => ci(x, gs.length)), ...new Array<string>(4 - pc).fill('')]);
    }
  }

  out('\n### Leverage cards, Teleporters, belts (per player; win rate by how many were used; correlation, not cause)');
  for (const pc of [2, 3, 4]) {
    const gs = all.filter(g => g.playerCount === pc && finished(g) && g.extra);
    if (!gs.length) continue;
    const obs = gs.flatMap(g => g.seats.map((_, s) => ({ g, s, w: share(g, s) })));
    const bucket = (name: string, val: (g: GameRecord, s: number) => number, cuts: Array<[string, (n: number) => boolean]>): void => {
      const parts = cuts.map(([cl, test]) => {
        const sel = obs.filter(o => test(val(o.g, o.s)));
        const wins = sel.reduce((a, o) => a + o.w, 0);
        return `${cl}: ${pct(sel.length / obs.length, 0)} of players, win ${sel.length ? ci(wins, sel.length) : '-'}`;
      });
      out(`- ${pc}p ${name} (mean ${f2(mean(obs.map(o => val(o.g, o.s))))}; winners ${f2(mean(obs.filter(o => o.w > 0).map(o => val(o.g, o.s))))}): ${parts.join('; ')}`);
    };
    bucket('Leverage cards bought', (g, s) => g.cardsBought[s]!, [['0', n => n === 0], ['1–2', n => n >= 1 && n <= 2], ['3+', n => n >= 3]]);
    bucket('Leverage cards played', (g, s) => g.extra!.cardsPlayed[s]!, [['0', n => n === 0], ['1–2', n => n >= 1 && n <= 2], ['3+', n => n >= 3]]);
    bucket('Teleporters placed', (g, s) => g.extra!.teleportersPlaced[s]!, [['0', n => n === 0], ['1', n => n === 1], ['2+', n => n >= 2]]);
    bucket('belts bought', (g, s) => g.extra!.beltsBought[s]!, [['0', n => n === 0], ['1–3', n => n >= 1 && n <= 3], ['4+', n => n >= 4]]);
    bucket('belts on the board at the end', (g, s) => g.extra!.beltsOnBoard[s]!, [['0–2', n => n <= 2], ['3–5', n => n >= 3 && n <= 5], ['6+', n => n >= 6]]);
    bucket('buildings with own Control Modules at the end', (g, s) => g.extra!.buildings[s]!, [['≤5', n => n <= 5], ['6+', n => n >= 6]]);
  }

  out('\n### Mines 2 and 3 (round they entered play; bought or dropped in when a stack ran out; does the buyer win more?)');
  head(['Players', 'Games', 'Mine 2 in play', 'Mine 2 round, median (10th–90th)', 'Mine 2 bought', 'Buyer of Mine 2 wins (95% CI)', 'Mine 3 in play', 'Mine 3 round, median (10th–90th)', 'Mine 3 bought', 'Buyer of Mine 3 wins (95% CI)']);
  for (const pc of [2, 3, 4]) {
    const gs = all.filter(g => g.playerCount === pc && finished(g));
    if (!gs.length) continue;
    const cells: string[] = [];
    for (const i of [0, 1]) {
      const m = gs.filter(g => g.mines[i]);
      const bought = m.filter(g => g.mines[i]!.boughtBy >= 0);
      const bw = bought.reduce((a, g) => a + share(g, g.mines[i]!.boughtBy), 0);
      cells.push(pct(m.length / gs.length, 0), m.length ? spread(m.map(g => g.mines[i]!.round)) : '-', m.length ? pct(bought.length / m.length, 0) : '-', bought.length ? ci(bw, bought.length) : '-');
    }
    row([pc, gs.length, ...cells]);
  }

  out('\n### Where the meeple goes (share of all placements)');
  head(['Players', 'Placements', ...MEEPLE_SPOTS.map(s => SPOT_NAME[s])]);
  for (const pc of [2, 3, 4]) {
    const gs = all.filter(g => g.playerCount === pc && g.extra);
    if (!gs.length) continue;
    const tot = Object.fromEntries(MEEPLE_SPOTS.map(s => [s, 0])) as Record<MeepleSpot, number>;
    for (const g of gs) for (const m of g.extra!.meeple) for (const s of MEEPLE_SPOTS) tot[s] += m[s];
    const n = MEEPLE_SPOTS.reduce((a, s) => a + tot[s], 0);
    row([pc, n, ...MEEPLE_SPOTS.map(s => pct(tot[s] / n))]);
  }

  out('\n### Power Tokens');
  head(['Players', 'Held at the start of a turn, mean', 'Turns begun at the cap of 10', 'At the end, mean (median)', 'Players ending at the cap', 'Players ending with 0–1', 'Winners at the end, mean']);
  for (const pc of [2, 3, 4]) {
    const gs = all.filter(g => g.playerCount === pc && finished(g) && g.extra);
    if (!gs.length) continue;
    const turns = gs.reduce((a, g) => a + totalTurns(g), 0);
    const sum = gs.reduce((a, g) => a + g.extra!.powerAtTurnStart.reduce((x, y) => x + y, 0), 0);
    const cap = gs.reduce((a, g) => a + g.extra!.turnsAtPowerCap.reduce((x, y) => x + y, 0), 0);
    const fin = gs.flatMap(g => [...g.extra!.finalPower]);
    const winFin = gs.flatMap(g => g.winners.map(w => g.extra!.finalPower[w]!));
    row([pc, f1(sum / turns), pct(cap / turns), `${f1(mean(fin))} (${q(fin, 0.5)})`, pct(fin.filter(x => x >= 10).length / fin.length), pct(fin.filter(x => x <= 1).length / fin.length), f1(mean(winFin))]);
  }
}
