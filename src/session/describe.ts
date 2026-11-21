// Human-readable log lines for moves, in rulebook words.

import type { Action } from '../engine/actions';
import type { GameState } from '../engine/state';
import type { CardType, Material, PieceType } from '../engine/config';
import { PLAY_ON_DRAW_CARDS } from '../engine/config';
import { whereWords } from './where';

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

function article(name: string): string {
  return /^[AEIOU]/i.test(name) ? `an ${name}` : `a ${name}`;
}

/** What `name` did, written against the state before the move. */
export function describeAction(before: GameState, action: Action, name: string): string {
  return `${name} ${describeVerb(before, action)}`;
}

function describeVerb(s: GameState, a: Action): string {
  switch (a.type) {
    case 'SETUP_CLAIM': {
      const module = s.phase === 'setupClaimPF' ? 3 : 2;
      return `claimed ${pieceName(s, a.pieceId)} with Control Module ${module}`;
    }
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
    case 'CLAIM_BUILDING': return `claimed ${pieceName(s, a.pieceId)} with Control Module ${a.controlModule}`;
    case 'UPGRADE_BUILDING':
      return `upgraded the Control Module on ${pieceName(s, a.pieceId)} from ${a.oldModule} to ${a.newModule}`;
    case 'BUY_MINE': return `bought a Mine and placed it ${whereWords(s, a.coord)}`;
    case 'PLACE_MINE': return `placed the dropped Mine ${whereWords(s, a.coord)}`;
    case 'BUY_CARD': {
      const card = s.cardDeck[0];
      return card && PLAY_ON_DRAW_CARDS.has(card)
        ? `bought ${CARD_NAME[card]}, which is played at once`
        : 'bought a Leverage card';
    }
    case 'PLAY_CARD': return `played ${CARD_NAME[a.cardType]}`;
    case 'PLACE_OVERSTOCK_PIECE': return 'placed an Overstock Supplies piece';
    case 'BUY_BELT': return 'bought a belt';
    case 'LOAD_BUILDING_INPUT': return `loaded 1 ${MATERIAL_NAME[a.material]} into ${pieceName(s, a.pieceId)}`;
    case 'OPERATE_BUILDING': return `ran ${pieceName(s, a.pieceId)}`;
    case 'COLLECT_OUTPUT': return `collected the output of ${pieceName(s, a.pieceId)}`;
    case 'SKIP_FACTORY_ROLL': return `chose not to run ${pieceName(s, a.pieceId)}`;
    case 'EXCHANGE_MATERIALS': return `broke 1 ${MATERIAL_NAME[a.give]} down into smaller materials`;
  }
}
