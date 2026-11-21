// Shared test helpers.
//
// createGame() starts in the interactive S7 setup (claim a Plate Factory, then a
// Power Plant, per player) before the normal turn loop is reachable. These helpers
// drive setup to completion and derive legal coordinates dynamically, so tests stay
// robust to changes in the starting-board layout.

import { createGame } from '../rules/setup';
import { applyAction, legalActions, type ApplyResult } from '../reducer';
import { hexNeighbours, isCoordsOccupied, mineSecondaryCoord } from '../rules/pieces';
import type { GameState, HexCoord, PlayerId } from '../state';
import type { Action } from '../actions';

// Unwrap an ApplyResult, throwing a descriptive error on failure.
export function expectOk(r: ApplyResult): GameState {
  if (!r.ok) throw new Error(`unexpected action failure: ${r.error.code} — ${r.error.message}`);
  return r.state;
}

// The active player's id in the current state.
export function activePlayer(state: GameState): PlayerId {
  const id = state.turnOrder[state.activePlayerIndex];
  if (id === undefined) throw new Error('no active player');
  return id;
}

// First legal action of the given type for the active player (throws if none).
export function firstLegal<T extends Action['type']>(
  state: GameState,
  type: T,
): Extract<Action, { type: T }> {
  const found = legalActions(state, activePlayer(state)).find(a => a.type === type);
  if (!found) throw new Error(`no legal ${type} for the active player`);
  return found as Extract<Action, { type: T }>;
}

// Drive the S7 interactive setup (claim PF then PP for every player) → placePiece phase.
export function completeSetup(seed = 1, playerCount: 2 | 3 | 4 = 2): GameState {
  let s = createGame(seed, playerCount);
  for (let guard = 0; s.phase === 'setupClaimPF' || s.phase === 'setupClaimPP'; guard++) {
    if (guard > 64) throw new Error('setup did not converge');
    s = expectOk(applyAction(s, firstLegal(s, 'SETUP_CLAIM')));
  }
  return s;
}

// A free hex adjacent to the current board (where a single-hex piece could be placed).
export function freeAdjacentCoord(state: GameState): HexCoord {
  for (const piece of state.board) {
    const origins: HexCoord[] = [piece.coord];
    if (piece.type === 'mine') origins.push(mineSecondaryCoord(piece.coord, piece.rotation ?? 0));
    for (const o of origins) {
      for (const n of hexNeighbours(o)) {
        if (!isCoordsOccupied(n, state.board)) return n;
      }
    }
  }
  throw new Error('no free adjacent coord');
}

// Complete setup, place the first legal piece, then roll all-1s → actions phase.
// Roll value 1 never matches a setup claim (modules 2/3), so no factory ops pend.
export function reachActionsPhase(seed = 1, playerCount: 2 | 3 | 4 = 2): GameState {
  let s = completeSetup(seed, playerCount);
  s = expectOk(applyAction(s, firstLegal(s, 'PLACE_PIECE')));
  const rolls = Array.from({ length: s.mineCount }, () => 1);
  s = expectOk(applyAction(s, { type: 'ROLL_DICE', rolls }));
  return s;
}
