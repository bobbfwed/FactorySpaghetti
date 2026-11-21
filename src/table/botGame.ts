// A seeded bot-vs-bot game, stepped one action at a time (same loop as src/sim/runGames.ts).
// Dice come from a seeded generator instead of the bots' Math.random, so a (seed, player count,
// bot kind) triple always plays the same game. Used by the dev harness and by the layout tests.

import { createGame } from '../engine/rules/setup';
import { applyAction, legalActions } from '../engine/reducer';
import type { GameState, PlayerId } from '../engine/state';
import type { Action } from '../engine/actions';
import { nextIntBelow, createRng, type RngState } from '../engine/rng';
import { chooseAction as greedyBot } from '../bots/greedyBot';

export type BotKind = 'greedy' | 'random';

export interface BotGame {
  readonly state: GameState;
  /** Apply one action (a pending factory decision first, else the active player's move). False when over. */
  step(): boolean;
  readonly actions: number;
}

export function createBotGame(seed: number, playerCount: 2 | 3 | 4, kind: BotKind = 'greedy'): BotGame {
  let state = createGame(seed, playerCount);
  let rng: RngState = createRng(seed ^ 0x5eed);
  let actions = 0;

  const roll = (n: number): number[] => {
    const out: number[] = [];
    for (let i = 0; i < n; i++) {
      const [v, next] = nextIntBelow(rng, 6);
      rng = next;
      out.push(v + 1);
    }
    return out;
  };

  const choose = (s: GameState, id: PlayerId): Action => {
    if (s.phase === 'roll' && s.pendingFactoryOps.length === 0) return { type: 'ROLL_DICE', rolls: roll(s.mineCount) };
    if (kind === 'greedy') return greedyBot(s, id);
    const legal = legalActions(s, id);
    if (legal.length === 0) throw new Error(`no legal actions for player ${id} in ${s.phase}`);
    const [i, next] = nextIntBelow(rng, legal.length);
    rng = next;
    return legal[i]!;
  };

  return {
    get state(): GameState { return state; },
    get actions(): number { return actions; },
    step(): boolean {
      if (state.gameOver) return false;
      const pending = state.pendingFactoryOps[0];
      const id = pending ? pending.ownerId : state.turnOrder[state.activePlayerIndex];
      if (id === undefined) return false;
      const action = choose(state, id);
      const res = applyAction(state, action);
      if (!res.ok) throw new Error(`illegal bot action ${JSON.stringify(action)}: ${res.error.code} ${res.error.message}`);
      state = res.state;
      actions++;
      return !state.gameOver;
    },
  };
}

/** Play until `until(state)` is true, the game ends, or `maxActions` is reached. */
export function playUntil(game: BotGame, until: (s: GameState) => boolean, maxActions = 20000): GameState {
  while (!until(game.state) && game.actions < maxActions && game.step()) { /* keep going */ }
  return game.state;
}
