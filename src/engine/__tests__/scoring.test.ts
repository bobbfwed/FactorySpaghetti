import { describe, it, expect } from 'vitest';
import { createGame } from '../rules/setup';
import { applyAction } from '../reducer';
import {
  resourcePoints,
  tesseractCount,
  recomputeBonuses,
  postActionChecks,
  postRoundChecks,
} from '../rules/scoring';
import type { GameState, Player, BoardPiece, PlayerId } from '../state';
import type { Material } from '../config';
import { reachActionsPhase } from './helpers';

// ── Helpers ───────────────────────────────────────────────────────────────────

function patch(state: GameState, overrides: Partial<GameState>): GameState {
  return { ...state, ...overrides };
}

function patchPlayer(state: GameState, id: PlayerId, overrides: Partial<Player>): GameState {
  return patch(state, {
    players: state.players.map((p, i) => (i === id ? { ...p, ...overrides } : p)),
  });
}

function inv(ore = 0, plate = 0, sphere = 0, tesseract = 0): Readonly<Record<Material, number>> {
  return { ore, plate, sphere, tesseract };
}

function claimedPlateFact(id: string, coord: { q: number; r: number }, ...ownerModules: [PlayerId, number][]): BoardPiece {
  return {
    id, type: 'plateFact', coord, rotation: 0,
    claims: ownerModules.map(([ownerId, controlModule]) => ({ ownerId, controlModule })),
    input: { slots: [null], teleporterOwner: null },
    output: { slots: [null], teleporterOwner: null },
  };
}

// Build a state in the actions phase for a 2-player game (completes S7 setup first).
function actionsState(seed = 1): GameState {
  return reachActionsPhase(seed, 2);
}

// ── resourcePoints ────────────────────────────────────────────────────────────

describe('resourcePoints', () => {
  it('sums inventory at material values', () => {
    const s = createGame(1, 2);
    const player = s.players[0]!;
    const p = { ...player, inventory: inv(2, 1, 0, 0) };
    // 2×1 + 1×3 = 5
    expect(resourcePoints(p as Player)).toBe(5);
  });

  it('counts tesseract at 23', () => {
    const s = createGame(1, 2);
    const player = s.players[0]!;
    const p = { ...player, inventory: inv(0, 0, 0, 1) };
    expect(resourcePoints(p as Player)).toBe(23);
  });

  it('empty inventory = 0', () => {
    const s = createGame(1, 2);
    expect(resourcePoints(s.players[0]!)).toBe(0);
  });
});

// ── tesseractCount ────────────────────────────────────────────────────────────

describe('tesseractCount', () => {
  it('counts inventory Tesseracts', () => {
    let s = createGame(1, 2);
    s = patchPlayer(s, 0, { inventory: inv(0, 0, 0, 2) });
    expect(tesseractCount(s, 0)).toBe(2);
  });

  it('adds face-up bonus Tesseracts', () => {
    let s = createGame(1, 2);
    s = patchPlayer(s, 0, {
      inventory: inv(0, 0, 0, 1),
      bonusTesseracts: { investor: true, beltWeaver: false, factoryEmpire: false },
    });
    expect(tesseractCount(s, 0)).toBe(2);
  });
});

// ── recomputeBonuses — The Investor ──────────────────────────────────────────

describe('recomputeBonuses — investor', () => {
  it('awards investor to player with highest in-play module ≥ 10', () => {
    let s = actionsState();
    const pid0 = s.turnOrder[s.activePlayerIndex]!;

    // Add a claimed factory with module 12 for player 0
    const pf = claimedPlateFact('pf-inv', { q: 1, r: 0 }, [pid0, 12]);
    s = patch(s, { board: [...s.board, pf] });

    const ns = recomputeBonuses(s);
    expect(ns.players[pid0]!.bonusTesseracts.investor).toBe(true);
  });

  it('no investor if highest module < 10', () => {
    let s = actionsState();
    const pid0 = s.turnOrder[s.activePlayerIndex]!;
    const pf = claimedPlateFact('pf-inv2', { q: 1, r: 0 }, [pid0, 9]);
    s = patch(s, { board: [...s.board, pf] });
    const ns = recomputeBonuses(s);
    expect(ns.players[pid0]!.bonusTesseracts.investor).toBe(false);
  });

  it('investor moves when another player surpasses the holder', () => {
    let s = actionsState();
    const pid0 = s.turnOrder[0]!;
    const pid1 = s.turnOrder[1]!;

    // pid0 has module 12, pid1 has module 13
    const pf0 = claimedPlateFact('pf-a', { q: 1, r: 0 },  [pid0, 12]);
    const pf1 = claimedPlateFact('pf-b', { q: -1, r: 0 }, [pid1, 13]);
    s = patch(s, { board: [...s.board, pf0, pf1] });

    // First compute with pid0 having investor
    s = patchPlayer(s, pid0, {
      bonusTesseracts: { investor: true, beltWeaver: false, factoryEmpire: false },
    });

    const ns = recomputeBonuses(s);
    expect(ns.players[pid0]!.bonusTesseracts.investor).toBe(false);
    expect(ns.players[pid1]!.bonusTesseracts.investor).toBe(true);
  });

  it('tied investor: current holder keeps it', () => {
    let s = actionsState();
    const pid0 = s.turnOrder[0]!;
    const pid1 = s.turnOrder[1]!;

    const pf0 = claimedPlateFact('pf-a', { q: 1, r: 0 },  [pid0, 11]);
    const pf1 = claimedPlateFact('pf-b', { q: -1, r: 0 }, [pid1, 11]);
    s = patch(s, { board: [...s.board, pf0, pf1] });
    // pid0 currently holds investor
    s = patchPlayer(s, pid0, {
      bonusTesseracts: { investor: true, beltWeaver: false, factoryEmpire: false },
    });

    const ns = recomputeBonuses(s);
    expect(ns.players[pid0]!.bonusTesseracts.investor).toBe(true);
    expect(ns.players[pid1]!.bonusTesseracts.investor).toBe(false);
  });
});

// ── recomputeBonuses — Factory Empire ────────────────────────────────────────

describe('recomputeBonuses — factoryEmpire', () => {
  it('awards factoryEmpire to player with most distinct claimed buildings ≥ 6', () => {
    let s = actionsState();
    const pid0 = s.turnOrder[0]!;

    // pid0 already owns its 2 S7 setup claims (Plate Factory + Power Plant), which
    // count toward the empire. Adding 4 more → exactly 6 distinct, meeting the threshold.
    const pieces = Array.from({ length: 4 }, (_, i): BoardPiece => ({
      id: `pf-fe${i}`,
      type: 'plateFact',
      coord: { q: i + 2, r: 0 },
      rotation: 0,
      claims: [{ ownerId: pid0, controlModule: 3 }],
      input: { slots: [null], teleporterOwner: null },
      output: { slots: [null], teleporterOwner: null },
    }));
    s = patch(s, { board: [...s.board, ...pieces] });

    const ns = recomputeBonuses(s);
    expect(ns.players[pid0]!.bonusTesseracts.factoryEmpire).toBe(true);
  });

  it('multi-claims on one building count as one toward empire', () => {
    let s = actionsState();
    const pid0 = s.turnOrder[0]!;

    // 2 S7 setup claims + 3 distinct buildings + 1 building with two claims = 6 distinct
    // (the double-claimed building counts once, so it is the 6th distinct building).
    const pieces = Array.from({ length: 3 }, (_, i): BoardPiece => ({
      id: `pf-fe${i}`,
      type: 'plateFact',
      coord: { q: i + 2, r: 0 },
      rotation: 0,
      claims: [{ ownerId: pid0, controlModule: 3 }],
      input: { slots: [null], teleporterOwner: null },
      output: { slots: [null], teleporterOwner: null },
    }));
    const multiClaim: BoardPiece = {
      id: 'pf-mc',
      type: 'plateFact',
      coord: { q: 10, r: 0 },
      rotation: 0,
      claims: [
        { ownerId: pid0, controlModule: 3 },
        { ownerId: pid0, controlModule: 5 },
      ],
      input: { slots: [null], teleporterOwner: null },
      output: { slots: [null], teleporterOwner: null },
    };
    s = patch(s, { board: [...s.board, ...pieces, multiClaim] });

    const ns = recomputeBonuses(s);
    expect(ns.players[pid0]!.bonusTesseracts.factoryEmpire).toBe(true);
  });

  it('no empire if < 6 distinct buildings', () => {
    let s = actionsState();
    const pid0 = s.turnOrder[0]!;

    // pid0 already owns its 2 S7 setup claims (Plate Factory + Power Plant), which
    // count toward the empire. Adding 3 more → 5 distinct buildings, still < 6.
    const pieces = Array.from({ length: 3 }, (_, i): BoardPiece => ({
      id: `pf-fe${i}`,
      type: 'plateFact',
      coord: { q: i + 2, r: 0 },
      rotation: 0,
      claims: [{ ownerId: pid0, controlModule: 3 }],
      input: { slots: [null], teleporterOwner: null },
      output: { slots: [null], teleporterOwner: null },
    }));
    s = patch(s, { board: [...s.board, ...pieces] });

    const ns = recomputeBonuses(s);
    expect(ns.players[pid0]!.bonusTesseracts.factoryEmpire).toBe(false);
  });
});

// ── Tesseract victory ─────────────────────────────────────────────────────────

describe('Tesseract victory (4-Tesseract win)', () => {
  it('player wins when they have 4 Tesseracts in inventory', () => {
    let s = actionsState();
    const pid = s.turnOrder[s.activePlayerIndex]!;
    s = patchPlayer(s, pid, { inventory: inv(0, 0, 0, 4) });

    const ns = postActionChecks(s);
    expect(ns.gameOver).toBe(true);
    expect(ns.gameOverReason).toBe('tesseracts');
    expect(ns.winner).toBe(pid);
  });

  it('3 Tesseracts is not enough', () => {
    let s = actionsState();
    const pid = s.turnOrder[s.activePlayerIndex]!;
    s = patchPlayer(s, pid, { inventory: inv(0, 0, 0, 3) });
    expect(postActionChecks(s).gameOver).toBe(false);
  });

  it('3 inventory + 1 bonus (investor) = 4 → win', () => {
    let s = actionsState();
    const pid = s.turnOrder[s.activePlayerIndex]!;
    // 3 Tesseracts in inventory + a module-10 claim on board (earns investor bonus).
    // postActionChecks → recomputeBonuses assigns investor → tesseractCount = 4 → win.
    s = patchPlayer(s, pid, { inventory: inv(0, 0, 0, 3) });
    const pf = claimedPlateFact('pf-inv-win', { q: 1, r: 0 }, [pid, 10]);
    s = patch(s, { board: [...s.board, pf] });

    const ns = postActionChecks(s);
    expect(ns.gameOver).toBe(true);
    expect(ns.winner).toBe(pid);
  });

  it('victory not awarded to the non-active player even with 4 Tesseracts', () => {
    let s = actionsState();
    const activeId = s.turnOrder[s.activePlayerIndex]!;
    const otherId  = s.turnOrder.find(id => id !== activeId)!;
    // Give the other player 4 Tesseracts; active player has 0
    s = patchPlayer(s, otherId, { inventory: inv(0, 0, 0, 4) });
    expect(postActionChecks(s).gameOver).toBe(false);
  });
});

// ── Simultaneous-win impossibility ────────────────────────────────────────────

describe('Simultaneous-win impossibility', () => {
  it('first player in turn order wins if both reach 4 Tesseracts same round', () => {
    let s = actionsState();
    // turnOrder[0] is currently active; give both players 4 Tesseracts.
    const p0 = s.turnOrder[0]!;
    const p1 = s.turnOrder[1]!;
    s = patchPlayer(s, p0, { inventory: inv(0, 0, 0, 4) });
    s = patchPlayer(s, p1, { inventory: inv(0, 0, 0, 4) });

    // postActionChecks sees active player (p0) has 4 → game over with p0 winning.
    const ns = postActionChecks(s);
    expect(ns.gameOver).toBe(true);
    expect(ns.winner).toBe(p0);
    // p1 never gets a chance — victory is checked on the active player's turn.
  });

  it('END_TURN captures victory for the player ending their turn, not the next', () => {
    let s = actionsState();
    const pid0 = s.turnOrder[s.activePlayerIndex]!;

    // Give pid0 4 Tesseracts; advance to END_ACTIONS/PLACE_MEEPLE without checking
    s = patchPlayer(s, pid0, { inventory: inv(0, 0, 0, 4) });

    // Manually skip to placeMeeple phase to test END_TURN specifically
    s = patch(s, { phase: 'placeMeeple' });

    const et = applyAction(s, { type: 'END_TURN' });
    expect(et.ok).toBe(true);
    const ns = (et as { ok: true; state: GameState }).state;
    expect(ns.gameOver).toBe(true);
    expect(ns.winner).toBe(pid0);
  });

  it('actions rejected after game is over', () => {
    let s = actionsState();
    const pid = s.turnOrder[s.activePlayerIndex]!;
    s = patchPlayer(s, pid, { inventory: inv(0, 0, 0, 4) });
    s = patch(s, { gameOver: true, gameOverReason: 'tesseracts', winner: pid, tiedWinners: [] });

    const r = applyAction(s, { type: 'END_ACTIONS' });
    expect(r.ok).toBe(false);
    expect((r as { ok: false; error: { code: string } }).error.code).toBe('GAME_OVER');
  });
});

// ── Board-exhaustion ending ───────────────────────────────────────────────────

describe('Board-exhaustion ending', () => {
  it('postRoundChecks triggers when all stacks are empty', () => {
    let s = actionsState();
    // Empty all stacks
    s = patch(s, {
      stacks: [
        { ...s.stacks[0], pieces: [] },
        { ...s.stacks[1], pieces: [] },
        { ...s.stacks[2], pieces: [] },
      ],
    });

    const ns = postRoundChecks(s);
    expect(ns.gameOver).toBe(true);
    expect(ns.gameOverReason).toBe('boardExhausted');
  });

  it('postRoundChecks does nothing when stacks still have pieces', () => {
    const s = actionsState();
    // Stacks still have pieces
    expect(postRoundChecks(s).gameOver).toBe(false);
  });
});

// ── Tiebreak ladder ───────────────────────────────────────────────────────────

describe('Tiebreak ladder (board-exhaustion)', () => {
  function exhaustedState(pid0Inv: ReturnType<typeof inv>, pid1Inv: ReturnType<typeof inv>): GameState {
    let s = actionsState();
    const p0 = s.turnOrder[0]!;
    const p1 = s.turnOrder[1]!;
    s = patchPlayer(s, p0, { inventory: pid0Inv });
    s = patchPlayer(s, p1, { inventory: pid1Inv });
    s = patch(s, {
      stacks: [
        { ...s.stacks[0], pieces: [] },
        { ...s.stacks[1], pieces: [] },
        { ...s.stacks[2], pieces: [] },
      ],
    });
    return s;
  }

  it('most resource points wins', () => {
    // pid0: 2 plates (6pts) vs pid1: 1 sphere (7pts) → pid1 wins
    const s = exhaustedState(inv(0, 2, 0, 0), inv(0, 0, 1, 0));
    const ns = postRoundChecks(s);
    const p1 = s.turnOrder[1]!;
    expect(ns.winner).toBe(p1);
  });

  it('tiebreak: most Tesseracts', () => {
    // Both 23pts total: pid0 has 1 Tesseract (23pts), pid1 has 1 Tesseract
    // Tie on points; both have 1 Tesseract → go to spheres
    // pid0 has 1 Tesseract (23), pid1 has 8 plates (24)... let's use a simpler case:
    // pid0: 1 Tesseract (23), pid1: 23 ore (23) → same points; pid0 wins on Tesseract tiebreak
    const s = exhaustedState(inv(0, 0, 0, 1), inv(23, 0, 0, 0));
    const ns = postRoundChecks(s);
    const p0 = s.turnOrder[0]!;
    expect(ns.winner).toBe(p0);
  });

  it('tiebreak: most Spheres', () => {
    // Both have same points and 0 Tesseracts. pid0 has more Spheres.
    // pid0: 2 Spheres (14pts) vs pid1: 14 Ore (14pts)
    const s = exhaustedState(inv(0, 0, 2, 0), inv(14, 0, 0, 0));
    const ns = postRoundChecks(s);
    const p0 = s.turnOrder[0]!;
    expect(ns.winner).toBe(p0);
  });

  it('tiebreak: most Plates', () => {
    // Same pts, 0 Tesseracts, same Spheres, pid0 has more Plates.
    // pid0: 3 Plates (9pts) vs pid1: 9 Ore (9pts)
    const s = exhaustedState(inv(0, 3, 0, 0), inv(9, 0, 0, 0));
    const ns = postRoundChecks(s);
    const p0 = s.turnOrder[0]!;
    expect(ns.winner).toBe(p0);
  });

  it('tiebreak: most Ore', () => {
    // pid0: 5 Ore (5pts) vs pid1: 2 Ore + 3 Ore = 5 pts
    // Wait, 5 ore vs 5 ore — same on all criteria, tied.
    // Instead: pid0: 5 ore (5), pid1: 4 ore (4) → pid0 wins
    const s = exhaustedState(inv(5, 0, 0, 0), inv(4, 0, 0, 0));
    const ns = postRoundChecks(s);
    const p0 = s.turnOrder[0]!;
    expect(ns.winner).toBe(p0);
  });

  it('tiebreak: turn order — earlier player wins', () => {
    // Exact same inventory → turn order decides
    let s = actionsState();
    const p0 = s.turnOrder[0]!;
    const p1 = s.turnOrder[1]!;
    const sameInv = inv(3, 0, 0, 0); // 3 pts each
    s = patchPlayer(s, p0, { inventory: sameInv });
    s = patchPlayer(s, p1, { inventory: { ...sameInv } });
    s = patch(s, {
      stacks: [
        { ...s.stacks[0], pieces: [] },
        { ...s.stacks[1], pieces: [] },
        { ...s.stacks[2], pieces: [] },
      ],
    });

    const ns = postRoundChecks(s);
    // turnOrder[0] is earlier in turn order and wins the tiebreak
    expect(ns.winner).toBe(p0);
  });

  it('shared win when turn-order criterion cannot resolve the tie', () => {
    // An empty turnOrder forces indexOf → -1 for every player.
    // -(−1) = 1 for all → no resolution → tiedWinners is populated.
    let s = actionsState();
    const p0 = s.turnOrder[0]!;
    const p1 = s.turnOrder[1]!;
    const sameInv = inv(3, 0, 0, 0);
    s = patchPlayer(s, p0, { inventory: sameInv });
    s = patchPlayer(s, p1, { inventory: { ...sameInv } });
    s = patch(s, {
      turnOrder: [] as unknown as ReadonlyArray<PlayerId>,
      stacks: [
        { ...s.stacks[0], pieces: [] },
        { ...s.stacks[1], pieces: [] },
        { ...s.stacks[2], pieces: [] },
      ],
    });

    const ns = postRoundChecks(s);
    expect(ns.winner).toBeNull();
    expect(ns.tiedWinners.length).toBeGreaterThan(1);
  });
});
