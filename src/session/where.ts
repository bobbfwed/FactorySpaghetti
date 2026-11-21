// Where something is on the board, in words a player can use at the table: relative to the first
// Mine (the piece every game starts from), as seen from the table's starting view. The board's
// internal coordinates are never shown to players.
//
// A space straight along one of the six directions is "2 spaces to the upper left of the first
// Mine"; any other space is two straight runs, the longer first: "2 spaces right and 1 upper right
// of the first Mine". Every space gets its own description.

import type { GameState } from '../engine/state';
import { mineSecondaryCoord } from '../engine/rules/pieces';

interface Coord { q: number; r: number }

/**
 * The six directions, as they look from the table's starting view (rows of hexes, pointed tops):
 * one step along each, in order around the clock from the right.
 */
const DIRECTIONS: readonly { d: Coord; name: string }[] = [
  { d: { q: 1, r: 0 }, name: 'right' },
  { d: { q: 1, r: -1 }, name: 'upper right' },
  { d: { q: 0, r: -1 }, name: 'upper left' },
  { d: { q: -1, r: 0 }, name: 'left' },
  { d: { q: -1, r: 1 }, name: 'lower left' },
  { d: { q: 0, r: 1 }, name: 'lower right' },
];

/** The first Mine's space (its first hex), or the centre of the table before there is one. */
function firstMine(game: GameState | null): { at: Coord; second: Coord | null } {
  const mine = game?.board.find(p => p.id === 'mine-1') ?? game?.board.find(p => p.type === 'mine');
  if (!mine) return { at: { q: 0, r: 0 }, second: null };
  return { at: mine.coord, second: mineSecondaryCoord(mine.coord, mine.rotation ?? 0) };
}

const spaces = (n: number): string => (n === 1 ? '1 space' : `${n} spaces`);

/** Where `coord` is, relative to the first Mine, e.g. "2 spaces to the upper left of the first Mine". */
export function whereWords(game: GameState | null, coord: Coord): string {
  const { at, second } = firstMine(game);
  if ((coord.q === at.q && coord.r === at.r) || (second && coord.q === second.q && coord.r === second.r)) {
    return 'on the first Mine';
  }
  const dq = coord.q - at.q, dr = coord.r - at.r;
  // Two neighbouring directions span every space: dq,dr = a * D[i] + b * D[i+1] with a, b >= 0.
  for (let i = 0; i < 6; i++) {
    const A = DIRECTIONS[i]!, B = DIRECTIONS[(i + 1) % 6]!;
    const det = A.d.q * B.d.r - A.d.r * B.d.q;
    const a = (dq * B.d.r - dr * B.d.q) / det;
    const b = (A.d.q * dr - A.d.r * dq) / det;
    if (a < 0 || b < 0 || !Number.isInteger(a) || !Number.isInteger(b)) continue;
    if (b === 0) return `${spaces(a)} to the ${A.name} of the first Mine`;
    if (a === 0) continue; // straight along B: found as the next pair's A
    const [big, small] = a >= b ? [{ n: a, dir: A.name }, { n: b, dir: B.name }] : [{ n: b, dir: B.name }, { n: a, dir: A.name }];
    return `${spaces(big.n)} ${big.dir} and ${small.n} ${small.dir} of the first Mine`;
  }
  return 'near the first Mine';
}

/** The same, starting with a capital letter (for a label of its own). */
export function whereLabel(game: GameState | null, coord: Coord): string {
  const w = whereWords(game, coord);
  return w.charAt(0).toUpperCase() + w.slice(1);
}
