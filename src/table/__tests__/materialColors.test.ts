// The four materials darken with value (Ore light green ... Tesseract very dark green), and the 3D
// models, the 2D icons and the converter's theme all use the same four colours.

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MATERIAL_VALUES, type Material } from '../../engine/config';
import { parseGlb } from '../glb';
import { MATERIAL_COLOR, MATERIAL_EDGE, MATERIALS_BY_VALUE, mixHex, relativeLuminance } from '../materialColors';

const ROOT = join(__dirname, '..', '..', '..');
const MODELS_DIR = join(ROOT, 'public', 'models');
const MODEL: Record<Material, string> = { ore: 'ore', plate: 'plate', sphere: 'sphere', tesseract: 'tesseract' };
const ICON: Record<Material, 'ore' | 'plate' | 'sphere' | 'tess'> = { ore: 'ore', plate: 'plate', sphere: 'sphere', tesseract: 'tess' };

const rgb = (hex: string): [number, number, number] => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const lin = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
/** CIE L* (0..100) from relative luminance. */
const lightness = (hex: string): number => {
  const y = relativeLuminance(hex);
  return y > 216 / 24389 ? 116 * Math.cbrt(y) - 16 : (24389 / 27) * y;
};

describe('material colours', () => {
  it('lists the materials in value order', () => {
    const values = MATERIALS_BY_VALUE.map(m => MATERIAL_VALUES[m]);
    expect([...values].sort((a, b) => a - b)).toEqual(values);
    expect(new Set(MATERIALS_BY_VALUE)).toEqual(new Set(Object.keys(MATERIAL_VALUES)));
  });

  it('each more valuable material is clearly darker than the last', () => {
    const l = MATERIALS_BY_VALUE.map(m => relativeLuminance(MATERIAL_COLOR[m]));
    for (let i = 1; i < l.length; i++) expect(l[i], MATERIALS_BY_VALUE[i]).toBeLessThan(l[i - 1]!);
    // Large, even steps in perceived lightness (designed as L* 82 / 62 / 42 / 24).
    const L = MATERIALS_BY_VALUE.map(m => lightness(MATERIAL_COLOR[m]));
    for (let i = 1; i < L.length; i++) expect(L[i - 1]! - L[i]!, MATERIALS_BY_VALUE[i]).toBeGreaterThan(15);
    expect(L[0]).toBeGreaterThan(75);
    expect(L[3]).toBeLessThan(30);
  });

  it('every material is green: green the strongest channel by a clear margin', () => {
    for (const m of MATERIALS_BY_VALUE) {
      const [r, g, b] = rgb(MATERIAL_COLOR[m]);
      expect(g, m).toBeGreaterThan(r * 1.4);
      expect(g, m).toBeGreaterThan(b * 1.4);
    }
  });

  it('the icon edge is lighter than its fill, and keeps the ramp in order', () => {
    for (const m of MATERIALS_BY_VALUE) expect(relativeLuminance(MATERIAL_EDGE[m]), m).toBeGreaterThan(relativeLuminance(MATERIAL_COLOR[m]));
    const e = MATERIALS_BY_VALUE.map(m => relativeLuminance(MATERIAL_EDGE[m]));
    for (let i = 1; i < e.length; i++) expect(e[i]).toBeLessThan(e[i - 1]!);
  });

  it('mixHex mixes in sRGB', () => {
    expect(mixHex('#000000', '#FFFFFF', 0.5)).toBe('#808080');
    expect(mixHex('#114218', '#114218', 0.3)).toBe('#114218');
  });
});

describe('one set of colours everywhere', () => {
  it('the baked models carry the same colours (material piece and Mine symbols)', () => {
    const parts = (name: string) => parseGlb(new Uint8Array(readFileSync(join(MODELS_DIR, `${name}.glb`))));
    const check = (name: string, m: Material): void => {
      const p = parts(name).find(x => x.material === m);
      expect(p, `${name} has a ${m} part`).toBeDefined();
      const want = rgb(MATERIAL_COLOR[m]).map(c => lin(c / 255));
      p!.color!.forEach((c, i) => expect(Math.abs(c - want[i]!), `${name} ${m} channel ${i}`).toBeLessThan(1e-4));
    };
    for (const m of MATERIALS_BY_VALUE) {
      check(MODEL[m], m);
      // The whole material piece is that one material.
      expect(parts(MODEL[m]).map(x => x.material)).toEqual([m]);
    }
    check('mine-1', 'ore');
    check('mine-2', 'plate');
    check('mine-3', 'sphere');
  });

  it('the model manifest records the same colours, taken from materialColors.ts', () => {
    const manifest = JSON.parse(readFileSync(join(MODELS_DIR, 'manifest.json'), 'utf8')) as { materials: Record<string, { color: string; colorFrom?: string }> };
    for (const m of MATERIALS_BY_VALUE) {
      expect(manifest.materials[m]?.color.toUpperCase()).toBe(MATERIAL_COLOR[m].toUpperCase());
      expect(manifest.materials[m]?.colorFrom).toBe('src/table/materialColors.ts');
    }
    const theme = JSON.parse(readFileSync(join(ROOT, 'tools', 'piece-theme.json'), 'utf8')) as { materials: Record<string, { color?: string; colorFrom?: string }> };
    for (const m of MATERIALS_BY_VALUE) {
      expect(theme.materials[m]?.colorFrom).toBe('src/table/materialColors.ts');
      expect(theme.materials[m]?.color).toBeUndefined(); // no second copy to drift
    }
  });

  describe('the 2D icons', () => {
    let iconHtml: (name: 'ore' | 'plate' | 'sphere' | 'tess') => string;
    beforeAll(async () => {
      // icons.ts builds an element; a bare stand-in for document is enough to read its markup.
      (globalThis as { document?: unknown }).document ??= { createElement: () => ({ className: '', innerHTML: '' }) };
      const { icon } = await import('../../ui/icons');
      iconHtml = (name) => (icon(name) as unknown as { innerHTML: string }).innerHTML;
    });

    it('fill with the material colour and edge with the lighter edge colour', () => {
      for (const m of MATERIALS_BY_VALUE) {
        const html = iconHtml(ICON[m]);
        expect(html, m).toContain(`fill="${MATERIAL_COLOR[m]}"`);
        expect(html, m).toContain(`stroke="${MATERIAL_EDGE[m]}"`);
        // No other material's fill sneaks in.
        for (const o of MATERIALS_BY_VALUE) if (o !== m) expect(html, `${m} vs ${o}`).not.toContain(MATERIAL_COLOR[o]);
      }
    });
  });
});
