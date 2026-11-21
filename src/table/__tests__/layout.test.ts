// Geometry checks for src/table/layout.ts, with no WebGL: the picture must agree with the engine
// about which connection points touch.

import { describe, it, expect, beforeAll } from 'vitest';
import type { BoardPiece, GameState } from '../../engine/state';
import { adjAt } from '../../engine/rules/flow';
import { mineSecondaryCoord } from '../../engine/rules/pieces';
import {
  APOTHEM, HEX_RADIUS, POINT_INSET, axialToWorld, worldToAxial, hexCorner, pointWorld, pointEdge,
  pointCount, piecePlacement, modelToWorld, worldToModel, MINE_HEX_MODEL_X, pieceCells,
  beltCurve, bezierAt, sampleCurve, curveFrameAt, bufferSlotWorld, positionsWithRole, pointRole,
  BUFFER_INSET, BUFFER_MATERIAL_SCALE, type XZ,
} from '../layout';
import { createBotGame, playUntil } from '../botGame';

/** Alignment tolerance: two touching points must coincide in their along-edge position within this. */
const TOL_MM = 0.01;

function dist(a: XZ, b: XZ): number { return Math.hypot(a.x - b.x, a.z - b.z); }

/** Signed distance of p from the line a-b (positive on the left going a->b), and its fraction along it. */
function lineCoords(p: XZ, a: XZ, b: XZ): { along: number; across: number } {
  const dx = b.x - a.x, dz = b.z - a.z;
  const l = Math.hypot(dx, dz);
  return {
    along: ((p.x - a.x) * dx + (p.z - a.z) * dz) / l,
    across: ((p.x - a.x) * dz - (p.z - a.z) * dx) / l,
  };
}

// Boards from real bot games: several seeds, all player counts, greedy and random bots; a mid-game
// and a final board from each.
const boards: Array<{ name: string; state: GameState }> = [];

beforeAll(() => {
  const runs: Array<[number, 2 | 3 | 4, 'greedy' | 'random']> = [
    [11, 4, 'greedy'], [12, 3, 'greedy'], [13, 2, 'greedy'],
    [21, 4, 'random'], [22, 3, 'random'], [23, 2, 'random'],
  ];
  for (const [seed, players, kind] of runs) {
    const game = createBotGame(seed, players, kind);
    boards.push({ name: `${kind}-${players}p-seed${seed}-round8`, state: playUntil(game, s => s.round >= 8, 6000) });
    boards.push({ name: `${kind}-${players}p-seed${seed}-final`, state: playUntil(game, () => false, 6000) });
  }
}, 120_000);

describe('real bot-game boards', () => {
  it('are non-trivial (many pieces, every rotation, belts, mines)', () => {
    const all = boards.flatMap(b => b.state.board);
    expect(Math.max(...boards.map(b => b.state.board.length))).toBeGreaterThan(30);
    const rots = new Set(all.filter(p => p.type !== 'mine').map(p => p.rotation ?? 0));
    expect(rots.size).toBe(6);
    expect(boards.some(b => b.state.board.filter(p => p.type === 'mine').length >= 2)).toBe(true);
    expect(boards.some(b => b.state.belts.length > 5)).toBe(true);
  });
});

describe('(a) points the engine aligns across a shared edge coincide on the table', () => {
  it(`mirror each other across the shared edge (tolerance ${TOL_MM} mm)`, () => {
    let pairs = 0, minePairs = 0, leanPairs = 0;
    for (const { name, state } of boards) {
      for (const piece of state.board) {
        if (piece.type === 'mine') continue; // adjAt is only defined from non-mine pieces
        for (let pos = 0; pos < 12; pos++) {
          const n = adjAt(piece.coord, piece.rotation ?? 0, pos, state.board);
          if (!n) continue;
          const p = pointWorld(piece, pos);
          const q = pointWorld(n.piece, n.pos);
          const [a, b] = pointEdge(piece, pos);
          const [na, nb] = pointEdge(n.piece, n.pos);
          const where = `${name}: ${piece.type} ${piece.id} #${pos} vs ${n.piece.type} ${n.piece.id} #${n.pos}`;
          // Both points lie on the same physical edge (the neighbour's edge runs the other way).
          expect(dist(a, nb), where).toBeLessThan(TOL_MM);
          expect(dist(b, na), where).toBeLessThan(TOL_MM);
          // Same place along the edge, the same distance in, on opposite sides.
          const lp = lineCoords(p, a, b);
          const lq = lineCoords(q, a, b);
          expect(Math.abs(lp.along - lq.along), where).toBeLessThan(TOL_MM);
          expect(Math.abs(lp.across + lq.across), where).toBeLessThan(TOL_MM);
          expect(Math.abs(Math.abs(lp.across) - POINT_INSET), where).toBeLessThan(TOL_MM);
          pairs++;
          if (n.piece.type === 'mine') { minePairs++; if (n.pos >= 12) leanPairs++; }
        }
      }
    }
    expect(pairs).toBeGreaterThan(500);
    expect(minePairs).toBeGreaterThan(20);
    expect(leanPairs).toBeGreaterThan(5);
  });

  it('every point of a piece lies inside its own hex, on the edge it belongs to', () => {
    for (const { state } of boards.slice(0, 4)) {
      for (const piece of state.board) {
        for (let pos = 0; pos < pointCount(piece.type); pos++) {
          const p = pointWorld(piece, pos);
          const cell = worldToAxial(p.x, p.z);
          expect(pieceCells(piece).some(c => c.q === cell.q && c.r === cell.r)).toBe(true);
          const [a, b] = pointEdge(piece, pos);
          const lc = lineCoords(p, a, b);
          expect(lc.along).toBeGreaterThan(0);
          expect(lc.along).toBeLessThan(dist(a, b));
        }
      }
    }
  });
});

describe('(b) tiles touch edge to edge and never overlap', () => {
  it('every pair of occupied cells is either a full shared edge or apart', () => {
    for (const { name, state } of boards) {
      const cells = state.board.flatMap(p => pieceCells(p).map(c => ({ c, w: axialToWorld(c), id: p.id })));
      const keys = new Set(cells.map(x => `${x.c.q},${x.c.r}`));
      expect(keys.size, `${name}: two pieces claim the same cell`).toBe(cells.length);
      for (let i = 0; i < cells.length; i++) {
        for (let j = i + 1; j < cells.length; j++) {
          const A = cells[i]!, B = cells[j]!;
          const d = dist(A.w, B.w);
          // Separating axis along the centre line: hexes are convex and symmetric, so their
          // extents along the centre line meet but never cross.
          expect(d, name).toBeGreaterThanOrEqual(2 * APOTHEM - TOL_MM);
          if (d < 2 * APOTHEM + TOL_MM) {
            // Neighbours: exactly two corners in common (the shared edge).
            const ca = [0, 1, 2, 3, 4, 5].map(k => hexCorner(A.w, k));
            const cb = [0, 1, 2, 3, 4, 5].map(k => hexCorner(B.w, k));
            const shared = ca.filter(p => cb.some(q => dist(p, q) < TOL_MM)).length;
            expect(shared, name).toBe(2);
          }
        }
      }
    }
  });

  it('a whole tile model footprint (68.85 mm across flats) fits its cell exactly', () => {
    const a = axialToWorld({ q: 0, r: 0 });
    for (const n of [{ q: 1, r: 0 }, { q: 0, r: 1 }, { q: -1, r: 1 }]) {
      expect(dist(a, axialToWorld(n))).toBeCloseTo(68.849, 6);
    }
    expect(HEX_RADIUS * Math.sqrt(3)).toBeCloseTo(68.849, 6);
  });
});

describe('(c) the mine model covers coord and mineSecondaryCoord', () => {
  it('for all six rotations, at several places', () => {
    for (const coord of [{ q: 0, r: 0 }, { q: 3, r: -2 }, { q: -4, r: 5 }]) {
      for (let rot = 0; rot < 6; rot++) {
        const mine: BoardPiece = { id: 'mine-1', type: 'mine', coord, rotation: rot, claims: [], input: null, output: null };
        const pl = piecePlacement(mine);
        const h0 = modelToWorld(pl, MINE_HEX_MODEL_X[0], 0);
        const h1 = modelToWorld(pl, MINE_HEX_MODEL_X[1], 0);
        expect(dist(h0, axialToWorld(coord)), `rot ${rot}`).toBeLessThan(TOL_MM);
        expect(dist(h1, axialToWorld(mineSecondaryCoord(coord, rot))), `rot ${rot}`).toBeLessThan(TOL_MM);
        // And the inverse transform round-trips.
        const back = worldToModel(pl, h1.x, h1.z);
        expect(back.x).toBeCloseTo(MINE_HEX_MODEL_X[1], 6);
        expect(back.z).toBeCloseTo(0, 6);
      }
    }
  });

  it("the mine's points sit on its own two hexes, the internal edges facing each other", () => {
    for (let rot = 0; rot < 6; rot++) {
      const mine: BoardPiece = { id: 'mine-2', type: 'mine', coord: { q: 0, r: 0 }, rotation: rot, claims: [], input: null, output: null };
      const sec = axialToWorld(mineSecondaryCoord(mine.coord, rot));
      const pri = axialToWorld(mine.coord);
      // Disabled internal edges (hex 0 positions 0/1, hex 1 positions 18/19) lie on the shared edge,
      // i.e. equally far from both hex centres; every other point is nearer its own hex.
      for (let pos = 0; pos < 24; pos++) {
        const p = pointWorld(mine, pos, 0);
        const own = pos < 12 ? pri : sec, other = pos < 12 ? sec : pri;
        if ([0, 1, 18, 19].includes(pos)) expect(Math.abs(dist(p, pri) - dist(p, sec)), `rot ${rot} #${pos}`).toBeLessThan(TOL_MM);
        else expect(dist(p, own), `rot ${rot} #${pos}`).toBeLessThan(dist(p, other) - 1);
      }
      for (const pos of [15, 17, 23]) expect(pointRole('mine', pos)).toBe('ore_output');
    }
  });
});

describe('buffers and belts', () => {
  it('buffer slots follow the engine slot order and sit inside their tile', () => {
    const tess: BoardPiece = {
      id: 't', type: 'tesseractFact', coord: { q: 2, r: -1 }, rotation: 4, claims: [],
      input: { slots: [null, null, null], teleporterOwner: null }, output: { slots: [null], teleporterOwner: null },
    };
    expect(positionsWithRole('tesseractFact', 'input_buffer')).toEqual([0, 2, 11]);
    const c = axialToWorld(tess.coord);
    const slots = [0, 1, 2].map(i => bufferSlotWorld(tess, 'input', i));
    slots.forEach((s, i) => {
      const pos = [0, 2, 11][i]!;
      // Each slot lies on the line from its hole straight inwards.
      const hole = pointWorld(tess, pos);
      expect(dist(s, c)).toBeLessThan(dist(hole, c));
      expect(dist(s, hole)).toBeCloseTo(BUFFER_INSET - POINT_INSET, 6);
    });
    // Material pieces are at most 16.5 mm x 12 mm printed, drawn at BUFFER_MATERIAL_SCALE.
    for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) {
      expect(dist(slots[i]!, slots[j]!)).toBeGreaterThan(12 * BUFFER_MATERIAL_SCALE + 1);
    }
  });

  it('a belt curve starts and ends on its two holes, leaving them heading inwards', () => {
    const blank: BoardPiece = { id: 'b', type: 'blank', coord: { q: 1, r: 1 }, rotation: 2, claims: [], input: null, output: null };
    for (const [f, t] of [[0, 6], [0, 3], [1, 8], [4, 9], [11, 5]] as const) {
      const c = beltCurve(blank, f, t);
      expect(dist(bezierAt(c, 0), pointWorld(blank, f))).toBeLessThan(1e-9);
      expect(dist(bezierAt(c, 1), pointWorld(blank, t))).toBeLessThan(1e-9);
      const s = sampleCurve(c);
      const mid = curveFrameAt(s, 0.5).p;
      const centre = axialToWorld(blank.coord);
      expect(dist(mid, centre)).toBeLessThan(APOTHEM); // stays on the tile
    }
  });
});
