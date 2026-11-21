// Enumerates every legal action for the active player in the current state.
// Returns [] only when the game is over or it is not this player's turn.
// Note: ROLL_DICE is NOT returned here — dice values are caller-supplied;
// bots and the sim generate them externally and pass them as ROLL_DICE actions.

import type { GameState, PlayerId, HexCoord } from '../state';
import type { Action, OperateBuildingAction } from '../actions';
import type { CardType } from '../config';
import { MINE_COSTS, cardCost, PIECE_TEMPLATES, BELT_COST, MATERIAL_VALUES, INVENTORY_CAP, MAX_CARDS_PLAYED_PER_TURN, MAX_CLAIMS_PER_BUILDING, teleporterCost } from '../config';
import type { Material } from '../config';
import { tryPayExact, beltEndpointFacesMine, beltEndpointBlocked } from './flow';
import { applyOperateBuilding, canLoadMaterial } from './production';
import {
  hexNeighbours,
  isCoordsOccupied,
  mineSecondaryCoord,
} from './pieces';

const ROTATIONS = [0, 1, 2, 3, 4, 5] as const;

// ── Public ────────────────────────────────────────────────────────────────────

export function legalActions(state: GameState, playerId: PlayerId): Action[] {
  if (state.gameOver) return [];

  // Pending factory activations block everything else until resolved. ANY owner — including
  // a non-active player whose factory matched someone else's roll — may resolve THEIR own
  // entries (operate or skip). This is how "everyone activates on any roll, but the owner
  // always chooses" works turn-agnostically. The active player is likewise blocked on their
  // own pending entries before doing anything else.
  const myPending = state.pendingFactoryOps.filter(e => e.ownerId === playerId);
  if (myPending.length > 0) {
    const acts: Action[] = [];
    for (const e of myPending) {
      // Operating is offered only while the engine would accept it: an entry can go stale
      // (e.g. a co-owner already operated the same building, so its output buffer is full).
      // Skipping is always accepted for a pending entry.
      const operate: OperateBuildingAction = { type: 'OPERATE_BUILDING', pieceId: e.pieceId, ownerId: playerId };
      if (canOperate(state, operate)) acts.push(operate);
      acts.push({ type: 'SKIP_FACTORY_ROLL', pieceId: e.pieceId, ownerId: playerId });
    }
    return acts;
  }

  if (state.turnOrder[state.activePlayerIndex] !== playerId) return [];

  switch (state.phase) {
    case 'setupClaimPF': return computeSetupClaim(state, 'plateFact');
    case 'setupClaimPP': return computeSetupClaim(state, 'powerPlant');
    case 'placePiece':   return computePlacePiece(state);
    case 'roll':         return []; // dice values are caller-supplied
    case 'actions':      return computeActions(state, playerId);
    case 'placeMeeple':  return computePlaceMeeple(state, playerId);
    case 'roundEnd':     return computeRoundEnd(state, playerId);
  }
}

// Probe the engine's own OPERATE_BUILDING check, so the list can never disagree with it
// (output buffer, recipe, power, input-teleporter completion, once-per-round-end meeple use).
function canOperate(state: GameState, action: OperateBuildingAction): boolean {
  return applyOperateBuilding(state, action).ok;
}

// ── Hex helpers ───────────────────────────────────────────────────────────────

// Every (cell, rotation) a single-hex tile may be put down at: any free cell adjacent to the
// board, any of the six rotations. Shared by PLACE_PIECE, PLACE_OVERSTOCK_PIECE and the
// Scouting Drone, which the engine all validate the same way (free + adjacent).
function tilePlacements(state: GameState): Array<{ coord: HexCoord; rotation: number }> {
  const out: Array<{ coord: HexCoord; rotation: number }> = [];
  for (const coord of adjacentFreeCoords(state)) {
    for (const rotation of ROTATIONS) out.push({ coord, rotation });
  }
  return out;
}

// All unoccupied hexes adjacent to any currently occupied board coord.
function adjacentFreeCoords(state: GameState): HexCoord[] {
  const board = state.board;
  const seen = new Map<string, HexCoord>();

  const addNeighbours = (origin: HexCoord) => {
    for (const n of hexNeighbours(origin)) {
      const key = `${n.q},${n.r}`;
      if (!seen.has(key) && !isCoordsOccupied(n, board)) seen.set(key, n);
    }
  };

  for (const piece of board) {
    addNeighbours(piece.coord);
    if (piece.type === 'mine') {
      addNeighbours(mineSecondaryCoord(piece.coord, piece.rotation ?? 0));
    }
  }
  return [...seen.values()];
}

// ── setup claim phases ────────────────────────────────────────────────────────

function computeSetupClaim(state: GameState, type: 'plateFact' | 'powerPlant'): Action[] {
  return state.board
    .filter(p => p.type === type && p.claims.length === 0)
    .map(p => ({ type: 'SETUP_CLAIM' as const, pieceId: p.id }));
}

// ── placePiece phase ──────────────────────────────────────────────────────────

function computePlacePiece(state: GameState): Action[] {
  if (state.pendingMineIds.length > 0) return computePlaceMineActions(state);

  const actions: Action[] = [];
  const placements = tilePlacements(state);

  for (let si = 0; si <= 2; si++) {
    const stack = state.stacks[si as 0 | 1 | 2];
    if (!stack.available || stack.pieces.length === 0) continue;
    for (const { coord, rotation } of placements) {
      actions.push({ type: 'PLACE_PIECE', stackIndex: si as 0 | 1 | 2, coord, rotation });
    }
  }
  return actions;
}

function computePlaceMineActions(state: GameState): Action[] {
  const actions: Action[] = [];
  const board = state.board;
  for (const coord of adjacentFreeCoords(state)) {
    for (const r of ROTATIONS) {
      const secondary = mineSecondaryCoord(coord, r);
      if (!isCoordsOccupied(secondary, board)) {
        actions.push({ type: 'PLACE_MINE', coord, rotation: r });
      }
    }
  }
  return actions;
}

// ── actions phase ─────────────────────────────────────────────────────────────

function computeActions(state: GameState, playerId: PlayerId): Action[] {
  const actions: Action[] = [];
  const player = state.players[playerId];
  if (!player) return actions;

  // END_ACTIONS is available only when overstock pieces are placed AND every factory
  // activation (any owner's) has been resolved. (Own pending is handled at the top of
  // legalActions; here we also wait on other players' still-unresolved activations.)
  if (state.overstockPieces.length === 0 && state.pendingFactoryOps.length === 0) {
    actions.push({ type: 'END_ACTIONS' });
  } else if (state.overstockPieces.length > 0) {
    addOverstockPlacements(state, actions);
  }

  if (state.cardsPlayedThisTurn < MAX_CARDS_PLAYED_PER_TURN) addCardPlays(state, playerId, actions);

  addBuyCard(state, playerId, actions);
  addBuyBelt(state, playerId, actions);

  // Production Increase budget: claim/upgrade during the actions phase, funded only by the
  // budget (never materials). Claiming during actions is ONLY via this card (≤1 claim/turn).
  if (state.productionIncreaseBudget > 0) {
    if (!state.productionIncreaseClaimedThisTurn) {
      addClaimBuilding(state, playerId, actions, true);
    }
    addUpgradeBuilding(state, playerId, actions, true);
  }

  addBuyMine(state, playerId, actions);
  addPlaceBelt(state, playerId, actions);
  addRemoveBelt(state, playerId, actions);
  if (state.beltsPlacedThisTurn.length > 0) {
    actions.push({ type: 'UNDO_BELTS' });
  }
  addPlaceTeleporter(state, playerId, actions);

  // (Pending factory activations are resolved via the top-level branch in legalActions,
  // by each factory's owner — handled before we reach here.)

  // Exchange materials: break down any higher-tier material into lower-tier
  addExchangeMaterials(state, playerId, actions);

  return actions;
}

// ── actions phase helpers ─────────────────────────────────────────────────────

function addOverstockPlacements(state: GameState, out: Action[]) {
  for (const { coord, rotation } of tilePlacements(state)) {
    out.push({ type: 'PLACE_OVERSTOCK_PIECE', coord, rotation });
  }
}

function addBuyCard(state: GameState, playerId: PlayerId, out: Action[]) {
  if (state.cardDeck.length === 0) return;
  const player = state.players[playerId];
  if (!player) return;
  const cost = cardCost(state.mineCount);
  const totalValue = (Object.keys(player.inventory) as Material[])
    .reduce((s, m) => s + player.inventory[m] * MATERIAL_VALUES[m], 0);
  if (totalValue >= cost) {
    out.push({ type: 'BUY_CARD' });
  }
}

function addCardPlays(state: GameState, playerId: PlayerId, out: Action[]) {
  const player = state.players[playerId];
  if (!player) return;
  const uniqueCards = [...new Set(player.hand)];
  for (const card of uniqueCards) addCardPlay(state, playerId, card, out);
}

function addCardPlay(state: GameState, playerId: PlayerId, card: CardType, out: Action[]) {
  switch (card) {
    case 'embezzlement':
    case 'netSurplusSellOff':
    case 'productionIncrease':
    case 'personalJetPack':
    case 'assetForfeiture':
      out.push({ type: 'PLAY_CARD', cardType: card });
      break;

    case 'shortSale': {
      const player = state.players[playerId];
      if (!player) break;
      const hasValidModule = player.controlModules.some(m => m >= state.mineCount);
      if (!hasValidModule) break;
      for (const piece of state.board) {
        if (piece.type === 'blank' || piece.type === 'mine') continue;
        if (piece.claims.filter(c => c.ownerId === playerId).length >= MAX_CLAIMS_PER_BUILDING) continue;
        out.push({ type: 'PLAY_CARD', cardType: 'shortSale', pieceId: piece.id });
      }
      break;
    }

    case 'sinkHole':
      for (const piece of state.board) {
        if (piece.type === 'mine') continue;
        if (piece.claims.length > 0) continue;
        out.push({ type: 'PLAY_CARD', cardType: 'sinkHole', pieceId: piece.id });
      }
      break;

    case 'changingPriorities': {
      for (const fromPiece of state.board) {
        if (fromPiece.type === 'mine' || fromPiece.type === 'blank') continue;
        const myClaims = fromPiece.claims.filter(c => c.ownerId === playerId);
        for (const claim of myClaims) {
          if (claim.controlModule < state.mineCount) continue;
          for (const toPiece of state.board) {
            if (toPiece.type === 'mine' || toPiece.type === 'blank') continue;
            if (toPiece.id === fromPiece.id) continue;
            if (toPiece.claims.filter(c => c.ownerId === playerId).length >= MAX_CLAIMS_PER_BUILDING) continue;
            out.push({
              type: 'PLAY_CARD', cardType: 'changingPriorities',
              pieceId: fromPiece.id, toPieceId: toPiece.id, controlModule: claim.controlModule,
            });
          }
        }
      }
      break;
    }

    case 'rdTaxWriteOff': {
      const player = state.players[playerId];
      if (!player || player.teleportersRemaining <= 0) break;
      for (const piece of state.board) {
        if (!piece.claims.some(c => c.ownerId === playerId)) continue;
        if (piece.input?.teleporterOwner === null) {
          out.push({ type: 'PLAY_CARD', cardType: 'rdTaxWriteOff', pieceId: piece.id, bufferType: 'input' });
        }
        if (piece.output?.teleporterOwner === null) {
          out.push({ type: 'PLAY_CARD', cardType: 'rdTaxWriteOff', pieceId: piece.id, bufferType: 'output' });
        }
      }
      break;
    }

    case 'scoutingDrone': {
      // The chosen piece goes down exactly like a normally placed tile: any free cell
      // adjacent to the board, any rotation (resolveScoutingDrone checks the same).
      const placements = tilePlacements(state);
      for (let si = 0; si <= 2; si++) {
        const stack = state.stacks[si as 0 | 1 | 2];
        if (!stack.available) continue;
        for (let pi = 0; pi < Math.min(stack.pieces.length, 5); pi++) {
          for (const { coord, rotation } of placements) {
            out.push({
              type: 'PLAY_CARD', cardType: 'scoutingDrone',
              stackIndex: si as 0 | 1 | 2, pieceIndex: pi, coord, rotation,
            });
          }
        }
      }
      break;
    }
  }
}

function addClaimBuilding(
  state: GameState,
  playerId: PlayerId,
  out: Action[],
  fromPI: boolean,
  fromFreeClaim = false,
) {
  const player = state.players[playerId];
  if (!player) return;
  const validModules = player.controlModules.filter(m => m >= state.mineCount);

  for (const piece of state.board) {
    if (piece.type === 'blank' || piece.type === 'mine') continue;
    // Only one player may claim a building
    if (piece.claims.length > 0 && piece.claims[0]!.ownerId !== playerId) continue;
    if (piece.claims.filter(c => c.ownerId === playerId).length >= MAX_CLAIMS_PER_BUILDING) continue;
    for (const module of validModules) {
      // Claiming never costs materials. Placing module M draws (M − mineCount + 1)
      // upgrade-units from whichever budget funds this claim (mine credits or PI).
      const cost = module - state.mineCount + 1;
      if (fromFreeClaim) {
        if (player.freeClaimUsed || player.freeActionCredits < cost) continue;
      }
      if (fromPI) {
        if (state.productionIncreaseClaimedThisTurn || state.productionIncreaseBudget < cost) continue;
      }
      out.push({
        type: 'CLAIM_BUILDING',
        pieceId: piece.id,
        controlModule: module,
        ...(fromPI ? { fromProductionIncrease: true } : {}),
        ...(fromFreeClaim ? { fromFreeClaim: true } : {}),
      });
    }
  }
}

// Upgrades never cost materials. fromPI=true funds from the Production Increase budget;
// otherwise it's a round-end free upgrade (= #mines), locked to a single building.
function addUpgradeBuilding(
  state: GameState,
  playerId: PlayerId,
  out: Action[],
  fromPI: boolean,
) {
  const player = state.players[playerId];
  if (!player) return;

  for (const piece of state.board) {
    const myClaims = piece.claims.filter(c => c.ownerId === playerId);
    for (const claim of myClaims) {
      const oldModule = claim.controlModule;
      const higherModules = player.controlModules.filter(m => m > oldModule && m >= state.mineCount);
      for (const newModule of higherModules) {
        const diff = newModule - oldModule;
        if (fromPI) {
          if (state.productionIncreaseBudget < diff) continue;
          out.push({ type: 'UPGRADE_BUILDING', pieceId: piece.id, oldModule, newModule, fromProductionIncrease: true });
        } else {
          // Round-end free upgrades: fully covered by free credits, single building only.
          const canUseFree = player.freeUpgradePieceId === null || player.freeUpgradePieceId === piece.id;
          if (!canUseFree || player.freeUpgradesRemaining < diff) continue;
          out.push({ type: 'UPGRADE_BUILDING', pieceId: piece.id, oldModule, newModule, freeCredits: diff });
        }
      }
    }
  }
}

// ── roundEnd phase ────────────────────────────────────────────────────────────

function addUpgradeBuildingFromMineCredit(state: GameState, playerId: PlayerId, out: Action[]) {
  const player = state.players[playerId];
  if (!player || player.freeActionCredits <= 0) return;

  for (const piece of state.board) {
    const myClaims = piece.claims.filter(c => c.ownerId === playerId);
    for (const claim of myClaims) {
      const oldModule = claim.controlModule;
      const validModules = player.controlModules.filter(
        m => m > oldModule && m >= state.mineCount && (m - oldModule) <= player.freeActionCredits,
      );
      for (const newModule of validModules) {
        out.push({ type: 'UPGRADE_BUILDING', pieceId: piece.id, oldModule, newModule, fromMineCredit: true });
      }
    }
  }
}

// All materials; canLoadMaterial (shared recipe table) filters to those that keep a
// valid recipe reachable given the current input slots.
const ALL_LOAD_MATERIALS: readonly Material[] = ['ore', 'plate', 'sphere', 'tesseract'];

function computeRoundEnd(state: GameState, playerId: PlayerId): Action[] {
  const player = state.players[playerId];
  if (!player) return [{ type: 'END_ACTIONS' }];
  const actions: Action[] = [{ type: 'END_ACTIONS' }];

  // Building meeple: offer load-input and operate actions.
  if (player.meepleOnPieceId !== null && player.meepleSlotIndex === null) {
    const piece = state.board.find(p => p.id === player.meepleOnPieceId);
    if (piece && piece.type !== 'mine' && piece.type !== 'blank') {
      // Load material into empty input slot — only materials that keep a valid recipe
      // reachable (canLoadMaterial), so legalActions matches applyLoadBuildingInput.
      if (piece.input && piece.input.slots.some(s => s === null)) {
        for (const mat of ALL_LOAD_MATERIALS) {
          if (player.inventory[mat] > 0 && canLoadMaterial(piece.type, piece.input.slots, mat)) {
            actions.push({ type: 'LOAD_BUILDING_INPUT', pieceId: piece.id, material: mat });
          }
        }
      }
      // Operate building if it can currently produce — but only ONCE per round end.
      // (Loading input before/after operating is still allowed via LOAD_BUILDING_INPUT.)
      // Probed against the engine, so an input teleporter that completes the recipe from
      // inventory counts exactly as applyOperateBuilding allows.
      const operate: OperateBuildingAction = { type: 'OPERATE_BUILDING', pieceId: piece.id };
      if (!player.meepleOperatedThisRound && canOperate(state, operate)) {
        actions.push(operate);
      }
      // Collect output buffer → inventory (optional; only the building's own output).
      if (piece.output && piece.output.slots.some(s => s !== null && player.inventory[s] < INVENTORY_CAP)) {
        actions.push({ type: 'COLLECT_OUTPUT', pieceId: piece.id });
      }
    }
  }

  if (player.freeUpgradesRemaining > 0) {
    addUpgradeBuilding(state, playerId, actions, false);
  }
  if (player.freeActionCredits > 0 && !player.freeClaimUsed) {
    addClaimBuilding(state, playerId, actions, false, true);
  }
  if (player.freeActionCredits > 0) {
    addUpgradeBuildingFromMineCredit(state, playerId, actions);
  }
  addExchangeMaterials(state, playerId, actions);
  return actions;
}

function addBuyBelt(state: GameState, playerId: PlayerId, out: Action[]) {
  const player = state.players[playerId];
  if (!player) return;
  const totalValue = (Object.keys(player.inventory) as Material[])
    .reduce((s, m) => s + player.inventory[m] * MATERIAL_VALUES[m], 0);
  if (totalValue >= BELT_COST) {
    out.push({ type: 'BUY_BELT' });
  }
}

function addBuyMine(state: GameState, playerId: PlayerId, out: Action[]) {
  if (state.unplacedMines.length === 0 || state.pendingMineIds.length > 0) return;
  const player = state.players[playerId];
  if (!player) return;

  const costIdx = 2 - state.unplacedMines.length;
  const cost = MINE_COSTS[costIdx];
  if (cost === undefined) return;
  const totalValue = (Object.keys(player.inventory) as Material[])
    .reduce((s, m) => s + player.inventory[m] * MATERIAL_VALUES[m], 0);
  if (totalValue < cost) return;

  const board = state.board;
  for (const coord of adjacentFreeCoords(state)) {
    for (const r of ROTATIONS) {
      const secondary = mineSecondaryCoord(coord, r);
      if (!isCoordsOccupied(secondary, board)) {
        out.push({ type: 'BUY_MINE', coord, rotation: r });
      }
    }
  }
}

function addPlaceBelt(state: GameState, playerId: PlayerId, out: Action[]) {
  const player = state.players[playerId];
  if (!player || player.beltsRemaining <= 0) return;
  // Placing from supply is free — no ore payment required here.
  // Buying additional belts from the bank costs 1 ore (separate BUY_BELT action).

  for (const piece of state.board) {
    if (piece.type === 'mine') continue;
    const template = PIECE_TEMPLATES[piece.type];
    const totalPos = template.hexCount * 12;
    const beltPts = template.points
      .filter(p => p.enabled && p.role === 'belt')
      .map(p => p.position);

    for (let i = 0; i < beltPts.length; i++) {
      const a = beltPts[i]!;
      if (state.belts.some(b => b.pieceId === piece.id && (b.fromPoint === a || b.toPoint === a))) continue;
      if (beltEndpointBlocked(state, piece, a, playerId)) continue; // joins opponent belt / blocks their input
      for (let j = i + 1; j < beltPts.length; j++) {
        const b = beltPts[j]!;
        if (state.belts.some(blt => blt.pieceId === piece.id && (blt.fromPoint === b || blt.toPoint === b))) continue;
        if (beltEndpointBlocked(state, piece, b, playerId)) continue;
        const dist = Math.min(Math.abs(a - b), totalPos - Math.abs(a - b));
        if (dist <= 2) continue;
        // Endpoint-level mine-belt limit: skip pairs where either endpoint faces a mine.
        if (state.mineBeltPlacedThisTurn &&
            (beltEndpointFacesMine(piece, a, state.board) || beltEndpointFacesMine(piece, b, state.board))) continue;
        out.push({ type: 'PLACE_BELT', pieceId: piece.id, fromPoint: a, toPoint: b });
      }
    }
  }
}

function addRemoveBelt(state: GameState, playerId: PlayerId, out: Action[]) {
  for (const belt of state.belts) {
    if (belt.ownerId === playerId) out.push({ type: 'REMOVE_BELT', beltId: belt.id });
  }
}

function addPlaceTeleporter(state: GameState, playerId: PlayerId, out: Action[]) {
  const player = state.players[playerId];
  if (!player || player.teleportersRemaining <= 0) return;
  if (tryPayExact(player.inventory, teleporterCost(state.globalTeleporterCount)) === null) return;

  for (const piece of state.board) {
    if (!piece.claims.some(c => c.ownerId === playerId)) continue;
    if (piece.input?.teleporterOwner === null) {
      out.push({ type: 'PLACE_TELEPORTER', pieceId: piece.id, bufferType: 'input' });
    }
    if (piece.output?.teleporterOwner === null) {
      out.push({ type: 'PLACE_TELEPORTER', pieceId: piece.id, bufferType: 'output' });
    }
  }
}

function addExchangeMaterials(state: GameState, playerId: PlayerId, out: Action[]) {
  const player = state.players[playerId];
  if (!player) return;
  const breakable: Material[] = ['plate', 'sphere', 'tesseract'];
  for (const mat of breakable) {
    if (player.inventory[mat] > 0) {
      out.push({ type: 'EXCHANGE_MATERIALS', give: mat });
    }
  }
}

// ── placeMeeple phase ─────────────────────────────────────────────────────────

function computePlaceMeeple(state: GameState, playerId: PlayerId): Action[] {
  const player = state.players[playerId];
  // Once placed: only END_TURN (prevents bot infinite loops; UI re-placement
  // bypasses legalActions via direct applyAction call in the canvas handler).
  if (!player || player.meepleOnPieceId !== null) return [{ type: 'END_TURN' }];

  // Meeple placement is mandatory — END_TURN withheld until a target is chosen.
  const actions: Action[] = [];
  for (const piece of state.board) {
    if (piece.type === 'mine') {
      // Only offer slots not already occupied by another player
      const slot0Taken = state.players.some(p => p.meepleOnPieceId === piece.id && p.meepleSlotIndex === 0);
      const slot1Taken = state.players.some(p => p.meepleOnPieceId === piece.id && p.meepleSlotIndex === 1);
      if (!slot0Taken) actions.push({ type: 'PLACE_MEEPLE', pieceId: piece.id, slotIndex: 0 });
      if (!slot1Taken) actions.push({ type: 'PLACE_MEEPLE', pieceId: piece.id, slotIndex: 1 });
    } else if (piece.claims.some(c => c.ownerId === playerId)) {
      actions.push({ type: 'PLACE_MEEPLE', pieceId: piece.id });
    }
  }
  if (actions.length === 0) return [{ type: 'END_TURN' }]; // no valid targets (edge case)
  return actions;
}
