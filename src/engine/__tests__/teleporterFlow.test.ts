// A teleporter cuts its buffer off from belts and direct contact (RULES_CHANGES.md #53).
// Output teleporter: material in that output never leaves by a belt or a touching input, also
// when its owner's inventory is full and it waits in the buffer. Input teleporter on a building
// with one input (Plate Factory, Power Plant): nothing arrives there from a Mine, a belt or a
// touching output, in every pass and at every place flow runs. Sphere and Tesseract Factories
// keep today's behaviour until the designer decides how a teleporter covers one of several inputs.

import { describe, expect, it } from 'vitest';
import { createGame } from '../rules/setup';
import { applyAction, legalActions } from '../reducer';
import { fillInputsFromAdjacentMines, resolveDirectAdjacency, teleporterCutsOff } from '../rules/flow';
import { INVENTORY_CAP } from '../config';
import type { Material } from '../config';
import type { Action } from '../actions';
import { sameMove } from '../actions';
import type { Belt, BoardPiece, GameState, PlayerId } from '../state';
import { expectOk } from './helpers';

type Claims = BoardPiece['claims'];

const P0: Claims = [{ ownerId: 0, controlModule: 5 }];
const P0b: Claims = [{ ownerId: 0, controlModule: 6 }];

function piece(id: string, type: BoardPiece['type'], q: number, r: number, claims: Claims = []): BoardPiece {
  const inputs = type === 'plateFact' || type === 'powerPlant' ? 1 : type === 'sphereFact' ? 2 : type === 'tesseractFact' ? 3 : 0;
  const hasOutput = type === 'plateFact' || type === 'sphereFact' || type === 'tesseractFact';
  return {
    id, type, coord: { q, r }, rotation: 0, claims,
    input: inputs ? { slots: new Array(inputs).fill(null), teleporterOwner: null } : null,
    output: hasOutput || type === 'mine' ? { slots: [null], teleporterOwner: null } : null,
  };
}
const teleIn = (p: BoardPiece, owner: PlayerId | null = 0): BoardPiece => ({ ...p, input: { ...p.input!, teleporterOwner: owner } });
const teleOut = (p: BoardPiece, owner: PlayerId | null = 0): BoardPiece => ({ ...p, output: { ...p.output!, teleporterOwner: owner } });
const withOut = (p: BoardPiece, m: Material | null): BoardPiece => ({ ...p, output: { ...p.output!, slots: [m] } });
const withIn = (p: BoardPiece, slots: Array<Material | null>): BoardPiece => ({ ...p, input: { ...p.input!, slots } });

// Geometry (rotation 0 everywhere):
//  • Mine 1 at (0,0), lean hex at (1,0). A building at (2,0) has its input #1 facing a lean-hex
//    ore exit; blank A at (2,0): belt 0→7 runs from that exit to the input of a building at (3,0).
//  • Plate Factory F at (3,0): output #8 touches input #1 of a building at (4,0); blank C at
//    (4,0): belt 0→7 runs from F's output to input #1 of a building at (5,0).
const MINE = piece('mine-1', 'mine', 0, 0);
const A = piece('A', 'blank', 2, 0);
const C = piece('C', 'blank', 4, 0);
const beltA: Belt = { id: 'bA', ownerId: 0, pieceId: 'A', fromPoint: 0, toPoint: 7 };
const beltC: Belt = { id: 'bC', ownerId: 0, pieceId: 'C', fromPoint: 0, toPoint: 7 };
const F = (): BoardPiece => withOut(piece('F', 'plateFact', 3, 0, P0), 'plate');

function actionsState(board: BoardPiece[], belts: Belt[] = [], plates = 0): GameState {
  const g = createGame(1, 2);
  return {
    ...g, board, belts, turnOrder: [0, 1], activePlayerIndex: 0, phase: 'actions', pendingFactoryOps: [],
    players: g.players.map(p => ({ ...p, beltsRemaining: 10, inventory: { ...p.inventory, plate: p.id === 0 ? plates : 0 } })),
  };
}
const find = (s: GameState, id: string): BoardPiece => s.board.find(p => p.id === id)!;

describe('an output teleporter: its material never leaves by a belt or a touching input', () => {
  it('normally it drains to the owner first (unchanged)', () => {
    const s = resolveDirectAdjacency(actionsState([teleOut(F()), piece('G', 'sphereFact', 4, 0, P0b)]));
    expect(find(s, 'F').output!.slots).toEqual([null]);
    expect(find(s, 'G').input!.slots).toEqual([null, null]);
    expect(s.players[0]!.inventory.plate).toBe(1);
  });

  it('with the inventory full it stays in the output: not passed to a touching input', () => {
    const board = [teleOut(F()), piece('G', 'sphereFact', 4, 0, P0b)];
    const s = resolveDirectAdjacency(actionsState(board, [], INVENTORY_CAP));
    expect(find(s, 'F').output!.slots).toEqual(['plate']);
    expect(find(s, 'G').input!.slots).toEqual([null, null]);
    expect(s.players[0]!.inventory.plate).toBe(INVENTORY_CAP);
    // Without the teleporter the same Plate moves on (the geometry is right).
    const open = resolveDirectAdjacency(actionsState([F(), piece('G', 'sphereFact', 4, 0, P0b)]));
    expect(find(open, 'G').input!.slots).toContain('plate');
  });

  it('with the inventory full it stays in the output: not carried by a belt', () => {
    const board = [teleOut(F()), C, piece('G', 'sphereFact', 5, 0, P0b)];
    const s = resolveDirectAdjacency(actionsState(board, [beltC], INVENTORY_CAP));
    expect(find(s, 'F').output!.slots).toEqual(['plate']);
    expect(find(s, 'G').input!.slots).toEqual([null, null]);
    const open = resolveDirectAdjacency(actionsState([F(), C, piece('G', 'sphereFact', 5, 0, P0b)], [beltC]));
    expect(find(open, 'G').input!.slots).toContain('plate');
  });

  it('it is drained as soon as the owner has room again', () => {
    const full = actionsState([teleOut(F()), C, piece('G', 'sphereFact', 5, 0, P0b)], [beltC], INVENTORY_CAP);
    const room = { ...full, players: full.players.map(p => (p.id === 0 ? { ...p, inventory: { ...p.inventory, plate: 2 } } : p)) };
    const s = resolveDirectAdjacency(room);
    expect(find(s, 'F').output!.slots).toEqual([null]);
    expect(s.players[0]!.inventory.plate).toBe(3);
    expect(find(s, 'G').input!.slots).toEqual([null, null]);
  });

  it('the shared predicate: an output with a teleporter is cut off, one without is not', () => {
    expect(teleporterCutsOff(teleOut(F()), 'output')).toBe(true);
    expect(teleporterCutsOff(F(), 'output')).toBe(false);
  });
});

describe('an input teleporter on a building with one input: nothing arrives there by itself', () => {
  const M = (type: 'plateFact' | 'powerPlant'): BoardPiece => piece('M', type, 2, 0, P0); // input faces the Mine
  const at3 = (type: 'plateFact' | 'powerPlant'): BoardPiece => piece('T', type, 3, 0, P0); // input at the end of belt A
  const at4 = (): BoardPiece => piece('T', 'powerPlant', 4, 0, P0b); // input touches F's output
  const at5 = (): BoardPiece => piece('T', 'powerPlant', 5, 0, P0b); // input at the end of belt C

  for (const type of ['plateFact', 'powerPlant'] as const) {
    it(`${type}: no Ore from a Mine it touches (fillInputsFromAdjacentMines and the full flow)`, () => {
      expect(find(fillInputsFromAdjacentMines(actionsState([MINE, teleIn(M(type))])), 'M').input!.slots).toEqual([null]);
      expect(find(resolveDirectAdjacency(actionsState([MINE, teleIn(M(type))])), 'M').input!.slots).toEqual([null]);
      expect(find(resolveDirectAdjacency(actionsState([MINE, M(type)])), 'M').input!.slots).toEqual(['ore']);
    });

    it(`${type}: no Ore along a belt from a Mine`, () => {
      expect(find(resolveDirectAdjacency(actionsState([MINE, A, teleIn(at3(type))], [beltA])), 'T').input!.slots).toEqual([null]);
      expect(find(resolveDirectAdjacency(actionsState([MINE, A, at3(type)], [beltA])), 'T').input!.slots).toEqual(['ore']);
    });
  }

  it('Power Plant: no Plate from a touching output, nor along a belt from an output', () => {
    const direct = resolveDirectAdjacency(actionsState([F(), teleIn(at4())]));
    expect(find(direct, 'T').input!.slots).toEqual([null]);
    expect(find(direct, 'F').output!.slots).toEqual(['plate']);
    expect(find(resolveDirectAdjacency(actionsState([F(), at4()])), 'T').input!.slots).toEqual(['plate']);
    const belted = resolveDirectAdjacency(actionsState([F(), C, teleIn(at5())], [beltC]));
    expect(find(belted, 'T').input!.slots).toEqual([null]);
    expect(find(belted, 'F').output!.slots).toEqual(['plate']);
    expect(find(resolveDirectAdjacency(actionsState([F(), C, at5()], [beltC])), 'T').input!.slots).toEqual(['plate']);
  });

  it('material already lying in the input when the teleporter was placed stays and is used', () => {
    const s = resolveDirectAdjacency(actionsState([MINE, withIn(teleIn(M('plateFact')), ['ore'])]));
    expect(find(s, 'M').input!.slots).toEqual(['ore']);
  });

  it('at every place flow runs: the roll (before and after production), Done with actions, running the building', () => {
    // Roll: M is not activated (module 5, roll 4); before the fix both flows filled it with Ore.
    const roll = { ...actionsState([MINE, teleIn(M('plateFact'))]), phase: 'roll' as const };
    const rolled = expectOk(applyAction(roll, { type: 'ROLL_DICE', rolls: [4] }));
    expect(find(rolled, 'M').input!.slots).toEqual([null]);
    // Done with actions.
    const ended = expectOk(applyAction(actionsState([MINE, teleIn(M('plateFact'))]), { type: 'END_ACTIONS' }));
    expect(find(ended, 'M').input!.slots).toEqual([null]);
    // Running it from what lies in its input: the Mine does not refill it afterwards.
    const ready = { ...actionsState([MINE, withIn(teleIn(M('plateFact')), ['ore'])]), pendingFactoryOps: [{ pieceId: 'M', ownerId: 0 as PlayerId }] };
    const ran = expectOk(applyAction(ready, { type: 'OPERATE_BUILDING', pieceId: 'M', ownerId: 0 }));
    expect(find(ran, 'M').output!.slots).toEqual(['plate']);
    expect(find(ran, 'M').input!.slots).toEqual([null]);
    // The same without a teleporter is refilled at once (the geometry is right).
    const plain = { ...actionsState([MINE, withIn(M('plateFact'), ['ore'])]), pendingFactoryOps: [{ pieceId: 'M', ownerId: 0 as PlayerId }] };
    expect(find(expectOk(applyAction(plain, { type: 'OPERATE_BUILDING', pieceId: 'M', ownerId: 0 })), 'M').input!.slots).toEqual(['ore']);
  });

  it('a Power Plant fed this way is a decision on its roll: its owner supplies through the teleporter', () => {
    const roll = { ...actionsState([MINE, teleIn(piece('M', 'powerPlant', 2, 0, [{ ownerId: 0, controlModule: 4 }]))]), phase: 'roll' as const };
    const rolled = expectOk(applyAction(roll, { type: 'ROLL_DICE', rolls: [4] }));
    expect(rolled.pendingFactoryOps).toEqual([{ pieceId: 'M', ownerId: 0 }]);
    expect(find(rolled, 'M').input!.slots).toEqual([null]);
  });
});

describe('Sphere and Tesseract Factories: the teleporter covers the whole input (open decision)', () => {
  // The state holds one teleporter per input buffer, not per input point, so "it blocks only the
  // input it is placed on" cannot be expressed yet. Until the designer decides, a teleporter on
  // a building with several inputs cuts off nothing: every input still receives as before.
  it('a Sphere Factory with an input teleporter still receives on its inputs', () => {
    const G = teleIn(piece('G', 'sphereFact', 4, 0, P0b));
    expect(teleporterCutsOff(G, 'input')).toBe(false);
    expect(find(resolveDirectAdjacency(actionsState([F(), G])), 'G').input!.slots).toContain('plate');
  });

  it('PLACE_TELEPORTER names the whole input buffer, not one input point', () => {
    const s = actionsState([F(), piece('G', 'sphereFact', 4, 0, P0b)]);
    const s2 = { ...s, players: s.players.map(p => (p.id === 0 ? { ...p, inventory: { ore: 6, plate: 0, sphere: 0, tesseract: 0 } } : p)) };
    const a: Action = { type: 'PLACE_TELEPORTER', pieceId: 'G', bufferType: 'input' };
    expect(legalActions(s2, 0).some(l => sameMove(l, a))).toBe(true);
    const placed = expectOk(applyAction(s2, a));
    expect(find(placed, 'G').input).toEqual({ slots: [null, null], teleporterOwner: 0 });
  });
});

describe('belts at a teleported buffer', () => {
  it('a belt may still be laid facing a teleported input or output, and carries nothing there', () => {
    // Facing F's teleported output (C point 0), with a full inventory so the Plate waits.
    const s = actionsState([teleOut(F()), C, piece('G', 'sphereFact', 5, 0, P0b)], [], INVENTORY_CAP);
    const laid = expectOk(applyAction(s, { type: 'PLACE_BELT', pieceId: 'C', fromPoint: 0, toPoint: 7 }));
    const flowed = expectOk(applyAction(laid, { type: 'END_ACTIONS' }));
    expect(find(flowed, 'F').output!.slots).toEqual(['plate']);
    expect(find(flowed, 'G').input!.slots).toEqual([null, null]);
    // Facing a Plate Factory's teleported input from the Mine (A point 7).
    const t = actionsState([MINE, A, teleIn(piece('T', 'plateFact', 3, 0, P0))]);
    const laidT = expectOk(applyAction(t, { type: 'PLACE_BELT', pieceId: 'A', fromPoint: 0, toPoint: 7 }));
    expect(find(expectOk(applyAction(laidT, { type: 'END_ACTIONS' })), 'T').input!.slots).toEqual([null]);
  });

  it('a belt laid before the teleporter is cut off once it is placed', () => {
    const board = [MINE, A, piece('T', 'plateFact', 3, 0, P0)];
    const s = actionsState(board, [beltA]);
    const rich = { ...s, players: s.players.map(p => (p.id === 0 ? { ...p, inventory: { ore: 6, plate: 0, sphere: 0, tesseract: 0 } } : p)) };
    const placed = expectOk(applyAction(rich, { type: 'PLACE_TELEPORTER', pieceId: 'T', bufferType: 'input' }));
    expect(placed.belts).toEqual([beltA]); // the belt stays
    expect(find(expectOk(applyAction(placed, { type: 'END_ACTIONS' })), 'T').input!.slots).toEqual([null]);
  });
});
