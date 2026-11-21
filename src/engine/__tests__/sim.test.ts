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
// action of that type, so rare kinds (card plays, pending operations) are exercised too; it also
// steers towards a second player's claim on an already-claimed building (Short Sale / Changing
// Priorities), so co-owned buildings occur. On sampled states it checks the other direction too:
// every PLACE_BELT (every piece, every ordered pair of points) and every DRAW_PIECE (every stack)
// that applyAction accepts is listed — a belt up to endpoint order (sameMove), with the same
// effect as its listed form apart from the stored order.

// A claim by `p` that makes a building co-owned: Short Sale or Changing Priorities onto a
// building someone else has claimed and `p` has not.
function coOwningPlay(state: GameState, p: PlayerId, a: Action): boolean {
  if (a.type !== 'PLAY_CARD') return false;
  const target = a.cardType === 'shortSale' ? a.pieceId : a.cardType === 'changingPriorities' ? a.toPieceId : undefined;
  const piece = target === undefined ? undefined : state.board.find(b => b.id === target);
  return !!piece && piece.claims.length > 0 && !piece.claims.some(c => c.ownerId === p);
}

const isCoOwned = (state: GameState): boolean =>
  state.board.some(b => new Set(b.claims.map(c => c.ownerId)).size >= 2);

describe('legalActions ⊆ applyAction, every player, seeded games', () => {
  it('holds at every step of several 2-, 3- and 4-player games; accepted belts and draws are listed', { timeout: 180_000 }, () => {
    let rng = createRng(2024);
    const below = (n: number): number => { const [v, next] = nextIntBelow(rng, n); rng = next; return v; };
    const pick = <T>(xs: readonly T[]): T => xs[below(xs.length)]!;
    const checked = {
      steps: 0, actions: 0, offTurnPending: 0, staleOperates: 0, drones: 0,
      drawsApplied: 0, laterMineStates: 0, coOwnedStates: 0, minesBought: 0, buyMineListed: 0,
      beltSweeps: 0, beltsAccepted: 0, reversedAccepted: 0, drawSweeps: 0, drawsAccepted: 0,
    };

    // `saving` games steer towards an early Mine purchase (two open stacks: the draw step); the
    // others towards co-owned buildings.
    for (const [pc, seed, saving] of [[2, 1, false], [2, 2, true], [3, 3, false], [3, 22, true], [4, 5, false], [4, 6, true], [3, 7, false], [4, 8, true]] as const) {
      let state = createGame(seed, pc);
      for (let step = 0; step < 400 && !state.gameOver; step++) {
        checked.steps++;
        if (state.board.some(b => b.id === 'mine-2' || b.id === 'mine-3')) checked.laterMineStates++;
        if (isCoOwned(state)) checked.coOwnedStates++;
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
            if (a.type === 'BUY_MINE') checked.buyMineListed++;
            choices.push({ p: p as PlayerId, a });
          }
          // A pending entry whose operate is not listed is a stale one (now only skippable). These
          // games rarely produce one; legalActions.test.ts constructs that case directly.
          for (const e of state.pendingFactoryOps) {
            if (e.ownerId === p && !legal.some(a => a.type === 'OPERATE_BUILDING' && a.pieceId === e.pieceId)) checked.staleOperates++;
          }
        }
        // Accepted ⇒ listed, for the active player (applyAction acts for the active player). Only
        // where that player has no factory decision of their own pending: legalActions then offers
        // only operate/skip by design, while applyAction does not check it.
        const ownPending = state.pendingFactoryOps.some(e => e.ownerId === active);
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
        if (state.phase === 'placePiece' && !ownPending) {
          checked.drawSweeps++;
          for (const stackIndex of [0, 1, 2] as const) {
            const a: Action = { type: 'DRAW_PIECE', stackIndex };
            const accepted = applyAction(state, a).ok;
            if (accepted) checked.drawsAccepted++;
            expect(listedAs(a) !== undefined, `seed ${seed} step ${step}: ${JSON.stringify(a)}`).toBe(accepted);
          }
        }
        if (state.phase === 'actions' && !ownPending && step % 12 === 0) {
          checked.beltSweeps++;
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
          const coOwning = choices.filter(c => coOwningPlay(state, c.p, c.a));
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
          } else if (!saving && coOwning.length > 0) {
            action = pick(coOwning).a;
          } else if (!saving && buyCard.length > 0 && below(3) === 0) {
            action = buyCard[0]!.a; // Short Sale / Changing Priorities are how a building gets co-owned
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
        state = result.state;
      }
    }
    expect(checked.steps).toBeGreaterThan(1000);
    // eslint-disable-next-line no-console -- coverage figures for the report
    console.log(`legalActions property: ${JSON.stringify(checked)}`);
    expect(checked.offTurnPending).toBeGreaterThan(0); // non-active owners' operations were checked
    expect(checked.drawsApplied).toBeGreaterThan(0);    // the draw step was played
    expect(checked.laterMineStates).toBeGreaterThan(0); // Mine 2 or 3 was on the board
    expect(checked.coOwnedStates).toBeGreaterThan(0);   // a building was claimed by two players
    expect(checked.beltSweeps).toBeGreaterThan(0);
    expect(checked.reversedAccepted).toBeGreaterThan(0);
    expect(checked.drawsAccepted).toBeGreaterThan(0);
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
