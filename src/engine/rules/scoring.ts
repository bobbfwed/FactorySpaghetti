// M6: Scoring, bonus-Tesseract computation, victory checks, and tiebreaks.
// All functions are pure: never mutate state.

import type { GameState, Player, PlayerId } from '../state';
import {
  MATERIAL_VALUES,
  BONUS_THRESHOLDS,
  bonusesEnabled,
} from '../config';
import { longestBeltChain } from './beltWeaver';
import { piecesExhausted } from './pieces';
import { buildingOwner } from './ownership';

// ── Per-player resource points ────────────────────────────────────────────────

// Total inventory value for a player (does NOT include bonus Tesseracts).
export function resourcePoints(player: Player): number {
  const inv = player.inventory;
  return (
    inv.ore       * MATERIAL_VALUES.ore +
    inv.plate     * MATERIAL_VALUES.plate +
    inv.sphere    * MATERIAL_VALUES.sphere +
    inv.tesseract * MATERIAL_VALUES.tesseract
  );
}

// Total Tesseracts counting toward victory (inventory + face-up bonuses if enabled).
export function tesseractCount(state: GameState, playerId: PlayerId): number {
  const player = state.players[playerId];
  if (!player) return 0;
  const base = player.inventory.tesseract;
  if (!bonusesEnabled) return base;
  const b = player.bonusTesseracts;
  return base + (b.investor ? 1 : 0) + (b.beltWeaver ? 1 : 0) + (b.factoryEmpire ? 1 : 0);
}

// ── Bonus-Tesseract holder computation ───────────────────────────────────────
// "It moves the instant someone surpasses the holder." On a tie the current
// holder keeps it; if no holder, the lowest-indexed player gets it.

function keepOrLowest(candidates: PlayerId[], currentHolders: PlayerId[]): PlayerId | null {
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0]!;
  for (const h of currentHolders) {
    if (candidates.includes(h)) return h;
  }
  return candidates.slice().sort((a, b) => a - b)[0]!;
}

// The Investor: player with the highest in-play Control Module (≥ threshold).
function findInvestorHolder(state: GameState): PlayerId | null {
  const maxByPlayer = new Map<PlayerId, number>();
  for (const piece of state.board) {
    for (const claim of piece.claims) {
      const cur = maxByPlayer.get(claim.ownerId) ?? 0;
      if (claim.controlModule > cur) maxByPlayer.set(claim.ownerId, claim.controlModule);
    }
  }

  let best = 0;
  for (const v of maxByPlayer.values()) { if (v > best) best = v; }
  if (best < BONUS_THRESHOLDS.investor) return null;

  const candidates = [...maxByPlayer.entries()]
    .filter(([, v]) => v === best)
    .map(([id]) => id);

  const current = state.players
    .filter(p => p.bonusTesseracts.investor)
    .map(p => p.id);

  return keepOrLowest(candidates, current);
}

// Belt Weaver: player with the longest continuous belt chain (≥ threshold), where the
// chain connects ≥2 buildings (or a mine + a building) and may pass through the player's
// own claimed factories. See beltWeaver.longestBeltChain for the traversal.
function findBeltWeaverHolder(state: GameState): PlayerId | null {
  let best = 0;
  let candidates: PlayerId[] = [];

  for (const player of state.players) {
    // A chain can't exceed the belts the player has placed; skip the traversal below the
    // threshold to keep this cheap (recomputeBonuses runs after every action).
    const placed = state.belts.reduce((n, b) => (b.ownerId === player.id ? n + 1 : n), 0);
    const chain = placed >= BONUS_THRESHOLDS.beltWeaver ? longestBeltChain(state, player.id) : 0;
    if (chain > best)              { best = chain; candidates = [player.id]; }
    else if (chain === best && chain > 0) candidates.push(player.id);
  }

  if (best < BONUS_THRESHOLDS.beltWeaver) return null;

  const current = state.players
    .filter(p => p.bonusTesseracts.beltWeaver)
    .map(p => p.id);

  return keepOrLowest(candidates, current);
}

// Factory Empire: player with the most distinct buildings claimed (≥ threshold).
// Multi-claims on one building count as one claimed building (and a building has one owner, #57).
function findFactoryEmpireHolder(state: GameState): PlayerId | null {
  const countByPlayer = new Map<PlayerId, number>();
  for (const piece of state.board) {
    if (piece.type === 'mine' || piece.type === 'blank') continue;
    const owner = buildingOwner(piece);
    if (owner !== null) countByPlayer.set(owner, (countByPlayer.get(owner) ?? 0) + 1);
  }

  let best = 0;
  for (const v of countByPlayer.values()) { if (v > best) best = v; }
  if (best < BONUS_THRESHOLDS.factoryEmpire) return null;

  const candidates = [...countByPlayer.entries()]
    .filter(([, v]) => v === best)
    .map(([id]) => id);

  const current = state.players
    .filter(p => p.bonusTesseracts.factoryEmpire)
    .map(p => p.id);

  return keepOrLowest(candidates, current);
}

// Update every player's bonusTesseracts flags to reflect the current board.
export function recomputeBonuses(state: GameState): GameState {
  if (!bonusesEnabled) return state;

  const investorId      = findInvestorHolder(state);
  const beltWeaverId    = findBeltWeaverHolder(state);
  const factoryEmpireId = findFactoryEmpireHolder(state);

  const newPlayers = state.players.map(p => ({
    ...p,
    bonusTesseracts: {
      investor:      p.id === investorId,
      beltWeaver:    p.id === beltWeaverId,
      factoryEmpire: p.id === factoryEmpireId,
    },
  }));

  return { ...state, players: newPlayers };
}

// ── Tiebreak ladder ───────────────────────────────────────────────────────────
// Used for board-exhaustion endings.
// Criteria (descending priority):
//   1. Most resource points (inventory value)
//   2. Most Tesseracts (incl. face-up bonuses)
//   3. Most Spheres in inventory
//   4. Most Plates in inventory
//   5. Most Ore in inventory
//   6. Earliest position in turnOrder (lower turnOrder index = better)
//   Remaining ties → shared win (tiedWinners has > 1 entry).

function tiebreakWinners(state: GameState): ReadonlyArray<PlayerId> {
  let contenders: PlayerId[] = state.players.map(p => p.id);

  type Criterion = (pid: PlayerId) => number;
  const criteria: Criterion[] = [
    (pid): number => resourcePoints(state.players[pid]!),
    (pid): number => tesseractCount(state, pid),
    (pid): number => state.players[pid]!.inventory.sphere,
    (pid): number => state.players[pid]!.inventory.plate,
    (pid): number => state.players[pid]!.inventory.ore,
    // Negate index so that an earlier position (lower index) scores higher.
    (pid): number => -(state.turnOrder.indexOf(pid)),
  ];

  for (const crit of criteria) {
    if (contenders.length <= 1) break;
    const best = Math.max(...contenders.map(crit));
    contenders = contenders.filter(pid => crit(pid) === best);
  }

  return contenders;
}

// ── Victory check: 4 Tesseracts ───────────────────────────────────────────────

// Check whether the CURRENT active player has won by accumulating 4 Tesseracts.
// Must be called with bonuses already recomputed.
function checkTesseractVictory(state: GameState): GameState {
  const activeId = state.turnOrder[state.activePlayerIndex];
  if (activeId === undefined) return state;
  if (tesseractCount(state, activeId) < 4) return state;

  return {
    ...state,
    gameOver: true,
    gameOverReason: 'tesseracts',
    winner: activeId,
    tiedWinners: [],
  };
}

// ── Victory check: board exhaustion ──────────────────────────────────────────

// Check whether every board piece has been played (all stacks empty, no Mine waiting) and, if
// so, end the game on points + tiebreak. Called only when a round is complete — every player's
// turn and the round-end turns played — so the round in which the pieces ran out is finished
// first, as the rulebook says (RULES_CHANGES.md #44). The turn order of the tiebreak is the one
// the round-end turns just used.
function checkBoardExhaustion(state: GameState): GameState {
  if (!piecesExhausted(state)) return state;

  const winners = tiebreakWinners(state);
  return {
    ...state,
    gameOver: true,
    gameOverReason: 'boardExhausted',
    winner:      winners.length === 1 ? winners[0]! : null,
    tiedWinners: winners.length > 1  ? winners      : [],
  };
}

// ── Public hooks for the reducer ──────────────────────────────────────────────

// Called after every non-END_TURN action.
// Recomputes bonuses then checks if the active player has hit 4 Tesseracts.
export function postActionChecks(state: GameState): GameState {
  if (state.gameOver) return state;
  const s = recomputeBonuses(state);
  return checkTesseractVictory(s);
}

// Called only when a complete round finishes (the last round-end turn ended).
// Recomputes bonuses then checks board-exhaustion end condition.
export function postRoundChecks(state: GameState): GameState {
  if (state.gameOver) return state;
  const s = recomputeBonuses(state);
  return checkBoardExhaustion(s);
}
