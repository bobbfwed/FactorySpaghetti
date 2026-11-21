// M4: Claim/upgrade buildings and buy/place mines.
// All functions are pure: return new state, never mutate.

import type {
  GameState,
  BoardPiece,
  Player,
  PlayerId,
  PieceStack,
  Buffer,
} from '../state';
import type {
  ClaimBuildingAction,
  UpgradeBuildingAction,
  BuyMineAction,
  PlaceMineAction,
  RulesError,
} from '../actions';
import { MINE_COSTS } from '../config';
import { tryPayFlexible } from './flow';
import { hexEqual, isCoordsOccupied, isAdjacentToBoard, mineSecondaryCoord } from './pieces';

export type ActionResult =
  | { ok: true; state: GameState }
  | { ok: false; error: RulesError };

// ── Helpers ───────────────────────────────────────────────────────────────────

function err(code: string, message: string): { ok: false; error: RulesError } {
  return { ok: false, error: { code, message } };
}

function mapPlayer(
  players: ReadonlyArray<Player>,
  id: PlayerId,
  fn: (p: Player) => Player,
): ReadonlyArray<Player> {
  return players.map((p, i) => (i === id ? fn(p) : p));
}

// Unlock the appropriate stack when mineCount just became newMineCount.
function unlockStack(
  stacks: readonly [PieceStack, PieceStack, PieceStack],
  newMineCount: number,
): readonly [PieceStack, PieceStack, PieceStack] {
  if (newMineCount === 2) return [stacks[0], { ...stacks[1], available: true }, stacks[2]];
  if (newMineCount === 3) return [stacks[0], stacks[1], { ...stacks[2], available: true }];
  return stacks;
}

// Build a placed mine BoardPiece with a 1-slot output buffer.
function makeMineOnBoard(id: string, coord: BoardPiece['coord'], rotation: number): BoardPiece {
  const output: Buffer = { slots: [null], teleporterOwner: null };
  return { id, type: 'mine', coord, rotation, claims: [], input: null, output };
}

// ── CLAIM_BUILDING ────────────────────────────────────────────────────────────

export function applyClaimBuilding(
  state: GameState,
  action: ClaimBuildingAction,
): ActionResult {
  const { fromProductionIncrease = false, fromFreeClaim = false } = action;

  if (fromFreeClaim) {
    if (state.phase !== 'roundEnd') {
      return err('WRONG_PHASE', 'Free claim only usable in roundEnd phase');
    }
  } else if (state.phase !== 'actions') {
    return err('WRONG_PHASE', `Expected actions phase, got ${state.phase}`);
  }

  const activeId = state.turnOrder[state.activePlayerIndex];
  if (activeId === undefined) return err('INTERNAL', 'No active player');

  const player = state.players[activeId];
  if (!player) return err('INTERNAL', 'Player not found');

  if (fromFreeClaim) {
    if (player.freeClaimUsed) {
      return err('FREE_CLAIM_USED', 'The free claim from mine slot 1 has already been used this round');
    }
    const claimCost = action.controlModule - state.mineCount + 1;
    if (player.freeActionCredits < claimCost) {
      return err('INSUFFICIENT_CREDITS', `Claiming module ${action.controlModule} costs ${claimCost} mine credits; only ${player.freeActionCredits} available`);
    }
  }

  const piece = state.board.find(p => p.id === action.pieceId);
  if (!piece) return err('PIECE_NOT_FOUND', `No board piece with id ${action.pieceId}`);

  if (piece.type === 'blank' || piece.type === 'mine') {
    return err('NOT_CLAIMABLE', 'Only factory buildings and power plants can be claimed');
  }

  const { controlModule } = action;

  // Claim floor: module value must be ≥ mineCount
  if (controlModule < state.mineCount) {
    return err(
      'CLAIM_FLOOR_VIOLATION',
      `Module ${controlModule} is below the claim floor (${state.mineCount} mines on board)`,
    );
  }

  // Production Increase claim: at most 1 claim, and placing module M costs
  // (M − mineCount + 1) upgrade-units from the Production Increase budget. No materials.
  const piClaimCost = controlModule - state.mineCount + 1;
  if (fromProductionIncrease) {
    if (state.productionIncreaseClaimedThisTurn) {
      return err('PI_CLAIM_USED', 'Production Increase allows at most 1 claim per turn');
    }
    if (state.productionIncreaseBudget < piClaimCost) {
      return err(
        'INSUFFICIENT_PI_BUDGET',
        `Claiming module ${controlModule} costs ${piClaimCost} Production Increase upgrade(s); only ${state.productionIncreaseBudget} remaining`,
      );
    }
  }

  // Module must be available in the player's hand
  if (!player.controlModules.includes(controlModule)) {
    return err('MODULE_NOT_AVAILABLE', `Module ${controlModule} is not in your hand`);
  }

  // Only one player may own a building
  if (piece.claims.length > 0 && piece.claims[0]!.ownerId !== activeId) {
    return err('ALREADY_CLAIMED', 'This building is already claimed by another player');
  }

  // At most 3 claims per player per building
  const myClaimsOnPiece = piece.claims.filter(c => c.ownerId === activeId);
  if (myClaimsOnPiece.length >= 3) {
    return err('TOO_MANY_CLAIMS', 'You already have 3 claims on this building');
  }

  // Claiming costs no ore — the Control Module itself is the resource spent.
  const newInv = player.inventory;

  const newBoard = state.board.map(p =>
    p.id === piece.id
      ? { ...p, claims: [...p.claims, { ownerId: activeId, controlModule }] }
      : p,
  );

  const newPlayers = mapPlayer(state.players, activeId, p => ({
    ...p,
    inventory: newInv,
    controlModules: p.controlModules.filter(m => m !== controlModule),
    freeActionCredits: fromFreeClaim
      ? p.freeActionCredits - (controlModule - state.mineCount + 1)
      : p.freeActionCredits,
    freeClaimUsed: fromFreeClaim ? true : p.freeClaimUsed,
  }));

  const newState: GameState = {
    ...state,
    board: newBoard,
    players: newPlayers,
    productionIncreaseBudget: fromProductionIncrease
      ? state.productionIncreaseBudget - piClaimCost
      : state.productionIncreaseBudget,
    productionIncreaseClaimedThisTurn: fromProductionIncrease
      ? true
      : state.productionIncreaseClaimedThisTurn,
  };
  return { ok: true, state: newState };
}

// ── UPGRADE_BUILDING ──────────────────────────────────────────────────────────

export function applyUpgradeBuilding(
  state: GameState,
  action: UpgradeBuildingAction,
): ActionResult {
  if (state.phase !== 'actions' && state.phase !== 'roundEnd') {
    return err('WRONG_PHASE', `Expected actions or roundEnd phase, got ${state.phase}`);
  }

  const activeId = state.turnOrder[state.activePlayerIndex];
  if (activeId === undefined) return err('INTERNAL', 'No active player');

  const player = state.players[activeId];
  if (!player) return err('INTERNAL', 'Player not found');

  const piece = state.board.find(p => p.id === action.pieceId);
  if (!piece) return err('PIECE_NOT_FOUND', `No board piece with id ${action.pieceId}`);

  if (piece.type === 'blank' || piece.type === 'mine') {
    return err('NOT_CLAIMABLE', 'Only factory buildings and power plants have upgradable claims');
  }

  const { oldModule, newModule, freeCredits = 0, fromProductionIncrease = false, fromMineCredit = false } = action;

  // Player must have an existing claim with oldModule on this piece
  const claimIdx = piece.claims.findIndex(
    c => c.ownerId === activeId && c.controlModule === oldModule,
  );
  if (claimIdx === -1) {
    return err('CLAIM_NOT_FOUND', `You don't have module ${oldModule} on this building`);
  }

  if (newModule <= oldModule) {
    return err('MUST_UPGRADE', 'New module must be higher than the current one');
  }

  // New module must also be ≥ claim floor
  if (newModule < state.mineCount) {
    return err(
      'CLAIM_FLOOR_VIOLATION',
      `Module ${newModule} is below the claim floor (${state.mineCount})`,
    );
  }

  // Player must have the new module available in hand
  if (!player.controlModules.includes(newModule)) {
    return err('MODULE_NOT_AVAILABLE', `Module ${newModule} is not in your hand`);
  }

  const diff = newModule - oldModule;

  // Upgrades are NEVER paid with materials — they cost upgrade-units, funded by exactly one
  // source: mine-slot credits, the Production Increase budget, or round-end free upgrades.
  if (fromMineCredit) {
    if (player.freeActionCredits < diff) {
      return err('INSUFFICIENT_CREDITS', `Upgrading ${oldModule}→${newModule} costs ${diff} mine credits; only ${player.freeActionCredits} available`);
    }
  } else if (fromProductionIncrease) {
    if (state.productionIncreaseBudget < diff) {
      return err('INSUFFICIENT_PI_BUDGET', `Upgrading ${oldModule}→${newModule} costs ${diff} Production Increase upgrade(s); only ${state.productionIncreaseBudget} remaining`);
    }
  } else {
    // Round-end free upgrades (= #mines). Must be fully covered — there is no material cost.
    if (freeCredits !== diff) {
      return err('UNFUNDED_UPGRADE', `Upgrading ${oldModule}→${newModule} costs ${diff} upgrade credit(s); materials cannot pay for upgrades`);
    }
    if (freeCredits > player.freeUpgradesRemaining) {
      return err('INSUFFICIENT_FREE_UPGRADES', `You only have ${player.freeUpgradesRemaining} free upgrade credit(s)`);
    }
    if (
      player.freeUpgradePieceId !== null &&
      player.freeUpgradePieceId !== action.pieceId
    ) {
      return err('WRONG_FREE_UPGRADE_TARGET', 'Your free upgrade credits are already locked to a different building this round');
    }
  }

  // Swap the module on the piece
  const newClaims = piece.claims.map((c, i) =>
    i === claimIdx ? { ...c, controlModule: newModule } : c,
  );
  const newBoard = state.board.map(p =>
    p.id === piece.id ? { ...p, claims: newClaims } : p,
  );

  // Return old module to hand, remove new module from hand
  const newModules = [...player.controlModules.filter(m => m !== newModule), oldModule];
  const usesFreeUpgrades = !fromMineCredit && !fromProductionIncrease;

  const newPlayers = mapPlayer(state.players, activeId, p => ({
    ...p,
    controlModules: newModules,
    freeUpgradesRemaining: usesFreeUpgrades ? p.freeUpgradesRemaining - freeCredits : p.freeUpgradesRemaining,
    freeUpgradePieceId: usesFreeUpgrades ? action.pieceId : p.freeUpgradePieceId,
    freeActionCredits: fromMineCredit ? p.freeActionCredits - diff : p.freeActionCredits,
    stats: { ...p.stats, modulesUpgraded: p.stats.modulesUpgraded + 1 },
  }));

  return {
    ok: true,
    state: {
      ...state,
      board: newBoard,
      players: newPlayers,
      productionIncreaseBudget: fromProductionIncrease
        ? state.productionIncreaseBudget - diff
        : state.productionIncreaseBudget,
    },
  };
}

// ── BUY_MINE ──────────────────────────────────────────────────────────────────

export function applyBuyMine(state: GameState, action: BuyMineAction): ActionResult {
  if (state.phase !== 'actions') {
    return err('WRONG_PHASE', `Expected actions phase, got ${state.phase}`);
  }

  const activeId = state.turnOrder[state.activePlayerIndex];
  if (activeId === undefined) return err('INTERNAL', 'No active player');

  const player = state.players[activeId];
  if (!player) return err('INTERNAL', 'Player not found');

  if (state.unplacedMines.length === 0) {
    return err('NO_MINES_AVAILABLE', 'All mines are already in play');
  }

  // Can't buy a mine while one is still pending placement
  if (state.pendingMineIds.length > 0) {
    return err('PENDING_MINE_UNPLACED', 'Place the pending auto-dropped mine before buying another');
  }

  // Cost index: 0 = buying 2nd mine, 1 = buying 3rd mine
  const costIdx = 2 - state.unplacedMines.length;
  const cost = MINE_COSTS[costIdx];
  if (cost === undefined) return err('INTERNAL', 'Invalid mine cost index');

  const newInv = tryPayFlexible(player.inventory, cost);
  if (!newInv) {
    return err('CANNOT_AFFORD', `Buying this mine costs ${cost} value unit(s)`);
  }

  const { coord, rotation = 0 } = action;
  const secondary = mineSecondaryCoord(coord, rotation);

  if (isCoordsOccupied(coord, state.board)) {
    return err('COORD_OCCUPIED', `${coord.q},${coord.r} is already occupied`);
  }
  if (isCoordsOccupied(secondary, state.board)) {
    return err('COORD_OCCUPIED', `secondary mine hex ${secondary.q},${secondary.r} is already occupied`);
  }
  if (!isAdjacentToBoard(coord, state.board) && !isAdjacentToBoard(secondary, state.board)) {
    return err('NOT_ADJACENT', 'mine is not adjacent to any board piece');
  }

  const mineToPlace = state.unplacedMines[0]!;
  const newMineCount = state.mineCount + 1;
  const newMine = makeMineOnBoard(mineToPlace.id, coord, rotation);

  return {
    ok: true,
    state: {
      ...state,
      board: [...state.board, newMine],
      unplacedMines: state.unplacedMines.slice(1),
      mineCount: newMineCount,
      stacks: unlockStack(state.stacks, newMineCount),
      players: mapPlayer(state.players, activeId, p => ({ ...p, inventory: newInv })),
    },
  };
}

// ── PLACE_MINE ────────────────────────────────────────────────────────────────

export function applyPlaceMine(state: GameState, action: PlaceMineAction): ActionResult {
  // Auto-dropped mines are placed at the START of the next player's turn,
  // replacing the normal PLACE_PIECE step. Transitions to 'roll' exactly like PLACE_PIECE.
  if (state.phase !== 'placePiece') {
    return err('WRONG_PHASE', `Expected placePiece phase, got ${state.phase}`);
  }

  if (state.pendingMineIds.length === 0) {
    return err('NO_PENDING_MINE', 'No mine is waiting to be placed');
  }

  const { coord, rotation = 0 } = action;
  const secondary = mineSecondaryCoord(coord, rotation);

  if (isCoordsOccupied(coord, state.board)) {
    return err('COORD_OCCUPIED', `${coord.q},${coord.r} is already occupied`);
  }
  if (isCoordsOccupied(secondary, state.board)) {
    return err('COORD_OCCUPIED', `secondary mine hex ${secondary.q},${secondary.r} is already occupied`);
  }
  if (!isAdjacentToBoard(coord, state.board) && !isAdjacentToBoard(secondary, state.board)) {
    return err('NOT_ADJACENT', 'mine is not adjacent to any board piece');
  }

  const mineId = state.pendingMineIds[0]!;
  const newMineCount = state.mineCount + 1;
  const newMine = makeMineOnBoard(mineId, coord, rotation);

  return {
    ok: true,
    state: {
      ...state,
      board: [...state.board, newMine],
      pendingMineIds: state.pendingMineIds.slice(1),
      mineCount: newMineCount,
      // Stack was already unlocked at auto-drop time; unlockStack is idempotent
      stacks: unlockStack(state.stacks, newMineCount),
      phase: 'roll',
    },
  };
}
