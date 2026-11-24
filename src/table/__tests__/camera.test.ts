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

describe('turning the table with the round button', () => {
  // 1280 x 800 with the tray along the bottom and the side panel on the right (the browser finding).
  const ins = { top: 70, right: 300, bottom: 230, left: 12 };
  const free = { l: ins.left, r: 1280 - ins.right, t: ins.top, b: 800 - ins.bottom };
  const wide: Bounds = { minX: -260, maxX: 260, minZ: -140, maxZ: 140 };
  const centre = { x: 0, z: 0 };
  const done = (rig: CameraRig): void => { rig.update(performance.now() + 60_000); };
  function setUp(): CameraRig {
    const rig = new CameraRig();
    rig.setSize(1280, 800);
    rig.setInsets(ins);
    rig.frame(wide, false, 0);
    return rig;
  }

  it('turns about the framed content: its centre keeps its place in the free area, every step', () => {
    const rig = setUp();
    const start = rig.project(centre.x, 0, centre.z);
    expect(Math.abs(start.x - (free.l + free.r) / 2)).toBeLessThan(3);
    expect(Math.abs(start.y - (free.t + free.b) / 2)).toBeLessThan(3);
    const scale = rig.scale;
    for (let step = 1; step <= 6; step++) {
      rig.rotateBy(1, centre);
      // Half way round, too: the pivot does not swing about the screen.
      rig.update(performance.now() + 210);
      const mid = rig.project(centre.x, 0, centre.z);
      expect(Math.hypot(mid.x - start.x, mid.y - start.y)).toBeLessThan(1);
      done(rig);
      const p = rig.project(centre.x, 0, centre.z);
      expect(Math.hypot(p.x - start.x, p.y - start.y), `after ${step * 60} degrees`).toBeLessThan(0.5);
      expect(rig.scale).toBeCloseTo(scale, 9);
    }
  });

  it('without a pivot it turns about the middle of the free area, not the middle of the canvas', () => {
    const rig = setUp();
    // Pan a little (the player moved the view): the table point in the middle of the free area stays there.
    rig.panPixels(600, 400, 640, 380);
    const mid = { x: (free.l + free.r) / 2, y: (free.t + free.b) / 2 };
    const g = rig.groundAt(mid.x, mid.y)!;
    for (const steps of [1, 2, 3]) {
      rig.rotateBy(steps);
      done(rig);
      const p = rig.project(g.x, 0, g.z);
      expect(Math.hypot(p.x - mid.x, p.y - mid.y)).toBeLessThan(0.5);
    }
  });

  it('the old way (about the camera target) pushed the board down behind the tray at 180 degrees; now it stays in view', () => {
    const rig = setUp();
    rig.rotateBy(3, centre);
    done(rig);
    expect(rig.boxVisible(wide, 0)).toBe(true);
  });
});
