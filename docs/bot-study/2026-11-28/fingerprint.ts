// Before/after fingerprint: proves the extra statistics collected for this study change no game.
// Plays a fixed set of seeded games and hashes the record fields that existed before the change
// (everything but the wall-clock fields and the new statistics).
// Usage (from the repo root): npx vite-node docs/bot-study/2026-11-28/fingerprint.ts
import { createHash } from 'node:crypto';
import { BOT_TYPES, SIM_ONLY_BOTS } from '../../../src/bots/registry';
import type { BotFn } from '../../../src/bots/botInterface';
import { playGame } from '../../../src/sim/tournament';
import type { PlayerCount } from '../../../src/sim/tournament';

const KEYS = ['seed', 'playerCount', 'seats', 'turnPosition', 'winners', 'ending', 'rounds', 'actions', 'points', 'tesseracts',
  'bonuses', 'bonusHolders', 'bonusFirst', 'bonusMoves', 'firstTesseractRound', 'mines', 'cardsBought', 'coClaims', 'moves', 'turns'];
const entrants = new Map<string, BotFn>([...BOT_TYPES, ...SIM_ONLY_BOTS].map(b => [b.id, b.fn]));
const lineups: Array<[number, PlayerCount, string[]]> = [
  [11, 2, ['greedy', 'bonusHunter']],
  [12, 3, ['planner', 'greedy', 'teleporter']],
  [13, 4, ['cardShark', 'hoarder', 'mineRusher', 'greedy']],
  [14, 4, ['greedy', 'greedy', 'greedy', 'greedy']],
  [15, 3, ['greedy-classic', 'greedy', 'bonusHunter']],
  [16, 2, ['teleporter', 'cardShark']],
];
const all = createHash('sha256');
for (const [seed, pc, seats] of lineups) {
  const r = playGame({ seed, playerCount: pc, seats }, entrants) as unknown as Record<string, unknown>;
  const core = JSON.stringify(KEYS.map(k => r[k]));
  all.update(core);
  console.log(seed, pc, seats.join(','), r.ending, r.rounds, r.actions, createHash('sha256').update(core).digest('hex').slice(0, 16));
}
console.log('all', all.digest('hex'));
