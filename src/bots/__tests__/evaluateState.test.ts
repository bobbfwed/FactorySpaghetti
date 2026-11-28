import { describe, it, expect } from 'vitest';
import { createGame } from '../../engine/rules/setup';
import { MATERIAL_VALUES } from '../../engine/config';
import { evaluateState, winProgress, inventoryValue, expectedProduction, bufferedOutput, meepleHarvest, claimReserve, powerBalance } from '../evaluateState';
import type { GameState, PlayerId, Material, PieceType, BoardPiece, Buffer } from '../../engine/state';

// B2: the scorer is tested in isolation — nothing chooses moves yet. We start from a
// real createGame() state and override only the fields a feature reads.

const ME: PlayerId = 0;

function withInventory(state: GameState, pid: PlayerId, inv: Partial<Record<Material, number>>): GameState {
  return {
    ...state,
    players: state.players.map(p => (p.id === pid ? { ...p, inventory: { ...p.inventory, ...inv } } : p)),
  };
}

function withInvestorBonus(state: GameState, pid: PlayerId): GameState {
  return {
    ...state,
    players: state.players.map(p =>
      p.id === pid ? { ...p, bonusTesseracts: { investor: true, beltWeaver: false, factoryEmpire: false } } : p,
    ),
  };
}

describe('evaluateState (B2 scorer)', () => {
  const base = createGame(1, 2);

  it('scores a state with 3 Tesseracts higher than one with 1', () => {
    const one   = withInventory(base, ME, { tesseract: 1 });
    const three = withInventory(base, ME, { tesseract: 3 });
    expect(evaluateState(three, ME)).toBeGreaterThan(evaluateState(one, ME));
  });

  it('is deterministic — same state yields the same score every call', () => {
    const s = withInventory(base, ME, { tesseract: 2, plate: 3, sphere: 1 });
    const first = evaluateState(s, ME);
    for (let i = 0; i < 5; i++) expect(evaluateState(s, ME)).toBe(first);
  });

  it('winProgress is convex — the gap from 2→3 Tesseracts exceeds 0→1', () => {
    const wp = (t: number) => winProgress(withInventory(base, ME, { tesseract: t }), ME);
    expect(wp(3) - wp(2)).toBeGreaterThan(wp(1) - wp(0));
  });

  it('winProgress caps at the win target (a 5th Tesseract adds nothing)', () => {
    expect(winProgress(withInventory(base, ME, { tesseract: 5 }), ME))
      .toBe(winProgress(withInventory(base, ME, { tesseract: 4 }), ME));
  });

  it('winProgress counts face-up bonus Tesseracts', () => {
    expect(winProgress(withInvestorBonus(base, ME), ME)).toBeGreaterThan(winProgress(base, ME));
  });

  it('inventoryValue rewards more valuable materials and ignores the opponent', () => {
    const poor = withInventory(base, ME, { ore: 0, plate: 0, sphere: 0, tesseract: 0 });
    const rich = withInventory(poor, ME, { sphere: 2 });
    expect(inventoryValue(rich, ME)).toBeGreaterThan(inventoryValue(poor, ME));
    // Stocking the opponent does not raise my score.
    const oppRich = withInventory(poor, 1, { sphere: 5 });
    expect(evaluateState(oppRich, ME)).toBe(evaluateState(poor, ME));
  });

  it('winProgress dominates inventory value (the win is the priority)', () => {
    const hoard   = withInventory(base, ME, { ore: 6, plate: 6, sphere: 6 });   // lots of fuel, 0 Tesseracts
    const oneTess = withInventory(base, ME, { ore: 0, plate: 0, sphere: 0, tesseract: 1 });
    expect(evaluateState(oneTess, ME)).toBeGreaterThan(evaluateState(hoard, ME));
  });
});

// ── expectedProduction (B4) ───────────────────────────────────────────────────

function claimed(id: string, type: PieceType, module: number | null, owner: PlayerId = ME): BoardPiece {
  return {
    id, type, coord: { q: 0, r: 0 }, rotation: 0,
    claims: module === null ? [] : [{ ownerId: owner, controlModule: module }],
    input: null, output: null,
  };
}

function withBoard(state: GameState, board: BoardPiece[], mineCount: number): GameState {
  return { ...state, board, mineCount };
}

describe('expectedProduction (B4 feature)', () => {
  const base = createGame(1, 2);

  it('is zero with no buildings I own', () => {
    expect(expectedProduction(withBoard(base, [claimed('bk', 'blank', null)], 2), ME)).toBe(0);
  });

  it('is deterministic', () => {
    const s = withBoard(base, [claimed('pf', 'plateFact', 7)], 2);
    const first = expectedProduction(s, ME);
    for (let i = 0; i < 5; i++) expect(expectedProduction(s, ME)).toBe(first);
  });

  it('only rewards modules the dice can actually roll', () => {
    // 1 mine = 1 die: a sum of 3 is possible (P = 1/6); a sum of 10 is impossible.
    expect(expectedProduction(withBoard(base, [claimed('pf', 'plateFact', 3)], 1), ME)).toBeGreaterThan(0);
    expect(expectedProduction(withBoard(base, [claimed('pf', 'plateFact', 10)], 1), ME)).toBe(0);
  });

  it('values higher-output factories more at the same trigger probability', () => {
    // Module 7 is the 2-dice distribution peak for both buildings.
    const plate = withBoard(base, [claimed('p', 'plateFact', 7)], 2);
    const tess  = withBoard(base, [claimed('t', 'tesseractFact', 7)], 2);
    expect(expectedProduction(tess, ME)).toBeGreaterThan(expectedProduction(plate, ME));
  });

  it('favours a module nearer the dice-sum peak over a long-shot module', () => {
    // 2 dice: 7 is the peak (P = 6/36), 12 is the rarest (P = 1/36).
    const peak    = withBoard(base, [claimed('a', 'sphereFact', 7)], 2);
    const longshot = withBoard(base, [claimed('b', 'sphereFact', 12)], 2);
    expect(expectedProduction(peak, ME)).toBeGreaterThan(expectedProduction(longshot, ME));
  });

  it('counts only my claims, not an opponent’s', () => {
    expect(expectedProduction(withBoard(base, [claimed('pf', 'plateFact', 7, 1)], 2), ME)).toBe(0);
  });

  it('multi-claims stack — two trigger numbers beat one', () => {
    const one: BoardPiece = claimed('pf', 'plateFact', 6);
    const two: BoardPiece = { ...one, claims: [{ ownerId: ME, controlModule: 6 }, { ownerId: ME, controlModule: 8 }] };
    expect(expectedProduction(withBoard(base, [two], 2), ME))
      .toBeGreaterThan(expectedProduction(withBoard(base, [one], 2), ME));
  });

  it('claiming a building raises the overall evaluation', () => {
    const without   = withBoard(base, [claimed('pf', 'plateFact', null)], 2);
    const withClaim = withBoard(base, [claimed('pf', 'plateFact', 7)], 2);
    expect(evaluateState(withClaim, ME)).toBeGreaterThan(evaluateState(without, ME));
  });
});

// ── bufferedOutput + meepleHarvest (produce → collect loop) ───────────────────

function buf(slots: Array<Material | null>): Buffer {
  return { slots, teleporters: [] };
}

// A claimed factory with explicit input/output buffers.
function factory(id: string, type: PieceType, input: Buffer | null, output: Buffer | null, owner: PlayerId = ME): BoardPiece {
  return { id, type, coord: { q: 0, r: 0 }, rotation: 0, claims: [{ ownerId: owner, controlModule: 7 }], input, output };
}

function withMeeple(state: GameState, pid: PlayerId, pieceId: string | null, slotIndex: number | null = null): GameState {
  return {
    ...state,
    players: state.players.map(p => (p.id === pid ? { ...p, meepleOnPieceId: pieceId, meepleSlotIndex: slotIndex } : p)),
  };
}

describe('bufferedOutput (B "produce" feature)', () => {
  const base = createGame(1, 2);

  it('counts material in my output buffers and ignores inputs and opponents', () => {
    const mine = withBoard(base, [factory('f', 'plateFact', buf(['ore']), buf(['plate']))], 1);
    expect(bufferedOutput(mine, ME)).toBe(MATERIAL_VALUES.plate); // only the output plate, not the input ore
    const opp = withBoard(base, [factory('f', 'plateFact', buf([null]), buf(['plate']), 1)], 1);
    expect(bufferedOutput(opp, ME)).toBe(0);
  });

  it('is zero with empty output buffers', () => {
    expect(bufferedOutput(withBoard(base, [factory('f', 'plateFact', buf(['ore']), buf([null]))], 1), ME)).toBe(0);
  });
});

describe('meepleHarvest (B "collect" meeple policy)', () => {
  const base = createGame(1, 2);

  it('is zero when no meeple is placed', () => {
    const s = withBoard(base, [factory('f', 'plateFact', buf(['ore']), buf(['plate']))], 1);
    expect(meepleHarvest(s, ME)).toBe(0);
  });

  it('counts existing output plus what the building would produce', () => {
    // meeple on a plate factory with ore loaded (would produce a plate) and a plate already in output.
    const s = withMeeple(withBoard(base, [factory('f', 'plateFact', buf(['ore']), buf(['plate']))], 1), ME, 'f');
    expect(meepleHarvest(s, ME)).toBe(2 * MATERIAL_VALUES.plate); // collect 1 plate + operate→1 plate
  });

  it('steers toward the richer harvest (tesseract factory over plate factory)', () => {
    const onPlate = withMeeple(withBoard(base, [
      factory('pf', 'plateFact', buf(['ore']), buf([null])),
      factory('tf', 'tesseractFact', buf(['ore', 'plate', 'sphere']), buf([null])),
    ], 1), ME, 'pf');
    const onTess = withMeeple(onPlate, ME, 'tf');
    expect(meepleHarvest(onTess, ME)).toBeGreaterThan(meepleHarvest(onPlate, ME));
  });

  it('values a mine resource slot (1st mine → 2 ore)', () => {
    const s = withMeeple(withBoard(base, [factory('m', 'mine', null, null)], 1), ME, 'm', 0);
    expect(meepleHarvest(s, ME)).toBe(2 * 1); // 2 ore × ore value(1)
  });
});

// ── credit-earning: meeple on mine UPGRADE slot banks credits to unlock a claim ──

function withModules2(state: GameState, pid: PlayerId, modules: number[]): GameState {
  return { ...state, players: state.players.map(p => (p.id === pid ? { ...p, controlModules: modules } : p)) };
}

describe('meepleHarvest credit-earning (mine upgrade slot)', () => {
  const base = createGame(1, 2);
  // mineCount 2: floor 2, module 2 claims for 1 credit, upgrade slot grants mineCount+1 = 3.
  const unclaimed = (id: string, type: PieceType): BoardPiece => ({ ...factory(id, type, null, null), claims: [] });

  it('values banking credits at the Tesseract factory it would unlock', () => {
    const board = [factory('m', 'mine', null, null), unclaimed('tf', 'tesseractFact')];
    const st = withMeeple(withModules2(withBoard(base, board, 2), ME, [2, 7]), ME, 'm', 1);
    expect(meepleHarvest(st, ME)).toBe(MATERIAL_VALUES.tesseract);
  });

  it('is capped — zero once I already own a Tesseract factory', () => {
    const board = [
      factory('m', 'mine', null, null),
      { ...factory('owned', 'tesseractFact', null, null), claims: [{ ownerId: ME, controlModule: 5 }] },
      { ...factory('tf', 'tesseractFact', null, null), claims: [] },
    ];
    const st = withMeeple(withModules2(withBoard(base, board, 2), ME, [2, 7]), ME, 'm', 1);
    expect(meepleHarvest(st, ME)).toBe(0);
  });

  it('is zero with no usable module (all below the floor)', () => {
    const board = [factory('m', 'mine', null, null), { ...factory('tf', 'tesseractFact', null, null), claims: [] }];
    const st = withMeeple(withModules2(withBoard(base, board, 2), ME, [1]), ME, 'm', 1); // module 1 < floor 2
    expect(meepleHarvest(st, ME)).toBe(0);
  });

  it('is zero when no Tesseract factory is claimable', () => {
    const board = [factory('m', 'mine', null, null), { ...factory('pf', 'plateFact', null, null), claims: [] }];
    const st = withMeeple(withModules2(withBoard(base, board, 2), ME, [2, 7]), ME, 'm', 1);
    expect(meepleHarvest(st, ME)).toBe(0);
  });
});

describe('meepleHarvest values produce-from-inventory conversions (Stage 3)', () => {
  const base = createGame(1, 2);

  it('values an empty factory I could complete from inventory at the net conversion gain', () => {
    // Meeple on an empty Tesseract factory; inventory holds ore+plate+sphere → it could
    // produce a Tesseract (23) consuming 11, a net gain of 12.
    const board = [factory('tf', 'tesseractFact', buf([null, null, null]), buf([null]))];
    const st = withMeeple(withInventory(withBoard(base, board, 3), ME, { ore: 1, plate: 1, sphere: 1 }), ME, 'tf');
    expect(meepleHarvest(st, ME)).toBe(
      MATERIAL_VALUES.tesseract - (MATERIAL_VALUES.ore + MATERIAL_VALUES.plate + MATERIAL_VALUES.sphere),
    );
  });

  it('is zero when inventory cannot complete the recipe', () => {
    const board = [factory('tf', 'tesseractFact', buf([null, null, null]), buf([null]))];
    const st = withMeeple(withBoard(base, board, 3), ME, 'tf'); // empty inventory
    expect(meepleHarvest(st, ME)).toBe(0);
  });
});

describe('produce → collect is net-positive under the weights', () => {
  const base = createGame(1, 2);

  it('collecting output into inventory scores higher than leaving it buffered', () => {
    // Same plate, once sitting in the (meeple) building's output, once already collected.
    const board = (output: Array<Material | null>) => withBoard(base, [factory('f', 'plateFact', buf([null]), buf(output))], 1);
    const buffered  = withMeeple(board(['plate']), ME, 'f');
    const collected = withInventory(withMeeple(board([null]), ME, 'f'), ME, { plate: 1 });
    expect(evaluateState(collected, ME)).toBeGreaterThan(evaluateState(buffered, ME));
  });
});

// ── claimReserve (Stage 1: claim economy) ─────────────────────────────────────

function withModules(state: GameState, pid: PlayerId, modules: number[]): GameState {
  return { ...state, players: state.players.map(p => (p.id === pid ? { ...p, controlModules: modules } : p)) };
}

describe('claimReserve (cheap-claim capacity)', () => {
  const base = createGame(1, 2);

  it('is deterministic', () => {
    const s = withModules(base, ME, [3, 5, 9]);
    const first = claimReserve(s, ME);
    for (let i = 0; i < 5; i++) expect(claimReserve(s, ME)).toBe(first);
  });

  it('values a cheaper (lower) module more than an expensive one', () => {
    expect(claimReserve(withModules(base, ME, [3]), ME))
      .toBeGreaterThan(claimReserve(withModules(base, ME, [5]), ME));
  });

  it('gives no reserve value to modules below the eventual claim floor or far above it', () => {
    expect(claimReserve(withModules(base, ME, [1, 2]), ME)).toBe(0);   // below MINE_COUNT (3)
    expect(claimReserve(withModules(base, ME, [12, 18]), ME)).toBe(0); // too expensive to claim with late
  });

  it('sums across retained modules — more cheap modules = more capacity', () => {
    expect(claimReserve(withModules(base, ME, [3, 4, 5]), ME))
      .toBeGreaterThan(claimReserve(withModules(base, ME, [3]), ME));
  });

  it('spending a cheap module (fewer retained) lowers the reserve', () => {
    const before = claimReserve(withModules(base, ME, [3, 4, 5]), ME);
    const after  = claimReserve(withModules(base, ME, [4, 5]), ME); // claimed with module 3
    expect(after).toBeLessThan(before);
  });
});

describe('powerBalance (best power plant income)', () => {
  const base = createGame(1, 2);

  it('is deterministic', () => {
    const s = withBoard(base, [claimed('pp', 'powerPlant', 7)], 2);
    const first = powerBalance(s, ME);
    for (let i = 0; i < 5; i++) expect(powerBalance(s, ME)).toBe(first);
  });

  it('rewards a power plant on a hittable module over an unhittable one', () => {
    // 2 dice: 7 is the peak; 13 is impossible (max sum 12) → no income.
    expect(powerBalance(withBoard(base, [claimed('pp', 'powerPlant', 7)], 2), ME))
      .toBeGreaterThan(powerBalance(withBoard(base, [claimed('pp', 'powerPlant', 13)], 2), ME));
    expect(powerBalance(withBoard(base, [claimed('pp', 'powerPlant', 13)], 2), ME)).toBe(0);
  });

  it('counts only the best plant — a second, worse plant adds nothing', () => {
    const one = withBoard(base, [claimed('a', 'powerPlant', 7)], 2);
    const two = withBoard(base, [claimed('a', 'powerPlant', 7), claimed('b', 'powerPlant', 2)], 2);
    expect(powerBalance(two, ME)).toBe(powerBalance(one, ME));
  });

  it('ignores opponent power plants and is zero with none owned', () => {
    expect(powerBalance(withBoard(base, [claimed('pp', 'powerPlant', 7, 1)], 2), ME)).toBe(0);
    expect(powerBalance(withBoard(base, [claimed('pf', 'plateFact', 7)], 2), ME)).toBe(0);
  });
});
