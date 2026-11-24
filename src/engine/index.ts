// Public engine API. Consumers (client, bots, server) import only from here.

export { createGame } from './rules/setup';
export { applyAction, legalActions } from './reducer';
export { revealedStack } from './rules/pieces';
export { upcomingTurnOrder } from './rules/production';
export { canonicalAction, sameMove } from './actions';
export { beltDirections, type BeltDirection } from './rules/beltDirection';

export type {
  GameState,
  Player,
  BoardPiece,
  UnplacedPiece,
  Buffer,
  PieceStack,
  HexCoord,
  TurnPhase,
  PlayerId,
  Material,
  PieceType,
  CardType,
  RngState,
} from './state';

export type { Action, RulesError } from './actions';
