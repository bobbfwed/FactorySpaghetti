import { describe, it, expect } from 'vitest';
import { createGame } from '../rules/setup';
import {
  STACK_COMPOSITION,
  TOTAL_PIECES,
  STARTING_POWER_TOKENS,
  BELT_COUNT,
  TELEPORTER_COUNT,
  CONTROL_MODULE_MAX,
  STARTING_PIECES_PER_PLAYER,
} from '../config';

describe('createGame', () => {
  it('is deterministic — same seed produces identical state', () => {
    expect(createGame(42, 3)).toEqual(createGame(42, 3));
    expect(createGame(0, 2)).toEqual(createGame(0, 2));
    expect(createGame(0xdeadbeef, 4)).toEqual(createGame(0xdeadbeef, 4));
  });

  it('different seeds produce different states', () => {
    const turnOrders = new Set(
      [0, 1, 2, 3, 4, 5, 6, 7].map(seed => JSON.stringify(createGame(seed, 3).turnOrder)),
    );
    expect(turnOrders.size).toBeGreaterThan(1);
  });

  it('total piece count across board + unplacedMines + stacks equals TOTAL_PIECES', () => {
    const state = createGame(1, 4);
    const inStacks =
      state.stacks[0].pieces.length +
      state.stacks[1].pieces.length +
      state.stacks[2].pieces.length;
    expect(state.board.length + state.unplacedMines.length + inStacks).toBe(TOTAL_PIECES);
  });

  it('each stack has the correct piece-type counts after S5 starting-piece removal', () => {
    const playerCount = 3;
    const state = createGame(99, playerCount);

    // Stack 0: S5 pulls STARTING_PIECES_PER_PLAYER × playerCount pieces out.
    const stack0 = state.stacks[0];
    const comp0 = STACK_COMPOSITION[playerCount][0];
    expect(stack0.pieces.filter(p => p.type === 'plateFact')).toHaveLength(
      comp0.plateFact - (STARTING_PIECES_PER_PLAYER.plateFact ?? 0) * playerCount,
    );
    expect(stack0.pieces.filter(p => p.type === 'powerPlant')).toHaveLength(
      comp0.powerPlant - (STARTING_PIECES_PER_PLAYER.powerPlant ?? 0) * playerCount,
    );
    expect(stack0.pieces.filter(p => p.type === 'blank')).toHaveLength(
      comp0.blank - (STARTING_PIECES_PER_PLAYER.blank ?? 0) * playerCount,
    );
    // Types not in STARTING_PIECES_PER_PLAYER are untouched.
    expect(stack0.pieces.filter(p => p.type === 'sphereFact')).toHaveLength(comp0.sphereFact);
    expect(stack0.pieces.filter(p => p.type === 'tesseractFact')).toHaveLength(comp0.tesseractFact);

    // Stacks 1 and 2 are unmodified by S5.
    for (const si of [1, 2] as const) {
      const stack = state.stacks[si];
      const comp = STACK_COMPOSITION[playerCount][si];
      expect(stack.pieces.filter(p => p.type === 'plateFact')).toHaveLength(comp.plateFact);
      expect(stack.pieces.filter(p => p.type === 'sphereFact')).toHaveLength(comp.sphereFact);
      expect(stack.pieces.filter(p => p.type === 'tesseractFact')).toHaveLength(comp.tesseractFact);
      expect(stack.pieces.filter(p => p.type === 'powerPlant')).toHaveLength(comp.powerPlant);
      expect(stack.pieces.filter(p => p.type === 'blank')).toHaveLength(comp.blank);
      expect(stack.pieces.filter(p => p.type === 'mine')).toHaveLength(0);
    }
  });

  it('stack 0 is available; stacks 1 and 2 are locked', () => {
    const state = createGame(1, 2);
    expect(state.stacks[0].available).toBe(true);
    expect(state.stacks[1].available).toBe(false);
    expect(state.stacks[2].available).toBe(false);
  });

  it('mine 1 starts on the board at origin (q=0, r=0)', () => {
    const state = createGame(1, 2);
    const mines = state.board.filter(p => p.type === 'mine');
    expect(mines).toHaveLength(1);
    expect(mines[0]?.coord).toEqual({ q: 0, r: 0 });
    expect(mines[0]?.id).toBe('mine-1');
  });

  it('mines 2 and 3 start unplaced; mineCount = 1', () => {
    const state = createGame(1, 2);
    expect(state.unplacedMines).toHaveLength(2);
    expect(state.mineCount).toBe(1);
    const ids = state.unplacedMines.map(m => m.id);
    expect(ids).toContain('mine-2');
    expect(ids).toContain('mine-3');
  });

  it('turn order is a valid permutation of [0 .. playerCount-1]', () => {
    for (const count of [2, 3, 4] as const) {
      const state = createGame(7, count);
      expect([...state.turnOrder].sort((a, b) => a - b)).toEqual(
        Array.from({ length: count }, (_, i) => i),
      );
    }
  });

  it('each player starts with correct resource totals', () => {
    const state = createGame(1, 4);
    for (const player of state.players) {
      expect(player.powerTokens).toBe(STARTING_POWER_TOKENS);
      expect(player.beltsRemaining).toBe(BELT_COUNT);
      expect(player.teleportersRemaining).toBe(TELEPORTER_COUNT);
      expect(player.inventory.ore).toBe(0);
      expect(player.inventory.plate).toBe(0);
      expect(player.inventory.sphere).toBe(0);
      expect(player.inventory.tesseract).toBe(0);
      expect(player.hand).toHaveLength(0);
      expect(player.meepleOnPieceId).toBeNull();
    }
  });

  it('each player starts with all 18 control modules (S7 is interactive, not pre-applied)', () => {
    const state = createGame(1, 2);
    for (const player of state.players) {
      expect(player.controlModules).toHaveLength(CONTROL_MODULE_MAX);
      expect([...player.controlModules].sort((a, b) => a - b)).toEqual(
        Array.from({ length: CONTROL_MODULE_MAX }, (_, i) => i + 1),
      );
    }
  });

  it('no board pieces are claimed at game start (S7 interactive claims pending)', () => {
    for (const count of [2, 3, 4] as const) {
      const state = createGame(42, count);
      expect(state.board.every(p => p.claims.length === 0)).toBe(true);
    }
  });

  it('board has 1 mine + 4 * playerCount starting pieces after setup', () => {
    for (const count of [2, 3, 4] as const) {
      const state = createGame(7, count);
      expect(state.board).toHaveLength(1 + 4 * count);
      expect(state.board.filter(p => p.type === 'mine')).toHaveLength(1);
    }
  });

  it('places starting pieces in a clockwise spiral from below the mine connecting edge', () => {
    // Placement coords are purely geometric (seed-independent); only piece type/rotation
    // varies by seed. Mine-1 is at (0,0) rot 0, lean hex at (1,0).
    const coords = createGame(7, 4).board.slice(1).map(p => `${p.coord.q},${p.coord.r}`);

    // Ring 1: clockwise from the hex below the connecting edge (0,1), around the rich
    // side first, ending at the bottom-right (1,1).
    expect(coords.slice(0, 8)).toEqual([
      '0,1', '-1,1', '-1,0', '0,-1', '1,-1', '2,-1', '2,0', '1,1',
    ]);
    // The spiral then continues: the next piece sits below and between ring 1's first
    // (0,1) and last (1,1) pieces — not back at the top.
    expect(coords[8]).toBe('0,2');
  });

  it('initialises with the correct player count', () => {
    for (const count of [2, 3, 4] as const) {
      expect(createGame(1, count).players).toHaveLength(count);
    }
  });

  it('starts at round 1 in setupClaimPF phase', () => {
    const state = createGame(1, 2);
    expect(state.round).toBe(1);
    expect(state.phase).toBe('setupClaimPF');
    expect(state.activePlayerIndex).toBe(0);
  });

  it('card deck contains the correct total number of cards', () => {
    const state = createGame(1, 2);
    // 6+4+2+6+6+4+6+6+6+4+4+4+4 = 62 cards
    const expectedTotal = 6+4+2+6+6+4+6+6+6+4+4+4+4;
    expect(state.cardDeck).toHaveLength(expectedTotal);
    expect(state.cardDiscard).toHaveLength(0);
  });

  it('piece IDs are unique across all stacks', () => {
    const state = createGame(1, 2);
    const allIds = [
      ...state.board.map(p => p.id),
      ...state.unplacedMines.map(m => m.id),
      ...state.stacks.flatMap(s => s.pieces.map(p => p.id)),
    ];
    expect(new Set(allIds).size).toBe(allIds.length);
  });
});
