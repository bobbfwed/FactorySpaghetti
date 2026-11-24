// Your turn: the overview, the four steps, and the end of a round.

import {
  BELT_COST, CONTROL_MODULE_MAX, INVENTORY_CAP, MAX_CARDS_PLAYED_PER_TURN, MINE_COUNT, PLAY_ON_DRAW_COUNTS_TOWARD_LIMIT,
  PRODUCTION_INCREASE_BUDGET, ROUND_END_TIMEOUT_MS,
} from '../../../engine/config';
import type { Block, Topic } from '../types';
import {
  MINE_NUMBERS, MINE_RESOURCE_REWARD, ORDINAL, amount, cardPriceWords, diceOdds, likeliest, listWords, mineCredits,
  minePriceWords, percent, perMineWords,
} from './facts';

const seconds = (ms: number): string => `${Math.round(ms / 1000)} seconds`;

/** "First Mine: 2 Ore. Second Mine: 1 Plate. Third Mine: 1 Sphere." */
export function resourcePointWords(): string {
  return MINE_RESOURCE_REWARD.map((r, i) => `${ORDINAL[i]![0]!.toUpperCase()}${ORDINAL[i]!.slice(1)} Mine: ${amount(r.n, r.material)}.`).join(' ');
}

/** The rewards of a Mine's two meeple points, as table rows. */
export function minePointRows(): string[][] {
  return [
    ['Resource point', resourcePointWords()],
    ['Upgrade point', `**Mine credits**: the number of Mines + 1 (${perMineWords(mineCredits)}). Spend them on one claim and on upgrades during your round-end turn.`],
  ];
}

export const turn: Topic = {
  id: 'turn',
  title: 'Your turn at a glance',
  summary: 'The four steps of every turn, and what happens when everyone has had one.',
  blocks: [
    { k: 'p', t: 'Players take turns one after another. Every turn has the same four steps, shown in the turn bar:' },
    {
      k: 'steps', items: [
        '**Place a piece**: draw a board piece and add it to the board. [[step-place|More…]]',
        '**Roll**: roll one die per Mine. Every building whose Control Module matches the total may run. [[step-roll|More…]]',
        '**Actions**: buy and lay belts, buy Leverage cards and Mines, place teleporters, exchange materials, and play cards. Press **Done with actions** when finished. [[step-actions|More…]]',
        '**Place meeple** on one of your buildings or on a Mine point. Confirming it ends your turn. [[step-meeple|More…]]',
      ],
    },
    { k: 'p', t: `You may play up to **${MAX_CARDS_PLAYED_PER_TURN} Leverage cards** per turn, during your actions step${PLAY_ON_DRAW_COUNTS_TOWARD_LIMIT ? '; a card played as soon as it is drawn counts as one of them' : ''}. There is no limit on buying them. See [[cards|Leverage cards]].` },
    { k: 'p', t: 'When everyone has had a turn, the round ends and each player takes a short **round-end turn**: free upgrades, Mine rewards, and the building their meeple stands on. See [[round-end|The end of a round]].' },
    { k: 'p', t: 'Each round starts one player further on: the player who went first moves to the end of the order.' },
    { k: 'note', tone: 'tip', t: 'Other players\' rolls can activate your buildings too. If one of your factories is activated, the game asks whether to run it, even when it is not your turn. See [[production|Production]].' },
  ],
  see: ['step-place', 'round-end'],
};

export const stepPlace: Topic = {
  id: 'step-place',
  title: 'Step 1: Place a piece',
  summary: 'Draw from a stack and add the piece next to the board.',
  blocks: [
    { k: 'p', t: 'If more than one stack is open, first choose which stack to draw from; the open stacks glow. You see the piece only once you have drawn it, and you must place what you drew. If only one stack is open, its top piece is yours to place straight away.' },
    { k: 'p', t: 'Tap a glowing space next to the board, turn the piece until it faces the way you want, and confirm. Any free space that touches the board will do, in any of the six directions.' },
    { k: 'note', tone: 'tip', t: 'Turn a building so its input faces something useful: a Mine\'s ore exit, another building\'s output, or a spot where your belts can reach it.' },
    { k: 'h', t: 'When a stack runs out' },
    { k: 'p', t: 'When a stack becomes empty, the next Mine **drops** into play by itself and the stack under it opens. The next player places that Mine instead of drawing a piece. See [[mines|Mines]].' },
    { k: 'p', t: 'When all three stacks are empty, the game ends. See [[winning|Winning and the end of the game]].' },
    {
      k: 'details', blocks: [
        { k: 'p', t: 'Choosing a stack is final, even though you only see the piece afterwards.' },
        { k: 'p', t: 'A dropped Mine is placed at the start of the next turn, by the player whose turn it is, in place of their piece. A Mine needs two free spaces side by side, and its larger half (the one with ore exits all round) must touch the board; the smaller half may point any way that is free. See [[mines|Mines]].' },
        { k: 'p', t: 'Pieces can also come from Leverage cards: Overstock Supplies takes the top pieces of the lowest-numbered open stack, and Scouting Drone lets you pick a piece from any open stack. These come on top of your normal piece for the turn.' },
      ],
    },
  ],
  see: ['table', 'mines'],
};

function oddsTable(): Block {
  const dice = MINE_NUMBERS;
  const maxTotal = 6 * MINE_COUNT;
  const odds = dice.map(diceOdds);
  const rows: string[][] = [];
  for (let t = 1; t <= maxTotal; t++) rows.push([String(t), ...odds.map(o => percent(o[t] ?? 0))]);
  return {
    k: 'table', head: ['Total', ...dice.map(d => (d === 1 ? '1 Mine' : `${d} Mines`))], rows,
    caption: 'Chance of each total in one roll',
  };
}

export const stepRoll: Topic = {
  id: 'step-roll',
  title: 'Step 2: Roll the dice',
  summary: 'One die per Mine; matching buildings run, whoever owns them.',
  blocks: [
    { k: 'p', t: `Press **Roll** (the button says how many dice). You roll one die for each Mine on the board: 1 die at the start, 2 once the second Mine is in play, ${MINE_COUNT} once the third is. Online, the host's device rolls for everyone, so nobody can choose their roll.` },
    { k: 'p', t: 'Every building with a Control Module equal to the total **activates**, whoever owns it:' },
    {
      k: 'list', items: [
        '**Power Plants** run at once and give their owner Power Tokens.',
        '**Factories** that are able to run ask their owner: **Run it** or **Skip**. Running costs Power Tokens and uses up the inputs. See [[production|Production]].',
      ],
    },
    { k: 'p', t: 'Material also moves along belts and between touching pieces, just before and just after the buildings run. See [[moving#when|When material moves]].' },
    { k: 'h', t: 'Which totals come up', id: 'odds' },
    {
      k: 'table', head: ['Mines', 'Dice', 'Totals', 'Most likely'],
      rows: MINE_NUMBERS.map(m => {
        const best = likeliest(m);
        return [String(m), String(m), `${m} to ${6 * m}`, best.length === 5 * m + 1 ? 'All equally likely' : listWords(best.map(String))];
      }),
    },
    { k: 'p', t: `A Control Module whose number can no longer be rolled stays on its building, but the building will not activate. A 1 cannot be rolled once there are two Mines, and numbers above 12 need the third Mine. Your tray goes up to ${CONTROL_MODULE_MAX}, the highest total of ${MINE_COUNT} dice.` },
    { k: 'details', title: 'The chance of each total', blocks: [oddsTable()] },
  ],
  see: ['production', 'claiming'],
};

export const stepActions: Topic = {
  id: 'step-actions',
  title: 'Step 3: Actions',
  summary: 'Belts, cards, Mines, teleporters and exchanges, in any order, as often as you can pay.',
  blocks: [
    { k: 'p', t: 'This is the main part of your turn. Do any of these, in any order, as many times as you can pay for:' },
    {
      k: 'table', head: ['What', 'How', 'Price'], rows: [
        ['Lay belts', 'Press **Lay a belt**, tap where the belts start, then where they end. [[belts|Belts]]', 'Free, from your supply'],
        ['Buy a belt', 'Bank: **Belt**', String(BELT_COST)],
        ['Remove a belt', 'Press **Remove**, then tap one of your belts', 'Free; it goes back to your supply'],
        ['Buy a Leverage card', 'Bank: **Leverage card**', `Number of Mines + 1 (${cardPriceWords()})`],
        ['Play a Leverage card', 'Tap it in your hand, then **Play**. [[cards|Leverage cards]]', `Free; at most ${MAX_CARDS_PLAYED_PER_TURN} per turn${PLAY_ON_DRAW_COUNTS_TOWARD_LIMIT ? ', cards played as soon as they are drawn included' : ''}`],
        ['Buy a Mine', 'Bank: **Mine**, then place it like a piece, its larger half touching the board. [[mines|Mines]]', minePriceWords()],
        ['Place a teleporter', 'Press the **Teleporters** tile (it reads **Place a teleporter** when you can), then tap the input or output of one of your buildings. [[teleporters|Teleporters]]', 'Teleporters on the board + 1'],
        ['Exchange materials', 'Press a Plate, Sphere or Tesseract, or the bank\'s **Exchange**, then **Exchange** to confirm. [[bank#exchange|Exchanging]]', 'Free'],
      ],
    },
    { k: 'p', t: 'You can buy anything your materials are worth in total: the game pays for you and gives change, keeping your most valuable materials. See [[bank#paying|Paying with change]].' },
    { k: 'h', t: 'Factory decisions come first' },
    { k: 'p', t: 'If your roll activated one of your own factories, decide **Run it** or **Skip** before anything else. Factories of other players are decided by their owners on their own devices: you can carry on meanwhile, but **Done with actions** waits until they have answered.' },
    { k: 'h', t: 'Finishing' },
    { k: 'p', t: 'Press **Done with actions**. Only then does material move along the belts you laid this turn, so until then you can lay, remove and re-lay belts as you like. **Undo belts** (take back this turn\'s belts) returns every belt you laid this turn to your supply.' },
    { k: 'note', t: 'You cannot claim buildings in this step except with a Leverage card (Short Sale, Production Increase or Changing Priorities). Claims normally happen at the end of the round, with Mine credits. See [[claiming|Claiming and upgrading]].' },
    {
      k: 'details', blocks: [
        { k: 'p', t: 'If you bought Overstock Supplies, place all its pieces before **Done with actions**.' },
        { k: 'p', t: `Upgrades left over from Production Increase (it gives ${PRODUCTION_INCREASE_BUDGET}) are lost when you press **Done with actions**.` },
        { k: 'p', t: 'Belts cannot be laid or removed at any other time: not in another step, not in your round-end turn.' },
      ],
    },
  ],
  see: ['belts', 'bank', 'cards'],
};

export const stepMeeple: Topic = {
  id: 'step-meeple',
  title: 'Step 4: Place your meeple',
  summary: 'On one of your buildings, or on a Mine\'s resource or upgrade point.',
  blocks: [
    { k: 'p', t: 'Every turn ends with placing your meeple. If it has anywhere to go, it **must** be placed: your turn cannot end without it. It stays there until the end of the round. Tap a glowing spot and confirm; confirming ends your turn.' },
    {
      k: 'table', head: ['Where', 'What it gives you at the end of the round'], rows: [
        ['One of your buildings', 'In your round-end turn you may load its input from your materials, run it once (even if its number was not rolled), and collect its output. See [[round-end|The end of a round]].'],
        ...minePointRows(),
      ],
    },
    { k: 'p', t: `Each Mine point holds one meeple. When you choose a Mine point, the game says what it will give you, for example "Place your meeple on the Mine resource point to gain ${amount(MINE_RESOURCE_REWARD[0]!.n, MINE_RESOURCE_REWARD[0]!.material)} at the end of the round?", and warns you if your limit of ${INVENTORY_CAP} would cut the reward.` },
    {
      k: 'details', blocks: [
        { k: 'p', t: 'A resource point\'s reward depends on which Mine it is — the order in which the Mines came into play — not on how many Mines there are.' },
        { k: 'p', t: 'An upgrade point gives the same on every Mine: the number of Mines on the board at the end of the round, plus 1.' },
        { k: 'p', t: `Rewards above your limit of ${INVENTORY_CAP} of a material are lost.` },
        { k: 'p', t: 'Only if there is nowhere for your meeple (every Mine point taken and no building of yours on the board) do you end your turn without placing it: the button then reads **No place for your meeple: end turn**.' },
        { k: 'p', t: 'Your meeple is placed once per turn. Tapping somewhere that is not a glowing spot puts your choice back; only a glowing spot can be confirmed.' },
      ],
    },
  ],
  see: ['round-end', 'mines'],
};

export const roundEnd: Topic = {
  id: 'round-end',
  title: 'The end of a round',
  summary: 'Free upgrades, Mine rewards and your meeple\'s building, one player at a time.',
  blocks: [
    { k: 'p', t: 'When the last player of the round has placed their meeple, the round ends:' },
    {
      k: 'steps', items: [
        'Meeples on a Mine\'s resource point collect their reward.',
        'Everyone gets **free upgrades**, one per Mine. Meeples on an upgrade point earn **Mine credits**.',
        'Each player takes a **round-end turn**, one at a time, starting with the player who will start the next round.',
      ],
    },
    { k: 'h', t: 'In your round-end turn you may' },
    {
      k: 'list', items: [
        'Use your **free upgrades** to raise Control Modules on **one** building. They cannot pay for a claim.',
        'Spend **Mine credits** on one claim and on upgrades on any of your buildings.',
        'If your meeple is on one of your buildings: load its input from your materials, **Run it** once, and **Collect the output** — each optional, in any order.',
        'Exchange materials with the bank.',
      ],
    },
    { k: 'p', t: 'Press **Finish round-end turn** when you are done. Whatever you do not use is lost: free upgrades and Mine credits do not carry over to the next round. See [[claiming|Claiming and upgrading]] for the costs.' },
    { k: 'p', t: `Online, a round-end turn with no move for ${seconds(ROUND_END_TIMEOUT_MS)} (the host can change this) ends by itself. Each move starts the countdown again, so a player who is busy is never cut off.` },
    { k: 'p', t: 'After the last round-end turn the meeples come back and the next round begins.' },
    {
      k: 'details', blocks: [
        { k: 'p', t: 'Order: as a round ends, the player who started it moves to the end of the turn order. The round-end turns already follow the new order, so the next round\'s first player goes first.' },
        { k: 'p', t: 'Running your meeple\'s building works whether or not its number was rolled. You pay the Power Tokens as usual. A factory whose output is full cannot run: collect first, then run, then collect again if you like.' },
        { k: 'p', t: 'Loading only fills empty input slots; you can never swap or take out what is there. Only a material that keeps a valid recipe possible can go in. See [[factories|Factories and recipes]].' },
        { k: 'p', t: 'Just before the round-end turns, every input that touches a Mine\'s ore exit directly is filled with Ore. After each round-end turn, material moves along belts, so an output you leave behind is carried on at once.' },
        { k: 'p', t: `The upgrade-point credits depend on the number of Mines at the end of the round: ${perMineWords(mineCredits)}.` },
      ],
    },
  ],
  see: ['claiming', 'step-meeple', 'online'],
};
