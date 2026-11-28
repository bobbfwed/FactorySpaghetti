// Enumerates every legal action for the active player in the current state.
// Returns [] when the game is over or it is not this player's turn (and they have no decision
// pending), and in the roll step when no Leverage card can be played.
// Note: ROLL_DICE is NOT returned here — dice values are caller-supplied;
// bots and the sim generate them externally and pass them as ROLL_DICE actions.

import type { BoardPiece, GameState, PlayerId, HexCoord } from '../state';
import { freeTeleporterSlots } from './teleporters';
import type { Action, OperateBuildingAction } from '../actions';
import { canonicalAction, sameMove } from '../actions';
import { scoutingDronePieceIndex, cardsLeftToDraw, mayAddClaimByCard, leavesMeepleUnowned } from './cards';
import { minePlacementError } from './buildings';
import type { CardType } from '../config';
import { MINE_COSTS, cardCost, pieceTemplate, BELT_COST, INVENTORY_CAP, MAX_CARDS_PLAYED_PER_TURN, MAX_CLAIMS_PER_BUILDING, teleporterCost } from '../config';
import type { Material } from '../config';
import { canAfford, beltEndpointFacesOreExit, beltEndpointBlocked } from './flow';
import { applyOperateBuilding, canLoadMaterial, meepleTargets, operateSupplies } from './production';
import {
  hexNeighbours,
  isCoordsOccupied,
  mineSecondaryCoord,
  openStacks,
  drawnStack,
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
      // One operate per way the engine would accept it: from the building's own input (no
      // supply), and with each distinct supply from the owner's inventory through their input
      // teleporter (operateSupplies). An entry can go stale (e.g. a co-owner already operated
      // the same building, so its output buffer is full): then only the skip is left. A Power
      // Plant always runs, so its skip is offered only when it cannot run any more.
      const runs = operateOptions(state, e.pieceId, playerId, { ownerId: playerId });
      acts.push(...runs);
      const isPlant = state.board.find(p => p.id === e.pieceId)?.type === 'powerPlant';
      if (!isPlant || runs.length === 0) acts.push({ type: 'SKIP_FACTORY_ROLL', pieceId: e.pieceId, ownerId: playerId });
    }
    return acts;
  }

  if (state.turnOrder[state.activePlayerIndex] !== playerId) return [];

  switch (state.phase) {
    case 'setupClaimPF': return computeSetupClaim(state, 'plateFact');
    case 'setupClaimPP': return computeSetupClaim(state, 'powerPlant');
    case 'placePiece':   return [...computePlacePiece(state), ...ownTurnExtras(state, playerId)];
    // The dice are caller-supplied (ROLL_DICE is never listed); Leverage cards may still be
    // played (and a Production Increase spent) before rolling.
    case 'roll':         return ownTurnExtras(state, playerId);
    case 'actions':      return computeActions(state, playerId);
    case 'placeMeeple':  return [...computePlaceMeeple(state, playerId), ...ownTurnExtras(state, playerId)];
    case 'roundEnd':     return computeRoundEnd(state, playerId);
  }
}

// What may be done in any step of the player's own turn (RULES_CHANGES.md #50): play a Leverage
// card (at most MAX_CARDS_PLAYED_PER_TURN per turn) and spend a Production Increase played this
// turn on a claim (at most one) or upgrades.
function ownTurnExtras(state: GameState, playerId: PlayerId): Action[] {
  const out: Action[] = [];
  if (state.cardsPlayedThisTurn < MAX_CARDS_PLAYED_PER_TURN) addCardPlays(state, playerId, out);
  if (state.productionIncreaseBudget > 0) {
    if (!state.productionIncreaseClaimedThisTurn) addClaimBuilding(state, playerId, out, true);
    addUpgradeBuilding(state, playerId, out, true);
  }
  return out;
}

// The form in which legalActions would list `action` in this state: canonicalAction (belt end
// order, default rotation, false flags), and for a Scouting Drone play the first index of the
// named piece's type in its stack — the copy the engine takes (scoutingDronePieceIndex).
export function listedForm(state: GameState, action: Action): Action {
  const a = canonicalAction(action);
  if (a.type === 'PLAY_CARD' && a.cardType === 'scoutingDrone' && a.stackIndex !== undefined && a.pieceIndex !== undefined) {
    const pieceIndex = scoutingDronePieceIndex(state, a.stackIndex, a.pieceIndex);
    if (pieceIndex !== a.pieceIndex) return { ...a, pieceIndex };
  }
  return a;
}

// True when `action` is one of the moves legalActions offers `playerId` now (compared in its
// listed form with sameMove). ROLL_DICE is never listed (the dice are an input); it counts as
// listed for the active player in the roll step. The online host accepts a player's move only
// when this holds (session/hostSession.ts).
export function isListedMove(state: GameState, playerId: PlayerId, action: Action): boolean {
  if (action.type === 'ROLL_DICE') {
    return !state.gameOver && state.phase === 'roll' && state.turnOrder[state.activePlayerIndex] === playerId;
  }
  const form = listedForm(state, action);
  return legalActions(state, playerId).some(l => sameMove(l, form));
}

// The OPERATE_BUILDING moves `playerId` may make on `pieceId` now: one per supply the building
// runs with (operateSupplies: the plain run first, then each supply through the input teleporter),
// each confirmed by the engine's own OPERATE_BUILDING check so the list can never disagree with
// it (pending entry, meeple building, once-per-round-end use).
function operateOptions(state: GameState, pieceId: string, playerId: PlayerId, extra: { ownerId?: PlayerId }): OperateBuildingAction[] {
  const out: OperateBuildingAction[] = [];
  for (const supply of operateSupplies(state, pieceId, playerId)) {
    const a: OperateBuildingAction = { type: 'OPERATE_BUILDING', pieceId, ...extra, ...(supply.length > 0 ? { supply } : {}) };
    if (applyOperateBuilding(state, a).ok) out.push(a);
  }
  return out;
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

  // The draw step: with more than one open stack, the player first draws from one (and only
  // the draw is legal); after drawing, or when just one stack is open, they place its top piece.
  const open = openStacks(state);
  const drawn = drawnStack(state);
  if (drawn === null && open.length > 1) {
    return open.map(stackIndex => ({ type: 'DRAW_PIECE' as const, stackIndex }));
  }
  const from = drawn ?? open[0];
  if (from === undefined || !open.includes(from)) return [];

  return tilePlacements(state).map(({ coord, rotation }) =>
    ({ type: 'PLACE_PIECE' as const, stackIndex: from, coord, rotation }));
}

function computePlaceMineActions(state: GameState): Action[] {
  return minePlacements(state).map(({ coord, rotation }) => ({ type: 'PLACE_MINE' as const, coord, rotation }));
}

// Every (rich-hex cell, rotation) a Mine may be put down at, each once: both hexes free and at
// least one of them next to the board — the rich hex on a free cell next to the board, or the
// lean hex there with the rich hex on the free cell behind it (RULES_CHANGES.md #47). Shared
// by PLACE_MINE and BUY_MINE; each confirmed by the engine's own check (minePlacementError).
function minePlacements(state: GameState): Array<{ coord: HexCoord; rotation: number }> {
  const out: Array<{ coord: HexCoord; rotation: number }> = [];
  const seen = new Set<string>();
  const add = (coord: HexCoord, rotation: number): void => {
    const key = `${coord.q},${coord.r},${rotation}`;
    if (seen.has(key) || minePlacementError(state, coord, rotation)) return;
    seen.add(key);
    out.push({ coord, rotation });
  };
  for (const cell of adjacentFreeCoords(state)) {
    for (const r of ROTATIONS) {
      add(cell, r); // the rich hex touches the board
      // The lean hex on `cell`: the rich hex sits one step the other way.
      const back = mineSecondaryCoord(cell, r);
      add({ q: 2 * cell.q - back.q, r: 2 * cell.r - back.r }, r);
    }
  }
  return out;
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

  // Production Increase budget: claim/upgrade funded only by the budget (never materials).
  // Claiming in your own turn is ONLY via this card (≤1 claim/turn). The same as ownTurnExtras
  // offers in the other steps, kept in this order here.
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
  // An empty deck is refilled from the discard pile; only both empty stop a purchase.
  if (cardsLeftToDraw(state) === 0) return;
  const player = state.players[playerId];
  if (!player) return;
  if (canAfford(player.inventory, cardCost(state.mineCount))) {
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
        if (!mayAddClaimByCard(piece, playerId)) continue; // never another player's building
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
        // The meeple placed on this building this turn keeps the player's last module there.
        if (leavesMeepleUnowned(state, playerId, fromPiece.id)) continue;
        for (const claim of myClaims) {
          if (claim.controlModule < state.mineCount) continue;
          for (const toPiece of state.board) {
            if (toPiece.type === 'mine' || toPiece.type === 'blank') continue;
            if (toPiece.id === fromPiece.id) continue;
            if (!mayAddClaimByCard(toPiece, playerId)) continue; // never another player's building
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
        for (const t of teleporterSpots(piece)) out.push({ type: 'PLAY_CARD', cardType: 'rdTaxWriteOff', pieceId: piece.id, ...t });
      }
      break;
    }

    case 'scoutingDrone': {
      // In the place-a-piece step only before drawing (cards.ts resolveScoutingDrone).
      if (state.phase === 'placePiece' && drawnStack(state) !== null) break;
      // Any piece of any open stack may be chosen. Pieces of one type are interchangeable, so
      // each type present in a stack is listed once, at its first (topmost) index: the copy the
      // engine takes whichever index of that type is named (scoutingDronePieceIndex, cards.ts).
      // The chosen piece goes down exactly like a normally placed tile: any free cell
      // adjacent to the board, any rotation (resolveScoutingDrone checks the same).
      const placements = tilePlacements(state);
      for (let si = 0; si <= 2; si++) {
        const stack = state.stacks[si as 0 | 1 | 2];
        if (!stack.available) continue;
        const firstOfType = new Map<string, number>();
        stack.pieces.forEach((p, i) => { if (!firstOfType.has(p.type)) firstOfType.set(p.type, i); });
        for (const pi of [...firstOfType.values()].sort((x, y) => x - y)) {
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
      if (!player.meepleOperatedThisRound) actions.push(...operateOptions(state, piece.id, playerId, {}));
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
  if (canAfford(player.inventory, BELT_COST)) {
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
  if (!canAfford(player.inventory, cost)) return;

  for (const { coord, rotation } of minePlacements(state)) out.push({ type: 'BUY_MINE', coord, rotation });
}

// Each belt is listed ONCE, lower point first (fromPoint < toPoint). applyPlaceBelt also accepts
// the reversed order and stores the belt as given (the arrowhead is drawn at fromPoint), with the
// same effect on the rules; compare with sameMove / canonicalAction (actions.ts), not ===.
function addPlaceBelt(state: GameState, playerId: PlayerId, out: Action[]) {
  const player = state.players[playerId];
  if (!player || player.beltsRemaining <= 0) return;
  // Placing from supply is free — no ore payment required here.
  // Buying additional belts from the bank costs 1 ore (separate BUY_BELT action).

  for (const piece of state.board) {
    if (piece.type === 'mine') continue;
    const template = pieceTemplate(piece);
    const totalPos = template.hexCount * 12;
    const beltPts = template.points
      .filter(p => p.enabled && p.role === 'belt')
      .map(p => p.position);

    for (let i = 0; i < beltPts.length; i++) {
      const a = beltPts[i]!;
      if (state.belts.some(b => b.pieceId === piece.id && (b.fromPoint === a || b.toPoint === a))) continue;
      if (beltEndpointBlocked(state, piece, a, playerId)) continue; // joins opponent belt / reserved for a building's owners
      for (let j = i + 1; j < beltPts.length; j++) {
        const b = beltPts[j]!;
        if (state.belts.some(blt => blt.pieceId === piece.id && (blt.fromPoint === b || blt.toPoint === b))) continue;
        if (beltEndpointBlocked(state, piece, b, playerId)) continue;
        const dist = Math.min(Math.abs(a - b), totalPos - Math.abs(a - b));
        if (dist <= 2) continue;
        // One Mine belt per turn: skip pairs where either end faces a Mine ore exit.
        if (state.mineBeltPlacedThisTurn &&
            (beltEndpointFacesOreExit(piece, a, state.board) || beltEndpointFacesOreExit(piece, b, state.board))) continue;
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
  if (!canAfford(player.inventory, teleporterCost(state.globalTeleporterCount))) return;

  for (const piece of state.board) {
    if (!piece.claims.some(c => c.ownerId === playerId)) continue;
    for (const t of teleporterSpots(piece)) out.push({ type: 'PLACE_TELEPORTER', pieceId: piece.id, ...t });
  }
}

// Every place on `piece` a teleporter may still go (RULES_CHANGES.md #55): each input without one,
// named by its index, then the output when it has none. Shared by PLACE_TELEPORTER and R&D Tax
// Write-Off.
function teleporterSpots(piece: BoardPiece): Array<{ bufferType: 'input'; inputIndex: number } | { bufferType: 'output' }> {
  return [
    ...freeTeleporterSlots(piece.input).map(inputIndex => ({ bufferType: 'input' as const, inputIndex })),
    ...(freeTeleporterSlots(piece.output).length > 0 ? [{ bufferType: 'output' as const }] : []),
  ];
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
  // Once placed: only END_TURN (the engine refuses a second placement: MEEPLE_ALREADY_PLACED).
  if (!player || player.meepleOnPieceId !== null) return [{ type: 'END_TURN' }];

  // Meeple placement is mandatory: END_TURN is withheld until a target is chosen (the engine
  // refuses it too: MEEPLE_REQUIRED).
  const actions: Action[] = meepleTargets(state, playerId).map(t => ({ type: 'PLACE_MEEPLE' as const, ...t }));
  if (actions.length === 0) return [{ type: 'END_TURN' }]; // no valid targets (edge case)
  return actions;
}
