import type { GameState, PlayerId } from '../engine/state';
import type { Action } from '../engine/actions';

// A bot is a pure function: given the current game state and whose turn it is,
// return the next action. For the roll phase, the function generates dice values.
export type BotFn = (state: GameState, playerId: PlayerId) => Action;
