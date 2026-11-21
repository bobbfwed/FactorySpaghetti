// The draw piles: which pile's top piece is face-up, and where the piles and the mines lying on
// them go.

import { describe, it, expect } from 'vitest';
import {
  MINE_LENGTH, REVEAL_LIFT, TILE_TOP, boardBounds, minePileAt, revealedPose, revealedStack,
  sideLayout, stackHeight, tableBounds, type RevealInput,
} from '../layout';
import { createBotGame } from '../botGame';

const pile = (available: boolean, n: number): RevealInput['stacks'][number] => ({ available, pieces: Array.from({ length: n }, (_, i) => ({ id: `p${i}` })) });

function input(over: Partial<RevealInput>): RevealInput {
  return { phase: 'placePiece', pendingMineIds: [], stacks: [pile(true, 5), pile(false, 7), pile(false, 7)], ...over };
}

describe('revealedStack', () => {
  it('is the single open pile when nothing was drawn yet', () => {
    expect(revealedStack(input({}))).toBe(0);
    expect(revealedStack(input({ drawnStackIndex: null }))).toBe(0);
    // Pile 1 empty, pile 2 open: pile 2.
    expect(revealedStack(input({ stacks: [pile(true, 0), pile(true, 3), pile(false, 7)] }))).toBe(1);
  });

  it('is none when two or more piles are open and nothing was drawn', () => {
    expect(revealedStack(input({ stacks: [pile(true, 4), pile(true, 3), pile(false, 7)] }))).toBeNull();
    expect(revealedStack(input({ stacks: [pile(true, 0), pile(false, 3), pile(false, 7)] }))).toBeNull();
  });

  it('is the pile drawn from, once drawn', () => {
    const three = [pile(true, 4), pile(true, 3), pile(true, 2)] as const;
    expect(revealedStack(input({ stacks: three, drawnStackIndex: 2 }))).toBe(2);
    expect(revealedStack(input({ stacks: three, drawnStackIndex: 0 }))).toBe(0);
  });

  it('is none outside the place-a-piece step, and while a mine waits to be placed', () => {
    for (const phase of ['roll', 'actions', 'placeMeeple', 'setupClaim', 'roundEnd']) {
      expect(revealedStack(input({ phase, drawnStackIndex: 0 }))).toBeNull();
    }
    expect(revealedStack(input({ pendingMineIds: ['mine-2'] }))).toBeNull();
    expect(revealedStack(input({ pendingMineIds: ['mine-2'], drawnStackIndex: 0 }))).toBeNull();
  });

  it('works on a real game state (with or without the engine field)', () => {
    const g = createBotGame(3, 2, 'random');
    const s = g.state;
    const r = revealedStack(s);
    expect(r === null || r === 0).toBe(true);
  });
});

describe('piles and the mines on them', () => {
  const side = sideLayout(boardBounds([{ type: 'mine', coord: { q: 0, r: 0 }, rotation: 0 }]), 1);

  it('the three piles are far enough apart for a centred mine on each, with a gap', () => {
    for (let i = 0; i < 2; i++) {
      const gap = side.stacks[i + 1]!.x - side.stacks[i]!.x - MINE_LENGTH;
      expect(gap).toBeGreaterThanOrEqual(10);
      expect(gap).toBeLessThan(30);
      expect(side.stacks[i + 1]!.z).toBe(side.stacks[i]!.z);
    }
  });

  it('a mine lies centred on its pile, on top of it', () => {
    const stacks = [{ pieces: new Array(4) }, { pieces: new Array(9) }, { pieces: new Array(11) }] as unknown as Parameters<typeof minePileAt>[1]['stacks'];
    const m2 = minePileAt(side, { stacks }, 'mine-2');
    expect(m2).toEqual({ x: side.stacks[1].x, y: stackHeight(9), z: side.stacks[1].z });
    const m3 = minePileAt(side, { stacks }, 'mine-3');
    expect(m3).toEqual({ x: side.stacks[2].x, y: stackHeight(11), z: side.stacks[2].z });
  });

  it('the table bounds include both overhanging ends of every mine', () => {
    const board = [{ id: 'mine-1', type: 'mine' as const, coord: { q: 0, r: 0 }, rotation: 0, claims: [], input: null, output: null }];
    const b = tableBounds({ board, mineCount: 1 });
    expect(b.minX).toBeLessThanOrEqual(side.stacks[0].x - MINE_LENGTH / 2);
    expect(b.maxX).toBeGreaterThanOrEqual(side.stacks[2].x + MINE_LENGTH / 2);
  });

  it('the drawn piece floats above the rest of its pile', () => {
    const p = revealedPose(side, 1, 6);
    expect(p.x).toBe(side.stacks[1].x);
    expect(p.y).toBe(stackHeight(5) + REVEAL_LIFT);
    expect(p.y).toBeGreaterThan(stackHeight(6) + TILE_TOP);
  });
});
