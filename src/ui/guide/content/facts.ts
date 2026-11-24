// Numbers and small tables for the guide, worked out from the engine's config so the guide
// cannot drift from the game. Two facts live in the engine's rules code rather than its config
// (what a Mine's meeple points give, and what exchanging down gives); they are stated here and
// checked against the engine in __tests__/engineFacts.test.ts.

import type { CardType, Material, MineId, PieceType } from '../../../engine/config';
import {
  CARD_COUNTS, FACTORY_RECIPES, MATERIAL_VALUES, MINE_COSTS, MINE_COUNT, MINE_LEAN_ORE_OUTPUTS, PIECE_TEMPLATES,
  STACK_COMPOSITION, STARTING_PIECES_PER_PLAYER, cardCost,
} from '../../../engine/config';
import { BUILDING_NAME, CARD_NAME, MATERIAL_NAME } from '../../../session/describe';

export { CARD_NAME, MATERIAL_NAME, BUILDING_NAME };

export const MATERIALS: readonly Material[] = ['ore', 'plate', 'sphere', 'tesseract'];
export const CARD_TYPES = Object.keys(CARD_COUNTS) as CardType[];
export const PLAYER_COUNTS = [2, 3, 4] as const;
export const MINE_NUMBERS: readonly number[] = Array.from({ length: MINE_COUNT }, (_, i) => i + 1);

/** "1 Ore", "2 Plates". */
export function amount(n: number, m: Material): string {
  return `${n} ${MATERIAL_NAME[m]}${n === 1 ? '' : m === 'ore' ? '' : 's'}`;
}

/** "1 belt", "2 belts". */
export function count(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** "a, b and c" (or "a, b or c"). */
export function listWords(items: readonly string[], conj: 'and' | 'or' = 'and'): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} ${conj} ${items[items.length - 1]}`;
}

/** Ordinal words for Mines and stacks: "first", "second", "third". */
export const ORDINAL = ['first', 'second', 'third', 'fourth'] as const;

// ── Mines ───────────────────────────────────────────────────────────────────

/** What a Mine's resource point gives at round end, by the order the Mine came into play. */
export const MINE_RESOURCE_REWARD: readonly { readonly material: Material; readonly n: number }[] = [
  { material: 'ore', n: 2 },
  { material: 'plate', n: 1 },
  { material: 'sphere', n: 1 },
];

/** Mine credits from a Mine's upgrade point at round end: the number of Mines + 1. */
export const mineCredits = (mines: number): number => mines + 1;

/** "6 for the second Mine and 18 for the third". */
export function minePriceWords(): string {
  return listWords(MINE_COSTS.map((c, i) => `${c} for the ${ORDINAL[i + 1]} Mine`));
}

/** "2 with one Mine, 3 with two, 4 with three". */
export function perMineWords(f: (mines: number) => number): string {
  return MINE_NUMBERS.map((m, i) => (i === 0 ? `${f(m)} with one Mine` : `${f(m)} with ${['one', 'two', 'three', 'four'][m - 1]}`)).join(', ');
}

export const cardPriceWords = (): string => perMineWords(cardCost);

// ── Exchanging down ─────────────────────────────────────────────────────────

/**
 * What the bank gives for one material: as many of the next smaller material as fit in its value,
 * and the rest in Ore (a Sphere, 7, gives 2 Plates and 1 Ore). Null for Ore.
 */
export function exchangeDown(m: Material): Partial<Record<Material, number>> | null {
  const i = MATERIALS.indexOf(m);
  if (i <= 0) return null;
  const lower = MATERIALS[i - 1]!;
  const value = MATERIAL_VALUES[m];
  const n = Math.floor(value / MATERIAL_VALUES[lower]);
  const rest = value - n * MATERIAL_VALUES[lower];
  const out: Partial<Record<Material, number>> = { [lower]: n };
  if (rest > 0) out.ore = (out.ore ?? 0) + rest / MATERIAL_VALUES.ore;
  return out;
}

export function exchangeWords(m: Material): string {
  const got = exchangeDown(m);
  if (!got) return '';
  return listWords(MATERIALS.filter(x => got[x]).reverse().map(x => amount(got[x]!, x)));
}

// ── Recipes ─────────────────────────────────────────────────────────────────

export const FACTORY_TYPES = Object.keys(FACTORY_RECIPES) as PieceType[];

/** "Ore + Plate". */
export function recipeWords(set: readonly Material[]): string {
  return set.map(m => MATERIAL_NAME[m]).join(' + ');
}

// ── Dice ────────────────────────────────────────────────────────────────────

/** The chance (0–1) of each total with `dice` six-sided dice, indexed by total. */
export function diceOdds(dice: number): number[] {
  let dist = [1];
  for (let d = 0; d < dice; d++) {
    const next = new Array<number>(dist.length + 6).fill(0);
    dist.forEach((p, total) => { for (let f = 1; f <= 6; f++) next[total + f]! += p / 6; });
    dist = next;
  }
  return dist;
}

/** The most likely totals with `dice` dice, e.g. [10, 11] for three. */
export function likeliest(dice: number): number[] {
  const odds = diceOdds(dice);
  const best = Math.max(...odds);
  return odds.flatMap((p, t) => (Math.abs(p - best) < 1e-12 ? [t] : []));
}

export const percent = (p: number): string => (p === 0 ? '—' : `${(p * 100).toFixed(p < 0.1 ? 1 : 0)}%`);

// ── Stacks ──────────────────────────────────────────────────────────────────

export const STACK_PIECE_TYPES = ['plateFact', 'sphereFact', 'tesseractFact', 'powerPlant', 'blank'] as const;

export function stackSize(players: 2 | 3 | 4, stack: 0 | 1 | 2): number {
  const c = STACK_COMPOSITION[players][stack];
  return STACK_PIECE_TYPES.reduce((n, t) => n + c[t], 0);
}

export function totalPieces(players: 2 | 3 | 4): number {
  return ([0, 1, 2] as const).reduce<number>((n, s) => n + stackSize(players, s), 0);
}

/** "1 Power Plant, 1 Plate Factory and 2 blank tiles". */
export function startingPiecesWords(): string {
  return listWords(Object.entries(STARTING_PIECES_PER_PLAYER).map(([t, n]) => {
    const name = BUILDING_NAME[t as PieceType];
    return `${n} ${name}${n === 1 ? '' : 's'}`;
  }));
}

export const startingPiecesPerPlayer = (): number =>
  Object.values(STARTING_PIECES_PER_PLAYER).reduce((a, b) => a + (b ?? 0), 0);

// ── Connection points ───────────────────────────────────────────────────────

/** "#3–#6, #9–#12" from 0-based positions. */
export function pointRanges(positions: readonly number[]): string {
  const nums = [...positions].map(p => p + 1).sort((a, b) => a - b);
  const parts: string[] = [];
  for (let i = 0; i < nums.length; i++) {
    let j = i;
    while (j + 1 < nums.length && nums[j + 1] === nums[j]! + 1) j++;
    parts.push(j > i + 1 ? `#${nums[i]}–#${nums[j]}` : j === i + 1 ? `#${nums[i]}, #${nums[j]}` : `#${nums[i]}`);
    i = j;
  }
  return parts.length ? parts.join(', ') : 'none';
}

export interface PiecePoints { type: PieceType; belt: number[]; input: number[]; output: number[] }

/** Belt holes, inputs and output of each single-hex piece, from the piece templates. */
export function piecePoints(): PiecePoints[] {
  const types: PieceType[] = ['blank', 'plateFact', 'sphereFact', 'tesseractFact', 'powerPlant'];
  return types.map(type => {
    const pts = PIECE_TEMPLATES[type].points.filter(p => p.enabled);
    return {
      type,
      belt: pts.filter(p => p.role === 'belt').map(p => p.position),
      input: pts.filter(p => p.role === 'input_buffer').map(p => p.position),
      output: pts.filter(p => p.role === 'output_buffer').map(p => p.position),
    };
  });
}

/** Number of ore exits on each half of a Mine's layout. */
export function mineExits(): { rich: number; lean: number[] } {
  const rich = PIECE_TEMPLATES.mine.points.filter(p => p.position < 12 && p.role === 'ore_output').length;
  const ids: MineId[] = ['mine-1', 'mine-2', 'mine-3'];
  return { rich, lean: ids.map(id => MINE_LEAN_ORE_OUTPUTS[id].length) };
}

// ── Cards ───────────────────────────────────────────────────────────────────

export const deckSize = (): number => CARD_TYPES.reduce((n, c) => n + CARD_COUNTS[c], 0);
