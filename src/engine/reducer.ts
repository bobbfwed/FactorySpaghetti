import type { GameState, PlayerId } from './state';
import { TESSERACTS_TO_WIN } from './config';
import type { Action, RulesError, SkipFactoryRollAction, ExchangeMaterialsAction } from './actions';
import { applySetupClaim } from './rules/setupClaim';
import { applyPlacePiece } from './rules/pieces';
import {
  applyRollDice,
  applyEndActions,
  applyPlaceMeeple,
  applyEndTurn,
  applyLoadBuildingInput,
  applyOperateBuilding,
  applyCollectOutput,
  applySkipFactoryRoll,
  applyExchangeMaterials,
} from './rules/production';
import { applyPlaceBelt, applyRemoveBelt, applyUndoBelts, applyPlaceTeleporter, applyBuyBelt } from './rules/flow';
import {
  applyClaimBuilding,
  applyUpgradeBuilding,
  applyBuyMine,
  applyPlaceMine,
} from './rules/buildings';
import { applyBuyCard, applyPlayCard, applyPlaceOverstockPiece } from './rules/cards';
import {
  recomputeBonuses,
  tesseractCount,
  postActionChecks,
  postRoundChecks,
} from './rules/scoring';
import { legalActions as computeLegalActions } from './rules/legalActions';

export type ApplyResult =
  | { ok: true; state: GameState }
  | { ok: false; error: RulesError };

// Raw dispatch — no victory checks.
function dispatch(state: GameState, action: Action): ApplyResult {
  switch (action.type) {
    case 'SETUP_CLAIM':           return applySetupClaim(state, action);
    case 'PLACE_PIECE':           return applyPlacePiece(state, action);
    case 'ROLL_DICE':             return applyRollDice(state, action);
    case 'END_ACTIONS':           return applyEndActions(state);
    case 'PLACE_MEEPLE':         return applyPlaceMeeple(state, action.pieceId, action.slotIndex);
    case 'END_TURN':             return applyEndTurn(state);
    case 'PLACE_BELT':           return applyPlaceBelt(state, action);
    case 'REMOVE_BELT':          return applyRemoveBelt(state, action);
    case 'UNDO_BELTS':           return applyUndoBelts(state);
    case 'PLACE_TELEPORTER':     return applyPlaceTeleporter(state, action);
    case 'CLAIM_BUILDING':       return applyClaimBuilding(state, action);
    case 'UPGRADE_BUILDING':     return applyUpgradeBuilding(state, action);
    case 'BUY_MINE':             return applyBuyMine(state, action);
    case 'PLACE_MINE':           return applyPlaceMine(state, action);
    case 'BUY_CARD':             return applyBuyCard(state, action);
    case 'PLAY_CARD':            return applyPlayCard(state, action);
    case 'PLACE_OVERSTOCK_PIECE': return applyPlaceOverstockPiece(state, action);
    case 'BUY_BELT':             return applyBuyBelt(state);
    case 'LOAD_BUILDING_INPUT':  return applyLoadBuildingInput(state, action);
    case 'OPERATE_BUILDING':     return applyOperateBuilding(state, action);
    case 'COLLECT_OUTPUT':       return applyCollectOutput(state, action);
    case 'SKIP_FACTORY_ROLL':    return applySkipFactoryRoll(state, action as SkipFactoryRollAction);
    case 'EXCHANGE_MATERIALS':   return applyExchangeMaterials(state, action as ExchangeMaterialsAction);
  }
}

export function applyAction(state: GameState, action: Action): ApplyResult {
  if (state.gameOver) {
    return { ok: false, error: { code: 'GAME_OVER', message: 'The game is already over' } };
  }

  // END_TURN is special: Tesseract victory is checked for the player ENDING their turn,
  // before the turn pointer advances to the next player.
  if (action.type === 'END_TURN') {
    const withBonuses = recomputeBonuses(state);
    const activeId = withBonuses.turnOrder[withBonuses.activePlayerIndex];

    if (activeId !== undefined && tesseractCount(withBonuses, activeId) >= TESSERACTS_TO_WIN) {
      return {
        ok: true,
        state: {
          ...withBonuses,
          gameOver: true,
          gameOverReason: 'tesseracts',
          winner: activeId,
          tiedWinners: [],
        },
      };
    }

    const result = applyEndTurn(withBonuses);
    if (!result.ok) return result;

    // Check exhaustion after every END_TURN: if the board filled up mid-round
    // (last piece placed by a non-last player), the game must end immediately
    // so subsequent players aren't left with no pieces to place.
    return { ok: true, state: postRoundChecks(result.state) };
  }

  const result = dispatch(state, action);
  if (!result.ok) return result;

  // Skip victory/bonus checks during setup phases — no Tesseracts possible yet.
  if (result.state.phase === 'setupClaimPF' || result.state.phase === 'setupClaimPP') {
    return result;
  }

  // After any other action, recompute bonuses and check if active player just hit 4 Tesseracts.
  return { ok: true, state: postActionChecks(result.state) };
}

// Returns every legal action for the given player in the current state.
// Powers both the UI (grey-out illegal moves) and the bots.
export function legalActions(state: GameState, playerId: PlayerId): Action[] {
  return computeLegalActions(state, playerId);
}
