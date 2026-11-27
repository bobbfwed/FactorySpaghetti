// Public engine API. Consumers (client, bots, server) import only from here.

export { createGame } from './rules/setup';
export { applyAction, legalActions } from './reducer';
export { revealedStack, piecesExhausted, OWN_TURN_STEPS } from './rules/pieces';
export { upcomingTurnOrder, operateSupplies, isPowerPlantDecision } from './rules/production';
export { cardsLeftToDraw, nextCardDrawn } from './rules/cards';
export { canonicalAction, sameMove } from './actions';
export { beltDirections, type BeltDirection } from './rules/beltDirection';
export {
  mineSlotReward, cappedAmount, MINE_RESOURCE_REWARDS, MINE_UPGRADE_REWARDS, type MineSlotReward,
} from './rules/mineRewards';
export { listedForm, isListedMove } from './rules/legalActions';
export { payMaterials, canAfford, isReservedPoint } from './rules/flow';
export { moduleBelowFloor } from './rules/modules';

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
