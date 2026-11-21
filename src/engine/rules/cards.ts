// M5: Leverage card purchase and resolution.
// All functions are pure: return new state, never mutate.

import type {
  GameState,
  Player,
  BoardPiece,
  UnplacedPiece,
  PlayerId,
  Buffer,
  PieceStack,
} from '../state';
import type {
  BuyCardAction,
  PlayCardAction,
  PlaceOverstockPieceAction,
  RulesError,
} from '../actions';
import type { CardType, Material, PieceType } from '../config';
import {
  PLAY_ON_DRAW_CARDS,
  INVENTORY_CAP,
  POWER_TOKEN_CAP,
  cardCost,
  PRODUCTION_INCREASE_BUDGET,
  MAX_CARDS_PLAYED_PER_TURN,
  MAX_CLAIMS_PER_BUILDING,
} from '../config';
import { isCoordsOccupied, isAdjacentToBoard, makeBuffers } from './pieces';
import { tryPayExact, tryPayFlexible } from './flow';

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

// Add `amount` of material to inventory, capped at INVENTORY_CAP.
function addInventory(
  inv: Readonly<Record<Material, number>>,
  mat: Material,
  amount: number,
): Readonly<Record<Material, number>> {
  return { ...inv, [mat]: Math.min(inv[mat] + amount, INVENTORY_CAP) };
}

// ── BUY_CARD ──────────────────────────────────────────────────────────────────

export function applyBuyCard(state: GameState, _action: BuyCardAction): ActionResult {
  if (state.phase !== 'actions') {
    return err('WRONG_PHASE', `Expected actions phase, got ${state.phase}`);
  }
  if (state.cardDeck.length === 0) {
    return err('DECK_EMPTY', 'The card deck is empty');
  }

  const activeId = state.turnOrder[state.activePlayerIndex];
  if (activeId === undefined) return err('INTERNAL', 'No active player');
  const player = state.players[activeId];
  if (!player) return err('INTERNAL', 'Player not found');

  const cost = cardCost(state.mineCount);
  const newInv = tryPayFlexible(player.inventory, cost);
  if (!newInv) {
    return err('CANNOT_AFFORD', `Card costs ${cost} value unit(s)`);
  }

  const card = state.cardDeck[0]!;
  const baseState: GameState = {
    ...state,
    cardDeck: state.cardDeck.slice(1),
    players: mapPlayer(state.players, activeId, p => ({
      ...p, inventory: newInv,
      stats: { ...p.stats, cardsPurchased: p.stats.cardsPurchased + 1 },
    })),
  };

  if (PLAY_ON_DRAW_CARDS.has(card)) {
    // Resolve immediately; never goes to hand. A play-on-draw card is also "played".
    const withDiscard: GameState = {
      ...baseState,
      cardDiscard: [...baseState.cardDiscard, card],
      players: mapPlayer(baseState.players, activeId, p => ({
        ...p, stats: { ...p.stats, cardsPlayed: p.stats.cardsPlayed + 1 },
      })),
    };
    return resolvePlayOnDraw(withDiscard, card, activeId);
  }

  // Add to hand
  return {
    ok: true,
    state: {
      ...baseState,
      players: mapPlayer(baseState.players, activeId, p => ({ ...p, hand: [...p.hand, card] })),
    },
  };
}

// ── PLAY_CARD ─────────────────────────────────────────────────────────────────

export function applyPlayCard(state: GameState, action: PlayCardAction): ActionResult {
  if (state.phase !== 'actions') {
    return err('WRONG_PHASE', `Expected actions phase, got ${state.phase}`);
  }

  const { cardType } = action;

  if (PLAY_ON_DRAW_CARDS.has(cardType)) {
    return err('PLAY_ON_DRAW', `${cardType} is play-on-draw and cannot be played from hand`);
  }

  const activeId = state.turnOrder[state.activePlayerIndex];
  if (activeId === undefined) return err('INTERNAL', 'No active player');
  const player = state.players[activeId];
  if (!player) return err('INTERNAL', 'Player not found');

  const cardIdx = player.hand.indexOf(cardType);
  if (cardIdx === -1) {
    return err('CARD_NOT_IN_HAND', `You don't have ${cardType} in your hand`);
  }

  if (state.cardsPlayedThisTurn >= MAX_CARDS_PLAYED_PER_TURN) {
    return err('CARD_LIMIT_REACHED', 'You can only play 2 cards per turn');
  }

  const newHand = [...player.hand.slice(0, cardIdx), ...player.hand.slice(cardIdx + 1)];
  const preState: GameState = {
    ...state,
    cardDiscard: [...state.cardDiscard, cardType],
    cardsPlayedThisTurn: state.cardsPlayedThisTurn + 1,
    players: mapPlayer(state.players, activeId, p => ({
      ...p, hand: newHand,
      stats: { ...p.stats, cardsPlayed: p.stats.cardsPlayed + 1 },
    })),
  };

  return dispatchCard(preState, action, activeId);
}

// ── PLACE_OVERSTOCK_PIECE ─────────────────────────────────────────────────────

export function applyPlaceOverstockPiece(
  state: GameState,
  action: PlaceOverstockPieceAction,
): ActionResult {
  if (state.phase !== 'actions') {
    return err('WRONG_PHASE', `Expected actions phase, got ${state.phase}`);
  }
  if (state.overstockPieces.length === 0) {
    return err('NO_OVERSTOCK', 'No Overstock Supplies pieces to place');
  }

  const { coord, rotation = 0 } = action;

  if (isCoordsOccupied(coord, state.board)) {
    return err('COORD_OCCUPIED', `${coord.q},${coord.r} is already occupied`);
  }
  if (!isAdjacentToBoard(coord, state.board)) {
    return err('NOT_ADJACENT', `${coord.q},${coord.r} is not adjacent to any board piece`);
  }

  const piece = state.overstockPieces[0]!;
  const { input, output } = makeBuffers(piece.type);

  const newBoardPiece: BoardPiece = {
    id: piece.id,
    type: piece.type,
    coord,
    rotation,
    claims: [],
    input,
    output,
  };

  return {
    ok: true,
    state: {
      ...state,
      board: [...state.board, newBoardPiece],
      overstockPieces: state.overstockPieces.slice(1),
    },
  };
}

// ── Play-on-draw resolution ───────────────────────────────────────────────────

function resolvePlayOnDraw(state: GameState, card: CardType, activeId: PlayerId): ActionResult {
  switch (card) {
    case 'mineInspection':    return resolveMineInspection(state, activeId);
    case 'solarFlare':        return resolveSolarFlare(state);
    case 'overstockSupplies': return resolveOverstockSupplies(state);
    default:
      return err('INTERNAL', `${card} is not a recognised play-on-draw card`);
  }
}

// ── Card dispatch ─────────────────────────────────────────────────────────────

function dispatchCard(
  state: GameState,
  action: PlayCardAction,
  activeId: PlayerId,
): ActionResult {
  switch (action.cardType) {
    case 'scoutingDrone':      return resolveScoutingDrone(state, action, activeId);
    case 'shortSale':          return resolveShortSale(state, action, activeId);
    case 'embezzlement':       return resolveEmbezzlement(state, activeId);
    case 'sinkHole':           return resolveSinkHole(state, action, activeId);
    case 'netSurplusSellOff':  return resolveNetSurplusSellOff(state, activeId);
    case 'changingPriorities': return resolveChangingPriorities(state, action, activeId);
    case 'productionIncrease': return resolveProductionIncrease(state);
    case 'personalJetPack':    return resolvePersonalJetPack(state, activeId);
    case 'assetForfeiture':    return resolveAssetForfeiture(state, activeId);
    case 'rdTaxWriteOff':      return resolveRdTaxWriteOff(state, action, activeId);
    default:
      return err('UNKNOWN_CARD', `Unknown card type: ${action.cardType}`);
  }
}

// ── Individual card effects ───────────────────────────────────────────────────

// mineInspection (play-on-draw): take 1 Plate per mine currently on board.
function resolveMineInspection(state: GameState, activeId: PlayerId): ActionResult {
  const player = state.players[activeId];
  if (!player) return err('INTERNAL', 'Player not found');

  return {
    ok: true,
    state: {
      ...state,
      players: mapPlayer(state.players, activeId, p => ({
        ...p,
        inventory: addInventory(p.inventory, 'plate', state.mineCount),
      })),
    },
  };
}

// solarFlare (play-on-draw): all players receive 2 Power Tokens.
function resolveSolarFlare(state: GameState): ActionResult {
  return {
    ok: true,
    state: {
      ...state,
      players: state.players.map(p => ({
        ...p,
        powerTokens: Math.min(p.powerTokens + 2, POWER_TOKEN_CAP),
      })),
    },
  };
}

// overstockSupplies (play-on-draw): draw 3 pieces from available stacks into overstockPieces.
// Auto-drop triggers normally if drawing empties a stack.
function resolveOverstockSupplies(state: GameState): ActionResult {
  const drawn: UnplacedPiece[] = [];
  let stacks = state.stacks;
  let unplacedMines = state.unplacedMines;
  let pendingMineIds = state.pendingMineIds;

  while (drawn.length < 3) {
    let si: 0 | 1 | 2 | null = null;
    for (const i of [0, 1, 2] as const) {
      if (stacks[i].available && stacks[i].pieces.length > 0) { si = i; break; }
    }
    if (si === null) break; // no pieces left

    const s = stacks[si];
    drawn.push(s.pieces[0]!);
    const newStack: PieceStack = { ...s, pieces: s.pieces.slice(1) };
    stacks = [
      si === 0 ? newStack : stacks[0],
      si === 1 ? newStack : stacks[1],
      si === 2 ? newStack : stacks[2],
    ];

    // Auto-drop if stack just emptied
    if (newStack.pieces.length === 0 && unplacedMines.length > 0) {
      const mine = unplacedMines[0]!;
      unplacedMines = unplacedMines.slice(1);
      pendingMineIds = [...pendingMineIds, mine.id];
      const rem = unplacedMines.length;
      if (rem === 1) stacks = [stacks[0], { ...stacks[1], available: true }, stacks[2]];
      else if (rem === 0) stacks = [stacks[0], stacks[1], { ...stacks[2], available: true }];
    }
  }

  return {
    ok: true,
    state: { ...state, stacks, unplacedMines, pendingMineIds, overstockPieces: drawn },
  };
}

// scoutingDrone: look through any available stack, choose any piece, place it now.
function resolveScoutingDrone(
  state: GameState,
  action: PlayCardAction,
  _activeId: PlayerId,
): ActionResult {
  const { stackIndex, pieceIndex, coord, rotation = 0 } = action;
  if (stackIndex === undefined || pieceIndex === undefined || coord === undefined) {
    return err('MISSING_PARAMS', 'scoutingDrone requires stackIndex, pieceIndex, and coord');
  }

  const stack = state.stacks[stackIndex];
  if (!stack.available) return err('STACK_LOCKED', `Stack ${stackIndex} is not available`);
  if (pieceIndex < 0 || pieceIndex >= stack.pieces.length) {
    return err('INVALID_PIECE_INDEX', `Piece index ${pieceIndex} out of range`);
  }

  if (isCoordsOccupied(coord, state.board)) {
    return err('COORD_OCCUPIED', `${coord.q},${coord.r} is already occupied`);
  }
  if (!isAdjacentToBoard(coord, state.board)) {
    return err('NOT_ADJACENT', `${coord.q},${coord.r} is not adjacent to any board piece`);
  }

  const piece = stack.pieces[pieceIndex]!;
  const { input, output } = makeBuffers(piece.type as PieceType);
  const newBoardPiece: BoardPiece = {
    id: piece.id, type: piece.type, coord, rotation, claims: [], input, output,
  };

  const newPieces = [
    ...stack.pieces.slice(0, pieceIndex),
    ...stack.pieces.slice(pieceIndex + 1),
  ];
  const newStack: PieceStack = { ...stack, pieces: newPieces };
  let stacks: readonly [PieceStack, PieceStack, PieceStack] = [
    stackIndex === 0 ? newStack : state.stacks[0],
    stackIndex === 1 ? newStack : state.stacks[1],
    stackIndex === 2 ? newStack : state.stacks[2],
  ];
  let unplacedMines = state.unplacedMines;
  let pendingMineIds = state.pendingMineIds;

  // Auto-drop if stack emptied
  if (newPieces.length === 0 && unplacedMines.length > 0) {
    const mine = unplacedMines[0]!;
    unplacedMines = unplacedMines.slice(1);
    pendingMineIds = [...pendingMineIds, mine.id];
    const rem = unplacedMines.length;
    if (rem === 1) stacks = [stacks[0], { ...stacks[1], available: true }, stacks[2]];
    else if (rem === 0) stacks = [stacks[0], stacks[1], { ...stacks[2], available: true }];
  }

  return {
    ok: true,
    state: {
      ...state,
      board: [...state.board, newBoardPiece],
      stacks,
      unplacedMines,
      pendingMineIds,
    },
  };
}

// shortSale: claim a building with your lowest available module (≥ mine floor) for free.
function resolveShortSale(
  state: GameState,
  action: PlayCardAction,
  activeId: PlayerId,
): ActionResult {
  const { pieceId } = action;
  if (!pieceId) return err('MISSING_PARAMS', 'shortSale requires pieceId');

  const player = state.players[activeId];
  if (!player) return err('INTERNAL', 'Player not found');

  const piece = state.board.find(p => p.id === pieceId);
  if (!piece) return err('PIECE_NOT_FOUND', `No board piece with id ${pieceId}`);
  if (piece.type === 'blank' || piece.type === 'mine') {
    return err('NOT_CLAIMABLE', 'Only factories and power plants can be claimed');
  }

  const myClaimsOnPiece = piece.claims.filter(c => c.ownerId === activeId);
  if (myClaimsOnPiece.length >= MAX_CLAIMS_PER_BUILDING) {
    return err('TOO_MANY_CLAIMS', 'You already have 3 claims on this building');
  }

  // Lowest available module that meets the floor
  const valid = player.controlModules.filter(m => m >= state.mineCount).sort((a, b) => a - b);
  if (valid.length === 0) {
    return err('NO_VALID_MODULE', `No module available at or above the claim floor (${state.mineCount})`);
  }

  const module = valid[0]!;
  const newBoard = state.board.map(p =>
    p.id === pieceId
      ? { ...p, claims: [...p.claims, { ownerId: activeId, controlModule: module }] }
      : p,
  );
  const newPlayers = mapPlayer(state.players, activeId, p => ({
    ...p,
    controlModules: p.controlModules.filter(m => m !== module),
  }));

  return { ok: true, state: { ...state, board: newBoard, players: newPlayers } };
}

// embezzlement: take 1 Sphere from the bank (capped).
function resolveEmbezzlement(state: GameState, activeId: PlayerId): ActionResult {
  return {
    ok: true,
    state: {
      ...state,
      players: mapPlayer(state.players, activeId, p => ({
        ...p,
        inventory: addInventory(p.inventory, 'sphere', 1),
      })),
    },
  };
}

// sinkHole: discard any unclaimed non-mine board piece; return its belts to owners.
function resolveSinkHole(
  state: GameState,
  action: PlayCardAction,
  _activeId: PlayerId,
): ActionResult {
  const { pieceId } = action;
  if (!pieceId) return err('MISSING_PARAMS', 'sinkHole requires pieceId');

  const piece = state.board.find(p => p.id === pieceId);
  if (!piece) return err('PIECE_NOT_FOUND', `No board piece with id ${pieceId}`);
  if (piece.type === 'mine') return err('CANNOT_SINK_MINE', 'Mines cannot be discarded');
  if (piece.claims.length > 0) return err('PIECE_CLAIMED', 'Cannot discard a claimed piece');

  const newBoard = state.board.filter(p => p.id !== pieceId);
  const beltsOnPiece = state.belts.filter(b => b.pieceId === pieceId);
  const newBelts = state.belts.filter(b => b.pieceId !== pieceId);

  let newPlayers = state.players;
  for (const belt of beltsOnPiece) {
    newPlayers = mapPlayer(newPlayers, belt.ownerId, p => ({
      ...p,
      beltsRemaining: p.beltsRemaining + 1,
    }));
  }

  return { ok: true, state: { ...state, board: newBoard, belts: newBelts, players: newPlayers } };
}

// netSurplusSellOff: clockwise from next player, collect 3 Power Tokens (or all they have).
// Stops when active player hits the cap.
function resolveNetSurplusSellOff(state: GameState, activeId: PlayerId): ActionResult {
  const n = state.turnOrder.length;
  const activeIdx = state.turnOrder.indexOf(activeId);

  let currentTokens = state.players[activeId]?.powerTokens ?? 0;
  let newPlayers = state.players;

  for (let i = 1; i < n; i++) {
    if (currentTokens >= POWER_TOKEN_CAP) break;

    const targetIdx = (activeIdx + i) % n;
    const targetId = state.turnOrder[targetIdx];
    if (targetId === undefined) continue;
    const target = newPlayers[targetId];
    if (!target) continue;

    const canReceive = POWER_TOKEN_CAP - currentTokens;
    const give = Math.min(3, target.powerTokens, canReceive);

    currentTokens += give;
    newPlayers = mapPlayer(newPlayers, targetId, p => ({
      ...p, powerTokens: p.powerTokens - give,
    }));
  }

  newPlayers = mapPlayer(newPlayers, activeId, p => ({ ...p, powerTokens: currentTokens }));
  return { ok: true, state: { ...state, players: newPlayers } };
}

// changingPriorities: move a Control Module from one of your buildings to another.
function resolveChangingPriorities(
  state: GameState,
  action: PlayCardAction,
  activeId: PlayerId,
): ActionResult {
  const { pieceId: fromId, toPieceId: toId, controlModule } = action;
  if (!fromId || !toId || controlModule === undefined) {
    return err('MISSING_PARAMS', 'changingPriorities requires pieceId (from), toPieceId, and controlModule');
  }

  const fromPiece = state.board.find(p => p.id === fromId);
  if (!fromPiece) return err('PIECE_NOT_FOUND', `From piece ${fromId} not found`);
  const toPiece = state.board.find(p => p.id === toId);
  if (!toPiece) return err('PIECE_NOT_FOUND', `To piece ${toId} not found`);

  if (toPiece.type === 'blank' || toPiece.type === 'mine') {
    return err('NOT_CLAIMABLE', 'Target must be a factory or power plant');
  }

  const claimIdx = fromPiece.claims.findIndex(
    c => c.ownerId === activeId && c.controlModule === controlModule,
  );
  if (claimIdx === -1) {
    return err('CLAIM_NOT_FOUND', `You don't have module ${controlModule} on ${fromId}`);
  }

  if (toPiece.claims.filter(c => c.ownerId === activeId).length >= MAX_CLAIMS_PER_BUILDING) {
    return err('TOO_MANY_CLAIMS', 'You already have 3 claims on the target building');
  }

  // Module must be >= claim floor at destination
  if (controlModule < state.mineCount) {
    return err('CLAIM_FLOOR_VIOLATION', `Module ${controlModule} is below the claim floor`);
  }

  const newFromClaims = fromPiece.claims.filter((_, i) => i !== claimIdx);
  const newToClaims = [...toPiece.claims, { ownerId: activeId, controlModule }];

  const newBoard = state.board.map(p => {
    if (p.id === fromId) return { ...p, claims: newFromClaims };
    if (p.id === toId)   return { ...p, claims: newToClaims };
    return p;
  });

  return { ok: true, state: { ...state, board: newBoard } };
}

// productionIncrease: grant a budget of Control Module upgrade-units to spend this turn
// on claims (cost = module − mineCount + 1) and upgrades (cost = new − old), at most 1 claim.
function resolveProductionIncrease(state: GameState): ActionResult {
  return {
    ok: true,
    state: {
      ...state,
      productionIncreaseBudget: PRODUCTION_INCREASE_BUDGET,
      productionIncreaseClaimedThisTurn: false,
    },
  };
}

// personalJetPack: collect material from ALL your factories' output buffers into inventory.
// Bypasses the meeple-access rule.
function resolvePersonalJetPack(state: GameState, activeId: PlayerId): ActionResult {
  const player = state.players[activeId];
  if (!player) return err('INTERNAL', 'Player not found');

  let newBoard = state.board;
  let inventory = { ...player.inventory };

  for (const piece of state.board) {
    if (piece.type === 'mine' || piece.type === 'blank' || piece.type === 'powerPlant') continue;
    if (!piece.claims.some(c => c.ownerId === activeId)) continue;
    const output = piece.output;
    if (!output) continue;

    const newSlots = output.slots.map(slot => {
      if (slot === null) return null as Material | null;
      const mat = slot;
      if (inventory[mat] < INVENTORY_CAP) {
        inventory = { ...inventory, [mat]: inventory[mat] + 1 };
        return null as Material | null;
      }
      return slot; // inventory cap — stays in buffer
    });

    if (newSlots.some((s, i) => s !== output.slots[i])) {
      newBoard = newBoard.map(p =>
        p.id === piece.id ? { ...p, output: { ...output, slots: newSlots } } : p,
      );
    }
  }

  return {
    ok: true,
    state: {
      ...state,
      board: newBoard,
      players: mapPlayer(state.players, activeId, p => ({ ...p, inventory })),
    },
  };
}

// assetForfeiture: sweep ALL Plates from ALL output buffers. Active player keeps up to cap.
function resolveAssetForfeiture(state: GameState, activeId: PlayerId): ActionResult {
  const player = state.players[activeId];
  if (!player) return err('INTERNAL', 'Player not found');

  let newBoard = state.board;
  let platesToAdd = 0;

  for (const piece of state.board) {
    const output = piece.output;
    if (!output) continue;

    const newSlots = output.slots.map(slot => {
      if (slot === 'plate') { platesToAdd++; return null as Material | null; }
      return slot;
    });

    if (newSlots.some((s, i) => s !== output.slots[i])) {
      newBoard = newBoard.map(p =>
        p.id === piece.id ? { ...p, output: { ...output, slots: newSlots } } : p,
      );
    }
  }

  return {
    ok: true,
    state: {
      ...state,
      board: newBoard,
      players: mapPlayer(state.players, activeId, p => ({
        ...p,
        inventory: addInventory(p.inventory, 'plate', platesToAdd),
      })),
    },
  };
}

// rdTaxWriteOff: place a teleporter on one of your buildings for free.
// OQ-3 defaults: yes, consumes a teleporter from supply and ticks the global counter.
function resolveRdTaxWriteOff(
  state: GameState,
  action: PlayCardAction,
  activeId: PlayerId,
): ActionResult {
  const { pieceId, bufferType } = action;
  if (!pieceId || !bufferType) {
    return err('MISSING_PARAMS', 'rdTaxWriteOff requires pieceId and bufferType');
  }

  const player = state.players[activeId];
  if (!player) return err('INTERNAL', 'Player not found');

  if (player.teleportersRemaining <= 0) {
    return err('NO_TELEPORTERS', 'You have no teleporters remaining');
  }

  const piece = state.board.find(p => p.id === pieceId);
  if (!piece) return err('PIECE_NOT_FOUND', `No board piece with id ${pieceId}`);

  if (!piece.claims.some(c => c.ownerId === activeId)) {
    return err('NOT_OWNER', 'You must own this building to place a teleporter');
  }

  const buffer = bufferType === 'input' ? piece.input : piece.output;
  if (!buffer) return err('NO_BUFFER', `${pieceId} has no ${bufferType} buffer`);
  if (buffer.teleporterOwner !== null) {
    return err('TELEPORTER_EXISTS', `A teleporter is already on the ${bufferType} buffer of ${pieceId}`);
  }

  const newBuffer: Buffer = { ...buffer, teleporterOwner: activeId };
  const newBoard = state.board.map(p =>
    p.id === pieceId
      ? {
          ...p,
          input:  bufferType === 'input'  ? newBuffer : p.input,
          output: bufferType === 'output' ? newBuffer : p.output,
        }
      : p,
  );

  return {
    ok: true,
    state: {
      ...state,
      board: newBoard,
      players: mapPlayer(state.players, activeId, p => ({
        ...p,
        teleportersRemaining: p.teleportersRemaining - 1,
      })),
      globalTeleporterCount: state.globalTeleporterCount + 1,
    },
  };
}
