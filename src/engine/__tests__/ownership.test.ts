// Ownership: nothing crosses between players (RULES_CHANGES.md #57, #58, designer's decision
// 2026-11-27). One owner per building; a building that loses its owner forfeits its material to
// the bank and its Teleporters go back to their placer; an unclaimed building holds, receives and
// feeds nothing; round-end meeple actions need a claim.

import { describe, it, expect } from 'vitest';
import { createGame } from '../rules/setup';
import { applyAction, legalActions } from '../reducer';
import { resolveDirectAdjacency } from '../rules/flow';
import { hasTwoOwners, lossIfModuleLeaves, mayAddClaim, settleLostClaims } from '../rules/ownership';
import { teleporterCost } from '../config';
import type { Material } from '../config';
import type { Action } from '../actions';
import { sameMove } from '../actions';
import type { Belt, BoardPiece, GameState, Player, PlayerId } from '../state';
import { expectOk } from './helpers';

type Claims = BoardPiece['claims'];

const code = (s: GameState, a: Action): string | null => { const r = applyAction(s, a); return r.ok ? null : r.error.code; };
const listed = (s: GameState, a: Action, who: PlayerId): boolean => legalActions(s, who).some(l => sameMove(l, a));
const find = (s: GameState, id: string): BoardPiece => s.board.find(p => p.id === id)!;
const of = (p: PlayerId, ...modules: number[]): Claims => modules.map(controlModule => ({ ownerId: p, controlModule }));

function patchPlayer(s: GameState, p: PlayerId, patch: Partial<Player>): GameState {
  return { ...s, players: s.players.map((x, i) => (i === p ? { ...x, ...patch } : x)) };
}

/** A building at (q, 0), far from the Mine unless placed next to it. */
function building(id: string, type: BoardPiece['type'], claims: Claims, q: number, opts: {
  input?: Array<Material | null>; output?: Material | null; inTele?: Array<PlayerId | null>; outTele?: PlayerId | null; rotation?: number;
} = {}): BoardPiece {
  const n = type === 'plateFact' || type === 'powerPlant' ? 1 : type === 'sphereFact' ? 2 : 3;
  const hasOutput = type !== 'powerPlant';
  return {
    id, type, coord: { q, r: 0 }, rotation: opts.rotation ?? 0, claims,
    input: { slots: opts.input ?? new Array(n).fill(null), teleporters: opts.inTele ?? [] },
    output: hasOutput ? { slots: [opts.output ?? null], teleporters: opts.outTele == null ? [] : [opts.outTele] } : null,
  };
}

/** A 2-player game on Mine 1 plus `extra`, player `active` to move, in `phase`. */
function onBoard(extra: BoardPiece[], phase: GameState['phase'], active: PlayerId = 0, belts: Belt[] = []): GameState {
  const g = createGame(1, 2);
  return {
    ...g, board: [g.board.find(p => p.id === 'mine-1')!, ...extra], belts, phase,
    turnOrder: [active, active === 0 ? 1 : 0], activePlayerIndex: 0, cardsPlayedThisTurn: 0, pendingFactoryOps: [],
  };
}

// ── A: one owner per building (#57) ───────────────────────────────────────────

describe('one owner per building: every claiming route refuses another player\'s building (#57)', () => {
  const theirs = building('T', 'sphereFact', of(1, 5), 50);
  const free = building('U', 'sphereFact', [], 52);
  const own = building('O', 'plateFact', of(0, 4), 54);
  const base = (phase: GameState['phase']): GameState => onBoard([theirs, free, own], phase);

  it('CLAIM_BUILDING paid by Production Increase', () => {
    const s = { ...base('actions'), productionIncreaseBudget: 4 };
    const a = (pieceId: string): Action => ({ type: 'CLAIM_BUILDING', pieceId, controlModule: 2, fromProductionIncrease: true });
    expect(code(s, a('T'))).toBe('ALREADY_CLAIMED');
    expect(listed(s, a('T'), 0)).toBe(false);
    for (const id of ['U', 'O']) {
      expect(code(s, a(id)), id).toBeNull();
      expect(listed(s, a(id), 0), id).toBe(true);
    }
  });

  it('CLAIM_BUILDING with the Mine upgrade point\'s free claim, in the round-end turn', () => {
    const s = patchPlayer(base('roundEnd'), 0, { freeActionCredits: 3, freeClaimUsed: false });
    const a = (pieceId: string): Action => ({ type: 'CLAIM_BUILDING', pieceId, controlModule: 2, fromFreeClaim: true });
    expect(code(s, a('T'))).toBe('ALREADY_CLAIMED');
    expect(listed(s, a('T'), 0)).toBe(false);
    expect(code(s, a('U'))).toBeNull();
    expect(listed(s, a('U'), 0)).toBe(true);
  });

  it('Short Sale and Changing Priorities', () => {
    const s = patchPlayer(base('actions'), 0, { hand: ['shortSale', 'changingPriorities'] });
    const ss = (pieceId: string): Action => ({ type: 'PLAY_CARD', cardType: 'shortSale', pieceId });
    const cp = (toPieceId: string): Action => ({ type: 'PLAY_CARD', cardType: 'changingPriorities', pieceId: 'O', toPieceId, controlModule: 4 });
    for (const a of [ss('T'), cp('T')]) {
      expect(code(s, a)).toBe('ALREADY_CLAIMED');
      expect(listed(s, a, 0)).toBe(false);
    }
    expect(code(s, ss('U'))).toBeNull();
    expect(code(s, cp('U'))).toBeNull();
  });

  it('the setup claims', () => {
    const pf = building('P', 'plateFact', of(1, 3), 50);
    const s = onBoard([pf, building('Q', 'plateFact', [], 52)], 'setupClaimPF');
    expect(code(s, { type: 'SETUP_CLAIM', pieceId: 'P' })).toBe('ALREADY_CLAIMED');
    expect(legalActions(s, 0).some(a => a.type === 'SETUP_CLAIM' && a.pieceId === 'P')).toBe(false);
  });

  it('the shared test, mayAddClaim, also refuses a building that already has two owners', () => {
    const shared = of(0, 4).concat(of(1, 5));
    expect(hasTwoOwners({ claims: shared })).toBe(true);
    expect(mayAddClaim({ claims: shared }, 0)).toBe(false);
    expect(mayAddClaim({ claims: shared }, 1)).toBe(false);
    expect(mayAddClaim({ claims: of(0, 4, 6) }, 0)).toBe(true);
    expect(mayAddClaim({ claims: [] }, 1)).toBe(true);
  });
});

// ── B: a building that loses its owner forfeits its material (#58) ─────────────

describe('a building that loses its owner forfeits its material to the bank (#58)', () => {
  // Player 0's Sphere Factory S with material in both inputs and the output, and a Teleporter
  // of theirs on each input and on the output; Changing Priorities moves module 4 to P.
  const S = (claims: Claims): BoardPiece => building('S', 'sphereFact', claims, 50, {
    input: ['ore', 'plate'], output: 'sphere', inTele: [0, 0], outTele: 0,
  });
  const P = building('P', 'plateFact', of(0, 6), 54);
  const start = (claims: Claims): GameState => patchPlayer(
    { ...onBoard([S(claims), P], 'actions'), globalTeleporterCount: 3 },
    0, { hand: ['changingPriorities'], teleportersRemaining: 1, powerTokens: 5, inventory: { ore: 2, plate: 1, sphere: 0, tesseract: 0 } },
  );
  const move: Action = { type: 'PLAY_CARD', cardType: 'changingPriorities', pieceId: 'S', toPieceId: 'P', controlModule: 4 };

  it('moving the last Control Module: inputs and output emptied, Teleporters back, price drops, the module arrives', () => {
    const s = start(of(0, 4));
    expect(lossIfModuleLeaves(find(s, 'S'), 0)).toEqual({ materials: 3, teleporters: 3 });
    expect(teleporterCost(s.globalTeleporterCount)).toBe(4);
    const after = expectOk(applyAction(s, move));
    const left = find(after, 'S');
    expect(left.claims).toEqual([]);
    expect(left.input).toEqual({ slots: [null, null], teleporters: [] });
    expect(left.output).toEqual({ slots: [null], teleporters: [] });
    expect(after.players[0]!.teleportersRemaining).toBe(4);
    expect(after.globalTeleporterCount).toBe(0);
    expect(teleporterCost(after.globalTeleporterCount)).toBe(1);
    expect(find(after, 'P').claims).toEqual(of(0, 6, 4));
    // Power Tokens and inventories are untouched (the material went to the bank, not to anyone).
    expect(after.players[0]!.powerTokens).toBe(5);
    expect(after.players[0]!.inventory).toEqual({ ore: 2, plate: 1, sphere: 0, tesseract: 0 });
    expect(after.players[1]!.inventory).toEqual(s.players[1]!.inventory);
  });

  it('with a second or third own module left on the building, nothing is forfeited', () => {
    for (const claims of [of(0, 4, 7), of(0, 4, 7, 8)]) {
      const s = start(claims);
      expect(lossIfModuleLeaves(find(s, 'S'), 0)).toEqual({ materials: 0, teleporters: 0 });
      const after = expectOk(applyAction(s, move));
      const stays = find(after, 'S');
      expect(stays.claims.length, JSON.stringify(claims)).toBe(claims.length - 1);
      expect(stays.input).toEqual({ slots: ['ore', 'plate'], teleporters: [0, 0] });
      expect(stays.output).toEqual({ slots: ['sphere'], teleporters: [0] });
      expect(after.globalTeleporterCount).toBe(3);
    }
  });

  it('an older save with material in an unclaimed building is emptied by the first move', () => {
    const old = onBoard([building('X', 'plateFact', [], 50, { input: ['ore'], output: 'plate' })], 'actions');
    const after = expectOk(applyAction(patchPlayer(old, 0, { inventory: { ore: 3, plate: 0, sphere: 0, tesseract: 0 } }), { type: 'BUY_BELT' }));
    expect(find(after, 'X').input!.slots).toEqual([null]);
    expect(find(after, 'X').output!.slots).toEqual([null]);
    expect(settleLostClaims(after)).toBe(after); // settled: nothing more to do
  });

  it('a pending decision about a building its player no longer owns is dropped, and its run is refused', () => {
    // As an older save could hold it: player 1's pending run of X, which nobody owns any more.
    const s: GameState = {
      ...onBoard([building('X', 'plateFact', [], 50, { input: ['ore'] })], 'actions'),
      pendingFactoryOps: [{ pieceId: 'X', ownerId: 1 }],
    };
    expect(code(s, { type: 'OPERATE_BUILDING', pieceId: 'X', ownerId: 1 })).toBe('NOT_YOUR_BUILDING');
    expect(legalActions(s, 1).some(a => a.type === 'OPERATE_BUILDING')).toBe(false);
    const after = expectOk(applyAction(patchPlayer(s, 0, { inventory: { ore: 3, plate: 0, sphere: 0, tesseract: 0 } }), { type: 'BUY_BELT' }));
    expect(after.pendingFactoryOps).toEqual([]);
  });
});

describe('an unclaimed building holds, receives and feeds nothing (#58)', () => {
  // Plate Factory F at (3,0): its output touches input 1 of Sphere Factory G at (4,0). Blank C at
  // (4,0) in the belt case: its point 0 faces F's output, point 7 faces G2's input at (5,0).
  const F = (claims: Claims): BoardPiece => building('F', 'plateFact', claims, 3, { output: 'plate' });
  const G = (claims: Claims, q = 4): BoardPiece => building('G', 'sphereFact', claims, q);
  const C: BoardPiece = { id: 'C', type: 'blank', coord: { q: 4, r: 0 }, rotation: 0, claims: [], input: null, output: null };
  const beltC: Belt = { id: 'bC', ownerId: 0, pieceId: 'C', fromPoint: 0, toPoint: 7 };
  const gIn = (s: GameState): unknown[] => [...find(resolveDirectAdjacency(s), 'G').input!.slots];

  it('by direct contact: neither out of an unclaimed building nor into one', () => {
    expect(gIn(onBoard([F([]), G(of(0, 5))], 'actions'))).toEqual([null, null]);
    expect(gIn(onBoard([F(of(0, 4)), G([])], 'actions'))).toEqual([null, null]);
    expect(gIn(onBoard([F(of(0, 4)), G(of(0, 5))], 'actions'))).toEqual(['plate', null]);
  });

  it('by belt: neither out of an unclaimed building nor into one', () => {
    expect(gIn(onBoard([F([]), C, G(of(0, 5), 5)], 'actions', 0, [beltC]))).toEqual([null, null]);
    expect(gIn(onBoard([F(of(0, 4)), C, G([], 5)], 'actions', 0, [beltC]))).toEqual([null, null]);
    expect(gIn(onBoard([F(of(0, 4)), C, G(of(0, 5), 5)], 'actions', 0, [beltC]))).toEqual(['plate', null]);
  });
});

// ── "Changes ownership to a new owner": nothing placed or made under A reaches B ──

describe('no sequence of legal moves lets material of player A be used by player B (#58)', () => {
  // Player 0 (A) owns Plate Factory X, holding Ore in its input and a Plate in its output, with a
  // Teleporter on the output. A moves their only module off it (Changing Priorities); then B
  // claims X by each claiming route. X is empty when B gets it, and B's inventory gains nothing.
  const X = building('X', 'plateFact', of(0, 4), 50, { input: ['ore'], output: 'plate', outTele: 0 });
  const Y = building('Y', 'plateFact', of(0, 6), 54);
  const Z = building('Z', 'plateFact', of(1, 5), 58);
  const aLeaves = (): GameState => {
    const s = patchPlayer({ ...onBoard([X, Y, Z], 'actions'), globalTeleporterCount: 1 }, 0, { hand: ['changingPriorities'], teleportersRemaining: 3 });
    return expectOk(applyAction(s, { type: 'PLAY_CARD', cardType: 'changingPriorities', pieceId: 'X', toPieceId: 'Y', controlModule: 4 }));
  };
  // B to move, in `phase`, with `patch`.
  const bTurn = (s: GameState, phase: GameState['phase'], patch: Partial<Player>, extra: Partial<GameState> = {}): GameState =>
    patchPlayer({ ...s, phase, turnOrder: [1, 0], activePlayerIndex: 0, cardsPlayedThisTurn: 0, ...extra }, 1, patch);

  const routes: Array<[string, (s: GameState) => GameState, Action]> = [
    ['CLAIM_BUILDING (Production Increase)', s => bTurn(s, 'actions', {}, { productionIncreaseBudget: 4 }),
      { type: 'CLAIM_BUILDING', pieceId: 'X', controlModule: 2, fromProductionIncrease: true }],
    ['CLAIM_BUILDING (free claim at round end)', s => bTurn(s, 'roundEnd', { freeActionCredits: 3, freeClaimUsed: false }),
      { type: 'CLAIM_BUILDING', pieceId: 'X', controlModule: 2, fromFreeClaim: true }],
    ['Short Sale', s => bTurn(s, 'actions', { hand: ['shortSale'] }),
      { type: 'PLAY_CARD', cardType: 'shortSale', pieceId: 'X' }],
    ['Changing Priorities', s => bTurn(s, 'actions', { hand: ['changingPriorities'] }),
      { type: 'PLAY_CARD', cardType: 'changingPriorities', pieceId: 'Z', toPieceId: 'X', controlModule: 5 }],
  ];

  it('A leaves: X is emptied to the bank and A\'s Teleporter comes back to A', () => {
    const left = aLeaves();
    expect(find(left, 'X')).toMatchObject({ claims: [], input: { slots: [null] }, output: { slots: [null], teleporters: [] } });
    expect(left.players[0]!.teleportersRemaining).toBe(4);
  });

  for (const [name, prepare, claim] of routes) {
    it(`B claims X by ${name}: X holds nothing of A's`, () => {
      const ready = prepare(aLeaves());
      expect(listed(ready, claim, 1), name).toBe(true);
      const claimed = expectOk(applyAction(ready, claim));
      const x = find(claimed, 'X');
      expect(x.claims.every(c => c.ownerId === 1)).toBe(true);
      expect(x.input!.slots).toEqual([null]);
      expect(x.output!.slots).toEqual([null]);
      expect(claimed.players[1]!.inventory).toEqual(ready.players[1]!.inventory);
    });
  }
});

// ── Round-end meeple actions need a claim (#58, defence in depth) ─────────────

describe('round-end meeple actions require a claim on the building the meeple stands on (#58)', () => {
  // Player 0's meeple stands on X, which they do not own (only reachable from an older save).
  const roundEnd = (claims: Claims): GameState => patchPlayer(
    onBoard([building('X', 'plateFact', claims, 50, { input: [null], output: 'plate' })], 'roundEnd'),
    0, { meepleOnPieceId: 'X', meepleSlotIndex: null, meepleOperatedThisRound: false, powerTokens: 5, inventory: { ore: 2, plate: 0, sphere: 0, tesseract: 0 } },
  );
  const load: Action = { type: 'LOAD_BUILDING_INPUT', pieceId: 'X', material: 'ore' };
  const collect: Action = { type: 'COLLECT_OUTPUT', pieceId: 'X' };
  const run: Action = { type: 'OPERATE_BUILDING', pieceId: 'X' };

  it('refused and not listed on another player\'s building', () => {
    const s = roundEnd(of(1, 4));
    for (const a of [load, collect, run]) {
      expect(code(s, a), a.type).toBe('NOT_YOUR_BUILDING');
      expect(listed(s, a, 0), a.type).toBe(false);
    }
  });

  it('accepted and listed on their own building', () => {
    const s = roundEnd(of(0, 4));
    for (const a of [load, collect]) {
      expect(code(s, a), a.type).toBeNull();
      expect(listed(s, a, 0), a.type).toBe(true);
    }
  });
});
