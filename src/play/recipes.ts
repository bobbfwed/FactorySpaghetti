// The order recipes are shown in to people: each factory's sets of ingredients from the lowest
// total value to the highest (ties keep the config's order). Computed from MATERIAL_VALUES; the
// engine's own table (config.ts FACTORY_RECIPES) keeps its order, which the rules may rely on.
// Used wherever a person reads recipes: the game's reference sheet, the run text, the supply
// prompt, and the guide.

import { FACTORY_RECIPES, MATERIAL_VALUES } from '../engine/config';
import type { Material, PieceType } from '../engine/config';

/** What a set of ingredients is worth together. */
export function recipeValue(set: readonly Material[]): number {
  return set.reduce((n, m) => n + MATERIAL_VALUES[m], 0);
}

/** A factory's recipes in display order (none for a building that is not a factory). */
export function recipesInOrder(type: PieceType): ReadonlyArray<ReadonlyArray<Material>> {
  const inputs = FACTORY_RECIPES[type]?.inputs ?? [];
  // Array.prototype.sort is stable, so equal totals keep the config's order.
  return [...inputs].sort((a, b) => recipeValue(a) - recipeValue(b));
}
