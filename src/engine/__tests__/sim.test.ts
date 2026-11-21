import { describe, it, expect } from 'vitest';
import { createGame } from '../rules/setup';
import { applyAction, legalActions } from '../reducer';
import { chooseAction as randomBotFn } from '../../bots/randomBot';
import { chooseAction as greedyBotFn } from '../../bots/greedyBot';
import { runGame, runGames } from '../../sim/runGames';
import { createRng, nextIntBelow } from '../rng';
import type { Action } from '../actions';
import type { PlayerId } from '../state';

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
// action of that type, so rare kinds (card plays, pending operations) are exercised too.
describe('legalActions ⊆ applyAction, every player, seeded games', () => {
  it('holds at every step of several 2-, 3- and 4-player games', { timeout: 60_000 }, () => {
    let rng = createRng(2024);
    const below = (n: number): number => { const [v, next] = nextIntBelow(rng, n); rng = next; return v; };
    const pick = <T>(xs: readonly T[]): T => xs[below(xs.length)]!;
    const checked = { steps: 0, actions: 0, offTurnPending: 0, staleOperates: 0, drones: 0 };

    for (const [pc, seed] of [[2, 1], [2, 2], [3, 3], [3, 22], [4, 5], [4, 6]] as const) {
      let state = createGame(seed, pc);
      for (let step = 0; step < 250 && !state.gameOver; step++) {
        checked.steps++;
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
            choices.push({ p: p as PlayerId, a });
          }
          // A pending entry whose operate is not listed is a stale one (now only skippable). These
          // games rarely produce one; legalActions.test.ts constructs that case directly.
          for (const e of state.pendingFactoryOps) {
            if (e.ownerId === p && !legal.some(a => a.type === 'OPERATE_BUILDING' && a.pieceId === e.pieceId)) checked.staleOperates++;
          }
        }
        let action: Action;
        if (state.phase === 'roll' && state.pendingFactoryOps.length === 0) {
          action = { type: 'ROLL_DICE', rolls: Array.from({ length: state.mineCount }, () => 1 + below(6)) };
        } else {
          if (choices.length === 0) break;
          const types = [...new Set(choices.map(c => c.a.type))].filter(t => t !== 'REMOVE_BELT' || below(5) === 0);
          const t = types.length ? pick(types) : choices[0]!.a.type;
          action = pick(choices.filter(c => c.a.type === t)).a;
        }
        const result = applyAction(state, action);
        expect(result.ok).toBe(true);
        if (!result.ok) break;
        state = result.state;
      }
    }
    expect(checked.steps).toBeGreaterThan(1000);
    // eslint-disable-next-line no-console -- coverage figures for the report
    console.log(`legalActions property: ${JSON.stringify(checked)}`);
    expect(checked.offTurnPending).toBeGreaterThan(0); // non-active owners' operations were checked
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
