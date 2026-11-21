// Factory recipe logic — the single source of truth for what a factory produces and what
// may be loaded/flowed into its inputs. Pure and dependency-light (config + types only), so
// both production.ts and flow.ts can import it without a circular dependency.

import type { BoardPiece, Material } from '../state';
import { FACTORY_RECIPES, MATERIAL_VALUES, POWER_PLANT_INPUTS } from '../config';

// Canonical multiset key for a set of materials (sorted ascending by value).
function multisetKey(mats: ReadonlyArray<Material>): string {
  return [...mats].sort((a, b) => MATERIAL_VALUES[a] - MATERIAL_VALUES[b]).join(',');
}

// Determine what a factory produces given its current input slots.
// Returns null if the filled slots do not exactly match one of this factory's recipes.
// The recipe table (config.FACTORY_RECIPES) matches the rulebook exactly and is shared with
// canLoadMaterial so loading, material flow, and operating all agree.
export function factoryProduct(type: BoardPiece['type'], inputs: ReadonlyArray<Material | null>): Material | null {
  const recipeSet = FACTORY_RECIPES[type];
  if (!recipeSet) return null; // power plants / blanks / mines have no factory recipe
  const filled = inputs.filter((m): m is Material => m !== null);
  const key = multisetKey(filled);
  return recipeSet.inputs.some(r => multisetKey(r) === key) ? recipeSet.product : null;
}

// True if adding `material` to the current input slots keeps a valid recipe reachable —
// i.e. the resulting filled multiset is a sub-multiset of at least one of this factory's
// recipes (for a Power Plant, any single ore/plate/sphere). Governs which materials may be
// LOADED (manually) or FLOWED (from a mine/belt) into an input, using the same recipe table
// that governs operation — so e.g. a Sphere Factory can never end up holding two Ore.
export function canLoadMaterial(
  type: BoardPiece['type'],
  slots: ReadonlyArray<Material | null>,
  material: Material,
): boolean {
  if (slots.every(s => s !== null)) return false; // no empty slot to load into

  if (type === 'powerPlant') {
    // One input slot; any single ore/plate/sphere is a valid load (extra tokens).
    return POWER_PLANT_INPUTS.includes(material);
  }

  const recipeSet = FACTORY_RECIPES[type];
  if (!recipeSet) return false;

  // Count materials after the hypothetical load.
  const want = new Map<Material, number>();
  for (const s of slots) if (s !== null) want.set(s, (want.get(s) ?? 0) + 1);
  want.set(material, (want.get(material) ?? 0) + 1);

  // Valid if some recipe contains at least those counts (proposed ⊆ recipe).
  return recipeSet.inputs.some(recipe => {
    const have = new Map<Material, number>();
    for (const m of recipe) have.set(m, (have.get(m) ?? 0) + 1);
    for (const [m, n] of want) {
      if ((have.get(m) ?? 0) < n) return false;
    }
    return true;
  });
}
