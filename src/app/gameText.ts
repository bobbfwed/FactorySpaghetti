// Plain-words text for the text view of a game: the step in rulebook words, readable labels for
// every legal move, and moves grouped by kind. No DOM, so it is tested in Vitest.

import type { Action } from '../engine/actions';
import type { BoardPiece, GameState, PlayerId } from '../engine/state';
import type { Material } from '../engine/config';
import { BELT_COST, FACTORY_POWER_COST, FACTORY_RECIPES, MINE_COSTS, cardCost } from '../engine/config';
import { legalActions, revealedStack } from '../engine';
import { resourcePoints, tesseractCount } from '../engine/rules/scoring';
import { BUILDING_NAME, CARD_NAME, MATERIAL_NAME, STACK_ORDINAL } from '../session/describe';
import { whereLabel, whereWords } from '../session/where';
import type { Room } from '../session/room';
import { activeSeat } from '../session/room';

/** The current step, worded as in the rulebook. */
export function phaseWords(game: GameState): string {
  switch (game.phase) {
    case 'setupClaimPF': return 'Setup: claim a Plate Factory';
    case 'setupClaimPP': return 'Setup: claim a Power Plant';
    case 'placePiece':
      if (game.pendingMineIds.length > 0) return 'Step 1: place the dropped Mine';
      return revealedStack(game) === null ? 'Step 1: draw a board piece' : 'Step 1: place a board piece';
    case 'roll': return 'Step 2: roll the dice';
    case 'actions': return 'Step 3: actions';
    case 'placeMeeple': return 'Step 4: place your meeple';
    case 'roundEnd': return 'Round end: operate and upgrade';
  }
}

export type GroupId = 'setup' | 'roll' | 'place' | 'buildings' | 'belts' | 'buy' | 'cards' | 'meeple' | 'end';

export interface GameOption {
  key: string;
  label: string;
  action: Action;
  /** A heading inside an expanded group (for example "From stack 1"). */
  sub?: string;
}

export interface OptionGroup {
  id: GroupId;
  title: string;
  /** What one option of the group is called, for "37 places". */
  noun: string;
  options: GameOption[];
  /** Long groups start collapsed. */
  collapsed: boolean;
}

const GROUPS: { id: GroupId; title: string; noun: [string, string] }[] = [
  { id: 'setup', title: 'Claim a starting building', noun: ['building', 'buildings'] },
  { id: 'roll', title: 'Roll', noun: ['roll', 'rolls'] },
  { id: 'place', title: 'Place a piece', noun: ['place', 'places'] },
  { id: 'buildings', title: 'Buildings', noun: ['move', 'moves'] },
  { id: 'belts', title: 'Belts', noun: ['move', 'moves'] },
  { id: 'buy', title: 'Buy and exchange', noun: ['option', 'options'] },
  { id: 'cards', title: 'Play a card', noun: ['way', 'ways'] },
  { id: 'meeple', title: 'Place your meeple', noun: ['place', 'places'] },
  { id: 'end', title: 'End the step', noun: ['option', 'options'] },
];

/** Groups with more options than this start collapsed. */
export const COLLAPSE_OVER = 6;

// Positions are described relative to the first Mine (session/where.ts), never as coordinates.
const turned = (r: number | undefined): string => (r ? ` · turned ${r}` : '');

/** "Plate Factory 1 space to the right of the first Mine (yours, module 3)". */
export function pieceLabel(game: GameState, pieceId: string | undefined, names: readonly string[], me: number | null): string {
  const p = pieceId === undefined ? undefined : game.board.find(x => x.id === pieceId);
  if (!p) return 'a piece';
  return `${BUILDING_NAME[p.type]} ${whereWords(game, p.coord)}${ownerNote(p, names, me)}`;
}

function ownerNote(p: BoardPiece, names: readonly string[], me: number | null): string {
  if (p.type === 'mine' || p.type === 'blank') return '';
  if (p.claims.length === 0) return ' (unclaimed)';
  const parts = p.claims.map(c => `${c.ownerId === me ? 'yours' : names[c.ownerId] ?? `seat ${c.ownerId + 1}`} ${c.controlModule}`);
  return ` (${parts.join(', ')})`;
}

/** What running a factory costs and makes, e.g. "−1 power, Ore → Plate". */
export function operateCost(game: GameState, pieceId: string): string {
  const p = game.board.find(x => x.id === pieceId);
  const recipe = p ? FACTORY_RECIPES[p.type] : undefined;
  if (!p || !recipe) return '';
  const product = recipe.product as Exclude<Material, 'ore'>;
  const inputs = recipe.inputs.map(set => set.map(m => MATERIAL_NAME[m]).join(' + ')).join(' or ');
  return `−${FACTORY_POWER_COST[product]} power, ${inputs} → ${MATERIAL_NAME[product]}`;
}

interface Labelled { group: GroupId; label: string; sub?: string }

function labelFor(game: GameState, a: Action, names: readonly string[], me: number | null): Labelled {
  const piece = (id: string | undefined): string => pieceLabel(game, id, names, me);
  switch (a.type) {
    case 'SETUP_CLAIM':
      return { group: 'setup', label: `Claim the ${piece(a.pieceId)} with Control Module ${game.phase === 'setupClaimPF' ? 3 : 2}` };
    case 'DRAW_PIECE':
      return { group: 'place', label: `Draw from the ${STACK_ORDINAL[a.stackIndex]} stack` };
    case 'PLACE_PIECE':
      return { group: 'place', sub: `From stack ${a.stackIndex + 1}`, label: `${whereLabel(game, a.coord)}${turned(a.rotation)}` };
    case 'PLACE_MINE':
      return { group: 'place', sub: 'The dropped Mine', label: `${whereLabel(game, a.coord)}${turned(a.rotation)}` };
    case 'PLACE_OVERSTOCK_PIECE': {
      const next = game.overstockPieces[0];
      return { group: 'place', sub: `Overstock piece${next ? `: ${BUILDING_NAME[next.type]}` : ''}`, label: `${whereLabel(game, a.coord)}${turned(a.rotation)}` };
    }
    case 'ROLL_DICE':
      return { group: 'roll', label: `Roll ${game.mineCount} ${game.mineCount === 1 ? 'die' : 'dice'}` };
    case 'END_ACTIONS':
      return { group: 'end', label: game.phase === 'roundEnd' ? 'End my round-end turn' : 'Done with actions' };
    case 'END_TURN':
      return { group: 'end', label: 'End my turn' };
    case 'PLACE_MEEPLE': {
      const p = game.board.find(x => x.id === a.pieceId);
      if (p?.type === 'mine') {
        const slot = a.slotIndex === 1 ? 'upgrade point' : 'resource point';
        return { group: 'meeple', label: `${p.id === 'mine-1' ? 'The first Mine' : `The Mine ${whereWords(game, p.coord)}`}: ${slot}` };
      }
      return { group: 'meeple', label: piece(a.pieceId) };
    }
    case 'PLACE_BELT':
      return { group: 'belts', sub: `Belt on the ${piece(a.pieceId)}`, label: `Holes ${a.fromPoint + 1} → ${a.toPoint + 1}` };
    case 'REMOVE_BELT': {
      const b = game.belts.find(x => x.id === a.beltId);
      return { group: 'belts', sub: 'Pick up a belt', label: b ? `On the ${piece(b.pieceId)}, holes ${b.fromPoint + 1}–${b.toPoint + 1}` : 'A belt' };
    }
    case 'UNDO_BELTS':
      return { group: 'belts', label: "Take back this turn's belts" };
    case 'BUY_BELT':
      return { group: 'belts', label: `Buy a belt (${BELT_COST} ore value)` };
    case 'PLACE_TELEPORTER':
      return { group: 'buildings', sub: 'Place a teleporter', label: `On the ${a.bufferType} of the ${piece(a.pieceId)}` };
    case 'CLAIM_BUILDING': {
      const how = a.fromFreeClaim ? ' (free claim)' : a.fromProductionIncrease ? ' (Production Increase)' : '';
      return { group: 'buildings', sub: `Claim the ${piece(a.pieceId)}`, label: `With module ${a.controlModule}${how}` };
    }
    case 'UPGRADE_BUILDING': {
      const how = a.fromMineCredit ? ' (mine credit)' : a.fromProductionIncrease ? ' (Production Increase)'
        : a.freeCredits ? ` (${a.freeCredits} free)` : '';
      return { group: 'buildings', sub: `Upgrade the ${piece(a.pieceId)}`, label: `Module ${a.oldModule} → ${a.newModule}${how}` };
    }
    case 'LOAD_BUILDING_INPUT':
      return { group: 'buildings', label: `Load 1 ${MATERIAL_NAME[a.material]} into the ${piece(a.pieceId)}` };
    case 'OPERATE_BUILDING':
      return { group: 'buildings', label: `Run the ${piece(a.pieceId)}` };
    case 'COLLECT_OUTPUT':
      return { group: 'buildings', label: `Collect the output of the ${piece(a.pieceId)}` };
    case 'SKIP_FACTORY_ROLL':
      return { group: 'buildings', label: `Skip the ${piece(a.pieceId)}` };
    case 'BUY_MINE': {
      const cost = MINE_COSTS[game.mineCount - 1] ?? MINE_COSTS[1];
      return { group: 'buy', sub: `Buy a Mine (${cost} ore value)`, label: `${whereLabel(game, a.coord)}${turned(a.rotation)}` };
    }
    case 'BUY_CARD':
      return { group: 'buy', label: `Buy a Leverage card (${cardCost(game.mineCount)} ore value)` };
    case 'EXCHANGE_MATERIALS':
      return { group: 'buy', label: `Break 1 ${MATERIAL_NAME[a.give]} down into smaller materials` };
    case 'PLAY_CARD':
      return { group: 'cards', sub: CARD_NAME[a.cardType], label: cardDetail(game, a, names, me) };
  }
}

function cardDetail(game: GameState, a: Extract<Action, { type: 'PLAY_CARD' }>, names: readonly string[], me: number | null): string {
  const piece = (id: string | undefined): string => pieceLabel(game, id, names, me);
  switch (a.cardType) {
    case 'scoutingDrone': {
      const st = a.stackIndex ?? 0;
      const drawn = game.stacks[st]?.pieces[a.pieceIndex ?? 0];
      // Named by stack and piece type (the piece's position in the stack means nothing to a player).
      return `${drawn ? `${BUILDING_NAME[drawn.type]} from stack ${st + 1}` : `A piece from stack ${st + 1}`} ${a.coord ? whereWords(game, a.coord) : 'somewhere'}${turned(a.rotation)}`;
    }
    case 'shortSale': return `Claim the ${piece(a.pieceId)} with module ${a.controlModule ?? '?'}`;
    case 'sinkHole': return `Remove the ${piece(a.pieceId)}`;
    case 'embezzlement': return a.pieceId ? `Take the ore from the ${piece(a.pieceId)}` : 'Play it';
    case 'rdTaxWriteOff': return `Free teleporter on the ${a.bufferType ?? 'input'} of the ${piece(a.pieceId)}`;
    case 'changingPriorities': return `Move module ${a.controlModule ?? '?'} from the ${piece(a.pieceId)} to the ${piece(a.toPieceId)}`;
    default: return 'Play it';
  }
}

function actionKey(a: Action): string {
  return JSON.stringify(a);
}

/**
 * The moves `seat` may make now, as labelled options in groups. A roll is offered as its own
 * option (the engine leaves dice to the caller; the host fills them in). Operate-or-skip
 * choices are left out: they are shown as the prompt (see `operatePrompt`).
 */
export function optionGroups(room: Room, seat: number | null): OptionGroup[] {
  const game = room.game;
  if (!game || seat === null || game.gameOver || room.hold || room.phase !== 'playing') return [];
  const names = room.seats.map(s => s.name);
  const actions: Action[] = legalActions(game, seat as PlayerId)
    .filter(a => a.type !== 'OPERATE_BUILDING' || game.phase === 'roundEnd')
    .filter(a => a.type !== 'SKIP_FACTORY_ROLL');
  if (game.pendingFactoryOps.some(e => e.ownerId === seat)) return [];
  if (game.phase === 'roll' && activeSeat(game) === seat && game.pendingFactoryOps.length === 0) {
    actions.unshift({ type: 'ROLL_DICE', rolls: [] });
  }
  const byGroup = new Map<GroupId, GameOption[]>();
  for (const a of actions) {
    const l = labelFor(game, a, names, seat);
    const list = byGroup.get(l.group) ?? [];
    list.push({ key: actionKey(a), label: l.label, action: a, ...(l.sub !== undefined ? { sub: l.sub } : {}) });
    byGroup.set(l.group, list);
  }
  const out: OptionGroup[] = [];
  for (const g of GROUPS) {
    const options = byGroup.get(g.id);
    if (!options || options.length === 0) continue;
    out.push({
      id: g.id, title: g.title, noun: options.length === 1 ? g.noun[0] : g.noun[1], options,
      collapsed: options.length > COLLAPSE_OVER && g.id !== 'end' && g.id !== 'roll',
    });
  }
  return out;
}

export interface OperatePrompt {
  seat: number;
  pieceId: string;
  label: string;
  cost: string;
  operate: Action;
  skip: Action;
}

/** Every operate-or-skip decision still owed, by any seat (so everyone sees who is deciding). */
export function operatePrompts(room: Room): OperatePrompt[] {
  const game = room.game;
  if (!game || room.phase !== 'playing') return [];
  const names = room.seats.map(s => s.name);
  return game.pendingFactoryOps.map(e => ({
    seat: e.ownerId,
    pieceId: e.pieceId,
    label: pieceLabel(game, e.pieceId, names, null),
    cost: operateCost(game, e.pieceId),
    operate: { type: 'OPERATE_BUILDING', pieceId: e.pieceId, ownerId: e.ownerId },
    skip: { type: 'SKIP_FACTORY_ROLL', pieceId: e.pieceId, ownerId: e.ownerId },
  }));
}

export interface Standing { seat: number; won: boolean; tesseracts: number; points: number }

/** Final order: winners first; a Tesseract win ranks by Tesseracts, a points win by points. */
export function finalStandings(room: Room): Standing[] {
  const g = room.game;
  if (!g) return [];
  return room.seats.map((s): Standing => ({
    seat: s.index,
    won: g.winner === s.index || g.tiedWinners.includes(s.index as PlayerId),
    tesseracts: tesseractCount(g, s.index as PlayerId),
    points: g.players[s.index] ? resourcePoints(g.players[s.index]!) : 0,
  })).sort((a, b) => {
    if (a.won !== b.won) return a.won ? -1 : 1;
    return g.gameOverReason === 'tesseracts'
      ? b.tesseracts - a.tesseracts || b.points - a.points
      : b.points - a.points || b.tesseracts - a.tesseracts;
  });
}

/** "Bea wins with 4 Tesseracts." and the like. */
export function gameOverWords(room: Room): string {
  const g = room.game;
  if (!g || !g.gameOver) return '';
  const name = (i: number): string => room.seats[i]?.name || `Seat ${i + 1}`;
  const how = g.gameOverReason === 'tesseracts' ? 'with 4 Tesseracts' : g.gameOverReason === 'boardExhausted'
    ? 'on points (the board pieces ran out)' : '';
  if (g.winner !== null) return `${name(g.winner)} wins ${how}.`.replace(' .', '.');
  if (g.tiedWinners.length > 0) return `${g.tiedWinners.map(name).join(' and ')} share the win ${how}.`.replace(' .', '.');
  return 'The game is over.';
}

// ── Refused moves, in the rulebook's words ─────────────────────────────────────────

/**
 * A sentence for every refusal code: the engine's rule errors (RulesError.code) and the
 * session's own (SessionErrorCode in session/protocol.ts). The engine's messages name internal
 * things ("Expected placePiece phase, got roll"), so they are never shown; these are.
 */
export const REFUSAL_TEXT: Readonly<Record<string, string>> = {
  // Engine: whose turn and which step
  WRONG_PHASE: 'That is not allowed at this step of the turn.',
  GAME_OVER: 'The game is over.',
  PENDING_FACTORY_OPS: 'Every activated factory must be run or skipped first.',
  DECISION_PENDING: 'First choose whether to run or skip your activated factory.',
  NOT_PENDING: 'That building was not activated by this roll.',
  OVERSTOCK_PENDING: 'Place the Overstock Supplies pieces first.',
  PENDING_MINE: 'Place the dropped Mine first.',
  PENDING_MINE_UNPLACED: 'Place the dropped Mine before buying another.',
  // Engine: dice
  INVALID_ROLL: 'Each die must show 1 to 6.',
  WRONG_DICE_COUNT: 'Roll one die for each Mine on the board.',
  // Engine: board pieces and Mines
  COORD_OCCUPIED: 'That space is already taken.',
  NOT_ADJACENT: 'It must be placed next to a piece already on the board.',
  STACK_EMPTY: 'That stack is empty.',
  STACK_LOCKED: 'That stack is still covered by its Mine.',
  INVALID_STACK: 'There is no such stack.',
  MUST_DRAW: 'More than one stack is open: draw from one of them first.',
  ALREADY_DRAWN: 'You have already drawn a piece this turn. Place it first.',
  NOT_DRAWN_STACK: 'Place the piece you drew, from the stack you drew it from.',
  NO_DRAW_NEEDED: 'Only one stack is open, so there is nothing to choose: place its top piece.',
  INVALID_PIECE_INDEX: 'There is no such piece in that stack.',
  PIECE_NOT_FOUND: 'That piece is not on the board.',
  WRONG_PIECE_TYPE: 'That is the wrong kind of piece for this.',
  PIECE_CLAIMED: 'A claimed building cannot be removed.',
  CANNOT_SINK_MINE: 'A Mine cannot be removed.',
  NO_MINES_AVAILABLE: 'All the Mines are already in play.',
  NO_PENDING_MINE: 'No Mine is waiting to be placed.',
  NO_OVERSTOCK: 'There is no Overstock Supplies piece to place.',
  INVALID_ROTATION: 'A piece can only be turned to one of its six sides.',
  // Engine: Control Modules
  ALREADY_CLAIMED: 'That building is already claimed by another player.',
  NOT_CLAIMABLE: 'Only factories and Power Plants can be claimed.',
  TOO_MANY_CLAIMS: 'You already have 3 Control Modules on that building.',
  MODULE_NOT_AVAILABLE: 'That Control Module is not in your supply.',
  NO_VALID_MODULE: 'You have no Control Module high enough for that.',
  CLAIM_FLOOR_VIOLATION: 'That Control Module is too low: it must be at least the number of Mines on the board.',
  CLAIM_NOT_FOUND: 'You do not have that Control Module on that building.',
  MUST_UPGRADE: 'The new Control Module must be higher than the old one.',
  UNFUNDED_UPGRADE: 'You cannot pay for that upgrade.',
  FREE_CLAIM_USED: 'You have already used the free claim from the Mine this round.',
  INSUFFICIENT_CREDITS: 'You do not have enough Mine credits for that.',
  INSUFFICIENT_FREE_UPGRADES: 'You do not have enough free upgrades left.',
  WRONG_FREE_UPGRADE_TARGET: 'Your free upgrades this round belong to another building.',
  INSUFFICIENT_PI_BUDGET: 'Production Increase does not have enough upgrades left for that.',
  PI_CLAIM_USED: 'Production Increase allows only one claim per turn.',
  UNFUNDED_CLAIM: 'A claim must be paid with the Mine\'s free claim or with Production Increase.',
  SAME_BUILDING: 'Move the Control Module to a different building.',
  MEEPLE_ON_BUILDING: 'Your meeple stands on that building, so your last Control Module there must stay.',
  // Engine: buildings, materials and Power Tokens
  CANNOT_AFFORD: 'You cannot afford that.',
  INSUFFICIENT_MATERIAL: 'You do not have that material.',
  CANNOT_EXCHANGE: 'Ore cannot be broken down any further.',
  CANNOT_OPERATE: 'That building cannot run: it needs a full recipe in its input, an empty output and enough Power Tokens.',
  INVALID_RECIPE: 'That material does not fit any recipe of this building.',
  INPUT_FULL: 'That building\'s input is already full.',
  NOTHING_TO_COLLECT: 'There is nothing to collect there, or you hold the most of that material you may.',
  NO_INPUT: 'That building has no input.',
  NO_OUTPUT: 'That building has no output.',
  NO_BUFFER: 'That piece has no buffer there.',
  NO_INPUT_TELEPORTER: 'Materials go into a building from your inventory only through your own teleporter on its input.',
  INVALID_SUPPLY: 'Supply one material from your inventory for each empty input slot.',
  MUST_RUN: 'A Power Plant always runs. Choose what to supply to it, or supply nothing.',
  ALREADY_OPERATED: 'At round end you may run the building with your meeple only once.',
  INVALID_TARGET: 'You can only do that with the building your meeple is on.',
  // Engine: meeple
  INVALID_MEEPLE_TARGET: 'Your meeple can go only on one of your buildings or on a Mine.',
  MINE_SLOT_OCCUPIED: 'Another meeple is already on that spot of the Mine.',
  MEEPLE_ALREADY_PLACED: 'Your meeple is already placed this turn.',
  MEEPLE_REQUIRED: 'Place your meeple before ending your turn.',
  // Engine: belts and teleporters
  NO_BELTS: 'You have no belts left.',
  BELT_NOT_FOUND: 'That belt is no longer on the board.',
  NOT_YOUR_BELT: 'You can pick up only your own belts.',
  NOTHING_TO_UNDO: 'You have placed no belts this turn.',
  INVALID_POINT: 'That is not a connection point on this piece.',
  NOT_A_BELT_POINT: 'A belt cannot connect there.',
  SAME_POINT: 'A belt needs two different connection points.',
  POINTS_TOO_CLOSE: 'The two ends of a belt must be more than 2 holes apart.',
  POINT_OCCUPIED: 'A belt already uses that connection point.',
  BELT_BLOCKED: 'A belt may not join another player\'s belt.',
  POINT_RESERVED: 'That connection point is reserved for the owner of the building next to it.',
  MINE_BELT_LIMIT: 'Only one belt touching a Mine\'s ore exit may be placed per turn.',
  NO_TELEPORTERS: 'You have no teleporters left.',
  TELEPORTER_EXISTS: 'There is already a teleporter there.',
  BUFFER_OCCUPIED: 'That buffer already has a teleporter.',
  NOT_OWNER: 'You must own that building.',
  NOT_YOUR_BUILDING: 'You need a Control Module on that building.',
  // Engine: Leverage cards
  DECK_EMPTY: 'No Leverage cards are left: the deck and the discard pile are both empty.',
  CARD_NOT_IN_HAND: 'That Leverage card is not in your hand.',
  CARD_LIMIT_REACHED: 'You may play only 2 Leverage cards per turn.',
  PLAY_ON_DRAW: 'That Leverage card is played when it is drawn, not from your hand.',
  UNKNOWN_CARD: 'That is not a Leverage card of this game.',
  MISSING_PARAMS: 'That Leverage card needs a choice first.',
  // Engine and host: something unexpected
  INTERNAL: 'Something went wrong, and nothing changed. Please try again.',
  // Session: the host's own refusals
  BAD_MESSAGE: 'The host did not understand that. Reload the page to update the game.',
  HELLO_FIRST: 'Not connected to the game yet.',
  NOT_HOST: 'Only the host can do that.',
  NOT_IN_LOBBY: 'That can only be changed before the game starts.',
  NOT_PLAYING: 'No game is in progress.',
  ON_HOLD: 'The game is paused until the host continues it.',
  NO_SEAT: 'You do not have a seat in this game.',
  NOT_YOUR_TURN: 'It is not your turn.',
  BAD_SETTINGS: 'Those settings are not allowed.',
  BAD_SEAT: 'That seat cannot be changed that way.',
  SEAT_OCCUPIED: 'A player is sitting in that seat.',
  COLOR_TAKEN: 'Another player already uses that colour.',
  SEATS_OPEN: 'Every seat needs a player or a bot.',
  NOT_READY: 'Every player must be ready.',
  NOT_WAITING: 'That person is no longer waiting.',
  SEATS_ABSENT: 'A player is not connected. Wait for them, or open their seat or give it to a bot.',
  SEAT_REQUIRED: 'Choose which player you are.',
  STALE: 'The game moved on, so that move was not made.',
  BAD_ACTION: 'That move could not be read.',
  NOT_LISTED: 'That move is not available right now.',
  BUSY: 'Still waiting for the host to confirm your last move.',
  CLOSED: 'Not connected to the game.',
};

/** Shown for a refusal code this build does not know. */
export const REFUSAL_FALLBACK = 'That move is not allowed right now.';

/** A refused move or command in the rulebook's words. Never contains the raw message. */
export function refusalText(error: { code: string; message?: string }): string {
  return Object.prototype.hasOwnProperty.call(REFUSAL_TEXT, error.code) ? REFUSAL_TEXT[error.code]! : REFUSAL_FALLBACK;
}
