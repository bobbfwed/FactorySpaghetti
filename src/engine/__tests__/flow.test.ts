import { describe, it, expect } from 'vitest';
import { createGame } from '../rules/setup';
import { applyAction } from '../reducer';
import { fillInputsFromAdjacentMines, resolveDirectAdjacency } from '../rules/flow';
import { mineSecondaryCoord } from '../rules/pieces';
import { INVENTORY_CAP } from '../config';
import type { GameState, BoardPiece, Player, Belt } from '../state';

// ── Test-state helpers ────────────────────────────────────────────────────────

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
    input: overrides.input ?? (inputSlots > 0 ? { slots: new Array(inputSlots).fill(null), teleporterOwner: null } : null),
    output: overrides.output ?? (hasOutput ? { slots: [null], teleporterOwner: null } : null),
  };
}

// A fresh 2-player game with a fixed turn order (Player 0 active). Pinning the turn order
// keeps these fixtures independent of the seed-derived starting player, which shifts when
// the stack composition changes. Tests that need a different active player override these.
function freshGame(): GameState {
  return { ...createGame(1, 2), turnOrder: [0, 1], activePlayerIndex: 0 };
}

// ── Teleporter — input (opponent's-turn activation) ───────────────────────────

describe('input teleporter', () => {
  it('feeds the building from inventory on an opponent\'s turn', () => {
    const base = freshGame();

    // Player 0 owns a plate factory (module 4) with an input teleporter.
    const piece = makePiece({
      id: 'pf-tele-in',
      type: 'plateFact',
      claims: [{ ownerId: 0, controlModule: 4 }],
      // Input buffer is empty; teleporter allows inventory to fill it.
      input: { slots: [null], teleporterOwner: 0 },
      output: { slots: [null], teleporterOwner: null },
      coord: { q: 50, r: 0 }, // away from the mine: ore must come from the teleporter, not mine auto-feed
    });

    // Player 1 is the active player; Player 0 has 1 ore in inventory + enough power.
    const state: GameState = {
      ...base,
      board: [...base.board, piece],
      players: base.players.map((p, i): Player =>
        i === 0
          ? { ...p, powerTokens: 10, inventory: { ...p.inventory, ore: 1 } }
          : p,
      ) as ReadonlyArray<Player>,
      turnOrder: [0, 1],
      activePlayerIndex: 1, // it is Player 1's turn
      phase: 'roll',
    };

    // Roll [4] → sum 4 → Player 0's module matches. On another player's turn the factory
    // DEFERS to Player 0's decision (a roll never spends your resources without consent).
    const res = applyAction(state, { type: 'ROLL_DICE', rolls: [4] });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.state.pendingFactoryOps).toContainEqual({ pieceId: 'pf-tele-in', ownerId: 0 });
    expect(res.state.board.find(p => p.id === 'pf-tele-in')!.output?.slots[0]).toBeNull();

    // Player 0 operates off-turn → teleporter completes ore from inventory and produces.
    const op = applyAction(res.state, { type: 'OPERATE_BUILDING', pieceId: 'pf-tele-in', ownerId: 0 });
    expect(op.ok).toBe(true);
    if (!op.ok) return;
    const outPiece = op.state.board.find(p => p.id === 'pf-tele-in')!;
    expect(outPiece.output?.slots[0]).toBe('plate'); // produced via the input teleporter
    expect(outPiece.input?.slots[0]).toBeNull();      // input buffer cleared
    expect(op.state.players[0]?.inventory.ore).toBe(0); // Player 0's ore consumed
  });

  it('does NOT produce when owner has no matching inventory material', () => {
    const base = freshGame();

    const piece = makePiece({
      id: 'pf-tele-noinv',
      type: 'plateFact',
      claims: [{ ownerId: 0, controlModule: 4 }],
      input: { slots: [null], teleporterOwner: 0 },
      output: { slots: [null], teleporterOwner: null },
      coord: { q: 50, r: 0 }, // away from the mine: with no inventory and no mine feed, nothing produces
    });

    // Player 0 has no ore in inventory
    const state: GameState = {
      ...base,
      board: [...base.board, piece],
      players: base.players.map((p, i): Player =>
        i === 0 ? { ...p, powerTokens: 10 } : p,
      ) as ReadonlyArray<Player>,
      turnOrder: [0, 1],
      activePlayerIndex: 1,
      phase: 'roll',
    };

    const res = applyAction(state, { type: 'ROLL_DICE', rolls: [4] });
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const outPiece = res.state.board.find(p => p.id === 'pf-tele-noinv')!;
    expect(outPiece.output?.slots[0]).toBeNull(); // no production
  });
});

// ── Uncollected output flows before production resolves on the next roll ──────

describe('uncollected output reaches a connected building before production', () => {
  // Plate factory at (0,0) rot 0: its output (#8, position 7) faces (1,0).
  // Sphere factory at (1,0) rot 0: its input (#1, position 0) faces back at the plate
  // factory's output. A plate left uncollected in the plate factory's output buffer
  // should move into the sphere factory's input at the START of a roll (before any
  // production is evaluated) so the sphere factory can run if its number comes up.
  function twoFactoryBoard(activePlayerIndex: number): GameState {
    const base = freshGame();
    const plateFact: BoardPiece = {
      id: 'pf', type: 'plateFact', coord: { q: 0, r: 0 }, rotation: 0,
      claims: [{ ownerId: 0, controlModule: 3 }],
      input: { slots: [null], teleporterOwner: null },
      output: { slots: ['plate'], teleporterOwner: null }, // produced last round, uncollected
    };
    const sphereFact: BoardPiece = {
      id: 'sf', type: 'sphereFact', coord: { q: 1, r: 0 }, rotation: 0,
      claims: [{ ownerId: 0, controlModule: 4 }],
      input: { slots: [null, 'plate'], teleporterOwner: null }, // one plate already present
      output: { slots: [null], teleporterOwner: null },
    };
    return { ...base, board: [plateFact, sphereFact], turnOrder: [0, 1], activePlayerIndex, phase: 'roll' };
  }

  it('moves the plate into the connected input even when an unrelated number is rolled', () => {
    const res = applyAction(twoFactoryBoard(1), { type: 'ROLL_DICE', rolls: [1] }); // 1 ≠ any module
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const sf = res.state.board.find(p => p.id === 'sf')!;
    const pf = res.state.board.find(p => p.id === 'pf')!;
    expect(sf.input?.slots).toContain('plate'); // moved into the sphere factory input
    expect(pf.output?.slots[0]).toBeNull();      // plate factory output cleared
  });

  it('lets the connected factory run on the same roll its number comes up', () => {
    // Player 1 is active; the sphere factory belongs to (non-active) player 0. When module 4
    // is rolled it ACTIVATES but defers to player 0's decision — and only becomes operable
    // because the plate has already flowed in to complete the 2-plate recipe.
    const res = applyAction(twoFactoryBoard(1), { type: 'ROLL_DICE', rolls: [4] }); // matches sphere #4
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.state.pendingFactoryOps).toContainEqual({ pieceId: 'sf', ownerId: 0 });
    // Player 0 operates their sphere factory off-turn.
    const op = applyAction(res.state, { type: 'OPERATE_BUILDING', pieceId: 'sf', ownerId: 0 });
    expect(op.ok).toBe(true);
    if (!op.ok) return;
    const sf = op.state.board.find(p => p.id === 'sf')!;
    expect(sf.output?.slots[0]).toBe('sphere');   // produced from the just-moved plate
    expect(sf.input?.slots.every(s => s === null)).toBe(true); // both inputs consumed
  });

  it('flows at round-end END_ACTIONS, before the next round even begins', () => {
    // The player finished their round-end turn (left the plate uncollected). Ending
    // round-end actions should move it into the connected input immediately.
    const state: GameState = { ...twoFactoryBoard(1), phase: 'roundEnd' };
    const res = applyAction(state, { type: 'END_ACTIONS' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const sf = res.state.board.find(p => p.id === 'sf')!;
    const pf = res.state.board.find(p => p.id === 'pf')!;
    expect(res.state.phase).toBe('placePiece');  // round finalized
    expect(sf.input?.slots).toContain('plate');  // already moved — no roll needed
    expect(pf.output?.slots[0]).toBeNull();
  });
});

// ── Belt-mediated flow (routes material across an intermediate piece) ─────────

describe('belt-mediated delivery into a claimed factory', () => {
  it('routes mine ore through a belt on an adjacent blank into the factory input', () => {
    const base = freshGame();
    const mine = base.board.find(p => p.type === 'mine')!; // (0,0) rot0, lean hex (1,0)
    expect(mineSecondaryCoord(mine.coord, mine.rotation ?? 0)).toEqual({ q: 1, r: 0 });

    // Blank at (2,0) sits between the mine's lean hex (1,0) and the factory (3,0). The
    // belt links the blank's point facing the mine (0) to the point facing the factory's
    // input edge (7), carrying ore across. (A belt sits on ONE piece and routes between
    // its neighbours — it does not feed the piece it is placed on.)
    const blank: BoardPiece = {
      id: 'bk', type: 'blank', coord: { q: 2, r: 0 }, rotation: 0,
      claims: [], input: null, output: null,
    };
    const pf: BoardPiece = {
      id: 'pf', type: 'plateFact', coord: { q: 3, r: 0 }, rotation: 0,
      claims: [{ ownerId: 0, controlModule: 3 }],
      input: { slots: [null], teleporterOwner: null },
      output: { slots: [null], teleporterOwner: null },
    };
    const state: GameState = {
      ...base,
      board: [mine, blank, pf],
      belts: [{ id: 'belt', ownerId: 0, pieceId: 'bk', fromPoint: 0, toPoint: 7 }],
    };

    const after = resolveDirectAdjacency(state);
    expect(after.board.find(p => p.id === 'pf')!.input?.slots[0]).toBe('ore');
  });

  it('chains TWO belts: mine → blank → blank → factory input', () => {
    const base = freshGame();
    const mine = base.board.find(p => p.type === 'mine')!; // (0,0) rot0, lean (1,0)
    const a: BoardPiece = { id: 'a', type: 'blank', coord: { q: 2, r: 0 }, rotation: 0, claims: [], input: null, output: null };
    const b: BoardPiece = { id: 'b', type: 'blank', coord: { q: 3, r: 0 }, rotation: 0, claims: [], input: null, output: null };
    const pf: BoardPiece = {
      id: 'pf', type: 'plateFact', coord: { q: 4, r: 0 }, rotation: 0,
      claims: [{ ownerId: 0, controlModule: 3 }],
      input: { slots: [null], teleporterOwner: null },
      output: { slots: [null], teleporterOwner: null },
    };
    const state: GameState = {
      ...base,
      board: [mine, a, b, pf],
      belts: [
        { id: 'beltA', ownerId: 0, pieceId: 'a', fromPoint: 0, toPoint: 7 }, // mine → A → B
        { id: 'beltB', ownerId: 0, pieceId: 'b', fromPoint: 0, toPoint: 7 }, // B → factory
      ],
    };

    const after = resolveDirectAdjacency(state);
    expect(after.board.find(p => p.id === 'pf')!.input?.slots[0]).toBe('ore'); // ore traveled the whole chain
  });

  it('does NOT deliver to an unclaimed factory (belt feeds owned buildings only)', () => {
    const base = freshGame();
    const mine = base.board.find(p => p.type === 'mine')!;
    const blank: BoardPiece = {
      id: 'bk', type: 'blank', coord: { q: 2, r: 0 }, rotation: 0,
      claims: [], input: null, output: null,
    };
    const pf: BoardPiece = {
      id: 'pf', type: 'plateFact', coord: { q: 3, r: 0 }, rotation: 0,
      claims: [], // unclaimed
      input: { slots: [null], teleporterOwner: null },
      output: { slots: [null], teleporterOwner: null },
    };
    const state: GameState = {
      ...base,
      board: [mine, blank, pf],
      belts: [{ id: 'belt', ownerId: 0, pieceId: 'bk', fromPoint: 0, toPoint: 7 }],
    };
    const after = resolveDirectAdjacency(state);
    expect(after.board.find(p => p.id === 'pf')!.input?.slots[0]).toBeNull();
  });
});

// ── Belt placement: cross-player constraints ──────────────────────────────────

describe('belt placement cross-player rules', () => {
  const mine: BoardPiece = { id: 'mine', type: 'mine', coord: { q: 0, r: 0 }, rotation: 0, claims: [], input: null, output: null };
  const A: BoardPiece = { id: 'A', type: 'blank', coord: { q: 2, r: 0 }, rotation: 0, claims: [], input: null, output: null };
  const B: BoardPiece = { id: 'B', type: 'blank', coord: { q: 3, r: 0 }, rotation: 0, claims: [], input: null, output: null };

  function actionsState(board: BoardPiece[], belts: Belt[] = []): GameState {
    return { ...createGame(1, 2), board, belts, turnOrder: [0, 1], activePlayerIndex: 0, phase: 'actions' };
  }

  it("rejects a belt that would join another player's belt across a seam", () => {
    // Player 1 already has a belt on B using point 0, which is the seam partner of A's
    // point 7. Player 0 placing a belt A 0→7 would connect to it — illegal.
    const state = actionsState([mine, A, B], [{ id: 'p1', ownerId: 1, pieceId: 'B', fromPoint: 0, toPoint: 7 }]);
    const res = applyAction(state, { type: 'PLACE_BELT', pieceId: 'A', fromPoint: 0, toPoint: 7 });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe('BELT_BLOCKED');
  });

  it("rejects a belt that would block another player's building input", () => {
    const opp: BoardPiece = {
      id: 'opp', type: 'plateFact', coord: { q: 3, r: 0 }, rotation: 0,
      claims: [{ ownerId: 1, controlModule: 3 }],
      input: { slots: [null], teleporterOwner: null }, output: { slots: [null], teleporterOwner: null },
    };
    const state = actionsState([mine, A, opp]); // A's point 7 faces the opponent factory's input
    const res = applyAction(state, { type: 'PLACE_BELT', pieceId: 'A', fromPoint: 0, toPoint: 7 });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe('BELT_BLOCKED');
  });

  it('allows a belt that feeds the placing player’s OWN building input', () => {
    const mineYours: BoardPiece = {
      id: 'pf', type: 'plateFact', coord: { q: 3, r: 0 }, rotation: 0,
      claims: [{ ownerId: 0, controlModule: 3 }],
      input: { slots: [null], teleporterOwner: null }, output: { slots: [null], teleporterOwner: null },
    };
    const state = actionsState([mine, A, mineYours]);
    const res = applyAction(state, { type: 'PLACE_BELT', pieceId: 'A', fromPoint: 0, toPoint: 7 });
    expect(res.ok).toBe(true);
  });
});

// ── Mine auto-feed (unlimited, instant ore to directly-connected inputs) ──────

describe('mine direct-adjacency ore supply', () => {
  // On a real starting board every hex around the mine is occupied, so build the
  // mine + adjacent factories directly. Mine-1 is at (0,0) rot 0 → lean hex at (1,0).
  // The lean hex has ore outputs on 3 of its 5 external edges (designer #4/#8/#12);
  // a factory whose input faces an output edge gets ore, one facing a blank edge does not.
  it('delivers ore from a lean-hex output edge, not from a blank edge', () => {
    const base = freshGame();
    const mine = base.board.find(p => p.type === 'mine')!;

    // (2,0) rot 0: input (pos 0) faces the lean hex's #8 ore output (pos 17).
    const onOutput = makePiece({
      id: 'pf-on-output', type: 'plateFact', coord: { q: 2, r: 0 }, rotation: 0,
      claims: [{ ownerId: 0, controlModule: 4 }],
      input: { slots: [null], teleporterOwner: null },
    });
    // (1,1) rot 1: input faces a lean-hex edge with no output (pos 21).
    const onBlank = makePiece({
      id: 'pf-on-blank', type: 'plateFact', coord: { q: 1, r: 1 }, rotation: 1,
      claims: [{ ownerId: 0, controlModule: 4 }],
      input: { slots: [null], teleporterOwner: null },
    });

    const state: GameState = { ...base, board: [mine, onOutput, onBlank] };
    const after = fillInputsFromAdjacentMines(state);

    expect(after.board.find(p => p.id === 'pf-on-output')!.input?.slots[0]).toBe('ore');
    expect(after.board.find(p => p.id === 'pf-on-blank')!.input?.slots[0]).toBeNull();
  });

  it('mine ore flow is recipe-aware: never a 2nd ore into a Sphere Factory', () => {
    const base = freshGame();
    const mine = base.board.find(p => p.type === 'mine')!;

    // Sphere factory at (2,0): its slot-0 input (pos 0) faces the lean-hex ore output.
    // slot 1 is pre-loaded with ore, so delivering ore to slot 0 would make [ore, ore] —
    // not a valid Sphere recipe, so flow must refuse it.
    const blocked = makePiece({
      id: 'sf-blocked', type: 'sphereFact', coord: { q: 2, r: 0 }, rotation: 0,
      claims: [{ ownerId: 0, controlModule: 4 }],
      input: { slots: [null, 'ore'], teleporterOwner: null },
    });
    const afterBlocked = fillInputsFromAdjacentMines({ ...base, board: [mine, blocked] });
    expect(afterBlocked.board.find(p => p.id === 'sf-blocked')!.input?.slots[0]).toBeNull(); // refused

    // Control: with a plate in slot 1, ore → slot 0 makes [ore, plate], a valid recipe, so it flows.
    const allowed = makePiece({
      id: 'sf-allowed', type: 'sphereFact', coord: { q: 2, r: 0 }, rotation: 0,
      claims: [{ ownerId: 0, controlModule: 4 }],
      input: { slots: [null, 'plate'], teleporterOwner: null },
    });
    const afterAllowed = fillInputsFromAdjacentMines({ ...base, board: [mine, allowed] });
    expect(afterAllowed.board.find(p => p.id === 'sf-allowed')!.input?.slots[0]).toBe('ore'); // delivered
  });
});

// ── Teleporter — output (inventory cap overflow) ───────────────────────────────

describe('output teleporter', () => {
  it('diverts produced material to inventory when there is space', () => {
    const base = freshGame();

    const piece = makePiece({
      id: 'pf-tele-out',
      type: 'plateFact',
      claims: [{ ownerId: 0, controlModule: 5 }],
      // Input has ore ready; output teleporter owned by Player 0
      input: { slots: ['ore'], teleporterOwner: null },
      output: { slots: [null], teleporterOwner: 0 },
    });

    const state: GameState = {
      ...base,
      board: [...base.board, piece],
      players: base.players.map((p, i): Player =>
        i === 0
          ? { ...p, powerTokens: 10, inventory: { ...p.inventory, plate: 2 } }
          : p,
      ) as ReadonlyArray<Player>,
      phase: 'roll',
    };

    // Roll → active player's factory goes to pending
    const rollRes = applyAction(state, { type: 'ROLL_DICE', rolls: [5] });
    expect(rollRes.ok).toBe(true);
    if (!rollRes.ok) return;

    // Operate → output teleporter diverts plate to inventory
    const opRes = applyAction(rollRes.state, { type: 'OPERATE_BUILDING', pieceId: 'pf-tele-out' });
    expect(opRes.ok).toBe(true);
    if (!opRes.ok) return;

    const outPiece = opRes.state.board.find(p => p.id === 'pf-tele-out')!;
    // Output buffer cleared — plate went to inventory via teleporter
    expect(outPiece.output?.slots[0]).toBeNull();
    // Inventory gained 1 plate (2 + 1 = 3)
    expect(opRes.state.players[0]?.inventory.plate).toBe(3);
  });

  it('leaves product in output buffer when inventory is at cap (overflow)', () => {
    const base = freshGame();

    const piece = makePiece({
      id: 'pf-tele-cap',
      type: 'plateFact',
      claims: [{ ownerId: 0, controlModule: 5 }],
      input: { slots: ['ore'], teleporterOwner: null },
      output: { slots: [null], teleporterOwner: 0 },
    });

    // Player 0's plate inventory is at the cap
    const state: GameState = {
      ...base,
      board: [...base.board, piece],
      players: base.players.map((p, i): Player =>
        i === 0
          ? { ...p, powerTokens: 10, inventory: { ...p.inventory, plate: INVENTORY_CAP } }
          : p,
      ) as ReadonlyArray<Player>,
      phase: 'roll',
    };

    // Roll → active player's factory goes to pending
    const rollRes = applyAction(state, { type: 'ROLL_DICE', rolls: [5] });
    expect(rollRes.ok).toBe(true);
    if (!rollRes.ok) return;

    // Operate → teleporter can't divert (inventory full) → plate stays in output buffer
    const opRes = applyAction(rollRes.state, { type: 'OPERATE_BUILDING', pieceId: 'pf-tele-cap' });
    expect(opRes.ok).toBe(true);
    if (!opRes.ok) return;

    const outPiece = opRes.state.board.find(p => p.id === 'pf-tele-cap')!;
    // Overflow: plate stays in output buffer because inventory was full
    expect(outPiece.output?.slots[0]).toBe('plate');
    // Inventory unchanged
    expect(opRes.state.players[0]?.inventory.plate).toBe(INVENTORY_CAP);
  });
});

// ── PLACE_TELEPORTER action ───────────────────────────────────────────────────

describe('PLACE_TELEPORTER action', () => {
  it('places a teleporter on a claimed building\'s input buffer', () => {
    const base = freshGame();

    const piece = makePiece({
      id: 'pf-claim',
      type: 'plateFact',
      claims: [{ ownerId: 0, controlModule: 4 }],
    });

    const state: GameState = {
      ...base,
      board: [...base.board, piece],
      // Player 0 has 1 ore to pay the first teleporter cost (1 unit)
      players: base.players.map((p, i): Player =>
        i === 0
          ? { ...p, inventory: { ...p.inventory, ore: 1 } }
          : p,
      ) as ReadonlyArray<Player>,
      phase: 'actions',
    };

    const res = applyAction(state, {
      type: 'PLACE_TELEPORTER',
      pieceId: 'pf-claim',
      bufferType: 'input',
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const outPiece = res.state.board.find(p => p.id === 'pf-claim')!;
    expect(outPiece.input?.teleporterOwner).toBe(0);
    expect(res.state.globalTeleporterCount).toBe(1);
    expect(res.state.players[0]?.teleportersRemaining).toBe(3); // 4 - 1
    expect(res.state.players[0]?.inventory.ore).toBe(0); // 1 ore paid
  });

  it('rejects placement on a building the player does not own', () => {
    const base = freshGame();

    // Owned by Player 1, but Player 0 (active) tries to place
    const piece = makePiece({
      id: 'pf-other',
      type: 'plateFact',
      claims: [{ ownerId: 1, controlModule: 4 }],
    });

    const state: GameState = {
      ...base,
      board: [...base.board, piece],
      players: base.players.map((p, i): Player =>
        i === 0 ? { ...p, inventory: { ...p.inventory, ore: 5 } } : p,
      ) as ReadonlyArray<Player>,
      activePlayerIndex: 0,
      phase: 'actions',
    };

    const res = applyAction(state, {
      type: 'PLACE_TELEPORTER',
      pieceId: 'pf-other',
      bufferType: 'input',
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe('NOT_YOUR_BUILDING');
  });

  it('rejects a second teleporter on the same buffer', () => {
    const base = freshGame();

    const piece = makePiece({
      id: 'pf-dup',
      type: 'plateFact',
      claims: [{ ownerId: 0, controlModule: 4 }],
      input: { slots: [null], teleporterOwner: 0 }, // already teleported
    });

    const state: GameState = {
      ...base,
      board: [...base.board, piece],
      players: base.players.map((p, i): Player =>
        i === 0 ? { ...p, inventory: { ...p.inventory, ore: 5 } } : p,
      ) as ReadonlyArray<Player>,
      globalTeleporterCount: 1,
      phase: 'actions',
    };

    const res = applyAction(state, {
      type: 'PLACE_TELEPORTER',
      pieceId: 'pf-dup',
      bufferType: 'input',
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe('BUFFER_OCCUPIED');
  });
});

// ── PLACE_BELT / REMOVE_BELT actions ─────────────────────────────────────────

describe('PLACE_BELT action', () => {
  it('places a belt linking two valid connection points', () => {
    const base = freshGame();

    const piece = makePiece({ id: 'blank-1', type: 'blank', coord: { q: 1, r: 0 } });

    const state: GameState = {
      ...base,
      board: [...base.board, piece],
      players: base.players.map((p, i): Player =>
        i === 0 ? { ...p, inventory: { ...p.inventory, ore: 1 } } : p,
      ) as ReadonlyArray<Player>,
      phase: 'actions',
    };

    // Points 0 and 3 on the 12-position grid: circular distance min(3,9)=3 > 2. Valid.
    // Both are belt-role positions on a blank piece.
    const res = applyAction(state, {
      type: 'PLACE_BELT',
      pieceId: 'blank-1',
      fromPoint: 0,
      toPoint: 3,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    expect(res.state.belts).toHaveLength(1);
    expect(res.state.belts[0]?.fromPoint).toBe(0);
    expect(res.state.belts[0]?.toPoint).toBe(3);
    expect(res.state.belts[0]?.ownerId).toBe(0);
    expect(res.state.players[0]?.beltsRemaining).toBe(4); // 5 - 1
    expect(res.state.players[0]?.inventory.ore).toBe(1);  // free — no ore deducted
  });

  it('rejects points that are ≤ 2 apart (too close)', () => {
    const base = freshGame();
    const piece = makePiece({ id: 'blank-2', type: 'blank', coord: { q: 1, r: 0 } });
    const state: GameState = {
      ...base,
      board: [...base.board, piece],
      players: base.players.map((p, i): Player =>
        i === 0 ? { ...p, inventory: { ...p.inventory, ore: 1 } } : p,
      ) as ReadonlyArray<Player>,
      phase: 'actions',
    };

    // Points 0 and 2 → circular distance 2 (not > 2)
    const res = applyAction(state, {
      type: 'PLACE_BELT',
      pieceId: 'blank-2',
      fromPoint: 0,
      toPoint: 2,
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe('POINTS_TOO_CLOSE');
  });

  it('rejects belt placement on a mine (mines have no belt connection points)', () => {
    const base = freshGame();
    const mine = base.board.find(p => p.type === 'mine')!;

    const state: GameState = {
      ...base,
      players: base.players.map((p, i): Player =>
        i === 0 ? { ...p, inventory: { ...p.inventory, ore: 5 } } : p,
      ) as ReadonlyArray<Player>,
      phase: 'actions',
    };

    // Mines have only ore_output and disabled positions — no belt points.
    const res = applyAction(state, {
      type: 'PLACE_BELT',
      pieceId: mine.id,
      fromPoint: 0,
      toPoint: 6, // would be ore_output positions, not belt
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe('NOT_A_BELT_POINT');
  });
});

describe('REMOVE_BELT action', () => {
  it('removes an owned belt and returns it to supply', () => {
    const base = freshGame();
    const piece = makePiece({ id: 'blank-r', type: 'blank', coord: { q: 1, r: 0 } });

    const existingBelt = {
      id: 'belt-p0-blank-r-0-3',
      ownerId: 0 as const,
      pieceId: 'blank-r',
      fromPoint: 0,
      toPoint: 3,
    };

    const state: GameState = {
      ...base,
      board: [...base.board, piece],
      belts: [existingBelt],
      players: base.players.map((p, i): Player =>
        i === 0 ? { ...p, beltsRemaining: 4 } : p, // 1 belt already placed
      ) as ReadonlyArray<Player>,
      phase: 'actions',
    };

    const res = applyAction(state, { type: 'REMOVE_BELT', beltId: existingBelt.id });
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    expect(res.state.belts).toHaveLength(0);
    expect(res.state.players[0]?.beltsRemaining).toBe(5); // returned to supply
  });

  it('rejects removing another player\'s belt', () => {
    const base = freshGame();

    const foreignBelt = {
      id: 'belt-p1-x-0-3',
      ownerId: 1 as const,
      pieceId: 'x',
      fromPoint: 0,
      toPoint: 3,
    };

    const state: GameState = {
      ...base,
      belts: [foreignBelt],
      phase: 'actions',
    };

    const res = applyAction(state, { type: 'REMOVE_BELT', beltId: foreignBelt.id });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe('NOT_YOUR_BELT');
  });
});
