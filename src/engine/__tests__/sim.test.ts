import { describe, it, expect } from 'vitest';
import { createGame } from '../rules/setup';
import { applyAction, legalActions } from '../reducer';
import { chooseAction as randomBotFn } from '../../bots/randomBot';
import { chooseAction as greedyBotFn } from '../../bots/greedyBot';
import { runGame, runGames } from '../../sim/runGames';
import { createRng, nextIntBelow } from '../rng';
import type { Action } from '../actions';
import { canonicalAction, sameMove } from '../actions';
import type { GameState, PlayerId } from '../state';
import { sameUpToBeltOrder } from './beltOrderHelpers';

// ── Helpers ───────────────────────────────────────────────────────────────────

function playFullGame(seed: number, playerCount: 2 | 3 | 4 = 2) {
  return runGame(seed, playerCount, [randomBotFn, randomBotFn, randomBotFn, randomBotFn]);
}

// ── Single-game sanity ────────────────────────────────────────────────────────

describe('randomBot single game', () => {
  it('completes a 2-player game without error', () => {
    const result = playFullGame(1);
    expect(result.didNotFinish).toBe(false);
    expect(result.totalActions).toBeGreaterThan(0);
    expect(result.gameOverReason).not.toBeNull();
  });

  it('completes a 3-player game', () => {
    const result = runGame(2, 3, [randomBotFn, randomBotFn, randomBotFn]);
    expect(result.didNotFinish).toBe(false);
  });

  it('completes a 4-player game', () => {
    const result = runGame(3, 4, [randomBotFn, randomBotFn, randomBotFn, randomBotFn]);
    expect(result.didNotFinish).toBe(false);
  });

  it('greedyBot completes a 2-player game', () => {
    const result = runGame(4, 2, [greedyBotFn, greedyBotFn]);
    expect(result.didNotFinish).toBe(false);
  });
});

// ── legalActions correctness ──────────────────────────────────────────────────
// Every action returned by legalActions() must be accepted by applyAction().

describe('legalActions correctness', () => {
  it('every action from legalActions is accepted by applyAction', () => {
    let state = createGame(42, 2);
    let steps = 0;
    const MAX_STEPS = 500;

    while (!state.gameOver && steps < MAX_STEPS) {
      const playerId = state.turnOrder[state.activePlayerIndex];
      if (playerId === undefined) break;

      if (state.phase === 'roll') {
        // Roll phase is handled specially — generate dice and apply.
        const rolls = Array.from({ length: state.mineCount }, () => Math.ceil(Math.random() * 6));
        const r = applyAction(state, { type: 'ROLL_DICE', rolls });
        expect(r.ok).toBe(true);
        if (!r.ok) break;
        state = r.state;
      } else {
        const actions = legalActions(state, playerId);
        // Pick every action and verify it would be accepted (check against a fresh copy of state).
        for (const action of actions) {
          const probe = applyAction(state, action);
          expect(
            probe.ok,
            `legalActions returned illegal action: ${JSON.stringify(action)} — ${probe.ok ? '' : (probe as { error: { code: string; message: string } }).error.code}`,
          ).toBe(true);
        }
        // Advance the game with a random choice.
        if (actions.length === 0) break;
        const chosen = actions[Math.floor(Math.random() * actions.length)]!;
        const result = applyAction(state, chosen);
        if (!result.ok) break;
        state = result.state;
      }
      steps++;
    }
  });
});

// Seeded property check over whole random games: at EVERY step and for EVERY player (not just
// the active one — owners of a pending factory activation may act off-turn), every action that
// legalActions lists is accepted by applyAction. The policy picks an action type first, then an
// action of that type, so rare kinds (card plays, pending operations) are exercised too. At every
// step it checks the ownership invariants (RULES_CHANGES.md #57, #58): no building has two
// owners, no unclaimed building holds material or a Teleporter, and no Teleporter sits on a
// building its placer does not own; and no claiming move onto another player's building is ever
// listed. The non-saving games steer towards Short Sale and Changing Priorities, so owners leave
// buildings (and forfeit what is in them) and claim others. On sampled states it checks the other
// direction too: every PLACE_BELT (every piece, every ordered pair of points) and every DRAW_PIECE
// (every stack) that applyAction accepts is listed — a belt up to endpoint order (sameMove), with
// the same effect as its listed form apart from the stored order.

// A claiming move by `p` onto a building another player has claimed: CLAIM_BUILDING, Short Sale,
// or Changing Priorities to it.
function claimsOthersBuilding(state: GameState, p: PlayerId, a: Action): boolean {
  const target = a.type === 'CLAIM_BUILDING' ? a.pieceId
    : a.type !== 'PLAY_CARD' ? undefined
    : a.cardType === 'shortSale' ? a.pieceId : a.cardType === 'changingPriorities' ? a.toPieceId : undefined;
  const piece = target === undefined ? undefined : state.board.find(b => b.id === target);
  return !!piece && piece.claims.some(c => c.ownerId !== p);
}

// The first broken ownership invariant (#57, #58) in `state`, or null.
function ownershipProblem(state: GameState): string | null {
  for (const b of state.board) {
    if (new Set(b.claims.map(c => c.ownerId)).size > 1) return `${b.id} has two owners`;
    const owner = b.claims[0]?.ownerId;
    for (const buf of [b.input, b.output]) {
      if (!buf) continue;
      if (b.claims.length === 0 && b.type !== 'mine' && buf.slots.some(m => m !== null)) return `unclaimed ${b.id} holds material`;
      if (buf.teleporters.some(t => t != null && t !== owner)) return `${b.id} has a Teleporter of a player who does not own it`;
    }
  }
  return null;
}

describe('legalActions ⊆ applyAction, every player, seeded games', () => {
  it('holds at every step of several 2-, 3- and 4-player games; accepted belts and draws are listed', { timeout: 180_000 }, () => {
    let rng = createRng(2024);
    const below = (n: number): number => { const [v, next] = nextIntBelow(rng, n); rng = next; return v; };
    const pick = <T>(xs: readonly T[]): T => xs[below(xs.length)]!;
    const checked = {
      steps: 0, actions: 0, offTurnPending: 0, staleOperates: 0, drones: 0,
      drawsApplied: 0, laterMineStates: 0, ownersLeft: 0, materialForfeited: 0, minesBought: 0, buyMineListed: 0,
      beltSweeps: 0, beltsAccepted: 0, reversedAccepted: 0, drawSweeps: 0, drawsAccepted: 0,
      ownPendingStates: 0, ownPendingSweeps: 0, suppliedOperates: 0, cardsOutsideActions: 0,
    };

    // `saving` games steer towards an early Mine purchase (two open stacks: the draw step); the
    // others towards the cards that move or add claims.
    for (const [pc, seed, saving] of [[2, 1, false], [2, 2, true], [3, 3, false], [3, 22, true], [4, 5, false], [4, 6, true], [3, 7, false], [4, 8, true]] as const) {
      let state = createGame(seed, pc);
      rng = createRng(2024 + seed); // each game its own choices, so steering one does not shift the others
      for (let step = 0; step < 400 && !state.gameOver; step++) {
        checked.steps++;
        expect(ownershipProblem(state), `seed ${seed} step ${step}`).toBeNull();
        // The non-saving games hand the active player a Changing Priorities now and then (drawing
        // one is rare), so owners do leave buildings with material in them.
        if (!saving && step >= 20 && step % 40 === 0) {
          const p = state.turnOrder[state.activePlayerIndex]!;
          state = { ...state, players: state.players.map(x => (x.id === p ? { ...x, hand: [...x.hand, 'changingPriorities' as const] } : x)) };
        }
        if (state.board.some(b => b.id === 'mine-2' || b.id === 'mine-3')) checked.laterMineStates++;
        const active = state.turnOrder[state.activePlayerIndex]!;
        const choices: Array<{ p: PlayerId; a: Action }> = [];
        for (let p = 0; p < pc; p++) {
          const legal = legalActions(state, p as PlayerId);
          for (const a of legal) {
            const probe = applyAction(state, a);
            expect(probe.ok, `player ${p}, phase ${state.phase}, seed ${seed}: ${JSON.stringify(a)} — ${probe.ok ? '' : probe.error.code}`).toBe(true);
            checked.actions++;
            if (a.type === 'OPERATE_BUILDING' && a.ownerId !== undefined && p !== active) checked.offTurnPending++;
            if (a.type === 'PLAY_CARD' && a.cardType === 'scoutingDrone') checked.drones++;
            if (a.type === 'OPERATE_BUILDING' && (a.supply?.length ?? 0) > 0) checked.suppliedOperates++;
            if (a.type === 'PLAY_CARD' && state.phase !== 'actions') checked.cardsOutsideActions++;
            if (a.type === 'BUY_MINE') checked.buyMineListed++;
            expect(claimsOthersBuilding(state, p as PlayerId, a), `listed onto another player's building: ${JSON.stringify(a)}`).toBe(false);
            choices.push({ p: p as PlayerId, a });
          }
          // A pending entry whose operate is not listed is a stale one (now only skippable). These
          // games rarely produce one; legalActions.test.ts constructs that case directly.
          for (const e of state.pendingFactoryOps) {
            if (e.ownerId === p && !legal.some(a => a.type === 'OPERATE_BUILDING' && a.pieceId === e.pieceId)) checked.staleOperates++;
          }
        }
        // Accepted ⇒ listed, for the active player (applyAction acts for the active player), in
        // every state, including those where the active player has a factory decision of their own
        // pending: the engine then refuses everything but operate/skip (DECISION_PENDING, #40).
        const ownPending = state.pendingFactoryOps.some(e => e.ownerId === active);
        if (ownPending) checked.ownPendingStates++;
        const activeLegal = choices.filter(c => c.p === active).map(c => c.a);
        // Index the listed belts and draws by their canonical form (one lookup per probe instead of
        // a scan of the whole list); the match found is then confirmed with sameMove itself.
        const listedByKey = new Map<string, Action>();
        for (const l of activeLegal) {
          if (l.type === 'PLACE_BELT' || l.type === 'DRAW_PIECE') listedByKey.set(JSON.stringify(canonicalAction(l)), l);
        }
        const listedAs = (a: Action): Action | undefined => {
          const l = listedByKey.get(JSON.stringify(canonicalAction(a)));
          return l && sameMove(l, a) ? l : undefined;
        };
        if (state.phase === 'placePiece') {
          checked.drawSweeps++;
          for (const stackIndex of [0, 1, 2] as const) {
            const a: Action = { type: 'DRAW_PIECE', stackIndex };
            const accepted = applyAction(state, a).ok;
            if (accepted) checked.drawsAccepted++;
            expect(listedAs(a) !== undefined, `seed ${seed} step ${step}: ${JSON.stringify(a)}`).toBe(accepted);
          }
        }
        if (state.phase === 'actions' && (step % 12 === 0 || (ownPending && step % 3 === 0))) {
          checked.beltSweeps++;
          if (ownPending) checked.ownPendingSweeps++;
          for (const piece of state.board) {
            const n = piece.type === 'mine' ? 24 : 12;
            for (let i = 0; i < n; i++) {
              for (let j = 0; j < n; j++) {
                if (i === j) continue;
                const a: Action = { type: 'PLACE_BELT', pieceId: piece.id, fromPoint: i, toPoint: j };
                const r = applyAction(state, a);
                const listed = listedAs(a);
                expect(!!listed, `seed ${seed} step ${step}: ${JSON.stringify(a)} accepted=${r.ok}`).toBe(r.ok);
                if (!r.ok || !listed) continue;
                checked.beltsAccepted++;
                if (i > j) {
                  checked.reversedAccepted++;
                  const viaListed = applyAction(state, listed);
                  expect(viaListed.ok && sameUpToBeltOrder(r.state, viaListed.state), `${JSON.stringify(a)} differs from its listed form`).toBe(true);
                }
              }
            }
          }
        }

        let action: Action;
        if (state.phase === 'roll' && state.pendingFactoryOps.length === 0) {
          action = { type: 'ROLL_DICE', rolls: Array.from({ length: state.mineCount }, () => 1 + below(6)) };
        } else {
          if (choices.length === 0) break;
          // Cards that move or add a claim: owners leave buildings and claim others.
          const claimCards = choices.filter(c => c.a.type === 'PLAY_CARD' && (c.a.cardType === 'shortSale' || c.a.cardType === 'changingPriorities'));
          const buyCard = choices.filter(c => c.a.type === 'BUY_CARD');
          // Buying a Mine before a stack runs out is what leaves two stacks open (the draw step);
          // an auto-dropped Mine only arrives once the earlier stack is empty. So the "saving" games
          // spend nothing on cards, belts or teleporters and buy a Mine as soon as they can.
          const buyMine = choices.filter(c => c.a.type === 'BUY_MINE');
          const SPENDING = new Set<Action['type']>(['BUY_CARD', 'BUY_BELT', 'PLACE_TELEPORTER']);
          // ...and they gather: meeple on a Mine's resource point, collect every output.
          const gather = choices.filter(c => (c.a.type === 'PLACE_MEEPLE' && c.a.slotIndex === 0) || c.a.type === 'COLLECT_OUTPUT');
          if (saving && buyMine.length > 0) {
            action = pick(buyMine).a;
          } else if (saving && gather.length > 0) {
            action = pick(gather).a;
          } else if (!saving && claimCards.length > 0) {
            // Prefer a Changing Priorities that leaves a building with material in it without an owner.
            const leaving = claimCards.filter(c => {
              if (c.a.type !== 'PLAY_CARD' || c.a.cardType !== 'changingPriorities') return false;
              const from = state.board.find(b => b.id === (c.a as { pieceId?: string }).pieceId);
              return !!from && from.claims.length === 1 && [...(from.input?.slots ?? []), ...(from.output?.slots ?? [])].some(m => m !== null);
            });
            action = pick(leaving.length > 0 ? leaving : claimCards).a;
          } else if (!saving && buyCard.length > 0 && below(3) === 0) {
            action = buyCard[0]!.a; // for Short Sale / Changing Priorities
          } else {
            const types = [...new Set(choices.map(c => c.a.type))]
              .filter(t => t !== 'REMOVE_BELT' || below(5) === 0)
              .filter(t => !saving || !SPENDING.has(t));
            const t = types.length ? pick(types) : choices[0]!.a.type;
            action = pick(choices.filter(c => c.a.type === t)).a;
          }
        }
        const result = applyAction(state, action);
        expect(result.ok).toBe(true);
        if (!result.ok) break;
        if (action.type === 'DRAW_PIECE') checked.drawsApplied++;
        if (action.type === 'BUY_MINE') checked.minesBought++;
        if (action.type === 'PLAY_CARD' && action.cardType === 'changingPriorities') {
          const before = state.board.find(b => b.id === action.pieceId);
          const after = result.state.board.find(b => b.id === action.pieceId);
          if (before && after && before.claims.length > 0 && after.claims.length === 0) {
            checked.ownersLeft++;
            if (before.input?.slots.some(m => m !== null) || before.output?.slots.some(m => m !== null)) checked.materialForfeited++;
          }
        }
        state = result.state;
      }
    }
    expect(checked.steps).toBeGreaterThan(1000);
    // eslint-disable-next-line no-console -- coverage figures for the report
    console.log(`legalActions property: ${JSON.stringify(checked)}`);
    expect(checked.offTurnPending).toBeGreaterThan(0); // non-active owners' operations were checked
    expect(checked.drawsApplied).toBeGreaterThan(0);    // the draw step was played
    expect(checked.laterMineStates).toBeGreaterThan(0); // Mine 2 or 3 was on the board
    expect(checked.ownersLeft).toBeGreaterThan(0);      // Changing Priorities left a building without an owner
    expect(checked.materialForfeited).toBeGreaterThan(0); // ...with material in it, which went to the bank
    expect(checked.beltSweeps).toBeGreaterThan(0);
    expect(checked.reversedAccepted).toBeGreaterThan(0);
    expect(checked.drawsAccepted).toBeGreaterThan(0);
    expect(checked.ownPendingSweeps).toBeGreaterThan(0); // swept with the active player's own decision pending
  });
});

// ── 10k+ turn fuzzer ─────────────────────────────────────────────────────────
// Run randomBot games until ≥ 10 000 actions have been processed without any
// engine error. This is the primary regression guard for the rule engine.

describe('fuzzer: 10k+ actions', () => {
  it('processes 10 000+ actions without crash', { timeout: 60_000 }, () => {
    let totalActions = 0;
    let seed = 100;

    while (totalActions < 10_000) {
      const result = runGame(seed++, 2, [randomBotFn, randomBotFn]);
      // runGame() throws if applyAction rejects a bot action.
      expect(result.didNotFinish).toBe(false);
      totalActions += result.totalActions;
    }

    expect(totalActions).toBeGreaterThanOrEqual(10_000);
  });
});

// ── Aggregate stats ───────────────────────────────────────────────────────────

describe('runGames statistics', () => {
  it('returns meaningful stats over 20 games', { timeout: 60_000 }, () => {
    const stats = runGames(200, 20, 2, [randomBotFn, randomBotFn]);

    expect(stats.gamesPlayed).toBe(20);
    expect(stats.didNotFinish).toBe(0);
    expect(stats.totalActions).toBeGreaterThan(0);
    expect(stats.avgActionsPerGame).toBeGreaterThan(10);
    // At least one game must have ended (either way).
    expect(stats.tesseractWins + stats.boardExhaustionWins + stats.tiedGames).toBe(20);
  });

  it('greedyBot stats over 10 games', { timeout: 60_000 }, () => {
    const stats = runGames(300, 10, 2, [greedyBotFn, greedyBotFn]);

    expect(stats.gamesPlayed).toBe(10);
    expect(stats.didNotFinish).toBe(0);
  });

  it('mixed randomBot vs greedyBot over 10 games', { timeout: 60_000 }, () => {
    const stats = runGames(400, 10, 2, [randomBotFn, greedyBotFn]);

    expect(stats.gamesPlayed).toBe(10);
    expect(stats.didNotFinish).toBe(0);
    expect(stats.wins.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(10);
  });
});
