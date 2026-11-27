// A Control Module on a building whose number is below the number of Mines in play is greyed out:
// clearly greyer than a live one, its numeral dimmed, while the four player colours stay apart.

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { NUMERAL_LIVE, NUMERAL_SKIPPED, moduleColors } from '../moduleLook';
import { PLAYER_COLOR_HEX } from '../types';

const owners = Object.values(PLAYER_COLOR_HEX).map(h => new THREE.Color(h));
const hsl = (c: THREE.Color): THREE.HSL => c.getHSL({ h: 0, s: 0, l: 0 });
const dist = (a: THREE.Color, b: THREE.Color): number => Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);

describe('moduleColors', () => {
  it('a live module keeps its owner\'s colour and a near-black numeral', () => {
    for (const o of owners) {
      for (const [m, mines] of [[1, 1], [2, 2], [5, 3], [18, 3]] as const) {
        const c = moduleColors(o, m, mines);
        expect(c.face.equals(o)).toBe(true);
        expect(c.numeral.equals(NUMERAL_LIVE)).toBe(true);
      }
    }
  });

  it('a module below the number of Mines is greyed: much less colour, dimmed numeral, owner unchanged', () => {
    for (const o of owners) {
      const before = o.clone();
      for (const [m, mines] of [[1, 2], [1, 3], [2, 3]] as const) {
        const c = moduleColors(o, m, mines);
        expect(hsl(c.face).s).toBeLessThan(hsl(o).s * 0.45);
        expect(c.numeral.equals(NUMERAL_SKIPPED)).toBe(true);
      }
      expect(o.equals(before)).toBe(true); // the shared seat colour is not changed
    }
    expect(hsl(NUMERAL_SKIPPED).l).toBeGreaterThan(hsl(NUMERAL_LIVE).l);
  });

  it('greyed modules of different players stay distinguishable', () => {
    const faces = owners.map(o => moduleColors(o, 1, 2).face);
    for (let i = 0; i < faces.length; i++) {
      for (let j = i + 1; j < faces.length; j++) expect(dist(faces[i]!, faces[j]!)).toBeGreaterThan(0.03);
    }
  });
});
