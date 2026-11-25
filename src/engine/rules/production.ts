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
  MATERIAL_ORDER,
  POWER_PLANT_INPUTS,
} from '../config';
import { resolveDirectAdjacency, fillInputsFromAdjacentMines } from './flow';
import { factoryProduct, canLoadMaterial } from './recipes';
import { mineSlotReward } from './mineRewards';

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

// One way to fill empty input slots from an inventory so that a valid recipe is complete:
// searches unique material multisets (cheapest first), so the first result is the most
// ore-efficient completion. Returns { newSlots, newInventory } on success, null if none exists.
// The engine no longer uses this: what goes through an input teleporter is the owner's choice
// (OPERATE_BUILDING `supply`, RULES_CHANGES.md #45; the choices are listed by operateSupplies).
// Kept for the bots and the interface, which use it to plan loading a building from inventory.
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

// ── Supplying a building through its input teleporter ────────────────────────

// Why `supply` (materials from the operator's inventory, through the input teleporter) may not
// go into `piece`'s input as `operatorId` runs it, or null when it may (or there is none). The
// supply fills empty input slots only, from whole units the operator holds, through a teleporter
// of the operator's own; it is never taken without being named (RULES_CHANGES.md #45).
function supplyError(piece: BoardPiece, operator: Player, supply: ReadonlyArray<Material>): ActionResult | null {
  if (supply.length === 0) return null;
  if (!piece.input || piece.input.teleporterOwner !== operator.id) {
    return err('NO_INPUT_TELEPORTER', 'Materials can be supplied from your inventory only through your teleporter on the input');
  }
  const empty = piece.input.slots.filter(s => s === null).length;
  if (supply.length !== empty) {
    return err('INVALID_SUPPLY', `Supply exactly one material for each of the ${empty} empty input slot(s)`);
  }
  const need = new Map<Material, number>();
  for (const m of supply) need.set(m, (need.get(m) ?? 0) + 1);
  for (const [m, n] of need) {
    if (!(m in operator.inventory) || operator.inventory[m] < n) {
      return err('INSUFFICIENT_MATERIAL', `You do not hold ${n} ${m}`);
    }
  }
  return null;
}

// The input slots with their empty slots filled, in order, by `supply`.
function withSupply(slots: ReadonlyArray<Material | null>, supply: ReadonlyArray<Material>): Array<Material | null> {
  let i = 0;
  return slots.map(s => (s === null && i < supply.length ? supply[i++]! : s));
}

// `inventory` less the supplied materials.
function lessSupply(inventory: Readonly<Record<Material, number>>, supply: ReadonlyArray<Material>): Record<Material, number> {
  const out = { ...inventory } as Record<Material, number>;
  for (const m of supply) out[m] -= 1;
  return out;
}

// True when an activation of this Power Plant for `ownerId` is a decision rather than an
// automatic run: the owner's own teleporter sits on its input and the input is empty, so they
// choose what (if anything) to supply from their inventory (RULES_CHANGES.md #45).
export function isPowerPlantDecision(piece: BoardPiece, ownerId: PlayerId): boolean {
  return piece.type === 'powerPlant' && piece.input !== null &&
    piece.input.teleporterOwner === ownerId && piece.input.slots.some(s => s === null);
}

// Every supply with which `ownerId` could run `pieceId` right now, as its operator: [] (nothing
// supplied, run from the building's own input) first when that works, then each distinct
// multiset of materials they hold that fills the empty input slots through their input
// teleporter and runs, in the fixed material order. Empty when the building cannot run at all.
// Pure; shared by roll resolution (is an activation a decision?), legalActions and the interface.
export function operateSupplies(state: GameState, pieceId: string, ownerId: PlayerId): Array<Material[]> {
  const piece = state.board.find(p => p.id === pieceId);
  const owner = state.players[ownerId];
  if (!piece || !owner || (!piece.input && piece.type !== 'powerPlant')) return [];
  const out: Array<Material[]> = [];
  const runs = (supply: Material[]): boolean => runBuilding(state, piece, ownerId, supply).ok;
  if (runs([])) out.push([]);
  if (!piece.input || piece.input.teleporterOwner !== ownerId) return out;
  const empty = piece.input.slots.filter(s => s === null).length;
  if (empty === 0) return out;
  const choose = (k: number, from: number, left: Record<Material, number>, chosen: Material[]): void => {
    if (k === 0) { if (runs(chosen)) out.push(chosen); return; }
    for (let i = from; i < MATERIAL_ORDER.length; i++) {
      const m = MATERIAL_ORDER[i]!;
      if ((left[m] ?? 0) <= 0) continue;
      choose(k - 1, i, { ...left, [m]: left[m] - 1 }, [...chosen, m]);
    }
  };
  choose(empty, 0, { ...owner.inventory }, []);
  return out;
}

// Run `piece` for `ownerId` (the operator), with `supply` from their inventory through their
// input teleporter. Power Plants and factories alike; the result says why it cannot run.
function runBuilding(state: GameState, piece: BoardPiece, ownerId: PlayerId, supply: ReadonlyArray<Material>): ActionResult {
  return piece.type === 'powerPlant'
    ? operatePowerPlant(state, piece, ownerId, supply)
    : operateFactory(state, piece, ownerId, supply);
}

// Operate a factory building for `ownerId`, with `supply` (possibly empty) going into its empty
// input slots from their inventory through their input teleporter. Nothing else is taken from
// the inventory: without a supply the factory runs only from what lies in its input.
// Output teleporter (output.teleporterOwner set): the product is diverted directly to that
// player's inventory (capped at INVENTORY_CAP); overflow stays in the output buffer and blocks
// future production normally.
function operateFactory(state: GameState, piece: BoardPiece, ownerId: PlayerId, supply: ReadonlyArray<Material>): ActionResult {
  const { input, output } = piece;
  const cannot = err('CANNOT_OPERATE', 'Building cannot operate: check inputs form a valid recipe, output is empty, and you have enough power');
  if (!input || !output) return cannot;

  const owner = state.players[ownerId];
  if (!owner) return err('INTERNAL', 'Player not found');
  const refused = supplyError(piece, owner, supply);
  if (refused) return refused;

  // Output buffer full → can't produce (teleporter would have cleared it on success)
  if (output.slots.some(slot => slot !== null)) return cannot;

  const effectiveSlots = withSupply(input.slots, supply);
  const preInventory = lessSupply(owner.inventory, supply);

  // All input slots must now be filled (buffer + the supply)
  if (effectiveSlots.some(slot => slot === null)) return cannot;

  const product = factoryProduct(piece.type, effectiveSlots);
  if (!product) {
    return supply.length > 0
      ? err('INVALID_RECIPE', 'Those materials do not complete a recipe of this building')
      : cannot;
  }

  // Power cost is fixed per OUTPUT type: plate=1, sphere=2, tesseract=3.
  const cost = powerCostOf(product);
  if (owner.powerTokens < cost) return cannot;

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
    inventory: preInventory, // less the materials supplied through the input teleporter
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

  return { ok: true, state: { ...state, board: newBoard, players: newPlayers } };
}

// Operate a Power Plant for `ownerId`: no power cost; yields POWER_PLANT_BASE_YIELD tokens, or
// the chart's tokens for the one Ore, Plate or Sphere it burns — the one lying in its input, or
// else the one supplied from the owner's inventory through their input teleporter (never a
// Tesseract). Refused when the owner already holds the Power Token cap.
function operatePowerPlant(state: GameState, piece: BoardPiece, ownerId: PlayerId, supply: ReadonlyArray<Material>): ActionResult {
  const owner = state.players[ownerId];
  if (!owner) return err('INTERNAL', 'Player not found');
  const refused = supplyError(piece, owner, supply);
  if (refused) return refused;
  if (supply.some(m => !POWER_PLANT_INPUTS.includes(m))) {
    return err('INVALID_RECIPE', 'A Power Plant burns only Ore, a Plate or a Sphere');
  }
  if (owner.powerTokens >= POWER_TOKEN_CAP) {
    return err('CANNOT_OPERATE', 'You already hold the most Power Tokens you may');
  }

  // Determine yield and whether to consume input material
  let tokensToAdd: number;
  let newInput = piece.input;

  const inputMat = piece.input?.slots[0] ?? supply[0] ?? null;
  if (inputMat !== null && inputMat !== 'tesseract') {
    // Consume the material for total yield from chart
    tokensToAdd = POWER_PLANT_MATERIAL_YIELD[inputMat as Exclude<Material, 'tesseract'>];
    newInput = { ...piece.input!, slots: [null] };
  } else {
    tokensToAdd = POWER_PLANT_BASE_YIELD;
  }

  const newTokens = Math.min(owner.powerTokens + tokensToAdd, POWER_TOKEN_CAP);

  const newBoard = mapPiece(state.board, piece.id, p => ({ ...p, input: newInput }));
  const newPlayers = mapPlayer(state.players, ownerId, p => ({
    ...p, powerTokens: newTokens, inventory: lessSupply(p.inventory, supply),
  }));

  return { ok: true, state: { ...state, board: newBoard, players: newPlayers } };
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
// Power Plants (any owner) auto-operate — there's no downside to generating tokens — except
// one with the owner's own teleporter on its empty input: then the owner chooses what to supply
// from their inventory (isPowerPlantDecision, RULES_CHANGES.md #45), so it becomes a pending
// decision like a factory (while they are below the Power Token cap).
// FACTORIES of ANY owner are deferred to pendingOps: each factory that COULD operate
// (from its input, or with a supply through the owner's input teleporter, and enough power)
// becomes a pending decision for its owner to OPERATE_BUILDING or SKIP_FACTORY_ROLL. This means
// a roll on anyone's turn never spends your power/materials without your consent
// (RULES_CHANGES.md #25: everyone activates, but the owner always chooses). For multiple
// matching claims on one building, each distinct owner gets a pending entry.
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

      if (currentPiece.type === 'powerPlant' && !isPowerPlantDecision(currentPiece, ownerId)) {
        const next = operatePowerPlant(current, currentPiece, ownerId, []);
        if (next.ok) current = next.state;
        continue;
      }

      // A factory, or a Power Plant whose supply is the owner's choice: defer to the owner's
      // decision if it could actually operate now (from its input or with some supply).
      if (operateSupplies(current, currentPiece.id, ownerId).length > 0) {
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

// Every place `playerId`'s meeple may go this turn: each free point (resource 0, upgrade 1) of
// each Mine, and each building they hold a claim on. Shared by legalActions and END_TURN (the
// meeple must be placed when any of these exists).
export function meepleTargets(state: GameState, playerId: PlayerId): Array<{ pieceId: string; slotIndex?: 0 | 1 }> {
  const out: Array<{ pieceId: string; slotIndex?: 0 | 1 }> = [];
  for (const piece of state.board) {
    if (piece.type === 'mine') {
      for (const slotIndex of [0, 1] as const) {
        const taken = state.players.some(p => p.id !== playerId && p.meepleOnPieceId === piece.id && p.meepleSlotIndex === slotIndex);
        if (!taken) out.push({ pieceId: piece.id, slotIndex });
      }
    } else if (piece.claims.some(c => c.ownerId === playerId)) {
      out.push({ pieceId: piece.id });
    }
  }
  return out;
}

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

  // The meeple goes down once per turn (the move list offers only ending the turn after it).
  if (state.players[activePlayerId]?.meepleOnPieceId != null) {
    return err('MEEPLE_ALREADY_PLACED', 'Your meeple is already placed this turn');
  }

  // Valid targets: a Mine's resource (0) or upgrade (1) point, or a building of the active player
  const isMine = piece.type === 'mine';
  const isOwned = piece.claims.some(c => c.ownerId === activePlayerId);

  if (!isMine && !isOwned) {
    return err('INVALID_MEEPLE_TARGET', 'Meeple may only be placed on your buildings or a mine');
  }
  if (isMine ? (slotIndex !== 0 && slotIndex !== 1) : slotIndex !== undefined) {
    return err('INVALID_MEEPLE_TARGET', isMine
      ? 'On a Mine the meeple goes on its resource point or its upgrade point'
      : 'Only a Mine has meeple points to choose from');
  }

  // Mine slots are exclusive: only one meeple per slot index
  if (isMine) {
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

    if (piece.type === 'mine' && player.meepleSlotIndex !== null) {
      // Resource point: Mine 1 → 2 ore, Mine 2 → 1 plate, Mine 3 → 1 sphere; upgrade point: the
      // credits printed on the Mine, 2 / 3 / 4 (mineRewards.ts).
      const r = mineSlotReward(state, piece.id, player.meepleSlotIndex);
      if (r?.kind === 'material') {
        const inv = player.inventory;
        return { ...player, inventory: { ...inv, [r.material]: Math.min(inv[r.material] + r.amount, INVENTORY_CAP) } };
      }
      if (r?.kind === 'credits') return { ...player, freeActionCredits: player.freeActionCredits + r.amount };
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

  if (player.meepleOnPieceId !== action.pieceId || player.meepleSlotIndex !== null) {
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
    if (player.meepleOnPieceId !== action.pieceId || player.meepleSlotIndex !== null) {
      return err('INVALID_TARGET', 'You can only operate the building your meeple is on');
    }
    if (player.meepleOperatedThisRound) {
      return err('ALREADY_OPERATED', 'You may operate your meeple building only once per round end');
    }
  }

  const piece = state.board.find(p => p.id === action.pieceId);
  if (!piece) return err('PIECE_NOT_FOUND', `No piece with id ${action.pieceId}`);

  // What the operator supplies from their inventory through their input teleporter (nothing is
  // taken unless named here; RULES_CHANGES.md #45).
  const ran = runBuilding(state, piece, operatorId, action.supply ?? []);
  if (!ran.ok) return ran;
  const operated = ran.state;

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

  if (player.meepleOnPieceId !== action.pieceId || player.meepleSlotIndex !== null) {
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

// Why the active player may not end their turn now, or null when they may: only in the
// place-meeple step, and only once the meeple is down (unless it has nowhere to go). Checked
// before the end-of-turn victory check, so a Tesseract win is also declared only from there.
export function endTurnError(state: GameState): { ok: false; error: RulesError } | null {
  if (state.phase !== 'placeMeeple') {
    return err('WRONG_PHASE', `Expected placeMeeple phase, got ${state.phase}`);
  }
  const activeId = state.turnOrder[state.activePlayerIndex];
  const player = activeId === undefined ? undefined : state.players[activeId];
  if (player && player.meepleOnPieceId === null && meepleTargets(state, player.id).length > 0) {
    return err('MEEPLE_REQUIRED', 'Place your meeple before ending your turn');
  }
  return null;
}

export function applyEndTurn(state: GameState): ActionResult {
  const refused = endTurnError(state);
  if (refused) return refused;

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
  // A Power Plant always runs (its tokens are free): its decision is only what to supply. It may
  // be skipped only when it cannot run any more (its owner reached the Power Token cap since).
  const piece = state.board.find(p => p.id === action.pieceId);
  if (piece?.type === 'powerPlant' && operateSupplies(state, piece.id, entry.ownerId).length > 0) {
    return err('MUST_RUN', 'A Power Plant always runs; choose what to supply to it, if anything');
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
