import { describe, it, expect } from 'vitest';
import { createGame } from '../rules/setup';
import { applyAction, type ApplyResult } from '../reducer';
import type { GameState, BoardPiece, Player } from '../state';

// ── Test-state helpers ────────────────────────────────────────────────────────

// Build a claimed factory or power plant with pre-filled input buffer.
// The piece is always placed adjacent to mine-1 at (1, 0).
function makePiece(overrides: Partial<BoardPiece> & Pick<BoardPiece, 'type' | 'id'>): BoardPiece {
  const type = overrides.type;
  const inputSlots =
    type === 'plateFact' ? 1
    : type === 'sphereFact' ? 2
    : type === 'tesseractFact' ? 3
    : type === 'powerPlant' ? 1
    : 0;
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

// Inject a board piece and set the game to 'roll' phase with enough power tokens.
// Always places the piece owner as the active player so factory-pending tests work
// regardless of which turn order the seed generates.
function rollState(base: GameState, piece: BoardPiece, ownerTokens = 10): GameState {
  const ownerId = piece.claims[0]?.ownerId ?? 0;
  const newPlayers = base.players.map((p, i): Player =>
    i === ownerId ? { ...p, powerTokens: ownerTokens } : p,
  );
  const otherIds = base.turnOrder.filter(id => id !== ownerId);
  return {
    ...base,
    board: [...base.board, piece],
    players: newPlayers,
    turnOrder: [ownerId, ...otherIds],
    activePlayerIndex: 0,
    phase: 'roll',
  };
}

function roll(state: GameState, ...values: number[]): ApplyResult {
  return applyAction(state, { type: 'ROLL_DICE', rolls: values });
}

function operate(state: GameState, pieceId: string): ApplyResult {
  return applyAction(state, { type: 'OPERATE_BUILDING', pieceId });
}

// ── Buffer rules ──────────────────────────────────────────────────────────────

describe('buffer rules — plate factory (1 Ore → 1 Plate)', () => {
  const base = createGame(1, 2);

  it('produces plate when ore is in input and module matches dice sum', () => {
    const piece = makePiece({
      id: 'pf-1', type: 'plateFact',
      claims: [{ ownerId: 0, controlModule: 4 }],
      input: { slots: ['ore'], teleporters: [] },
      coord: { q: 50, r: 0 }, // away from the mine: isolate production from mine auto-feed
    });
    const state = rollState(base, piece);

    // Roll [4] → sum 4 → module 4 matches → factory goes to pending
    const rollRes = roll(state, 4);
    expect(rollRes.ok).toBe(true);
    if (!rollRes.ok) return;
    expect(rollRes.state.pendingFactoryOps.map(e => e.pieceId)).toContain('pf-1');

    // Operate → plate goes to the OUTPUT BUFFER and stays there (not auto-collected);
    // input is consumed (piece is away from the mine, so no refill).
    const opRes = operate(rollRes.state, 'pf-1');
    expect(opRes.ok).toBe(true);
    if (!opRes.ok) return;
    const outPiece = opRes.state.board.find(p => p.id === 'pf-1')!;
    expect(outPiece.output?.slots[0]).toBe('plate'); // product stays in output buffer
    expect(outPiece.input?.slots[0]).toBeNull();      // ore consumed
    expect(opRes.state.players[0]!.inventory.plate).toBe(0); // NOT auto-collected to inventory
  });

  it('does NOT produce when dice sum does not match module', () => {
    const piece = makePiece({
      id: 'pf-2', type: 'plateFact',
      claims: [{ ownerId: 0, controlModule: 4 }],
      input: { slots: ['ore'], teleporters: [] },
    });
    const state = rollState(base, piece);

    const res = roll(state, 3); // sum 3 ≠ module 4
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const outPiece = res.state.board.find(p => p.id === 'pf-2')!;
    expect(outPiece.output?.slots[0]).toBeNull();      // no production
    expect(outPiece.input?.slots[0]).toBe('ore');       // ore still there
  });

  it('does NOT produce when input buffer is empty', () => {
    const piece = makePiece({
      id: 'pf-3', type: 'plateFact',
      claims: [{ ownerId: 0, controlModule: 5 }],
      // input slots default to null (empty)
    });
    const state = rollState(base, piece);

    const res = roll(state, 5);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.state.board.find(p => p.id === 'pf-3')!.output?.slots[0]).toBeNull();
  });
});

// ── Full output buffer blocks production ──────────────────────────────────────

describe('same number rolled twice with full output buffer = nothing', () => {
  it('first roll produces; second roll with same sum and full output does nothing', () => {
    const base = createGame(42, 2);

    const piece = makePiece({
      id: 'pf-dbl', type: 'plateFact',
      claims: [{ ownerId: 0, controlModule: 3 }],
      input: { slots: ['ore'], teleporters: [] },
    });
    const state = rollState(base, piece, 10);

    // First roll → factory goes to pending
    const res1 = roll(state, 3);
    expect(res1.ok).toBe(true);
    if (!res1.ok) return;
    expect(res1.state.pendingFactoryOps.map(e => e.pieceId)).toContain('pf-dbl');

    // Operate → plate goes to the output buffer and stays there (not collected).
    const op1 = operate(res1.state, 'pf-dbl');
    expect(op1.ok).toBe(true);
    if (!op1.ok) return;
    expect(op1.state.board.find(p => p.id === 'pf-dbl')!.output?.slots[0]).toBe('plate');

    // Output buffer is now full; go back to roll phase to test blocking behaviour.
    const withFullOutput: GameState = { ...op1.state, phase: 'roll' };

    // Second roll with same sum — output full → factory can't operate → not in pending
    const res2 = roll(withFullOutput, 3);
    expect(res2.ok).toBe(true);
    if (!res2.ok) return;
    expect(res2.state.pendingFactoryOps.map(e => e.pieceId)).not.toContain('pf-dbl');
    const p2 = res2.state.board.find(p => p.id === 'pf-dbl')!;
    expect(p2.output?.slots[0]).toBe('plate'); // output unchanged
  });

  it('output full + re-roll does NOT deduct additional power', () => {
    const base = createGame(1, 2);
    const piece = makePiece({
      id: 'pf-pow', type: 'plateFact',
      claims: [{ ownerId: 0, controlModule: 2 }],
      input: { slots: ['ore'], teleporters: [] },
    });
    const initState = rollState(base, piece, 5);

    const res1 = roll(initState, 2);
    expect(res1.ok).toBe(true);
    if (!res1.ok) return;

    // Operate → deduct 1 token (plate output cost)
    const op1 = operate(res1.state, 'pf-pow');
    expect(op1.ok).toBe(true);
    if (!op1.ok) return;
    const tokensAfterFirst = op1.state.players[0]!.powerTokens;

    // Put back into roll phase with output manually filled to test blocking
    const withFullOutput: GameState = {
      ...op1.state,
      board: op1.state.board.map(p =>
        p.id === 'pf-pow'
          ? { ...p, output: { ...p.output!, slots: ['plate' as const] } }
          : p,
      ),
      phase: 'roll',
    };
    const res2 = roll(withFullOutput, 2);
    expect(res2.ok).toBe(true);
    if (!res2.ok) return;
    // Power unchanged on second roll (output buffer full, factory not added to pending)
    expect(res2.state.players[0]!.powerTokens).toBe(tokensAfterFirst);
  });
});

// ── Power payment ─────────────────────────────────────────────────────────────

describe('power payment', () => {
  const base = createGame(7, 2);

  it('plate factory (ore input) costs 1 power token (plate output)', () => {
    const piece = makePiece({
      id: 'pf-p0', type: 'plateFact',
      claims: [{ ownerId: 0, controlModule: 6 }],
      input: { slots: ['ore'], teleporters: [] },
    });
    const state = rollState(base, piece, 3);
    const initialTokens = state.players[0]!.powerTokens;

    const rollRes = roll(state, 6);
    expect(rollRes.ok).toBe(true);
    if (!rollRes.ok) return;
    const opRes = operate(rollRes.state, 'pf-p0');
    expect(opRes.ok).toBe(true);
    if (!opRes.ok) return;
    expect(opRes.state.players[0]!.powerTokens).toBe(initialTokens - 1); // 1 for plate output
  });

  it('sphere factory (ore+plate input) costs 2 power tokens (sphere output)', () => {
    const piece = makePiece({
      id: 'sf-p1', type: 'sphereFact',
      claims: [{ ownerId: 0, controlModule: 5 }],
      input: { slots: ['ore', 'plate'], teleporters: [] },
    });
    const state = rollState(base, piece, 5);
    const initialTokens = state.players[0]!.powerTokens;

    const rollRes = roll(state, 5);
    expect(rollRes.ok).toBe(true);
    if (!rollRes.ok) return;
    const opRes = operate(rollRes.state, 'sf-p1');
    expect(opRes.ok).toBe(true);
    if (!opRes.ok) return;
    expect(opRes.state.players[0]!.powerTokens).toBe(initialTokens - 2); // 2 for sphere output
    expect(opRes.state.board.find(p => p.id === 'sf-p1')!.output?.slots[0]).toBe('sphere'); // → output buffer
  });

  it('sphere factory (2×plate input) costs 2 power tokens', () => {
    const piece = makePiece({
      id: 'sf-p2', type: 'sphereFact',
      claims: [{ ownerId: 0, controlModule: 4 }],
      input: { slots: ['plate', 'plate'], teleporters: [] },
    });
    const state = rollState(base, piece, 5);
    const initialTokens = state.players[0]!.powerTokens;

    const rollRes = roll(state, 4);
    expect(rollRes.ok).toBe(true);
    if (!rollRes.ok) return;
    const opRes = operate(rollRes.state, 'sf-p2');
    expect(opRes.ok).toBe(true);
    if (!opRes.ok) return;
    expect(opRes.state.players[0]!.powerTokens).toBe(initialTokens - 2);
    expect(opRes.state.board.find(p => p.id === 'sf-p2')!.output?.slots[0]).toBe('sphere'); // → output buffer
  });

  it('tesseract factory (ore+plate+sphere) costs 3 power tokens (1 plate + 2 sphere)', () => {
    const piece = makePiece({
      id: 'tf-p3', type: 'tesseractFact',
      claims: [{ ownerId: 0, controlModule: 6 }],
      input: { slots: ['ore', 'plate', 'sphere'], teleporters: [] },
    });
    const state = rollState(base, piece, 5);
    const initialTokens = state.players[0]!.powerTokens;

    const rollRes = roll(state, 6);
    expect(rollRes.ok).toBe(true);
    if (!rollRes.ok) return;
    const opRes = operate(rollRes.state, 'tf-p3');
    expect(opRes.ok).toBe(true);
    if (!opRes.ok) return;
    expect(opRes.state.players[0]!.powerTokens).toBe(initialTokens - 3); // 0+1+2
    expect(opRes.state.board.find(p => p.id === 'tf-p3')!.output?.slots[0]).toBe('tesseract'); // → output buffer
  });

  it('does NOT produce if player cannot afford the power cost', () => {
    const piece = makePiece({
      id: 'sf-broke', type: 'sphereFact',
      claims: [{ ownerId: 0, controlModule: 3 }],
      input: { slots: ['plate', 'plate'], teleporters: [] },
    });
    const state = rollState(base, piece, 1); // only 1 token; need 2

    const res = roll(state, 3);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.state.board.find(p => p.id === 'sf-broke')!.output?.slots[0]).toBeNull();
    expect(res.state.players[0]!.powerTokens).toBe(1); // unchanged
  });
});

// ── Power plants ──────────────────────────────────────────────────────────────

describe('power plant production', () => {
  const base = createGame(5, 2);

  it('produces 1 token with no input material', () => {
    const piece = makePiece({
      id: 'pp-base', type: 'powerPlant',
      claims: [{ ownerId: 0, controlModule: 4 }],
      input: { slots: [null], teleporters: [] },
      coord: { q: 50, r: 0 }, // away from the mine: verify base yield with a genuinely empty input
    });
    const state = rollState(base, piece, 3);

    const res = roll(state, 4);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.state.players[0]!.powerTokens).toBe(4); // 3 + 1 base
  });

  it('produces 2 tokens when ore is consumed', () => {
    const piece = makePiece({
      id: 'pp-ore', type: 'powerPlant',
      claims: [{ ownerId: 0, controlModule: 3 }],
      input: { slots: ['ore'], teleporters: [] },
      coord: { q: 50, r: 0 }, // away from the mine: input is exactly the 1 ore we set, then consumed
    });
    const state = rollState(base, piece, 0);

    const res = roll(state, 3);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.state.players[0]!.powerTokens).toBe(2); // ore chart row
    expect(res.state.board.find(p => p.id === 'pp-ore')!.input?.slots[0]).toBeNull(); // ore consumed
  });

  it('produces 5 tokens when plate is consumed', () => {
    const piece = makePiece({
      id: 'pp-plate', type: 'powerPlant',
      claims: [{ ownerId: 0, controlModule: 2 }],
      input: { slots: ['plate'], teleporters: [] },
    });
    const state = rollState(base, piece, 0);

    const res = roll(state, 2);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.state.players[0]!.powerTokens).toBe(5);
  });

  it('produces 10 tokens when sphere is consumed', () => {
    const piece = makePiece({
      id: 'pp-sphere', type: 'powerPlant',
      claims: [{ ownerId: 0, controlModule: 6 }],
      input: { slots: ['sphere'], teleporters: [] },
    });
    const state = rollState(base, piece, 0);

    const res = roll(state, 6);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.state.players[0]!.powerTokens).toBe(10);
  });

  it('caps power tokens at 10', () => {
    const piece = makePiece({
      id: 'pp-cap', type: 'powerPlant',
      claims: [{ ownerId: 0, controlModule: 5 }],
      input: { slots: ['sphere'], teleporters: [] },
    });
    const state = rollState(base, piece, 8); // already at 8; sphere would give 10

    const res = roll(state, 5);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.state.players[0]!.powerTokens).toBe(10); // capped
  });

  it('does not accept tesseract input', () => {
    const piece = makePiece({
      id: 'pp-tess', type: 'powerPlant',
      claims: [{ ownerId: 0, controlModule: 3 }],
      input: { slots: ['tesseract'], teleporters: [] },
    });
    const state = rollState(base, piece, 0);

    const res = roll(state, 3);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    // Tesseract ignored — falls back to base 1-token yield
    expect(res.state.players[0]!.powerTokens).toBe(1);
    expect(res.state.board.find(p => p.id === 'pp-tess')!.input?.slots[0]).toBe('tesseract'); // NOT consumed
  });
});

// ── All owners activate on any roll (each owner chooses to operate) ────────────

describe('activation on any roll (every owner is prompted, then operates)', () => {
  it('both players activate on the same dice sum; each operates their own factory', () => {
    const base = createGame(1, 2);

    const piece0 = makePiece({
      id: 'pf-p0', type: 'plateFact',
      claims: [{ ownerId: 0, controlModule: 4 }],
      input: { slots: ['ore'], teleporters: [] },
    });
    const piece1 = makePiece({
      id: 'pf-p1', type: 'plateFact',
      coord: { q: -1, r: 0 },
      claims: [{ ownerId: 1, controlModule: 4 }],
      input: { slots: ['ore'], teleporters: [] },
    });

    // Give both players enough tokens (plate factory costs 0 anyway, but keep it realistic)
    const newPlayers = base.players.map((p): Player => ({ ...p, powerTokens: 5 }));
    const state: GameState = {
      ...base,
      board: [...base.board, piece0, piece1],
      players: newPlayers,
      turnOrder: [0, 1],
      activePlayerIndex: 0, // both factories match the roll; BOTH defer to their owners
      phase: 'roll',
    };

    const res = roll(state, 4);
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    // Neither auto-operates — a roll never spends a player's power without consent.
    expect(res.state.board.find(p => p.id === 'pf-p0')!.output?.slots[0]).toBeNull();
    expect(res.state.board.find(p => p.id === 'pf-p1')!.output?.slots[0]).toBeNull();
    // Both owners have a pending activation (owner-tagged).
    expect(res.state.pendingFactoryOps).toContainEqual({ pieceId: 'pf-p0', ownerId: 0 });
    expect(res.state.pendingFactoryOps).toContainEqual({ pieceId: 'pf-p1', ownerId: 1 });

    // Each owner operates their own factory (player 1 acts off-turn via ownerId).
    const op0 = applyAction(res.state, { type: 'OPERATE_BUILDING', pieceId: 'pf-p0', ownerId: 0 });
    expect(op0.ok).toBe(true);
    if (!op0.ok) return;
    const op1 = applyAction(op0.state, { type: 'OPERATE_BUILDING', pieceId: 'pf-p1', ownerId: 1 });
    expect(op1.ok).toBe(true);
    if (!op1.ok) return;

    expect(op1.state.board.find(p => p.id === 'pf-p0')!.output?.slots[0]).toBe('plate');
    expect(op1.state.board.find(p => p.id === 'pf-p1')!.output?.slots[0]).toBe('plate');
  });
});

// ── Validation ────────────────────────────────────────────────────────────────

describe('ROLL_DICE validation', () => {
  it('rejects roll outside the roll phase', () => {
    const base = createGame(1, 2); // phase is placePiece
    const res = applyAction(base, { type: 'ROLL_DICE', rolls: [3] });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe('WRONG_PHASE');
  });

  it('rejects wrong number of dice', () => {
    const base = createGame(1, 2);
    const state: GameState = { ...base, phase: 'roll' };
    const res = roll(state, 2, 3); // 2 dice but mineCount = 1
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe('WRONG_DICE_COUNT');
  });

  it('rejects dice value outside 1–6', () => {
    const base = createGame(1, 2);
    const state: GameState = { ...base, phase: 'roll' };
    const res = roll(state, 7);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe('INVALID_ROLL');
  });

  it('stores the roll in lastRoll on success', () => {
    const base = createGame(1, 2);
    const state: GameState = { ...base, phase: 'roll' };
    const res = roll(state, 5);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.state.lastRoll).toEqual([5]);
    expect(res.state.phase).toBe('actions');
  });
});

// ── Tesseract recipe validation ───────────────────────────────────────────────

describe('tesseract factory input validation', () => {
  const base = createGame(1, 2);

  const testCase = (id: string, inputs: ('ore' | 'plate' | 'sphere' | 'tesseract')[], shouldProduce: boolean): void => {
    it(`${inputs.join('+')} → ${shouldProduce ? 'produces tesseract' : 'no production'}`, () => {
      const piece = makePiece({
        id, type: 'tesseractFact',
        claims: [{ ownerId: 0, controlModule: 5 }],
        input: { slots: inputs as ('ore' | 'plate' | 'sphere' | 'tesseract')[], teleporters: [] },
      });
      const state = rollState(base, piece, 10);
      const rollRes = roll(state, 5);
      expect(rollRes.ok).toBe(true);
      if (!rollRes.ok) return;

      if (shouldProduce) {
        // Active player's factory goes to pending; must explicitly operate
        expect(rollRes.state.pendingFactoryOps.map(e => e.pieceId)).toContain(id);
        const opRes = operate(rollRes.state, id);
        expect(opRes.ok).toBe(true);
        if (!opRes.ok) return;
        // Tesseract goes to the output buffer (not auto-collected to inventory)
        expect(opRes.state.board.find(p => p.id === id)!.output?.slots[0]).toBe('tesseract');
      } else {
        // Invalid recipe → factory not added to pending, output stays null
        expect(rollRes.state.pendingFactoryOps.map(e => e.pieceId)).not.toContain(id);
        expect(rollRes.state.board.find(p => p.id === id)!.output?.slots[0]).toBeNull();
      }
    });
  };

  testCase('tf-valid-1', ['ore', 'plate', 'sphere'], true);
  testCase('tf-valid-2', ['plate', 'plate', 'sphere'], true);  // higher-value sub for Ore slot
  testCase('tf-valid-3', ['ore', 'sphere', 'sphere'], true);   // sphere subs for Plate slot
  testCase('tf-invalid-1', ['ore', 'ore', 'sphere'], false);   // two ores can't cover Plate slot
  testCase('tf-invalid-2', ['ore', 'plate', 'plate'], false);  // no Sphere-tier material
});

// ── Round-end output collection (meeple-gated, optional) ──────────────────────

describe('round-end output collection', () => {
  // Build a roundEnd state with player 0's meeple on the given building.
  function roundEndWithMeeple(base: GameState, piece: BoardPiece, tokens = 5): GameState {
    return {
      ...base,
      board: [...base.board, piece],
      players: base.players.map((p, i): Player =>
        i === 0
          ? { ...p, meepleOnPieceId: piece.id, meepleSlotIndex: null, powerTokens: tokens }
          : p,
      ),
      turnOrder: [0, 1],
      activePlayerIndex: 0,
      phase: 'roundEnd',
    };
  }

  it('COLLECT_OUTPUT moves output-buffer material to inventory and clears the buffer', () => {
    const base = createGame(1, 2);
    const piece = makePiece({
      id: 'pf-collect', type: 'plateFact',
      claims: [{ ownerId: 0, controlModule: 4 }],
      output: { slots: ['plate'], teleporters: [] },
      coord: { q: 50, r: 0 },
    });
    const state = roundEndWithMeeple(base, piece);

    const res = applyAction(state, { type: 'COLLECT_OUTPUT', pieceId: 'pf-collect' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.state.players[0]!.inventory.plate).toBe(1);
    expect(res.state.board.find(p => p.id === 'pf-collect')!.output?.slots[0]).toBeNull();
  });

  it('rejects COLLECT_OUTPUT when the meeple is not on the building', () => {
    const base = createGame(1, 2);
    const piece = makePiece({
      id: 'pf-nomeeple', type: 'plateFact',
      claims: [{ ownerId: 0, controlModule: 4 }],
      output: { slots: ['plate'], teleporters: [] },
      coord: { q: 50, r: 0 },
    });
    const state: GameState = {
      ...base,
      board: [...base.board, piece],
      turnOrder: [0, 1],
      activePlayerIndex: 0,
      phase: 'roundEnd',
    };
    const res = applyAction(state, { type: 'COLLECT_OUTPUT', pieceId: 'pf-nomeeple' });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe('INVALID_TARGET');
  });

  it('operate fills the output buffer (not inventory), then COLLECT_OUTPUT banks it; operate is once-only', () => {
    const base = createGame(1, 2);
    const piece = makePiece({
      id: 'pf-opcollect', type: 'plateFact',
      claims: [{ ownerId: 0, controlModule: 4 }],
      input: { slots: ['ore'], teleporters: [] },
      output: { slots: [null], teleporters: [] },
      coord: { q: 50, r: 0 },
    });
    const state = roundEndWithMeeple(base, piece);

    // Operate: ore consumed, plate → output buffer, inventory untouched
    const op = applyAction(state, { type: 'OPERATE_BUILDING', pieceId: 'pf-opcollect' });
    expect(op.ok).toBe(true);
    if (!op.ok) return;
    expect(op.state.board.find(p => p.id === 'pf-opcollect')!.output?.slots[0]).toBe('plate');
    expect(op.state.players[0]!.inventory.plate).toBe(0);

    // Operating again is rejected — at most once per round end
    const op2 = applyAction(op.state, { type: 'OPERATE_BUILDING', pieceId: 'pf-opcollect' });
    expect(op2.ok).toBe(false);
    if (op2.ok) return;
    expect(op2.error.code).toBe('ALREADY_OPERATED');

    // Collect: plate → inventory, buffer cleared
    const col = applyAction(op.state, { type: 'COLLECT_OUTPUT', pieceId: 'pf-opcollect' });
    expect(col.ok).toBe(true);
    if (!col.ok) return;
    expect(col.state.players[0]!.inventory.plate).toBe(1);
    expect(col.state.board.find(p => p.id === 'pf-opcollect')!.output?.slots[0]).toBeNull();
  });

  it('does not collect when inventory is already at cap (output stays in buffer)', () => {
    const base = createGame(1, 2);
    const piece = makePiece({
      id: 'pf-capfull', type: 'plateFact',
      claims: [{ ownerId: 0, controlModule: 4 }],
      output: { slots: ['plate'], teleporters: [] },
      coord: { q: 50, r: 0 },
    });
    const state: GameState = {
      ...roundEndWithMeeple(base, piece),
      players: roundEndWithMeeple(base, piece).players.map((p, i): Player =>
        i === 0 ? { ...p, inventory: { ...p.inventory, plate: 6 } } : p,
      ),
    };
    const res = applyAction(state, { type: 'COLLECT_OUTPUT', pieceId: 'pf-capfull' });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe('NOTHING_TO_COLLECT');
  });
});
