// Start here: the goal, what is on the table, the screen, and starting a game.

import {
  BELT_COUNT, CONTROL_MODULE_MAX, FACTORY_RECIPES, INVENTORY_CAP, MATERIAL_VALUES, MAX_CARDS_PLAYED_PER_TURN,
  POWER_TOKEN_CAP, STACK_COMPOSITION, STARTING_POWER_TOKENS, TELEPORTER_COUNT, TESSERACTS_TO_WIN,
} from '../../../engine/config';
import type { Topic } from '../types';
import {
  BUILDING_NAME, MATERIALS, MATERIAL_NAME, MINE_RESOURCE_REWARD, PLAYER_COUNTS, STACK_PIECE_TYPES, amount, count, listWords, recipeWords,
  stackSize, startingPiecesPerPlayer, startingPiecesWords, totalPieces,
} from './facts';
import {
  BOARD_PIECES_FIGURE, CARD_AND_DICE_FIGURE, FACTORY_TILE_FIGURE, MATERIALS_FIGURE, MINES_FIGURE, PLAYER_AREA_FIGURE,
  PLAYER_PIECES_FIGURE, SETUP_FIGURE,
} from './figures';

const makes = (type: 'plateFact' | 'sphereFact' | 'tesseractFact'): string => {
  const r = FACTORY_RECIPES[type]!;
  const ins = r.inputs.map(recipeWords);
  return `Turns ${ins.length === 1 ? ins[0] : `${ins.slice(0, -1).join(', ')} or ${ins[ins.length - 1]}`} into 1 ${MATERIAL_NAME[r.product]}.`;
};

export const goal: Topic = {
  id: 'goal',
  title: 'The goal of the game',
  summary: `Make ${TESSERACTS_TO_WIN} Tesseracts before anyone else does.`,
  blocks: [
    { k: 'p', t: 'Welcome, glorious pioneers, to asteroid A535b88R. Your homeland, in its infinite wisdom, has sent you — its most expendable asset — to manufacture the legendary Tesseract. The buildings were dropped near the main Mine by a pilot with one working eye, so they lie scattered about, and the other pioneers want them too.' },
    { k: 'p', t: `You win by holding **${TESSERACTS_TO_WIN} Tesseracts** during your own turn. Bonus cards for special achievements each count as one Tesseract toward that total.` },
    { k: 'h', t: 'How you get there' },
    {
      k: 'steps', items: [
        '**Mines** give out Ore without end, to any of your buildings connected to them.',
        `**Plate Factories** turn Ore into Plates, **Sphere Factories** turn Ore and Plates into Spheres, and **Tesseract Factories** turn the lot into Tesseracts.`,
        'You **claim** a building by putting one of your numbered **Control Modules** on it. When the dice show that number, the building runs.',
        'Factories need **Power Tokens** to run. **Power Plants** make them.',
        '**Belts** carry material from Mines and factory outputs to factory inputs, so your production chain runs by itself.',
      ],
    },
    { k: 'p', t: 'If the board pieces run out before anyone has won, the round is played to its end and then the player whose materials are worth the most wins. See [[winning|Winning and the end of the game]].' },
    { k: 'h', t: 'Materials and their value', id: 'values' },
    MATERIALS_FIGURE,
    { k: 'p', t: `Each material has a value: ${listWords(MATERIALS.map(m => `${MATERIAL_NAME[m]} ${MATERIAL_VALUES[m]}`))}. Prices are paid in value, and value decides the winner if the pieces run out. You can hold at most **${INVENTORY_CAP} of each material** and **${POWER_TOKEN_CAP} Power Tokens**; anything more is lost.` },
    { k: 'note', tone: 'tip', t: 'New to the game? Read [[turn|Your turn at a glance]], then start a solo game against bots. Whatever you can do right now glows, and the game never lets you make an illegal move, so you can learn by trying.' },
  ],
  see: ['turn', 'table'],
};

export const table: Topic = {
  id: 'table',
  title: 'What is on the table',
  summary: 'Mines, buildings, blank tiles, the three stacks, and what each player owns.',
  blocks: [
    { k: 'p', t: 'The board grows during the game: every turn adds a six-sided piece next to the pieces already there.' },
    { k: 'h', t: 'The board pieces', id: 'pieces' },
    BOARD_PIECES_FIGURE,
    MINES_FIGURE,
    {
      k: 'table', head: ['Piece', 'What it does'], rows: [
        [BUILDING_NAME.mine, 'A double-size piece. Ore leaves it at its ore exits, where the printed rays and tracks reach the edge. Each Mine also has two spots for a meeple. The number of Mines on the board sets how many dice are rolled.'],
        [BUILDING_NAME.plateFact, makes('plateFact')],
        [BUILDING_NAME.sphereFact, makes('sphereFact')],
        [BUILDING_NAME.tesseractFact, makes('tesseractFact')],
        [BUILDING_NAME.powerPlant, 'Makes Power Tokens. Material put into it makes more.'],
        ['Blank tile', 'No building, only holes for belts.'],
      ],
    },
    { k: 'p', t: 'Factories and Power Plants are called **buildings**. A building has an **input**, where material goes in (one slot per material its recipe needs), and — except the Power Plant — an **output**, which holds one finished material.' },
    { k: 'h', t: 'The three stacks', id: 'stacks' },
    { k: 'p', t: 'The pieces start in three face-down stacks beside the board. Stack 1 is open from the start. Stack 2 lies under the second Mine and stack 3 under the third: a stack opens when its Mine comes into play. See [[mines|Mines]].' },
    {
      k: 'table', head: ['Players', 'Stack 1', 'Stack 2', 'Stack 3', 'All pieces'],
      rows: PLAYER_COUNTS.map(n => [String(n), String(stackSize(n, 0)), String(stackSize(n, 1)), String(stackSize(n, 2)), String(totalPieces(n))]),
      caption: 'Pieces in each stack (Mines not included)',
    },
    {
      k: 'details', title: 'What exactly is in each stack?', blocks: [
        { k: 'p', t: `The stacks are shuffled, so you never know the order. Before the first turn, ${startingPiecesWords()} per player are taken out of stack 1 and laid around the first Mine, so stack 1 is ${startingPiecesPerPlayer()} pieces per player smaller when play begins.` },
        ...PLAYER_COUNTS.map(n => ({
          k: 'table' as const, caption: `${n} players`, head: ['Piece', 'Stack 1', 'Stack 2', 'Stack 3'],
          rows: STACK_PIECE_TYPES.map(t => [t === 'blank' ? 'Blank tile' : BUILDING_NAME[t], ...STACK_COMPOSITION[n].map(s => String(s[t]))]),
        })),
      ],
    },
    { k: 'h', t: 'What each player has', id: 'components' },
    {
      k: 'list', items: [
        `**${CONTROL_MODULE_MAX} Control Modules**, numbered 1 to ${CONTROL_MODULE_MAX}, in your tray.`,
        '**1 meeple.**',
        `**${STARTING_POWER_TOKENS} Power Tokens** to start with (you can hold up to ${POWER_TOKEN_CAP}).`,
        `**${BELT_COUNT} belts** (you can buy more).`,
        `**${TELEPORTER_COUNT} teleporters.**`,
        `A hand for **Leverage cards**, empty at the start. You may play ${MAX_CARDS_PLAYED_PER_TURN} per turn.`,
      ],
    },
    PLAYER_PIECES_FIGURE,
    CARD_AND_DICE_FIGURE,
    { k: 'p', t: `You start with no materials. They come from your buildings, from Leverage cards, and from a Mine's resource point (the first Mine's gives ${amount(MINE_RESOURCE_REWARD[0]!.n, MINE_RESOURCE_REWARD[0]!.material)}). The bank never runs out.` },
    { k: 'h', t: 'Connection points', id: 'points' },
    { k: 'p', t: 'Each single piece has 12 points around its edge, 2 on each side. Where two pieces touch, their points line up in pairs. That is how material moves from piece to piece: an output that touches an input of another building of the same player passes material across, and belts run from point to point. See [[belts|Belts]].' },
    FACTORY_TILE_FIGURE,
  ],
  see: ['screen', 'factories', 'belts'],
};

export const screen: Topic = {
  id: 'screen',
  title: 'Finding your way around the screen',
  summary: 'The turn bar, your area, the bank, the reference tabs and the buttons.',
  blocks: [
    { k: 'p', t: 'Whatever you can do right now **glows**. Tap it and the game shows what will happen; then press **Confirm** (the tick) or **Cancel** (the cross). A piece you are placing can be turned with the turn button before you confirm. If you tap something that is not possible right now, the game tells you why.' },
    { k: 'h', t: 'Along the top' },
    {
      k: 'list', items: [
        '**The turn bar** shows whose turn it is, the four steps of a turn with the current one marked, the round number, and any countdown.',
        '**Other players**: a chip for each opponent with their materials, Power Tokens, cards and belts. Tap one for everything about that player.',
        '**The round buttons** at the top right: **Turn the table 60°**, **Re-centre**, **Top-down view** (a view from straight above), and the book, which opens this **Game guide**. Turning the table keeps the board in the part of the screen your panels leave free.',
        '**The game menu** (the ☰ button): **Copy save link**, **Download save file**, **Share save…**, **Save replay**, **Watch this game again**, **Report a rules problem**, **Autoplay my seat** (a bot plays for you), **Switch to the text view**, **Game guide**, the animation, sound and vibration settings, and **Leave game**. The version of the game is shown at its foot.',
      ],
    },
    { k: 'h', t: 'Your area' },
    { k: 'p', t: 'Your area holds your Control Module tray, your meeple, your Power Tokens, belts, teleporters, your materials with their **Total Value** (for example "Total Value: 11"), and the Leverage cards in your hand. On a phone it is the sheet at the bottom of the screen; pulled down, it shows your materials with their total after an equals sign ("= 11"). Pull it up for the tabs **Tray**, **Cards**, **Log** and **Rules**.' },
    PLAYER_AREA_FIGURE,
    {
      k: 'list', items: [
        'The **Belts** tile reads **Lay a belt** and glows when you can lay belts: press it to start. **Remove** beside it takes one of your belts back. See [[belts|Belts]].',
        'The **Teleporters** tile reads **Place a teleporter** and glows when you can place one. When you cannot, pressing it tells you why: none left, too little material value, or no free input or output on your buildings. See [[teleporters|Teleporters]].',
        'Pressing a **Plate**, **Sphere** or **Tesseract** in your materials offers to exchange it for smaller materials: the game asks, for example, "Exchange 1 Sphere for 2 Plates and 1 Ore?", and **Exchange** confirms. See [[bank#exchange|Exchanging]].',
        'Your **Leverage cards**: tap one to read it and play it.',
      ],
    },
    { k: 'h', t: 'The bank' },
    { k: 'p', t: 'The bank sells a **Belt**, a **Leverage card**, a **Mine** and a **Teleporter**, each with its price in material value, and has **Exchange** for breaking materials down. On a desktop the bank sits at the top right; on a phone it is in the **Tray** tab. A greyed item tells you why when you tap it. See [[bank|The bank]].' },
    { k: 'h', t: 'The reference tabs' },
    { k: 'p', t: 'On a desktop, the tabs on the right edge open the **Log** (everything that has happened), the **Rules** reference (one page with the current prices), and **Bonuses** (who holds each bonus card). On a phone they are in the sheet.' },
    { k: 'h', t: 'Using the table' },
    {
      k: 'list', items: [
        'Tap a **building** to see its Control Modules, what is in its input and output, and what you can do with it right now: claim it, upgrade a Control Module, load material, run it, or collect its output.',
        'Drag to move around the table; pinch, or use the mouse wheel, to zoom.',
        'Each player first sees the table from their own side, as if sitting around it. The turn button turns it 60° at a time.',
      ],
    },
    { k: 'note', tone: 'tip', t: 'Prefer a list to a 3D table? **Switch to the text view** in the game menu shows every move you can make as a button. It has its own menu, with this guide in it too.' },
  ],
  see: ['turn', 'online'],
};

export const starting: Topic = {
  id: 'starting',
  title: 'Starting a game',
  summary: 'Hosting, joining with a room code, playing against bots, and the setup the game does for you.',
  blocks: [
    { k: 'p', t: 'Type your name on the start menu first (**Your name**). It is how the others see you, and how you get your seat back when a saved game is resumed. The version of the game is shown under the title: a large number such as **0.1** with a smaller one such as **.02** after it.' },
    { k: 'h', t: 'Three ways to play' },
    {
      k: 'list', items: [
        '**Host a game** gives you a 5-letter room code. Your browser runs the game, and the other players connect to you directly; there is no game server in between.',
        '**Join a game**: type the host\'s 5-letter code and press **Join a game**, or open the invite link the host sent you.',
        '**Play solo vs bots**: a game on this device only, against bots. It needs no network; once the app is installed it also works offline.',
      ],
    },
    { k: 'p', t: 'The start menu also lists your saved games (**Resume**), and has **Game guide**, **Load a save (link or file)** and **Watch a replay**.' },
    { k: 'h', t: 'The lobby' },
    {
      k: 'list', items: [
        'The host chooses the number of players (2, 3 or 4) and fills empty seats with bots (**Add bot**). Each bot seat has a drop-down for the kind of bot that plays it; everyone sees the kind on the seat. See [[online#bots|Bots]].',
        'A bot seat is named after its kind ("Smart Bot", "Smart Bot 2"), and is renamed when the host changes its kind. A player\'s seat handed to a bot keeps the player\'s name.',
        'Everyone picks a colour.',
        'Players press **Ready**; the host presses **Start** once everyone is ready.',
        'The host also sets the bot speed and the timers. See [[online#timers|Timers]].',
      ],
    },
    { k: 'p', t: 'A solo game opens on its **Game set-up** screen instead: the number of players, the bot speed, your colour, and the kind of bot for each opponent, then **Start**.' },
    { k: 'h', t: 'What the game sets up for you', id: 'setup' },
    {
      k: 'steps', items: [
        `Every player gets ${CONTROL_MODULE_MAX} Control Modules, 1 meeple, ${STARTING_POWER_TOKENS} Power Tokens, ${count(BELT_COUNT, 'belt')} and ${count(TELEPORTER_COUNT, 'teleporter')}.`,
        'The Leverage card deck is shuffled.',
        'The board pieces are dealt into three stacks for your number of players, and each stack is shuffled. Stacks 2 and 3 are covered by the second and third Mines.',
        'The first Mine is put in the middle of the table.',
        `From stack 1, ${startingPiecesWords()} per player are taken out, shuffled, turned at random and laid clockwise around the first Mine.`,
        'A starting player is chosen at random.',
      ],
    },
    { k: 'h', t: 'Your first claims', id: 'first-claims' },
    { k: 'p', t: 'Before the first turn, every player claims two of the starting buildings, for free:' },
    {
      k: 'steps', items: [
        '**Plate Factories** first, in turn order beginning with the starting player: each player claims one of the starting Plate Factories with their Control Module **3**.',
        '**Power Plants** next, in the reverse order, so the starting player picks last: each player claims a Power Plant with their Control Module **2**.',
      ],
    },
    { k: 'p', t: 'When it is your pick, the buildings you can claim glow: tap one and confirm.' },
    SETUP_FIGURE,
    {
      k: 'details', blocks: [
        { k: 'p', t: 'With one Mine, one die is rolled, so only 1 to 6 can come up. Your Plate Factory runs on a 3 and your Power Plant on a 2.' },
        { k: 'p', t: 'The order evens out the choice: the player who picks the first Plate Factory picks the last Power Plant.' },
        { k: 'p', t: 'Look at where Ore can reach your Plate Factory: one whose input touches an ore exit of the Mine fills with Ore by itself. See [[moving|Moving material]].' },
        { k: 'p', t: 'The printed rulebook runs the two rounds of picks the other way round. See [[printed#setup|Differences from the printed rulebook]].' },
      ],
    },
  ],
  see: ['turn', 'online'],
};
