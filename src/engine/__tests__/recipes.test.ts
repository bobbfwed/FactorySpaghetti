import { describe, it, expect } from 'vitest';
import { factoryExpectedProduct, canLoadMaterial } from '../rules/production';
import type { BoardPiece, Material } from '../state';

function piece(type: BoardPiece['type'], slots: (Material | null)[]): BoardPiece {
  return {
    id: 'x', type, coord: { q: 0, r: 0 }, claims: [],
    input: { slots, teleporters: [] },
    output: { slots: [null], teleporters: [] },
  } as BoardPiece;
}
const product = (t: BoardPiece['type'], m: (Material | null)[]) => factoryExpectedProduct(piece(t, m));

describe('factory recipes — operate (exact match)', () => {
  it('Plate Factory: only ore', () => {
    expect(product('plateFact', ['ore'])).toBe('plate');
  });

  it('Sphere Factory: (ore+plate) or (plate+plate) only', () => {
    expect(product('sphereFact', ['ore', 'plate'])).toBe('sphere');
    expect(product('sphereFact', ['plate', 'plate'])).toBe('sphere');
    expect(product('sphereFact', ['ore', 'ore'])).toBeNull();
    expect(product('sphereFact', ['plate', 'sphere'])).toBeNull();
  });

  it('Tesseract Factory: exactly the five rulebook recipes', () => {
    // valid
    expect(product('tesseractFact', ['ore', 'plate', 'sphere'])).toBe('tesseract');
    expect(product('tesseractFact', ['ore', 'sphere', 'sphere'])).toBe('tesseract'); // the reported case
    expect(product('tesseractFact', ['plate', 'sphere', 'sphere'])).toBe('tesseract');
    expect(product('tesseractFact', ['sphere', 'sphere', 'sphere'])).toBe('tesseract');
    expect(product('tesseractFact', ['plate', 'plate', 'sphere'])).toBe('tesseract');
    // order independence
    expect(product('tesseractFact', ['sphere', 'ore', 'sphere'])).toBe('tesseract');
    // invalid
    expect(product('tesseractFact', ['ore', 'ore', 'sphere'])).toBeNull();
    expect(product('tesseractFact', ['ore', 'plate', 'plate'])).toBeNull();
    expect(product('tesseractFact', ['plate', 'plate', 'plate'])).toBeNull();
    // a tesseract is never a valid input
    expect(product('tesseractFact', ['plate', 'sphere', 'tesseract'])).toBeNull();
  });

  it('incomplete inputs never produce', () => {
    expect(product('tesseractFact', ['ore', 'sphere', null])).toBeNull();
    expect(product('sphereFact', ['plate', null])).toBeNull();
  });
});

describe('canLoadMaterial — loading keeps a valid recipe reachable', () => {
  it('Plate Factory accepts ore, rejects everything else', () => {
    expect(canLoadMaterial('plateFact', [null], 'ore')).toBe(true);
    expect(canLoadMaterial('plateFact', [null], 'plate')).toBe(false);
    expect(canLoadMaterial('plateFact', [null], 'sphere')).toBe(false);
  });

  it('Sphere Factory: a second ore is illegal (no ore+ore recipe)', () => {
    expect(canLoadMaterial('sphereFact', [null, null], 'ore')).toBe(true);   // ore+plate reachable
    expect(canLoadMaterial('sphereFact', ['ore', null], 'plate')).toBe(true); // completes ore+plate
    expect(canLoadMaterial('sphereFact', ['ore', null], 'ore')).toBe(false);  // ore+ore invalid
    expect(canLoadMaterial('sphereFact', ['plate', null], 'plate')).toBe(true);
  });

  it('Tesseract Factory: sphere-heavy loads stay reachable; a second ore does not', () => {
    expect(canLoadMaterial('tesseractFact', ['sphere', null, null], 'sphere')).toBe(true);
    expect(canLoadMaterial('tesseractFact', ['sphere', 'sphere', null], 'ore')).toBe(true);   // ore+sphere+sphere
    expect(canLoadMaterial('tesseractFact', ['ore', null, null], 'ore')).toBe(false);         // no 2-ore recipe
    expect(canLoadMaterial('tesseractFact', [null, null, null], 'tesseract')).toBe(false);    // never an input
    expect(canLoadMaterial('tesseractFact', ['plate', 'plate', null], 'sphere')).toBe(true);  // plate+plate+sphere
    expect(canLoadMaterial('tesseractFact', ['plate', 'plate', null], 'plate')).toBe(false);  // plate*3 invalid
  });

  it('Power Plant accepts any single ore/plate/sphere but not tesseract', () => {
    expect(canLoadMaterial('powerPlant', [null], 'ore')).toBe(true);
    expect(canLoadMaterial('powerPlant', [null], 'plate')).toBe(true);
    expect(canLoadMaterial('powerPlant', [null], 'sphere')).toBe(true);
    expect(canLoadMaterial('powerPlant', [null], 'tesseract')).toBe(false);
  });

  it('a full buffer accepts no more loads', () => {
    expect(canLoadMaterial('sphereFact', ['ore', 'plate'], 'plate')).toBe(false);
  });
});
