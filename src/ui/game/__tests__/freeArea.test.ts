import { describe, expect, it } from 'vitest';
import { carve } from '../freeArea';
import { shortLabels } from '../queueView';

const free = { left: 0, top: 100, right: 1400, bottom: 700 };

describe('carve: panels over the board come out of its free area', () => {
  it('cuts a bottom-left card from the side that keeps the most room', () => {
    // 520 wide, 90 tall at the bottom left: cutting 98 px off the bottom keeps more than cutting 528 off the left.
    expect(carve(free, [{ left: 16, top: 600, right: 536, bottom: 690 }])).toEqual({ ...free, bottom: 592 });
  });
  it('cuts a tall narrow column from the side', () => {
    expect(carve(free, [{ left: 16, top: 110, right: 246, bottom: 400 }])).toEqual({ ...free, left: 254 });
  });
  it('ignores panels outside the area, and several panels each take their own cut', () => {
    const out = carve(free, [
      { left: 0, top: 0, right: 1400, bottom: 90 },          // above the area: ignored
      { left: 1100, top: 110, right: 1390, bottom: 260 },    // bank, top right
      { left: 16, top: 600, right: 536, bottom: 690 },       // roll card, bottom left
    ]);
    expect(out.top === 268 || out.right === 1092).toBe(true);
    expect(out.bottom).toBe(592);
    // No panel overlaps the result.
    for (const p of [{ left: 1100, top: 110, right: 1390, bottom: 260 }, { left: 16, top: 600, right: 536, bottom: 690 }]) {
      expect(p.right <= out.left || p.left >= out.right || p.bottom <= out.top || p.top >= out.bottom).toBe(true);
    }
  });
});

describe('shortLabels: the phone queue tells every seat apart', () => {
  it('adds the number at the end of a name, and the seat number when still alike', () => {
    expect(shortLabels(['Brandon', 'Smart Bot', 'Smart Bot 2'])).toEqual(['B', 'S', 'S2']);
    expect(shortLabels(['Ann', 'Amy', 'Bea'])).toEqual(['A1', 'A2', 'B']);
  });
});
