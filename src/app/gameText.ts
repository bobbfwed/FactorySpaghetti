// Plain-words text for the text view of a game: the step in rulebook words, readable labels for
// every legal move, and moves grouped by kind. No DOM, so it is tested in Vitest.

import type { Action } from '../engine/actions';
import type { BoardPiece, GameState, PlayerId } from '../engine/state';
import type { Material } from '../engine/config';
import { BELT_COST, FACTORY_POWER_COST, FACTORY_RECIPES, MINE_COSTS, cardCost } from '../engine/config';
import { legalActions } from '../engine';
import { resourcePoints, tesseractCount } from '../engine/rules/scoring';
import { BUILDING_NAME, CARD_NAME, MATERIAL_NAME } from '../session/describe';
import type { Room } from '../session/room';
import { activeSeat } from '../session/room';

/** The current step, worded as in the rulebook. */
export function phaseWords(game: GameState): string {
  switch (game.phase) {
    case 'setupClaimPF': return 'Setup: claim a Plate Factory';
    case 'setupClaimPP': return 'Setup: claim a Power Plant';
    case 'placePiece': return game.pendingMineIds.length > 0 ? 'Step 1: place the dropped Mine' : 'Step 1: place a board piece';
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

const cell = (c: { q: number; r: number }): string => `${c.q},${c.r}`;
const turned = (r: number | undefined): string => (r ? ` · turned ${r}` : '');

/** "Plate Factory at 1,-1 (yours, module 3)". */
export function pieceLabel(game: GameState, pieceId: string | undefined, names: readonly string[], me: number | null): string {
  const p = pieceId === undefined ? undefined : game.board.find(x => x.id === pieceId);
  if (!p) return 'a piece';
  return `${BUILDING_NAME[p.type]} at ${cell(p.coord)}${ownerNote(p, names, me)}`;
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
    case 'PLACE_PIECE':
      return { group: 'place', sub: `From stack ${a.stackIndex + 1}`, label: `Cell ${cell(a.coord)}${turned(a.rotation)}` };
    case 'PLACE_MINE':
      return { group: 'place', sub: 'The dropped Mine', label: `Cell ${cell(a.coord)}${turned(a.rotation)}` };
    case 'PLACE_OVERSTOCK_PIECE': {
      const next = game.overstockPieces[0];
      return { group: 'place', sub: `Overstock piece${next ? `: ${BUILDING_NAME[next.type]}` : ''}`, label: `Cell ${cell(a.coord)}${turned(a.rotation)}` };
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
        return { group: 'meeple', label: `Mine at ${cell(p.coord)}: ${slot}` };
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
      return { group: 'buy', sub: `Buy a Mine (${cost} ore value)`, label: `Cell ${cell(a.coord)}${turned(a.rotation)}` };
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
      return `Stack ${st + 1}, piece ${(a.pieceIndex ?? 0) + 1}${drawn ? ` (${BUILDING_NAME[drawn.type]})` : ''} to cell ${a.coord ? cell(a.coord) : '?'}${turned(a.rotation)}`;
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
