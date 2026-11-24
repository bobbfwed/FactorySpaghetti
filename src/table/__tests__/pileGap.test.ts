// The piles beside the board never hide a board piece, from any side of the table: a pile of
// height h hides the ground behind it (away from the camera) for h / tan(elevation), so the stacks
// keep that far from the board. Checked by ray casting on several board shapes.

import { describe, it, expect } from 'vitest';
import {
  CARD, DIE_SIZE, HEX_RADIUS, MINE_LENGTH, TILE_TOP, VIEW_ELEVATION, axialToWorld, boardBounds, hexCorner,
  pieceCells, sideLayout, stackGap, stackHeight, tallestPile, type Bounds, type SideLayout, type XZ,
} from '../layout';
import { sideAnchor } from '../framing';
import { createBotGame, playUntil } from '../botGame';
import { createGame } from '../../engine/rules/setup';
import { STACK_COMPOSITION } from '../../engine/config';
import type { BoardPiece } from '../../engine/state';

/** A solid standing beside the board: an axis-aligned box footprint and a height. */
interface Solid { readonly name: string; readonly min: XZ; readonly max: XZ; readonly h: number }

function solids(side: SideLayout, players: number): Solid[] {
  const out: Solid[] = [];
  const deck = createGame(1, players as 2 | 3 | 4).cardDeck.length * CARD.thickness + 1;
  // Every stack as tall as the tallest pile, with a Mine's footprint (the widest thing on a pile).
  side.stacks.forEach((s, i) => out.push({
    name: `stack ${i + 1}`, h: tallestPile(players),
    min: { x: s.x - MINE_LENGTH / 2, z: s.z - HEX_RADIUS }, max: { x: s.x + MINE_LENGTH / 2, z: s.z + HEX_RADIUS },
  }));
  for (const [name, p] of [['deck', side.deck], ['discard', side.discard]] as const) {
    out.push({ name, h: deck, min: { x: p.x - CARD.w / 2, z: p.z - CARD.d / 2 }, max: { x: p.x + CARD.w / 2, z: p.z + CARD.d / 2 } });
  }
  side.dice.forEach((d, i) => out.push({ name: `die ${i + 1}`, h: DIE_SIZE, min: { x: d.x - DIE_SIZE / 2, z: d.z - DIE_SIZE / 2 }, max: { x: d.x + DIE_SIZE / 2, z: d.z + DIE_SIZE / 2 } }));
  return out;
}

/** Points on the top face of every board hex: its centre and its corners pulled 1 mm in. */
function boardPoints(board: ReadonlyArray<Pick<BoardPiece, 'type' | 'coord' | 'rotation'>>): XZ[] {
  const pts: XZ[] = [];
  for (const p of board) {
    for (const cell of pieceCells(p)) {
      const c = axialToWorld(cell);
      pts.push(c);
      for (let i = 0; i < 6; i++) pts.push(hexCorner(c, i, HEX_RADIUS - 1));
    }
  }
  return pts;
}

/** Is the board point p (on the tile tops) hidden from a camera at azimuth az by solid s? */
function hides(s: Solid, p: XZ, az: number): boolean {
  // Walk from p towards the camera; the line of sight rises tan(elevation) per mm.
  const dx = Math.sin(az), dz = Math.cos(az);
  const reach = Math.max(0, (s.h - TILE_TOP) / Math.tan(VIEW_ELEVATION));
  for (let t = 0; t <= reach; t += 0.5) {
    const x = p.x + dx * t, z = p.z + dz * t;
    if (x >= s.min.x && x <= s.max.x && z >= s.min.z && z <= s.max.z) return true;
  }
  return false;
}

function hiddenPoints(board: ReadonlyArray<Pick<BoardPiece, 'type' | 'coord' | 'rotation'>>, side: SideLayout, players: number): string[] {
  const out: string[] = [];
  const pts = boardPoints(board);
  const objs = solids(side, players);
  for (let deg = 0; deg < 360; deg += 10) {
    const az = (deg * Math.PI) / 180;
    for (const s of objs) {
      for (const p of pts) if (hides(s, p, az)) { out.push(`${s.name} hides (${p.x.toFixed(0)}, ${p.z.toFixed(0)}) from ${deg} degrees`); break; }
    }
  }
  return out;
}

const line = (n: number): BoardPiece[] => Array.from({ length: n }, (_, i) => ({ id: `t${i}`, type: 'blank', coord: { q: i - Math.floor(n / 2), r: 0 }, rotation: 0, claims: [], input: null, output: null }));
const column = (n: number): BoardPiece[] => Array.from({ length: n }, (_, i) => ({ id: `t${i}`, type: 'blank', coord: { q: -Math.floor(i / 2), r: i }, rotation: 0, claims: [], input: null, output: null }));

describe('stack gap', () => {
  it('comes from the tallest starting pile (a full stack with a Mine on it) and the camera elevation', () => {
    for (const n of [2, 3, 4] as const) {
      const fullest = Math.max(...STACK_COMPOSITION[n].map(c => Object.values(c).reduce((a, b) => a + b, 0)));
      expect(tallestPile(n)).toBeGreaterThanOrEqual(stackHeight(fullest) + TILE_TOP);
      expect(stackGap(n)).toBeGreaterThanOrEqual(tallestPile(n) / Math.tan(VIEW_ELEVATION));
    }
    expect(stackGap(4)).toBeGreaterThan(stackGap(2));
    // Looking straight down nothing is hidden behind a pile.
    expect(stackGap(4, Math.PI / 2 - 1e-6)).toBeLessThan(10);
  });

  it('the stacks stand at least the gap behind the board', () => {
    for (const n of [2, 3, 4]) {
      const b: Bounds = { minX: -100, maxX: 100, minZ: -80, maxZ: 80 };
      for (const s of sideLayout(b, 3, false, n).stacks) expect(b.minZ - (s.z + HEX_RADIUS)).toBeGreaterThanOrEqual(stackGap(n) - 1e-9);
    }
  });
});

describe('no pile hides a board piece, from any direction', () => {
  const shapes: Array<{ name: string; players: 2 | 3 | 4; board: () => ReadonlyArray<BoardPiece>; dice: number }> = [
    { name: 'a 4-player start', players: 4, board: () => createBotGame(31, 4, 'greedy').state.board, dice: 1 },
    { name: 'a 2-player mid game', players: 2, board: () => playUntil(createBotGame(32, 2, 'random'), s => s.board.length >= 30).board, dice: 2 },
    { name: 'a 3-player late game', players: 3, board: () => playUntil(createBotGame(33, 3, 'random'), s => s.board.length >= 55).board, dice: 3 },
    { name: 'a long row', players: 4, board: () => line(9), dice: 3 },
    { name: 'a long column', players: 4, board: () => column(8), dice: 3 },
  ];
  for (const shape of shapes) {
    it(`${shape.name}, piles laid out right at the board's edge and round the padded area`, () => {
      const board = shape.board();
      const b = boardBounds(board);
      // Piles laid out round the board itself (the closest they ever come) and round the area the
      // table really uses (framing.ts sideAnchor).
      for (const area of [b, sideAnchor(null, b)]) {
        for (const portrait of [false, true]) {
          expect(hiddenPoints(board, sideLayout(area, shape.dice, portrait, shape.players), shape.players)).toEqual([]);
        }
      }
    });
  }

  it('the old 24 mm gap did hide board pieces (the check can fail)', () => {
    const board = line(5);
    const b = boardBounds(board);
    const side = sideLayout(b, 1, false, 4);
    const old: SideLayout = { ...side, stacks: side.stacks.map(s => ({ x: s.x, z: b.minZ - 24 - HEX_RADIUS })) as unknown as SideLayout['stacks'] };
    expect(hiddenPoints(board, old, 4).length).toBeGreaterThan(0);
  });
});
