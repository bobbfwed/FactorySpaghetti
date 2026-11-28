// M5: Leverage card purchase and resolution.
// All functions are pure: return new state, never mutate.

import type {
  GameState,
  Player,
  BoardPiece,
  UnplacedPiece,
  PlayerId,
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
  PLAY_ON_DRAW_COUNTS_TOWARD_LIMIT,
} from '../config';
import { isCoordsOccupied, isAdjacentToBoard, makeBuffers, validRotation, drawnStack, OWN_TURN_STEPS } from './pieces';
import { mineBeltAmong, payMaterials, teleporterTarget } from './flow';
import { mayAddClaim } from './ownership';
import { shuffle } from '../rng';

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

// ── The Leverage deck ─────────────────────────────────────────────────────────

// The state ready for a card to be drawn: when the deck is empty, the discard pile is shuffled
// into a new deck with the game's seeded RNG (state.rng, which setup leaves behind and nothing
// else uses), so the shuffle is reproducible from the state alone (RULES_CHANGES.md #48).
// Unchanged when the deck still has cards, or when deck and discard pile are both empty.
export function withDrawableDeck(state: GameState): GameState {
  if (state.cardDeck.length > 0 || state.cardDiscard.length === 0) return state;
  const [deck, rng] = shuffle(state.cardDiscard, state.rng);
  return { ...state, cardDeck: deck, cardDiscard: [], rng };
}

// Cards left to draw: the deck, and the discard pile that is shuffled into a new deck when the
// deck runs out. A card can be bought only while this is above 0.
export function cardsLeftToDraw(state: Pick<GameState, 'cardDeck' | 'cardDiscard'>): number {
  return state.cardDeck.length + state.cardDiscard.length;
}

// The card the next purchase draws (after any reshuffle), or null when none is left. Pure; for
// the interface and the move log, which name a play-on-draw card when it is bought.
export function nextCardDrawn(state: GameState): CardType | null {
  return withDrawableDeck(state).cardDeck[0] ?? null;
}

// ── BUY_CARD ──────────────────────────────────────────────────────────────────

export function applyBuyCard(state: GameState, _action: BuyCardAction): ActionResult {
  if (state.phase !== 'actions') {
    return err('WRONG_PHASE', `Expected actions phase, got ${state.phase}`);
  }
  if (cardsLeftToDraw(state) === 0) {
    return err('DECK_EMPTY', 'The card deck and the discard pile are both empty');
  }
  state = withDrawableDeck(state);

  const activeId = state.turnOrder[state.activePlayerIndex];
  if (activeId === undefined) return err('INTERNAL', 'No active player');
  const player = state.players[activeId];
  if (!player) return err('INTERNAL', 'Player not found');

  const cost = cardCost(state.mineCount);
  const newInv = payMaterials(player.inventory, cost);
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
    // Resolve immediately; never goes to hand. A play-on-draw card is also "played": it uses up
    // one of the turn's plays if any are left (PLAY_ON_DRAW_COUNTS_TOWARD_LIMIT) and resolves
    // anyway when none are left. Buying is never blocked by the limit (RULES_CHANGES.md #36).
    const plays = PLAY_ON_DRAW_COUNTS_TOWARD_LIMIT && baseState.cardsPlayedThisTurn < MAX_CARDS_PLAYED_PER_TURN
      ? baseState.cardsPlayedThisTurn + 1
      : baseState.cardsPlayedThisTurn;
    const withDiscard: GameState = {
      ...baseState,
      cardsPlayedThisTurn: plays,
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
  if (!OWN_TURN_STEPS.has(state.phase)) {
    return err('WRONG_PHASE', `Leverage cards are played in the steps of your own turn, not in ${state.phase}`);
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
  if (!validRotation(rotation)) return err('INVALID_ROTATION', `Rotation ${rotation} is not 0–5`);

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

// The pieceIndex a Scouting Drone play actually takes: the first piece in that stack of the
// same type as the one named. Pieces of one type are interchangeable, so naming any copy takes
// the topmost copy (RULES_CHANGES.md #41); legalActions lists exactly these indexes. Returns
// the index unchanged when it does not name a piece of an existing stack.
export function scoutingDronePieceIndex(state: GameState, stackIndex: number, pieceIndex: number): number {
  const stack = state.stacks[stackIndex as 0 | 1 | 2] as PieceStack | undefined;
  const named = Number.isInteger(pieceIndex) ? stack?.pieces[pieceIndex] : undefined;
  if (!stack || !named) return pieceIndex;
  return stack.pieces.findIndex(p => p.type === named.type);
}

// scoutingDrone: look through any available stack, choose any piece (by type), place it now.
function resolveScoutingDrone(
  state: GameState,
  action: PlayCardAction,
  _activeId: PlayerId,
): ActionResult {
  const { stackIndex, coord, rotation = 0 } = action;
  if (stackIndex === undefined || action.pieceIndex === undefined || coord === undefined) {
    return err('MISSING_PARAMS', 'scoutingDrone requires stackIndex, pieceIndex, and coord');
  }
  // In the place-a-piece step the drone goes before the draw: once a piece is drawn (it is in
  // the player's hand, to be placed) the drone would reach into the stacks around it, and a Mine
  // it drops would have to replace a draw already made (RULES_CHANGES.md #50).
  if (state.phase === 'placePiece' && drawnStack(state) !== null) {
    return err('ALREADY_DRAWN', 'You have already drawn a piece this turn; place it before playing Scouting Drone');
  }

  const stack = state.stacks[stackIndex] as PieceStack | undefined;
  if (!stack) return err('INVALID_STACK', `There is no stack ${String(stackIndex)}`);
  if (!stack.available) return err('STACK_LOCKED', `Stack ${stackIndex} is not available`);
  if (!Number.isInteger(action.pieceIndex) || action.pieceIndex < 0 || action.pieceIndex >= stack.pieces.length) {
    return err('INVALID_PIECE_INDEX', `Piece index ${action.pieceIndex} out of range`);
  }
  if (!validRotation(rotation)) return err('INVALID_ROTATION', `Rotation ${rotation} is not 0–5`);
  const pieceIndex = scoutingDronePieceIndex(state, stackIndex, action.pieceIndex);

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

  // Only an unclaimed building or one of the player's own: one owner per building (#46, #57).
  if (!mayAddClaim(piece, activeId)) {
    return err('ALREADY_CLAIMED', "Short Sale cannot claim another player's building");
  }
  if (piece.claims.length >= MAX_CLAIMS_PER_BUILDING) {
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

// sinkHole: discard any unclaimed non-mine board piece. The belts lying on it go back to the bank
// (RULES_CHANGES.md #56): their owners do not get them back and must buy belts again, also for a
// belt laid this turn (Sink Hole is not a take-back, unlike REMOVE_BELT's same-turn case, #54).
// A belt laid this turn that it removes leaves this turn's list, so Undo belts cannot bring it
// back, and the one-Mine-belt mark is worked out again as after REMOVE_BELT (#52): it stays used
// only while a belt laid this turn still has an end facing a Mine ore exit.
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
  const sunk = new Set(state.belts.filter(b => b.pieceId === pieceId).map(b => b.id));
  if (sunk.size === 0) return { ok: true, state: { ...state, board: newBoard } };
  const newBelts = state.belts.filter(b => !sunk.has(b.id));
  const placedThisTurn = state.beltsPlacedThisTurn.filter(id => !sunk.has(id));
  const tookThisTurns = placedThisTurn.length !== state.beltsPlacedThisTurn.length;

  return {
    ok: true,
    state: {
      ...state,
      board: newBoard,
      belts: newBelts,
      beltsPlacedThisTurn: placedThisTurn,
      mineBeltPlacedThisTurn: tookThisTurns ? mineBeltAmong(newBoard, newBelts, placedThisTurn) : state.mineBeltPlacedThisTurn,
    },
  };
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

// True when moving one of `playerId`'s Control Modules off `fromId` would leave their meeple,
// placed on that building this turn, on a building where they hold no claim.
export function leavesMeepleUnowned(state: GameState, playerId: PlayerId, fromId: string): boolean {
  const p = state.players[playerId];
  if (!p || p.meepleOnPieceId !== fromId || p.meepleSlotIndex !== null) return false;
  const from = state.board.find(b => b.id === fromId);
  return !!from && from.claims.filter(c => c.ownerId === playerId).length === 1;
}

// changingPriorities: move a Control Module from one of your buildings to another (unclaimed or
// already yours: one owner per building, #46, #57). Moving the player's last module off a
// building leaves it with no owner: after the move, settleLostClaims (ownership.ts, run by the
// reducer) sends its material to the bank and its Teleporters back to their placer (#37, #58).
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
  if (toPiece.id === fromPiece.id) {
    return err('SAME_BUILDING', 'The Control Module must move to a different building');
  }

  const claimIdx = fromPiece.claims.findIndex(
    c => c.ownerId === activeId && c.controlModule === controlModule,
  );
  if (claimIdx === -1) {
    return err('CLAIM_NOT_FOUND', `You don't have module ${controlModule} on ${fromId}`);
  }

  if (!mayAddClaim(toPiece, activeId)) {
    return err('ALREADY_CLAIMED', "Changing Priorities cannot move a Control Module onto another player's building");
  }
  if (toPiece.claims.length >= MAX_CLAIMS_PER_BUILDING) {
    return err('TOO_MANY_CLAIMS', 'You already have 3 claims on the target building');
  }
  // Once the meeple stands on a building this turn, its last Control Module there stays: the
  // meeple may stand only on a building of the player's (RULES_CHANGES.md #50).
  if (leavesMeepleUnowned(state, activeId, fromPiece.id)) {
    return err('MEEPLE_ON_BUILDING', 'Your meeple stands on that building; its last Control Module of yours must stay');
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

// rdTaxWriteOff: place a teleporter on one of your buildings for free. It is one of your 4
// teleporters and, like any teleporter on the board, raises the teleporter price for everyone
// (designer's decision, RULES_CHANGES.md #35).
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

  // One input (inputIndex, the first when not named) or the output, as PLACE_TELEPORTER (#55).
  const placed = teleporterTarget(piece, bufferType, action.inputIndex);
  if (!placed.ok) {
    return placed.error.code === 'BUFFER_OCCUPIED'
      ? err('TELEPORTER_EXISTS', `A teleporter is already on that ${bufferType} of ${pieceId}`)
      : placed;
  }
  const newPiece = placed.piece(activeId);
  const newBoard = state.board.map(p => (p.id === pieceId ? newPiece : p));

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
