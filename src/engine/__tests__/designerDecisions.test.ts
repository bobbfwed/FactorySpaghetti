// The designer's answers to the open rules questions and the payment report (RULES_CHANGES.md
// #35–#43, 2026-11-24): one focused spec per decision.

import { describe, it, expect } from 'vitest';
import { createGame } from '../rules/setup';
import { applyAction, legalActions } from '../reducer';
import { directFlowAllowed, payMaterials, resolveDirectAdjacency } from '../rules/flow';
import { longestBeltChain } from '../rules/beltWeaver';
import { isListedMove, listedForm } from '../rules/legalActions';
import { teleporterCost, MAX_CARDS_PLAYED_PER_TURN } from '../config';
import type { Material } from '../config';
import type { Action } from '../actions';
import { sameMove } from '../actions';
import type { Belt, BoardPiece, GameState, Player, PlayerId } from '../state';
import { activePlayer, reachActionsPhase, expectOk } from './helpers';

type Inv = Record<Material, number>;
type Claims = BoardPiece['claims'];

const inv = (ore: number, plate: number, sphere: number, tesseract: number): Inv => ({ ore, plate, sphere, tesseract });

function patchPlayer(s: GameState, p: PlayerId, patch: Partial<Player>): GameState {
  return { ...s, players: s.players.map((x, i) => (i === p ? { ...x, ...patch } : x)) };
}

function piece(id: string, type: BoardPiece['type'], q: number, r: number, rotation = 0, claims: Claims = []): BoardPiece {
  const inputs = type === 'plateFact' || type === 'powerPlant' ? 1 : type === 'sphereFact' ? 2 : type === 'tesseractFact' ? 3 : 0;
  const hasOutput = type === 'plateFact' || type === 'sphereFact' || type === 'tesseractFact';
  return {
    id, type, coord: { q, r }, rotation, claims,
    input: inputs ? { slots: new Array(inputs).fill(null), teleporterOwner: null } : null,
    output: hasOutput || type === 'mine' ? { slots: [null], teleporterOwner: null } : null,
  };
}

// Player `active` in the actions phase on a hand-built board, with plenty of belts.
function actionsState(board: BoardPiece[], belts: Belt[] = [], active: PlayerId = 0): GameState {
  const g = createGame(1, 2);
  return {
    ...g, board, belts, turnOrder: [active, active === 0 ? 1 : 0], activePlayerIndex: 0, phase: 'actions',
    players: g.players.map(p => ({ ...p, beltsRemaining: 10 })),
  };
}

const code = (s: GameState, a: Action): string | null => { const r = applyAction(s, a); return r.ok ? null : r.error.code; };
const listed = (s: GameState, a: Action, who: PlayerId): boolean => legalActions(s, who).some(l => sameMove(l, a));

// ── Smart payment (#42) ───────────────────────────────────────────────────────

describe('payment keeps the highest materials (#42)', () => {
  const cases: Array<[string, Inv, number, Inv | null]> = [
    ['Sphere + Ore paying 3 → 1 Plate + 2 Ore', inv(1, 0, 1, 0), 3, inv(2, 1, 0, 0)],
    ['Ore + Plate paying 3 → 1 Ore', inv(1, 1, 0, 0), 3, inv(1, 0, 0, 0)],
    ['2 Spheres paying 3 → 1 Sphere + 1 Plate + 1 Ore', inv(0, 0, 2, 0), 3, inv(1, 1, 1, 0)],
    ['1 Tesseract paying 3 → 2 Spheres + 2 Plates', inv(0, 0, 0, 1), 3, inv(0, 2, 2, 0)],
    ['3 Ore + 1 Tesseract paying 3 → 1 Tesseract', inv(3, 0, 0, 1), 3, inv(0, 0, 0, 1)],
    ['paying exactly the total → empty', inv(1, 1, 1, 0), 11, inv(0, 0, 0, 0)],
    ['a lone Sphere paying 3', inv(0, 0, 1, 0), 3, inv(1, 1, 0, 0)],
    ['short of the cost → refused', inv(2, 0, 0, 0), 3, null],
    ['nothing to pay → unchanged', inv(1, 2, 3, 0), 0, inv(1, 2, 3, 0)],
  ];
  for (const [name, have, cost, after] of cases) {
    it(name, () => expect(payMaterials(have, cost)).toEqual(after));
  }

  it('change is given in lower materials only, up to the cap, and never more than is owed', () => {
    // 6 Plates and a Sphere paying 1: a Plate is handed in (2 Ore change), so the Sphere is kept.
    expect(payMaterials(inv(0, 6, 1, 0), 1)).toEqual(inv(2, 5, 1, 0));
    // Paying 7 with 6 Plates and a Sphere: 3 Plates go in (2 Ore back) rather than the Sphere.
    expect(payMaterials(inv(0, 6, 1, 0), 7)).toEqual(inv(2, 3, 1, 0));
    // A Sphere is broken rather than the Tesseract.
    expect(payMaterials(inv(0, 0, 5, 1), 3)).toEqual(inv(1, 1, 4, 1));
    // Paying a Tesseract's worth: 4 Spheres go in (a Plate and 2 Ore back), the Tesseract is kept.
    expect(payMaterials(inv(0, 0, 5, 1), 23)).toEqual(inv(2, 1, 1, 1));
    // Paying all but 1 of the value: everything goes in, 1 Ore comes back; and a Plate pays 2.
    expect(payMaterials(inv(0, 0, 6, 1), 23 + 7 * 6 - 1)).toEqual(inv(1, 0, 0, 0));
    expect(payMaterials(inv(0, 6, 6, 1), 2)).toEqual(inv(1, 5, 6, 1));
    expect(payMaterials(inv(0, 0, 5, 1), 2)).toEqual(inv(2, 1, 4, 1));
    expect(payMaterials(inv(0, 6, 1, 0), 2)).toEqual(inv(1, 5, 1, 0));
    // Every outcome is worth exactly the inventory minus the cost when nothing hits the cap.
    for (const have of [inv(2, 1, 1, 1), inv(0, 3, 2, 1), inv(5, 0, 0, 2), inv(1, 1, 1, 1)]) {
      for (const cost of [1, 2, 3, 6, 18]) {
        const after = payMaterials(have, cost);
        const v = (x: Inv): number => x.ore + 3 * x.plate + 7 * x.sphere + 23 * x.tesseract;
        if (v(have) < cost) { expect(after).toBeNull(); continue; }
        expect(after, `${JSON.stringify(have)} paying ${cost}`).not.toBeNull();
        expect(v(after!)).toBe(v(have) - cost);
        for (const m of ['ore', 'plate', 'sphere', 'tesseract'] as const) expect(after![m]).toBeLessThanOrEqual(6);
      }
    }
  });

  it('BUY_CARD, a Mine, a belt and a teleporter all pay this way; a lone Sphere can now buy a teleporter', () => {
    const s0 = reachActionsPhase(42, 2);
    const me = activePlayer(s0);
    const twoMines = patchPlayer({ ...s0, mineCount: 2 }, me, { inventory: inv(1, 0, 1, 0) }); // card costs 3
    const bought = expectOk(applyAction(twoMines, { type: 'BUY_CARD' }));
    expect(bought.players[me]!.inventory).toEqual(inv(2, 1, 0, 0));

    const belt = expectOk(applyAction(patchPlayer(s0, me, { inventory: inv(0, 1, 0, 0) }), { type: 'BUY_BELT' }));
    expect(belt.players[me]!.inventory).toEqual(inv(2, 0, 0, 0));

    // Teleporter: price 3 (two on the board), paid with a lone Sphere.
    const own = s0.board.find(p => p.claims.some(c => c.ownerId === me) && p.output)!;
    const tp = patchPlayer({ ...s0, globalTeleporterCount: 2 }, me, { inventory: inv(0, 0, 1, 0) });
    const a: Action = { type: 'PLACE_TELEPORTER', pieceId: own.id, bufferType: 'output' };
    expect(listed(tp, a, me)).toBe(true);
    const placed = expectOk(applyAction(tp, a));
    expect(placed.players[me]!.inventory).toEqual(inv(1, 1, 0, 0));
    // Short of the price: neither listed nor accepted.
    const poor = patchPlayer({ ...s0, globalTeleporterCount: 2 }, me, { inventory: inv(2, 0, 0, 0) });
    expect(listed(poor, a, me)).toBe(false);
    expect(code(poor, a)).toBe('CANNOT_AFFORD');
  });

  it("designer's report: a card is listed and bought with 1 Ore + 1 Plate (two Mines) after placing, buying and undoing belts", () => {
    let s = reachActionsPhase(42, 2);
    const me = activePlayer(s);
    s = patchPlayer({ ...s, mineCount: 2 }, me, { inventory: inv(2, 1, 0, 0), beltsRemaining: 5 });
    const place = legalActions(s, me).find(a => a.type === 'PLACE_BELT')!;
    s = expectOk(applyAction(s, place));
    s = expectOk(applyAction(s, { type: 'BUY_BELT' })); // 1 Ore → 1 Ore + 1 Plate left
    expect(s.players[me]!.inventory).toEqual(inv(1, 1, 0, 0));
    for (const state of [s, expectOk(applyAction(s, { type: 'UNDO_BELTS' }))]) {
      expect(listed(state, { type: 'BUY_CARD' }, me)).toBe(true);
      expect(expectOk(applyAction(state, { type: 'BUY_CARD' })).players[me]!.inventory).toEqual(inv(1, 0, 0, 0));
    }
    // A lone Sphere, too.
    const sphere = patchPlayer(s, me, { inventory: inv(0, 0, 1, 0) });
    expect(listed(sphere, { type: 'BUY_CARD' }, me)).toBe(true);
    expect(expectOk(applyAction(sphere, { type: 'BUY_CARD' })).players[me]!.inventory).toEqual(inv(1, 1, 0, 0));
  });
});

// ── OQ-4: play-on-draw cards count toward the limit (#36) ─────────────────────

describe('play-on-draw cards count toward the cards-played limit (#36)', () => {
  const base = reachActionsPhase(42, 2);
  const me = activePlayer(base);
  const ready = (played: number): GameState =>
    patchPlayer({ ...base, cardsPlayedThisTurn: played, cardDeck: ['solarFlare', ...base.cardDeck] }, me, { inventory: inv(6, 0, 0, 0), hand: ['embezzlement'] });

  it('uses up one of the two plays', () => {
    const after = expectOk(applyAction(ready(0), { type: 'BUY_CARD' }));
    expect(after.cardsPlayedThisTurn).toBe(1);
    const second = expectOk(applyAction(ready(1), { type: 'BUY_CARD' }));
    expect(second.cardsPlayedThisTurn).toBe(2);
    // With both plays used, the card in hand can no longer be played.
    expect(code(second, { type: 'PLAY_CARD', cardType: 'embezzlement' })).toBe('CARD_LIMIT_REACHED');
    expect(listed(second, { type: 'PLAY_CARD', cardType: 'embezzlement' }, me)).toBe(false);
  });

  it('still resolves when no plays are left, and buying is never blocked', () => {
    const s = ready(MAX_CARDS_PLAYED_PER_TURN);
    expect(listed(s, { type: 'BUY_CARD' }, me)).toBe(true);
    const after = expectOk(applyAction(s, { type: 'BUY_CARD' }));
    expect(after.cardsPlayedThisTurn).toBe(MAX_CARDS_PLAYED_PER_TURN);
    expect(after.players.every((p, i) => p.powerTokens === Math.min(10, s.players[i]!.powerTokens + 2))).toBe(true); // Solar Flare resolved
  });

  it('a card bought into the hand does not count', () => {
    const s = patchPlayer({ ...base, cardsPlayedThisTurn: 0, cardDeck: ['sinkHole', ...base.cardDeck] }, me, { inventory: inv(6, 0, 0, 0) });
    expect(expectOk(applyAction(s, { type: 'BUY_CARD' })).cardsPlayedThisTurn).toBe(0);
  });
});

// ── OQ-6: teleporters come back when the claim is lost (#37) ──────────────────

describe('teleporters return when their placer loses the claim (#37)', () => {
  const withTeleporters = (claims: Claims): GameState => {
    const x: BoardPiece = {
      ...piece('X', 'plateFact', 3, 0, 0, claims),
      input: { slots: ['ore'], teleporterOwner: 0 },
      output: { slots: ['plate'], teleporterOwner: 0 },
    };
    const s = actionsState([piece('mine-1', 'mine', 0, 0), x, piece('Y', 'plateFact', 5, 0)]);
    return patchPlayer({ ...s, globalTeleporterCount: 2, cardsPlayedThisTurn: 0 }, 0, {
      hand: ['changingPriorities'], teleportersRemaining: 2, inventory: inv(0, 0, 0, 0),
    });
  };
  const move: Action = { type: 'PLAY_CARD', cardType: 'changingPriorities', pieceId: 'X', toPieceId: 'Y', controlModule: 4 };

  it('moving the last Control Module off the building returns both teleporters and lowers the price', () => {
    const s = withTeleporters([{ ownerId: 0, controlModule: 4 }]);
    expect(teleporterCost(s.globalTeleporterCount)).toBe(3);
    const after = expectOk(applyAction(s, move));
    const x = after.board.find(p => p.id === 'X')!;
    expect(x.claims).toEqual([]);
    expect(x.input).toEqual({ slots: ['ore'], teleporterOwner: null });   // material stays
    expect(x.output).toEqual({ slots: ['plate'], teleporterOwner: null });
    expect(after.players[0]!.teleportersRemaining).toBe(4);
    expect(after.globalTeleporterCount).toBe(0);
    expect(teleporterCost(after.globalTeleporterCount)).toBe(1);
  });

  it('they stay while the placer keeps another claim there, even if another player also claims it', () => {
    const after = expectOk(applyAction(withTeleporters([{ ownerId: 0, controlModule: 4 }, { ownerId: 0, controlModule: 6 }]), move));
    expect(after.board.find(p => p.id === 'X')!.output!.teleporterOwner).toBe(0);
    expect(after.globalTeleporterCount).toBe(2);
  });

  it("only the leaving player's teleporters return; a co-owner who stays keeps the building", () => {
    const after = expectOk(applyAction(withTeleporters([{ ownerId: 1, controlModule: 5 }, { ownerId: 0, controlModule: 4 }]), move));
    const x = after.board.find(p => p.id === 'X')!;
    expect(x.claims).toEqual([{ ownerId: 1, controlModule: 5 }]);
    expect(x.output!.teleporterOwner).toBeNull();
    expect(after.players[0]!.teleportersRemaining).toBe(4);
  });
});

// ── OQ-7: an opponent's belt neither feeds nor draws from your building (#38) ──

describe("a belt end facing a building it may not serve is a dead end (#38)", () => {
  // Mine 1 at (0,0) (lean hex at (1,0)); blank A at (2,0): point 0 faces the lean hex's ore
  // exit, point 7 faces F's input. F is a Plate Factory at (3,0); blank C at (4,0): point 0
  // faces F's output, point 7 faces G's input; G is a Sphere Factory at (5,0).
  const MINE = piece('mine-1', 'mine', 0, 0);
  const A = piece('A', 'blank', 2, 0);
  const C = piece('C', 'blank', 4, 0);
  const F = (claims: Claims, out: Material | null = null): BoardPiece =>
    ({ ...piece('F', 'plateFact', 3, 0, 0, claims), output: { slots: [out], teleporterOwner: null } });
  const G = (claims: Claims): BoardPiece => piece('G', 'sphereFact', 5, 0, 0, claims);
  const beltA: Belt = { id: 'bA', ownerId: 0, pieceId: 'A', fromPoint: 0, toPoint: 7 };
  const beltC: Belt = { id: 'bC', ownerId: 0, pieceId: 'C', fromPoint: 0, toPoint: 7 };
  const P0: Claims = [{ ownerId: 0, controlModule: 4 }];
  const P1: Claims = [{ ownerId: 1, controlModule: 4 }];
  const BOTH: Claims = [{ ownerId: 1, controlModule: 4 }, { ownerId: 0, controlModule: 5 }];
  const inF = (s: GameState): unknown => resolveDirectAdjacency(s).board.find(p => p.id === 'F')!.input!.slots[0];

  it('feeding: no ore reaches a building claimed only by another player', () => {
    expect(inF(actionsState([MINE, A, F(P1)], [beltA]))).toBeNull();
    expect(inF(actionsState([MINE, A, F(P0)], [beltA]))).toBe('ore');
    expect(inF(actionsState([MINE, A, F(BOTH)], [beltA]))).toBe('ore');
  });

  it('works again as soon as the belt owner gains a claim, or the building becomes unclaimed', () => {
    // Player 0 lays the belt into the unclaimed factory; player 1 then claims it (Short Sale).
    let s = actionsState([MINE, A, F([])]);
    s = expectOk(applyAction(s, { type: 'PLACE_BELT', pieceId: 'A', fromPoint: 0, toPoint: 7 }));
    s = { ...s, turnOrder: [1, 0], activePlayerIndex: 0, cardsPlayedThisTurn: 0, players: s.players.map(p => (p.id === 1 ? { ...p, hand: ['shortSale'] } : p)) };
    s = expectOk(applyAction(s, { type: 'PLAY_CARD', cardType: 'shortSale', pieceId: 'F' }));
    expect(s.belts.map(b => b.ownerId)).toEqual([0]); // the belt stays
    expect(inF(s)).toBeNull();                         // but it is a dead end
    // Player 0 holds a claim on it too (a shared building, as older saves may have — Short Sale
    // can no longer claim another player's building, #46): the belt carries ore again.
    s = { ...s, board: s.board.map(p => (p.id === 'F' ? { ...p, claims: [...p.claims, { ownerId: 0 as const, controlModule: 5 }] } : p)) };
    expect(inF(s)).toBe('ore');
    // And when the building is unclaimed again, anyone's belt feeds it... no claimed input takes
    // material, so check the reservation lifts: the end is no longer reserved.
    const unclaimed = actionsState([MINE, A, F([])], [beltA]);
    expect(code({ ...unclaimed, belts: [] }, { type: 'PLACE_BELT', pieceId: 'A', fromPoint: 0, toPoint: 7 })).toBeNull();
  });

  it('drawing: no material leaves another player\'s building through the belt owner\'s chain', () => {
    const moved = (fClaims: Claims): { f: unknown; g: unknown } => {
      const after = resolveDirectAdjacency(actionsState([F(fClaims, 'plate'), C, G(P0)], [beltC]));
      return { f: after.board.find(p => p.id === 'F')!.output!.slots[0], g: after.board.find(p => p.id === 'G')!.input!.slots[0] };
    };
    expect(moved(P1)).toEqual({ f: 'plate', g: null });
    expect(moved(BOTH)).toEqual({ f: null, g: 'plate' });
    expect(moved([])).toEqual({ f: null, g: 'plate' }); // an unclaimed building's output is open
  });

  it('Belt Weaver: a dead end does not count as the chain reaching that building', () => {
    expect(longestBeltChain(actionsState([MINE, A, F(P0)], [beltA]), 0)).toBe(1); // mine + building
    expect(longestBeltChain(actionsState([MINE, A, F([])], [beltA]), 0)).toBe(1);
    expect(longestBeltChain(actionsState([MINE, A, F(P1)], [beltA]), 0)).toBe(0); // reaches only the mine
  });
});

// ── A building feeds only its own player's buildings (#51) ────────────────────

describe("an output touching an input moves material only between one player's buildings (#51)", () => {
  // Plate Factory F at (3,0): its output #8 touches input #1 of the Sphere Factory G at (4,0).
  // Mine 1 at (0,0): its lean hex's ore exit faces input #1 of a Plate Factory M at (2,0).
  const MINE = piece('mine-1', 'mine', 0, 0);
  const P0: Claims = [{ ownerId: 0, controlModule: 4 }];
  const P1: Claims = [{ ownerId: 1, controlModule: 4 }];
  const G0: Claims = [{ ownerId: 0, controlModule: 5 }];
  const G1: Claims = [{ ownerId: 1, controlModule: 5 }];
  const BOTH: Claims = [{ ownerId: 1, controlModule: 4 }, { ownerId: 0, controlModule: 6 }];
  const F = (claims: Claims, out: Material | null = 'plate', input: Material | null = null): BoardPiece =>
    ({ ...piece('F', 'plateFact', 3, 0, 0, claims), input: { slots: [input], teleporterOwner: null }, output: { slots: [out], teleporterOwner: null } });
  const G = (claims: Claims, slots: Array<Material | null> = [null, null]): BoardPiece =>
    ({ ...piece('G', 'sphereFact', 4, 0, 0, claims), input: { slots, teleporterOwner: null } });
  const run = (board: BoardPiece[]): { f: unknown; g: unknown[] } => {
    const after = resolveDirectAdjacency(actionsState(board));
    return { f: after.board.find(p => p.id === 'F')!.output!.slots[0], g: [...after.board.find(p => p.id === 'G')!.input!.slots] };
  };

  it("another player's output touching my input: nothing moves, the material stays in the output", () => {
    expect(run([F(P1), G(G0)])).toEqual({ f: 'plate', g: [null, null] });
    expect(run([F(P0), G(G1)])).toEqual({ f: 'plate', g: [null, null] });
    expect(directFlowAllowed(F(P1), G(G0))).toBe(false);
  });

  it('my output touching my own input moves', () => {
    expect(run([F(P0), G(G0)])).toEqual({ f: null, g: ['plate', null] });
    expect(run([F(P1), G(G1)])).toEqual({ f: null, g: ['plate', null] });
  });

  it('a shared building: it moves when one player holds a claim on both', () => {
    expect(run([F(BOTH), G(G0)])).toEqual({ f: null, g: ['plate', null] });
    expect(run([F(P1), G([...G1, ...G0])])).toEqual({ f: null, g: ['plate', null] });
    expect(run([F(BOTH), G([...G1, ...G0])])).toEqual({ f: null, g: ['plate', null] });
  });

  it("an unclaimed building's output still passes into a claimed neighbour", () => {
    expect(run([F([]), G(G0)])).toEqual({ f: null, g: ['plate', null] });
    expect(run([F([]), G(G1)])).toEqual({ f: null, g: ['plate', null] });
  });

  it('an unclaimed building never receives', () => {
    expect(run([F(P0), G([])])).toEqual({ f: 'plate', g: [null, null] });
    expect(run([F([]), G([])])).toEqual({ f: 'plate', g: [null, null] });
  });

  it('a Mine feeds any claimed building it touches, as before', () => {
    const M = (claims: Claims): BoardPiece => piece('M', 'plateFact', 2, 0, 0, claims);
    for (const claims of [P0, P1, BOTH]) {
      const after = resolveDirectAdjacency(actionsState([MINE, M(claims)]));
      expect(after.board.find(p => p.id === 'M')!.input!.slots, JSON.stringify(claims)).toEqual(['ore']);
    }
    expect(resolveDirectAdjacency(actionsState([MINE, M([])])).board.find(p => p.id === 'M')!.input!.slots).toEqual([null]);
  });

  it('material already in another player\'s input (a game saved under the old rule) stays where it is', () => {
    expect(run([F(P0), G(G1, ['plate', null])])).toEqual({ f: 'plate', g: ['plate', null] });
  });

  it('a factory whose output is blocked this way is like one with a full output: its roll offers no decision', () => {
    const rolled = (g: Claims): GameState => {
      const s = { ...actionsState([F(P0, 'plate', 'ore'), G(g)]), phase: 'roll' as const, pendingFactoryOps: [] };
      return expectOk(applyAction(s, { type: 'ROLL_DICE', rolls: [4] }));
    };
    // Blocked (the Sphere Factory is player 1's): the Plate stays, so F cannot run.
    const blocked = rolled(G1);
    expect(blocked.pendingFactoryOps).toEqual([]);
    expect(blocked.board.find(p => p.id === 'F')!.output!.slots).toEqual(['plate']);
    expect(blocked.board.find(p => p.id === 'F')!.input!.slots).toEqual(['ore']);
    expect(code({ ...blocked, pendingFactoryOps: [] }, { type: 'OPERATE_BUILDING', pieceId: 'F' })).not.toBeNull();
    // Own Sphere Factory: the Plate moves on before production, so F may run.
    const open = rolled(G0);
    expect(open.pendingFactoryOps).toEqual([{ pieceId: 'F', ownerId: 0 }]);
    expect(open.board.find(p => p.id === 'G')!.input!.slots).toContain('plate');
  });

  it('a belt chain never carries one player\'s output into a building of a player without a claim on the source', () => {
    // Every claim combination on source F and destination G, with the belt on C laid by either
    // player: material arrives only if the belt owner holds a claim on G and on F (or F is
    // unclaimed) — so always where directFlowAllowed holds.
    const C = piece('C', 'blank', 4, 0);
    const Gb = (claims: Claims): BoardPiece => piece('G', 'sphereFact', 5, 0, 0, claims);
    const options: Claims[] = [[], P0, P1, BOTH];
    for (const owner of [0, 1] as const) {
      const belt: Belt = { id: 'bC', ownerId: owner, pieceId: 'C', fromPoint: 0, toPoint: 7 };
      for (const fc of options) {
        for (const gc of options) {
          const f = F(fc);
          const g = Gb(gc);
          const after = resolveDirectAdjacency(actionsState([f, C, g], [belt]));
          const arrived = after.board.find(p => p.id === 'G')!.input!.slots.includes('plate');
          const holds = (c: Claims): boolean => c.some(x => x.ownerId === owner);
          const label = `belt of ${owner}, F ${JSON.stringify(fc)}, G ${JSON.stringify(gc)}`;
          expect(arrived, label).toBe(holds(gc) && (fc.length === 0 || holds(fc)));
          if (arrived) expect(directFlowAllowed(f, g), label).toBe(true);
        }
      }
    }
  });
});

// ── OQ-8: the one-Mine-belt limit counts ore exits only (#39) ─────────────────

describe('the one-Mine-belt-per-turn limit counts only ends facing an ore exit (#39)', () => {
  // Blank A at (2,0): its point 0 faces the lean hex at (1,0). Blank B at (-1,0): its point 7
  // faces the rich hex at (0,0), which has ore exits all round on every Mine.
  const A = piece('A', 'blank', 2, 0);
  const B = piece('B', 'blank', -1, 0);
  const onA: Action = { type: 'PLACE_BELT', pieceId: 'A', fromPoint: 0, toPoint: 7 };
  const onB: Action = { type: 'PLACE_BELT', pieceId: 'B', fromPoint: 1, toPoint: 7 };

  it("Mine 2's lean hex has no exit: a belt facing it does not use up the turn's Mine belt", () => {
    let s = actionsState([piece('mine-2', 'mine', 0, 0), A, B]);
    s = expectOk(applyAction(s, onA));
    expect(s.mineBeltPlacedThisTurn).toBe(false);
    expect(listed(s, onB, 0)).toBe(true);
    s = expectOk(applyAction(s, onB));
    expect(s.mineBeltPlacedThisTurn).toBe(true);
  });

  it("Mine 1's lean-hex exit counts, so the second belt facing an exit is refused and not listed", () => {
    let s = actionsState([piece('mine-1', 'mine', 0, 0), A, B]);
    s = expectOk(applyAction(s, onA));
    expect(s.mineBeltPlacedThisTurn).toBe(true);
    expect(code(s, onB)).toBe('MINE_BELT_LIMIT');
    expect(listed(s, onB, 0)).toBe(false);
  });
});

// ── OQ-9: a pending decision of your own comes first (#40) ────────────────────

describe('while the active player has a factory decision pending, only operate/skip is accepted (#40)', () => {
  const shared: BoardPiece = {
    ...piece('pf', 'plateFact', 50, 0, 0, [{ ownerId: 0, controlModule: 3 }, { ownerId: 1, controlModule: 3 }]),
    input: { slots: ['ore'], teleporterOwner: null },
  };
  const base = createGame(1, 2);
  const roll: GameState = {
    ...base, board: [...base.board, shared], turnOrder: [0, 1], activePlayerIndex: 0, phase: 'roll',
    players: base.players.map(p => ({ ...p, powerTokens: 10, inventory: inv(3, 0, 0, 0) })),
  };
  const rolled = expectOk(applyAction(roll, { type: 'ROLL_DICE', rolls: [3] }));

  it('other moves are refused with DECISION_PENDING', () => {
    expect(rolled.pendingFactoryOps).toEqual([{ pieceId: 'pf', ownerId: 0 }, { pieceId: 'pf', ownerId: 1 }]);
    for (const a of [{ type: 'BUY_BELT' }, { type: 'BUY_CARD' }, { type: 'END_ACTIONS' }, { type: 'EXCHANGE_MATERIALS', give: 'plate' }] as Action[]) {
      expect(code(rolled, a), a.type).toBe('DECISION_PENDING');
    }
  });

  it("another owner's entry may still be answered; then the active player must still decide", () => {
    const skipped = expectOk(applyAction(rolled, { type: 'SKIP_FACTORY_ROLL', pieceId: 'pf', ownerId: 1 }));
    expect(code(skipped, { type: 'BUY_BELT' })).toBe('DECISION_PENDING');
    const decided = expectOk(applyAction(skipped, { type: 'OPERATE_BUILDING', pieceId: 'pf', ownerId: 0 }));
    expect(code(decided, { type: 'BUY_BELT' })).toBeNull();
  });

  it("once the active player's own entries are answered, others' pending entries do not block them", () => {
    const decided = expectOk(applyAction(rolled, { type: 'SKIP_FACTORY_ROLL', pieceId: 'pf', ownerId: 0 }));
    expect(decided.pendingFactoryOps).toEqual([{ pieceId: 'pf', ownerId: 1 }]);
    expect(code(decided, { type: 'BUY_BELT' })).toBeNull();
    expect(code(decided, { type: 'END_ACTIONS' })).toBe('PENDING_FACTORY_OPS');
  });
});

// ── Scouting Drone: any piece, by type (#41) ──────────────────────────────────

describe('Scouting Drone offers every piece type of every open stack (#41)', () => {
  const base = reachActionsPhase(5, 3);
  const me = activePlayer(base);
  const s = patchPlayer({ ...base, cardsPlayedThisTurn: 0 }, me, { hand: ['scoutingDrone'] });
  type PlayCard = Extract<Action, { type: 'PLAY_CARD' }>;
  const drones = legalActions(s, me).filter((a): a is PlayCard => a.type === 'PLAY_CARD' && a.cardType === 'scoutingDrone');

  it('one entry per distinct type present in a stack, at its first index', () => {
    const stack = s.stacks[0];
    const firsts = new Map<string, number>();
    stack.pieces.forEach((p, i) => { if (!firsts.has(p.type)) firsts.set(p.type, i); });
    const offered = new Set(drones.filter(a => a.stackIndex === 0).map(a => a.pieceIndex));
    expect([...offered].sort((a, b) => a! - b!)).toEqual([...firsts.values()].sort((a, b) => a - b));
    expect(stack.pieces.length).toBeGreaterThan(5); // earlier the list stopped at the first 5 pieces
  });

  it('naming a later copy of a type takes the first copy: same state, and listed in its listed form', () => {
    const stack = s.stacks[0];
    const later = stack.pieces.findIndex((p, i) => stack.pieces.findIndex(q => q.type === p.type) < i);
    expect(later).toBeGreaterThan(0);
    const first = stack.pieces.findIndex(p => p.type === stack.pieces[later]!.type);
    const listedOne = drones.find(a => a.stackIndex === 0 && a.pieceIndex === first)!;
    const named: Action = { ...listedOne, pieceIndex: later };
    expect(listed(s, named, me)).toBe(false);          // not in the list as written…
    expect(listedForm(s, named)).toEqual(listedOne);   // …but its listed form is
    expect(isListedMove(s, me, named)).toBe(true);
    expect(JSON.stringify(expectOk(applyAction(s, named)))).toBe(JSON.stringify(expectOk(applyAction(s, listedOne))));
    expect(expectOk(applyAction(s, named)).board.at(-1)!.id).toBe(stack.pieces[first]!.id);
  });
});

// ── Other gaps between the list and the engine (#43) ──────────────────────────

describe('moves the list never offered are refused by the engine too (#43)', () => {
  it('EXCHANGE_MATERIALS is listed and accepted in the round-end turn', () => {
    const base = createGame(1, 2);
    const s = patchPlayer({ ...base, phase: 'roundEnd', turnOrder: [0, 1], activePlayerIndex: 0 }, 0, { inventory: inv(0, 1, 1, 0) });
    for (const give of ['plate', 'sphere'] as const) {
      const a: Action = { type: 'EXCHANGE_MATERIALS', give };
      expect(listed(s, a, 0)).toBe(true);
      expect(code(s, a)).toBeNull();
    }
  });

  it('a claim paid by nothing is refused (UNFUNDED_CLAIM)', () => {
    const s = reachActionsPhase(1, 2);
    const me = activePlayer(s);
    const own = s.board.find(p => p.claims.some(c => c.ownerId === me))!;
    expect(code(s, { type: 'CLAIM_BUILDING', pieceId: own.id, controlModule: 9 })).toBe('UNFUNDED_CLAIM');
    expect(code(s, { type: 'CLAIM_BUILDING', pieceId: own.id, controlModule: 9, fromFreeClaim: true, fromProductionIncrease: true })).toBe('UNFUNDED_CLAIM');
  });

  it('Changing Priorities onto the same building is refused (SAME_BUILDING) and not listed', () => {
    const base = reachActionsPhase(1, 2);
    const me = activePlayer(base);
    const s = patchPlayer({ ...base, cardsPlayedThisTurn: 0 }, me, { hand: ['changingPriorities'] });
    const own = s.board.find(p => p.claims.some(c => c.ownerId === me && c.controlModule >= s.mineCount))!;
    const m = own.claims.find(c => c.ownerId === me)!.controlModule;
    const a: Action = { type: 'PLAY_CARD', cardType: 'changingPriorities', pieceId: own.id, toPieceId: own.id, controlModule: m };
    expect(code(s, a)).toBe('SAME_BUILDING');
    expect(listed(s, a, me)).toBe(false);
  });

  it('the meeple: placed once, on a Mine point or an own building, before the turn may end', () => {
    const acts = reachActionsPhase(1, 2);
    const me = activePlayer(acts);
    const s = expectOk(applyAction(acts, { type: 'END_ACTIONS' }));
    expect(s.phase).toBe('placeMeeple');
    expect(code(s, { type: 'END_TURN' })).toBe('MEEPLE_REQUIRED');
    expect(listed(s, { type: 'END_TURN' }, me)).toBe(false);
    expect(code(s, { type: 'PLACE_MEEPLE', pieceId: 'mine-1' })).toBe('INVALID_MEEPLE_TARGET'); // which point?
    const own = s.board.find(p => p.claims.some(c => c.ownerId === me))!;
    expect(code(s, { type: 'PLACE_MEEPLE', pieceId: own.id, slotIndex: 0 })).toBe('INVALID_MEEPLE_TARGET');
    const placed = expectOk(applyAction(s, { type: 'PLACE_MEEPLE', pieceId: 'mine-1', slotIndex: 0 }));
    expect(code(placed, { type: 'PLACE_MEEPLE', pieceId: own.id })).toBe('MEEPLE_ALREADY_PLACED');
    expect(legalActions(placed, me)).toEqual([{ type: 'END_TURN' }]);
    expect(code(placed, { type: 'END_TURN' })).toBeNull();
    // END_TURN outside the place-meeple step is refused, before any end-of-turn victory check.
    expect(code(acts, { type: 'END_TURN' })).toBe('WRONG_PHASE');
  });

  it('a meeple recorded on a building with a Mine point (an older save) does not run the building', () => {
    const base = createGame(1, 2);
    const pf: BoardPiece = { ...piece('pf', 'plateFact', 50, 0, 0, [{ ownerId: 0, controlModule: 3 }]), output: { slots: ['plate'], teleporterOwner: null } };
    const s = patchPlayer({ ...base, board: [...base.board, pf], phase: 'roundEnd', turnOrder: [0, 1], activePlayerIndex: 0 }, 0, {
      meepleOnPieceId: 'pf', meepleSlotIndex: 0, inventory: inv(2, 0, 0, 0), powerTokens: 5,
    });
    for (const a of [{ type: 'LOAD_BUILDING_INPUT', pieceId: 'pf', material: 'ore' }, { type: 'COLLECT_OUTPUT', pieceId: 'pf' }, { type: 'OPERATE_BUILDING', pieceId: 'pf' }] as Action[]) {
      expect(code(s, a), a.type).toBe('INVALID_TARGET');
      expect(listed(s, a, 0), a.type).toBe(false);
    }
  });

  it("a Mine touching the board with its lean hex only: since #47 accepted and listed (was refused)", () => {
    const base = reachActionsPhase(1, 2);
    const me = activePlayer(base);
    const s = patchPlayer(base, me, { inventory: inv(6, 0, 0, 0) });
    const buys = legalActions(s, me).filter(a => a.type === 'BUY_MINE');
    expect(buys.length).toBeGreaterThan(0);
    // Find a placement whose lean hex touches the board but whose rich hex does not.
    const occupied = new Set<string>();
    for (const p of s.board) occupied.add(`${p.coord.q},${p.coord.r}`);
    occupied.add('1,0'); // mine 1's lean hex
    const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, -1], [-1, 1]];
    const touches = (q: number, r: number): boolean => DIRS.some(([dq, dr]) => occupied.has(`${q + dq!},${r + dr!}`));
    let found: Action | null = null;
    for (let q = -8; q <= 8 && !found; q++) for (let r = -8; r <= 8 && !found; r++) {
      if (occupied.has(`${q},${r}`) || touches(q, r)) continue;
      for (let rot = 0; rot < 6; rot++) {
        const [dq, dr] = DIRS[rot]!;
        const sq = q + dq!, sr = r + dr!;
        if (!occupied.has(`${sq},${sr}`) && touches(sq, sr)) { found = { type: 'BUY_MINE', coord: { q, r }, rotation: rot }; break; }
      }
    }
    expect(found).not.toBeNull();
    // The designer widened the rule (RULES_CHANGES.md #47): either half may touch the board.
    expect(code(s, found!)).toBeNull();
    expect(listed(s, found!, me)).toBe(true);
  });

  it('a rotation outside 0–5 is refused (INVALID_ROTATION)', () => {
    const acts = reachActionsPhase(1, 2);
    const me = activePlayer(acts);
    const s = patchPlayer({ ...acts, cardsPlayedThisTurn: 0 }, me, { hand: ['scoutingDrone'] });
    const drone = legalActions(s, me).find(a => a.type === 'PLAY_CARD' && a.cardType === 'scoutingDrone')!;
    expect(code(s, { ...drone, rotation: 6 } as Action)).toBe('INVALID_ROTATION');
    expect(code(s, { ...drone, rotation: 1.5 } as Action)).toBe('INVALID_ROTATION');
  });
});
