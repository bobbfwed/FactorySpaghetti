// The turn bar's round badge: "End of round N" during the round-end turns of round N (when the
// engine already counts round N + 1), "Round N" otherwise.

import { describe, it, expect } from 'vitest';
import { roundBadge } from '../turnBar';
import { findState } from '../../../session/__tests__/helpers';

describe('the turn bar round badge', () => {
  it('names the round that has just ended during the round-end turns', () => {
    const g = findState(2, s => s.phase === 'roundEnd' && s.round >= 3);
    const b = roundBadge(g);
    expect(`${b.prefix}${b.num}`).toBe(`End of round ${g.round - 1}`);
  });

  it('shows the round being played otherwise', () => {
    const g = findState(2, s => s.phase === 'roll' && s.round >= 3);
    const b = roundBadge(g);
    expect(`${b.prefix}${b.num}`).toBe(`Round ${g.round}`);
  });
});
