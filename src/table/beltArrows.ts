// Which way each belt's arrow points when drawn: along the material flow the engine works out
// (engine/rules/beltDirection.ts). Pure, no Three.js.
//
// The belt model's chain links are chevrons pointing at its zMin end, and bendBeltItems (scene.ts)
// lays that end at a BeltItem's `from`: so a belt is drawn with `from` = its head.

import type { Belt, GameState } from '../engine/state';
import { beltDirections } from '../engine/rules/beltDirection';

/** Belt id -> its head (the connection point material leaves the belt by). */
export function beltHeadMap(game: Pick<GameState, 'board' | 'belts'>): Map<string, number> {
  const dirs = beltDirections(game);
  return new Map(game.belts.map((b, i) => [b.id, dirs[i]!.head]));
}

/** The ends to draw a belt between so its arrow points at `head` (unknown head: the stored order). */
export function arrowEnds(belt: Pick<Belt, 'fromPoint' | 'toPoint'>, head?: number): { from: number; to: number } {
  if (head === belt.fromPoint) return { from: belt.fromPoint, to: belt.toPoint };
  if (head === belt.toPoint) return { from: belt.toPoint, to: belt.fromPoint };
  // Not worked out (a belt not in the state): the arrow points at the second point tapped.
  return { from: belt.toPoint, to: belt.fromPoint };
}

/**
 * A planned route drawn as its belts will point once laid: worked out on the state with the
 * route's belts added after the ones on the board (so they are the latest placed), each in the
 * order it will be sent (from the first tap). Returns the segments with from/to ready for
 * bendBeltItems (from = head).
 */
export function orientRoute<T extends { readonly pieceId: string; readonly from: number; readonly to: number }>(
  game: Pick<GameState, 'board' | 'belts'> | null,
  segs: readonly T[],
): T[] {
  if (segs.length === 0) return [];
  const planned: Belt[] = segs.map((s, i) => ({ id: `\u0000plan-${i}`, ownerId: 0, pieceId: s.pieceId, fromPoint: s.from, toPoint: s.to }));
  const heads = beltHeadMap({ board: game?.board ?? [], belts: [...(game?.belts ?? []), ...planned] });
  return segs.map((s, i) => ({ ...s, ...arrowEnds(planned[i]!, heads.get(planned[i]!.id)) }));
}
