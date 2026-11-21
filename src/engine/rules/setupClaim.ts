// Interactive setup S7: each player picks their starting Plate Factory then Power Plant.
// Phase 'setupClaimPF' → round-robin forward; 'setupClaimPP' → reverse round-robin.

import type { GameState, TurnPhase } from '../state';
import type { SetupClaimAction, RulesError } from '../actions';

export type ActionResult =
  | { ok: true; state: GameState }
  | { ok: false; error: RulesError };

function err(code: string, message: string): ActionResult {
  return { ok: false, error: { code, message } };
}

export function applySetupClaim(state: GameState, action: SetupClaimAction): ActionResult {
  const { phase } = state;
  if (phase !== 'setupClaimPF' && phase !== 'setupClaimPP') {
    return err('WRONG_PHASE', `Expected setupClaimPF or setupClaimPP, got ${phase}`);
  }

  const activePlayerId = state.turnOrder[state.activePlayerIndex];
  if (activePlayerId === undefined) return err('INTERNAL', 'No active player');

  const piece = state.board.find(p => p.id === action.pieceId);
  if (!piece) return err('PIECE_NOT_FOUND', `No piece with id ${action.pieceId}`);

  const expectedType = phase === 'setupClaimPF' ? 'plateFact' : 'powerPlant';
  if (piece.type !== expectedType) {
    return err('WRONG_PIECE_TYPE', `Expected ${expectedType}, got ${piece.type}`);
  }
  if (piece.claims.length > 0) {
    return err('ALREADY_CLAIMED', 'That piece is already claimed');
  }

  const controlModule = phase === 'setupClaimPF' ? 3 : 2;
  const player = state.players[activePlayerId];
  if (!player) return err('INTERNAL', 'Player not found');

  const moduleIdx = player.controlModules.indexOf(controlModule);
  if (moduleIdx === -1) {
    return err('MODULE_NOT_AVAILABLE', `Module ${controlModule} not in player's tray`);
  }

  const newBoard = state.board.map(p =>
    p.id === action.pieceId
      ? { ...p, claims: [{ ownerId: activePlayerId, controlModule }] }
      : p,
  );

  const newModules = [...player.controlModules];
  newModules.splice(moduleIdx, 1);
  const newPlayers = state.players.map((p, i) =>
    i === activePlayerId ? { ...p, controlModules: newModules } : p,
  );

  // Advance turn pointer or change phase.
  let nextPhase: TurnPhase;
  let nextIndex: number;

  if (phase === 'setupClaimPF') {
    if (state.activePlayerIndex + 1 < state.turnOrder.length) {
      nextPhase = 'setupClaimPF';
      nextIndex = state.activePlayerIndex + 1;
    } else {
      nextPhase = 'setupClaimPP';
      nextIndex = state.turnOrder.length - 1; // reverse pass starts at last player
    }
  } else {
    // setupClaimPP goes backward
    if (state.activePlayerIndex - 1 >= 0) {
      nextPhase = 'setupClaimPP';
      nextIndex = state.activePlayerIndex - 1;
    } else {
      nextPhase = 'placePiece';
      nextIndex = 0;
    }
  }

  return {
    ok: true,
    state: {
      ...state,
      board: newBoard,
      players: newPlayers,
      phase: nextPhase,
      activePlayerIndex: nextIndex,
    },
  };
}
