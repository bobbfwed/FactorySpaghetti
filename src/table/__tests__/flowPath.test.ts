// The flow display's tracer (flowPath.ts) follows the engine's dead-end rule (RULES_CHANGES.md
// #38): material is never drawn travelling through a belt end that faces the input or output of a
// building claimed only by other players; nor passing straight from another player's output into
// a touching input (#51). Same hand-built board as designerDecisions.test.ts.

import { describe, it, expect } from 'vitest';
import type { Belt, BoardPiece, GameState } from '../../engine/state';
import type { Material } from '../../engine/config';
import { resolveDirectAdjacency } from '../../engine/rules/flow';
import { createGame } from '../../engine/rules/setup';
import { withTeleporter } from '../../engine/rules/teleporters';
import { traceFlow } from '../flowPath';
import { bufferSlotWorld } from '../layout';

type Claims = BoardPiece['claims'];

function piece(id: string, type: BoardPiece['type'], q: number, r: number, claims: Claims = []): BoardPiece {
  const inputs = type === 'plateFact' || type === 'powerPlant' ? 1 : type === 'sphereFact' ? 2 : type === 'tesseractFact' ? 3 : 0;
  const hasOutput = type === 'plateFact' || type === 'sphereFact' || type === 'tesseractFact';
  return {
    id, type, coord: { q, r }, rotation: 0, claims,
    input: inputs ? { slots: new Array(inputs).fill(null), teleporters: [] } : null,
    output: hasOutput || type === 'mine' ? { slots: [null], teleporters: [] } : null,
  };
}

// Mine 1 at (0,0) (lean hex at (1,0)); blank A at (2,0): point 0 faces the lean hex's ore exit,
// point 7 faces F's input. F is a Plate Factory at (3,0); blank C at (4,0): point 0 faces F's
// output, point 7 faces G's input; G is a Sphere Factory at (5,0). Both belts are player 0's.
const MINE = piece('mine-1', 'mine', 0, 0);
const A = piece('A', 'blank', 2, 0);
const C = piece('C', 'blank', 4, 0);
const F = (claims: Claims, out: Material | null = null): BoardPiece =>
  ({ ...piece('F', 'plateFact', 3, 0, claims), output: { slots: [out], teleporters: [] } });
const G = (claims: Claims): BoardPiece => piece('G', 'sphereFact', 5, 0, claims);
const beltA: Belt = { id: 'bA', ownerId: 0, pieceId: 'A', fromPoint: 0, toPoint: 7 };
const beltC: Belt = { id: 'bC', ownerId: 0, pieceId: 'C', fromPoint: 0, toPoint: 7 };
const P0: Claims = [{ ownerId: 0, controlModule: 4 }];
const P1: Claims = [{ ownerId: 1, controlModule: 4 }];
// Player 0 with two Control Modules on the building (one owner per building, RULES_CHANGES.md #57).
const P0x2: Claims = [{ ownerId: 0, controlModule: 4 }, { ownerId: 0, controlModule: 5 }];

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
    expect(reached(traces([MINE, A, F(P0x2)], [beltA], 'F', fromMine))).toBe(true);
    expect(reached(traces([MINE, A, F([])], [beltA], 'F', fromMine))).toBe(true);
    expect(reached(traces([MINE, A, F(P1)], [beltA], 'F', fromMine))).toBe(false);
  });

  it('drawing: nothing is drawn leaving a building claimed only by another player through the chain', () => {
    expect(reached(traces([F(P1, 'plate'), C, G(P0)], [beltC], 'G', fromF))).toBe(false);
    expect(reached(traces([F(P0x2, 'plate'), C, G(P0)], [beltC], 'G', fromF))).toBe(true);
    expect(reached(traces([F([], 'plate'), C, G(P0)], [beltC], 'G', fromF))).toBe(false); // an unclaimed building feeds nothing (#58)
  });

  it('agrees with the engine: the display traces a way exactly when the engine moves the material', () => {
    const g = createGame(1, 2);
    const engineMoves = (board: BoardPiece[], belts: Belt[], to: string): boolean =>
      resolveDirectAdjacency({ ...g, board, belts } as GameState).board.find(p => p.id === to)!.input!.slots.some(x => x !== null);
    for (const claims of [P0, P1, P0x2]) {
      const board = [MINE, A, F(claims)];
      expect(reached(traces(board, [beltA], 'F', fromMine))).toBe(engineMoves(board, [beltA], 'F'));
    }
    for (const claims of [P1, P0x2, []]) {
      const board = [F(claims, 'plate'), C, G(P0)];
      expect(reached(traces(board, [beltC], 'G', fromF))).toBe(engineMoves(board, [beltC], 'G'));
    }
  });

  it("direct contact (#51): no way is drawn from another player's output into my input", () => {
    // F's output #8 touches input #1 of a Sphere Factory at (4,0), with no belt.
    const H = (claims: Claims): BoardPiece => piece('H', 'sphereFact', 4, 0, claims);
    const H0: Claims = [{ ownerId: 0, controlModule: 5 }];
    const g = createGame(1, 2);
    const engineMoves = (board: BoardPiece[]): boolean =>
      resolveDirectAdjacency({ ...g, board, belts: [] } as GameState).board.find(p => p.id === 'H')!.input!.slots.some(x => x !== null);
    expect(reached(traces([F(P1, 'plate'), H(H0)], [], 'H', fromF))).toBe(false);
    expect(reached(traces([F(P0, 'plate'), H(H0)], [], 'H', fromF))).toBe(true);
    expect(reached(traces([F(P0x2, 'plate'), H(H0)], [], 'H', fromF))).toBe(true);
    expect(reached(traces([F([], 'plate'), H(H0)], [], 'H', fromF))).toBe(false); // an unclaimed building feeds nothing (#58)
    for (const claims of [P0, P1, P0x2, []]) {
      const board = [F(claims, 'plate'), H(H0)];
      expect(reached(traces(board, [], 'H', fromF)), JSON.stringify(claims)).toBe(engineMoves(board));
    }
    const direct = traceFlow({ board: [F(P0, 'plate'), H(H0)], belts: [] }, 'H', 0, fromF)!;
    expect(direct.belts).toBe(0);
  });

  it('teleporters (#53, #55): nothing is drawn out of a teleported output or into a teleported input', () => {
    const teleOut = (p: BoardPiece): BoardPiece => ({ ...p, output: withTeleporter(p.output!, 0, 0) });
    const teleIn = (p: BoardPiece, slot = 0): BoardPiece => ({ ...p, input: withTeleporter(p.input!, slot, 0) });
    const H0: Claims = [{ ownerId: 0, controlModule: 5 }];
    // Out of F's teleported output: neither direct (Power Plant at (4,0)) nor by belt (G at (5,0)).
    expect(reached(traces([teleOut(F(P0, 'plate')), piece('H', 'powerPlant', 4, 0, H0)], [], 'H', fromF))).toBe(false);
    expect(reached(traces([F(P0, 'plate'), piece('H', 'powerPlant', 4, 0, H0)], [], 'H', fromF))).toBe(true);
    expect(reached(traces([teleOut(F(P0, 'plate')), C, G(P0)], [beltC], 'G', fromF))).toBe(false);
    // Into F's teleported input (one input) from the Mine along belt A.
    expect(reached(traces([MINE, A, teleIn(F(P0))], [beltA], 'F', fromMine))).toBe(false);
    // A Sphere Factory: only the input with the teleporter is cut off (#55), exactly as the engine
    // moves the Plate. At rotation 0 belt C ends at input 1; at rotation 5 at input 2.
    for (const rotation of [0, 5]) {
      for (const slot of [0, 1]) {
        const board = [F(P0, 'plate'), C, { ...teleIn(G(P0), slot), rotation }];
        const drawn = traces(board, [beltC], 'G', fromF);
        const moved = resolveDirectAdjacency({ ...createGame(1, 2), board, belts: [beltC] }).board.find(p => p.id === 'G')!.input!.slots;
        const label = `rotation ${rotation}, teleporter on input ${slot + 1}`;
        moved.forEach((m, i) => expect(drawn[i] !== null, `${label}: input ${i + 1}`).toBe(m !== null));
        // The input facing the belt receives exactly when it is not the teleported one.
        const facing = rotation === 0 ? 0 : 1;
        expect(moved[facing] !== null, label).toBe(facing !== slot);
      }
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
