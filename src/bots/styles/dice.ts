// Dice arithmetic for the play-style bots. A building fires when the sum of the dice (one die
// per Mine on the board) equals one of its Control Modules, on anyone's turn. A human picks
// module numbers for the dice in play: one die makes 1–6 equally likely, two dice peak at 7
// (and can never roll 1), three dice peak at 10–11. Pure and deterministic.

import type { GameState, PlayerId } from '../../engine/state';
import { nextIntBelow } from '../../engine/rng';
import type { RngState } from '../../engine/rng';

const cache = new Map<number, readonly number[]>();

/** P(sum = s) for `dice` six-sided dice, indexed by s (0 … 6·dice). */
export function sumDistribution(dice: number): readonly number[] {
  const hit = cache.get(dice);
  if (hit) return hit;
  let dist = [1];
  for (let d = 0; d < dice; d++) {
    const next = new Array<number>(dist.length + 6).fill(0);
    for (let s = 0; s < dist.length; s++) {
      const p = dist[s]!;
      if (p === 0) continue;
      for (let f = 1; f <= 6; f++) next[s + f]! += p / 6;
    }
    dist = next;
  }
  cache.set(dice, dist);
  return dist;
}

/** Chance that one roll with `mines` dice sums to `module`. */
export function hitChance(module: number, mines: number): number {
  return sumDistribution(Math.max(1, mines))[module] ?? 0;
}

/**
 * How soon the next Mine is expected, as a weight 0–1 for "plan for the next dice count".
 * The next Mine drops when the open stack runs out (or someone buys it): a stack with fewer
 * pieces left than about two rounds of placements means the dice are about to change.
 */
export function nextMineWeight(state: GameState): number {
  if (state.mineCount >= 3 || state.unplacedMines.length === 0) return 0;
  let fewest = Infinity;
  for (const s of state.stacks) if (s.available && s.pieces.length > 0) fewest = Math.min(fewest, s.pieces.length);
  if (fewest === Infinity) return 0;
  const roundsLeft = fewest / state.playerCount;
  return Math.max(0, Math.min(1, 1 - (roundsLeft - 1) / 5));
}

/** Activation chance of `module`, blending the current dice count with the next one when a Mine is near. */
export function plannedHitChance(state: GameState, module: number, futureWeight = nextMineWeight(state)): number {
  const now = hitChance(module, state.mineCount);
  if (futureWeight <= 0) return now;
  return (1 - futureWeight) * now + futureWeight * hitChance(module, state.mineCount + 1);
}

/** The module numbers in order of how often they fire with `mines` dice (most often first). */
export function modulesByChance(mines: number): number[] {
  const dist = sumDistribution(Math.max(1, mines));
  const mods: number[] = [];
  for (let m = 1; m <= 18; m++) mods.push(m);
  return mods.sort((a, b) => (dist[b] ?? 0) - (dist[a] ?? 0) || a - b);
}

/**
 * Dice for the bot's own roll request. The online host replaces them with its seeded stream and
 * the tournament rolls its own, so these only matter when a caller applies the bot's move as is;
 * they are derived from the state (never Math.random) so the bot stays deterministic.
 */
export function stateDice(state: GameState, me: PlayerId): number[] {
  let rng: RngState = (state.seed * 2654435761 + state.round * 40503 + state.board.length * 977 + me * 131 +
    state.activePlayerIndex * 7919) >>> 0;
  const out: number[] = [];
  for (let i = 0; i < state.mineCount; i++) {
    const [v, n] = nextIntBelow(rng, 6);
    rng = n;
    out.push(v + 1);
  }
  return out;
}
