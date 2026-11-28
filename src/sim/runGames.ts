// Headless N-game runner.
// Drives a full game loop using bot functions; throws on any illegal action. The dice are rolled
// here from a stream seeded by the game seed (as the online host and the tournament do; a bot's
// own dice are ignored), so a seed always gives the same game.
// Emits per-game and aggregate statistics for balance analysis.

import { createGame } from '../engine/rules/setup';
import { applyAction } from '../engine/reducer';
import type { GameState, PlayerId } from '../engine/state';
import type { BotFn } from '../bots/botInterface';
import { nextIntBelow } from '../engine/rng';
import { diceStream } from './tournament';

export interface GameResult {
  readonly winner: PlayerId | null;
  readonly tiedWinners: ReadonlyArray<PlayerId>;
  readonly gameOverReason: 'tesseracts' | 'boardExhausted' | null;
  readonly totalActions: number;
  readonly totalRounds: number;
  readonly didNotFinish: boolean; // true if maxActions was reached
}

export interface SimStats {
  readonly gamesPlayed: number;
  readonly totalActions: number;
  readonly avgActionsPerGame: number;
  readonly avgRoundsPerGame: number;
  readonly wins: ReadonlyArray<number>; // wins[i] = wins for player-index i
  readonly tesseractWins: number;
  readonly boardExhaustionWins: number;
  readonly tiedGames: number;
  readonly didNotFinish: number;
}

export function runGame(
  seed: number,
  playerCount: 2 | 3 | 4,
  bots: ReadonlyArray<BotFn>,
  maxActions = 10_000,
): GameResult {
  let state: GameState = createGame(seed, playerCount);
  let totalActions = 0;
  let totalRounds = 0;
  let prevRound = state.round;
  let dice = diceStream(seed);

  while (!state.gameOver && totalActions < maxActions) {
    const playerId = state.turnOrder[state.activePlayerIndex];
    if (playerId === undefined) break;

    const bot = bots[playerId % bots.length]!;
    let action = bot(state, playerId);
    if (action.type === 'ROLL_DICE') {
      const rolls: number[] = [];
      for (let i = 0; i < state.mineCount; i++) { const [v, n] = nextIntBelow(dice, 6); rolls.push(v + 1); dice = n; }
      action = { type: 'ROLL_DICE', rolls };
    }

    const result = applyAction(state, action);
    if (!result.ok) {
      throw new Error(
        `Bot (player ${playerId}) produced illegal action in phase "${state.phase}": ` +
        `${result.error.code}: ${result.error.message}\n` +
        `Action: ${JSON.stringify(action)}`,
      );
    }

    state = result.state;
    totalActions++;
    if (state.round !== prevRound) { totalRounds++; prevRound = state.round; }

    // Resolve factory activations for ALL owners (a roll activates every player's matching
    // factories, and each owner decides operate/skip). The active-player loop above only
    // drives the active seat, so settle the rest here via each owner's bot.
    while (!state.gameOver && state.pendingFactoryOps.length > 0 && totalActions < maxActions) {
      const entry = state.pendingFactoryOps[0]!;
      const ownerBot = bots[entry.ownerId % bots.length]!;
      const opAction = ownerBot(state, entry.ownerId);
      const opRes = applyAction(state, opAction);
      if (!opRes.ok) {
        throw new Error(
          `Bot (player ${entry.ownerId}) produced illegal pending-op action: ` +
          `${opRes.error.code}: ${opRes.error.message}\nAction: ${JSON.stringify(opAction)}`,
        );
      }
      state = opRes.state;
      totalActions++;
    }
  }

  return {
    winner: state.winner,
    tiedWinners: state.tiedWinners,
    gameOverReason: state.gameOverReason,
    totalActions,
    totalRounds,
    didNotFinish: !state.gameOver,
  };
}

export function runGames(
  startSeed: number,
  count: number,
  playerCount: 2 | 3 | 4,
  bots: ReadonlyArray<BotFn>,
  maxActionsPerGame = 10_000,
): SimStats {
  let totalActions = 0;
  let totalRounds = 0;
  const wins = new Array<number>(playerCount).fill(0);
  let tesseractWins = 0;
  let boardExhaustionWins = 0;
  let tiedGames = 0;
  let didNotFinish = 0;

  for (let i = 0; i < count; i++) {
    const r = runGame(startSeed + i, playerCount, bots, maxActionsPerGame);
    totalActions += r.totalActions;
    totalRounds  += r.totalRounds;

    if (r.didNotFinish) {
      didNotFinish++;
    } else if (r.winner !== null) {
      wins[r.winner] = (wins[r.winner] ?? 0) + 1;
      if (r.gameOverReason === 'tesseracts')    tesseractWins++;
      if (r.gameOverReason === 'boardExhausted') boardExhaustionWins++;
    } else if (r.tiedWinners.length > 0) {
      tiedGames++;
      if (r.gameOverReason === 'boardExhausted') boardExhaustionWins++;
    }
  }

  return {
    gamesPlayed: count,
    totalActions,
    avgActionsPerGame: totalActions / count,
    avgRoundsPerGame: totalRounds / count,
    wins,
    tesseractWins,
    boardExhaustionWins,
    tiedGames,
    didNotFinish,
  };
}
