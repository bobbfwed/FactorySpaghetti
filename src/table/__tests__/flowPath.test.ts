// The flow display's tracer (flowPath.ts) follows the engine's dead-end rule (RULES_CHANGES.md
// #38): material is never drawn travelling through a belt end that faces the input or output of a
// building claimed only by other players. Same hand-built board as designerDecisions.test.ts.

import { describe, it, expect } from 'vitest';
import type { Belt, BoardPiece, GameState } from '../../engine/state';
import type { Material } from '../../engine/config';
import { resolveDirectAdjacency } from '../../engine/rules/flow';
import { createGame } from '../../engine/rules/setup';
import { traceFlow } from '../flowPath';
import { bufferSlotWorld } from '../layout';

type Claims = BoardPiece['claims'];

function piece(id: string, type: BoardPiece['type'], q: number, r: number, claims: Claims = []): BoardPiece {
  const inputs = type === 'plateFact' || type === 'powerPlant' ? 1 : type === 'sphereFact' ? 2 : type === 'tesseractFact' ? 3 : 0;
  const hasOutput = type === 'plateFact' || type === 'sphereFact' || type === 'tesseractFact';
  return {
    id, type, coord: { q, r }, rotation: 0, claims,
    input: inputs ? { slots: new Array(inputs).fill(null), teleporterOwner: null } : null,
    output: hasOutput || type === 'mine' ? { slots: [null], teleporterOwner: null } : null,
  };
}

// Mine 1 at (0,0) (lean hex at (1,0)); blank A at (2,0): point 0 faces the lean hex's ore exit,
// point 7 faces F's input. F is a Plate Factory at (3,0); blank C at (4,0): point 0 faces F's
// output, point 7 faces G's input; G is a Sphere Factory at (5,0). Both belts are player 0's.
const MINE = piece('mine-1', 'mine', 0, 0);
const A = piece('A', 'blank', 2, 0);
const C = piece('C', 'blank', 4, 0);
const F = (claims: Claims, out: Material | null = null): BoardPiece =>
  ({ ...piece('F', 'plateFact', 3, 0, claims), output: { slots: [out], teleporterOwner: null } });
const G = (claims: Claims): BoardPiece => piece('G', 'sphereFact', 5, 0, claims);
const beltA: Belt = { id: 'bA', ownerId: 0, pieceId: 'A', fromPoint: 0, toPoint: 7 };
const beltC: Belt = { id: 'bC', ownerId: 0, pieceId: 'C', fromPoint: 0, toPoint: 7 };
const P0: Claims = [{ ownerId: 0, controlModule: 4 }];
const P1: Claims = [{ ownerId: 1, controlModule: 4 }];
const BOTH: Claims = [{ ownerId: 1, controlModule: 4 }, { ownerId: 0, controlModule: 5 }];

const fromMine = [{ pieceId: 'mine-1', kind: 'mine' as const, slot: 0 }];
const fromF = [{ pieceId: 'F', kind: 'output' as const, slot: 0 }];

/** The traces into any input slot of `to` (null for each slot nothing reaches). */
function traces(board: BoardPiece[], belts: Belt[], to: string, sources: typeof fromMine | typeof fromF): ReturnType<typeof traceFlow>[] {
  const dest = board.find(p => p.id === to)!;
  return dest.input!.slots.map((_, slot) => traceFlow({ board, belts }, to, slot, sources));
}
const reached = (t: ReturnType<typeof traceFlow>[]): boolean => t.some(x => x !== null);

describe('flow display: a belt end facing a building it may not serve is a dead end (#38)', () => {
  it('feeding: ore is drawn into a building only when the belt owner may serve it', () => {
    expect(reached(traces([MINE, A, F(P0)], [beltA], 'F', fromMine))).toBe(true);
    expect(reached(traces([MINE, A, F(BOTH)], [beltA], 'F', fromMine))).toBe(true);
    expect(reached(traces([MINE, A, F([])], [beltA], 'F', fromMine))).toBe(true);
    expect(reached(traces([MINE, A, F(P1)], [beltA], 'F', fromMine))).toBe(false);
  });

  it('drawing: nothing is drawn leaving a building claimed only by another player through the chain', () => {
    expect(reached(traces([F(P1, 'plate'), C, G(P0)], [beltC], 'G', fromF))).toBe(false);
    expect(reached(traces([F(BOTH, 'plate'), C, G(P0)], [beltC], 'G', fromF))).toBe(true);
    expect(reached(traces([F([], 'plate'), C, G(P0)], [beltC], 'G', fromF))).toBe(true);
  });

  it('agrees with the engine: the display traces a way exactly when the engine moves the material', () => {
    const g = createGame(1, 2);
    const engineMoves = (board: BoardPiece[], belts: Belt[], to: string): boolean =>
      resolveDirectAdjacency({ ...g, board, belts } as GameState).board.find(p => p.id === to)!.input!.slots.some(x => x !== null);
    for (const claims of [P0, P1, BOTH]) {
      const board = [MINE, A, F(claims)];
      expect(reached(traces(board, [beltA], 'F', fromMine))).toBe(engineMoves(board, [beltA], 'F'));
    }
    for (const claims of [P1, BOTH, []]) {
      const board = [F(claims, 'plate'), C, G(P0)];
      expect(reached(traces(board, [beltC], 'G', fromF))).toBe(engineMoves(board, [beltC], 'G'));
    }
  });

  it('the drawn way runs from the source to the input slot, whichever order the belt was stored in', () => {
    const board = [MINE, A, F(P0)];
    const dest = board[2]!;
    for (const belt of [beltA, { ...beltA, fromPoint: 7, toPoint: 0 }]) {
      const t = traceFlow({ board, belts: [belt] }, 'F', 0, fromMine)!;
      expect(t).not.toBeNull();
      expect(t.belts).toBe(1);
      const end = t.points[t.points.length - 1]!;
      const want = bufferSlotWorld(dest, 'input', 0);
      expect(Math.hypot(end.x - want.x, end.z - want.z)).toBeLessThan(0.01);
      // Along the belt the points move away from the mine, towards the factory.
      const mineSide = t.points[1]!, factorySide = t.points[t.points.length - 2]!;
      expect(factorySide.x).toBeGreaterThan(mineSide.x);
    }
  });
});
