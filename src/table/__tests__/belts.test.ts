// Belts lie as the printed belt does: turned so the pegs at its ends point down into the tile's
// holes, the chain face up, each end reaching a little past the tile edge so belts meeting at a
// shared edge overlap. Reads public/models/belt.glb.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as THREE from 'three';
import type { BoardPiece } from '../../engine/state';
import { parseGlb } from '../glb';
import { beltShape, bendBeltItems, bendBelts } from '../scene';
import {
  APOTHEM, BELT_SPILL, BELT_THICKNESS, BELT_TUCK, POINT_INSET, STUB_END_INSET, TILE_TOP, axialToWorld,
  pointNormal, pointWorld, type XZ,
} from '../layout';

const MODELS_DIR = join(__dirname, '..', '..', '..', 'public', 'models');

function beltGeometry(): THREE.BufferGeometry {
  const part = parseGlb(new Uint8Array(readFileSync(join(MODELS_DIR, 'belt.glb'))))[0]!;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(part.positions, 3));
  return g;
}

const base = beltGeometry();
const WHITE = new THREE.Color(1, 1, 1);

function tile(q: number, r: number, rotation = 0): BoardPiece {
  return { id: `t${q},${r}`, type: 'blank', coord: { q, r }, rotation, claims: [], input: null, output: null };
}

function verts(g: THREE.BufferGeometry): Array<{ x: number; y: number; z: number }> {
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  const out = [];
  for (let i = 0; i < p.count; i++) out.push({ x: p.getX(i), y: p.getY(i), z: p.getZ(i) });
  return out;
}

/** A point in the frame of a hole: `out` = distance in from the tile edge (+ inwards), `along` = offset along the edge. */
function holeFrame(piece: BoardPiece, pos: number, v: XZ): { inFromEdge: number; along: number } {
  const h = pointWorld(piece, pos), n = pointNormal(piece, pos);
  const dx = v.x - h.x, dz = v.z - h.z;
  return { inFromEdge: POINT_INSET - (dx * n.x + dz * n.z), along: dx * -n.z + dz * n.x };
}

describe('belt model', () => {
  it("chain links are chevrons pointing at the model's zMin end (its arrow tip)", () => {
    // Rasterise the chain face that ends up on top (model y = 0) along the middle of the belt and
    // compare where the centre line and two lines either side of it change between link and gap:
    // on chevrons "^" pointing at -Z every change comes first (at lower z) on the centre line.
    const part = parseGlb(new Uint8Array(readFileSync(join(MODELS_DIR, 'belt.glb'))))[0]!;
    const P = part.positions, I = part.indices!;
    expect(I.length).toBeGreaterThan(0);
    const tris: Array<[number, number, number, number, number, number]> = [];
    for (let t = 0; t < I.length; t += 3) {
      const a = I[t]!, b = I[t + 1]!, c = I[t + 2]!;
      if (Math.max(P[a * 3 + 1]!, P[b * 3 + 1]!, P[c * 3 + 1]!) > 0.05) continue;
      tris.push([P[a * 3]!, P[a * 3 + 2]!, P[b * 3]!, P[b * 3 + 2]!, P[c * 3]!, P[c * 3 + 2]!]);
    }
    const filled = (x: number, z: number): boolean => tris.some(([ax, az, bx, bz, cx, cz]) => {
      const s = (px: number, pz: number, qx: number, qz: number): number => (qx - px) * (z - pz) - (qz - pz) * (x - px);
      const d1 = s(ax, az, bx, bz), d2 = s(bx, bz, cx, cz), d3 = s(cx, cz, ax, az);
      return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
    });
    /** z of every link/gap change along the line at x (and which way it changes). */
    const changes = (x: number): Array<{ z: number; on: boolean }> => {
      const out: Array<{ z: number; on: boolean }> = [];
      let prev = filled(x, -20);
      for (let z = -20; z <= 20; z += 0.02) {
        const f = filled(x, z);
        if (f !== prev) out.push({ z, on: f });
        prev = f;
      }
      return out;
    };
    const centre = changes(0);
    expect(centre.length).toBeGreaterThan(10);
    const lags: number[] = [];
    for (const side of [changes(-1.2), changes(1.2)]) {
      for (const c of centre) {
        const near = side.filter(s => s.on === c.on && Math.abs(s.z - c.z) < 1.4);
        if (near.length === 0) continue;
        const s = near.reduce((a, b) => (Math.abs(a.z - c.z) < Math.abs(b.z - c.z) ? a : b));
        lags.push(s.z - c.z);
      }
    }
    expect(lags.length).toBeGreaterThan(10);
    // Every change reaches the sides later (+z) than the centre line.
    expect(lags.filter(l => l > 0.2).length / lags.length).toBeGreaterThan(0.9);
  });


  it('has a D-shaped peg standing up from each end of a flat chain', () => {
    const s = beltShape(base);
    expect(s.chainTop).toBeCloseTo(BELT_THICKNESS, 1);
    expect(s.pegTop).toBeCloseTo(5.3, 1);
    expect(s.pegs[0].c).toBeCloseTo(-31.9, 0);
    expect(s.pegs[1].c).toBeCloseTo(31.65, 0);
    for (const p of s.pegs) {
      expect(p.half).toBeGreaterThan(2);
      expect(p.half).toBeLessThan(2.6);
    }
  });
});

describe('belts on a tile', () => {
  // Every rotation, a straight belt, a turn and a U-shaped belt.
  const pairs: Array<[number, number]> = [[0, 6], [1, 5], [0, 9], [2, 10], [3, 7]];
  for (let rot = 0; rot < 6; rot++) {
    it(`rotation ${rot}: pegs go down into the two holes, chain face up on the tile`, () => {
      const piece = tile(1, -1, rot);
      for (const [from, to] of pairs) {
        const v = verts(bendBeltItems(base, [{ piece, from, to, color: WHITE }]));
        // (The chain's bottom past the edge dips by BELT_TUCK, so pegs are what is lower than that.)
        const pegs = v.filter(p => p.y < TILE_TOP - BELT_TUCK - 0.05);
        const chain = v.filter(p => p.y >= TILE_TOP - BELT_TUCK - 0.05);
        expect(Math.max(...chain.map(p => p.y))).toBeCloseTo(TILE_TOP + BELT_THICKNESS, 2);
        expect(Math.min(...pegs.map(p => p.y))).toBeGreaterThanOrEqual(0);
        expect(Math.min(...pegs.map(p => p.y))).toBeLessThan(0.1);
        // Each peg vertex lies in one of the two holes (holes span 2.17-7.13 mm in from the edge, Â±3.4 mm along it).
        let a = 0, b = 0;
        for (const p of pegs) {
          const fa = holeFrame(piece, from, p), fb = holeFrame(piece, to, p);
          const inA = fa.inFromEdge > STUB_END_INSET - 0.3 && fa.inFromEdge < 7.4 && Math.abs(fa.along) < 3.5;
          const inB = fb.inFromEdge > STUB_END_INSET - 0.3 && fb.inFromEdge < 7.4 && Math.abs(fb.along) < 3.5;
          expect(inA || inB, `${from}-${to}: peg vertex (${p.x.toFixed(1)}, ${p.z.toFixed(1)}) not in a hole`).toBe(true);
          if (inA) a++;
          if (inB) b++;
        }
        expect(a).toBeGreaterThan(10);
        expect(b).toBeGreaterThan(10);
        // Each end reaches BELT_SPILL past the tile edge, and no further.
        for (const pos of [from, to]) {
          const reach = Math.max(...v.map(p => -holeFrame(piece, pos, p).inFromEdge).filter(d => d > -10));
          expect(reach, `${from}-${to} at #${pos}`).toBeCloseTo(BELT_SPILL, 1);
        }
      }
    });
  }

  it('two belts meeting at a shared edge overlap, each tucked under the other past the seam', () => {
    // Tile A at (0,0) and its east neighbour B at (1,0). A's #6 and B's #1 are the same spot on the shared edge.
    const A = tile(0, 0), B = tile(1, 0);
    const pa = pointWorld(A, 6, 0), pb = pointWorld(B, 1, 0);
    expect(Math.hypot(pa.x - pb.x, pa.z - pb.z)).toBeLessThan(0.01);
    const seam = axialToWorld(A.coord).x + APOTHEM;
    const va = verts(bendBeltItems(base, [{ piece: A, from: 0, to: 6, color: WHITE }])).filter(p => p.y >= TILE_TOP - 0.5);
    const vb = verts(bendBeltItems(base, [{ piece: B, from: 1, to: 7, color: WHITE }])).filter(p => p.y >= TILE_TOP - 0.5);
    expect(Math.max(...va.map(p => p.x)) - seam).toBeCloseTo(BELT_SPILL, 1);
    expect(seam - Math.min(...vb.map(p => p.x))).toBeCloseTo(BELT_SPILL, 1);
    // Past the seam, A's top is lower than B's top there (B lies on its own tile at full height).
    const aPast = va.filter(p => p.x > seam + 0.5);
    expect(Math.max(...aPast.map(p => p.y))).toBeLessThan(TILE_TOP + BELT_THICKNESS - 0.05);
    const bPast = vb.filter(p => p.x < seam - 0.5);
    expect(Math.max(...bPast.map(p => p.y))).toBeLessThan(TILE_TOP + BELT_THICKNESS - 0.05);
  });

  it('the model end at zMin (the arrow tip) is laid at `from`', () => {
    const piece = tile(0, 0);
    const p = base.getAttribute('position') as THREE.BufferAttribute;
    let iMin = 0, iMax = 0;
    for (let i = 0; i < p.count; i++) { if (p.getZ(i) < p.getZ(iMin)) iMin = i; if (p.getZ(i) > p.getZ(iMax)) iMax = i; }
    for (const [from, to] of [[0, 6], [6, 0], [2, 9]] as const) {
      const v = verts(bendBeltItems(base, [{ piece, from, to, color: WHITE }]));
      const hf = pointWorld(piece, from), ht = pointWorld(piece, to);
      const d = (a: XZ, b: XZ): number => Math.hypot(a.x - b.x, a.z - b.z);
      expect(d(v[iMin]!, hf)).toBeLessThan(10);
      expect(d(v[iMax]!, ht)).toBeLessThan(10);
    }
  });

  it('bendBelts points every belt of a chain at its head: away from a Mine, whichever way it was tapped', () => {
    const mine: BoardPiece = { id: 'mine-1', type: 'mine', coord: { q: 0, r: 0 }, rotation: 0, claims: [], input: null, output: { slots: [null], teleporters: [] } };
    const A = { ...tile(2, 0), id: 'A' }, B = { ...tile(3, 0), id: 'B' };
    const p = base.getAttribute('position') as THREE.BufferAttribute;
    let iMin = 0;
    for (let i = 0; i < p.count; i++) if (p.getZ(i) < p.getZ(iMin)) iMin = i;
    for (const order of [[0, 7], [7, 0]] as const) {
      const belts = [A, B].map(t => ({ id: `b${t.id}`, pieceId: t.id, ownerId: 0 as const, fromPoint: order[0], toPoint: order[1] }));
      const g = verts(bendBelts(base, { board: [mine, A, B], belts }, () => WHITE));
      // Belt k's vertices start at k * p.count; its tip lies at point 7 (east, away from the Mine).
      [A, B].forEach((t, k) => {
        const tip = g[k * p.count + iMin]!, east = pointWorld(t, 7);
        expect(Math.hypot(tip.x - east.x, tip.z - east.z)).toBeLessThan(10);
      });
    }
  });

  it('a belt on a piece that is not on the board is left out', () => {
    const g = bendBelts(base, { board: [tile(0, 0)], belts: [{ id: 'b1', pieceId: 'gone', ownerId: 0, fromPoint: 0, toPoint: 6 }] }, () => WHITE);
    expect((g.getAttribute('position') as THREE.BufferAttribute).count).toBe(0);
  });
});
