// Human-readable log lines for moves, in rulebook words.

import type { Action } from '../engine/actions';
import type { GameState } from '../engine/state';
import type { CardType, Material, PieceType } from '../engine/config';
import { PLAY_ON_DRAW_CARDS } from '../engine/config';
import { nextCardDrawn } from '../engine/rules/cards';
import { applyAction } from '../engine';
import { whereWords } from './where';
import { roundLabel } from './rounds';

export const BUILDING_NAME: Record<PieceType, string> = {
  mine: 'Mine',
  plateFact: 'Plate Factory',
  sphereFact: 'Sphere Factory',
  tesseractFact: 'Tesseract Factory',
  powerPlant: 'Power Plant',
  blank: 'blank tile',
};

export const MATERIAL_NAME: Record<Material, string> = {
  ore: 'Ore',
  plate: 'Plate',
  sphere: 'Sphere',
  tesseract: 'Tesseract',
};

export const CARD_NAME: Record<CardType, string> = {
  scoutingDrone: 'Scouting Drone',
  shortSale: 'Short Sale',
  embezzlement: 'Embezzlement',
  sinkHole: 'Sink Hole',
  overstockSupplies: 'Overstock Supplies',
  netSurplusSellOff: 'Net Surplus Sell-Off',
  changingPriorities: 'Changing Priorities',
  productionIncrease: 'Production Increase',
  mineInspection: 'Mine Inspection',
  personalJetPack: 'Personal Jet Pack',
  assetForfeiture: 'Asset Forfeiture',
  rdTaxWriteOff: 'R&D Tax Write-Off',
  solarFlare: 'Solar Flare',
};

/** "the Plate Factory", with where it is when there are several of that kind on the board. */
function pieceName(state: GameState, pieceId: string | undefined): string {
  const piece = pieceId === undefined ? undefined : state.board.find(p => p.id === pieceId);
  if (!piece) return 'a piece';
  if (piece.id === 'mine-1') return 'the first Mine';
  const alike = state.board.filter(p => p.type === piece.type).length;
  return alike > 1 ? `the ${BUILDING_NAME[piece.type]} ${whereWords(state, piece.coord)}` : `the ${BUILDING_NAME[piece.type]}`;
}

/** "the second stack": stacks in rulebook words, by index. */
export const STACK_ORDINAL: Readonly<Record<0 | 1 | 2, string>> = { 0: 'first', 1: 'second', 2: 'third' };

function article(name: string): string {
  return /^[AEIOU]/i.test(name) ? `an ${name}` : `a ${name}`;
}

const count = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/** "the first Mine", "the second Mine": a Mine by its printed number (mine-1, mine-2, mine-3). */
function mineOrdinal(state: GameState, mineId: string | null): string {
  const mines = state.board.filter(p => p.type === 'mine');
  const idx = mines.findIndex(m => m.id === mineId);
  if (idx < 0) return 'a Mine';
  const printed = /^mine-(\d+)$/.exec(mineId!);
  const n = printed ? Number(printed[1]) : idx + 1;
  return n >= 1 && n <= 3 ? `the ${STACK_ORDINAL[(n - 1) as 0 | 1 | 2]} Mine` : `Mine ${n}`;
}

/** Who makes a claim, upgrade or card play: the active player. */
function activeOf(s: GameState): GameState['players'][number] | undefined {
  const id = s.turnOrder[s.activePlayerIndex];
  return id === undefined ? undefined : s.players[id];
}

/**
 * What paid for a claim or an upgrade, read from the engine's own bookkeeping before and after
 * the move (never from the move's flags alone): the Mine credits from a meeple on a Mine's
 * upgrade point, the Production Increase upgrades of this turn, or the free end-of-round
 * upgrades. Null when none of them went down (nothing to say).
 */
function paidWith(before: GameState, after: GameState): string | null {
  const b = activeOf(before);
  const a = b ? after.players[b.id] : undefined;
  if (!b || !a) return null;
  const mine = b.freeActionCredits - a.freeActionCredits;
  if (mine > 0) return `using ${count(mine, 'Mine credit', 'Mine credits')} from their meeple on ${mineOrdinal(before, b.meepleOnPieceId)}`;
  const pi = before.productionIncreaseBudget - after.productionIncreaseBudget;
  if (pi > 0) return `using ${count(pi, 'upgrade', 'upgrades')} from Production Increase`;
  const free = b.freeUpgradesRemaining - a.freeUpgradesRemaining;
  if (free > 0) return `using ${count(free, 'free end-of-round upgrade', 'free end-of-round upgrades')}`;
  return null;
}

/** The state after `action`, or null when the engine refuses it (a refused move has no payment). */
function stateAfter(before: GameState, action: Action, after: GameState | null | undefined): GameState | null {
  if (after) return after;
  try {
    const res = applyAction(before, action);
    return res.ok ? res.state : null;
  } catch {
    return null;
  }
}

/**
 * What `name` did, written against the state before the move. `after` (the state the move led
 * to) is used to say what paid for a claim or an upgrade; when it is not given, it is worked out
 * with the engine, and a move the engine refuses is described without it.
 */
export function describeAction(before: GameState, action: Action, name: string, after?: GameState | null): string {
  return `${name} ${describeVerb(before, action, after)}`;
}

/**
 * The lines a move adds to the log about the round itself: the round is over and the round-end
 * turns begin, or a new round begins (also round 1, after the setup claims). The round-end turns
 * belong to the round that has just been played: the engine counts the next round from the start
 * of the round-end turns, so the round that ended is the one before the move.
 */
export function roundLines(before: GameState, after: GameState): string[] {
  if (after.gameOver) return [];
  if (before.phase !== 'roundEnd' && after.phase === 'roundEnd') {
    return [`${roundLabel(after)}: the round-end turns begin.`];
  }
  const between = (p: GameState['phase']): boolean => p === 'roundEnd' || p === 'setupClaimPF' || p === 'setupClaimPP';
  if (between(before.phase) && !between(after.phase)) return [`${roundLabel(after)} begins.`];
  return [];
}

function describeVerb(s: GameState, a: Action, after: GameState | null | undefined): string {
  switch (a.type) {
    case 'SETUP_CLAIM': {
      const module = s.phase === 'setupClaimPF' ? 3 : 2;
      return `claimed ${pieceName(s, a.pieceId)} with Control Module ${module}, a free starting claim`;
    }
    case 'DRAW_PIECE':
      return `drew from the ${STACK_ORDINAL[a.stackIndex]} stack`;
    case 'PLACE_PIECE': {
      const top = s.stacks[a.stackIndex]?.pieces[0];
      const what = top ? article(BUILDING_NAME[top.type]) : 'a piece';
      return `placed ${what} from stack ${a.stackIndex + 1}, ${whereWords(s, a.coord)}`;
    }
    case 'ROLL_DICE': {
      const total = a.rolls.reduce((x, y) => x + y, 0);
      return a.rolls.length === 1 ? `rolled ${total}` : `rolled ${a.rolls.join(' + ')} = ${total}`;
    }
    case 'END_ACTIONS':
      return s.phase === 'roundEnd' ? 'ended their round-end turn' : 'finished their actions';
    case 'PLACE_MEEPLE': {
      const piece = s.board.find(p => p.id === a.pieceId);
      if (piece?.type === 'mine') {
        return `placed their meeple on ${pieceName(s, a.pieceId)} (${a.slotIndex === 1 ? 'upgrade point' : 'resource point'})`;
      }
      return `placed their meeple on ${pieceName(s, a.pieceId)}`;
    }
    case 'END_TURN': return 'ended their turn';
    case 'PLACE_BELT': return `placed a belt on ${pieceName(s, a.pieceId)}`;
    case 'REMOVE_BELT': return 'picked up a belt';
    case 'UNDO_BELTS': return 'took back the belts placed this turn';
    case 'PLACE_TELEPORTER': return `placed a teleporter on the ${a.bufferType} of ${pieceName(s, a.pieceId)}`;
    case 'CLAIM_BUILDING': {
      const next = stateAfter(s, a, after);
      const paid = next ? paidWith(s, next) : null;
      return `claimed ${pieceName(s, a.pieceId)} with Control Module ${a.controlModule}${paid ? `, ${paid}` : ''}`;
    }
    case 'UPGRADE_BUILDING': {
      const next = stateAfter(s, a, after);
      const paid = next ? paidWith(s, next) : null;
      return `upgraded the Control Module on ${pieceName(s, a.pieceId)} from ${a.oldModule} to ${a.newModule}${paid ? `, ${paid}` : ''}`;
    }
    case 'BUY_MINE': return `bought a Mine and placed it ${whereWords(s, a.coord)}`;
    case 'PLACE_MINE': return `placed the dropped Mine ${whereWords(s, a.coord)}`;
    case 'BUY_CARD': {
      const card = nextCardDrawn(s);
      const reshuffled = s.cardDeck.length === 0 && s.cardDiscard.length > 0 ? 'shuffled the discard pile into a new deck and ' : '';
      return card && PLAY_ON_DRAW_CARDS.has(card)
        ? `${reshuffled}bought ${CARD_NAME[card]}, which is played at once`
        : `${reshuffled}bought a Leverage card`;
    }
    case 'PLAY_CARD': {
      const played = `played ${CARD_NAME[a.cardType]}`;
      if (a.cardType === 'shortSale') {
        // The card is the payment: it claims with the player's lowest Control Module allowed.
        const next = stateAfter(s, a, after);
        const me = activeOf(s);
        const claims = next?.board.find(p => p.id === a.pieceId)?.claims ?? [];
        const added = claims[claims.length - 1];
        return added && me && added.ownerId === me.id
          ? `${played}, claiming ${pieceName(s, a.pieceId)} with Control Module ${added.controlModule}`
          : played;
      }
      if (a.cardType === 'changingPriorities' && a.toPieceId !== undefined && a.controlModule !== undefined) {
        return `${played}, moving Control Module ${a.controlModule} to ${pieceName(s, a.toPieceId)}`;
      }
      return played;
    }
    case 'PLACE_OVERSTOCK_PIECE': return 'placed an Overstock Supplies piece';
    case 'BUY_BELT': return 'bought a belt';
    case 'LOAD_BUILDING_INPUT': return `loaded 1 ${MATERIAL_NAME[a.material]} into ${pieceName(s, a.pieceId)}`;
    case 'OPERATE_BUILDING': {
      const supply = a.supply ?? [];
      if (supply.length === 0) return `ran ${pieceName(s, a.pieceId)}`;
      const counts = new Map<Material, number>();
      for (const m of supply) counts.set(m, (counts.get(m) ?? 0) + 1);
      const words = [...counts].map(([m, n]) => `${n} ${MATERIAL_NAME[m]}`);
      const list = words.length > 1 ? `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]!}` : words[0]!;
      return `ran ${pieceName(s, a.pieceId)}, supplying ${list} through its teleporter`;
    }
    case 'COLLECT_OUTPUT': return `collected the output of ${pieceName(s, a.pieceId)}`;
    case 'SKIP_FACTORY_ROLL': return `chose not to run ${pieceName(s, a.pieceId)}`;
    case 'EXCHANGE_MATERIALS': return `broke 1 ${MATERIAL_NAME[a.give]} down into smaller materials`;
  }
}
