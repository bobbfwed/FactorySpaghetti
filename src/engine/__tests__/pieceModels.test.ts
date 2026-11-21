// The belt points and ore outputs in config.ts must match the printed pieces (RULES_CHANGES.md
// #30 and #32): on a building piece every hole that is not an input or output is a belt point,
// and each mine's ore outputs are where its printed rays and tracks end. Reads the models in
// public/models (converted byte-for-byte from the designer's AMS print file) the same way the
// table tests do (src/table/__tests__/models.test.ts), so the two can never drift apart.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BoardPiece, PieceType } from '../state';
import { MINE_TEMPLATES, PIECE_TEMPLATES, pieceTemplate, type MineId, type PointRole } from '../config';
import { parseGlb, type GlbPart } from '../../table/glb';
import {
  APOTHEM, HEX_RADIUS, MINE_HEX_MODEL_X, STUB_END_INSET, TILE_MODEL, edgeNormal, edgePoint, hexCorner,
  modelToWorld, piecePlacement, pointWorld, type XZ,
} from '../../table/layout';

const MODELS_DIR = join(__dirname, '..', '..', '..', 'public', 'models');
const load = (name: string): GlbPart[] => parseGlb(new Uint8Array(readFileSync(join(MODELS_DIR, `${name}.glb`))));
const part = (parts: GlbPart[], material: string): GlbPart => {
  const p = parts.find(x => x.material === material);
  if (!p) throw new Error(`no ${material} part`);
  return p;
};

/** Centre of each feature where the geometry meets the line `inset` mm in from an external hex edge. */
function edgeFeatures(p: GlbPart, isMine: boolean, inset: number, filter: (y: number) => boolean = () => true): Array<{ hex: 0 | 1; mid: XZ }> {
  const hexes: Array<{ hex: 0 | 1; c: XZ; skip: number }> = isMine
    ? [{ hex: 0, c: { x: MINE_HEX_MODEL_X[0], z: 0 }, skip: 0 }, { hex: 1, c: { x: MINE_HEX_MODEL_X[1], z: 0 }, skip: 3 }]
    : [{ hex: 0, c: { x: 0, z: 0 }, skip: -1 }];
  const out: Array<{ hex: 0 | 1; mid: XZ }> = [];
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
      let start = 0;
      for (let i = 1; i <= ts.length; i++) {
        if (i === ts.length || ts[i]! - ts[i - 1]! > 0.2) {
          out.push({ hex: h.hex, mid: edgePoint(h.c, ve, (ts[start]! + ts[i - 1]!) / 2, inset) });
          start = i;
        }
      }
    }
  }
  return out;
}

/** Engine positions of the features, for a piece of this type/id at `rotation` (each within 1 mm). */
function positionsOf(type: PieceType, id: string, rotation: number, features: Array<{ mid: XZ }>, inset: number): number[] {
  const piece: BoardPiece = { id, type, coord: { q: 2, r: -3 }, rotation, claims: [], input: null, output: null };
  const pl = piecePlacement(piece);
  const n = type === 'mine' ? 24 : 12;
  return features.map(f => {
    const w = modelToWorld(pl, f.mid.x, f.mid.z);
    let best = -1, bestD = Infinity;
    for (let pos = 0; pos < n; pos++) {
      const q = pointWorld(piece, pos, inset);
      const d = Math.hypot(q.x - w.x, q.z - w.z);
      if (d < bestD) { bestD = d; best = pos; }
    }
    expect(bestD, `${id} rot ${rotation}: feature is ${bestD.toFixed(2)} mm from #${best}`).toBeLessThan(1);
    return best;
  }).sort((a, b) => a - b);
}

const withRole = (points: ReadonlyArray<{ position: number; role: PointRole; enabled: boolean }>, ...roles: PointRole[]): number[] =>
  points.filter(p => p.enabled && roles.includes(p.role)).map(p => p.position).sort((a, b) => a - b);

const TILES = ['blank', 'plateFact', 'sphereFact', 'tesseractFact', 'powerPlant'] as const;

describe('piece templates match the printed pieces', () => {
  for (const type of TILES) {
    it(`${type}: the belt points are exactly the holes that are not an input or output, all rotations`, () => {
      const holes = edgeFeatures(part(load(TILE_MODEL[type]), 'body'), false, STUB_END_INSET, y => y < 0.05);
      const points = PIECE_TEMPLATES[type].points;
      const buffers = withRole(points, 'input_buffer', 'output_buffer');
      for (let rot = 0; rot < 6; rot++) {
        const measured = positionsOf(type, 'x', rot, holes, STUB_END_INSET);
        // A hole exactly at an input or output stays a buffer.
        expect(withRole(points, 'belt'), `${type} rot ${rot}`).toEqual(measured.filter(p => !buffers.includes(p)));
      }
    });
  }

  it('the measured belt points per piece type (the table in RULES_CHANGES.md #30)', () => {
    expect(Object.fromEntries(TILES.map(t => [t, withRole(PIECE_TEMPLATES[t].points, 'belt')]))).toEqual({
      blank: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
      plateFact: [2, 3, 4, 5, 8, 9, 10, 11],
      sphereFact: [3, 4, 5, 9, 10, 11],
      tesseractFact: [3, 4, 9, 10],
      powerPlant: [2, 3, 4, 5, 8, 9, 10, 11],
    });
  });

  for (const id of ['mine-1', 'mine-2', 'mine-3'] as const satisfies readonly MineId[]) {
    it(`${id}: ore outputs are where the printed rays and tracks end, and it has no holes, all rotations`, () => {
      const parts = load(id);
      const ends = edgeFeatures(part(parts, 'inlay-black'), true, STUB_END_INSET);
      const template = MINE_TEMPLATES[id];
      expect(pieceTemplate({ type: 'mine', id })).toBe(template);
      for (let rot = 0; rot < 6; rot++) {
        expect(positionsOf('mine', id, rot, ends, STUB_END_INSET), `${id} rot ${rot}`).toEqual(withRole(template.points, 'ore_output'));
      }
      // Belts never attach to a mine: no hole in its body, and no belt point in its template.
      const body = parts.find(p => p.material === 'body' || p.material === 'body-dark')!;
      expect(edgeFeatures(body, true, STUB_END_INSET, y => y < 0.05)).toHaveLength(0);
      expect(withRole(template.points, 'belt')).toEqual([]);
    });
  }

  it('rich hex 2-11 on every mine; lean hex 15, 17, 23 on mine 1 only', () => {
    expect(withRole(MINE_TEMPLATES['mine-1'].points, 'ore_output')).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 15, 17, 23]);
    expect(withRole(MINE_TEMPLATES['mine-2'].points, 'ore_output')).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(withRole(MINE_TEMPLATES['mine-3'].points, 'ore_output')).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    // Unknown mine ids (hand-built boards) read as mine 1.
    expect(pieceTemplate({ type: 'mine', id: 'mine' })).toBe(PIECE_TEMPLATES.mine);
  });
});
