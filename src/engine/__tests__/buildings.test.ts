import { describe, it, expect } from 'vitest';
import { createGame } from '../rules/setup';
import { applyAction } from '../reducer';
import type { GameState, BoardPiece, Player } from '../state';
import { firstLegal } from './helpers';

// ── Test helpers ──────────────────────────────────────────────────────────────

function makePiece(overrides: Partial<BoardPiece> & Pick<BoardPiece, 'type' | 'id'>): BoardPiece {
  const type = overrides.type;
  const inputSlots = type === 'plateFact' ? 1 : type === 'sphereFact' ? 2 : type === 'tesseractFact' ? 3 : type === 'powerPlant' ? 1 : 0;
  const hasOutput = type !== 'powerPlant' && type !== 'blank' && type !== 'mine';
  return {
    id: overrides.id,
    type,
    coord: overrides.coord ?? { q: 1, r: 0 },
    claims: overrides.claims ?? [],
    input: overrides.input ?? (inputSlots > 0 ? { slots: new Array(inputSlots).fill(null), teleporters: [] } : null),
    output: overrides.output ?? (hasOutput ? { slots: [null], teleporters: [] } : null),
  };
}

// Build a minimal actions-phase state with Player 0 active. Force the turn order so the
// fixture is independent of the seed-derived starting player (which shifts when the stack
// composition changes).
function actionsState(overrides: Partial<GameState> = {}): GameState {
  const base = createGame(1, 2);
  return {
    ...base,
    turnOrder: [0, 1],
    activePlayerIndex: 0,
    phase: 'actions',
    ...overrides,
  };
}

// ── CLAIM_BUILDING ────────────────────────────────────────────────────────────

// A claim in the actions phase is paid from a Production Increase budget (a claim paid by
// nothing is refused: UNFUNDED_CLAIM, RULES_CHANGES.md #43). A budget large enough for any
// module, so these cases test the other claim rules.
function piState(overrides: Partial<GameState> = {}): GameState {
  return actionsState({ productionIncreaseBudget: 20, ...overrides });
}

describe('CLAIM_BUILDING', () => {
  it('places a module, removes module from hand, does not deduct ore', () => {
    const piece = makePiece({ id: 'pf-1', type: 'plateFact' });
    const state = piState({
      board: [createGame(1, 2).board[0]!, piece],
      players: createGame(1, 2).players.map((p, i): Player =>
        i === 0 ? { ...p, inventory: { ...p.inventory, ore: 5 } } : p,
      ) as ReadonlyArray<Player>,
    });

    const res = applyAction(state, { type: 'CLAIM_BUILDING', pieceId: 'pf-1', controlModule: 3, fromProductionIncrease: true });
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const outPiece = res.state.board.find(p => p.id === 'pf-1')!;
    expect(outPiece.claims).toHaveLength(1);
    expect(outPiece.claims[0]?.ownerId).toBe(0);
    expect(outPiece.claims[0]?.controlModule).toBe(3);
    // Claiming costs no ore — ore is unchanged
    expect(res.state.players[0]?.inventory.ore).toBe(5);
    // Module 3 removed from hand (the CM itself is spent)
    expect(res.state.players[0]?.controlModules).not.toContain(3);
  });

  it("rejects module below claim floor ('1' retired at 2 mines)", () => {
    const piece = makePiece({ id: 'pf-floor', type: 'plateFact' });
    const state = piState({
      board: [createGame(1, 2).board[0]!, piece],
      mineCount: 2, // floor = 2
      players: createGame(1, 2).players.map((p, i): Player =>
        i === 0 ? { ...p, inventory: { ...p.inventory, ore: 5 } } : p,
      ) as ReadonlyArray<Player>,
    });

    const res = applyAction(state, { type: 'CLAIM_BUILDING', pieceId: 'pf-floor', controlModule: 1, fromProductionIncrease: true });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe('CLAIM_FLOOR_VIOLATION');
  });

  it('allows up to 3 claims by the same player', () => {
    const piece = makePiece({
      id: 'pf-multi',
      type: 'plateFact',
      claims: [
        { ownerId: 0, controlModule: 2 },
        { ownerId: 0, controlModule: 4 },
      ],
    });
    const state = piState({
      board: [createGame(1, 2).board[0]!, piece],
      players: createGame(1, 2).players.map((p, i): Player =>
        i === 0
          ? { ...p, inventory: { ...p.inventory, ore: 6 }, controlModules: p.controlModules.filter(m => m !== 2 && m !== 4) }
          : p,
      ) as ReadonlyArray<Player>,
    });

    const res = applyAction(state, { type: 'CLAIM_BUILDING', pieceId: 'pf-multi', controlModule: 6, fromProductionIncrease: true });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.state.board.find(p => p.id === 'pf-multi')!.claims).toHaveLength(3);
  });

  it('rejects a 4th claim by the same player', () => {
    const piece = makePiece({
      id: 'pf-full',
      type: 'plateFact',
      claims: [
        { ownerId: 0, controlModule: 2 },
        { ownerId: 0, controlModule: 4 },
        { ownerId: 0, controlModule: 6 },
      ],
    });
    const state = piState({
      board: [createGame(1, 2).board[0]!, piece],
      players: createGame(1, 2).players.map((p, i): Player =>
        i === 0
          ? { ...p, inventory: { ...p.inventory, ore: 8 }, controlModules: p.controlModules.filter(m => m !== 2 && m !== 4 && m !== 6) }
          : p,
      ) as ReadonlyArray<Player>,
    });

    const res = applyAction(state, { type: 'CLAIM_BUILDING', pieceId: 'pf-full', controlModule: 8, fromProductionIncrease: true });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe('TOO_MANY_CLAIMS');
  });

  it('rejects when module is not in the player hand', () => {
    const piece = makePiece({ id: 'pf-no-module', type: 'plateFact' });
    const state = piState({
      board: [createGame(1, 2).board[0]!, piece],
      players: createGame(1, 2).players.map((p, i): Player =>
        i === 0 ? { ...p, controlModules: p.controlModules.filter(m => m !== 3) } : p,
      ) as ReadonlyArray<Player>,
    });

    const res = applyAction(state, { type: 'CLAIM_BUILDING', pieceId: 'pf-no-module', controlModule: 3, fromProductionIncrease: true });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe('MODULE_NOT_AVAILABLE');
  });

  it('rejects claiming a blank piece', () => {
    const blank = makePiece({ id: 'blank-nc', type: 'blank' });
    const state = piState({
      board: [createGame(1, 2).board[0]!, blank],
      players: createGame(1, 2).players.map((p, i): Player =>
        i === 0 ? { ...p, inventory: { ...p.inventory, ore: 5 } } : p,
      ) as ReadonlyArray<Player>,
    });
    const res = applyAction(state, { type: 'CLAIM_BUILDING', pieceId: 'blank-nc', controlModule: 3, fromProductionIncrease: true });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe('NOT_CLAIMABLE');
  });
});

// ── UPGRADE_BUILDING ──────────────────────────────────────────────────────────

describe('UPGRADE_BUILDING', () => {
  it('charges the numeric difference from the Production Increase budget, never materials', () => {
    // Upgrading 3 → 7 costs 4 upgrade-units; funded entirely by the PI budget. The
    // player's materials must be untouched — upgrades can never be paid with materials.
    const piece = makePiece({
      id: 'pf-up',
      type: 'plateFact',
      claims: [{ ownerId: 0, controlModule: 3 }],
    });
    const state = actionsState({
      productionIncreaseBudget: 4,
      board: [createGame(1, 2).board[0]!, piece],
      players: createGame(1, 2).players.map((p, i): Player =>
        i === 0
          ? {
              ...p,
              inventory: { ore: 1, plate: 1, sphere: 0, tesseract: 0 },
              controlModules: p.controlModules.filter(m => m !== 3),
            }
          : p,
      ) as ReadonlyArray<Player>,
    });

    const res = applyAction(state, {
      type: 'UPGRADE_BUILDING',
      pieceId: 'pf-up',
      oldModule: 3,
      newModule: 7,
      fromProductionIncrease: true,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const outPiece = res.state.board.find(p => p.id === 'pf-up')!;
    expect(outPiece.claims[0]?.controlModule).toBe(7);
    expect(res.state.players[0]?.controlModules).toContain(3);    // old module returned
    expect(res.state.players[0]?.controlModules).not.toContain(7); // new module spent
    expect(res.state.productionIncreaseBudget).toBe(0);            // 4 units spent
    expect(res.state.players[0]?.inventory.ore).toBe(1);           // materials untouched
    expect(res.state.players[0]?.inventory.plate).toBe(1);
  });

  it('rejects an upgrade that exceeds the Production Increase budget', () => {
    const piece = makePiece({
      id: 'pf-up2',
      type: 'plateFact',
      claims: [{ ownerId: 0, controlModule: 3 }],
    });
    const state = actionsState({
      productionIncreaseBudget: 2, // not enough for a 3→6 (cost 3) upgrade
      board: [createGame(1, 2).board[0]!, piece],
      players: createGame(1, 2).players.map((p, i): Player =>
        i === 0
          ? {
              ...p,
              inventory: { ore: 6, plate: 0, sphere: 0, tesseract: 0 }, // ore can't help
              controlModules: p.controlModules.filter(m => m !== 3),
            }
          : p,
      ) as ReadonlyArray<Player>,
    });

    const res = applyAction(state, {
      type: 'UPGRADE_BUILDING',
      pieceId: 'pf-up2',
      oldModule: 3,
      newModule: 6,
      fromProductionIncrease: true,
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe('INSUFFICIENT_PI_BUDGET');
  });

  it('uses free upgrade credits and locks them to the building', () => {
    const piece = makePiece({
      id: 'pf-free',
      type: 'plateFact',
      claims: [{ ownerId: 0, controlModule: 3 }],
    });
    const state = actionsState({
      board: [createGame(1, 2).board[0]!, piece],
      players: createGame(1, 2).players.map((p, i): Player =>
        i === 0
          ? {
              ...p,
              inventory: { ...p.inventory, ore: 0 }, // no resources — rely entirely on free credits
              controlModules: p.controlModules.filter(m => m !== 3),
              freeUpgradesRemaining: 3,
              freeUpgradePieceId: null,
            }
          : p,
      ) as ReadonlyArray<Player>,
    });

    // Upgrade 3→6, diff=3, use all 3 free credits
    const res = applyAction(state, {
      type: 'UPGRADE_BUILDING',
      pieceId: 'pf-free',
      oldModule: 3,
      newModule: 6,
      freeCredits: 3,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.state.players[0]?.freeUpgradesRemaining).toBe(0);
    expect(res.state.players[0]?.freeUpgradePieceId).toBe('pf-free');
    expect(res.state.board.find(p => p.id === 'pf-free')!.claims[0]?.controlModule).toBe(6);
  });

  it('rejects free credits on a different building once locked', () => {
    const piece1 = makePiece({
      id: 'pf-locked-1',
      type: 'plateFact',
      claims: [{ ownerId: 0, controlModule: 3 }],
    });
    const piece2 = makePiece({
      id: 'pf-locked-2',
      type: 'plateFact',
      coord: { q: 2, r: 0 },
      claims: [{ ownerId: 0, controlModule: 4 }],
    });
    const state = actionsState({
      board: [createGame(1, 2).board[0]!, piece1, piece2],
      players: createGame(1, 2).players.map((p, i): Player =>
        i === 0
          ? {
              ...p,
              inventory: { ...p.inventory, ore: 0 },
              controlModules: p.controlModules.filter(m => m !== 3 && m !== 4),
              freeUpgradesRemaining: 2,
              freeUpgradePieceId: 'pf-locked-1', // locked to piece1
            }
          : p,
      ) as ReadonlyArray<Player>,
    });

    // Try to use free credits on piece2 — must fail
    const res = applyAction(state, {
      type: 'UPGRADE_BUILDING',
      pieceId: 'pf-locked-2',
      oldModule: 4,
      newModule: 5,
      freeCredits: 1,
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe('WRONG_FREE_UPGRADE_TARGET');
  });
});

// ── Production Increase budget (claims/upgrades, never materials) ─────────────

describe('Production Increase claim budget', () => {
  it('rejects claiming a module the budget cannot afford (the #11 bug)', () => {
    // mineCount 1 → claiming module 11 costs 11 − 1 + 1 = 11 upgrade-units; PI grants 4.
    const piece = makePiece({ id: 'tf-pi', type: 'tesseractFact', claims: [] });
    const state = actionsState({
      productionIncreaseBudget: 4,
      board: [createGame(1, 2).board[0]!, piece],
    });

    const res = applyAction(state, {
      type: 'CLAIM_BUILDING', pieceId: 'tf-pi', controlModule: 11, fromProductionIncrease: true,
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe('INSUFFICIENT_PI_BUDGET');
  });

  it('claims within budget, spends the right units and no materials, and allows only one claim', () => {
    const pieceA = makePiece({ id: 'pf-a', type: 'plateFact', claims: [] });
    const pieceB = makePiece({ id: 'pf-b', type: 'plateFact', coord: { q: 2, r: 0 }, claims: [] });
    const state = actionsState({
      productionIncreaseBudget: 4, // mineCount 1: claiming module 4 costs 4 − 1 + 1 = 4
      board: [createGame(1, 2).board[0]!, pieceA, pieceB],
      players: createGame(1, 2).players.map((p, i): Player =>
        i === 0 ? { ...p, inventory: { ore: 5, plate: 0, sphere: 0, tesseract: 0 } } : p,
      ) as ReadonlyArray<Player>,
    });

    const r1 = applyAction(state, {
      type: 'CLAIM_BUILDING', pieceId: 'pf-a', controlModule: 4, fromProductionIncrease: true,
    });
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    expect(r1.state.board.find(p => p.id === 'pf-a')!.claims[0]?.controlModule).toBe(4);
    expect(r1.state.productionIncreaseBudget).toBe(0);              // 4 units spent
    expect(r1.state.productionIncreaseClaimedThisTurn).toBe(true);
    expect(r1.state.players[0]?.inventory.ore).toBe(5);            // materials untouched

    // A second Production Increase claim is rejected regardless of budget.
    const r2 = applyAction(r1.state, {
      type: 'CLAIM_BUILDING', pieceId: 'pf-b', controlModule: 1, fromProductionIncrease: true,
    });
    expect(r2.ok).toBe(false);
    if (r2.ok) return;
    expect(r2.error.code).toBe('PI_CLAIM_USED');
  });
});

// ── BUY_MINE ──────────────────────────────────────────────────────────────────

describe('BUY_MINE', () => {
  it('pays cost, places mine on board, increments mineCount, unlocks next stack', () => {
    const base = createGame(1, 2);
    // Give player enough resources: 2nd mine costs 6
    const state: GameState = {
      ...base,
      turnOrder: [0, 1],
      activePlayerIndex: 0,
      phase: 'actions',
      players: base.players.map((p, i): Player =>
        i === 0
          ? { ...p, inventory: { ore: 3, plate: 1, sphere: 0, tesseract: 0 } } // 3+3=6
          : p,
      ) as ReadonlyArray<Player>,
    };

    // Use the first legal mine placement (board layout decides which hexes are free).
    const buy = firstLegal(state, 'BUY_MINE');
    const res = applyAction(state, buy);
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    expect(res.state.mineCount).toBe(2);
    expect(res.state.board.some(p => p.type === 'mine' && p.coord.q === buy.coord.q && p.coord.r === buy.coord.r)).toBe(true);
    expect(res.state.unplacedMines).toHaveLength(1); // started with 2, now 1
    expect(res.state.stacks[1].available).toBe(true); // stack 1 unlocked by mine 2
    // Paid 6 value units (3 ore + 1 plate = 3+3 = 6)
    expect(res.state.players[0]?.inventory.ore).toBe(0);
    expect(res.state.players[0]?.inventory.plate).toBe(0);
  });

  it('rejects when player cannot afford', () => {
    const base = createGame(1, 2);
    const state: GameState = {
      ...base,
      phase: 'actions',
      // default inventory = all zeros
    };
    const res = applyAction(state, { type: 'BUY_MINE', coord: { q: 1, r: 0 } });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe('CANNOT_AFFORD');
  });
});

// ── PLACE_MINE (auto-drop) ────────────────────────────────────────────────────

describe('PLACE_MINE (auto-drop)', () => {
  it('places a pending mine on the board, increments mineCount, transitions to roll', () => {
    const base = createGame(1, 2);
    // Simulate auto-drop: mine 2 dropped to pendingMineIds, now the next player's placePiece turn
    const state: GameState = {
      ...base,
      phase: 'placePiece',
      pendingMineIds: ['mine-2'],
      unplacedMines: [{ id: 'mine-3', type: 'mine' }], // mine 3 still unplaced
    };

    // Use the first legal mine placement (board layout decides which hexes are free).
    const place = firstLegal(state, 'PLACE_MINE');
    const res = applyAction(state, place);
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    expect(res.state.mineCount).toBe(2);
    expect(res.state.pendingMineIds).toHaveLength(0);
    expect(res.state.board.find(p => p.id === 'mine-2')).toBeDefined();
    expect(res.state.board.find(p => p.id === 'mine-2')!.coord).toEqual(place.coord);
    expect(res.state.phase).toBe('roll');
  });

  it('auto-drop triggers when the last piece is taken from a stack', () => {
    const base = createGame(42, 2);
    // Find a state where stack 0 has exactly 1 piece, then take it
    // Build a state with stack0 having only 1 piece
    const singlePieceStack = { ...base.stacks[0], pieces: [base.stacks[0].pieces[0]!] };
    const state: GameState = {
      ...base,
      phase: 'placePiece',
      stacks: [singlePieceStack, base.stacks[1], base.stacks[2]],
    };

    // Place the last piece from stack 0 at the first legal coordinate.
    const res = applyAction(state, firstLegal(state, 'PLACE_PIECE'));
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    // Mine 2 should have auto-dropped to pendingMineIds
    expect(res.state.pendingMineIds).toHaveLength(1);
    expect(res.state.pendingMineIds[0]).toBe('mine-2');
    // Stack 1 should be unlocked immediately
    expect(res.state.stacks[1].available).toBe(true);
    // unplacedMines now has only mine-3
    expect(res.state.unplacedMines).toHaveLength(1);
  });

  it('PLACE_PIECE is rejected when a mine is pending (must use PLACE_MINE instead)', () => {
    const base = createGame(42, 2);
    const state: GameState = {
      ...base,
      phase: 'placePiece',
      pendingMineIds: ['mine-2'],
    };
    const res = applyAction(state, {
      type: 'PLACE_PIECE',
      stackIndex: 0,
      coord: { q: 1, r: 0 },
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe('PENDING_MINE');
  });
});
