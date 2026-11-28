// "What changed": a change log of the RULES by rules version, newest first. The oldest section
// compares the rules with the printed rulebook. It lists only differences in how the game is
// played: changes of the digital version (interface, saving, playing online) and corrections that
// only make the digital game follow the rules do not go here.
// To add a rules version: put a new entry at the TOP of RULES_LOG, compared with the version
// before it (the test checks the order and the versions).

import {
  CARD_COUNTS, FACTORY_RECIPES, INVENTORY_CAP, MAX_CARDS_PLAYED_PER_TURN, MAX_CLAIMS_PER_BUILDING, PLAY_ON_DRAW_CARDS,
  PRINTED_RULES_VERSION, RULES_VERSION, TELEPORTER_COUNT, TESSERACTS_TO_WIN, teleporterCost,
} from '../../../engine/config';
import type { Block, RulesVersionLog, Topic } from '../types';
import { CARD_NAME, CARD_TYPES, PLAYER_COUNTS, listWords, minePriceWords, piecePoints, recipeWords, stackSize } from './facts';

const onDrawNames = listWords(CARD_TYPES.filter(c => PLAY_ON_DRAW_CARDS.has(c)).map(c => CARD_NAME[c]));

const beltHoles = (type: 'plateFact' | 'sphereFact' | 'tesseractFact' | 'powerPlant'): number =>
  piecePoints().find(p => p.type === type)!.belt.length;

const tesseractRecipes = listWords((FACTORY_RECIPES.tesseractFact?.inputs ?? []).map(recipeWords), 'or');

const teleporterPrice = (): string => {
  const step = teleporterCost(1) - teleporterCost(0);
  return `${teleporterCost(0)} while none is on the board, and ${step} more for each teleporter on the board (all players' together)`;
};

const NEW_CARDS = ['personalJetPack', 'assetForfeiture', 'rdTaxWriteOff', 'solarFlare'] as const;

/** Where the printed rulebook is silent and the rules had to decide. */
const silent = (what: string): string => `The printed rulebook does not say ${what}.`;
const decided = (rule: string): string => `In v${RULES_VERSION} ${rule}`;

export const RULES_LOG: readonly RulesVersionLog[] = [
  {
    version: RULES_VERSION,
    comparedWith: PRINTED_RULES_VERSION,
    summary: 'Teleporters, four new Leverage cards and one fewer, Mines that drop into play when a stack runs out, and nothing passing between players\' buildings.',
    themes: [
      {
        id: 'setup',
        subject: 'Setup',
        entries: [
          {
            title: 'Number Tiles are now Control Modules',
            before: 'The numbered tiles are called Number Tiles.',
            now: 'They are called Control Modules. They work as before.',
            see: 'claiming',
          },
          {
            title: 'Smaller stacks with fewer players',
            before: 'Three stacks of 32 pieces. Smaller stacks for 2 or 3 players are optional.',
            now: `The smaller stacks are always used: ${listWords(PLAYER_COUNTS.map(n => `${stackSize(n, 0)} pieces per stack with ${n} players`))}.`,
            see: 'table#stacks',
          },
          {
            title: 'Order of the first claims',
            before: 'The player to the right of the starting player claims a Plate Factory first, and the claims go counter-clockwise. Then the starting player claims a Power Plant first, and the claims go clockwise.',
            now: 'Plate Factories are claimed first, in turn order beginning with the starting player. Then Power Plants, in the reverse order, so the starting player picks last.',
            see: 'starting#first-claims',
          },
        ],
      },
      {
        id: 'turn',
        subject: 'Your turn',
        entries: [
          {
            title: 'Paying with materials worth more than the price',
            before: silent('how to pay when your materials are worth more than the price; it only lets you exchange materials down with the bank'),
            now: decided(`you can buy anything your materials are worth in total. You hand in materials and get the change back in smaller materials, keeping the most valuable ones you can: a Sphere and an Ore paying 3 leave a Plate and 2 Ore. Change that does not fit under your limit of ${INVENTORY_CAP} of a material is lost.`),
            see: 'bank#paying',
          },
          {
            title: 'Your meeple\'s building is used in your round-end turn',
            before: 'For the rest of the round you can supply its inputs from your inventory and collect what it makes, and at the end of the round you may run it once.',
            now: 'Loading its inputs from your inventory, running it once and collecting its output all happen in your round-end turn.',
            see: 'round-end',
          },
        ],
      },
      {
        id: 'claiming',
        subject: 'Claiming and Control Modules',
        entries: [
          {
            title: 'End-of-round upgrades are not combined with Mine upgrades',
            before: 'Your end-of-round upgrades can be combined with the upgrades from a Mine, for a bigger upgrade or a claim.',
            now: 'Each upgrade is paid from one source. End-of-round upgrades only raise one Control Module already on a building, and never pay for a claim. You can still upgrade the same building twice, once from each source.',
            see: 'claiming#upgrades',
          },
          {
            title: 'Short Sale and Changing Priorities: an unclaimed building or one of yours',
            before: 'Short Sale claims an unclaimed building with your lowest available Number Tile. Changing Priorities moves a Number Tile to a different building you have claimed.',
            now: `Both may go to an unclaimed building or to one that is already yours (at most ${MAX_CLAIMS_PER_BUILDING} of your Control Modules on it), never to another player's: a building always has one owner. Once your meeple stands on a building this turn, Changing Priorities may not move your last Control Module off it.`,
            see: 'cards#changingPriorities',
          },
          {
            title: 'A building that loses its owner loses its material',
            before: 'When Changing Priorities leaves a building without a Number Tile, any player may claim it on a later turn.',
            now: 'Anyone may still claim it later, but first every material in its inputs and output goes to the bank, and the teleporters on it go back to the player who placed them. A building without an owner holds, receives and feeds nothing.',
            see: 'cards#changingPriorities',
          },
        ],
      },
      {
        id: 'production',
        subject: 'Production and factories',
        entries: [
          {
            title: 'A Tesseract is never an input',
            before: 'A Tesseract Factory may use a higher-value material in place of a lower one.',
            now: `The same, except that a Tesseract is never an input: a Tesseract Factory takes ${tesseractRecipes}. A material that cannot complete a recipe is not accepted into an input, also when it arrives by belt or from a Mine.`,
            see: 'factories',
          },
        ],
      },
      {
        id: 'moving',
        subject: 'Moving material and belts',
        entries: [
          {
            title: 'Your buildings feed only your own buildings',
            before: 'A factory\'s output touching another building\'s input moves its material across, whoever owns the two buildings.',
            now: 'Only between two buildings of the same player. Next to another player\'s input, your material stays in your output. A Mine\'s ore exit fills any claimed building it touches; an unclaimed building receives and feeds nothing.',
            see: 'moving',
          },
          {
            title: 'More belt holes on buildings',
            before: 'A building piece has 4 belt connection points.',
            now: `Every hole on a building piece takes a belt, for any player: ${beltHoles('plateFact')} on a Plate Factory or Power Plant, ${beltHoles('sphereFact')} on a Sphere Factory, ${beltHoles('tesseractFact')} on a Tesseract Factory.`,
            see: 'belts#points',
          },
          {
            title: 'A belt may be laid before it connects anything',
            before: 'Belts must always carry materials from a Mine to an input, or from a factory\'s output to another factory\'s input.',
            now: 'A belt that does not (yet) link a source to an input may still be laid. Material moves only along a chain of belts that does.',
            see: 'belts#laying',
          },
          {
            title: 'One Mine belt per turn counts only ore exits',
            before: 'Only one belt can be connected to a Mine per turn.',
            now: 'Only a belt end facing a Mine\'s ore exit counts toward the one per turn. If you remove the Mine belt you laid this turn, you may lay another.',
            see: 'belts#rules',
          },
          {
            title: 'A belt laid this turn can be taken back for free',
            before: 'You may remove your own belts during your turn. They go back to the bank and must be bought again.',
            now: 'The same for a belt laid on an earlier turn. A belt you laid this turn comes back to your own belts, free to lay again (Ore spent buying it is not refunded): the digital game lets you take back a move you have not finished.',
            see: 'belts#buying',
          },
        ],
      },
      {
        id: 'teleporters',
        subject: 'Teleporters',
        entries: [
          {
            title: 'Teleporters',
            before: 'There are no teleporters.',
            now: `Each player has ${TELEPORTER_COUNT}. One goes on one input or on the output of a building you own: a Sphere Factory has two inputs and a Tesseract Factory three, and each input can carry one. The price is ${teleporterPrice()}. You can never remove one by choice; your teleporters come back to you only when the building has no Control Module of yours left.`,
            see: 'teleporters',
          },
          {
            title: 'What a teleporter does',
            before: 'Without your meeple on a building, you cannot collect what it makes or supply its inputs from your inventory.',
            now: `On an output, what the building makes goes straight to your inventory, while you are under your limit of ${INVENTORY_CAP}. On an input, you choose, each time the building runs, a material from your inventory for that empty input, or nothing: nothing is ever taken by itself. A Power Plant with your teleporter on its empty input takes one Ore, Plate or Sphere if you supply it, and always runs.`,
            see: 'teleporters#supply',
          },
          {
            title: 'A teleporter cuts its input or output off',
            before: 'There are no teleporters: belts, touching buildings and Mines fill every input.',
            now: 'Nothing arrives at an input with a teleporter by belt, from a touching building or from a Mine, and nothing leaves an output with a teleporter except into your inventory. The other inputs of a Sphere or Tesseract Factory keep receiving. Belts there stay but carry nothing.',
            see: 'teleporters',
          },
        ],
      },
      {
        id: 'mines',
        subject: 'Mines',
        entries: [
          {
            title: 'The next Mine drops into play when a stack runs out',
            before: 'Stacks 2 and 3 open only when their Mine is bought. If the pieces run out, the discard pile is shuffled in; if there are still none, another Mine must be bought.',
            now: `When a stack runs out, the next Mine drops into play by itself: the next player to place a piece places the Mine instead, and its stack opens. A Mine may still be bought earlier (${minePriceWords()}). Pieces removed by Sink Hole never come back.`,
            see: 'mines#next',
          },
          {
            title: 'Where a new Mine may go',
            before: silent('where a new Mine may go, only that a bought Mine is placed at once'),
            now: decided('it goes wherever either of its two halves is next to the board, in any of the six directions, with both spaces free. A dropped Mine follows the same rule.'),
            see: 'mines#placing',
          },
        ],
      },
      {
        id: 'cards',
        subject: 'Leverage cards',
        entries: [
          {
            title: 'Eminent Domain removed',
            before: 'Eminent Domain (3 cards): remove any two belts from the board and take 2 belts.',
            now: 'The card is not in the deck.',
          },
          {
            title: 'Four new cards',
            before: 'Not in the printed deck.',
            now: `${listWords(NEW_CARDS.map(c => `[[cards#${c}|${CARD_NAME[c]}]] (${CARD_COUNTS[c]} copies)`))}.`,
            see: 'cards',
          },
          {
            title: 'Embezzlement is always a Sphere',
            before: 'A Sphere with one or two Mines in play, a Tesseract with three.',
            now: 'Always a Sphere, however many Mines are in play.',
            see: 'cards#embezzlement',
          },
          {
            title: 'Cards played as soon as they are drawn count toward your plays',
            before: silent(`whether a card that must be played as soon as it is drawn counts toward the ${MAX_CARDS_PLAYED_PER_TURN} cards you may play per turn`),
            now: decided(`it does: ${onDrawNames} use up one of your ${MAX_CARDS_PLAYED_PER_TURN} plays if you have one left, and take effect anyway if you do not. Buying cards is never limited.`),
            see: 'cards',
          },
          {
            title: 'When Leverage cards may be played',
            before: 'At any time during your turn, including before placing a board piece.',
            now: 'In any of the four steps of your own turn, never in another player\'s turn or in a round-end turn. The upgrades of Production Increase may be spent in any step of the turn it is played in. Scouting Drone, in the place-a-piece step, only before you draw.',
            see: 'cards',
          },
        ],
      },
      {
        id: 'winning',
        subject: 'Bonuses and winning',
        entries: [
          {
            title: 'A bonus counts only while you hold it',
            before: 'When a bonus is achieved, its card is placed in front of the player, and it moves at once when someone does better.',
            now: 'The same, and a bonus counts only while its card is in front of you: you cannot claim afterwards that you had it all along.',
            see: 'bonuses',
          },
          {
            title: 'You win during your own turn',
            before: 'The first player with 4 Tesseracts in their inventory wins.',
            now: `You win by holding ${TESSERACTS_TO_WIN} Tesseracts, bonus cards included, during your own turn.`,
            see: 'winning',
          },
          {
            title: 'When the pieces run out',
            before: 'The final round is completed by all players, and the most resource points in inventory wins. It does not say whether the round-end turns are played or how a tie is broken.',
            now: decided(`every remaining player takes their turn (with nothing to draw, they start at the roll), the round-end turns are played, and then the most resource points wins. A tie goes to the most Tesseracts, then Spheres, Plates and Ore, then the player earliest in turn order. Holding ${TESSERACTS_TO_WIN} Tesseracts on your own turn still wins in those last turns.`),
            see: 'winning#exhausted',
          },
        ],
      },
    ],
  },
];

/** "Rules v0.70, compared with the printed rulebook (v0.61)". */
export function versionHeading(log: RulesVersionLog): string {
  const base = log.comparedWith === PRINTED_RULES_VERSION ? `the printed rulebook (v${log.comparedWith})` : `v${log.comparedWith}`;
  return `Rules v${log.version}, compared with ${base}`;
}

function changeBlocks(): Block[] {
  const out: Block[] = [
    { k: 'p', t: `This is a log of the rules by **rules version**, newest first. Each section lists every difference in how the game is played: how the rule was, and how it is now. The first section compares the rules this game plays, **rules v${RULES_VERSION}**, with the printed rulebook, **rules v${PRINTED_RULES_VERSION}**: the version is printed in the footer of the rulebook, so you can check your copy. Where the printed rulebook says nothing and the rules had to decide, the entry says so.` },
    { k: 'p', t: 'The rules version is not the version of the digital game (0.1.x, shown under the title). That one follows the app itself and moves without the rules changing; the rules version moves only when a rule is new, not when one is merely clarified.' },
  ];
  RULES_LOG.forEach((log, i) => {
    const anchor = `v${log.version}`;
    out.push({ k: 'h', t: versionHeading(log), id: anchor });
    out.push({ k: 'p', t: log.summary });
    const beforeLabel = log.comparedWith === PRINTED_RULES_VERSION ? `Printed v${log.comparedWith}` : `v${log.comparedWith}`;
    const nowLabel = i === 0 ? 'Now' : `v${log.version}`;
    for (const theme of log.themes) {
      out.push({ k: 'h', t: theme.subject, id: `${anchor}-${theme.id}` });
      for (const c of theme.entries) {
        out.push({ k: 'change', title: c.title, beforeLabel, nowLabel, before: c.before, now: c.see ? `${c.now} [[${c.see}|More…]]` : c.now });
      }
    }
  });
  return out;
}

export const changes: Topic = {
  id: 'changes',
  title: 'What changed',
  summary: 'The rules by rules version, newest first, starting from the printed rulebook.',
  blocks: changeBlocks(),
  see: ['goal'],
};
