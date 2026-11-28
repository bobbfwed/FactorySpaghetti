import type { GameState, PlayerId } from './state';
import { TESSERACTS_TO_WIN } from './config';
import type { Action, RulesError, SkipFactoryRollAction, ExchangeMaterialsAction } from './actions';
import { applySetupClaim } from './rules/setupClaim';
import { applyDrawPiece, applyPlacePiece, skipEmptyPlacePiece } from './rules/pieces';
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
  endTurnError,
} from './rules/production';
import {
  applyPlaceBelt, applyRemoveBelt, applyUndoBelts, applyPlaceTeleporter, applyBuyBelt,
} from './rules/flow';
import { settleLostClaims } from './rules/ownership';
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
    case 'DRAW_PIECE':            return applyDrawPiece(state, action);
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

// While the active player has an operate-or-skip decision of their own pending (a factory of
// theirs that the roll activated), they must make it before anything else: every other move
// is refused. Answering any owner's own pending entry stays allowed (RULES_CHANGES.md #40).
function decisionPending(state: GameState, action: Action): ApplyResult | null {
  if (action.type === 'OPERATE_BUILDING' || action.type === 'SKIP_FACTORY_ROLL') return null;
  const activeId = state.turnOrder[state.activePlayerIndex];
  if (activeId === undefined || !state.pendingFactoryOps.some(e => e.ownerId === activeId)) return null;
  return {
    ok: false,
    error: { code: 'DECISION_PENDING', message: 'Run or skip your activated factory before doing anything else' },
  };
}

export function applyAction(incoming: GameState, action: Action): ApplyResult {
  if (incoming.gameOver) {
    return { ok: false, error: { code: 'GAME_OVER', message: 'The game is already over' } };
  }
  // Whatever state the engine is given (an older save, a hand-made one), a building without an
  // owner is settled before the move is judged: its material goes to the bank, its Teleporters
  // back to their placers, and a decision about a building its player does not own is dropped
  // (#58). The same object comes back when nothing needs settling (every state the engine makes);
  // legalActions judges the same settled state, so the two agree.
  const state = settleLostClaims(incoming);
  const pending = decisionPending(state, action);
  if (pending) return pending;

  // END_TURN is special: Tesseract victory is checked for the player ENDING their turn,
  // before the turn pointer advances to the next player.
  if (action.type === 'END_TURN') {
    const refused = endTurnError(state);
    if (refused) return refused;
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

    // The board running out no longer ends the game here: the round is finished first (the
    // check runs when the round-end turns are over, below). A next player with nothing to draw
    // goes straight to the roll (RULES_CHANGES.md #44).
    return { ok: true, state: skipEmptyPlacePiece(recomputeBonuses(settleLostClaims(result.state))) };
  }

  const result = dispatch(state, action);
  if (!result.ok) return result;

  // Skip victory/bonus checks during setup phases — no Tesseracts possible yet.
  if (result.state.phase === 'setupClaimPF' || result.state.phase === 'setupClaimPP') {
    return result;
  }

  // A building that lost its owner is settled: its Teleporters go back to their placers and its
  // material to the bank (after any action, so every claim-removing effect is covered; #37, #58).
  // Then recompute bonuses and check if the active player just hit 4 Tesseracts.
  const after = postActionChecks(settleLostClaims(result.state));
  // The last round-end turn ends the round: if every board piece has been played, the game ends
  // now, on points (postRoundChecks; RULES_CHANGES.md #44).
  const roundOver = state.phase === 'roundEnd' && after.phase === 'placePiece';
  return { ok: true, state: skipEmptyPlacePiece(roundOver ? postRoundChecks(after) : after) };
}

// Returns every legal action for the given player in the current state.
// Powers both the UI (grey-out illegal moves) and the bots.
export function legalActions(state: GameState, playerId: PlayerId): Action[] {
  return computeLegalActions(state, playerId);
}
