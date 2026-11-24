// What changed between releases, and how this version differs from the printed rulebook.
// To add a release: put a new entry at the TOP of RELEASES (the test checks the order).

import {
  CARD_COUNTS, INVENTORY_CAP, MAX_CARDS_PLAYED_PER_TURN, PLAY_ON_DRAW_CARDS, TELEPORTER_COUNT, TESSERACTS_TO_WIN,
} from '../../../engine/config';
import type { Block, PrintedGroup, Release, Topic } from '../types';
import { CARD_NAME, CARD_TYPES, PLAYER_COUNTS, listWords, piecePoints, stackSize } from './facts';

const onDrawNames = listWords(CARD_TYPES.filter(c => PLAY_ON_DRAW_CARDS.has(c)).map(c => CARD_NAME[c]));

const beltHoles = (type: 'plateFact' | 'sphereFact' | 'tesseractFact' | 'powerPlant'): number =>
  piecePoints().find(p => p.type === type)!.belt.length;

export const RELEASES: readonly Release[] = [
  {
    version: '0.1.2',
    summary: 'Rules settled with the designer, payment with change, and a set of interface improvements (including this guide).',
    rules: [
      {
        title: 'Cards played as soon as they are drawn count toward your plays',
        before: `${onDrawNames} did not count toward the ${MAX_CARDS_PLAYED_PER_TURN} Leverage cards you may play per turn.`,
        now: `They use up one of your ${MAX_CARDS_PLAYED_PER_TURN} plays if you have one left. If you have already played ${MAX_CARDS_PLAYED_PER_TURN}, they still take effect. Buying is never blocked.`,
        see: 'cards',
      },
      {
        title: 'Teleporters come back when you lose the building',
        before: 'Teleporters were permanent: one stayed on its building even after you no longer owned it, and the price counted every teleporter ever placed.',
        now: 'When you no longer have a Control Module on a building (Changing Priorities can cause this), your teleporters on it return to your supply. The price is the number of teleporters on the board + 1, so it drops too. You still cannot remove a teleporter by choice.',
        see: 'teleporters',
      },
      {
        title: 'R&D Tax Write-Off uses one of your teleporters',
        before: 'This was an open question, though the game already worked this way.',
        now: `Confirmed: the free teleporter is one of your ${TELEPORTER_COUNT}, and it raises the teleporter price like a bought one.`,
        see: 'cards#rdTaxWriteOff',
      },
      {
        title: 'Embezzlement gives a Sphere',
        before: 'This was an open question (keep the card giving a Sphere, or remove it), though the game already gave a Sphere.',
        now: 'Confirmed: Embezzlement takes 1 Sphere from the bank.',
        see: 'cards#embezzlement',
      },
      {
        title: 'Other players\' belts do not serve your buildings',
        before: 'A belt laid next to a building\'s input or output before someone else claimed the building kept carrying material to or from it.',
        now: 'A belt end facing the input or output of a building claimed only by other players is a dead end. The belt stays, and works again if its owner gains a claim there or the building becomes unclaimed.',
        see: 'belts#whose',
      },
      {
        title: 'The one-belt-per-turn Mine limit counts only ore exits',
        before: 'Any belt end facing any part of a Mine counted toward the limit of one per turn.',
        now: 'Only belt ends facing an ore exit of a Mine count.',
        see: 'belts#rules',
      },
      {
        title: 'Your own factory decision comes first',
        before: 'The interface already made you decide Run it or Skip for your own activated factory before anything else, but the rules engine did not insist.',
        now: 'The rules require it, and online the host accepts only moves the game offers.',
        see: 'production#off-turn',
      },
      {
        title: 'Scouting Drone: any piece from any open stack',
        before: 'The game offered only the top 5 pieces of each stack.',
        now: 'Choose any kind of piece in any open stack.',
        see: 'cards#scoutingDrone',
      },
      {
        title: 'Paying with change keeps your best materials',
        before: 'Change came back all in Ore, and teleporters had to be paid with the exact amount.',
        now: `The game pays so that you keep the most valuable materials possible, breaking down only what it must: a Sphere and an Ore paying 3 leave a Plate and 2 Ore. Change that does not fit under your limit of ${INVENTORY_CAP} is lost, and the game picks the payment that loses the least. Anything your materials are worth in total can be bought, teleporters included.`,
        see: 'bank#paying',
      },
      {
        title: 'Exchanging in your round-end turn',
        before: 'The game offered exchanges only in your actions step.',
        now: 'You can also exchange in your round-end turn.',
        see: 'bank#exchange',
      },
      {
        title: 'A Mine\'s larger half must touch the board',
        before: 'The rules let a Mine touch the board with its smaller half only, although the game never offered such a place.',
        now: 'A Mine is placed with its larger half, the one with ore exits all round, touching the board. The smaller half may point any way that is free.',
        see: 'mines',
      },
      {
        title: 'Your meeple must be placed',
        before: 'The rules let a turn end without placing the meeple, although the game always asked you to place it.',
        now: 'If your meeple has anywhere to go, your turn cannot end until it is placed, and it is placed once per turn.',
        see: 'step-meeple',
      },
      {
        title: 'Every claim is paid for',
        before: 'The rules did not stop a claim paid by nothing in the actions step, although the game never offered one.',
        now: 'A claim is paid with Mine credits or with Production Increase. Only your first claims before the first turn, and Short Sale, are free.',
        see: 'claiming',
      },
      {
        title: 'Changing Priorities moves to another building',
        before: 'Moving a Control Module onto the building it came from removed the claim and lost the module (the game never offered it).',
        now: 'The Control Module must move to a different building.',
        see: 'cards#changingPriorities',
      },
    ],
    interface: [
      'This game guide, from the start menu and from the game.',
      'Press a Plate, Sphere or Tesseract in your materials to exchange it down.',
      'Your materials show their Total Value.',
      'A purchase that gives change says what you will keep.',
      'The Teleporters tile lights up when you can place one, and says why when you cannot.',
      'Placing your meeple on a Mine point tells you what it will give you.',
      'Belts on the table point the way material flows.',
      'Each player first sees the table from their own side; the turn button turns it 60° at a time, keeping the board in view.',
      'The host chooses the kind of bot for each bot seat, and the seat is named after its kind.',
      'The start menu and the game menu show the version.',
    ],
  },
  {
    version: '0.1.1',
    summary: 'Belt holes and Mines matched to the printed pieces, and drawing from a face-down stack.',
    rules: [
      {
        title: 'More belt holes on buildings',
        before: 'Belts could end only on 4 points of a building piece.',
        now: `Every hole on the printed building pieces takes a belt, for any player: ${beltHoles('plateFact')} on a Plate Factory or Power Plant, ${beltHoles('sphereFact')} on a Sphere Factory, ${beltHoles('tesseractFact')} on a Tesseract Factory.`,
        see: 'belts#points',
      },
      {
        title: 'Reserved points include outputs, and co-owners may use them',
        before: 'A belt end was refused next to the input of a building with any claim by another player, even one you shared; outputs were not protected.',
        now: 'A belt end may not face the input or output of a building claimed only by other players. If you hold a claim on it, you may use them.',
        see: 'belts#rules',
      },
      {
        title: 'Mines 2 and 3 release Ore only from their larger half',
        before: 'All three Mines had ore exits on their smaller half.',
        now: 'Only the first Mine has exits on its smaller half, as on the printed pieces.',
        see: 'belts#points',
      },
      {
        title: 'Drawing from a face-down stack',
        before: 'With several stacks open, you could see each stack\'s top piece and place whichever you liked.',
        now: 'You first choose a stack, see its top piece only after drawing it, and must place it.',
        see: 'step-place',
      },
    ],
  },
  {
    version: '0.1.0',
    summary: 'The first online version. Its rules are the ones under [[printed|Differences from the printed rulebook]], apart from the changes listed above.',
    rules: [],
  },
];

export const PRINTED_GROUPS: readonly PrintedGroup[] = [
  {
    id: 'components',
    subject: 'Names and components',
    items: [
      { title: 'Control Modules', printed: 'The numbered tiles are called Number Tiles.', here: 'They are called Control Modules.' },
      { title: 'Teleporters', printed: 'There are no teleporters.', here: `Each player has ${TELEPORTER_COUNT} teleporters.`, see: 'teleporters' },
      {
        title: 'Smaller stacks with fewer players',
        printed: 'Three stacks of 32 pieces; smaller stacks for 2 or 3 players are optional.',
        here: `The smaller stacks are always used: ${listWords(PLAYER_COUNTS.map(n => `${stackSize(n, 0)} per stack with ${n} players`))}.`,
        see: 'table#stacks',
      },
    ],
  },
  {
    id: 'setup',
    subject: 'Setup',
    items: [
      {
        title: 'Order of the first claims',
        printed: 'Plate Factories are claimed first, counter-clockwise from the player to the right of the starting player; then Power Plants, clockwise from the starting player.',
        here: 'Plate Factories are claimed first in turn order, starting with the starting player; then Power Plants in reverse order, so the starting player picks last.',
        see: 'starting#first-claims',
      },
    ],
  },
  {
    id: 'turn',
    subject: 'Your turn',
    items: [
      { title: 'Drawing a piece', printed: 'Draw a piece from any of the available stacks.', here: 'Choose a face-down stack first; you must place the piece you drew.', see: 'step-place' },
      { title: 'When cards are played', printed: 'Cards can be played at any time in your turn, even before placing a piece.', here: 'Cards are played in your actions step.', see: 'cards' },
      {
        title: 'Cards played when drawn',
        printed: `Only ${MAX_CARDS_PLAYED_PER_TURN} cards can be played per turn.`,
        here: `Still ${MAX_CARDS_PLAYED_PER_TURN}; ${onDrawNames} count toward them when you have a play left, and take effect anyway when you do not.`,
        see: 'cards',
      },
      {
        title: 'Using your meeple\'s building',
        printed: 'For the rest of the round you can supply its inputs from your inventory and collect what it makes.',
        here: 'You load, run and collect in your round-end turn.',
        see: 'round-end',
      },
      { title: 'Trading', printed: 'Players may trade Power Tokens; trading materials is allowed but discouraged.', here: 'There is no trading between players.' },
      { title: 'Timers', printed: 'No timers.', here: 'Online, unanswered off-turn factory questions and idle round-end turns are settled by timers the host sets.', see: 'online#timers' },
    ],
  },
  {
    id: 'buildings',
    subject: 'Running buildings',
    items: [
      {
        title: 'The game asks before running your factory',
        printed: 'When a building\'s number is rolled, its owner may choose not to operate it.',
        here: 'The game asks you every time, on any player\'s turn. Online, a question on someone else\'s turn is decided for you if you do not answer in time.',
        see: 'production',
      },
      {
        title: 'Exact recipes',
        printed: 'A Tesseract Factory may use a higher-value material in place of a lower one.',
        here: 'The valid input sets are listed exactly; a Tesseract is never an input, and material that cannot complete a recipe is refused — also when it arrives by belt or from a Mine.',
        see: 'factories',
      },
    ],
  },
  {
    id: 'belts',
    subject: 'Belts and Mines',
    items: [
      {
        title: 'Belt holes on buildings',
        printed: 'Buildings have 4 belt connection points.',
        here: `Every hole on the printed building pieces takes a belt: ${beltHoles('plateFact')} on a Plate Factory or Power Plant, ${beltHoles('sphereFact')} on a Sphere Factory, ${beltHoles('tesseractFact')} on a Tesseract Factory.`,
        see: 'belts#points',
      },
      { title: 'Removing belts', printed: 'Removed belts go back to the bank and must be bought again.', here: 'Removed belts go back to your own supply, free to lay again.', see: 'belts#buying' },
      { title: 'Reserved points', printed: 'Belts cannot be placed next to the input or output of another player\'s claimed building.', here: 'The same, but a player who shares the building may use those points.', see: 'belts#rules' },
      { title: 'One Mine belt per turn', printed: 'Only one belt can be connected to a Mine per turn.', here: 'Only belt ends facing a Mine\'s ore exit count.', see: 'belts#rules' },
      {
        title: 'Running out of pieces',
        printed: 'If the pieces run out, the discard pile is shuffled back in; if there are still none, another Mine must be bought.',
        here: 'When a stack runs out, the next Mine drops into play by itself and opens its stack. Pieces removed by Sink Hole never come back.',
        see: 'mines#next',
      },
      {
        title: 'The Mine\'s upgrade point',
        printed: 'Each upgrade point gives the number of upgrades printed on it (two, three or four).',
        here: 'Every Mine\'s upgrade point gives the number of Mines on the board + 1.',
        see: 'mines#points',
      },
    ],
  },
  {
    id: 'claims',
    subject: 'Claims and upgrades',
    items: [
      {
        title: 'Combining end-of-round and Mine upgrades',
        printed: 'Your end-of-round upgrade can be combined with the upgrades from a Mine, for a bigger upgrade or a claim.',
        here: 'Each upgrade is paid from one source, and end-of-round upgrades never pay for a claim. You can still upgrade the same building twice in a row, once from each source.',
        see: 'claiming',
      },
      {
        title: 'Claims on other players\' buildings',
        printed: 'Additional claims can only go on buildings you own; Changing Priorities moves a tile to another building you have claimed.',
        here: 'Short Sale and Changing Priorities can also put your Control Module on a building another player has claimed; you then share it.',
        see: 'cards#shortSale',
      },
    ],
  },
  {
    id: 'cards',
    subject: 'Leverage cards',
    items: [
      { title: 'Eminent Domain removed', printed: 'Eminent Domain (3 cards): remove any two belts from the board and take 2 belts.', here: 'The card is not in the deck.' },
      {
        title: 'Four new cards',
        printed: 'Not in the printed deck.',
        here: `${listWords((['personalJetPack', 'assetForfeiture', 'rdTaxWriteOff', 'solarFlare'] as const).map(c => `[[cards#${c}|${CARD_NAME[c]}]] (${CARD_COUNTS[c]} copies)`))}.`,
      },
      { title: 'Embezzlement', printed: 'A Sphere with one or two Mines, a Tesseract with three.', here: 'Always a Sphere.', see: 'cards#embezzlement' },
      { title: 'Sink Hole and belts', printed: 'Belts on the removed piece go back to the bank.', here: 'They go back to their owners\' supplies.', see: 'cards#sinkHole' },
      { title: 'An empty deck', printed: 'When the deck runs out, the discard pile is shuffled to form a new deck.', here: 'When the deck runs out, no more cards can be bought.', see: 'cards' },
    ],
  },
  {
    id: 'winning',
    subject: 'Bonuses and winning',
    items: [
      {
        title: 'Bonus cards are handed out for you',
        printed: 'When a bonus is achieved, its card is placed in front of the player.',
        here: 'The game checks after every move and moves the card at once. A bonus counts only while you hold it.',
        see: 'bonuses',
      },
      {
        title: 'Winning',
        printed: `The first player with ${TESSERACTS_TO_WIN} Tesseracts in their inventory wins.`,
        here: `You win with ${TESSERACTS_TO_WIN} Tesseracts, bonus cards included, during your own turn.`,
        see: 'winning',
      },
      {
        title: 'When the pieces run out',
        printed: 'All players complete the final round; the most resource points wins.',
        here: 'The game ends at the end of the turn in which the last piece is placed; the most material value wins, with tie-breaks.',
        see: 'winning#exhausted',
      },
    ],
  },
];

function releaseBlocks(): Block[] {
  const out: Block[] = [
    { k: 'p', t: 'Each release of the game, newest first, with every rule that changed: what it used to be, and how it works now. For how this version differs from the paper game, see [[printed|Differences from the printed rulebook]].' },
  ];
  for (const r of RELEASES) {
    out.push({ k: 'h', t: `Version ${r.version}`, id: `v${r.version}` });
    out.push({ k: 'p', t: r.summary });
    for (const c of r.rules) {
      out.push({ k: 'change', title: c.title, before: c.before, now: c.see ? `${c.now} [[${c.see}|More…]]` : c.now });
    }
    if (r.interface?.length) {
      out.push({ k: 'p', t: '**Also new in the interface:**' });
      out.push({ k: 'list', items: r.interface });
    }
  }
  return out;
}

function printedBlocks(): Block[] {
  const out: Block[] = [
    { k: 'p', t: 'This version follows the designer\'s current rules, which have moved on since the printed rulebook (v1.1). If you know the paper game, these are the differences you will notice. Where the two disagree, the game on your screen is the one that counts.' },
  ];
  for (const g of PRINTED_GROUPS) {
    out.push({ k: 'h', t: g.subject, id: g.id });
    for (const d of g.items) {
      out.push({
        k: 'change', title: d.title, beforeLabel: 'Printed rulebook', nowLabel: 'This version',
        before: d.printed, now: d.see ? `${d.here} [[${d.see}|More…]]` : d.here,
      });
    }
  }
  return out;
}

export const changes: Topic = {
  id: 'changes',
  title: 'What changed',
  summary: 'Rule changes from one release to the next, newest first.',
  blocks: releaseBlocks(),
  see: ['printed'],
};

export const printed: Topic = {
  id: 'printed',
  title: 'Differences from the printed rulebook',
  summary: 'Where this version plays differently from the paper game (rulebook v1.1).',
  blocks: printedBlocks(),
  see: ['changes'],
};
