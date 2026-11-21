// Uniform-random bot: picks uniformly among legal actions.
// For the roll phase, generates dice via Math.random() (values recorded in action log).
// Used as the fuzzer — any crash while running this bot indicates an engine bug.

import type { GameState, PlayerId } from '../engine/state';
import type { Action } from '../engine/actions';
import type { BotFn } from './botInterface';
import { legalActions } from '../engine/reducer';

export const chooseAction: BotFn = (state: GameState, playerId: PlayerId): Action => {
  if (state.phase === 'roll') {
    const rolls = Array.from(
      { length: state.mineCount },
      () => Math.floor(Math.random() * 6) + 1,
    );
    return { type: 'ROLL_DICE', rolls };
  }

  const actions = legalActions(state, playerId);
  if (actions.length === 0) {
    throw new Error(
      `randomBot: no legal actions for player ${playerId} in phase "${state.phase}"`,
    );
  }
  return actions[Math.floor(Math.random() * actions.length)]!;
};
