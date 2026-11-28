// The round as players see it. The engine starts counting the next round as soon as the
// round-end turns begin (state.round is already N + 1 while the round-end turns of round N run),
// and a game that ends because the board ran out ends just after those turns, still counting a
// round that never started. The rulebook's round-end turns belong to the round just played, so
// every place that shows or names the round goes through here; nothing stored changes.

import type { GameState } from '../engine/state';

export interface ShownRound {
  /** The round to show: during the round-end turns, the round that has just ended. */
  readonly round: number;
  /** True while the round-end turns run. */
  readonly roundEnd: boolean;
}

type RoundFields = Pick<GameState, 'round' | 'phase' | 'gameOver' | 'gameOverReason'>;

export function shownRound(g: RoundFields): ShownRound {
  if (g.phase === 'roundEnd') return { round: Math.max(1, g.round - 1), roundEnd: true };
  // The board-exhaustion ending is decided as the last round-end turn ends, when the engine has
  // already moved on to a next round that is never played: the last round played is the one before.
  if (g.gameOver && g.gameOverReason === 'boardExhausted') return { round: Math.max(1, g.round - 1), roundEnd: false };
  return { round: g.round, roundEnd: false };
}

/** "Round 6", or "End of round 6" while the round-end turns of round 6 run. */
export function roundLabel(g: RoundFields): string {
  const s = shownRound(g);
  return s.roundEnd ? `End of round ${s.round}` : `Round ${s.round}`;
}

/** The round in a file name: "round-6", or "round-6-end" during the round-end turns of round 6. */
export function roundFileTag(g: RoundFields): string {
  const s = shownRound(g);
  return `round-${s.round}${s.roundEnd ? '-end' : ''}`;
}
