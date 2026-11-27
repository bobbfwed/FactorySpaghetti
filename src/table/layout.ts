// Pure table geometry: where every engine thing sits on the 3D table, in millimetres.
// No Three.js here, so the maths can be tested without WebGL.
//
// World frame (matches the models in public/models): Y up, the board lies in the XZ plane.
// Seen from above with -Z at the top of the screen, +X is right and +Z is down, exactly like the
// old 2D client's pixel frame (x right, y down). So "clockwise" below means clockwise as seen from
// above, and a pointy-top hex has flat sides facing +X and -X.
//
// Engine conventions reproduced here (see src/engine/rules/flow.ts adjAt and the old 2D renderer):
//   - Vertex edge ve (0-5) runs from corner ve to corner ve+1, corners at angle 60*ve - 30 degrees;
//     its outward normal points at angle 60*ve: 0 = E, 1 = SE, 2 = SW, 3 = W, 4 = NW, 5 = NE.
//   - Single-hex piece, template edge e (positions 2e, 2e+1): ve = (e + rotation + 3) % 6.
//   - Mine hex 0 (positions 0-11): ve = HEX_DIR_TO_VERTEX_EDGE[(e + rotation) % 6].
//   - Mine hex 1 (positions 12-23): ve = (HEX_DIR_TO_VERTEX_EDGE[rotation ^ 1] + LEAN_EDGE_TO_OFFSET[e]) % 6.
//   - Within an edge, w = 0 is the first point going clockwise, w = 1 the second.

import type { BoardPiece, GameState, HexCoord, PieceType } from '../engine/state';
import type { PointRole } from '../engine/config';
import { PIECE_TEMPLATES, STACK_COMPOSITION, STARTING_PIECES_PER_PLAYER, pieceTemplate, type PieceTemplate } from '../engine/config';

/**
 * The layout of a piece: a piece type uses its type's layout (a mine type: Mine 1's); a piece
 * (type and id) uses its own, so Mines 2 and 3 have no ore exits on their lean half.
 */
export type PieceRef = PieceType | { readonly type: PieceType; readonly id: string };
const templateOf = (p: PieceRef): PieceTemplate => (typeof p === 'string' ? PIECE_TEMPLATES[p] : pieceTemplate(p));
import { mineSecondaryCoord } from '../engine/rules/pieces';

export interface XZ { readonly x: number; readonly z: number }

// ── Measured model dimensions (public/models, see docs/models/README.md) ───────────────────────

/** Tile width across the flat sides, from the model bounding boxes. */
export const ACROSS_FLATS = 68.849;
export const APOTHEM = ACROSS_FLATS / 2;
/** Corner radius of the ideal hexagon (the printed corners are rounded slightly inside it). */
export const HEX_RADIUS = ACROSS_FLATS / Math.sqrt(3);
/** Tiles touch edge to edge on the real table, so the centre spacing is exactly the width. */
export const HEX_PITCH = ACROSS_FLATS;
/** Top face of a board tile or mine. */
export const TILE_TOP = 3;
/** The camera's usual height angle above the table (the "isometric" view). */
export const VIEW_ELEVATION = Math.PI / 4;

/**
 * Where the two connection points of an edge sit along it, as a fraction from the edge's first
 * corner (clockwise order). Measured from the 12 belt holes of tile-blank.glb (hole centres at
 * 0.270 and 0.730) and the ends of the factory stubs and mine rays/tracks (same fractions).
 */
export const POINT_T: readonly [number, number] = [0.27, 0.73];
/** Distance of a hole centre in from the tile edge (holes span 2.17-7.13 mm in from the edge). */
export const POINT_INSET = 4.65;
/** Distance from the edge at which the black stubs and tracks stop (measured: 2.17 mm). */
export const STUB_END_INSET = 2.17;
/**
 * Material pieces in a buffer sit on the stub end, this far in from the edge. Kept close to the
 * edge because the Tesseract Factory's inputs at positions 0 and 11 converge further in.
 */
export const BUFFER_INSET = 6.5;
/** Material pieces are drawn a little smaller than printed so three fit on one factory. */
export const BUFFER_MATERIAL_SCALE = 0.8;

// ── Hex basics ──────────────────────────────────────────────────────────────────────────────────

const SQRT3 = Math.sqrt(3);

/** Axial (q, r) to world (x, z), pointy-top, same layout as src/table/hex.ts hexToPixel. */
export function axialToWorld(c: HexCoord): XZ {
  return { x: HEX_PITCH * (c.q + c.r / 2), z: HEX_PITCH * (SQRT3 / 2) * c.r };
}

/** Nearest axial cell to a world point. */
export function worldToAxial(x: number, z: number): HexCoord {
  const r = z / (HEX_PITCH * SQRT3 / 2);
  const q = x / HEX_PITCH - r / 2;
  const s = -q - r;
  let rq = Math.round(q), rr = Math.round(r);
  const rs = Math.round(s);
  const dq = Math.abs(rq - q), dr = Math.abs(rr - r), ds = Math.abs(rs - s);
  if (dq > dr && dq > ds) rq = -rr - rs;
  else if (dr > ds) rr = -rq - rs;
  return { q: rq + 0, r: rr + 0 }; // + 0 turns -0 into 0
}

/** Corner i (0-5) of the hex centred at c, at angle 60*i - 30 degrees. */
export function hexCorner(c: XZ, i: number, radius = HEX_RADIUS): XZ {
  const a = (Math.PI / 3) * (((i % 6) + 6) % 6) - Math.PI / 6;
  return { x: c.x + radius * Math.cos(a), z: c.z + radius * Math.sin(a) };
}

/** Outward unit normal of vertex edge ve. */
export function edgeNormal(ve: number): XZ {
  const a = (Math.PI / 3) * (((ve % 6) + 6) % 6);
  return { x: Math.cos(a), z: Math.sin(a) };
}

// ── Engine direction tables (copied from src/engine/rules/flow.ts; the engine does not export them) ─

/** HEX_DIRECTIONS index (pieces.ts) to vertex edge. */
export const HEX_DIR_TO_VERTEX_EDGE: readonly number[] = [0, 3, 1, 4, 5, 2];
/** Mine lean hex: template edge to vertex-edge offset from the internal edge. */
export const LEAN_EDGE_TO_OFFSET: readonly number[] = [2, 5, 3, 0, 4, 1];

/** Where a connection point is, in engine terms: which hex of the piece, which vertex edge, which half. */
export interface PointFrame { readonly hex: 0 | 1; readonly ve: number; readonly w: 0 | 1 }

export function pointFrame(type: PieceType, rotation: number, pos: number): PointFrame {
  const rot = ((rotation % 6) + 6) % 6;
  if (type === 'mine' && pos >= 12) {
    const p = pos - 12;
    const e = Math.floor(p / 2);
    const iv = HEX_DIR_TO_VERTEX_EDGE[(rot ^ 1) % 6]!;
    return { hex: 1, ve: (iv + LEAN_EDGE_TO_OFFSET[e]!) % 6, w: (p % 2) as 0 | 1 };
  }
  const e = Math.floor(pos / 2);
  const w = (pos % 2) as 0 | 1;
  if (type === 'mine') return { hex: 0, ve: HEX_DIR_TO_VERTEX_EDGE[(e + rot) % 6]!, w };
  return { hex: 0, ve: (e + rot + 3) % 6, w };
}

/** World centre of hex 0 or hex 1 (mine second hex) of a piece. */
export function hexCentreOf(piece: Pick<BoardPiece, 'type' | 'coord' | 'rotation'>, hex: 0 | 1): XZ {
  if (hex === 1) return axialToWorld(mineSecondaryCoord(piece.coord, piece.rotation ?? 0));
  return axialToWorld(piece.coord);
}

/** The point on a hex edge at fraction t, moved `inset` mm towards the hex centre. */
export function edgePoint(centre: XZ, ve: number, t: number, inset: number): XZ {
  const a = hexCorner(centre, ve);
  const b = hexCorner(centre, ve + 1);
  const n = edgeNormal(ve);
  return { x: a.x + (b.x - a.x) * t - n.x * inset, z: a.z + (b.z - a.z) * t - n.z * inset };
}

/** Number of connection positions on a piece (12, or 24 for a mine). */
export function pointCount(piece: PieceRef): number {
  return templateOf(piece).hexCount * 12;
}

/** World position of connection point `pos` (the centre of its hole), `inset` mm in from the edge. */
export function pointWorld(
  piece: Pick<BoardPiece, 'type' | 'coord' | 'rotation'>,
  pos: number,
  inset = POINT_INSET,
): XZ {
  const f = pointFrame(piece.type, piece.rotation ?? 0, pos);
  return edgePoint(hexCentreOf(piece, f.hex), f.ve, POINT_T[f.w], inset);
}

/** The two corners of the edge a connection point lies on (for tests and debug drawing). */
export function pointEdge(piece: Pick<BoardPiece, 'type' | 'coord' | 'rotation'>, pos: number): [XZ, XZ] {
  const f = pointFrame(piece.type, piece.rotation ?? 0, pos);
  const c = hexCentreOf(piece, f.hex);
  return [hexCorner(c, f.ve), hexCorner(c, f.ve + 1)];
}

export function pointRole(piece: PieceRef, pos: number): PointRole {
  const def = templateOf(piece).points.find(p => p.position === pos);
  return def && def.enabled ? def.role : 'disabled';
}

// ── Models and their placement ──────────────────────────────────────────────────────────────────

export type ModelName =
  | 'tile-blank' | 'tile-plate-factory' | 'tile-sphere-factory' | 'tile-tesseract-factory'
  | 'tile-power-plant' | 'mine-1' | 'mine-2' | 'mine-3';

export const TILE_MODEL: Readonly<Record<Exclude<PieceType, 'mine'>, ModelName>> = {
  blank: 'tile-blank',
  plateFact: 'tile-plate-factory',
  sphereFact: 'tile-sphere-factory',
  tesseractFact: 'tile-tesseract-factory',
  powerPlant: 'tile-power-plant',
};

/** Which mine model draws a mine piece: ids are 'mine-1', 'mine-2', 'mine-3' (setup.ts). */
export function mineModel(pieceId: string): ModelName {
  return pieceId === 'mine-2' || pieceId === 'mine-3' ? pieceId : 'mine-1';
}

export function modelFor(piece: Pick<BoardPiece, 'type' | 'id'>): ModelName {
  return piece.type === 'mine' ? mineModel(piece.id) : TILE_MODEL[piece.type];
}

/**
 * Model orientation table: extra 60-degree clockwise steps needed so that a model drawn at engine
 * rotation 0 shows its features at the engine's rotation-0 positions. Measured, not guessed
 * (src/table/__tests__/models.test.ts reads the .glb files and checks it):
 *   - Plate Factory stubs meet the left edge at 0.27 (position 0) and the right edge at 0.73
 *     (position 7); Sphere adds the upper-left edge at 0.27 (2); Tesseract adds the lower-left
 *     edge at 0.73 (11); Power Plant has one stub at position 0. All match with 0 steps.
 *   - Mines: the rayed hex is at model x = -34.4 and the second hex at +34.4, so model +X points
 *     from hex 0 to hex 1. Mine 1's three track ends on the second hex sit at the engine's ore
 *     positions 15, 17 and 23 with no extra turn.
 */
export const MODEL_ROTATION_OFFSET: Readonly<Record<ModelName, number>> = {
  'tile-blank': 0,
  'tile-plate-factory': 0,
  'tile-sphere-factory': 0,
  'tile-tesseract-factory': 0,
  'tile-power-plant': 0,
  'mine-1': 0,
  'mine-2': 0,
  'mine-3': 0,
};

/** Mine model: centres of its two hexes in model space (manifest notes). */
export const MINE_HEX_MODEL_X: readonly [number, number] = [-APOTHEM, APOTHEM];

/**
 * Where to put a model: translate to (x, z) and turn by `yaw` radians about +Y, using Three.js's
 * convention (rotation.y = yaw maps model (x, z) to (x cos + z sin, -x sin + z cos)).
 */
export interface Placement { readonly x: number; readonly z: number; readonly yaw: number }

export function piecePlacement(piece: Pick<BoardPiece, 'type' | 'id' | 'coord' | 'rotation'>): Placement {
  const rot = (((piece.rotation ?? 0) % 6) + 6) % 6;
  const offset = MODEL_ROTATION_OFFSET[modelFor(piece)];
  if (piece.type === 'mine') {
    const a = axialToWorld(piece.coord);
    const b = axialToWorld(mineSecondaryCoord(piece.coord, rot));
    // Model +X must point from hex 0 to hex 1, which lies at angle HEX_DIR_TO_VERTEX_EDGE[rot] * 60.
    const steps = HEX_DIR_TO_VERTEX_EDGE[rot]! + offset;
    return { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2, yaw: -steps * Math.PI / 3 };
  }
  const c = axialToWorld(piece.coord);
  return { x: c.x, z: c.z, yaw: -(rot + offset) * Math.PI / 3 };
}

/** Placement of a ghost (a piece about to be placed) at a cell with a rotation. */
export function ghostPlacement(type: PieceType, q: number, r: number, rotation: number, mineId = 'mine-2'): Placement {
  return piecePlacement({ type, id: type === 'mine' ? mineId : 'ghost', coord: { q, r }, rotation });
}

/** Model-space point to world, with a placement. */
export function modelToWorld(p: Placement, mx: number, mz: number): XZ {
  const c = Math.cos(p.yaw), s = Math.sin(p.yaw);
  return { x: p.x + mx * c + mz * s, z: p.z - mx * s + mz * c };
}

/** World point to model space, with a placement. */
export function worldToModel(p: Placement, wx: number, wz: number): XZ {
  const dx = wx - p.x, dz = wz - p.z;
  const c = Math.cos(p.yaw), s = Math.sin(p.yaw);
  return { x: dx * c - dz * s, z: dx * s + dz * c };
}

/** All hex cells a piece covers. */
export function pieceCells(piece: Pick<BoardPiece, 'type' | 'coord' | 'rotation'>): HexCoord[] {
  return piece.type === 'mine'
    ? [piece.coord, mineSecondaryCoord(piece.coord, piece.rotation ?? 0)]
    : [piece.coord];
}

// ── Things that sit on pieces ───────────────────────────────────────────────────────────────────

/** Engine positions of a role, sorted ascending (this is the engine's slot order, see flow.ts). */
export function positionsWithRole(piece: PieceRef, role: PointRole): number[] {
  return templateOf(piece).points
    .filter(p => p.enabled && p.role === role)
    .map(p => p.position)
    .sort((a, b) => a - b);
}

/**
 * Where material in buffer slot `slot` sits. Input slot i belongs to the i-th input position
 * (engine order); the output slot sits on the output stub. Extra slots beyond the stubs line up
 * further in along the last stub. Mines (output buffer only, no stub) use the rayed hex's disc.
 */
export function bufferSlotWorld(
  piece: Pick<BoardPiece, 'type' | 'id' | 'coord' | 'rotation'>,
  buffer: 'input' | 'output',
  slot: number,
): XZ {
  if (piece.type === 'mine') {
    const pl = piecePlacement(piece);
    return modelToWorld(pl, MINE_HEX_MODEL_X[0] + slot * 12, 0);
  }
  const positions = positionsWithRole(piece, buffer === 'input' ? 'input_buffer' : 'output_buffer');
  if (positions.length === 0) return axialToWorld(piece.coord);
  const i = Math.min(slot, positions.length - 1);
  const extra = slot - i;
  return pointWorld(piece, positions[i]!, BUFFER_INSET + extra * 13);
}

/** Anchor of a whole buffer (for popovers and picking): centre of its slots. */
export function bufferAnchorWorld(
  piece: Pick<BoardPiece, 'type' | 'id' | 'coord' | 'rotation' | 'input' | 'output'>,
  buffer: 'input' | 'output',
): XZ {
  const buf = buffer === 'input' ? piece.input : piece.output;
  const n = Math.max(1, buf?.slots.length ?? 1);
  let x = 0, z = 0;
  for (let i = 0; i < n; i++) {
    const p = bufferSlotWorld(piece, buffer, i);
    x += p.x; z += p.z;
  }
  return { x: x / n, z: z / n };
}

/**
 * Teleporter model (public/models/teleporter.glb, from the designer's Teleporter.3mf): a little
 * arched block 15 mm long (model X) x 10.4 mm wide x 11.9 mm tall, with the round portal on its +X
 * end. It is drawn at this scale so it fits beside a buffer's material clear of the Control
 * Modules and the meeple (about 11.3 x 7.8 x 8.9 mm on the table).
 */
export const TELEPORTER_SCALE = 0.75;
/** Measured from teleporter.glb (unscaled): half its length (model X), half its width (Z), height. */
export const TELEPORTER_HALF_LENGTH = 7.5;
export const TELEPORTER_HALF_WIDTH = 5.2;
export const TELEPORTER_HEIGHT = 11.88;
/** A teleporter beside a one-stub buffer: this far to the side of the slot, and this far further in. */
export const TELEPORTER_SIDE = 10.2;
export const TELEPORTER_ALONG = 7;

const unit = (x: number, z: number): XZ => { const l = Math.hypot(x, z) || 1; return { x: x / l, z: z / l }; };

/**
 * Where a teleporter on a buffer stands, lying parallel to the stub with its portal facing out
 * towards the tile edge (the Control Modules turn to face the viewer, so the module square is
 * crowded at some angles and there is no room on the stub itself between material and modules):
 * - a buffer with one stub (every output, and the Plate Factory's and Power Plant's input): beside
 *   the material, on the side of the stub with no printed icon;
 * - a buffer with several stubs (the Sphere and Tesseract Factories' inputs): between the material
 *   of its first two stubs, over the printed input icons.
 * Either way it clears the material in the buffer, the Control Modules (one to three) and the
 * meeple (checked by layout.test.ts). Mines have no stubs and are never claimed, so they never
 * carry a teleporter; the buffer's anchor is used. Yaw is in Three.js's convention.
 */
export function teleporterPlacement(
  piece: Pick<BoardPiece, 'type' | 'id' | 'coord' | 'rotation' | 'input' | 'output'>,
  buffer: 'input' | 'output',
): Placement {
  const positions = piece.type === 'mine' ? [] : positionsWithRole(piece, buffer === 'input' ? 'input_buffer' : 'output_buffer');
  let at: XZ, edge: XZ;
  if (positions.length === 0) {
    const a = bufferAnchorWorld(piece, buffer);
    return { x: a.x, z: a.z, yaw: piecePlacement(piece).yaw };
  } else if (positions.length === 1) {
    // Beside the stub, on the side away from the middle of its edge (towards the nearer corner):
    // the printed icons are on the other side, and no belt uses a factory's other holes.
    const f = pointFrame(piece.type, piece.rotation ?? 0, positions[0]!);
    const c = hexCentreOf(piece, f.hex);
    edge = pointWorld(piece, positions[0]!, 0);
    const mid = edgePoint(c, f.ve, 0.5, 0);
    const n = unit(edge.x - mid.x, edge.z - mid.z);
    const slot = pointWorld(piece, positions[0]!, BUFFER_INSET);
    const t = unit(slot.x - edge.x, slot.z - edge.z);
    at = { x: slot.x + n.x * TELEPORTER_SIDE + t.x * TELEPORTER_ALONG, z: slot.z + n.z * TELEPORTER_SIDE + t.z * TELEPORTER_ALONG };
    edge = { x: at.x - t.x, z: at.z - t.z };
  } else {
    const a = pointWorld(piece, positions[0]!, BUFFER_INSET), b = pointWorld(piece, positions[1]!, BUFFER_INSET);
    const ea = pointWorld(piece, positions[0]!, 0), eb = pointWorld(piece, positions[1]!, 0);
    at = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
    edge = { x: (ea.x + eb.x) / 2, z: (ea.z + eb.z) / 2 };
  }
  // Model +X (the portal) maps to (cos yaw, -sin yaw): point it from the teleporter to the edge.
  return { x: at.x, z: at.z, yaw: Math.atan2(at.z - edge.z, edge.x - at.x) };
}

/**
 * Meeple-slot icons on the mines' second hex, in model space (centres of the icon bounding boxes,
 * measured from the .glb files): slot 0 = the green material "+" (resource), slot 1 = the blue
 * stacked-squares "+" (upgrade). Checked by models.test.ts.
 */
export const MINE_SLOT_MODEL: Readonly<Record<'mine-1' | 'mine-2' | 'mine-3', readonly [XZ, XZ]>> = {
  'mine-1': [{ x: 12.7, z: -1.5 }, { x: 44.0, z: -1.5 }],
  'mine-2': [{ x: 13.05, z: -0.2 }, { x: 46.05, z: 0 }],
  'mine-3': [{ x: 12.95, z: 0.1 }, { x: 44.0, z: -1.45 }],
};

export function mineSlotWorld(piece: Pick<BoardPiece, 'type' | 'id' | 'coord' | 'rotation'>, slot: number): XZ {
  const m = mineModel(piece.id) as 'mine-1' | 'mine-2' | 'mine-3';
  const s = MINE_SLOT_MODEL[m][slot === 1 ? 1 : 0];
  return modelToWorld(piecePlacement(piece), s.x, s.z);
}

/**
 * The black square outline in the middle of a factory (where Control Modules sit), model space:
 * x -15..15, z -13..13 on all three factories; the Power Plant's panel block is the same size.
 */
export const MODULE_SQUARE = { halfX: 15, halfZ: 13 } as const;

/** Where a building's meeple stands, model space: below the module square, clear of the stubs. */
export const BUILDING_MEEPLE_MODEL: XZ = { x: 0, z: 21 };

export function buildingMeepleWorld(piece: Pick<BoardPiece, 'type' | 'id' | 'coord' | 'rotation'>): XZ {
  return modelToWorld(piecePlacement(piece), BUILDING_MEEPLE_MODEL.x, BUILDING_MEEPLE_MODEL.z);
}

/** Control Module tile is 16 mm square; several claims shrink so they stay inside the square. */
export const MODULE_SIZE = 16;

/**
 * Offsets (in a frame turned to face the viewer) and scale for n claims on one building.
 * 1: full size in the middle. 2: side by side. 3: two over one. Always inside the 30 x 26 square.
 */
export function claimLayout(n: number): { readonly scale: number; readonly offsets: readonly XZ[] } {
  if (n <= 1) return { scale: 1, offsets: [{ x: 0, z: 0 }] };
  if (n === 2) return { scale: 0.82, offsets: [{ x: -7, z: 0 }, { x: 7, z: 0 }] };
  return { scale: 0.68, offsets: [{ x: -6, z: -5.8 }, { x: 6, z: -5.8 }, { x: 0, z: 5.8 }] };
}

// ── Belts ───────────────────────────────────────────────────────────────────────────────────────

export interface BeltCurve { readonly p0: XZ; readonly c0: XZ; readonly c1: XZ; readonly p1: XZ }

/**
 * Smooth curve for a belt between two connection points of one tile: leaves each hole heading
 * inwards. `inset` starts and ends the curve that far in from the hole centres, along the inward
 * normal (the straight, rigid end of a belt that holds its peg covers the first few millimetres).
 */
export function beltCurve(piece: Pick<BoardPiece, 'type' | 'coord' | 'rotation'>, from: number, to: number, inset = 0): BeltCurve {
  const n0 = edgeNormal(pointFrame(piece.type, piece.rotation ?? 0, from).ve);
  const n1 = edgeNormal(pointFrame(piece.type, piece.rotation ?? 0, to).ve);
  const h0 = pointWorld(piece, from);
  const h1 = pointWorld(piece, to);
  const p0 = { x: h0.x - n0.x * inset, z: h0.z - n0.z * inset };
  const p1 = { x: h1.x - n1.x * inset, z: h1.z - n1.z * inset };
  const d = Math.hypot(p1.x - p0.x, p1.z - p0.z);
  const k = d * 0.42;
  return {
    p0,
    c0: { x: p0.x - n0.x * k, z: p0.z - n0.z * k },
    c1: { x: p1.x - n1.x * k, z: p1.z - n1.z * k },
    p1,
  };
}

/**
 * How far a belt's ends reach past the tile edge onto the neighbouring piece (mm). The print's belt
 * reaches ~0.5 mm past the edge when its pegs sit in the holes; drawn a little longer so two belts
 * meeting at a shared edge visibly overlap and read as one chain.
 */
export const BELT_SPILL = 1.6;
/** The part of a belt end past the tile edge dips this far (mm) so it tucks under a belt it meets. */
export const BELT_TUCK = 0.3;
/** Thickness of the belt chain lying on a tile (measured from belt.glb; its pegs go down into the holes). */
export const BELT_THICKNESS = 1.5;

/** Outward edge normal at a connection point (the direction a belt end points). */
export function pointNormal(piece: Pick<BoardPiece, 'type' | 'coord' | 'rotation'>, pos: number): XZ {
  return edgeNormal(pointFrame(piece.type, piece.rotation ?? 0, pos).ve);
}

export function bezierAt(c: BeltCurve, t: number): XZ {
  const u = 1 - t;
  const a = u * u * u, b = 3 * u * u * t, d = 3 * u * t * t, e = t * t * t;
  return {
    x: a * c.p0.x + b * c.c0.x + d * c.c1.x + e * c.p1.x,
    z: a * c.p0.z + b * c.c0.z + d * c.c1.z + e * c.p1.z,
  };
}

/** Arc-length table: `n + 1` samples with cumulative length, for even spacing along the belt. */
export function sampleCurve(c: BeltCurve, n = 64): { readonly pts: XZ[]; readonly len: number[] } {
  const pts: XZ[] = [];
  const len: number[] = [];
  let acc = 0;
  for (let i = 0; i <= n; i++) {
    const p = bezierAt(c, i / n);
    if (i > 0) acc += Math.hypot(p.x - pts[i - 1]!.x, p.z - pts[i - 1]!.z);
    pts.push(p);
    len.push(acc);
  }
  return { pts, len };
}

/** Point and unit tangent at arc-length fraction s (0..1) of a sampled curve. */
export function curveFrameAt(sample: { readonly pts: XZ[]; readonly len: number[] }, s: number): { p: XZ; t: XZ } {
  const total = sample.len[sample.len.length - 1]!;
  const target = Math.min(Math.max(s, 0), 1) * total;
  let i = 1;
  while (i < sample.len.length - 1 && sample.len[i]! < target) i++;
  const l0 = sample.len[i - 1]!, l1 = sample.len[i]!;
  const f = l1 > l0 ? (target - l0) / (l1 - l0) : 0;
  const a = sample.pts[i - 1]!, b = sample.pts[i]!;
  const dx = b.x - a.x, dz = b.z - a.z;
  const dl = Math.hypot(dx, dz) || 1;
  return { p: { x: a.x + dx * f, z: a.z + dz * f }, t: { x: dx / dl, z: dz / dl } };
}

/** Distance from a world point to a belt's curve (for picking). */
export function distanceToCurve(c: BeltCurve, x: number, z: number, n = 32): number {
  let best = Infinity;
  let prev = bezierAt(c, 0);
  for (let i = 1; i <= n; i++) {
    const p = bezierAt(c, i / n);
    best = Math.min(best, distToSegment(x, z, prev, p));
    prev = p;
  }
  return best;
}

export function distToSegment(x: number, z: number, a: XZ, b: XZ): number {
  const dx = b.x - a.x, dz = b.z - a.z;
  const l2 = dx * dx + dz * dz;
  const t = l2 > 0 ? Math.min(1, Math.max(0, ((x - a.x) * dx + (z - a.z) * dz) / l2)) : 0;
  return Math.hypot(x - (a.x + dx * t), z - (a.z + dz * t));
}

// ── Whole-board extents and the things beside the board ────────────────────────────────────────

export interface Bounds { minX: number; maxX: number; minZ: number; maxZ: number }

export function unionBounds(a: Bounds, b: Bounds): Bounds {
  return { minX: Math.min(a.minX, b.minX), maxX: Math.max(a.maxX, b.maxX), minZ: Math.min(a.minZ, b.minZ), maxZ: Math.max(a.maxZ, b.maxZ) };
}

/** True when `inner` lies inside `outer` (within eps mm). */
export function containsBounds(outer: Bounds, inner: Bounds, eps = 0.01): boolean {
  return inner.minX >= outer.minX - eps && inner.maxX <= outer.maxX + eps && inner.minZ >= outer.minZ - eps && inner.maxZ <= outer.maxZ + eps;
}

export function boardBounds(board: ReadonlyArray<Pick<BoardPiece, 'type' | 'coord' | 'rotation'>>): Bounds {
  const b: Bounds = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
  for (const p of board) {
    for (const cell of pieceCells(p)) {
      const c = axialToWorld(cell);
      b.minX = Math.min(b.minX, c.x - APOTHEM);
      b.maxX = Math.max(b.maxX, c.x + APOTHEM);
      b.minZ = Math.min(b.minZ, c.z - HEX_RADIUS);
      b.maxZ = Math.max(b.maxZ, c.z + HEX_RADIUS);
    }
  }
  if (!Number.isFinite(b.minX)) return { minX: -HEX_RADIUS, maxX: HEX_RADIUS, minZ: -HEX_RADIUS, maxZ: HEX_RADIUS };
  return b;
}

/** Card size (standard poker card), for the Leverage deck and discard pile. */
export const CARD = { w: 63, d: 88, thickness: 0.32 } as const;
export const DIE_SIZE = 16;
/** A mine is two hexes side by side: 137.7 mm long. */
export const MINE_LENGTH = ACROSS_FLATS * 2;
/** Space between the ends of two mines lying on neighbouring piles. */
export const PILE_GAP = 14;

export interface SideLayout {
  readonly stacks: readonly [XZ, XZ, XZ];
  readonly deck: XZ;
  readonly discard: XZ;
  readonly dice: readonly XZ[];
}

/** Space kept between the card piles and the board (they are at most ~15 mm tall). */
export const CARD_GAP = 22;
/** Extra room between a stack and the board beyond the ground the stack can hide. */
export const STACK_MARGIN = 8;

const pieceCount = (c: object): number => Object.values(c as Record<string, number | undefined>).reduce<number>((s, n) => s + (n ?? 0), 0);

/**
 * Height of the tallest pile at the start of a game: the fullest stack with a Mine lying on it,
 * or stack 1 (after the starting pieces left it) with its drawn piece floating above. Stacks only
 * shrink during a game, so this is the tallest a pile ever stands.
 */
export function tallestPile(playerCount: number): number {
  const n = (Math.min(4, Math.max(2, Math.round(playerCount))) as 2 | 3 | 4);
  const [s1, s2, s3] = STACK_COMPOSITION[n].map(pieceCount) as [number, number, number];
  const first = stackHeight(Math.max(0, s1 - pieceCount(STARTING_PIECES_PER_PLAYER) * n)) + REVEAL_LIFT + TILE_TOP;
  const locked = stackHeight(Math.max(s2, s3)) + TILE_TOP;
  return Math.max(first, locked);
}

/**
 * Ground a pile of height h hides behind it, seen at the camera's elevation: h / tan(elevation).
 * The stacks keep this far (plus a margin) from the board, so seen from any side of the table,
 * even from across the board, no stack covers a board piece.
 */
export function stackGap(playerCount: number, elevation = VIEW_ELEVATION): number {
  return tallestPile(playerCount) / Math.tan(elevation) + STACK_MARGIN;
}

/**
 * Where the stacks, card piles and dice go, around `bounds` (the board area the piles leave room
 * for, see framing.ts sideAnchor): the three stacks in a row behind the board, far enough that the
 * tallest of them hides no board piece from any side (stackGap); the Leverage deck and discard
 * pile left of the board, the dice under them, growing away from the board.
 */
export function sideLayout(bounds: Bounds, diceCount: number, portrait = false, playerCount = 4): SideLayout {
  if (portrait) return portraitSide(bounds, diceCount, playerCount);
  const left = bounds.minX - CARD_GAP - CARD.w / 2;
  const midZ = (bounds.minZ + bounds.maxZ) / 2;
  const midX = (bounds.minX + bounds.maxX) / 2;
  // A locked stack carries its two-hex mine centred on it (half a hex overhanging on each side),
  // so neighbouring stacks are a mine's length apart plus a gap.
  const gapX = MINE_LENGTH + PILE_GAP;
  // Stacks and the mines on them reach HEX_RADIUS either side of their centre along Z.
  const rowZ = bounds.minZ - stackGap(playerCount) - HEX_RADIUS;
  const firstX = midX - gapX;
  const stacks: [XZ, XZ, XZ] = [
    { x: firstX, z: rowZ },
    { x: firstX + gapX, z: rowZ },
    { x: firstX + 2 * gapX, z: rowZ },
  ];
  const deck = { x: left, z: midZ - CARD.d * 0.58 };
  const discard = { x: left, z: midZ + CARD.d * 0.58 };
  const dice: XZ[] = [];
  // The first die where it always was; more dice go further left, never up to the board's edge.
  for (let i = 0; i < diceCount; i++) dice.push({ x: left - 22 - i * (DIE_SIZE * 2.1), z: discard.z + CARD.d / 2 + 28 + (i % 2) * 6 });
  return { stacks, deck, discard, dice };
}

/** Narrow (portrait) screens: stacks behind the board as usual, cards and dice in front of it. */
function portraitSide(bounds: Bounds, diceCount: number, playerCount: number): SideLayout {
  const wide = sideLayout(bounds, 0, false, playerCount);
  const midX = (bounds.minX + bounds.maxX) / 2;
  const rowZ = bounds.maxZ + CARD_GAP + CARD.d / 2;
  const deck = { x: midX - CARD.w * 0.6 - 30, z: rowZ };
  const discard = { x: midX + CARD.w * 0.6 - 30, z: rowZ };
  const dice: XZ[] = [];
  for (let i = 0; i < diceCount; i++) dice.push({ x: discard.x + CARD.w / 2 + 26 + (i % 2) * 22, z: rowZ - 22 + i * 22 });
  return { stacks: wide.stacks, deck, discard, dice };
}

/** Height of a face-down stack of n tiles. */
export function stackHeight(n: number): number {
  return n * TILE_TOP;
}

// ── Draw piles: which top piece is face-up ──────────────────────────────────────────────────────

/** How far above its pile a drawn (face-up) piece floats, as if held in the hand. */
export const REVEAL_LIFT = 16;

/**
 * The state fields revealedStack reads. `drawnStackIndex` is optional so this compiles whether or
 * not the engine's GameState has the field yet.
 */
export interface RevealInput {
  readonly phase: string;
  readonly pendingMineIds: ReadonlyArray<string>;
  readonly stacks: ReadonlyArray<{ readonly available: boolean; readonly pieces: ReadonlyArray<unknown> }>;
  readonly drawnStackIndex?: number | null;
}

/**
 * Which pile's top piece is face-up for everyone (the piece drawn this turn), or null when every
 * pile is face-down. Only in the 'placePiece' phase with no mine waiting to be placed: the pile the
 * player drew from (drawnStackIndex), otherwise the single open non-empty pile if there is exactly
 * one. Mirrors the engine's revealedStack(state).
 */
export function revealedStack(state: RevealInput): 0 | 1 | 2 | null {
  if (state.phase !== 'placePiece' || state.pendingMineIds.length > 0) return null;
  const drawn = state.drawnStackIndex;
  if (drawn === 0 || drawn === 1 || drawn === 2) return (state.stacks[drawn]?.pieces.length ?? 0) > 0 ? drawn : null;
  const open: number[] = [];
  state.stacks.forEach((s, i) => { if (s.available && s.pieces.length > 0) open.push(i); });
  return open.length === 1 && open[0]! <= 2 ? open[0] as 0 | 1 | 2 : null;
}

/** A mine that has dropped but is not placed yet hovers this far above its pile. */
export const PENDING_MINE_LIFT = 8;

/**
 * Where a mine lying on its pile sits (mine 2 on pile 2, mine 3 on pile 3): centred over the pile
 * (model origin, between its two hexes, over the pile centre), y = top of the pile.
 */
export function minePileAt(side: SideLayout, game: Pick<GameState, 'stacks'>, mineId: string): { x: number; y: number; z: number } {
  const idx = Math.min(2, Math.max(0, Number(/(\d+)$/.exec(mineId)?.[1] ?? '2') - 1));
  const at = side.stacks[idx]!;
  return { x: at.x, y: stackHeight(game.stacks[idx]?.pieces.length ?? 0), z: at.z };
}

/** Where the drawn piece floats: over pile `index` whose pile (including the drawn piece) holds n tiles. */
export function revealedPose(side: SideLayout, index: number, n: number): { x: number; y: number; z: number } {
  const at = side.stacks[index] ?? { x: 0, z: 0 };
  return { x: at.x, y: stackHeight(Math.max(0, n - 1)) + REVEAL_LIFT, z: at.z };
}

/**
 * Every piece on the board plus everything beside it, for framing the camera. `area` is the board
 * area the piles are laid out around (default: the board's own bounds); it is included too.
 */
export function tableBounds(
  game: Pick<GameState, 'board' | 'mineCount'> & { readonly players?: ReadonlyArray<unknown> },
  portrait = false,
  area?: Bounds,
): Bounds {
  const board = boardBounds(game.board);
  const b = area ? unionBounds(board, area) : board;
  const side = sideLayout(b, game.mineCount, portrait, game.players?.length ?? 4);
  const out = { ...b };
  const grow = (p: XZ, rx: number, rz: number): void => {
    out.minX = Math.min(out.minX, p.x - rx);
    out.maxX = Math.max(out.maxX, p.x + rx);
    out.minZ = Math.min(out.minZ, p.z - rz);
    out.maxZ = Math.max(out.maxZ, p.z + rz);
  };
  // A locked stack carries its mine centred on it, reaching half a hex past the pile on each side.
  for (const s of side.stacks) grow(s, MINE_LENGTH / 2 + 3, HEX_RADIUS * 1.05);
  grow(side.deck, CARD.w / 2, CARD.d / 2);
  grow(side.discard, CARD.w / 2, CARD.d / 2);
  for (const d of side.dice) grow(d, DIE_SIZE, DIE_SIZE);
  return out;
}
