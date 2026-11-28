// A teleporter cuts its buffer off from belts and direct contact (RULES_CHANGES.md #53).
// Output teleporter: material in that output never leaves by a belt or a touching input, also
// when its owner's inventory is full and it waits in the buffer. Input teleporter on a building
// with one input (Plate Factory, Power Plant): nothing arrives there from a Mine, a belt or a
// touching output, in every pass and at every place flow runs. A teleporter sits on one input
// (RULES_CHANGES.md #55): on a Sphere or Tesseract Factory it cuts off, and supplies, only that input.

import { describe, expect, it } from 'vitest';
import { createGame } from '../rules/setup';
import { applyAction, legalActions } from '../reducer';
import { fillInputsFromAdjacentMines, resolveDirectAdjacency, teleporterCutsOff } from '../rules/flow';
import { settleLostClaims } from '../rules/ownership';
import { INVENTORY_CAP } from '../config';
import type { Material } from '../config';
import type { Action } from '../actions';
import { sameMove } from '../actions';
import type { Belt, BoardPiece, GameState, PlayerId } from '../state';
import { expectOk } from './helpers';
import { withTeleporter } from '../rules/teleporters';
import { isListedMove } from '../rules/legalActions';

type Claims = BoardPiece['claims'];

const P0: Claims = [{ ownerId: 0, controlModule: 5 }];
const P0b: Claims = [{ ownerId: 0, controlModule: 6 }];

function piece(id: string, type: BoardPiece['type'], q: number, r: number, claims: Claims = []): BoardPiece {
  const inputs = type === 'plateFact' || type === 'powerPlant' ? 1 : type === 'sphereFact' ? 2 : type === 'tesseractFact' ? 3 : 0;
  const hasOutput = type === 'plateFact' || type === 'sphereFact' || type === 'tesseractFact';
  return {
    id, type, coord: { q, r }, rotation: 0, claims,
    input: inputs ? { slots: new Array(inputs).fill(null), teleporters: [] } : null,
    output: hasOutput || type === 'mine' ? { slots: [null], teleporters: [] } : null,
  };
}
const teleIn = (p: BoardPiece, owner: PlayerId = 0, slot = 0): BoardPiece => ({ ...p, input: withTeleporter(p.input!, slot, owner) });
const teleOut = (p: BoardPiece, owner: PlayerId = 0): BoardPiece => ({ ...p, output: withTeleporter(p.output!, 0, owner) });
const rot = (p: BoardPiece, rotation: number): BoardPiece => ({ ...p, rotation });
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

describe('Sphere and Tesseract Factories: a teleporter sits on one input (#55)', () => {
  // A Sphere Factory's input 1 is engine point 0 and its input 2 is point 2. At rotation 0 input 1
  // faces west (the source in each case below); turned to rotation 5, input 2 faces west instead.
  const G = (q: number, rotation: number, claims: Claims = P0b): BoardPiece => rot(piece('G', 'sphereFact', q, 0, claims), rotation);

  it('the shared predicate: only the teleported input is cut off', () => {
    const g = teleIn(G(4, 0), 0, 0);
    expect(teleporterCutsOff(g, 'input', 0)).toBe(true);
    expect(teleporterCutsOff(g, 'input', 1)).toBe(false);
    expect(teleporterCutsOff(teleIn(G(4, 0), 0, 1), 'input', 1)).toBe(true);
    expect(teleporterCutsOff(teleIn(G(4, 0), 0, 1), 'input', 0)).toBe(false);
  });

  it('a touching output: input 1 with the teleporter gets nothing, input 2 still receives', () => {
    // Input 1 touches F's output.
    const cut = resolveDirectAdjacency(actionsState([F(), teleIn(G(4, 0), 0, 0)]));
    expect(find(cut, 'G').input!.slots).toEqual([null, null]);
    expect(find(cut, 'F').output!.slots).toEqual(['plate']);
    expect(find(resolveDirectAdjacency(actionsState([F(), G(4, 0)])), 'G').input!.slots).toEqual(['plate', null]);
    // Input 2 touches F's output: the teleporter on input 1 does not stop it.
    expect(find(resolveDirectAdjacency(actionsState([F(), G(4, 5)])), 'G').input!.slots).toEqual([null, 'plate']);
    expect(find(resolveDirectAdjacency(actionsState([F(), teleIn(G(4, 5), 0, 0)])), 'G').input!.slots).toEqual([null, 'plate']);
  });

  it('a belt from an output: input 1 with the teleporter gets nothing, input 2 still receives', () => {
    expect(find(resolveDirectAdjacency(actionsState([F(), C, teleIn(G(5, 0), 0, 0)], [beltC])), 'G').input!.slots).toEqual([null, null]);
    expect(find(resolveDirectAdjacency(actionsState([F(), C, G(5, 0)], [beltC])), 'G').input!.slots).toEqual(['plate', null]);
    expect(find(resolveDirectAdjacency(actionsState([F(), C, teleIn(G(5, 5), 0, 0)], [beltC])), 'G').input!.slots).toEqual([null, 'plate']);
  });

  it('a Mine ore exit it touches: input 1 with the teleporter gets nothing, input 2 still receives', () => {
    const g0 = teleIn(G(2, 0, P0), 0, 0);
    expect(find(fillInputsFromAdjacentMines(actionsState([MINE, g0])), 'G').input!.slots).toEqual([null, null]);
    expect(find(resolveDirectAdjacency(actionsState([MINE, g0])), 'G').input!.slots).toEqual([null, null]);
    expect(find(resolveDirectAdjacency(actionsState([MINE, G(2, 0, P0)])), 'G').input!.slots).toEqual(['ore', null]);
    expect(find(resolveDirectAdjacency(actionsState([MINE, G(2, 5, P0)])), 'G').input!.slots).toEqual([null, 'ore']);
    expect(find(resolveDirectAdjacency(actionsState([MINE, teleIn(G(2, 5, P0), 0, 0)])), 'G').input!.slots).toEqual([null, 'ore']);
  });

  it('ore along a belt from a Mine: input 1 with the teleporter gets nothing, input 2 still receives', () => {
    expect(find(resolveDirectAdjacency(actionsState([MINE, A, teleIn(G(3, 0, P0), 0, 0)], [beltA])), 'G').input!.slots).toEqual([null, null]);
    expect(find(resolveDirectAdjacency(actionsState([MINE, A, G(3, 0, P0)], [beltA])), 'G').input!.slots).toEqual(['ore', null]);
    expect(find(resolveDirectAdjacency(actionsState([MINE, A, teleIn(G(3, 5, P0), 0, 0)], [beltA])), 'G').input!.slots).toEqual([null, 'ore']);
  });

  it('material already lying in the teleported input stays and is used', () => {
    const ready = { ...actionsState([withIn(teleIn(G(4, 0), 0, 0), ['plate', 'plate'])]), pendingFactoryOps: [{ pieceId: 'G', ownerId: 0 as PlayerId }] };
    expect(find(resolveDirectAdjacency(ready), 'G').input!.slots).toEqual(['plate', 'plate']);
    const ran = expectOk(applyAction(ready, { type: 'OPERATE_BUILDING', pieceId: 'G', ownerId: 0 }));
    expect(find(ran, 'G').output!.slots).toEqual(['sphere']);
  });
});

describe('supplying a factory with some inputs teleported (#55)', () => {
  // Sphere Factory G (module 5) of player 0, with player 0's teleporter on input 1 only.
  const G = (slots: Array<Material | null>, claims: Claims = P0): BoardPiece => withIn(teleIn(piece('G', 'sphereFact', 4, 0, claims), 0, 0), slots);
  const rich = (s: GameState): GameState => ({
    ...s, players: s.players.map(p => ({ ...p, powerTokens: 5, inventory: { ore: 2, plate: 2, sphere: 0, tesseract: 0 } })),
  });
  const rolled = (board: BoardPiece[]): GameState =>
    expectOk(applyAction({ ...rich(actionsState(board)), phase: 'roll' as const }, { type: 'ROLL_DICE', rolls: [5] }));

  it('the supply fills only the teleported input; the other input must hold its material', () => {
    // Input 2 holds a Plate (it arrived by belt): the owner names one material for input 1.
    const s = rolled([G([null, 'plate'])]);
    expect(s.pendingFactoryOps).toEqual([{ pieceId: 'G', ownerId: 0 }]);
    const runs = legalActions(s, 0).filter(a => a.type === 'OPERATE_BUILDING');
    expect(runs.map(a => (a.type === 'OPERATE_BUILDING' ? a.supply : null))).toEqual([['ore'], ['plate']]);
    const ran = expectOk(applyAction(s, { type: 'OPERATE_BUILDING', pieceId: 'G', ownerId: 0, supply: ['ore'] }));
    expect(find(ran, 'G').output!.slots).toEqual(['sphere']);
    expect(ran.players[0]!.inventory.ore).toBe(1);
    // Two materials (as if the teleporter covered both inputs) are refused.
    const two = applyAction(s, { type: 'OPERATE_BUILDING', pieceId: 'G', ownerId: 0, supply: ['ore', 'plate'] });
    expect(two.ok).toBe(false);
    if (!two.ok) expect(two.error.code).toBe('INVALID_SUPPLY');
  });

  it('with the input without a teleporter still empty, the factory cannot run: no decision on the roll', () => {
    const s = rolled([G([null, null])]);
    expect(s.pendingFactoryOps).toEqual([]);
    const ready = { ...rich(actionsState([G([null, null])])), pendingFactoryOps: [{ pieceId: 'G', ownerId: 0 as PlayerId }] };
    const r = applyAction(ready, { type: 'OPERATE_BUILDING', pieceId: 'G', ownerId: 0, supply: ['ore'] });
    expect(r.ok).toBe(false);
  });

  it('when only the input without a teleporter is empty, nothing can be supplied there either', () => {
    // Input 1 (teleported) holds a Plate, input 2 is empty: the owner's teleporter has nothing to fill.
    const s = rolled([G(['plate', null])]);
    expect(s.pendingFactoryOps).toEqual([]);
  });

  it('a teleporter on every input supplies them all, as a whole-input teleporter did before', () => {
    const both = withIn(teleIn(teleIn(piece('G', 'sphereFact', 4, 0, P0), 0, 0), 0, 1), [null, null]);
    const s = rolled([both]);
    expect(s.pendingFactoryOps).toEqual([{ pieceId: 'G', ownerId: 0 }]);
    const runs = legalActions(s, 0).filter(a => a.type === 'OPERATE_BUILDING').map(a => (a.type === 'OPERATE_BUILDING' ? a.supply : null));
    expect(runs).toEqual([['ore', 'plate'], ['plate', 'plate']]);
    // And it receives nothing by itself: not from a touching output.
    expect(find(resolveDirectAdjacency(actionsState([F(), both])), 'G').input!.slots).toEqual([null, null]);
    // A Tesseract Factory with a teleporter on all three inputs likewise takes three materials.
    let t = piece('T', 'tesseractFact', 4, 0, P0);
    for (const i of [0, 1, 2]) t = teleIn(t, 0, i);
    const st = expectOk(applyAction({
      ...actionsState([t]), phase: 'roll' as const,
      players: actionsState([t]).players.map(p => ({ ...p, powerTokens: 5, inventory: { ore: 0, plate: 1, sphere: 2, tesseract: 0 } })),
    }, { type: 'ROLL_DICE', rolls: [5] }));
    const tRuns = legalActions(st, 0).filter(a => a.type === 'OPERATE_BUILDING').map(a => (a.type === 'OPERATE_BUILDING' ? a.supply : null));
    expect(tRuns.length).toBeGreaterThan(0);
    expect(tRuns.every(sup => sup?.length === 3)).toBe(true);
  });

  it('the owner supplies only the input with their teleporter; the other input must hold its material', () => {
    // Player 0 owns the Sphere Factory (one owner per building, #57) with a teleporter on input 1.
    const own = withIn(teleIn(piece('G', 'sphereFact', 4, 0, [{ ownerId: 0, controlModule: 5 }]), 0, 0), [null, null]);
    const s = rolled([own]);
    // Input 2 is empty and has no teleporter: it cannot be filled from the inventory, so no run.
    expect(s.pendingFactoryOps).toEqual([]);
    // With input 2 holding a Plate, player 0 supplies input 1 alone.
    const s2 = rolled([withIn(own, [null, 'plate'])]);
    expect(s2.pendingFactoryOps).toEqual([{ pieceId: 'G', ownerId: 0 }]);
    expect(legalActions(s2, 0).filter(a => a.type === 'OPERATE_BUILDING').every(a => a.type === 'OPERATE_BUILDING' && a.supply?.length === 1)).toBe(true);
  });
});

describe('placing teleporters on inputs (#55)', () => {
  const rich = (s: GameState, ore = 6): GameState =>
    ({ ...s, players: s.players.map(p => (p.id === 0 ? { ...p, inventory: { ore, plate: 0, sphere: 0, tesseract: 0 } } : p)) });
  const T = (): BoardPiece => piece('T', 'tesseractFact', 4, 0, P0);
  const listed = (s: GameState): string[] => legalActions(s, 0)
    .filter(a => a.type === 'PLACE_TELEPORTER')
    .map(a => (a.type === 'PLACE_TELEPORTER' ? `${a.pieceId}:${a.bufferType}${a.inputIndex === undefined ? '' : a.inputIndex}` : ''));

  it('legalActions lists each free input of an own building, by its index, and the output', () => {
    expect(listed(rich(actionsState([T()])))).toEqual(['T:input0', 'T:input1', 'T:input2', 'T:output']);
    expect(listed(rich(actionsState([teleIn(T(), 0, 1)])))).toEqual(['T:input0', 'T:input2', 'T:output']);
    // Every input and the output taken (by the owner: another player's teleporter is never on it, #57).
    expect(listed(rich(actionsState([teleOut(teleIn(teleIn(teleIn(T(), 0, 0), 0, 1), 0, 2))])))).toEqual([]);
    // A Plate Factory has one input: it is input 0.
    expect(listed(rich(actionsState([piece('P', 'plateFact', 4, 0, P0)])))).toEqual(['P:input0', 'P:output']);
  });

  it('one teleporter per input: each input may get one, a second on the same input is refused', () => {
    const s0 = rich(actionsState([T()]), 20);
    const s1 = expectOk(applyAction(s0, { type: 'PLACE_TELEPORTER', pieceId: 'T', bufferType: 'input', inputIndex: 2 }));
    expect(find(s1, 'T').input!.teleporters).toEqual([null, null, 0]);
    const again = applyAction(s1, { type: 'PLACE_TELEPORTER', pieceId: 'T', bufferType: 'input', inputIndex: 2 });
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.error.code).toBe('BUFFER_OCCUPIED');
    const s2 = expectOk(applyAction(s1, { type: 'PLACE_TELEPORTER', pieceId: 'T', bufferType: 'input', inputIndex: 0 }));
    expect(find(s2, 'T').input!.teleporters).toEqual([0, null, 0]);
    const none = applyAction(s2, { type: 'PLACE_TELEPORTER', pieceId: 'T', bufferType: 'input', inputIndex: 3 });
    expect(none.ok).toBe(false);
    if (!none.ok) expect(none.error.code).toBe('NO_SUCH_INPUT');
  });

  it('each one is one of the 4 teleporters and pays the rising price (teleporters on the board + 1)', () => {
    let s = rich(actionsState([T()]), 20);
    const spots = [{ inputIndex: 0 }, { inputIndex: 1 }, { inputIndex: 2 }].map(x => ({ bufferType: 'input' as const, ...x }));
    let paid = 0;
    for (const [n, spot] of [...spots, { bufferType: 'output' as const }].entries()) {
      const before = s.players[0]!.inventory.ore;
      s = expectOk(applyAction(s, { type: 'PLACE_TELEPORTER', pieceId: 'T', ...spot }));
      expect(before - s.players[0]!.inventory.ore).toBe(n + 1);
      paid += n + 1;
      expect(s.globalTeleporterCount).toBe(n + 1);
      expect(s.players[0]!.teleportersRemaining).toBe(3 - n);
    }
    expect(paid).toBe(1 + 2 + 3 + 4);
    // No fifth: none left (and no free spot either on another building).
    const s5 = { ...s, board: [...s.board, piece('P', 'plateFact', 6, 0, P0)] };
    const fifth = applyAction(s5, { type: 'PLACE_TELEPORTER', pieceId: 'P', bufferType: 'input', inputIndex: 0 });
    expect(fifth.ok).toBe(false);
    if (!fifth.ok) expect(fifth.error.code).toBe('NO_TELEPORTERS');
  });

  it('a move that names only the input (from before #55) means the first input', () => {
    const s = rich(actionsState([T()]));
    const old: Action = { type: 'PLACE_TELEPORTER', pieceId: 'T', bufferType: 'input' };
    expect(legalActions(s, 0).some(l => sameMove(l, old))).toBe(true);
    expect(find(expectOk(applyAction(s, old)), 'T').input!.teleporters).toEqual([0]);
  });

  it('the engine accepts a teleporter move exactly when it is listed: an input given as null or not a whole number is neither', () => {
    const s = { ...rich(actionsState([T()])), players: rich(actionsState([T()])).players.map(p => (p.id === 0 ? { ...p, hand: ['rdTaxWriteOff' as const] } : p)) };
    const odd = [null, 1.5, -1, 3, '1'] as unknown as number[];
    const moves: Action[] = [
      ...odd.map(inputIndex => ({ type: 'PLACE_TELEPORTER', pieceId: 'T', bufferType: 'input', inputIndex }) as Action),
      ...odd.map(inputIndex => ({ type: 'PLAY_CARD', cardType: 'rdTaxWriteOff', pieceId: 'T', bufferType: 'input', inputIndex }) as Action),
      { type: 'PLACE_TELEPORTER', pieceId: 'T', bufferType: 'input' },
      { type: 'PLACE_TELEPORTER', pieceId: 'T', bufferType: 'input', inputIndex: 2 },
      { type: 'PLACE_TELEPORTER', pieceId: 'T', bufferType: 'output', inputIndex: 7 },
      { type: 'PLAY_CARD', cardType: 'rdTaxWriteOff', pieceId: 'T', bufferType: 'input' },
    ];
    for (const a of moves) {
      const label = JSON.stringify(a);
      expect(applyAction(s, a).ok, label).toBe(isListedMove(s, 0, a));
    }
    expect(applyAction(s, moves[0]!).ok).toBe(false); // null is not input 1
  });

  it('R&D Tax Write-Off places its free teleporter on the input it names', () => {
    const s = { ...actionsState([T()]), players: actionsState([T()]).players.map(p => (p.id === 0 ? { ...p, hand: ['rdTaxWriteOff' as const] } : p)) };
    const plays = legalActions(s, 0).filter(a => a.type === 'PLAY_CARD' && a.cardType === 'rdTaxWriteOff');
    expect(plays.map(a => (a.type === 'PLAY_CARD' ? `${a.bufferType}${a.inputIndex ?? ''}` : ''))).toEqual(['input0', 'input1', 'input2', 'output']);
    const after = expectOk(applyAction(s, { type: 'PLAY_CARD', cardType: 'rdTaxWriteOff', pieceId: 'T', bufferType: 'input', inputIndex: 1 }));
    expect(find(after, 'T').input!.teleporters).toEqual([null, 0]);
    expect(after.globalTeleporterCount).toBe(1);
  });

  it('every teleporter of a player who loses their last claim returns: each input and the output', () => {
    // Player 0 owns the Tesseract Factory and has teleporters on inputs 1 and 3 and the output.
    const own: Claims = [{ ownerId: 0, controlModule: 5 }];
    const t = teleOut(teleIn(teleIn(piece('T', 'tesseractFact', 4, 0, own), 0, 0), 0, 2));
    const s = { ...actionsState([t]), globalTeleporterCount: 3, players: actionsState([t]).players.map(p => ({ ...p, teleportersRemaining: p.id === 0 ? 1 : 4 })) };
    const lost = { ...s, board: [{ ...t, claims: [] }] };
    const after = settleLostClaims(lost);
    expect(find(after, 'T').input!.teleporters).toEqual([]);
    expect(find(after, 'T').output!.teleporters).toEqual([]);
    expect(after.players[0]!.teleportersRemaining).toBe(4);
    expect(after.players[1]!.teleportersRemaining).toBe(4);
    expect(after.globalTeleporterCount).toBe(0);
    expect(settleLostClaims(s)).toBe(s); // nothing lost: the same state
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
