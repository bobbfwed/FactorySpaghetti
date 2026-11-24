// Camera framing: the board lands inside the part of the canvas not covered by panels.

import { describe, it, expect } from 'vitest';
import { CameraRig } from '../camera';
import type { Bounds } from '../layout';

const board: Bounds = { minX: -200, maxX: 200, minZ: -150, maxZ: 150 };
const corners = (b: Bounds): [number, number][] => [[b.minX, b.minZ], [b.maxX, b.minZ], [b.minX, b.maxZ], [b.maxX, b.maxZ]];

function framed(insets: { top: number; right: number; bottom: number; left: number }): { pts: { x: number; y: number }[]; rig: CameraRig } {
  const rig = new CameraRig();
  rig.setSize(1000, 800);
  rig.setInsets(insets);
  rig.frame(board, false, 0);
  return { rig, pts: corners(board).map(([x, z]) => rig.project(x, 0, z)) };
}

describe('camera framing', () => {
  it('fits the whole board on the canvas with no panels', () => {
    const { pts } = framed({ top: 0, right: 0, bottom: 0, left: 0 });
    for (const p of pts) {
      expect(p.x).toBeGreaterThanOrEqual(0); expect(p.x).toBeLessThanOrEqual(1000);
      expect(p.y).toBeGreaterThanOrEqual(0); expect(p.y).toBeLessThanOrEqual(800);
    }
  });

  it('keeps the board inside the free area when panels cover the edges, centred in it', () => {
    const ins = { top: 90, right: 60, bottom: 260, left: 40 };
    const { pts } = framed(ins);
    for (const p of pts) {
      expect(p.x).toBeGreaterThanOrEqual(ins.left - 1); expect(p.x).toBeLessThanOrEqual(1000 - ins.right + 1);
      expect(p.y).toBeGreaterThanOrEqual(ins.top - 1); expect(p.y).toBeLessThanOrEqual(800 - ins.bottom + 1);
    }
    const cx = (Math.min(...pts.map(p => p.x)) + Math.max(...pts.map(p => p.x))) / 2;
    const cy = (Math.min(...pts.map(p => p.y)) + Math.max(...pts.map(p => p.y))) / 2;
    expect(Math.abs(cx - (ins.left + (1000 - ins.right)) / 2)).toBeLessThan(3);
    expect(Math.abs(cy - (ins.top + (800 - ins.bottom)) / 2)).toBeLessThan(3);
  });

  it('a larger inset zooms out (more millimetres per pixel)', () => {
    expect(framed({ top: 0, right: 0, bottom: 400, left: 0 }).rig.scale).toBeGreaterThan(framed({ top: 0, right: 0, bottom: 0, left: 0 }).rig.scale);
  });

  it('boxVisible: a framed area is visible; one reaching past it is not', () => {
    const { rig } = framed({ top: 90, right: 60, bottom: 260, left: 40 });
    expect(rig.boxVisible(board, 0)).toBe(true);
    expect(rig.boxVisible({ ...board, maxX: board.maxX + 400 }, 0)).toBe(false);
    // Corners are checked at the given height too: a tall pile can stick out at the top.
    expect(rig.boxVisible(board, 2000)).toBe(false);
  });

  it('boxFits honours the zoom-out limit', () => {
    const rig = new CameraRig();
    rig.setSize(400, 800);
    rig.setInsets({ top: 0, right: 0, bottom: 0, left: 0 }, 0.5);
    expect(rig.boxFits({ minX: -50, maxX: 50, minZ: -50, maxZ: 50 }, 0)).toBe(true);
    expect(rig.boxFits({ minX: -500, maxX: 500, minZ: -50, maxZ: 50 }, 0)).toBe(false);
  });

  it('noZoomIn: framing a smaller area keeps the scale; plain framing zooms in', () => {
    const { rig } = framed({ top: 0, right: 0, bottom: 0, left: 0 });
    const before = rig.scale;
    const small: Bounds = { minX: -20, maxX: 20, minZ: -20, maxZ: 20 };
    rig.frame(small, false, 0, 1.08, true);
    expect(rig.scale).toBeCloseTo(before, 9);
    expect(rig.boxVisible(small, 0)).toBe(true);
    rig.frame(small, false, 0);
    expect(rig.scale).toBeLessThan(before);
  });

  it('framing keeps the rotation the view has (a seat\'s side, or turned with the button)', () => {
    const rig = new CameraRig();
    rig.setSize(1000, 800);
    rig.turnTo(Math.PI * 1.5, false);
    rig.frame(board, false, 0);
    expect(rig.azimuth).toBeCloseTo(Math.PI * 1.5, 9);
    expect(rig.boxVisible(board, 0)).toBe(true);
    rig.rotateBy(1);
    expect(rig.targetAzimuth).toBeCloseTo(Math.PI * 1.5 - Math.PI / 3, 9);
  });

  it('turnTo animates the short way round', () => {
    const rig = new CameraRig();
    rig.turnTo(Math.PI * 1.5, true);
    expect(rig.targetAzimuth).toBeCloseTo(-Math.PI / 2, 9);
  });

  it('ignores nonsense insets', () => {
    const { pts } = framed({ top: Number.NaN, right: -50, bottom: 0, left: Number.POSITIVE_INFINITY });
    for (const p of pts) expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
  });
});
