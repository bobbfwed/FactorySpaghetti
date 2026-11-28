// Recipes are shown to people from the lowest total value of their ingredients to the highest,
// everywhere (play/recipes.ts), while the engine's own table keeps its order.

import { describe, it, expect } from 'vitest';
import { FACTORY_POWER_COST, FACTORY_RECIPES, MATERIAL_VALUES, type PieceType } from '../../engine/config';
import { recipeValue, recipesInOrder } from '../recipes';
import { operateCost } from '../../app/gameText';
import { neededSets } from '../info';
import type { BoardPiece, GameState } from '../../engine/state';

const FACTORIES = Object.keys(FACTORY_RECIPES) as PieceType[];

describe('recipes in display order', () => {
  it('lists every factory\'s recipes with non-decreasing total value, and only the engine\'s recipes', () => {
    for (const t of FACTORIES) {
      const shown = recipesInOrder(t);
      const values = shown.map(recipeValue);
      for (let i = 1; i < values.length; i++) expect(values[i]!, t).toBeGreaterThanOrEqual(values[i - 1]!);
      expect(shown.map(s => s.join('+')).sort()).toEqual(FACTORY_RECIPES[t]!.inputs.map(s => s.join('+')).sort());
    }
  });

  it('puts the Tesseract Factory\'s five recipes in the order 11, 13, 15, 17, 21', () => {
    expect(recipesInOrder('tesseractFact').map(recipeValue)).toEqual([11, 13, 15, 17, 21]);
    expect(MATERIAL_VALUES.sphere).toBe(7);
  });

  it('leaves the engine\'s table in its own order', () => {
    expect(FACTORY_RECIPES.tesseractFact!.inputs.map(recipeValue)).toEqual([11, 15, 17, 21, 13]);
  });

  it('is the order of the run text and of the supply prompt', () => {
    const piece: BoardPiece = { id: 't', type: 'tesseractFact', coord: { q: 0, r: 0 }, rotation: 0, claims: [{ ownerId: 0, controlModule: 5 }], input: { slots: [null, null, null], teleporters: [] }, output: { slots: [null], teleporters: [] } };
    const text = operateCost({ board: [piece] } as unknown as GameState, 't');
    expect(text).toBe(`−${FACTORY_POWER_COST.tesseract} power, Ore + Plate + Sphere or Plate + Plate + Sphere or Ore + Sphere + Sphere or Plate + Sphere + Sphere or Sphere + Sphere + Sphere → Tesseract`);
    expect(neededSets(piece).map(s => recipeValue(s))).toEqual([11, 13, 15, 17, 21]);
  });
});
