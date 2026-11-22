// Route planning helpers: the one-search reach equals findBeltPath end by end, every lit end can
// be reached, and finding them stays fast on a late board.

import { describe, expect, it } from 'vitest';
import type { GameState, PlayerId } from '../../engine/state';
import { findBeltPath, usableBeltPoints } from '../../engine/routing';
import { beltReach, planningState, planRoute, reachableEnds, routeEnds } from '../route';
import { active, findState, playRandom } from './helpers';

const STRIDE = process.env.FS_FULL === '1' ? 7 : 60;

/** Actions-step states from several seeded games, early and late. */
function samples(): { state: GameState; player: PlayerId }[] {
  const out: { state: GameState; player: PlayerId }[] = [];
  for (const [seed, pc] of [[1, 2], [2, 3], [3, 4], [5, 2], [7, 3], [9, 4]] as const) {
    const wants = [12, 25, 45];
    playRandom(seed, pc, 2500, (s, p) => {
      if (wants.length === 0 || s.phase !== 'actions' || active(s) !== p) return;
      if (s.board.length >= wants[0]!) { out.push({ state: s, player: p }); wants.shift(); }
    });
  }
  return out;
}

describe('route ends', () => {
  it('beltReach finds exactly the points findBeltPath can reach, from every kind of start', () => {
    let checked = 0, reached = 0;
    for (const { state, player } of samples()) {
      const plan = planningState(state, player);
      const points = usableBeltPoints(plan, player);
      // A spread of starts over the board: every 60th usable point (about 2 s); FS_FULL=1 takes
      // every 7th (about 35 s, 169,000 pairs).
      for (let i = 0; i < points.length; i += STRIDE) {
        const start = points[i]!;
        const reach = beltReach(plan, start, player);
        for (const p of points) {
          const byPath = findBeltPath(plan, start, p, player) !== null;
          expect(reach.has(`${p.pieceId}:${p.position}`), `${start.pieceId}:${start.position} -> ${p.pieceId}:${p.position}`).toBe(byPath);
          checked++;
          if (byPath) reached++;
        }
      }
    }
    // eslint-disable-next-line no-console -- the coverage is worth seeing
    console.log(`beltReach vs findBeltPath: ${checked} pairs, ${reached} reachable`);
    expect(reached).toBeGreaterThan(5000);
  });

  it('after a start is chosen, every lit end has a route, and working them out is quick', () => {
    const { state, player } = findState((s, p) => s.phase === 'actions' && active(s) === p && s.board.length > 40);
    const ends = routeEnds(state, player);
    expect(ends.length).toBeGreaterThan(5);
    const start = ends[0]!;
    const t0 = performance.now();
    const reach = reachableEnds(state, player, start);
    const ms = performance.now() - t0;
    for (const e of reach) expect(planRoute(state, player, start, e)).not.toBeNull();
    // Cached on the same state and start.
    expect(reachableEnds(state, player, start)).toBe(reach);
    // eslint-disable-next-line no-console -- the time is worth seeing
    console.log(`reachableEnds: ${ends.length} ends, ${reach.length} reachable, ${ms.toFixed(1)} ms`);
    // The interface rebuilds its view on every tap and room update: keep this well under 50 ms.
    expect(ms).toBeLessThan(40);
  });
});
