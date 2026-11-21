// Placement of HTML anchored to table pieces, especially the confirm bar beside a piece being placed.

import { describe, it, expect } from 'vitest';
import { placeAll, placeConfirm, type PlaceEnv } from '../anchors';

const env: PlaceEnv = { free: { left: 8, top: 80, right: 1192, bottom: 600 }, W: 1200, H: 800, tile: 80, phone: false };

describe('confirm bar placement', () => {
  it('goes below the piece when nothing is in the way', () => {
    const r = placeConfirm(env, { x: 600, y: 300 }, 180, 60, []);
    expect(r.side).toBe('below');
    expect(r.y).toBeGreaterThan(300 + 40);
  });

  it('moves off the glowing targets below the piece', () => {
    const lit = [{ x: 600, y: 400 }, { x: 560, y: 390 }, { x: 640, y: 395 }];
    const r = placeConfirm(env, { x: 600, y: 300 }, 180, 60, lit);
    expect(r.side).not.toBe('below');
    for (const q of lit) expect(q.x > r.x - 8 && q.x < r.x + 180 + 8 && q.y > r.y - 8 && q.y < r.y + 60 + 8).toBe(false);
  });

  it('never covers the piece itself, even at the bottom edge of the free area', () => {
    const p = { x: 600, y: 590 };
    const r = placeConfirm(env, p, 180, 60, []);
    const rx = env.tile * 0.6, ry = env.tile * 0.5;
    const covers = r.x < p.x + rx && r.x + 180 > p.x - rx && r.y < p.y + ry && r.y + 60 > p.y - ry;
    expect(covers).toBe(false);
  });
});

describe('placeAll', () => {
  it('stacks two panels for nearby pieces instead of overlapping them', () => {
    const out = placeAll([
      { kind: 'side', p: { x: 500, y: 300 }, w: 200, h: 120 },
      { kind: 'side', p: { x: 505, y: 310 }, w: 200, h: 120 },
    ], env);
    const a = out[0]!, b = out[1]!;
    const overlap = a.x < b.x + 200 && a.x + 200 > b.x && a.y < b.y + 120 && a.y + 120 > b.y;
    expect(overlap).toBe(false);
  });

  it('hides a marker whose piece is outside the free area and keeps the given order', () => {
    const out = placeAll([
      { kind: 'center', p: { x: 600, y: 700 }, w: 72, h: 72 },
      { kind: 'center', p: { x: 600, y: 300 }, w: 72, h: 72 },
    ], env);
    expect(out[0]!.visible).toBe(false);
    expect(out[1]!.visible).toBe(true);
    expect(out[1]!.x).toBe(600 - 36);
  });

  it('puts a panel beside its piece with the pointer facing it', () => {
    const o = placeAll([{ kind: 'side', p: { x: 300, y: 300 }, w: 200, h: 120, hasPointer: true }], env)[0]!;
    expect(o.side).toBe('right');
    expect(o.ptr?.hidden).toBe(false);
  });
});
