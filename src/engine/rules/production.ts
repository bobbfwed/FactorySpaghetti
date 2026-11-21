// Roll resolution, factory operation, and power-plant operation.
// All functions are pure: return new state, never mutate.

import type { GameState, BoardPiece, Player, PlayerId, Material } from '../state';
import type { RollDiceAction, RulesError, LoadBuildingInputAction, OperateBuildingAction, CollectOutputAction, SkipFactoryRollAction, ExchangeMaterialsAction } from '../actions';
import {
  FACTORY_POWER_COST,
  POWER_PLANT_BASE_YIELD,
  POWER_PLANT_MATERIAL_YIELD,
  POWER_TOKEN_CAP,
  INVENTORY_CAP,
} from '../config';
import { resolveDirectAdjacency, fillInputsFromAdjacentMines } from './flow';
import { factoryProduct, canLoadMaterial } from './recipes';

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

function mapPiece(
  board: ReadonlyArray<BoardPiece>,
  pieceId: string,
  fn: (p: BoardPiece) => BoardPiece,
): ReadonlyArray<BoardPiece> {
  return board.map(p => (p.id === pieceId ? fn(p) : p));
}

// ── Input-teleporter supplement ───────────────────────────────────────────────

// Try to fill empty input slots from the owner's inventory to complete a valid recipe.
// Searches unique material multisets (cheapest first) so the first result is
// the most ore-efficient completion — sufficient for deterministic engine behaviour.
// Returns { newSlots, newInventory } on success, null if no valid completion exists.
// Exported so the smart bot can plan the same load-from-inventory completion the engine
// uses for input teleporters (single source of truth for recipe completion).
export function findInputCompletion(
  type: BoardPiece['type'],
  bufferedSlots: ReadonlyArray<Material | null>,
  inventory: Readonly<Record<Material, number>>,
): { newSlots: (Material | null)[]; newInventory: Record<Material, number> } | null {
  const emptyCount = bufferedSlots.filter(s => s === null).length;
  if (emptyCount === 0) return null; // already full — no supplement needed

  const MATS: readonly Material[] = ['ore', 'plate', 'sphere', 'tesseract'];

  // Depth-first search over unique material multisets of size `emptyCount`.
  // startIdx ensures we never revisit cheaper materials, avoiding duplicates.
  function search(
    k: number,
    startIdx: number,
    curInv: Record<Material, number>,
    chosen: Material[],
  ): { combo: Material[]; inv: Record<Material, number> } | null {
    if (k === 0) {
      const test = [...bufferedSlots] as (Material | null)[];
      let ci = 0;
      for (let i = 0; i < test.length; i++) {
        if (test[i] === null) test[i] = chosen[ci++]!;
      }
      return factoryProduct(type, test) !== null ? { combo: chosen, inv: curInv } : null;
    }
    for (let i = startIdx; i < MATS.length; i++) {
      const m = MATS[i]!;
      if (curInv[m] <= 0) continue;
      const nextInv: Record<Material, number> = { ...curInv, [m]: curInv[m] - 1 };
      const result = search(k - 1, i, nextInv, [...chosen, m]);
      if (result) return result;
    }
    return null;
  }

  const found = search(emptyCount, 0, { ...inventory }, []);
  if (!found) return null;

  const newSlots = [...bufferedSlots] as (Material | null)[];
  let ci = 0;
  for (let i = 0; i < newSlots.length; i++) {
    if (newSlots[i] === null) newSlots[i] = found.combo[ci++]!;
  }
  return { newSlots, newInventory: found.inv };
}

// ── Factory production ────────────────────────────────────────────────────────

// Ore has no power cost; only Plate (1), Sphere (2), Tesseract (3) do.
function powerCostOf(mat: Material): number {
  if (mat === 'ore') return 0;
  return FACTORY_POWER_COST[mat];
}

// Recipe logic (factoryProduct / canLoadMaterial) lives in ./recipes so flow.ts can share
// it without a circular import. Re-exported for existing importers (legalActions, UI).
export { canLoadMaterial };

// Attempt to operate a factory building. Returns updated state or null (silently skip).
// Teleporter rules:
//   Input teleporter (input.teleporterOwner === ownerId): empty input slots may be
//     filled from the owner's inventory at any time (including on an opponent's turn).
//   Output teleporter (output.teleporterOwner set): produced material is diverted
//     directly to that player's inventory (capped at INVENTORY_CAP); overflow stays
//     in the output buffer and blocks future production normally.
function tryOperateFactory(state: GameState, piece: BoardPiece, ownerId: PlayerId): GameState | null {
  const { input, output } = piece;
  if (!input || !output) return null;

  // Output buffer full → can't produce (teleporter would have cleared it on success)
  if (output.slots.some(slot => slot !== null)) return null;

  const owner = state.players[ownerId];
  if (!owner) return null;

  // Attempt to supplement empty input slots from inventory via input teleporter.
  let effectiveSlots: ReadonlyArray<Material | null> = input.slots;
  let preInventory: Readonly<Record<Material, number>> = owner.inventory;

  if (input.teleporterOwner === ownerId && input.slots.some(s => s === null)) {
    const completion = findInputCompletion(piece.type, input.slots, owner.inventory);
    if (completion) {
      effectiveSlots = completion.newSlots;
      preInventory = completion.newInventory;
    }
  }

  // All input slots must now be filled (buffer + any teleporter supplement)
  if (effectiveSlots.some(slot => slot === null)) return null;

  const product = factoryProduct(piece.type, effectiveSlots);
  if (!product) return null;

  // Power cost is fixed per OUTPUT type: plate=1, sphere=2, tesseract=3.
  const cost = powerCostOf(product);
  if (owner.powerTokens < cost) return null;

  // Consume inputs, deduct power, fill output buffer
  const clearedSlots = input.slots.map(() => null as Material | null);
  const filledOutput = output.slots.map((_, i) => (i === 0 ? product : null as Material | null));

  let newBoard = mapPiece(state.board, piece.id, p => ({
    ...p,
    input: { ...input, slots: clearedSlots },
    output: { ...output, slots: filledOutput },
  }));

  let newPlayers = mapPlayer(state.players, ownerId, p => ({
    ...p,
    powerTokens: p.powerTokens - cost,
    inventory: preInventory, // may have had materials deducted by input teleporter
  }));

  // If an output teleporter is present, divert the produced material to that
  // player's inventory immediately (bypasses meeple-access rule).
  const outTeleOwner = output.teleporterOwner;
  if (outTeleOwner !== null) {
    const recipient = newPlayers[outTeleOwner];
    if (recipient && recipient.inventory[product] < INVENTORY_CAP) {
      newPlayers = mapPlayer(newPlayers, outTeleOwner, p => ({
        ...p,
        inventory: { ...p.inventory, [product]: p.inventory[product] + 1 },
      }));
      // Clear the just-filled output buffer — material went to inventory
      newBoard = mapPiece(newBoard, piece.id, p => ({
        ...p,
        output: p.output
          ? { ...p.output, slots: p.output.slots.map(() => null as Material | null) }
          : null,
      }));
    }
    // else: inventory at cap — product stays in output buffer (overflow)
  }

  return { ...state, board: newBoard, players: newPlayers };
}

// Attempt to operate a power plant. Returns updated state or null (silently skip).
function tryOperatePowerPlant(state: GameState, piece: BoardPiece, ownerId: PlayerId): GameState | null {
  const owner = state.players[ownerId];
  if (!owner) return null;
  if (owner.powerTokens >= POWER_TOKEN_CAP) return null; // already capped — skip silently

  // Determine yield and whether to consume input material
  let tokensToAdd: number;
  let newInput = piece.input;

  const inputMat = piece.input?.slots[0] ?? null;
  if (inputMat !== null && inputMat !== 'tesseract') {
    // Consume the material for total yield from chart
    tokensToAdd = POWER_PLANT_MATERIAL_YIELD[inputMat as Exclude<Material, 'tesseract'>];
    newInput = { ...piece.input!, slots: [null] };
  } else {
    tokensToAdd = POWER_PLANT_BASE_YIELD;
  }

  const newTokens = Math.min(owner.powerTokens + tokensToAdd, POWER_TOKEN_CAP);

  const newBoard = mapPiece(state.board, piece.id, p => ({ ...p, input: newInput }));
  const newPlayers = mapPlayer(state.players, ownerId, p => ({ ...p, powerTokens: newTokens }));

  return { ...state, board: newBoard, players: newPlayers };
}

// Check whether a building can currently produce (used by legalActions to filter).
export function factoryCanOperate(piece: BoardPiece, player: Player): boolean {
  if (piece.type === 'powerPlant') {
    return player.powerTokens < POWER_TOKEN_CAP;
  }
  if (!piece.input || !piece.output) return false;
  if (piece.output.slots.some(s => s !== null)) return false; // output buffer full
  if (piece.input.slots.some(s => s === null)) return false;  // input not fully loaded
  const product = factoryProduct(piece.type, piece.input.slots);
  if (!product) return false;
  return player.powerTokens >= powerCostOf(product);
}

// Power cost to operate a factory given its current (fully-loaded) inputs.
// Returns 0 if inputs are incomplete or piece is not a factory.
// Used by the UI to label the operate button with the exact token cost.
export function factoryOperatePowerCost(piece: BoardPiece): number {
  if (!piece.input || piece.input.slots.some(s => s === null)) return 0;
  const product = factoryProduct(piece.type, piece.input.slots);
  if (!product) return 0;
  return powerCostOf(product);
}

// Determine what a factory would produce given its current inputs (null = can't produce).
export function factoryExpectedProduct(piece: BoardPiece): Material | null {
  if (!piece.input || piece.input.slots.some(s => s === null)) return null;
  return factoryProduct(piece.type, piece.input.slots);
}

// ── Roll resolution ───────────────────────────────────────────────────────────

// Resolve production for all buildings that match diceSum.
// Power Plants (any owner) auto-operate — there's no downside to generating tokens.
// FACTORIES of ANY owner are deferred to pendingOps: each factory that COULD operate
// (inputs completable, enough power) becomes a pending decision for its owner to
// OPERATE_BUILDING or SKIP_FACTORY_ROLL. This means a roll on anyone's turn never spends
// your power/materials without your consent (resolves OQ-1: everyone activates, but the
// owner always chooses). For multiple matching claims on one building, each distinct owner
// gets a pending entry.
function resolveProduction(state: GameState, diceSum: number): { state: GameState; pendingOps: Array<{ pieceId: string; ownerId: PlayerId }> } {
  let current = state;
  const pendingOps: Array<{ pieceId: string; ownerId: PlayerId }> = [];

  for (const piece of current.board) {
    if (piece.type === 'mine' || piece.type === 'blank') continue;

    // Every distinct owner with a matching claim on this piece activates.
    const owners = new Set<PlayerId>();
    for (const claim of piece.claims) {
      if (claim.controlModule === diceSum) owners.add(claim.ownerId);
    }
    if (owners.size === 0) continue;

    for (const ownerId of owners) {
      const currentPiece = current.board.find(p => p.id === piece.id);
      if (!currentPiece) continue;

      if (currentPiece.type === 'powerPlant') {
        const next = tryOperatePowerPlant(current, currentPiece, ownerId);
        if (next) current = next;
        continue;
      }

      // Factory: defer to the owner's decision if it could actually operate now.
      // tryOperateFactory (on a probe) accounts for input-teleporter completion and power.
      if (tryOperateFactory(current, currentPiece, ownerId) !== null) {
        pendingOps.push({ pieceId: piece.id, ownerId });
      }
    }
  }

  return { state: current, pendingOps };
}

// ── ROLL_DICE action ──────────────────────────────────────────────────────────

export function applyRollDice(state: GameState, action: RollDiceAction): ActionResult {
  if (state.phase !== 'roll') {
    return err('WRONG_PHASE', `Expected roll phase, got ${state.phase}`);
  }

  const { rolls } = action;

  if (rolls.length !== state.mineCount) {
    return err(
      'WRONG_DICE_COUNT',
      `Expected ${state.mineCount} dice (= mines on board), got ${rolls.length}`,
    );
  }

  if (rolls.some(r => r < 1 || r > 6 || !Number.isInteger(r))) {
    return err('INVALID_ROLL', 'Each die value must be an integer 1–6');
  }

  const diceSum = rolls.reduce((a, b) => a + b, 0);
  const afterFlow1 = resolveDirectAdjacency(state);               // pre-fill inputs from mine
  const { state: afterProd, pendingOps } = resolveProduction(afterFlow1, diceSum);
  const afterFlow2 = resolveDirectAdjacency(afterProd);           // re-fill for display

  return {
    ok: true,
    state: { ...afterFlow2, phase: 'actions', lastRoll: rolls, pendingFactoryOps: pendingOps },
  };
}

// ── END_ACTIONS → placeMeeple (or roundEnd advance) ──────────────────────────

export function applyEndActions(state: GameState): ActionResult {
  if (state.phase !== 'actions' && state.phase !== 'roundEnd') {
    return err('WRONG_PHASE', `Expected actions or roundEnd phase, got ${state.phase}`);
  }

  if (state.phase === 'actions') {
    if (state.overstockPieces.length > 0) {
      return err('OVERSTOCK_PENDING', 'Place all Overstock Supplies pieces before ending actions');
    }
    // Every factory activation must be resolved (operated or skipped, by its owner) first.
    if (state.pendingFactoryOps.length > 0) {
      return err('PENDING_FACTORY_OPS', 'Resolve all factory activations (operate or skip) before ending actions');
    }
    // Resolve material flow now that the player has finalised their belt layout.
    const afterFlow = resolveDirectAdjacency(state);
    return { ok: true, state: { ...afterFlow, phase: 'placeMeeple', beltsPlacedThisTurn: [], pendingFactoryOps: [] } };
  }

  // roundEnd phase: advance to next player or finalize into next round.
  // The player has finished their round-end turn (operated / collected / loaded as they
  // chose). Resolve material flow now so any output they left uncollected moves into a
  // connected building's input immediately — the board reflects it before the next round
  // rather than waiting for the first roll. (Belts can't be placed in roundEnd, so there's
  // no layout to keep deferring for; the roll still resolves flow again, so this is purely
  // an earlier, equivalent move.)
  const flowed = resolveDirectAdjacency(state);

  const isLastRoundEndPlayer = flowed.activePlayerIndex === flowed.turnOrder.length - 1;
  if (isLastRoundEndPlayer) {
    const newPlayers = flowed.players.map(p => ({
      ...p,
      freeUpgradesRemaining: 0,
      freeUpgradePieceId: null as string | null,
      freeActionCredits: 0,
      freeClaimUsed: false,
      meepleOnPieceId: null as string | null,
      meepleSlotIndex: null as number | null,
      meepleOperatedThisRound: false,
    }));
    return {
      ok: true,
      state: { ...flowed, players: newPlayers, activePlayerIndex: 0, phase: 'placePiece', drawnStackIndex: null },
    };
  }
  return {
    ok: true,
    state: { ...flowed, activePlayerIndex: flowed.activePlayerIndex + 1 },
  };
}

// ── PLACE_MEEPLE ──────────────────────────────────────────────────────────────

export function applyPlaceMeeple(
  state: GameState,
  pieceId: string,
  slotIndex?: number,
): ActionResult {
  if (state.phase !== 'placeMeeple') {
    return err('WRONG_PHASE', `Expected placeMeeple phase, got ${state.phase}`);
  }

  const activePlayerId = state.turnOrder[state.activePlayerIndex];
  if (activePlayerId === undefined) {
    return err('INTERNAL', 'No active player');
  }

  const piece = state.board.find(p => p.id === pieceId);
  if (!piece) {
    return err('PIECE_NOT_FOUND', `No board piece with id ${pieceId}`);
  }

  // Valid targets: mines, or buildings owned by the active player
  const isMine = piece.type === 'mine';
  const isOwned = piece.claims.some(c => c.ownerId === activePlayerId);

  if (!isMine && !isOwned) {
    return err('INVALID_MEEPLE_TARGET', 'Meeple may only be placed on your buildings or a mine');
  }

  // Mine slots are exclusive: only one meeple per slot index
  if (isMine && slotIndex !== undefined) {
    const slotTaken = state.players.some(
      p => p.id !== activePlayerId &&
           p.meepleOnPieceId === pieceId &&
           p.meepleSlotIndex === slotIndex,
    );
    if (slotTaken) {
      return err('MINE_SLOT_OCCUPIED', `Mine slot ${slotIndex} is already occupied by another player`);
    }
  }

  const newPlayers = mapPlayer(state.players, activePlayerId, p => ({
    ...p,
    meepleOnPieceId: pieceId,
    meepleSlotIndex: slotIndex ?? null,
  }));

  return { ok: true, state: { ...state, players: newPlayers, phase: 'placeMeeple' } };
}

// ── Meeple benefit collection (called at round end) ───────────────────────────

function collectMeepleBenefits(state: GameState): GameState {
  const newPlayers = state.players.map(player => {
    if (player.meepleOnPieceId === null) return player;
    const piece = state.board.find(p => p.id === player.meepleOnPieceId);
    if (!piece) return player;

    if (piece.type === 'mine' && player.meepleSlotIndex === 0) {
      // 1st mine → 2 ore; 2nd mine → 1 plate; 3rd mine → 1 sphere.
      const mines = state.board.filter(p => p.type === 'mine');
      const mineIdx = mines.findIndex(m => m.id === piece.id);
      if (mineIdx === 0) {
        return { ...player, inventory: { ...player.inventory, ore: Math.min(player.inventory.ore + 2, INVENTORY_CAP) } };
      } else if (mineIdx === 1) {
        return { ...player, inventory: { ...player.inventory, plate: Math.min(player.inventory.plate + 1, INVENTORY_CAP) } };
      } else {
        return { ...player, inventory: { ...player.inventory, sphere: Math.min(player.inventory.sphere + 1, INVENTORY_CAP) } };
      }
    }

    if (piece.type === 'mine' && player.meepleSlotIndex === 1) {
      return { ...player, freeActionCredits: player.freeActionCredits + state.mineCount + 1 };
    }

    // Building output is NOT auto-collected. With a meeple on the building, the
    // player optionally collects it via COLLECT_OUTPUT during their roundEnd turn;
    // otherwise it stays in the output buffer (or flows to a connected input).
    return player;
  });

  return { ...state, players: newPlayers };
}

// ── LOAD_BUILDING_INPUT ───────────────────────────────────────────────────────

// Move one unit of material from the active player's inventory into the first
// empty input slot of the building their meeple is on. Only valid in roundEnd.
export function applyLoadBuildingInput(
  state: GameState,
  action: LoadBuildingInputAction,
): ActionResult {
  if (state.phase !== 'roundEnd') {
    return err('WRONG_PHASE', `Expected roundEnd phase, got ${state.phase}`);
  }

  const activeId = state.turnOrder[state.activePlayerIndex];
  if (activeId === undefined) return err('INTERNAL', 'No active player');

  const player = state.players[activeId];
  if (!player) return err('INTERNAL', 'Player not found');

  if (player.meepleOnPieceId !== action.pieceId) {
    return err('INVALID_TARGET', 'You can only load input into the building your meeple is on');
  }

  const piece = state.board.find(p => p.id === action.pieceId);
  if (!piece) return err('PIECE_NOT_FOUND', `No piece with id ${action.pieceId}`);
  if (!piece.input) return err('NO_INPUT', 'This building has no input buffer');

  const emptySlotIdx = piece.input.slots.findIndex(s => s === null);
  if (emptySlotIdx < 0) return err('INPUT_FULL', 'All input slots are already filled');

  if (player.inventory[action.material] <= 0) {
    return err('INSUFFICIENT_MATERIAL', `You have no ${action.material} in inventory`);
  }

  // Only allow loads that keep a valid recipe reachable (shared recipe table).
  if (!canLoadMaterial(piece.type, piece.input.slots, action.material)) {
    return err(
      'INVALID_RECIPE',
      `Loading ${action.material} here cannot form a valid recipe for this ${piece.type}`,
    );
  }

  const newSlots = [...piece.input.slots] as Array<Material | null>;
  newSlots[emptySlotIdx] = action.material;

  const newBoard = state.board.map(p =>
    p.id === piece.id
      ? { ...p, input: { ...piece.input!, slots: newSlots } }
      : p,
  );

  const newPlayers = mapPlayer(state.players, activeId, p => ({
    ...p,
    inventory: { ...p.inventory, [action.material]: p.inventory[action.material] - 1 },
  }));

  return { ok: true, state: { ...state, board: newBoard, players: newPlayers } };
}

// ── OPERATE_BUILDING ──────────────────────────────────────────────────────────

// Operate the building the active player's meeple is on: consume inputs, produce output,
// then immediately collect the output to the player's inventory.
// Valid in roundEnd (meeple-based), or in actions phase when the piece is in pendingFactoryOps.
export function applyOperateBuilding(
  state: GameState,
  action: OperateBuildingAction,
): ActionResult {
  if (state.phase !== 'roundEnd' && state.phase !== 'actions') {
    return err('WRONG_PHASE', `Expected roundEnd or actions phase, got ${state.phase}`);
  }

  const activeId = state.turnOrder[state.activePlayerIndex];
  if (activeId === undefined) return err('INTERNAL', 'No active player');

  // The player who OPERATES: in actions phase it's the factory's owner (from the pending
  // entry — may be a non-active player); in roundEnd it's the active player (their meeple).
  let operatorId: PlayerId;

  if (state.phase === 'actions') {
    const entry = state.pendingFactoryOps.find(
      e => e.pieceId === action.pieceId && (action.ownerId === undefined || e.ownerId === action.ownerId),
    );
    if (!entry) return err('NOT_PENDING', 'This factory did not match the roll this turn');
    operatorId = entry.ownerId;
  } else {
    operatorId = activeId;
    const player = state.players[activeId];
    if (!player) return err('INTERNAL', 'Player not found');
    if (player.meepleOnPieceId !== action.pieceId) {
      return err('INVALID_TARGET', 'You can only operate the building your meeple is on');
    }
    if (player.meepleOperatedThisRound) {
      return err('ALREADY_OPERATED', 'You may operate your meeple building only once per round end');
    }
  }

  const piece = state.board.find(p => p.id === action.pieceId);
  if (!piece) return err('PIECE_NOT_FOUND', `No piece with id ${action.pieceId}`);

  let operated: GameState | null;
  if (piece.type === 'powerPlant') {
    operated = tryOperatePowerPlant(state, piece, operatorId);
  } else {
    operated = tryOperateFactory(state, piece, operatorId);
  }

  if (!operated) {
    return err(
      'CANNOT_OPERATE',
      'Building cannot operate: check inputs form a valid recipe, output is empty, and you have enough power',
    );
  }

  // Remove the resolved factory (by owner) from pendingFactoryOps in the actions phase.
  const newPending = state.phase === 'actions'
    ? state.pendingFactoryOps.filter(e => !(e.pieceId === action.pieceId && e.ownerId === operatorId))
    : state.pendingFactoryOps;

  // In roundEnd the meeple building may be operated at most ONCE — flag it so
  // legalActions stops offering OPERATE_BUILDING for it this round.
  const markOperated = (s: GameState): GameState =>
    state.phase === 'roundEnd'
      ? { ...s, players: mapPlayer(s.players, operatorId, p => ({ ...p, meepleOperatedThisRound: true })) }
      : s;

  // Mine ore is unlimited and instant: refill the just-consumed input from any
  // directly-adjacent mine so the building is immediately ready/visible again.
  const finalize = (s: GameState): GameState =>
    fillInputsFromAdjacentMines(markOperated({ ...s, pendingFactoryOps: newPending }));

  // The product STAYS in the output buffer (placed there by tryOperateFactory). It is
  // not auto-collected — the owner must have a meeple on the building and COLLECT_OUTPUT,
  // or it flows to a connected building's input, or an output teleporter already diverted
  // it. (Power plants deliver power tokens directly and have no output buffer.)
  return { ok: true, state: finalize(operated) };
}

// ── COLLECT_OUTPUT ────────────────────────────────────────────────────────────

// Move material from a building's output buffer into the active player's inventory.
// Meeple-gated: only the building the player's meeple sits on, only in roundEnd, and
// only the output buffer (never input). Respects the per-material inventory cap;
// uncollectable material (cap reached) stays in the buffer.
export function applyCollectOutput(state: GameState, action: CollectOutputAction): ActionResult {
  if (state.phase !== 'roundEnd') {
    return err('WRONG_PHASE', `Expected roundEnd phase, got ${state.phase}`);
  }

  const activeId = state.turnOrder[state.activePlayerIndex];
  if (activeId === undefined) return err('INTERNAL', 'No active player');

  const player = state.players[activeId];
  if (!player) return err('INTERNAL', 'Player not found');

  if (player.meepleOnPieceId !== action.pieceId) {
    return err('INVALID_TARGET', 'You can only collect output from the building your meeple is on');
  }

  const piece = state.board.find(p => p.id === action.pieceId);
  if (!piece) return err('PIECE_NOT_FOUND', `No piece with id ${action.pieceId}`);
  if (!piece.output) return err('NO_OUTPUT', 'This building has no output buffer');

  const newInventory: Record<Material, number> = { ...player.inventory };
  const newSlots = [...piece.output.slots] as Array<Material | null>;
  let collected = 0;

  for (let i = 0; i < newSlots.length; i++) {
    const mat = newSlots[i];
    if (mat != null && newInventory[mat] < INVENTORY_CAP) {
      newInventory[mat] += 1;
      newSlots[i] = null;
      collected += 1;
    }
  }

  if (collected === 0) {
    return err('NOTHING_TO_COLLECT', 'Output buffer is empty, or your inventory is full for that material');
  }

  const newBoard = state.board.map(p =>
    p.id === piece.id ? { ...p, output: { ...piece.output!, slots: newSlots } } : p,
  );
  const newPlayers = mapPlayer(state.players, activeId, p => ({ ...p, inventory: newInventory }));

  return { ok: true, state: { ...state, board: newBoard, players: newPlayers } };
}

// ── END_TURN ──────────────────────────────────────────────────────────────────

// The order for the round-end turns and the next round: the first player moves to the end.
function rotateTurnOrder(order: ReadonlyArray<PlayerId>): PlayerId[] {
  return order.length === 0 ? [] : [...order.slice(1), order[0]!];
}

// The player order the end-of-round turns and the next round will use. The rotation happens
// as the round's last turn ends (applyEndTurn), so during the roundEnd phase this is the
// current turnOrder; in every other phase it is turnOrder with the first player moved to
// the end. For the interface, which must not re-implement the rotation.
export function upcomingTurnOrder(state: GameState): PlayerId[] {
  return state.phase === 'roundEnd' ? [...state.turnOrder] : rotateTurnOrder(state.turnOrder);
}

export function applyEndTurn(state: GameState): ActionResult {
  if (state.phase !== 'placeMeeple') {
    return err('WRONG_PHASE', `Expected placeMeeple phase, got ${state.phase}`);
  }

  const isLastPlayerOfRound = state.activePlayerIndex === state.turnOrder.length - 1;

  if (!isLastPlayerOfRound) {
    // Advance to next player; reset per-turn flags
    return {
      ok: true,
      state: {
        ...state,
        activePlayerIndex: state.activePlayerIndex + 1,
        phase: 'placePiece',
        drawnStackIndex: null,
        lastRoll: null,
        mineBeltPlacedThisTurn: false,
        beltsPlacedThisTurn: [],
        pendingFactoryOps: [],
        cardsPlayedThisTurn: 0,
        overstockPieces: [],
        productionIncreaseBudget: 0,
        productionIncreaseClaimedThisTurn: false,
      },
    };
  }

  // Round end: collect meeple benefits, then enter roundEnd phase for free upgrades
  const afterBenefits = collectMeepleBenefits(state);

  // Keep meepleOnPieceId/meepleSlotIndex alive into roundEnd so each player can
  // manually load inputs and operate their factory during their roundEnd turn.
  // Meeples are cleared when the last player's END_ACTIONS transitions to placePiece.
  const newPlayers = afterBenefits.players.map(p => ({
    ...p,
    freeUpgradesRemaining: afterBenefits.mineCount,
    freeUpgradePieceId: null as string | null,
    meepleOperatedThisRound: false,
    // freeActionCredits and freeClaimUsed carried over from collectMeepleBenefits (slot 1 grants)
  }));

  // Rotate turn order: first player moves to end
  const newTurnOrder = rotateTurnOrder(state.turnOrder);

  // Mine ore is instant/unlimited: top up every directly-connected input so each
  // player's roundEnd meeple building shows its ore before they choose to operate.
  const roundEndState = fillInputsFromAdjacentMines({
    ...afterBenefits,
    players: newPlayers,
  });

  return {
    ok: true,
    state: {
      ...roundEndState,
      turnOrder: newTurnOrder,
      activePlayerIndex: 0,
      round: state.round + 1,
      phase: 'roundEnd',
      lastRoll: null,
      mineBeltPlacedThisTurn: false,
      beltsPlacedThisTurn: [],
      pendingFactoryOps: [],
      cardsPlayedThisTurn: 0,
      overstockPieces: [],
      productionIncreaseBudget: 0,
      productionIncreaseClaimedThisTurn: false,
    },
  };
}

// ── SKIP_FACTORY_ROLL ─────────────────────────────────────────────────────────

// Remove a factory from pendingFactoryOps without operating it (by its owner).
export function applySkipFactoryRoll(state: GameState, action: SkipFactoryRollAction): ActionResult {
  if (state.phase !== 'actions') {
    return err('WRONG_PHASE', `Expected actions phase, got ${state.phase}`);
  }
  const entry = state.pendingFactoryOps.find(
    e => e.pieceId === action.pieceId && (action.ownerId === undefined || e.ownerId === action.ownerId),
  );
  if (!entry) {
    return err('NOT_PENDING', `${action.pieceId} is not in pendingFactoryOps`);
  }
  return {
    ok: true,
    state: {
      ...state,
      pendingFactoryOps: state.pendingFactoryOps.filter(
        e => !(e.pieceId === action.pieceId && e.ownerId === entry.ownerId),
      ),
    },
  };
}

// ── EXCHANGE_MATERIALS ────────────────────────────────────────────────────────

// Break down rates: 1 of the given material yields lower-tier materials.
const EXCHANGE_DOWN: Partial<Record<Material, Partial<Record<Material, number>>>> = {
  plate:     { ore: 3 },
  sphere:    { plate: 2, ore: 1 },
  tesseract: { sphere: 3, ore: 2 },
};

export function applyExchangeMaterials(state: GameState, action: ExchangeMaterialsAction): ActionResult {
  if (state.phase !== 'actions' && state.phase !== 'roundEnd') {
    return err('WRONG_PHASE', `Expected actions or roundEnd, got ${state.phase}`);
  }
  if (action.give === 'ore') {
    return err('CANNOT_EXCHANGE', 'Ore cannot be broken down further');
  }
  const activeId = state.turnOrder[state.activePlayerIndex];
  if (activeId === undefined) return err('INTERNAL', 'No active player');
  const player = state.players[activeId];
  if (!player) return err('INTERNAL', 'Player not found');
  if (player.inventory[action.give] <= 0) {
    return err('INSUFFICIENT_MATERIAL', `You have no ${action.give} to exchange`);
  }
  const received = EXCHANGE_DOWN[action.give] ?? {};
  const newInv: Record<Material, number> = { ...player.inventory, [action.give]: player.inventory[action.give] - 1 };
  for (const [mat, count] of Object.entries(received) as Array<[Material, number]>) {
    newInv[mat] = Math.min((newInv[mat] ?? 0) + count, INVENTORY_CAP);
  }
  const newPlayers = mapPlayer(state.players, activeId, p => ({ ...p, inventory: newInv }));
  return { ok: true, state: { ...state, players: newPlayers } };
}
