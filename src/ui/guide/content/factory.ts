// Running your factory: claims, production, recipes, moving material, belts, teleporters, bank.

import type { Material } from '../../../engine/config';
import {
  BELT_COST, BELT_COUNT, FACTORY_OP_TIMEOUT_MS, FACTORY_POWER_COST, FACTORY_RECIPES, INVENTORY_CAP, MATERIAL_VALUES,
  MAX_CLAIMS_PER_BUILDING, MINE_COUNT, POWER_PLANT_BASE_YIELD, POWER_PLANT_INPUTS, POWER_PLANT_MATERIAL_YIELD,
  POWER_TOKEN_CAP, PRODUCTION_INCREASE_BUDGET, TELEPORTER_COUNT, cardCost, teleporterCost,
} from '../../../engine/config';
import type { Topic } from '../types';
import {
  BUILDING_NAME, FACTORY_TYPES, MATERIALS, MATERIAL_NAME, MINE_NUMBERS, amount, cardPriceWords, count, exchangeDown,
  exchangeWords, listWords, mineExits, minePriceWords, piecePoints, pointRanges, recipeWords, upgradePointWords,
} from './facts';

const claimCost = (module: number, mines: number): number => module - mines + 1;

function claimCostRows(): string[][] {
  const rows: string[][] = [];
  for (let m = 1; m <= 8; m++) {
    rows.push([String(m), ...MINE_NUMBERS.map(mines => (m < mines ? 'not allowed' : count(claimCost(m, mines), 'upgrade')))]);
  }
  return rows;
}

export const claiming: Topic = {
  id: 'claiming',
  title: 'Claiming and upgrading buildings',
  summary: 'Control Modules, what a claim costs, and where upgrades come from.',
  blocks: [
    { k: 'p', t: 'A building is yours while one of your Control Modules is on it. The number on the module is the dice total that activates the building. A higher number is not better in itself: what matters is how often that total is rolled. See [[step-roll#odds|Which totals come up]].' },
    { k: 'h', t: 'Upgrades are the currency', id: 'upgrades' },
    { k: 'p', t: 'Claims and upgrades are paid in **upgrades**, never in materials. Upgrades come from three places:' },
    {
      k: 'list', items: [
        `**Free upgrades** at the end of every round: one per Mine, for raising Control Modules on a single building.`,
        `**Mine credits**: your meeple on a Mine's upgrade point earns the number printed on that Mine at the end of the round (${upgradePointWords()}). They pay for one claim and for upgrades on any of your buildings.`,
        `**Production Increase** (a Leverage card): ${PRODUCTION_INCREASE_BUDGET} upgrades to spend in the turn you play it, in any of its steps, with at most one claim among them.`,
      ],
    },
    { k: 'h', t: 'Upgrading', id: 'upgrade' },
    { k: 'p', t: 'Swap a Control Module on one of your buildings for a higher one from your tray. It costs the difference: changing a 4 for a 6 costs 2 upgrades. The old module goes back to your tray. Tap the building: its menu offers what you can pay for right now — **Upgrade with end-of-round upgrades**, **Upgrade with Mine credits**, or, with Production Increase, **Upgrade a Control Module** — then tap a glowing Control Module in your tray.' },
    { k: 'h', t: 'Claiming', id: 'claim' },
    { k: 'p', t: 'Put a Control Module from your tray on a building nobody else has claimed. The lowest module you may place equals the number of Mines (the **claim floor**), and it costs 1 upgrade; each step higher costs 1 more:' },
    { k: 'note', t: '**Cost of placing module M = M − number of Mines + 1**' },
    { k: 'p', t: 'Tap the building and choose **Claim with your free claim** (paid with Mine credits, in your round-end turn) or, with Production Increase, **Claim with a Control Module**; then tap a glowing Control Module in your tray.' },
    { k: 'table', head: ['Module', ...MINE_NUMBERS.map(m => (m === 1 ? '1 Mine' : `${m} Mines`))], rows: claimCostRows(), caption: 'What a claim costs' },
    { k: 'note', tone: 'example', t: 'With 2 Mines and 4 upgrades you can claim a building with module 5 (5 − 2 + 1 = 4) — the 1 is skipped because it is below the floor.' },
    { k: 'p', t: `You can put up to **${MAX_CLAIMS_PER_BUILDING}** of your Control Modules on the same building, so it activates on more totals. Each extra claim costs the same as a new claim.` },
    {
      k: 'details', blocks: [
        { k: 'p', t: 'Each upgrade is paid from one source. Free upgrades, Mine credits and Production Increase cannot be added together into one bigger upgrade, but you can upgrade the same building twice in a row, once from each source — for example 4 → 6 with free upgrades, then 6 → 9 with Mine credits.' },
        { k: 'p', t: 'Free upgrades all go to one building: once you have used one, the rest can only go to that building (to any of your modules there).' },
        { k: 'p', t: 'Every claim must be paid for: with Mine credits (one claim per round) or with Production Increase (one claim per card). Only two claims are free: your first claims before the first turn, and Short Sale.' },
        { k: 'p', t: 'The module you place must be in your tray. A module already on another building is not in your tray: to free it, upgrade that building past it first.' },
        { k: 'p', t: `Modules below the number of Mines can no longer be placed. With ${MINE_COUNT} Mines your ${listWords(Array.from({ length: MINE_COUNT - 1 }, (_, i) => String(i + 1)))} are of no more use: they can never be rolled. The game greys them out, in your tray and on the board; tap one in your tray to see why. One already on a building stays there, and you can upgrade it to a higher one.` },
        { k: 'p', t: 'Nothing puts your module on a building another player has claimed: Short Sale and Changing Priorities, too, go only to an unclaimed building or one you already hold a claim on. See their card entries in [[cards|Leverage cards]].' },
      ],
    },
  ],
  see: ['round-end', 'cards#productionIncrease', 'bonuses'],
};

const powerRows = (): string[][] => [
  ['Nothing', `+${POWER_PLANT_BASE_YIELD}`],
  ...POWER_PLANT_INPUTS.map(m => [`1 ${MATERIAL_NAME[m]}`, `+${POWER_PLANT_MATERIAL_YIELD[m as keyof typeof POWER_PLANT_MATERIAL_YIELD]}`]),
];

export const production: Topic = {
  id: 'production',
  title: 'Production: running buildings',
  summary: 'What a roll does, Run it or Skip, and Power Tokens.',
  blocks: [
    { k: 'p', t: 'When the dice total matches a Control Module on a building, that building activates — on anyone\'s turn, whoever rolled.' },
    { k: 'h', t: 'Power Plants', id: 'power-plants' },
    { k: 'p', t: 'A Power Plant runs by itself and gives its owner Power Tokens. If material sits in its input, it uses that up and gives more:' },
    { k: 'table', head: ['In its input', 'Power Tokens'], rows: powerRows() },
    { k: 'p', t: 'With your teleporter on its input, a Power Plant whose input is empty does not run by itself: the game asks **Your Power Plant runs. Provide a material for more Power Tokens?** Choose **Run it as it is** or one of the materials you hold. It always runs, so there is no Skip — unless you are already at the Power Token limit, when Skip is the only answer. See [[teleporters#supply|Supplying through a teleporter]].' },
    { k: 'p', t: `A Tesseract never goes into a Power Plant. You can hold up to ${POWER_TOKEN_CAP} Power Tokens.` },
    { k: 'h', t: 'Factories', id: 'factories' },
    { k: 'p', t: 'A factory activates only if it could run right now: its input holds a complete recipe (or, with your teleporter on its input, you hold materials that complete one), its output is empty, and you have the Power Tokens. The game then asks you:' },
    {
      k: 'list', items: [
        '**Run it**: pay the Power Tokens, use up everything in its input, and put the product in its output.',
        'With your teleporter on its input: one button for each set of your materials that can fill its empty slots, such as **Provide a Sphere and a Plate** or **Provide 2 Spheres**, and **Run it with what is in it** when its input is already full. See [[teleporters#supply|Supplying through a teleporter]].',
        '**Skip**: nothing happens, and you keep your Power Tokens and materials.',
      ],
    },
    { k: 'table', head: ['Factory', 'Power Tokens to run'], rows: FACTORY_TYPES.map(t => [BUILDING_NAME[t], String(FACTORY_POWER_COST[FACTORY_RECIPES[t]!.product as Exclude<Material, 'ore'>])]) },
    { k: 'p', t: 'The product **stays in the output**, which holds one material. From there it moves on to another of your buildings by direct contact or belt, or you collect it with your meeple, an output teleporter or Personal Jet Pack. A factory with a full output cannot run again. See [[moving|Moving material]].' },
    { k: 'h', t: 'Answering on someone else\'s turn', id: 'off-turn' },
    { k: 'p', t: `Your factories can activate on other players' turns. The question appears on your own device. Online, if you do not answer within the operate timer (${Math.round(FACTORY_OP_TIMEOUT_MS / 1000)} seconds unless the host changed it), the game runs the building only if it can run without your materials (from what is already in its input; a Power Plant as it is), and skips it otherwise — it never hands over anything from your inventory. On your own turn there is no timer: the game waits for your answer, and you must answer before doing anything else.` },
    {
      k: 'details', blocks: [
        { k: 'p', t: 'The power cost depends on what the factory makes, not on what goes in: every Tesseract recipe costs the same.' },
        { k: 'p', t: `A Power Plant does nothing while you hold ${POWER_TOKEN_CAP} Power Tokens, and keeps its input. Below ${POWER_TOKEN_CAP}, it uses its input and gives tokens up to ${POWER_TOKEN_CAP}; the rest are lost. Example: with ${POWER_TOKEN_CAP - 1} tokens and a Sphere in its input, you end with ${POWER_TOKEN_CAP} and the Sphere is gone.` },
        { k: 'p', t: 'When a building runs, a Mine it touches directly refills its input with Ore at once.' },
        { k: 'p', t: 'If two players share a building and both have the rolled number on it, each is asked. Whoever runs it first fills the output, so the other then can only skip.' },
        { k: 'p', t: 'A factory that cannot run at the moment of the roll (missing input, full output, too few Power Tokens) does not ask at all, and does not run later in the turn.' },
      ],
    },
  ],
  see: ['factories', 'moving', 'step-roll'],
};

export const factories: Topic = {
  id: 'factories',
  title: 'Factories and recipes',
  summary: 'What each factory takes and makes.',
  blocks: [
    {
      k: 'table', head: ['Factory', 'Takes any one of', 'Makes', 'Power'],
      rows: FACTORY_TYPES.map(t => {
        const r = FACTORY_RECIPES[t]!;
        return [BUILDING_NAME[t], r.inputs.map(recipeWords).join(' · '), `1 ${MATERIAL_NAME[r.product]}`, String(FACTORY_POWER_COST[r.product as Exclude<Material, 'ore'>])];
      }),
    },
    { k: 'p', t: `A ${BUILDING_NAME.powerPlant} takes one ${listWords(POWER_PLANT_INPUTS.map(m => MATERIAL_NAME[m]), 'or')}, or runs empty. See [[production#power-plants|Power Plants]].` },
    { k: 'p', t: 'Materials can arrive in any order and any slot; only the set counts. A Tesseract is never an input.' },
    { k: 'h', t: 'Getting material in' },
    {
      k: 'list', items: [
        'From a Mine or another building\'s output, by direct contact or along belts. See [[moving|Moving material]].',
        'From your own materials, with your meeple on the building, in your round-end turn.',
        'From your own materials, through your teleporter on its input, at the moment the building runs — only the materials you choose.',
      ],
    },
    {
      k: 'details', blocks: [
        { k: 'p', t: 'An input accepts a material only if a valid recipe is still possible afterwards. A Sphere Factory holding an Ore will not take a second Ore, because there is no Ore + Ore recipe — whether that Ore comes from a Mine, a belt or your hand. Refused material stays where it was.' },
        { k: 'note', tone: 'example', t: 'A Tesseract Factory holding Ore + Plate can only take a Sphere next. One holding Ore can take a Plate or a Sphere, but never a second Ore.' },
        { k: 'p', t: 'Material in an input cannot be taken out again. A factory empties its input only by running.' },
        { k: 'p', t: 'Only claimed buildings receive material. An unclaimed building\'s input stays empty.' },
        { k: 'p', t: 'Through an input teleporter you choose, when the building runs, which of your materials fill its empty slots; nothing is taken unless you choose it. See [[teleporters#supply|Supplying through a teleporter]].' },
      ],
    },
  ],
  see: ['production', 'moving', 'teleporters'],
};

export const moving: Topic = {
  id: 'moving',
  title: 'Moving material',
  summary: 'Direct contact, belts, your meeple and teleporters.',
  blocks: [
    { k: 'p', t: 'Material moves by itself between pieces. There are four ways to get it where you want it:' },
    {
      k: 'list', items: [
        '**Direct contact**: a Mine\'s ore exit, or a building\'s output, touching the input of a claimed building. No belt needed.',
        '**Belts**: a chain of belts from a source to an input. See [[belts|Belts]].',
        '**Your meeple** on your building lets you load its input and collect its output in your round-end turn.',
        '**Teleporters** connect a building\'s input or output with your materials. See [[teleporters|Teleporters]].',
      ],
    },
    { k: 'p', t: 'Mines never run out. An input connected to an ore exit is filled again whenever material moves.' },
    { k: 'h', t: 'When material moves', id: 'when' },
    {
      k: 'list', items: [
        'When the dice are rolled: just before the buildings run, and again just after.',
        'When the player taking actions presses **Done with actions**.',
        'After each round-end turn.',
        'In addition, a Mine refills an input it touches directly as soon as that building runs, and just before the round-end turns.',
      ],
    },
    {
      k: 'details', title: 'How exactly does material move?', blocks: [
        { k: 'p', t: 'Each time material moves, the game goes through these steps once, in this order:' },
        {
          k: 'steps', items: [
            'Output teleporters send whatever sits in their buildings\' outputs to their owners (up to the limit of 6).',
            'Mines fill every empty input of a claimed building that touches an ore exit directly.',
            'Every output that touches the input of another claimed building passes its material across.',
            'Then, building by building, every empty input with a belt end facing it is traced back along its belt chain. If the far end faces a Mine\'s ore exit, an Ore arrives. If it faces a building\'s output holding material, that material moves.',
          ],
        },
        { k: 'p', t: 'So material moves one hop at a time: a Plate made in one factory reaches the next factory\'s input the next time material moves.' },
        { k: 'note', tone: 'example', t: 'You roll your Plate Factory\'s number and choose **Run it**. The Plate sits in its output. When you press **Done with actions**, it travels along your belt into your Sphere Factory\'s input.' },
        { k: 'p', t: 'Material enters an input only if the slot is empty, the building is claimed, and a valid recipe is still possible. Otherwise it stays in the output (or, for Ore, simply stays in the Mine).' },
        { k: 'p', t: 'An output feeds at most one place: the piece it touches, or the one belt chain that starts there.' },
      ],
    },
  ],
  see: ['belts', 'teleporters', 'factories'],
};

function pointsTable(): Topic['blocks'][number] {
  return {
    k: 'table', head: ['Piece', 'Belt holes', 'Input', 'Output'],
    rows: piecePoints().map(p => [
      p.type === 'blank' ? 'Blank tile' : BUILDING_NAME[p.type],
      `${pointRanges(p.belt)} (${p.belt.length})`,
      pointRanges(p.input) === 'none' ? '—' : pointRanges(p.input),
      pointRanges(p.output) === 'none' ? '—' : pointRanges(p.output),
    ]),
    caption: 'Points are numbered #1 to #12, from the lower point of the input side, clockwise',
  };
}

function mineExitWords(): string {
  const { rich, lean } = mineExits();
  const withLean = lean.map((n, i) => ({ n, mine: i + 1 })).filter(x => x.n > 0);
  const without = lean.map((n, i) => ({ n, mine: i + 1 })).filter(x => x.n === 0).map(x => String(x.mine));
  const leanText = withLean.map(x => `Mine ${x.mine} has ${count(x.n, 'exit')} on its smaller half, one on every other edge`).join('; ');
  return `A Mine has no holes. Ore leaves it at its **ore exits**: ${rich} on its larger half, on both points of every outer edge. ${leanText}${without.length ? `; Mines ${listWords(without)} release no Ore from their smaller half` : ''}.`;
}

export const belts: Topic = {
  id: 'belts',
  title: 'Belts',
  summary: 'Laying belts, where they can go, and whose belts carry what.',
  blocks: [
    { k: 'p', t: 'A belt lies on one piece and links two of its connection points. It never crosses from one piece to another. Instead, belts **chain**: where a belt ends at the edge of a piece, the next belt can start at the matching point of the neighbouring piece.' },
    { k: 'p', t: 'A chain carries material from a **source** — a Mine\'s ore exit or a building\'s output — to the **input** of a claimed building, when its first and last belts end at the points facing them.' },
    { k: 'h', t: 'Laying belts', id: 'laying' },
    {
      k: 'steps', items: [
        'Press **Lay a belt** (the Belts tile in your area).',
        'Tap a glowing connection point where the belts should start.',
        'Tap where they should end. The game shows the shortest route between the two points, even if you cannot lay all of it yet, and says how many belts it needs.',
        'Lay it: **Place 3 belts** when your supply has enough, **Place 2 from inventory** to lay what your supply holds, **Buy 1 and place 3** to buy the missing belts first — or **Keep the plan for a later turn**.',
      ],
    },
    { k: 'p', t: 'A plan you keep is offered again the next time you press **Lay a belt**: **Continue your planned route**.' },
    { k: 'p', t: 'On the table each belt points the way material flows along it. While a chain is not yet connected to a source or an input, it points from where you started to where you ended; once the flow is known, the whole chain turns to match it.' },
    { k: 'h', t: 'Where belts can go', id: 'rules' },
    {
      k: 'list', items: [
        'A belt\'s two ends must be **more than two points apart** around the piece: it cannot run along one edge or cut across a single corner.',
        'Each connection point holds one belt.',
        'Belts lie on blank tiles and on the holes of building pieces — anyone may lay belts across anyone\'s building. They never lie on a Mine, and never end on an input or output itself: the belt ends on the neighbouring piece, at the point facing it.',
        'A belt end may not face the input or output of a building claimed only by other players. Those points are reserved for its owners.',
        'A belt end may not meet another player\'s belt across an edge, so you cannot join or extend someone else\'s chain.',
        '**Only one belt per turn** may have an end facing a Mine\'s ore exit.',
      ],
    },
    { k: 'h', t: 'Whose belts carry material', id: 'whose' },
    { k: 'p', t: 'Your belts serve your buildings. A belt end facing the input or output of a building claimed only by other players is a **dead end**: it neither feeds that building nor draws from it. That can happen when someone else claims a building after your belt was laid. The belt stays on the board and works again if you gain a claim on that building, or if it becomes unclaimed.' },
    { k: 'h', t: 'Buying and removing', id: 'buying' },
    { k: 'p', t: `You start with ${count(BELT_COUNT, 'belt')}. Buy more from the bank for ${BELT_COST} each. In your actions step you can remove any of your belts (**Remove**, tap one of your glowing belts, then **Remove this belt**); it goes back to your supply, ready to be laid again for free. **Undo belts** removes all the belts you laid this turn, and lets you lay a belt at a Mine again.` },
    { k: 'h', t: 'Which holes take a belt', id: 'points' },
    { k: 'p', t: 'A building\'s input and output points have no hole; every other hole on a building piece takes a belt, for any player.' },
    pointsTable(),
    { k: 'p', t: mineExitWords() },
    {
      k: 'details', blocks: [
        { k: 'p', t: 'Counting points the short way round: #1 to #2 is 1 apart (the same edge), #1 to #3 is 2 apart (across one corner), #1 to #4 is 3 apart — allowed. On a blank tile, a belt from #1 can go to any of #4 to #10.' },
        { k: 'p', t: 'Material does not move along a new belt until material next moves — for belts you lay, when you press **Done with actions**. Until then you can change your mind.' },
        { k: 'p', t: 'The Mine limit counts only belt ends facing an ore exit. A belt end facing a part of a Mine with no exit does not count, and carries nothing.' },
        { k: 'p', t: 'Reserved points: if a building has several owners, each of them may lay belts to its input and output. Anyone may lay belts to an unclaimed building.' },
        { k: 'p', t: 'A chain is always one player\'s belts, because belts of different players cannot meet.' },
        { k: 'p', t: 'If Sink Hole removes a piece with belts on it, those belts go back to their owners\' supplies.' },
        { k: 'p', t: 'Belts count toward the Belt Weaver bonus. See [[bonuses|Bonus Tesseracts]].' },
      ],
    },
  ],
  see: ['moving', 'bonuses', 'teleporters'],
};

export const teleporters: Topic = {
  id: 'teleporters',
  title: 'Teleporters',
  summary: 'Feed a building from your materials, or send its output straight to you.',
  blocks: [
    { k: 'p', t: `Each player has ${count(TELEPORTER_COUNT, 'teleporter')}. A teleporter goes on the input or the output of one of your buildings, one per buffer. It connects that buffer with your materials, wherever the building is.` },
    {
      k: 'list', items: [
        '**On an input**: when the building runs, you may hand over materials of your own to fill its empty input slots — on any player\'s turn. You choose them; nothing is ever taken on its own.',
        '**On an output**: whatever the building makes goes straight into your materials. Anything sitting in that output is sent to you as soon as you have room.',
      ],
    },
    { k: 'h', t: 'Placing a teleporter' },
    { k: 'p', t: 'In your actions step, press the **Teleporters** tile in your area. It reads **Place a teleporter** and glows when you can place one; when you cannot, pressing it tells you why (none left, too little material value, or no free input or output on your buildings). Then tap the input or output of one of your buildings, and confirm. A building\'s menu also offers **Teleporter on the input** and **Teleporter on the output**.' },
    { k: 'p', t: `**Price: the number of teleporters on the board (all players) + 1.** The first costs ${teleporterCost(0)}, the next ${teleporterCost(1)}, and so on. It is paid with change like any purchase: a lone Sphere can pay for a teleporter costing ${teleporterCost(2)}. See [[bank#paying|Paying with change]].` },
    { k: 'p', t: 'You can never remove a teleporter yourself. It comes back only if you lose your last claim on its building (for example through Changing Priorities): it then returns to your supply and the price drops by one for everyone.' },
    { k: 'h', t: 'Supplying through a teleporter', id: 'supply' },
    { k: 'p', t: 'When a building with your teleporter on its input runs and a slot of its input is empty, the game shows what the building needs ("The Tesseract Factory needs a Sphere and a Plate to run", or "needs one of these" when several recipes fit), its input slots, and your materials. Below are one button for each way it can run:' },
    {
      k: 'list', items: [
        '**Provide …**: one button for each set of your materials that completes a recipe with what is already in the input, for example **Provide a Sphere and a Plate** or **Provide 2 Spheres**. Each says what running costs and makes.',
        '**Run it with what is in it**, when its input already holds a full recipe.',
        '**Skip**, for a factory.',
      ],
    },
    { k: 'p', t: 'If you do not hold the materials it needs (or lack the Power Tokens), the game says so and offers only Skip.' },
    { k: 'p', t: 'A **Power Plant** with your teleporter on its empty input asks too: **Run it as it is** (+1 Power Token) or provide one Ore, Plate or Sphere for more tokens. It always runs, so there is no Skip unless you are already at the Power Token limit.' },
    { k: 'p', t: 'The same choice appears in your round-end turn for the building your meeple stands on.' },
    {
      k: 'details', blocks: [
        { k: 'p', t: 'Only whole materials you hold go in, exactly one for each empty slot; nothing is exchanged down for it. What already lies in the input stays and is used.' },
        { k: 'p', t: `If an activation on someone else\'s turn is not answered within the operate timer (${Math.round(FACTORY_OP_TIMEOUT_MS / 1000)} seconds unless the host changed it), the building runs only if it can without your materials, and is skipped otherwise. Nothing is ever taken from your inventory without your choice.` },
        { k: 'p', t: 'An input teleporter works for its owner only.' },
        { k: 'p', t: `An output teleporter respects your limit of ${INVENTORY_CAP}: if you already hold ${INVENTORY_CAP} of that material, the product stays in the output (so the factory cannot run again) until you have room.` },
        { k: 'p', t: 'Output teleporters act first: material in a teleported output goes to you, never down a belt.' },
        { k: 'p', t: 'R&D Tax Write-Off places a teleporter for free, but it still uses one of yours and raises the price like a bought one.' },
      ],
    },
  ],
  see: ['moving', 'cards#rdTaxWriteOff', 'bank'],
};

function exchangeRows(): string[][] {
  return MATERIALS.filter(m => exchangeDown(m) !== null).map(m => [`1 ${MATERIAL_NAME[m]} (${MATERIAL_VALUES[m]})`, exchangeWords(m)]);
}

export const bank: Topic = {
  id: 'bank',
  title: 'The bank: prices, paying and exchanging',
  summary: 'What things cost, how the game pays, and breaking materials down.',
  blocks: [
    {
      k: 'table', head: ['Item', 'Price'], rows: [
        ['Belt', String(BELT_COST)],
        ['Leverage card', `Number of Mines + 1 (${cardPriceWords()})`],
        ['Mine', minePriceWords()],
        ['Teleporter', 'Teleporters on the board + 1'],
      ],
    },
    { k: 'p', t: `Prices are in material value: ${listWords(MATERIALS.map(m => `${MATERIAL_NAME[m]} ${MATERIAL_VALUES[m]}`))}. Your materials show their **Total Value**; you can buy anything whose price is no more than that.` },
    { k: 'h', t: 'Paying with change', id: 'paying' },
    { k: 'p', t: 'You do not pick which materials to hand over. The game pays so that you keep the most valuable materials possible: it hands in materials worth at least the price, and the bank gives the change back in smaller materials than the largest one handed in. A material is broken down only when it has to be.' },
    { k: 'note', tone: 'example', t: `A Leverage card costs ${cardCost(2)} with two Mines. You hold a Sphere and an Ore (worth ${MATERIAL_VALUES.sphere + MATERIAL_VALUES.ore}). The game breaks the Sphere into ${exchangeWords('sphere')}, pays with one Plate, and you keep a Plate and 2 Ore (worth ${MATERIAL_VALUES.sphere + MATERIAL_VALUES.ore - cardCost(2)}).` },
    { k: 'p', t: 'When a purchase gives change, its description says what you will keep, for example "You keep 1 Plate and 2 Ore".' },
    {
      k: 'details', title: 'Change and the limit of 6', blocks: [
        { k: 'p', t: `Change still has to fit under your limit of ${INVENTORY_CAP} of each material. Change that fits nowhere is lost. When there is more than one way to pay, the game picks the one that loses the least to the limit, and then the one that leaves you the most Tesseracts, then Spheres, then Plates, then Ore.` },
        { k: 'note', tone: 'example', t: `You hold ${amount(INVENTORY_CAP, 'plate')} and a Sphere, and buy a belt for ${BELT_COST}. The game hands in a Plate rather than the Sphere and gives 2 Ore back, so you keep ${amount(INVENTORY_CAP - 1, 'plate')}, the Sphere and 2 Ore.` },
        { k: 'p', t: 'A purchase is possible whenever the total value of your materials is at least the price, teleporters included.' },
      ],
    },
    { k: 'h', t: 'Exchanging down', id: 'exchange' },
    { k: 'p', t: 'You can break a material into smaller ones whenever it is your actions step or your round-end turn: press a Plate, Sphere or Tesseract in your materials, or the bank\'s **Exchange**.' },
    { k: 'table', head: ['Give', 'Get'], rows: exchangeRows() },
    { k: 'p', t: 'There is no exchanging up, and no trading between players.' },
    {
      k: 'details', blocks: [
        { k: 'p', t: `The limit of ${INVENTORY_CAP} per material still holds: if an exchange would take you above ${INVENTORY_CAP}, the extra is lost. The game warns you before you confirm.` },
        { k: 'p', t: 'Power Tokens cannot be bought, sold or exchanged.' },
        { k: 'p', t: 'Exchanging is free and as frequent as you like.' },
        { k: 'p', t: `Example of the limit: with ${amount(INVENTORY_CAP - 1, 'ore')}, exchanging a Plate leaves you with ${amount(INVENTORY_CAP, 'ore')}, and ${exchangeDown('plate')!.ore! - 1} are lost.` },
      ],
    },
  ],
  see: ['step-actions', 'teleporters', 'mines'],
};
