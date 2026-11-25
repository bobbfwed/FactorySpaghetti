// Extra facts from saved tournament files: how winners won, how Mines arrived.
// Usage: vite-node analyze.ts file1.json [file2.json ...]
import { readFileSync } from 'node:fs';
import type { GameRecord } from 'C:/Apps/Factory Spaghetti/.claude/worktrees/p5-bots/src/sim/tournament';

const files = process.argv.slice(2);
const games: GameRecord[] = [];
for (const f of files) games.push(...(JSON.parse(readFileSync(f, 'utf8')) as { games: GameRecord[] }).games);

for (const pc of [2, 3, 4]) {
  const gs = games.filter(g => g.playerCount === pc);
  if (gs.length === 0) continue;
  const tess = gs.filter(g => g.ending === 'tesseracts');
  const mix = new Map<string, number>();
  for (const g of tess) {
    const w = g.winners[0]!;
    const k = `${g.tesseracts[w]} real + ${g.bonuses[w]} bonus`;
    mix.set(k, (mix.get(k) ?? 0) + 1);
  }
  const ex = gs.filter(g => g.ending === 'boardExhausted');
  const mine2 = gs.map(g => g.mines[0]).filter(Boolean);
  const mine3 = gs.map(g => g.mines[1]).filter(Boolean);
  const avg = (xs: number[]): string => (xs.length ? (xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(1) : '-');
  console.log(`\n${pc} players: ${gs.length} games; ${tess.length} four-Tesseract wins (${(100 * tess.length / gs.length).toFixed(1)}%), ${ex.length} board-exhaustion endings; avg rounds ${avg(gs.map(g => g.rounds))}`);
  console.log('  four-Tesseract winners held:', [...mix.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}: ${v} (${(100 * v / tess.length).toFixed(0)}%)`).join(', '));
  console.log(`  winning points at board exhaustion: avg ${avg(ex.map(g => Math.max(...g.points)))}; runner-up ${avg(ex.map(g => [...g.points].sort((a, b) => b - a)[1]!))}`);
  console.log(`  Mine 2: bought in ${mine2.filter(m => m!.boughtBy >= 0).length}/${mine2.length} games, arrives round ${avg(mine2.map(m => m!.round))}; Mine 3: bought ${mine3.filter(m => m!.boughtBy >= 0).length}/${mine3.length}, round ${avg(mine3.map(m => m!.round))}`);
  const ft = gs.flatMap(g => g.firstTesseractRound.filter(r => r >= 0));
  console.log(`  first real Tesseract (any player): round ${avg(ft)}; games with no real Tesseract at all: ${gs.filter(g => g.firstTesseractRound.every(r => r < 0)).length}`);
}
