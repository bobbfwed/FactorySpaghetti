// Teleporters on the table: the model converted from the designer's Teleporter.3mf, and where it
// stands on a building (layout.ts teleporterPlacement). No WebGL: footprints are checked as
// rectangles on the table plane.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BoardPiece, PieceType } from '../../engine/state';
import { parseGlb, type GlbPart } from '../glb';
import {
  APOTHEM, BUFFER_MATERIAL_SCALE, TELEPORTER_HALF_LENGTH, TELEPORTER_HALF_WIDTH, TELEPORTER_HEIGHT, TELEPORTER_SCALE,
  axialToWorld, bufferSlotWorld, buildingMeepleWorld, claimLayout, edgeNormal, modelToWorld, piecePlacement,
  pointWorld, positionsWithRole, teleporterPlacement, type XZ,
} from '../layout';

const MODELS_DIR = join(__dirname, '..', '..', '..', 'public', 'models');
const load = (name: string): GlbPart[] => parseGlb(new Uint8Array(readFileSync(join(MODELS_DIR, `${name}.glb`))));
const manifest = JSON.parse(readFileSync(join(MODELS_DIR, 'manifest.json'), 'utf8')) as {
  models: Array<{ name: string; parts: Array<{ material: string }>; trianglesAfter: number; budget: number; bbox: { min: number[]; max: number[] } }>;
};

function bbox(parts: readonly GlbPart[]): { min: number[]; max: number[] } {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const p of parts) for (let i = 0; i < p.positions.length; i++) {
    min[i % 3] = Math.min(min[i % 3]!, p.positions[i]!);
    max[i % 3] = Math.max(max[i % 3]!, p.positions[i]!);
  }
  return { min, max };
}

describe('the teleporter model', () => {
  const parts = load('teleporter');

  it('is one player-coloured part, within its triangle budget, listed in the manifest', () => {
    expect(parts.map(p => p.material)).toEqual(['player']);
    const m = manifest.models.find(x => x.name === 'teleporter');
    expect(m).toBeDefined();
    expect(m!.parts.map(p => p.material)).toEqual(['player']);
    expect(m!.trianglesAfter).toBeLessThanOrEqual(m!.budget);
    expect(m!.budget).toBeLessThanOrEqual(800);
  });

  it('has the size layout.ts assumes, centred on its footprint and standing on Y = 0', () => {
    const b = bbox(parts);
    expect(b.min[0]).toBeCloseTo(-TELEPORTER_HALF_LENGTH, 2);
    expect(b.max[0]).toBeCloseTo(TELEPORTER_HALF_LENGTH, 2);
    expect(b.min[2]).toBeCloseTo(-TELEPORTER_HALF_WIDTH, 2);
    expect(b.max[2]).toBeCloseTo(TELEPORTER_HALF_WIDTH, 2);
    expect(b.min[1]).toBeCloseTo(0, 3);
    expect(b.max[1]).toBeCloseTo(TELEPORTER_HEIGHT, 1); // the simplified arch top is a few hundredths lower
  });

  it('has its portal (the recessed swirl) on the +X end and a plain -X end', () => {
    // Vertices of the relief lie behind the end face, inside the arch, away from the sides and top.
    const relief = (sign: 1 | -1): number => {
      let n = 0;
      const pos = parts[0]!.positions;
      for (let i = 0; i < pos.length; i += 3) {
        const x = pos[i]! * sign, y = pos[i + 1]!, z = pos[i + 2]!;
        if (x > TELEPORTER_HALF_LENGTH - 3.8 && x < TELEPORTER_HALF_LENGTH - 0.05 && Math.abs(z) < 3.5 && y > 2 && y < 9) n++;
      }
      return n;
    };
    expect(relief(1)).toBeGreaterThan(30);
    expect(relief(-1)).toBe(0);
  });
});

// ── Placement on the buildings ─────────────────────────────────────────────────────────────────

/** An oriented rectangle on the table: centre, unit axis u (the second axis is u turned 90 degrees), half sizes. */
interface Rect { c: XZ; u: XZ; hu: number; hv: number }
/** A footprint turned by `yaw` (Three.js convention: model +X goes to (cos, -sin)). */
const rect = (c: XZ, yaw: number, hu: number, hv: number): Rect => ({ c, u: { x: Math.cos(yaw), z: -Math.sin(yaw) }, hu, hv });

/** Gap between two rectangles (separating-axis test): positive when apart, negative when they overlap. */
function gap(a: Rect, b: Rect): number {
  let best = -Infinity;
  for (const r of [a, b]) {
    for (const ax of [r.u, { x: -r.u.z, z: r.u.x }]) {
      const span = (q: Rect): [number, number] => {
        const v = { x: -q.u.z, z: q.u.x };
        const c = q.c.x * ax.x + q.c.z * ax.z;
        const e = q.hu * Math.abs(q.u.x * ax.x + q.u.z * ax.z) + q.hv * Math.abs(v.x * ax.x + v.z * ax.z);
        return [c - e, c + e];
      };
      const [a0, a1] = span(a), [b0, b1] = span(b);
      best = Math.max(best, b0 - a1, a0 - b1);
    }
  }
  return best;
}

function corners(r: Rect): XZ[] {
  const v = { x: -r.u.z, z: r.u.x };
  return [[1, 1], [1, -1], [-1, 1], [-1, -1]].map(([a, b]) => ({
    x: r.c.x + a! * r.hu * r.u.x + b! * r.hv * v.x, z: r.c.z + a! * r.hu * r.u.z + b! * r.hv * v.z,
  }));
}

/** Half sizes (x, z) of a model's footprint, from its .glb. */
function halfSize(name: string): { x: number; z: number } {
  const b = bbox(load(name));
  return { x: (b.max[0]! - b.min[0]!) / 2, z: (b.max[2]! - b.min[2]!) / 2 };
}

const BUILDINGS: ReadonlyArray<{ type: PieceType; inputs: number }> = [
  { type: 'plateFact', inputs: 1 }, { type: 'sphereFact', inputs: 2 }, { type: 'tesseractFact', inputs: 3 }, { type: 'powerPlant', inputs: 1 },
];

/** A building with a teleporter on every input and on the output (RULES_CHANGES.md #55). */
function building(type: PieceType, inputs: number, rotation: number): BoardPiece {
  const buf = (n: number): BoardPiece['input'] => ({ slots: new Array(n).fill(null), teleporters: new Array(n).fill(0) });
  return {
    id: `t-${type}`, type, coord: { q: 2, r: -1 }, rotation, claims: [],
    input: buf(inputs), output: type === 'powerPlant' ? null : buf(1),
  } as BoardPiece;
}

/** Every spot a teleporter can stand on a building: each input, then the output. */
function spots(type: PieceType, inputs: number): Array<{ buffer: 'input' | 'output'; slot: number }> {
  return [
    ...Array.from({ length: inputs }, (_, slot) => ({ buffer: 'input' as const, slot })),
    ...(type === 'powerPlant' ? [] : [{ buffer: 'output' as const, slot: 0 }]),
  ];
}

describe('where a teleporter stands on a building', () => {
  const tele = { hu: TELEPORTER_HALF_LENGTH * TELEPORTER_SCALE, hv: TELEPORTER_HALF_WIDTH * TELEPORTER_SCALE };
  // The largest footprint of any material piece, as drawn in a buffer (model-aligned, turned with the tile).
  const mats = ['ore', 'plate', 'sphere', 'tesseract'].map(halfSize);
  const mat = { x: Math.max(...mats.map(m => m.x)) * BUFFER_MATERIAL_SCALE, z: Math.max(...mats.map(m => m.z)) * BUFFER_MATERIAL_SCALE };
  const mod = halfSize('control-module');
  const meeple = halfSize('meeple');

  const cases = BUILDINGS.flatMap(b => [0, 1, 2, 3, 4, 5].flatMap(rotation =>
    spots(b.type, b.inputs).map(s => ({ ...b, rotation, ...s }))));
  const label = (c: (typeof cases)[number]): string => `${c.type} r${c.rotation} ${c.buffer} ${c.slot}`;

  it('is checked on every input and the output of every building type, at all six rotations', () => {
    // Plate Factory 2 spots, Sphere Factory 3, Tesseract Factory 4, Power Plant 1; six rotations.
    expect(cases.length).toBe((2 + 3 + 4 + 1) * 6);
  });

  it('lies inside its own tile, at least 0.5 mm in from every edge', () => {
    for (const c of cases) {
      const piece = building(c.type, c.inputs, c.rotation);
      const t = teleporterPlacement(piece, c.buffer, c.slot);
      const centre = axialToWorld(piece.coord);
      for (const q of corners(rect(t, t.yaw, tele.hu, tele.hv))) {
        for (let ve = 0; ve < 6; ve++) {
          const n = edgeNormal(ve);
          expect(APOTHEM - ((q.x - centre.x) * n.x + (q.z - centre.z) * n.z), label(c)).toBeGreaterThan(0.5);
        }
      }
    }
  });

  it('clears the material in every input and the output, the Control Modules (1 to 3, at any camera angle) and the meeple', () => {
    for (const c of cases) {
      const piece = building(c.type, c.inputs, c.rotation);
      const pl = piecePlacement(piece);
      const t = teleporterPlacement(piece, c.buffer, c.slot);
      const T = rect(t, t.yaw, tele.hu, tele.hv);
      for (const buffer of ['input', 'output'] as const) {
        const buf = buffer === 'input' ? piece.input : piece.output;
        for (let i = 0; i < (buf?.slots.length ?? 0); i++) {
          expect(gap(T, rect(bufferSlotWorld(piece, buffer, i), pl.yaw, mat.x, mat.z)), `${label(c)}: ${buffer} slot ${i}`).toBeGreaterThan(0.3);
        }
      }
      // Control Modules and the meeple turn to face the viewer, so try every camera angle.
      for (let deg = 0; deg < 360; deg += 3) {
        const az = (deg * Math.PI) / 180;
        for (let n = 1; n <= 3; n++) {
          const lay = claimLayout(n);
          for (const off of lay.offsets) {
            const w = modelToWorld({ x: pl.x, z: pl.z, yaw: az }, off.x, off.z);
            expect(gap(T, rect(w, az, mod.x * lay.scale, mod.z * lay.scale)), `${label(c)}: ${n} modules at ${deg} deg`).toBeGreaterThan(1);
          }
        }
        expect(gap(T, rect(buildingMeepleWorld(piece), az, meeple.x, meeple.z)), `${label(c)}: meeple at ${deg} deg`).toBeGreaterThan(1);
      }
    }
  });

  it('clears the other teleporters when every input and the output carry one', () => {
    for (const b of BUILDINGS) {
      for (let rotation = 0; rotation < 6; rotation++) {
        const piece = building(b.type, b.inputs, rotation);
        const all = spots(b.type, b.inputs).map(s => ({ s, t: teleporterPlacement(piece, s.buffer, s.slot) }));
        for (let i = 0; i < all.length; i++) {
          for (let j = i + 1; j < all.length; j++) {
            const x = all[i]!, y = all[j]!;
            expect(gap(rect(x.t, x.t.yaw, tele.hu, tele.hv), rect(y.t, y.t.yaw, tele.hu, tele.hv)),
              `${b.type} r${rotation}: ${x.s.buffer} ${x.s.slot} and ${y.s.buffer} ${y.s.slot}`).toBeGreaterThan(1);
          }
        }
      }
    }
  });

  it('points its portal out towards the edge of its own stub, and stands next to that stub (nearer to it than to any other stub)', () => {
    for (const c of cases) {
      const piece = building(c.type, c.inputs, c.rotation);
      const t = teleporterPlacement(piece, c.buffer, c.slot);
      const portal = { x: Math.cos(t.yaw), z: -Math.sin(t.yaw) };
      const positions = positionsWithRole(piece, c.buffer === 'input' ? 'input_buffer' : 'output_buffer');
      const own = positions[c.slot]!;
      // Outwards = from the stub's slot back to its hole on the edge.
      const slot = bufferSlotWorld(piece, c.buffer, c.slot), hole = pointWorld(piece, own, 0);
      const out = { x: hole.x - slot.x, z: hole.z - slot.z };
      const l = Math.hypot(out.x, out.z);
      expect((portal.x * out.x + portal.z * out.z) / l, label(c)).toBeGreaterThan(0.8);
      // Right next to its own material, and nearer to it than to any other stub's material.
      const d = Math.hypot(t.x - slot.x, t.z - slot.z);
      expect(d, label(c)).toBeLessThan(16);
      for (const other of spots(c.type, c.inputs)) {
        if (other.buffer === c.buffer && other.slot === c.slot) continue;
        const o = bufferSlotWorld(piece, other.buffer, other.slot);
        expect(Math.hypot(t.x - o.x, t.z - o.z), `${label(c)} vs ${other.buffer} ${other.slot}`).toBeGreaterThan(d + 1);
      }
    }
  });
});

describe("the Tesseract Factory's meeple (moved to the top right for the teleporter on its third input, #55)", () => {
  it('stands inside its tile and clear of the material in every input and the output, at any rotation and camera angle', () => {
    const mats = ['ore', 'plate', 'sphere', 'tesseract'].map(halfSize);
    const mat = { x: Math.max(...mats.map(m => m.x)) * BUFFER_MATERIAL_SCALE, z: Math.max(...mats.map(m => m.z)) * BUFFER_MATERIAL_SCALE };
    const meeple = halfSize('meeple');
    for (let rotation = 0; rotation < 6; rotation++) {
      const piece = building('tesseractFact', 3, rotation);
      const pl = piecePlacement(piece);
      const centre = axialToWorld(piece.coord);
      for (let deg = 0; deg < 360; deg += 3) {
        const az = (deg * Math.PI) / 180;
        const M = rect(buildingMeepleWorld(piece), az, meeple.x, meeple.z);
        for (const q of corners(M)) {
          for (let ve = 0; ve < 6; ve++) {
            const n = edgeNormal(ve);
            expect(APOTHEM - ((q.x - centre.x) * n.x + (q.z - centre.z) * n.z), `r${rotation} ${deg} deg`).toBeGreaterThan(0.5);
          }
        }
        for (const s of spots('tesseractFact', 3)) {
          expect(gap(M, rect(bufferSlotWorld(piece, s.buffer, s.slot), pl.yaw, mat.x, mat.z)), `r${rotation} ${deg} deg: ${s.buffer} ${s.slot}`).toBeGreaterThan(1);
        }
      }
    }
  });
});
