// Test helper: compare two game states while ignoring the one thing a belt's endpoint order
// changes — the stored fromPoint/toPoint and the belt id that spells them.

import type { GameState } from '../state';

function canonicalBelts(s: GameState): GameState {
  const ids = new Map<string, string>();
  const belts = s.belts.map(b => {
    const lo = Math.min(b.fromPoint, b.toPoint), hi = Math.max(b.fromPoint, b.toPoint);
    const id = `belt-p${b.ownerId}-${b.pieceId}-${lo}-${hi}`;
    ids.set(b.id, id);
    return { ...b, id, fromPoint: lo, toPoint: hi };
  });
  return { ...s, belts, beltsPlacedThisTurn: s.beltsPlacedThisTurn.map(id => ids.get(id) ?? id) };
}

/** True when the states are equal once every belt is written lower point first. */
export function sameUpToBeltOrder(a: GameState, b: GameState): boolean {
  return JSON.stringify(canonicalBelts(a)) === JSON.stringify(canonicalBelts(b));
}
