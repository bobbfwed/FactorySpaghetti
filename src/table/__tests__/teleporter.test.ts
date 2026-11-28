// Teleporters on the table: the model converted from the designer's Teleporter.3mf, its portal, and
// where it stands on a building (layout.ts teleporterPlacement), with the material of its stub
// beside it (teleportedMaterialWorld). No WebGL: footprints are checked as rectangles on the table
// plane.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BoardPiece, PieceType } from '../../engine/state';
import { parseGlb, type GlbPart } from '../glb';
import {
  APOTHEM, BUFFER_MATERIAL_SCALE, PORTAL, TELEPORTER_EDGE_GAP, TELEPORTER_HALF_LENGTH, TELEPORTER_HALF_WIDTH,
  TELEPORTER_HEIGHT, TELEPORTER_SCALE, TELEPORTER_NUDGE, STUB_LINES, TILE_MODEL,
  axialToWorld, bufferSlotWorld, buildingMeepleWorld, claimLayout, edgeNormal, edgePoint, modelToWorld, piecePlacement,
  pointFrame, pointWorld, positionsWithRole, teleporterPlacement, worldToModel, type XZ,
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

  it('has the round recess layout.ts PORTAL describes: on the +X end face, inside the model, with the relief behind it', () => {
    const pos = parts[0]!.positions;
    // The rim of the recess: vertices on the end face x = 7.5 lying on the circle PORTAL gives.
    let onRim = 0, inside = 0;
    for (let i = 0; i < pos.length; i += 3) {
      const x = pos[i]!, y = pos[i + 1]!, z = pos[i + 2]!;
      const r = Math.hypot(y - PORTAL.centreY, z);
      if (Math.abs(x - PORTAL.faceX) < 1e-3 && Math.abs(r - PORTAL.radius) < 0.01) onRim++;
      // Nothing of the model stands in front of the recess: everything within the circle is behind the face.
      if (r < PORTAL.radius - 0.05) { expect(x).toBeLessThanOrEqual(PORTAL.reliefTopX + 1e-3); inside++; }
    }
    expect(onRim).toBeGreaterThanOrEqual(20);
    expect(inside).toBeGreaterThan(30);
    // The disc fits on the end face, inside the model's bounds.
    const b = bbox(parts);
    expect(PORTAL.faceX).toBeCloseTo(b.max[0]!, 3);
    expect(PORTAL.centreY - PORTAL.radius).toBeGreaterThanOrEqual(b.min[1]!);
    expect(PORTAL.centreY + PORTAL.radius).toBeLessThanOrEqual(b.max[1]!);
    expect(PORTAL.radius).toBeLessThan(b.max[2]!);
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

/** How far the rectangle stays in from the nearest edge of the tile centred at `centre` (negative: it pokes out). */
function inTile(r: Rect, centre: XZ): number {
  let best = Infinity;
  for (const q of corners(r)) {
    for (let ve = 0; ve < 6; ve++) {
      const n = edgeNormal(ve);
      best = Math.min(best, APOTHEM - ((q.x - centre.x) * n.x + (q.z - centre.z) * n.z));
    }
  }
  return best;
}

/** Half sizes (x, z) of a model's footprint, from its .glb. */
function halfSize(name: string): { x: number; z: number } {
  const b = bbox(load(name));
  return { x: (b.max[0]! - b.min[0]!) / 2, z: (b.max[2]! - b.min[2]!) / 2 };
}

/**
 * The centre line of a printed stub (the black bar from connection point `pos` towards the module
 * square), measured from the tile model's inlay-black top faces, in model space (rotation 0): the
 * bar is rasterised at 0.05 mm, and the middle of its cross-section is fitted along its length,
 * leaving out the arrow barbs and where it meets another bar (cross-sections wider than the bar).
 */
const stubCache = new Map<string, { at: XZ; dir: XZ; inward: XZ; mid: XZ }>();
function measuredStub(type: PieceType, pos: number): { at: XZ; dir: XZ; inward: XZ; mid: XZ } {
  const key = `${type}:${pos}`;
  const hit = stubCache.get(key);
  if (hit) return hit;
  const p = load(TILE_MODEL[type as Exclude<PieceType, 'mine'>]).find(x => x.material === 'inlay-black')!;
  const RES = 0.05, O = 36, N = Math.round((2 * O) / RES);
  const grid = new Uint8Array(N * N);
  const P = p.positions, I = p.indices!;
  for (let t = 0; t < I.length; t += 3) {
    const v = [0, 1, 2].map(k => [P[I[t + k]! * 3]!, P[I[t + k]! * 3 + 1]!, P[I[t + k]! * 3 + 2]!] as const);
    const [a, b, c] = v as unknown as [readonly number[], readonly number[], readonly number[]];
    const ux = b[0]! - a[0]!, uy = b[1]! - a[1]!, uz = b[2]! - a[2]!, wx = c[0]! - a[0]!, wy = c[1]! - a[1]!, wz = c[2]! - a[2]!;
    const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
    if (Math.abs(ny) / (Math.hypot(nx, ny, nz) || 1) < 0.9) continue; // top faces only
    const x0 = Math.min(a[0]!, b[0]!, c[0]!), x1 = Math.max(a[0]!, b[0]!, c[0]!), z0 = Math.min(a[2]!, b[2]!, c[2]!), z1 = Math.max(a[2]!, b[2]!, c[2]!);
    for (let gx = Math.max(0, Math.floor((x0 + O) / RES)); gx <= Math.min(N - 1, Math.ceil((x1 + O) / RES)); gx++) {
      for (let gz = Math.max(0, Math.floor((z0 + O) / RES)); gz <= Math.min(N - 1, Math.ceil((z1 + O) / RES)); gz++) {
        const x = gx * RES - O, z = gz * RES - O;
        const side = (p1: readonly number[], p2: readonly number[]): number => (x - p2[0]!) * (p1[2]! - p2[2]!) - (p1[0]! - p2[0]!) * (z - p2[2]!);
        const d1 = side(a, b), d2 = side(b, c), d3 = side(c, a);
        if (!((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0))) grid[gz * N + gx] = 1;
      }
    }
  }
  const black = (x: number, z: number): boolean => {
    const gx = Math.round((x + O) / RES), gz = Math.round((z + O) / RES);
    return gx >= 0 && gz >= 0 && gx < N && gz < N && grid[gz * N + gx] === 1;
  };
  const piece = { id: 'm', type, coord: { q: 0, r: 0 }, rotation: 0 };
  const hole = pointWorld(piece, pos, 0);
  const f = pointFrame(type, 0, pos);
  const n = edgeNormal(f.ve);
  const inward = { x: -n.x, z: -n.z };
  const middle = edgePoint({ x: 0, z: 0 }, f.ve, 0.5, 0);
  const ml = Math.hypot(middle.x - hole.x, middle.z - hole.z);
  const mid = { x: (middle.x - hole.x) / ml, z: (middle.z - hole.z) / ml };
  const lat = { x: -inward.z, z: inward.x };
  let th = 0, c0 = 0;
  for (let it = 0; it < 6; it++) {
    const u = { x: Math.cos(th) * inward.x + Math.sin(th) * lat.x, z: Math.cos(th) * inward.z + Math.sin(th) * lat.z };
    const w = { x: -u.z, z: u.x };
    const cs: Array<[number, number]> = [];
    for (let d = 3.5; d <= 18; d += 0.25) {
      const base = { x: hole.x + u.x * d + w.x * c0, z: hole.z + u.z * d + w.z * c0 };
      const at = (l: number): boolean => black(base.x + w.x * l, base.z + w.z * l);
      if (!at(0)) continue;
      let lo = 0, hi = 0;
      while (at(lo - 0.05) && lo > -12) lo -= 0.05;
      while (at(hi + 0.05) && hi < 12) hi += 0.05;
      if (hi - lo > (it < 2 ? 8.2 : 6.9) || hi - lo < 6.2) continue;
      cs.push([d, c0 + (lo + hi) / 2]);
    }
    const k = cs.length;
    const mx = cs.reduce((s, q) => s + q[0], 0) / k, my = cs.reduce((s, q) => s + q[1], 0) / k;
    const slope = cs.reduce((s, q) => s + (q[0] - mx) * (q[1] - my), 0) / cs.reduce((s, q) => s + (q[0] - mx) ** 2, 0);
    th += Math.atan(slope);
    c0 = my - slope * mx;
  }
  const dir = { x: Math.cos(th) * inward.x + Math.sin(th) * lat.x, z: Math.cos(th) * inward.z + Math.sin(th) * lat.z };
  const out = { at: { x: hole.x - dir.z * c0, z: hole.z + dir.x * c0 }, dir, inward, mid };
  stubCache.set(key, out);
  return out;
}

const BUILDINGS: ReadonlyArray<{ type: PieceType; inputs: number }> = [
  { type: 'plateFact', inputs: 1 }, { type: 'sphereFact', inputs: 2 }, { type: 'tesseractFact', inputs: 3 }, { type: 'powerPlant', inputs: 1 },
];

type Spot = { buffer: 'input' | 'output'; slot: number };

/** Every spot a teleporter can stand on a building: each input, then the output. */
function spots(type: PieceType, inputs: number): Spot[] {
  return [
    ...Array.from({ length: inputs }, (_, slot) => ({ buffer: 'input' as const, slot })),
    ...(type === 'powerPlant' ? [] : [{ buffer: 'output' as const, slot: 0 }]),
  ];
}

/**
 * A building with a teleporter on the spots picked by `mask` (bit k = spots()[k]; the default is
 * every input and the output, RULES_CHANGES.md #55).
 */
function building(type: PieceType, inputs: number, rotation: number, mask = -1): BoardPiece {
  const all = spots(type, inputs);
  const tele = (buffer: 'input' | 'output', n: number): Array<number | null> =>
    Array.from({ length: n }, (_, slot) => ((mask >> all.findIndex(s => s.buffer === buffer && s.slot === slot)) & 1 ? 0 : null));
  return {
    id: `t-${type}`, type, coord: { q: 2, r: -1 }, rotation, claims: [],
    input: { slots: new Array(inputs).fill(null), teleporters: tele('input', inputs) },
    output: type === 'powerPlant' ? null : { slots: [null], teleporters: tele('output', 1) },
  } as BoardPiece;
}

/** Every way of putting teleporters on some of a building's spots (none, some, all). */
const masks = (type: PieceType, inputs: number): number[] => Array.from({ length: 1 << spots(type, inputs).length }, (_, m) => m);
const has = (type: PieceType, inputs: number, mask: number, s: Spot): boolean =>
  ((mask >> spots(type, inputs).findIndex(x => x.buffer === s.buffer && x.slot === s.slot)) & 1) === 1;

const tele = { hu: TELEPORTER_HALF_LENGTH * TELEPORTER_SCALE, hv: TELEPORTER_HALF_WIDTH * TELEPORTER_SCALE };
// The largest footprint of any material piece, as drawn in a buffer (model-aligned, turned with the tile).
const mats = ['ore', 'plate', 'sphere', 'tesseract'].map(halfSize);
const mat = { x: Math.max(...mats.map(m => m.x)) * BUFFER_MATERIAL_SCALE, z: Math.max(...mats.map(m => m.z)) * BUFFER_MATERIAL_SCALE };
const mod = halfSize('control-module');
const meeple = halfSize('meeple');
/** Every camera angle (Control Modules and the meeple turn to face the viewer). */
const ANGLES = Array.from({ length: 120 }, (_, i) => (i * 3 * Math.PI) / 180);
/** One to three Control Modules on a building, at every camera angle. */
function moduleRects(piece: BoardPiece): Array<{ r: Rect; label: string }> {
  const pl = piecePlacement(piece);
  const out: Array<{ r: Rect; label: string }> = [];
  for (const az of ANGLES) {
    for (let n = 1; n <= 3; n++) {
      const lay = claimLayout(n);
      for (const off of lay.offsets) {
        const w = modelToWorld({ x: pl.x, z: pl.z, yaw: az }, off.x, off.z);
        out.push({ r: rect(w, az, mod.x * lay.scale, mod.z * lay.scale), label: `${n} modules at ${Math.round((az * 180) / Math.PI)} deg` });
      }
    }
  }
  return out;
}
const meepleRects = (piece: BoardPiece): Array<{ r: Rect; label: string }> =>
  ANGLES.map(az => ({ r: rect(buildingMeepleWorld(piece), az, meeple.x, meeple.z), label: `meeple at ${Math.round((az * 180) / Math.PI)} deg` }));

describe('where a teleporter stands on a building', () => {
  const cases = BUILDINGS.flatMap(b => [0, 1, 2, 3, 4, 5].flatMap(rotation =>
    spots(b.type, b.inputs).map(s => ({ ...b, rotation, ...s }))));
  const label = (c: (typeof cases)[number]): string => `${c.type} r${c.rotation} ${c.buffer} ${c.slot}`;

  it('is checked on every input and the output of every building type, at all six rotations', () => {
    // Plate Factory 2 spots, Sphere Factory 3, Tesseract Factory 4, Power Plant 1; six rotations.
    expect(cases.length).toBe((2 + 3 + 4 + 1) * 6);
  });

  it('lies along its stub\'s printed black line (measured from the tile model), centred on it near the tile edge, its portal towards the building', () => {
    for (const c of cases) {
      const piece = building(c.type, c.inputs, c.rotation);
      const pl = piecePlacement(piece);
      const t = teleporterPlacement(piece, c.buffer, c.slot);
      const own = positionsWithRole(piece, c.buffer === 'input' ? 'input_buffer' : 'output_buffer')[c.slot]!;
      // The printed line, measured from the black inlay of the tile model (model space, rotation 0).
      const line = measuredStub(c.type, own);
      // The teleporter in model space: its axis and centre.
      const m = worldToModel(pl, t.x, t.z);
      const yaw = t.yaw - pl.yaw;
      const axis = { x: Math.cos(yaw), z: -Math.sin(yaw) };
      const angle = (Math.acos(Math.min(1, axis.x * line.dir.x + axis.z * line.dir.z)) * 180) / Math.PI;
      expect(angle, `${label(c)}: axis vs printed line`).toBeLessThan(1);
      // Centred on the line, except where TELEPORTER_NUDGE moves it across (at most 0.5 mm, well inside the 6.6 mm bar).
      const nudge = (c.buffer === 'input' ? TELEPORTER_NUDGE[c.type]?.[c.slot] : undefined) ?? { along: 0, side: 0 };
      expect(Math.abs(nudge.side)).toBeLessThanOrEqual(0.5);
      const off = (m.x - line.at.x) * -line.dir.z + (m.z - line.at.z) * line.dir.x;
      expect(Math.abs(Math.abs(off) - nudge.side), `${label(c)}: off the line by ${off.toFixed(2)} mm`).toBeLessThan(0.25);
      // Near the tile edge, not against it: about 6-8 mm in (the stand-in ring was 6.5 mm in).
      const hole = pointWorld({ ...piece, coord: { q: 0, r: 0 }, rotation: 0 }, own, 0);
      const inward = line.inward;
      const inset = (m.x - hole.x) * inward.x + (m.z - hole.z) * inward.z;
      const slide = nudge.along;
      expect(inset, label(c)).toBeGreaterThan(5.5);
      expect(inset, label(c)).toBeLessThan(8.5 + slide);
      // Its nearest back corner TELEPORTER_EDGE_GAP in from the edge (further where it slides in).
      const corner = Math.min(...corners(rect(m, yaw, tele.hu, tele.hv)).map(q => (q.x - hole.x) * inward.x + (q.z - hole.z) * inward.z));
      if (slide === 0) expect(corner, label(c)).toBeCloseTo(TELEPORTER_EDGE_GAP, 3);
      else expect(corner, label(c)).toBeGreaterThan(TELEPORTER_EDGE_GAP);
      expect(TELEPORTER_EDGE_GAP).toBeGreaterThanOrEqual(1);
      // The portal (model +X) points in along the line, towards the building.
      expect(axis.x * inward.x + axis.z * inward.z, label(c)).toBeGreaterThan(0.9);
      expect(Math.hypot(t.x + Math.cos(t.yaw) - pl.x, t.z - Math.sin(t.yaw) - pl.z), `${label(c)}: portal faces the building`).toBeLessThan(Math.hypot(t.x - pl.x, t.z - pl.z));
    }
  });

  it('STUB_LINES (the slanted stubs) matches the lines measured from the tile models within a degree, and every other stub is square to its edge', () => {
    for (const b of BUILDINGS) {
      const piece = building(b.type, b.inputs, 0);
      for (const s of spots(b.type, b.inputs)) {
        const own = positionsWithRole(piece, s.buffer === 'input' ? 'input_buffer' : 'output_buffer')[s.slot]!;
        const line = measuredStub(b.type, own);
        const listed = (s.buffer === 'input' ? STUB_LINES[b.type]?.[s.slot] : undefined)?.angle ?? 0;
        const slant = (Math.atan2(line.dir.x * line.mid.x + line.dir.z * line.mid.z, line.dir.x * line.inward.x + line.dir.z * line.inward.z) * 180) / Math.PI;
        expect(Math.abs(slant - listed), `${b.type} ${s.buffer} ${s.slot}: measured ${slant.toFixed(2)} deg`).toBeLessThan(1);
      }
    }
  });

  it('lies inside its own tile, at least 0.5 mm in from every edge', () => {
    for (const c of cases) {
      const piece = building(c.type, c.inputs, c.rotation);
      const t = teleporterPlacement(piece, c.buffer, c.slot);
      expect(inTile(rect(t, t.yaw, tele.hu, tele.hv), axialToWorld(piece.coord)), label(c)).toBeGreaterThan(0.5);
    }
  });

  it('clears the material in every input and the output (with or without teleporters on the others), the Control Modules (1 to 3, at any camera angle) and the meeple', () => {
    for (const c of cases) {
      const mods = moduleRects(building(c.type, c.inputs, c.rotation));
      for (const mask of masks(c.type, c.inputs)) {
        if (!has(c.type, c.inputs, mask, c)) continue;
        const piece = building(c.type, c.inputs, c.rotation, mask);
        const pl = piecePlacement(piece);
        const t = teleporterPlacement(piece, c.buffer, c.slot);
        const T = rect(t, t.yaw, tele.hu, tele.hv);
        for (const s of spots(c.type, c.inputs)) {
          expect(gap(T, rect(bufferSlotWorld(piece, s.buffer, s.slot), pl.yaw, mat.x, mat.z)), `${label(c)} (mask ${mask}): ${s.buffer} ${s.slot} material`).toBeGreaterThan(0.3);
        }
        if (mask !== masks(c.type, c.inputs).length - 1) continue;
        for (const m of mods) expect(gap(T, m.r), `${label(c)}: ${m.label}`).toBeGreaterThan(1);
        for (const m of meepleRects(piece)) expect(gap(T, m.r), `${label(c)}: ${m.label}`).toBeGreaterThan(1);
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
});

describe('the material of a stub that carries a teleporter (it lies beside the teleporter)', () => {
  it('moves only on a stub with a teleporter, and stays next to its own teleporter (nearer to it than to any other)', () => {
    for (const b of BUILDINGS) {
      for (let rotation = 0; rotation < 6; rotation++) {
        const none = building(b.type, b.inputs, rotation, 0);
        const all = building(b.type, b.inputs, rotation);
        for (const s of spots(b.type, b.inputs)) {
          const plain = bufferSlotWorld(none, s.buffer, s.slot);
          const moved = bufferSlotWorld(all, s.buffer, s.slot);
          const own = teleporterPlacement(all, s.buffer, s.slot);
          const d = Math.hypot(moved.x - own.x, moved.z - own.z);
          expect(d, `${b.type} r${rotation} ${s.buffer} ${s.slot}`).toBeLessThan(17);
          expect(Math.hypot(moved.x - plain.x, moved.z - plain.z)).toBeGreaterThan(5);
          for (const o of spots(b.type, b.inputs)) {
            if (o.buffer === s.buffer && o.slot === s.slot) continue;
            const t = teleporterPlacement(all, o.buffer, o.slot);
            expect(Math.hypot(moved.x - t.x, moved.z - t.z), `${b.type} r${rotation} ${s.buffer} ${s.slot} vs ${o.buffer} ${o.slot}`).toBeGreaterThan(d + 1);
          }
          // Extra slots beyond the stub (an output holding more) stay where they always were.
          expect(bufferSlotWorld(all, s.buffer, s.slot + 9)).toEqual(bufferSlotWorld(none, s.buffer, s.slot + 9));
        }
      }
    }
  });

  it('stays on its tile (no further out than material on a plain stub) and clears the other material, the Control Modules (1 to 3, at any camera angle) and the meeple', () => {
    for (const b of BUILDINGS) {
      for (let rotation = 0; rotation < 6; rotation++) {
        const mods = moduleRects(building(b.type, b.inputs, rotation));
        const plainIn = Math.min(...spots(b.type, b.inputs).map(s => {
          const p = building(b.type, b.inputs, rotation, 0);
          return inTile(rect(bufferSlotWorld(p, s.buffer, s.slot), piecePlacement(p).yaw, mat.x, mat.z), axialToWorld(p.coord));
        }));
        for (const mask of masks(b.type, b.inputs)) {
          const piece = building(b.type, b.inputs, rotation, mask);
          const pl = piecePlacement(piece);
          const meeples = meepleRects(piece);
          const all = spots(b.type, b.inputs).map(s => ({ s, moved: has(b.type, b.inputs, mask, s), r: rect(bufferSlotWorld(piece, s.buffer, s.slot), pl.yaw, mat.x, mat.z) }));
          for (const [i, m] of all.entries()) {
            if (!m.moved) continue;
            const where = `${b.type} r${rotation} mask ${mask}: ${m.s.buffer} ${m.s.slot}`;
            expect(inTile(m.r, axialToWorld(piece.coord)), where).toBeGreaterThanOrEqual(Math.min(plainIn, 0) - 1e-6);
            for (const [j, o] of all.entries()) if (j !== i) expect(gap(m.r, o.r), `${where} vs ${o.s.buffer} ${o.s.slot}`).toBeGreaterThan(0.3);
            // Where a moved material lies does not depend on the other teleporters: check once.
            if (mask !== masks(b.type, b.inputs).length - 1) continue;
            for (const x of mods) expect(gap(m.r, x.r), `${where}: ${x.label}`).toBeGreaterThan(1);
            for (const x of meeples) expect(gap(m.r, x.r), `${where}: ${x.label}`).toBeGreaterThan(1);
          }
        }
      }
    }
  });
});

describe("the Tesseract Factory's meeple (at the top right: below the module square lies the material of its third input when a teleporter stands on that stub, #55)", () => {
  it('stands inside its tile and clear of the material in every input and the output, with or without teleporters, at any rotation and camera angle', () => {
    for (let rotation = 0; rotation < 6; rotation++) {
      for (const mask of masks('tesseractFact', 3)) {
        const piece = building('tesseractFact', 3, rotation, mask);
        const pl = piecePlacement(piece);
        for (const M of meepleRects(piece)) {
          expect(inTile(M.r, axialToWorld(piece.coord)), `r${rotation} ${M.label}`).toBeGreaterThan(0.5);
          for (const s of spots('tesseractFact', 3)) {
            expect(gap(M.r, rect(bufferSlotWorld(piece, s.buffer, s.slot), pl.yaw, mat.x, mat.z)), `r${rotation} mask ${mask} ${M.label}: ${s.buffer} ${s.slot}`).toBeGreaterThan(1);
          }
        }
      }
    }
  });
});
