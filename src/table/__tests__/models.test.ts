// (d) The model-orientation table in layout.ts matches the models themselves. Reads the .glb files
// in public/models, finds where the black stubs / rays / tracks stop at the tile edge and where the
// belt holes are, and checks those land on the engine's positions for every rotation.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BoardPiece, PieceType } from '../../engine/state';
import { parseGlb, type GlbPart } from '../glb';
import {
  APOTHEM, HEX_RADIUS, POINT_T, STUB_END_INSET, MINE_HEX_MODEL_X, MINE_SLOT_MODEL, MODULE_SQUARE,
  TILE_MODEL, edgeNormal, edgePoint, hexCorner, modelToWorld, piecePlacement, pointWorld, pointRole,
  positionsWithRole, type ModelName, type XZ,
} from '../layout';

const MODELS_DIR = join(__dirname, '..', '..', '..', 'public', 'models');
const load = (name: ModelName | string): GlbPart[] => parseGlb(new Uint8Array(readFileSync(join(MODELS_DIR, `${name}.glb`))));
const part = (parts: GlbPart[], material: string): GlbPart => {
  const p = parts.find(x => x.material === material);
  if (!p) throw new Error(`no ${material} part`);
  return p;
};

/** A feature where geometry meets the line STUB_END_INSET in from an edge: hex, edge, span along it. */
interface EdgeFeature { hex: 0 | 1; ve: number; t0: number; t1: number; mid: XZ }

/**
 * Cluster the vertices lying `inset` mm in from an external hex edge (model space). For a mine the
 * shared edges in the middle are skipped. `filter` picks which vertices count (e.g. bottom face).
 */
function edgeFeatures(p: GlbPart, isMine: boolean, inset: number, filter: (y: number) => boolean = () => true): EdgeFeature[] {
  const hexes: Array<{ hex: 0 | 1; c: XZ; skip: number }> = isMine
    ? [{ hex: 0, c: { x: MINE_HEX_MODEL_X[0], z: 0 }, skip: 0 }, { hex: 1, c: { x: MINE_HEX_MODEL_X[1], z: 0 }, skip: 3 }]
    : [{ hex: 0, c: { x: 0, z: 0 }, skip: -1 }];
  const out: EdgeFeature[] = [];
  for (const h of hexes) {
    for (let ve = 0; ve < 6; ve++) {
      if (ve === h.skip) continue;
      const a = hexCorner(h.c, ve), b = hexCorner(h.c, ve + 1), n = edgeNormal(ve);
      const ts: number[] = [];
      for (let i = 0; i < p.positions.length; i += 3) {
        const x = p.positions[i]!, y = p.positions[i + 1]!, z = p.positions[i + 2]!;
        if (isMine && Math.sign(x) !== Math.sign(h.c.x)) continue;
        if (!filter(y)) continue;
        const d = APOTHEM - ((x - h.c.x) * n.x + (z - h.c.z) * n.z);
        if (Math.abs(d - inset) > 0.06) continue;
        const t = ((x - a.x) * (b.x - a.x) + (z - a.z) * (b.z - a.z)) / (HEX_RADIUS * HEX_RADIUS);
        if (t > 0.02 && t < 0.98) ts.push(t);
      }
      ts.sort((u, v) => u - v);
      // Two features on one edge are ~0.3 apart (0.27 / 0.73); one feature is < 0.2 wide.
      let start = 0;
      for (let i = 1; i <= ts.length; i++) {
        if (i === ts.length || ts[i]! - ts[i - 1]! > 0.2) {
          const t0 = ts[start]!, t1 = ts[i - 1]!;
          out.push({ hex: h.hex, ve, t0, t1, mid: edgePoint(h.c, ve, (t0 + t1) / 2, inset) });
          start = i;
        }
      }
    }
  }
  return out;
}

/** Engine positions whose point (at the given inset) lies within `tol` mm of each feature, for a piece at `rotation`. */
function featurePositions(type: PieceType, id: string, rotation: number, features: EdgeFeature[], inset: number, tol = 1.0): number[] {
  const piece: BoardPiece = { id, type, coord: { q: 2, r: -3 }, rotation, claims: [], input: null, output: null };
  const pl = piecePlacement(piece);
  const n = type === 'mine' ? 24 : 12;
  const found: number[] = [];
  for (const f of features) {
    const w = modelToWorld(pl, f.mid.x, f.mid.z);
    let best = -1, bestD = Infinity;
    for (let pos = 0; pos < n; pos++) {
      const q = pointWorld(piece, pos, inset);
      const d = Math.hypot(q.x - w.x, q.z - w.z);
      if (d < bestD) { bestD = d; best = pos; }
    }
    expect(bestD, `${id} rot ${rotation}: feature at ve ${f.ve} t ${((f.t0 + f.t1) / 2).toFixed(3)} is ${bestD.toFixed(2)} mm from #${best}`).toBeLessThan(tol);
    found.push(best);
  }
  return found.sort((a, b) => a - b);
}

const FACTORY_TYPES: Array<Exclude<PieceType, 'mine' | 'blank'>> = ['plateFact', 'sphereFact', 'tesseractFact', 'powerPlant'];

describe('(d) model orientation table matches the measured models', () => {
  it('connection points sit at the measured fractions along each edge (holes, stubs, rays)', () => {
    const blankBody = part(load('tile-blank'), 'body');
    const holes = edgeFeatures(blankBody, false, STUB_END_INSET, y => y < 0.05);
    expect(holes).toHaveLength(12);
    for (const h of holes) {
      const mid = (h.t0 + h.t1) / 2;
      const expected = mid < 0.5 ? POINT_T[0] : POINT_T[1];
      expect(Math.abs(mid - expected)).toBeLessThan(0.005);
    }
  });

  for (const type of FACTORY_TYPES) {
    it(`${type}: black stubs end exactly at the engine's input/output positions, all rotations`, () => {
      const stubs = edgeFeatures(part(load(TILE_MODEL[type]), 'inlay-black'), false, STUB_END_INSET);
      const expected = [...positionsWithRole(type, 'input_buffer'), ...positionsWithRole(type, 'output_buffer')].sort((a, b) => a - b);
      for (let rot = 0; rot < 6; rot++) {
        expect(featurePositions(type, 'x', rot, stubs, STUB_END_INSET)).toEqual(expected);
      }
    });
  }

  for (const mine of ['mine-1', 'mine-2', 'mine-3'] as const) {
    it(`${mine}: rays end at the 10 ore outputs of the rayed hex, all rotations`, () => {
      const f = edgeFeatures(part(load(mine), 'inlay-black'), true, STUB_END_INSET).filter(x => x.hex === 0);
      const expected = positionsWithRole('mine', 'ore_output').filter(p => p < 12);
      expect(expected).toHaveLength(10);
      for (let rot = 0; rot < 6; rot++) expect(featurePositions('mine', mine, rot, f, STUB_END_INSET)).toEqual(expected);
    });
  }

  it("mine-1: the track ends on the second hex are the engine's ore outputs 15, 17, 23, all rotations", () => {
    const f = edgeFeatures(part(load('mine-1'), 'inlay-black'), true, STUB_END_INSET).filter(x => x.hex === 1);
    expect(f).toHaveLength(3);
    for (let rot = 0; rot < 6; rot++) expect(featurePositions('mine', 'mine-1', rot, f, STUB_END_INSET)).toEqual([15, 17, 23]);
    // And they are where the engine has ore outputs.
    for (const pos of [15, 17, 23]) expect(pointRole('mine', pos)).toBe('ore_output');
  });

  it('mines 2 and 3 have nothing printed at the second-hex ore outputs (finding for the designer)', () => {
    for (const mine of ['mine-2', 'mine-3'] as const) {
      const f = edgeFeatures(part(load(mine), 'inlay-black'), true, STUB_END_INSET).filter(x => x.hex === 1);
      expect(f, mine).toHaveLength(0);
    }
  });

  it('belt holes: blank has all 12; factories and the power plant have holes the engine does not use', () => {
    const measured: Record<string, number[]> = {};
    for (const type of ['blank', ...FACTORY_TYPES] as const) {
      const holes = edgeFeatures(part(load(TILE_MODEL[type]), 'body'), false, STUB_END_INSET, y => y < 0.05);
      measured[type] = featurePositions(type, 'x', 0, holes, STUB_END_INSET);
      // Same answer for every rotation.
      for (let rot = 1; rot < 6; rot++) expect(featurePositions(type, 'x', rot, holes, STUB_END_INSET)).toEqual(measured[type]);
    }
    // Measured (and confirmed against docs/reference/current-building-tiles.png).
    expect(measured).toEqual({
      blank: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
      plateFact: [2, 3, 4, 5, 8, 9, 10, 11],
      sphereFact: [3, 4, 5, 9, 10, 11],
      tesseractFact: [3, 4, 9, 10],
      powerPlant: [2, 3, 4, 5, 8, 9, 10, 11],
    });
    // Every engine belt point has a hole...
    for (const type of ['blank', ...FACTORY_TYPES] as const) {
      for (const pos of positionsWithRole(type, 'belt')) expect(measured[type], `${type} #${pos}`).toContain(pos);
    }
    // ...but some holes are positions the engine disables (reported to the designer).
    const extra = Object.fromEntries(Object.entries(measured).map(([t, hs]) =>
      [t, hs.filter(p => pointRole(t as PieceType, p) !== 'belt')]));
    expect(extra).toEqual({ blank: [], plateFact: [2, 5, 8, 11], sphereFact: [5, 11], tesseractFact: [], powerPlant: [2, 5, 8, 11] });
  });

  it('meeple-slot icons on the mines are where MINE_SLOT_MODEL says', () => {
    const green: Record<string, string> = { 'mine-1': 'icon-green-light', 'mine-2': 'icon-green', 'mine-3': 'lime-green' };
    for (const mine of ['mine-1', 'mine-2', 'mine-3'] as const) {
      const parts = load(mine);
      const centre = (p: GlbPart): XZ => {
        let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
        for (let i = 0; i < p.positions.length; i += 3) {
          minX = Math.min(minX, p.positions[i]!); maxX = Math.max(maxX, p.positions[i]!);
          minZ = Math.min(minZ, p.positions[i + 2]!); maxZ = Math.max(maxZ, p.positions[i + 2]!);
        }
        return { x: (minX + maxX) / 2, z: (minZ + maxZ) / 2 };
      };
      const g = centre(part(parts, green[mine]!));
      const b = centre(part(parts, 'icon-blue'));
      const [s0, s1] = MINE_SLOT_MODEL[mine];
      expect(Math.hypot(g.x - s0.x, g.z - s0.z), `${mine} resource icon`).toBeLessThan(0.3);
      expect(Math.hypot(b.x - s1.x, b.z - s1.z), `${mine} upgrade icon`).toBeLessThan(0.3);
      // Both icons are on the second hex half (x > 0).
      expect(g.x).toBeGreaterThan(0);
      expect(b.x).toBeGreaterThan(0);
    }
  });

  it('the Control Module square outline is centred, 30 x 26 mm, on all three factories', () => {
    for (const type of ['plateFact', 'sphereFact', 'tesseractFact'] as const) {
      const p = part(load(TILE_MODEL[type]), 'inlay-black');
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
      for (let i = 0; i < p.positions.length; i += 3) {
        const x = p.positions[i]!, z = p.positions[i + 2]!;
        if (Math.abs(x) > 17 || Math.abs(z) > 15) continue;
        minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
      }
      expect(minX).toBeCloseTo(-MODULE_SQUARE.halfX, 0);
      expect(maxX).toBeCloseTo(MODULE_SQUARE.halfX, 0);
      expect(minZ).toBeCloseTo(-MODULE_SQUARE.halfZ, 0);
      expect(maxZ).toBeCloseTo(MODULE_SQUARE.halfZ, 0);
    }
  });
});
