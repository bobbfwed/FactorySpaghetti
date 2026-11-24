// When the camera and the piles move by themselves: rarely. A placed piece normally moves
// neither; when something would leave the view the camera re-frames once, with head-room, and it
// never zooms in by itself.

import { describe, it, expect } from 'vitest';
import {
  ANCHOR_PAD, ANCHOR_STEP, FRAME_HEADROOM, frameAll, keepInView, reframeArea, sideAnchor,
  type FramingCamera, type FramingTable,
} from '../framing';
import { ACROSS_FLATS, TILE_TOP, boardBounds, containsBounds, sideLayout, tableBounds, type Bounds } from '../layout';
import { CameraRig } from '../camera';
import { createBotGame } from '../botGame';
import type { GameState } from '../../engine/state';

const box = (minX: number, maxX: number, minZ: number, maxZ: number): Bounds => ({ minX, maxX, minZ, maxZ });

describe('sideAnchor (the area the piles are laid out around)', () => {
  it('starts as the board with one tile of room on every side', () => {
    expect(sideAnchor(null, box(-100, 100, -50, 50))).toEqual(box(-100 - ANCHOR_PAD, 100 + ANCHOR_PAD, -50 - ANCHOR_PAD, 50 + ANCHOR_PAD));
  });

  it('stays put while the board grows inside it', () => {
    const a = sideAnchor(null, box(-100, 100, -50, 50));
    expect(sideAnchor(a, box(-100 - ACROSS_FLATS, 100, -50, 50 + 59))).toBe(a);
  });

  it('only the side the board reached past moves out, by a coarse step', () => {
    const a = sideAnchor(null, box(-100, 100, -50, 50));
    const b = sideAnchor(a, box(-100, 100 + ANCHOR_PAD + 10, -50, 50));
    expect(b).toEqual({ ...a, maxX: 100 + ANCHOR_PAD + 10 + ANCHOR_STEP });
  });

  it('never shrinks', () => {
    const a = sideAnchor(null, box(-300, 300, -300, 300));
    expect(sideAnchor(a, box(-10, 10, -10, 10))).toBe(a);
  });
});

describe('reframeArea (does the camera have to move, and to what)', () => {
  const framed = box(-300, 300, -300, 300);

  it('the first time: frame what is needed', () => {
    expect(reframeArea({ framed: null, needed: box(-1, 1, -1, 1), boardVisible: true, boardFits: true })).toEqual(box(-1, 1, -1, 1));
  });

  it('nothing grew and the board is in view: the camera stays', () => {
    expect(reframeArea({ framed, needed: box(-200, 300, -300, 100), boardVisible: true, boardFits: true })).toBeNull();
  });

  it('the table grew past the framed area: frame the union, with head-room on the grown sides', () => {
    const a = reframeArea({ framed, needed: box(-200, 350, -320, 100), boardVisible: true, boardFits: true })!;
    expect(a).toEqual(box(-300, 350 + FRAME_HEADROOM, -320 - FRAME_HEADROOM, 300));
    expect(containsBounds(a, framed)).toBe(true);
  });

  it('the board went out of view (a panel came up, the view turned): frame again, never a smaller area', () => {
    expect(reframeArea({ framed, needed: box(-200, 300, -300, 100), boardVisible: false, boardFits: true })).toEqual(framed);
  });

  it('a board too big to show whole at the furthest zoom does not keep moving the camera', () => {
    expect(reframeArea({ framed, needed: box(-200, 300, -300, 100), boardVisible: false, boardFits: false })).toBeNull();
  });
});

/**
 * Play a seeded bot game and drive the table's rules (table.ts keepInView) after every move that
 * placed a piece: count how often the piles or the camera move.
 */
interface SimResult { placements: number; pileMoves: number; reframes: number; zoomIns: number; hidden: number }

function simulate(seed: number, players: 2 | 3 | 4, size: { w: number; h: number; insets: { top: number; right: number; bottom: number; left: number }; maxScale?: number }): SimResult {
  const game = createBotGame(seed, players, 'greedy');
  const rig = new CameraRig();
  rig.setSize(size.w, size.h);
  rig.setInsets(size.insets, size.maxScale);
  // The rig, with every move made at once (the table animates them).
  const cam: FramingCamera = {
    boxVisible: (b, top) => rig.boxVisible(b, top),
    boxFits: (b, top) => rig.boxFits(b, top),
    frame: (b, _animate, top, margin, noZoomIn) => rig.frame(b, false, top, margin, noZoomIn),
  };
  let anchor: Bounds | null = null;
  const table = (g: GameState): FramingTable => ({ board: boardBounds(g.board), needed: tableBounds(g, false, anchor!), stackTop: 110 });
  // Open the game: frame it.
  anchor = sideAnchor(null, boardBounds(game.state.board));
  let framed = frameAll(cam, table(game.state), false);
  let hidden = rig.boxVisible(boardBounds(game.state.board), TILE_TOP, 0) ? 0 : 1;
  let size0 = game.state.board.length;
  let placements = 0, pileMoves = 0, zoomIns = 0, reframes = 0;
  let scale = rig.scale;
  while (game.step()) {
    const g = game.state;
    if (g.board.length === size0) continue;
    size0 = g.board.length;
    placements++;
    const before = sideLayout(anchor, g.mineCount, false, players);
    anchor = sideAnchor(anchor, boardBounds(g.board));
    if (JSON.stringify(sideLayout(anchor, g.mineCount, false, players).stacks) !== JSON.stringify(before.stacks)) pileMoves++;
    const next = keepInView(cam, table(g), framed);
    if (next) { reframes++; framed = next; }
    if (rig.scale < scale - 1e-9) zoomIns++;
    scale = rig.scale;
    const board = boardBounds(g.board);
    if (rig.boxFits(board, TILE_TOP) && !rig.boxVisible(board, TILE_TOP, 0)) hidden++;
  }
  return { placements, pileMoves, reframes, zoomIns, hidden };
}

describe('a whole game: the camera and the piles mostly stay put', () => {
  const desktop = { w: 1400, h: 850, insets: { top: 80, right: 320, bottom: 160, left: 12 } };
  const phone = { w: 390, h: 760, insets: { top: 70, right: 12, bottom: 220, left: 12 }, maxScale: ACROSS_FLATS / 64 };
  for (const [seed, players] of [[5, 4], [6, 3], [7, 2]] as const) {
    it(`${players} players (seed ${seed}), desktop and phone`, () => {
      for (const screen of [desktop, phone]) {
        const r = simulate(seed, players, screen);
        expect(r.placements).toBeGreaterThan(15);
        // The camera never zooms in by itself, and the board is always in view when it can be.
        expect(r.zoomIns).toBe(0);
        expect(r.hidden).toBe(0);
        // Most placements move neither the piles nor the camera.
        expect(r.pileMoves).toBeLessThanOrEqual(Math.ceil(r.placements / 8));
        expect(r.reframes).toBeLessThanOrEqual(Math.ceil(r.placements / 8));
      }
    });
  }
});
