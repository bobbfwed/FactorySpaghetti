import { describe, it, expect } from 'vitest';
import { createGame } from '../rules/setup';
import { applyAction, legalActions } from '../reducer';
import { chooseAction as randomBotFn } from '../../bots/randomBot';
import { chooseAction as greedyBotFn } from '../../bots/greedyBot';
import { runGame, runGames } from '../../sim/runGames';

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
