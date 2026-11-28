// Leverage cards: buying and playing, and one entry per card. CARD_GUIDE is keyed by the
// engine's card types, so a card added to the engine without an entry here fails to compile
// (and the content test checks there is no entry for a card that does not exist).

import type { CardType } from '../../../engine/config';
import {
  CARD_COUNTS, INVENTORY_CAP, MAX_CARDS_PLAYED_PER_TURN, MAX_CLAIMS_PER_BUILDING, PLAY_ON_DRAW_CARDS,
  POWER_TOKEN_CAP, PRODUCTION_INCREASE_BUDGET, TELEPORTER_COUNT,
} from '../../../engine/config';
import type { Block, Topic } from '../types';
import { CARD_NAME, CARD_TYPES, cardPriceWords, deckSize, listWords } from './facts';
import { cardFigure } from './figures';

export interface CardGuide {
  /** One line for the overview table. */
  readonly short: string;
  /** What it does and how you play it here. */
  readonly blocks: readonly Block[];
  /** Nuances and exceptions, under "How exactly does this work?". */
  readonly details?: readonly Block[];
}

const p = (t: string): Block => ({ k: 'p', t });

export const CARD_GUIDE: Record<CardType, CardGuide> = {
  scoutingDrone: {
    short: 'Pick any piece from the open stacks and place it now.',
    blocks: [
      p('Look through the open stacks and choose any kind of piece in them. Place it next to the board at once, like a normal piece: any free space touching the board, turned any way you like.'),
      p('Play it from your hand, choose the piece from the list, then tap where it goes and confirm.'),
    ],
    details: [
      p('This piece comes on top of your normal piece for the turn.'),
      p('If taking the piece empties a stack, the next Mine drops into play. See [[mines|Mines]].'),
    ],
  },
  shortSale: {
    short: 'Claim a building with your lowest usable Control Module, for free.',
    blocks: [
      p('Claim a building for free. The game uses the lowest Control Module in your tray that is not below the number of Mines; you choose the building.'),
      p('Play it from your hand, tap the building and confirm.'),
    ],
    details: [
      p('If your low modules are already on the board, your lowest one may be quite high — which can be useful.'),
      p(`It can add a claim to a building you already own, up to ${MAX_CLAIMS_PER_BUILDING} of your modules there.`),
      p('It cannot claim a building another player has claimed: only an unclaimed building, or one you already hold a claim on, glows. A building has one owner.'),
    ],
  },
  embezzlement: {
    short: 'Take 1 Sphere from the bank.',
    blocks: [p('Take 1 Sphere from the bank.')],
    details: [
      p('Always a Sphere, however many Mines there are. (The printed card gave a Tesseract with three Mines.)'),
      p(`If you already hold ${INVENTORY_CAP} Spheres, it is lost.`),
    ],
  },
  sinkHole: {
    short: 'Remove a piece nobody has claimed.',
    blocks: [
      p('Remove a board piece that nobody has claimed: a blank tile or an unclaimed building, never a Mine. Belts lying on it go back to the bank: their owners do not get them back and must buy belts again — even a belt laid this turn.'),
      p('Play it from your hand, tap the piece and confirm.'),
    ],
    details: [
      p('The piece is gone for good; it does not go back into a stack.'),
      p('Belts on neighbouring pieces that pointed into it stay where they are, but lead nowhere until another piece fills the gap.'),
    ],
  },
  overstockSupplies: {
    short: 'Played when drawn: place 3 more pieces.',
    blocks: [
      p('Played as soon as it is drawn. You get the top 3 pieces of the lowest-numbered open stack and place each one next to the board like a normal piece.'),
      p('Place all of them before **Done with actions**.'),
    ],
    details: [
      p('If the stack runs out while the pieces are drawn, the next Mine drops, its stack opens, and the drawing carries on from there.'),
      p('If fewer than 3 pieces are left in the stacks, you place what there is.'),
    ],
  },
  netSurplusSellOff: {
    short: 'Each other player gives you 3 Power Tokens.',
    blocks: [
      p(`Each other player gives you 3 Power Tokens, or all they have if they hold fewer, starting with the next player in turn order. It stops as soon as you reach ${POWER_TOKEN_CAP}.`),
    ],
    details: [p(`Once you have ${POWER_TOKEN_CAP}, the remaining players keep their tokens.`)],
  },
  changingPriorities: {
    short: 'Move one of your Control Modules to another building.',
    blocks: [
      p(`Move one of your Control Modules from one building to another. The receiving building can hold up to ${MAX_CLAIMS_PER_BUILDING} of your modules.`),
      p('If the building you took it from has no Control Module left, it has no owner: every material in its inputs and output goes to the bank, your teleporters on it come back to you, and anyone can claim it later. Before you confirm, the game says what you would lose.'),
      p('Play it from your hand, tap the building to take the module from, then the building to move it to, choose the module, and confirm.'),
    ],
    details: [
      p('The module must not be below the number of Mines, and it must go to a different building.'),
      p('Keep a second module of yours on the building and nothing is lost: its material and teleporters stay. See [[teleporters|Teleporters]].'),
      p('The receiving building can be one of yours or an unclaimed one (which you claim this way), never one another player has claimed.'),
      p('You cannot move your last Control Module off the building your meeple stands on this turn: your meeple may stand only on a building of yours.'),
    ],
  },
  productionIncrease: {
    short: `Spend ${PRODUCTION_INCREASE_BUDGET} upgrades this turn on claims and upgrades.`,
    blocks: [
      p(`You get ${PRODUCTION_INCREASE_BUDGET} upgrades to spend in this turn, in any of its steps, on claims and upgrades, at the normal costs (see [[claiming|Claiming and upgrading]]). At most one of them may be a claim.`),
      p('After playing it, tap a glowing building to claim or upgrade it. **Done with Production Increase** puts it aside; **Spend Production Increase** (under Upgrades in your area) brings it back while upgrades are left.'),
    ],
    details: [
      p('Upgrades left when your turn ends are lost.'),
      p(`A second Production Increase in the same turn sets your remaining upgrades back to ${PRODUCTION_INCREASE_BUDGET} (it does not add to them), and allows one more claim.`),
      { k: 'note', tone: 'example', t: 'With 2 Mines: claim a building with module 4 (4 − 2 + 1 = 3 upgrades), then upgrade another module by 1.' },
    ],
  },
  mineInspection: {
    short: 'Played when drawn: 1 Plate per Mine.',
    blocks: [p('Played as soon as it is drawn: take 1 Plate from the bank for each Mine on the board.')],
    details: [p(`Plates above your limit of ${INVENTORY_CAP} are lost.`)],
  },
  personalJetPack: {
    short: 'Collect the output of every factory you own.',
    blocks: [p('Collect whatever sits in the output of every factory you own into your materials, wherever your meeple is.')],
    details: [p(`Your limit of ${INVENTORY_CAP} per material still holds; what does not fit stays in its output.`)],
  },
  assetForfeiture: {
    short: 'Take every Plate from every output on the board.',
    blocks: [p(`Take every Plate sitting in any output on the board, yours and everyone else's. You keep up to your limit of ${INVENTORY_CAP}; the rest goes back to the bank.`)],
  },
  rdTaxWriteOff: {
    short: 'Place a teleporter for free.',
    blocks: [
      p('Place a teleporter on one input or the output of one of your buildings, for free. On a Sphere or Tesseract Factory you choose which input.'),
      p('Play it from your hand, tap the buffer and confirm.'),
    ],
    details: [p(`It uses one of your ${TELEPORTER_COUNT} teleporters and raises the teleporter price for everyone, like a bought one.`)],
  },
  solarFlare: {
    short: 'Played when drawn: every player gets 2 Power Tokens.',
    blocks: [p(`Played as soon as it is drawn: every player, you included, gets 2 Power Tokens (up to ${POWER_TOKEN_CAP}).`)],
  },
};

const onDraw = CARD_TYPES.filter(c => PLAY_ON_DRAW_CARDS.has(c));

function cardBlocks(): Block[] {
  const out: Block[] = [];
  for (const c of CARD_TYPES) {
    const g = CARD_GUIDE[c];
    const tags = [`${CARD_COUNTS[c]} in the deck`, ...(PLAY_ON_DRAW_CARDS.has(c) ? ['played as soon as it is drawn'] : [])];
    out.push({ k: 'h', t: CARD_NAME[c], id: c });
    out.push({ k: 'p', t: `**${tags.join(' · ')}**` });
    out.push(cardFigure(c));
    out.push(...g.blocks);
    if (g.details?.length) out.push({ k: 'details', blocks: g.details });
  }
  return out;
}

export const cards: Topic = {
  id: 'cards',
  title: 'Leverage cards',
  summary: `Buying and playing them, and what each of the ${CARD_TYPES.length} cards does.`,
  blocks: [
    { k: 'p', t: `Buy Leverage cards from the bank in your actions step, for the number of Mines + 1 (${cardPriceWords()}). You get the top card of the deck without seeing it first. Buy as many as you can pay for.` },
    { k: 'p', t: `Play cards from your hand in any of the four steps of your own turn — before you place your piece, before or after you roll, in your actions, and before or after your meeple is down: tap a card to read it and press **Play**, then choose what it acts on if it asks, and confirm. The step then carries on where you left it. You can play **${MAX_CARDS_PLAYED_PER_TURN} cards per turn**; your area shows how many you have played this turn ("Leverage cards played 1 / ${MAX_CARDS_PLAYED_PER_TURN}"). Cards are never played in another player's turn or in a round-end turn.` },
    {
      k: 'details', blocks: [
        p('Scouting Drone can be played in step 1 only before you draw from a stack: once you have drawn, the drawn piece must be placed first. In the other steps it can be played as usual.'),
        p('If a card in step 1 empties a stack, the next Mine drops and takes the place of your piece; if it takes the last piece of all, there is nothing left to place and your turn goes on to the roll.'),
        p('Once your meeple is down, your turn does not end by itself while you could still play a card: press **End turn** when you are done.'),
      ],
    },
    { k: 'p', t: `${listWords(onDraw.map(c => `**${CARD_NAME[c]}**`))} are **played as soon as they are drawn** and never go to your hand. Each uses up one of your ${MAX_CARDS_PLAYED_PER_TURN} plays for the turn if you have one left; if you have already played ${MAX_CARDS_PLAYED_PER_TURN}, it still takes effect. Buying is never blocked.` },
    { k: 'p', t: `Played cards go to the discard pile. The deck holds ${deckSize()} cards. When you buy a card and the deck is empty, the discard pile is shuffled into a new deck first (the table says so). Cards run out only when the deck and the discard pile are both empty. The bank's Leverage card shows how many are in each.` },
    {
      k: 'table', head: ['Card', 'Copies', 'In short'],
      rows: CARD_TYPES.map(c => [`[[cards#${c}|${CARD_NAME[c]}]]`, String(CARD_COUNTS[c]), CARD_GUIDE[c].short]),
    },
    ...cardBlocks(),
  ],
  see: ['claiming', 'teleporters', 'mines'],
};
