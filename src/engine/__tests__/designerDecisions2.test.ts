// The designer's second set of rule decisions (RULES_CHANGES.md #44–#50, 2026-11-24): one focused
// spec per decision.

import { describe, it, expect } from 'vitest';
import { createGame } from '../rules/setup';
import { applyAction, legalActions } from '../reducer';
import { isListedMove } from '../rules/legalActions';
import { operateSupplies } from '../rules/production';
import { cardsLeftToDraw, nextCardDrawn } from '../rules/cards';
import { cardCost } from '../config';
import type { CardType, Material } from '../config';
import type { Action } from '../actions';
import { canonicalAction, sameMove } from '../actions';
import type { BoardPiece, GameState, PieceStack, Player, PlayerId } from '../state';
import { activePlayer, completeSetup, expectOk, reachActionsPhase } from './helpers';

type Inv = Record<Material, number>;
type Claims = BoardPiece['claims'];

const inv = (ore: number, plate: number, sphere: number, tesseract: number): Inv => ({ ore, plate, sphere, tesseract });
const code = (s: GameState, a: Action): string | null => { const r = applyAction(s, a); return r.ok ? null : r.error.code; };
const listed = (s: GameState, a: Action, who: PlayerId): boolean => legalActions(s, who).some(l => sameMove(l, a));

function patchPlayer(s: GameState, p: PlayerId, patch: Partial<Player>): GameState {
  return { ...s, players: s.players.map((x, i) => (i === p ? { ...x, ...patch } : x)) };
}

/**
 * A building far from the Mine (no ore flows into it), with an optional teleporter of `tele` on
 * every one of its inputs (since #55 a teleporter sits on one input; one on each input is what a
 * teleporter "on the input" was before).
 */
function building(
  id: string, type: BoardPiece['type'], claims: Claims, slots: (Material | null)[] = [], tele: PlayerId | null = null, q = 50,
): BoardPiece {
  const hasOutput = type === 'plateFact' || type === 'sphereFact' || type === 'tesseractFact';
  return {
    id, type, coord: { q, r: 0 }, rotation: 0, claims,
    input: slots.length > 0 ? { slots, teleporters: tele === null ? [] : slots.map(() => tele) } : null,
    output: hasOutput ? { slots: [null], teleporters: [] } : null,
  };
}

/** A 2-player game, player 0 then 1, on Mine 1 plus `extra`, in `phase`. */
function onBoard(extra: BoardPiece[], phase: GameState['phase'], active: 0 | 1 = 0): GameState {
  const g = createGame(1, 2);
  return {
    ...g, board: [g.board.find(p => p.id === 'mine-1')!, ...extra], turnOrder: [0, 1], activePlayerIndex: active, phase,
  };
}

const stack = (index: 0 | 1 | 2, pieces: PieceStack['pieces'], available = true): PieceStack => ({ index, available, pieces });

// ── #44: when the pieces run out, the round is finished ───────────────────────

describe('when the board pieces run out, the round is finished first (#44)', () => {
  // The round's first player is about to place the very last board piece.
  function lastPiece(): GameState {
    const s = completeSetup(1, 2);
    const last = s.stacks[0].pieces[0]!;
    return { ...s, stacks: [stack(0, [last]), stack(1, []), stack(2, [])], unplacedMines: [] };
  }
  // One plain move for the active player: roll 1s (no claim is on 1), end the actions, put the
  // meeple down, end the turn / the round-end turn.
  function next(s: GameState): GameState {
    const me = activePlayer(s);
    switch (s.phase) {
      case 'placePiece': return expectOk(applyAction(s, legalActions(s, me).find(a => a.type === 'PLACE_PIECE')!));
      case 'roll': return expectOk(applyAction(s, { type: 'ROLL_DICE', rolls: Array.from({ length: s.mineCount }, () => 1) }));
      case 'placeMeeple': return expectOk(applyAction(s, legalActions(s, me).find(a => a.type === 'PLACE_MEEPLE') ?? { type: 'END_TURN' }));
      default: return expectOk(applyAction(s, { type: 'END_ACTIONS' }));
    }
  }

  it('the other players take their turns (nothing to draw: straight to the roll), the round-end turns happen, then the game ends on points', () => {
    let s = lastPiece();
    const [first, second] = s.turnOrder as [PlayerId, PlayerId];
    s = next(s); // the last piece is placed
    expect(s.stacks.every(x => x.pieces.length === 0)).toBe(true);
    const seen: GameState[] = [];
    for (let i = 0; i < 40 && !s.gameOver; i++) { seen.push(s); s = next(s); }
    expect(s.gameOver).toBe(true);
    expect(s.gameOverReason).toBe('boardExhausted');
    // The second player had their turn: their place-a-piece step was skipped, straight to the roll.
    const secondTurn = seen.filter(x => activePlayer(x) === second && x.phase !== 'roundEnd');
    expect(secondTurn[0]!.phase).toBe('roll');
    expect(seen.some(x => x.phase === 'placePiece' && x.round === seen[0]!.round)).toBe(false);
    // Both round-end turns were played before the end.
    const roundEnd = seen.filter(x => x.phase === 'roundEnd');
    expect(new Set(roundEnd.map(x => activePlayer(x)))).toEqual(new Set([first, second]));
    // The player who must act always has a move (the roll's dice are an input, never listed).
    for (const x of seen) if (x.phase !== 'roll') expect(legalActions(x, activePlayer(x)).length).toBeGreaterThan(0);
  });

  it('ending the turn in which the last piece was placed no longer ends the game', () => {
    let s = next(lastPiece());
    while (s.phase !== 'placeMeeple') s = next(s);
    s = next(next(s)); // meeple, END_TURN
    expect(s.gameOver).toBe(false);
  });

  it('a player can still win with 4 Tesseracts on their own turn during the last turns', () => {
    let s = next(lastPiece());
    while (!(s.phase === 'roll' && s.activePlayerIndex === 1)) s = next(s);
    const me = activePlayer(s);
    s = patchPlayer(s, me, { inventory: inv(0, 0, 0, 4) });
    s = next(s);
    expect(s.gameOver).toBe(true);
    expect(s.gameOverReason).toBe('tesseracts');
    expect(s.winner).toBe(me);
  });

  it('Overstock Supplies with fewer than 3 pieces left draws what is left; with none, nothing', () => {
    const base = reachActionsPhase(1, 2);
    const me = activePlayer(base);
    const two = base.stacks[0].pieces.slice(0, 2);
    const s = patchPlayer({
      ...base, cardDeck: ['overstockSupplies', 'overstockSupplies'], cardDiscard: [],
      stacks: [stack(0, two), stack(1, []), stack(2, [])], unplacedMines: [],
    }, me, { inventory: inv(6, 0, 0, 0) });
    let a = expectOk(applyAction(s, { type: 'BUY_CARD' }));
    expect(a.overstockPieces.map(p => p.id)).toEqual(two.map(p => p.id));
    expect(code(a, { type: 'END_ACTIONS' })).toBe('OVERSTOCK_PENDING');
    for (let i = 0; i < 2; i++) a = expectOk(applyAction(a, legalActions(a, me).find(x => x.type === 'PLACE_OVERSTOCK_PIECE')!));
    expect(listed(a, { type: 'END_ACTIONS' }, me)).toBe(true);
    // Now nothing is left: a second Overstock Supplies draws nothing, and the turn goes on.
    const b = expectOk(applyAction(a, { type: 'BUY_CARD' }));
    expect(b.overstockPieces).toEqual([]);
    expect(code(b, { type: 'END_ACTIONS' })).toBeNull();
  });

  it('Scouting Drone takes the last piece; with none left it is not offered', () => {
    const base = reachActionsPhase(1, 2);
    const me = activePlayer(base);
    const one = base.stacks[0].pieces.slice(0, 1);
    const s = patchPlayer({ ...base, stacks: [stack(0, one), stack(1, []), stack(2, [])], unplacedMines: [], cardsPlayedThisTurn: 0 }, me, { hand: ['scoutingDrone'] });
    const drone = legalActions(s, me).find(a => a.type === 'PLAY_CARD' && a.cardType === 'scoutingDrone')!;
    const after = expectOk(applyAction(s, drone));
    expect(after.stacks.every(x => x.pieces.length === 0)).toBe(true);
    const none = { ...s, stacks: [stack(0, []), stack(1, []), stack(2, [])] as const };
    expect(legalActions(none, me).some(a => a.type === 'PLAY_CARD')).toBe(false);
  });
});

// ── #45: what goes through an input teleporter is the owner's choice ─────────

describe('a teleporter on an input lets its owner choose what to supply (#45)', () => {
  // Player 0's Sphere Factory (module 4) with player 0's teleporter on its empty input.
  const roll4 = (extra: BoardPiece[], active: 0 | 1 = 0, patch: Partial<Player> = {}, who: PlayerId = 0): GameState => {
    const s = patchPlayer(onBoard(extra, 'roll', active), who, { powerTokens: 5, inventory: inv(1, 2, 1, 0), ...patch });
    return expectOk(applyAction(s, { type: 'ROLL_DICE', rolls: [4] }));
  };
  const op = (pieceId: string, supply?: Material[], ownerId: PlayerId = 0): Action =>
    ({ type: 'OPERATE_BUILDING', pieceId, ownerId, ...(supply ? { supply } : {}) });
  const sf = (slots: (Material | null)[] = [null, null], tele: PlayerId | null = 0): BoardPiece =>
    building('sf', 'sphereFact', [{ ownerId: 0, controlModule: 4 }], slots, tele);

  it('a roll takes nothing from the inventory; the owner is offered one run per valid supply, and skip', () => {
    const s = roll4([sf()]);
    expect(s.pendingFactoryOps).toEqual([{ pieceId: 'sf', ownerId: 0 }]);
    expect(s.players[0]!.inventory).toEqual(inv(1, 2, 1, 0));
    const ops = legalActions(s, 0).filter(a => a.type === 'OPERATE_BUILDING');
    expect(ops).toEqual([op('sf', ['ore', 'plate']), op('sf', ['plate', 'plate'])]);
    expect(listed(s, { type: 'SKIP_FACTORY_ROLL', pieceId: 'sf', ownerId: 0 }, 0)).toBe(true);
    expect(operateSupplies(s, 'sf', 0)).toEqual([['ore', 'plate'], ['plate', 'plate']]);
  });

  it('runs with exactly the materials named, in any order; nothing else is taken', () => {
    const s = roll4([sf()]);
    const after = expectOk(applyAction(s, op('sf', ['plate', 'ore'])));
    expect(after.players[0]!.inventory).toEqual(inv(0, 1, 1, 0));
    expect(after.players[0]!.powerTokens).toBe(3);
    expect(after.board.find(p => p.id === 'sf')!.output!.slots).toEqual(['sphere']);
    expect(isListedMove(s, 0, op('sf', ['plate', 'ore']))).toBe(true);
  });

  it('refuses a run from an empty input without a supply, and a supply that is wrong', () => {
    const s = roll4([sf()]);
    expect(code(s, op('sf'))).toBe('CANNOT_OPERATE');
    expect(code(s, op('sf', []))).toBe('CANNOT_OPERATE');
    expect(code(s, op('sf', ['ore', 'sphere']))).toBe('INVALID_RECIPE');
    expect(code(s, op('sf', ['ore']))).toBe('INVALID_SUPPLY');
    expect(code(s, op('sf', ['ore', 'plate', 'plate']))).toBe('INVALID_SUPPLY');
    expect(code(s, op('sf', ['ore', 'ore']))).toBe('INSUFFICIENT_MATERIAL'); // holds 1 Ore
    expect(code(s, op('sf', ['tesseract', 'plate']))).toBe('INSUFFICIENT_MATERIAL');
  });

  it('the supply fills only the empty slots, together with what lies in the input', () => {
    const s = roll4([sf(['ore', null])]);
    expect(legalActions(s, 0).filter(a => a.type === 'OPERATE_BUILDING')).toEqual([op('sf', ['plate'])]);
    expect(code(s, op('sf', ['ore']))).toBe('INVALID_RECIPE'); // Ore + Ore is no Sphere recipe
  });

  it('a full input runs from the input alone; no supply is offered and the inventory is untouched', () => {
    const s = roll4([sf(['ore', 'plate'])]);
    expect(legalActions(s, 0).filter(a => a.type === 'OPERATE_BUILDING')).toEqual([op('sf')]);
    expect(code(s, op('sf', ['plate']))).toBe('INVALID_SUPPLY');
    const after = expectOk(applyAction(s, op('sf')));
    expect(after.players[0]!.inventory).toEqual(inv(1, 2, 1, 0));
  });

  it('only through a teleporter of the operator\'s own', () => {
    const noTele = patchPlayer(onBoard([building('pf', 'plateFact', [{ ownerId: 0, controlModule: 4 }], [null], null)], 'roundEnd'), 0,
      { meepleOnPieceId: 'pf', meepleSlotIndex: null, powerTokens: 5, inventory: inv(2, 0, 0, 0) });
    expect(code(noTele, { type: 'OPERATE_BUILDING', pieceId: 'pf', supply: ['ore'] })).toBe('NO_INPUT_TELEPORTER');
    const othersTele = { ...noTele, board: noTele.board.map(p => (p.id === 'pf' ? { ...p, input: { slots: [null], teleporters: [1 as const] } } : p)) };
    expect(code(othersTele, { type: 'OPERATE_BUILDING', pieceId: 'pf', supply: ['ore'] })).toBe('NO_INPUT_TELEPORTER');
  });

  it('the round-end meeple operation takes the same supply', () => {
    const s = patchPlayer(onBoard([building('pf', 'plateFact', [{ ownerId: 0, controlModule: 4 }], [null], 0)], 'roundEnd'), 0,
      { meepleOnPieceId: 'pf', meepleSlotIndex: null, powerTokens: 5, inventory: inv(2, 0, 0, 0) });
    const ops = legalActions(s, 0).filter(a => a.type === 'OPERATE_BUILDING');
    expect(ops).toEqual([{ type: 'OPERATE_BUILDING', pieceId: 'pf', supply: ['ore'] }]);
    const after = expectOk(applyAction(s, ops[0]!));
    expect(after.players[0]!.inventory.ore).toBe(1);
    expect(after.board.find(p => p.id === 'pf')!.output!.slots).toEqual(['plate']);
  });

  it('a missing and an empty supply are the same move; the order of the supply does not matter', () => {
    expect(sameMove(op('sf'), op('sf', []))).toBe(true);
    expect(sameMove(op('sf', ['plate', 'ore']), op('sf', ['ore', 'plate']))).toBe(true);
    expect(sameMove(op('sf', ['plate', 'plate']), op('sf', ['ore', 'plate']))).toBe(false);
    expect(canonicalAction(op('sf', ['sphere', 'ore', 'plate']))).toEqual(op('sf', ['ore', 'plate', 'sphere']));
    expect(canonicalAction(op('sf', []))).toEqual(op('sf'));
  });

  describe('Power Plants', () => {
    const pp = (slots: (Material | null)[] = [null], tele: PlayerId | null = 0, owner: PlayerId = 0): BoardPiece =>
      building('pp', 'powerPlant', [{ ownerId: owner, controlModule: 4 }], slots, tele);

    it('with the owner\'s teleporter on an empty input, activation is a decision: nothing, or one material held', () => {
      const s = roll4([pp()], 0, { powerTokens: 3, inventory: inv(1, 0, 1, 1) });
      expect(s.pendingFactoryOps).toEqual([{ pieceId: 'pp', ownerId: 0 }]);
      expect(s.players[0]!.powerTokens).toBe(3);
      expect(legalActions(s, 0)).toEqual([op('pp'), op('pp', ['ore']), op('pp', ['sphere'])]); // no skip
      expect(code(s, { type: 'SKIP_FACTORY_ROLL', pieceId: 'pp', ownerId: 0 })).toBe('MUST_RUN');
      expect(code(s, op('pp', ['tesseract']))).toBe('INVALID_RECIPE');
      expect(code(s, op('pp', ['plate']))).toBe('INSUFFICIENT_MATERIAL');
      expect(expectOk(applyAction(s, op('pp'))).players[0]!.powerTokens).toBe(4);
      const burnt = expectOk(applyAction(s, op('pp', ['sphere'])));
      expect(burnt.players[0]!.powerTokens).toBe(10);
      expect(burnt.players[0]!.inventory).toEqual(inv(1, 0, 0, 1));
    });

    it('every other Power Plant still runs at once: no teleporter, or material already in its input', () => {
      const plain = roll4([pp([null], null)], 0, { powerTokens: 3 });
      expect(plain.pendingFactoryOps).toEqual([]);
      expect(plain.players[0]!.powerTokens).toBe(4);
      const loaded = roll4([pp(['ore'])], 0, { powerTokens: 3 });
      expect(loaded.pendingFactoryOps).toEqual([]);
      expect(loaded.players[0]!.powerTokens).toBe(5);
    });

    it('decided by its owner on another player\'s turn; skippable only once it cannot run', () => {
      const s = roll4([pp([null], 1, 1)], 0, { powerTokens: 3, inventory: inv(1, 0, 0, 0) }, 1);
      expect(s.pendingFactoryOps).toEqual([{ pieceId: 'pp', ownerId: 1 }]);
      expect(legalActions(s, 1)).toEqual([op('pp', undefined, 1), op('pp', ['ore'], 1)]);
      const capped = patchPlayer(s, 1, { powerTokens: 10 }); // e.g. Solar Flare since the roll
      expect(legalActions(capped, 1)).toEqual([{ type: 'SKIP_FACTORY_ROLL', pieceId: 'pp', ownerId: 1 }]);
      expect(code(capped, { type: 'SKIP_FACTORY_ROLL', pieceId: 'pp', ownerId: 1 })).toBeNull();
    });
  });
});

// ── #46: Short Sale and Changing Priorities never take another player's building ──

describe("Short Sale and Changing Priorities cannot put a Control Module on another player's building (#46)", () => {
  const theirs = building('theirs', 'plateFact', [{ ownerId: 1, controlModule: 5 }], [null], null, 50);
  const free = building('free', 'plateFact', [], [null], null, 52);
  const mine = building('mine', 'plateFact', [{ ownerId: 0, controlModule: 4 }], [null], null, 54);
  const s = patchPlayer(onBoard([theirs, free, mine], 'actions'), 0, { hand: ['shortSale', 'changingPriorities'] });
  const ss = (pieceId: string): Action => ({ type: 'PLAY_CARD', cardType: 'shortSale', pieceId });
  const cp = (toPieceId: string): Action => ({ type: 'PLAY_CARD', cardType: 'changingPriorities', pieceId: 'mine', toPieceId, controlModule: 4 });

  it('Short Sale: refused and not offered on another player\'s building; fine on an unclaimed or own one', () => {
    expect(code(s, ss('theirs'))).toBe('ALREADY_CLAIMED');
    expect(listed(s, ss('theirs'), 0)).toBe(false);
    for (const id of ['free', 'mine']) {
      expect(code(s, ss(id))).toBeNull();
      expect(listed(s, ss(id), 0)).toBe(true);
    }
  });

  it('Changing Priorities: likewise for the building the module moves to', () => {
    expect(code(s, cp('theirs'))).toBe('ALREADY_CLAIMED');
    expect(listed(s, cp('theirs'), 0)).toBe(false);
    expect(code(s, cp('free'))).toBeNull();
    expect(listed(s, cp('free'), 0)).toBe(true);
  });
  // A building shared by two players (from a save made before #46) is refused when loading
  // (#57): see ownership.test.ts and session/__tests__/sharedBuilding.test.ts.
});

// ── #47: a Mine may touch the board with either half ──────────────────────────

describe('a new Mine may touch the board with either of its two hexes (#47)', () => {
  // Mine 1 at (0,0) with its lean hex at (1,0); Mine 2 waiting to be placed.
  const s: GameState = { ...onBoard([], 'placePiece'), pendingMineIds: ['mine-2'], unplacedMines: [{ id: 'mine-3', type: 'mine' }] };

  it('lean hex only next to the board: accepted and listed; neither: refused and not listed', () => {
    const lean: Action = { type: 'PLACE_MINE', coord: { q: 3, r: 0 }, rotation: 1 }; // lean hex at (2,0)
    expect(code(s, lean)).toBeNull();
    expect(listed(s, lean, 0)).toBe(true);
    const away: Action = { type: 'PLACE_MINE', coord: { q: 5, r: 0 }, rotation: 0 };
    expect(code(s, away)).toBe('NOT_ADJACENT');
    expect(listed(s, away, 0)).toBe(false);
  });

  it('the list holds every accepted placement, each once (PLACE_MINE and BUY_MINE)', () => {
    const buy: GameState = patchPlayer({ ...onBoard([], 'actions'), unplacedMines: [{ id: 'mine-2', type: 'mine' }, { id: 'mine-3', type: 'mine' }] }, 0, { inventory: inv(6, 0, 0, 0) });
    for (const [state, type] of [[s, 'PLACE_MINE'], [buy, 'BUY_MINE']] as const) {
      const list = legalActions(state, 0).filter(a => a.type === type);
      expect(new Set(list.map(a => JSON.stringify(a))).size).toBe(list.length);
      let accepted = 0;
      for (let q = -5; q <= 6; q++) for (let r = -5; r <= 5; r++) for (let rotation = 0; rotation < 6; rotation++) {
        const a = { type, coord: { q, r }, rotation } as Action;
        const ok = code(state, a) === null;
        if (ok) accepted++;
        expect(list.some(l => sameMove(l, a)), JSON.stringify(a)).toBe(ok);
      }
      expect(accepted).toBe(list.length);
    }
  });
});

// ── #48: the discard pile is shuffled into a new deck ─────────────────────────

describe('an empty Leverage deck is refilled from the shuffled discard pile (#48)', () => {
  const base = reachActionsPhase(1, 2);
  const me = activePlayer(base);
  const discard: CardType[] = ['shortSale', 'sinkHole', 'embezzlement', 'changingPriorities'];
  const s = patchPlayer({ ...base, cardDeck: [], cardDiscard: discard }, me, { inventory: inv(6, 0, 0, 0), hand: [] });

  it('a card can still be bought: the discard pile becomes the deck, shuffled with the game\'s seeded RNG', () => {
    expect(cardsLeftToDraw(s)).toBe(4);
    expect(listed(s, { type: 'BUY_CARD' }, me)).toBe(true);
    const drawn = nextCardDrawn(s);
    const after = expectOk(applyAction(s, { type: 'BUY_CARD' }));
    expect(after.players[me]!.hand).toEqual([drawn]);
    expect(after.cardDiscard).toEqual([]);
    expect([...after.cardDeck, drawn].sort()).toEqual([...discard].sort());
    expect(after.rng).not.toBe(s.rng);
    // Reproducible from the state alone.
    expect(expectOk(applyAction(s, { type: 'BUY_CARD' }))).toEqual(after);
  });

  it('only when the deck and the discard pile are both empty is buying impossible', () => {
    const none = { ...s, cardDiscard: [] };
    expect(cardsLeftToDraw(none)).toBe(0);
    expect(nextCardDrawn(none)).toBeNull();
    expect(code(none, { type: 'BUY_CARD' })).toBe('DECK_EMPTY');
    expect(listed(none, { type: 'BUY_CARD' }, me)).toBe(false);
    expect(cardCost(s.mineCount)).toBeLessThanOrEqual(6);
  });
});

// ── #49: a Mine's upgrade point gives the number printed on it ────────────────

describe("a Mine's upgrade point gives the number printed on that Mine (#49)", () => {
  it('2 on Mine 1 and 4 on Mine 3, with three Mines in play', () => {
    const g = createGame(5, 2);
    const extra = (id: string, q: number): BoardPiece => ({ ...g.board.find(p => p.id === 'mine-1')!, id, coord: { q, r: 30 } });
    const s: GameState = {
      ...g, board: [...g.board, extra('mine-2', 20), extra('mine-3', 30)], mineCount: 3, unplacedMines: [],
      phase: 'placeMeeple', activePlayerIndex: g.turnOrder.length - 1,
      players: g.players.map((p, i) => ({ ...p, meepleOnPieceId: i === 0 ? 'mine-1' : 'mine-3', meepleSlotIndex: 1 })),
    };
    const after = expectOk(applyAction(s, { type: 'END_TURN' }));
    expect(after.phase).toBe('roundEnd');
    expect(after.players[0]!.freeActionCredits).toBe(2);
    expect(after.players[1]!.freeActionCredits).toBe(4);
  });
});

// ── #50: Leverage cards in every step of your own turn ────────────────────────

describe('Leverage cards may be played in every step of your own turn (#50)', () => {
  const embezzle: Action = { type: 'PLAY_CARD', cardType: 'embezzlement' };
  const withHand = (s: GameState, hand: CardType[]): GameState => patchPlayer({ ...s, cardsPlayedThisTurn: 0 }, activePlayer(s), { hand });

  function ownTurnStates(): GameState[] {
    const place = completeSetup(1, 2);
    const roll = expectOk(applyAction(place, legalActions(place, activePlayer(place)).find(a => a.type === 'PLACE_PIECE')!));
    const actions = expectOk(applyAction(roll, { type: 'ROLL_DICE', rolls: [1] }));
    const meeple = expectOk(applyAction(actions, { type: 'END_ACTIONS' }));
    const placed = expectOk(applyAction(meeple, legalActions(meeple, activePlayer(meeple)).find(a => a.type === 'PLACE_MEEPLE')!));
    return [place, roll, actions, meeple, placed];
  }

  it('place a piece, roll, actions, place the meeple (before and after it is down): listed and accepted', () => {
    for (const st of ownTurnStates()) {
      const s = withHand(st, ['embezzlement']);
      const me = activePlayer(s);
      expect(listed(s, embezzle, me), s.phase).toBe(true);
      const after = expectOk(applyAction(s, embezzle));
      expect(after.players[me]!.inventory.sphere).toBe(s.players[me]!.inventory.sphere + 1);
      expect(after.phase).toBe(s.phase);
    }
  });

  it('not in the setup claims and not in the round-end turns', () => {
    const setup = withHand(createGame(1, 2), ['embezzlement']);
    const roundEnd = withHand({ ...reachActionsPhase(1, 2), phase: 'roundEnd' }, ['embezzlement']);
    for (const s of [setup, roundEnd]) {
      expect(code(s, embezzle)).toBe('WRONG_PHASE');
      expect(listed(s, embezzle, activePlayer(s))).toBe(false);
    }
  });

  it('still at most 2 per turn, across the steps', () => {
    let s = withHand(completeSetup(1, 2), ['embezzlement', 'embezzlement', 'embezzlement']);
    const me = activePlayer(s);
    s = expectOk(applyAction(s, embezzle)); // place-a-piece step
    s = expectOk(applyAction(s, legalActions(s, me).find(a => a.type === 'PLACE_PIECE')!));
    s = expectOk(applyAction(s, embezzle)); // roll step
    s = expectOk(applyAction(s, { type: 'ROLL_DICE', rolls: [1] }));
    expect(code(s, embezzle)).toBe('CARD_LIMIT_REACHED');
    expect(listed(s, embezzle, me)).toBe(false);
  });

  it('a pending operate-or-skip decision of your own still comes first', () => {
    const s = patchPlayer(onBoard([building('pf', 'plateFact', [{ ownerId: 0, controlModule: 4 }], ['ore'])], 'roll'), 0, { powerTokens: 5, hand: ['embezzlement'] });
    const rolled = expectOk(applyAction(s, { type: 'ROLL_DICE', rolls: [4] }));
    expect(rolled.pendingFactoryOps).toEqual([{ pieceId: 'pf', ownerId: 0 }]);
    expect(code(rolled, embezzle)).toBe('DECISION_PENDING');
    expect(listed(rolled, embezzle, 0)).toBe(false);
  });

  it('Production Increase played before the roll is spent there on a claim', () => {
    const [, roll] = ownTurnStates();
    const me = activePlayer(roll!);
    const s = withHand({ ...roll!, board: [...roll!.board, building('free', 'plateFact', [], [null])] }, ['productionIncrease']);
    const pi = expectOk(applyAction(s, { type: 'PLAY_CARD', cardType: 'productionIncrease' }));
    const claim: Action = { type: 'CLAIM_BUILDING', pieceId: 'free', controlModule: 4, fromProductionIncrease: true };
    expect(listed(pi, claim, me)).toBe(true);
    const claimed = expectOk(applyAction(pi, claim));
    expect(claimed.phase).toBe('roll');
    expect(claimed.productionIncreaseBudget).toBe(0);
  });

  describe('Scouting Drone in the place-a-piece step', () => {
    it('before a draw it is played and the piece is still to be placed; after a draw it is not', () => {
      const s = withHand(completeSetup(1, 2), ['scoutingDrone']);
      const me = activePlayer(s);
      const drone = legalActions(s, me).find(a => a.type === 'PLAY_CARD' && a.cardType === 'scoutingDrone')!;
      const after = expectOk(applyAction(s, drone));
      expect(after.phase).toBe('placePiece');
      expect(legalActions(after, me).some(a => a.type === 'PLACE_PIECE')).toBe(true);

      const two = withHand({ ...s, stacks: [s.stacks[0], { ...s.stacks[1], available: true }, s.stacks[2]] }, ['scoutingDrone']);
      const drawn = expectOk(applyAction(two, { type: 'DRAW_PIECE', stackIndex: 1 }));
      expect(legalActions(drawn, me).some(a => a.type === 'PLAY_CARD')).toBe(false);
      expect(code(drawn, { ...drone, stackIndex: 0 } as Action)).toBe('ALREADY_DRAWN');
    });

    it('taking the last piece of a stack drops the next Mine, which then replaces the placement', () => {
      const base = completeSetup(1, 2);
      const s = withHand({ ...base, stacks: [stack(0, base.stacks[0].pieces.slice(0, 1)), base.stacks[1], base.stacks[2]] }, ['scoutingDrone']);
      const me = activePlayer(s);
      const drone = legalActions(s, me).find(a => a.type === 'PLAY_CARD' && a.cardType === 'scoutingDrone')!;
      const after = expectOk(applyAction(s, drone));
      expect(after.pendingMineIds).toEqual(['mine-2']);
      const moves = legalActions(after, me);
      expect(moves.some(a => a.type === 'PLACE_MINE')).toBe(true);
      expect(moves.some(a => a.type === 'PLACE_PIECE')).toBe(false);
    });
  });

  it('Changing Priorities after the meeple is down keeps its last Control Module under the meeple', () => {
    const a = building('a', 'plateFact', [{ ownerId: 0, controlModule: 4 }], [null], null, 50);
    const b = building('b', 'plateFact', [{ ownerId: 0, controlModule: 5 }], [null], null, 52);
    const before = patchPlayer(onBoard([a, b], 'placeMeeple'), 0, { hand: ['changingPriorities'] });
    const s = expectOk(applyAction(before, { type: 'PLACE_MEEPLE', pieceId: 'a' }));
    const off: Action = { type: 'PLAY_CARD', cardType: 'changingPriorities', pieceId: 'a', toPieceId: 'b', controlModule: 4 };
    const fromB: Action = { type: 'PLAY_CARD', cardType: 'changingPriorities', pieceId: 'b', toPieceId: 'a', controlModule: 5 };
    expect(code(s, off)).toBe('MEEPLE_ON_BUILDING');
    expect(listed(s, off, 0)).toBe(false);
    expect(listed(s, fromB, 0)).toBe(true);
    expect(code(s, fromB)).toBeNull();
    // Before the meeple is down, both moves are fine.
    expect(listed(before, off, 0)).toBe(true);
  });
});
