// The guide's animated examples, second batch: production, moving material, belts, Teleporters,
// actions and the bank, the meeple and the end of a round, Mines, Leverage cards, bonuses and
// winning, and one whole turn. Each is real engine moves on a real or staged board, played with
// the game's own animation code; __tests__/morePlays.test.ts replays each and checks the numbers
// its captions give. Mines sit at (0,0) (their second half at (1,0)) on the staged boards.

import {
  BELT_COST, FACTORY_POWER_COST, MINE_COSTS, POWER_PLANT_BASE_YIELD, POWER_PLANT_MATERIAL_YIELD, cardCost, teleporterCost,
} from '../../../engine/config';
import type { FigureBlock, PlayExample, ScenePiece } from '../figures/types';

const MINE: ScenePiece = { id: 'mine-1', type: 'mine', q: 0, r: 0 };
const play = (alt: string, caption: string, ex: PlayExample): FigureBlock => ({ k: 'figure', alt, caption, show: { kind: 'play', play: ex } });

// ── Production ─────────────────────────────────────────────────────────────────────────────────

export const PRODUCTION_PLAY: PlayExample = {
  id: 'production',
  start: {
    scene: {
      pieces: [
        MINE,
        { id: 'pf', type: 'plateFact', q: -1, r: 0, rot: 3, claims: [[0, 4]], input: ['ore'] },
        { id: 'sf', type: 'sphereFact', q: -2, r: 1, rot: 1, claims: [[1, 4]], input: ['ore', null] },
        { id: 'opf', type: 'plateFact', q: 0, r: 1, rot: 1, claims: [[2, 4]], input: ['ore'], output: ['plate'] },
      ],
    },
    turn: { seat: 0, phase: 'roll' },
  },
  aspect: 16 / 10,
  dice: true,
  side: { player: 0, roll: true, holdings: [0] },
  steps: [
    {
      caption: '**Blue** rolls a **4**. Three buildings have Control Module 4, so all three are activated.',
      moves: [{ act: { type: 'ROLL_DICE', rolls: [4] } }],
      callouts: [
        { mark: '✗', at: { piece: 'sf', centre: true, dx: 20, dz: 14 }, text: 'Red\'s Sphere Factory does nothing: its input is not complete.' },
        { mark: '✗', at: { piece: 'opf', centre: true, dx: 20, dz: 14 }, text: 'Orange\'s Plate Factory does nothing: its output is still full.' },
      ],
    },
    {
      caption: `Blue runs the Plate Factory: ${FACTORY_POWER_COST.plate} Power Token, the Ore is used up and a Plate comes out. The Mine fills the input with Ore again.`,
      moves: [{ act: { type: 'OPERATE_BUILDING', pieceId: 'pf', ownerId: 0 } }],
    },
    {
      caption: 'On Red\'s turn a 4 comes up again. Now Blue\'s Plate Factory does nothing too: its Plate is still in the output.',
      turnTo: { seat: 1, phase: 'roll' },
      moves: [{ act: { type: 'ROLL_DICE', rolls: [4] } }],
      callouts: [{ mark: '✗', at: { piece: 'pf', centre: true, dx: 20, dz: 14 }, text: 'Output full: collect the Plate or let it move on first.' }],
    },
  ],
};

export const PRODUCTION_PLAY_FIGURE = play(
  'Blue rolls a 4. Blue\'s Plate Factory with Control Module 4 runs and makes a Plate; Red\'s Sphere Factory, missing an input, and Orange\'s Plate Factory, with a full output, do nothing. On the next 4 Blue\'s Plate Factory does nothing either, its output being full.',
  'What a factory needs to run: its number rolled, a full recipe in its input, an empty output, and the Power Tokens.',
  PRODUCTION_PLAY,
);

export const POWER_PLANTS_PLAY: PlayExample = {
  id: 'power-plants',
  start: {
    scene: {
      pieces: [
        MINE,
        { id: 'bl', type: 'blank', q: -1, r: 0 },
        { id: 'p0', type: 'powerPlant', q: -2, r: 0, rot: 0, claims: [[0, 3]] },
        { id: 'p1', type: 'powerPlant', q: -2, r: 1, rot: 0, claims: [[1, 3]], input: ['ore'] },
        { id: 'p2', type: 'powerPlant', q: -3, r: 1, rot: 0, claims: [[2, 3]], input: ['plate'] },
        { id: 'p3', type: 'powerPlant', q: -3, r: 0, rot: 0, claims: [[3, 3]], input: ['sphere'] },
      ],
    },
    turn: { seat: 0, phase: 'roll' },
    players: [{ power: 2 }, { power: 2 }, { power: 2 }, { power: 2 }],
  },
  frame: { pieces: ['bl', 'p0', 'p1', 'p2', 'p3'], pad: 4 },
  aspect: 16 / 10,
  side: { player: 0, roll: true, holdings: [0, 1, 2, 3] },
  steps: [
    {
      caption: `A 3 is rolled: all four Power Plants have Control Module 3 and run at once. Empty, Blue's gives ${POWER_PLANT_BASE_YIELD}; Red's uses its Ore for ${POWER_PLANT_MATERIAL_YIELD.ore}; Orange's its Plate for ${POWER_PLANT_MATERIAL_YIELD.plate}; Green's its Sphere for ${POWER_PLANT_MATERIAL_YIELD.sphere}.`,
      moves: [{ act: { type: 'ROLL_DICE', rolls: [3] } }],
    },
  ],
};

export const POWER_PLANTS_PLAY_FIGURE = play(
  'Four Power Plants with Control Module 3, one empty and the others holding an Ore, a Plate and a Sphere. A 3 is rolled: each runs, uses what it holds, and its owner\'s Power Tokens go up by what that material gives.',
  'The more valuable the material in its input, the more Power Tokens a Power Plant gives.',
  POWER_PLANTS_PLAY,
);

// ── Moving material ────────────────────────────────────────────────────────────────────────────

const MOVING_PIECES = (sfOwner: number): ScenePiece[] => [
  MINE,
  { id: 'pf', type: 'plateFact', q: -1, r: 0, rot: 3, claims: [[0, 3]], output: ['plate'] },
  { id: 'sf', type: 'sphereFact', q: -2, r: 0, rot: 3, claims: [[sfOwner, 6]] },
];

export const MOVING_PLAY: PlayExample = {
  id: 'moving',
  start: { scene: { pieces: MOVING_PIECES(0) }, turn: { seat: 0, phase: 'actions' } },
  aspect: 16 / 9,
  steps: [
    {
      caption: '**Blue** presses Done with actions, and material moves: the Plate passes from the Plate Factory\'s output into the touching input of Blue\'s Sphere Factory, and the Mine fills the input that touches its ore exit with Ore.',
      moves: [{ act: { type: 'END_ACTIONS' } }],
    },
    {
      caption: 'The same layout, but the Sphere Factory is **Red**\'s: when material moves, nothing passes. A building feeds only its own player\'s buildings, so the Plate stays in Blue\'s output.',
      jump: { scene: { pieces: MOVING_PIECES(1) }, turn: { seat: 0, phase: 'actions' } },
      moves: [{ act: { type: 'END_ACTIONS' } }],
      callouts: [{ mark: '✗', at: { piece: 'pf', buffer: 'output' }, text: 'The Plate does not pass into Red\'s building.' }],
    },
  ],
};

export const MOVING_PLAY_FIGURE = play(
  'Blue\'s Plate Factory touches a Mine and Blue\'s Sphere Factory. When material moves, Ore fills the Plate Factory\'s input and its Plate passes into the Sphere Factory. With the Sphere Factory belonging to Red, the Plate stays where it is.',
  'Direct contact: Ore from a Mine\'s ore exit, and material from one building to another of the same player.',
  MOVING_PLAY,
);

// ── Belts ──────────────────────────────────────────────────────────────────────────────────────

const CHAIN_PIECES = (pfOwner: number): ScenePiece[] => [
  MINE,
  { id: 'b1', type: 'blank', q: -1, r: 0 },
  { id: 'b2', type: 'blank', q: -2, r: 1 },
  { id: 'pf', type: 'plateFact', q: -3, r: 1, rot: 3, claims: [[pfOwner, 4]] },
];

export const BELT_CHAIN_PLAY: PlayExample = {
  id: 'belt-chain',
  start: { scene: { pieces: CHAIN_PIECES(0) }, turn: { seat: 0, phase: 'actions' } },
  aspect: 2,
  side: { player: 0, holdings: [0], supply: true },
  steps: [
    {
      caption: '**Blue** lays a belt across the first blank tile, starting at the point that faces one of the Mine\'s ore exits.',
      moves: [{ act: { type: 'PLACE_BELT', pieceId: 'b1', fromPoint: 7, toPoint: 10 } }],
    },
    {
      caption: 'The next belt starts at the matching point of the neighbouring tile and ends at the point facing the Plate Factory\'s input.',
      moves: [{ act: { type: 'PLACE_BELT', pieceId: 'b2', fromPoint: 5, toPoint: 1 } }],
    },
    {
      caption: 'Blue presses Done with actions: material moves, and Ore travels from the Mine along the chain into the Plate Factory.',
      moves: [{ act: { type: 'END_ACTIONS' } }],
    },
    {
      caption: 'Had **Red** claimed the Plate Factory after Blue laid the belts, the chain would be a dead end: Blue\'s belts never feed another player\'s building, and nothing arrives.',
      jump: {
        scene: { pieces: CHAIN_PIECES(1), belts: [{ piece: 'b1', a: 7, b: 10 }, { piece: 'b2', a: 5, b: 1 }] },
        turn: { seat: 0, phase: 'actions' },
      },
      moves: [{ act: { type: 'END_ACTIONS' } }],
      callouts: [{ mark: '✗', at: { piece: 'pf', buffer: 'input' }, text: 'A dead end: no Ore for Red\'s building from Blue\'s belts.' }],
    },
  ],
};

export const BELT_CHAIN_PLAY_FIGURE = play(
  'Blue lays two belts over two blank tiles, from a point facing a Mine\'s ore exit to the point facing Blue\'s Plate Factory\'s input, and Ore travels along them. With the Plate Factory belonging to Red, the same chain carries nothing.',
  'A chain of belts carries material from a source to its owner\'s building — and only to its owner\'s.',
  BELT_CHAIN_PLAY,
);

export const BELT_RULES_PLAY: PlayExample = {
  id: 'belt-rules',
  start: {
    scene: {
      pieces: [MINE, { id: 'b1', type: 'blank', q: -1, r: 0 }, { id: 'b3', type: 'blank', q: 0, r: 1 }, { id: 'b4', type: 'blank', q: -2, r: 1 }],
      belts: [{ piece: 'b4', a: 2, b: 8 }],
    },
    turn: { seat: 0, phase: 'actions' },
  },
  aspect: 16 / 10,
  side: { player: 0, holdings: [0], supply: true },
  steps: [
    {
      caption: '**Blue** starts a belt at the point facing an ore exit. It may end at any glowing point: three or more points away round the tile. The nearest two on each side are too close.',
      glow: { beltsFrom: { piece: 'b1', point: 7 } },
      callouts: [{ mark: '1', at: { piece: 'b1', point: 7 }, text: 'Where the belt starts.' }],
    },
    {
      caption: 'Blue lays it straight across the tile.',
      moves: [{ act: { type: 'PLACE_BELT', pieceId: 'b1', fromPoint: 7, toPoint: 10 } }],
    },
    {
      caption: 'Only one belt a turn may face a Mine\'s ore exit. From this point, which faces another ore exit, nothing glows now.',
      glow: { beltsFrom: { piece: 'b3', point: 3 } },
      callouts: [{ mark: '✗', at: { piece: 'b3', point: 3 }, text: 'No second belt at an ore exit this turn.' }],
    },
    {
      caption: 'Blue takes back the belt laid this turn: it comes back to Blue\'s belts, to be laid again for free.',
      moves: [{ act: { type: 'REMOVE_BELT', beltId: 'belt-p0-b1-7-10' } }],
    },
    {
      caption: 'Blue removes the belt laid on an earlier turn: it goes back to the bank, and Blue\'s belts stay as they were.',
      moves: [{ act: { type: 'REMOVE_BELT', beltId: 'belt-p0-b4-2-8' } }],
    },
  ],
};

export const BELT_RULES_PLAY_FIGURE = play(
  'Blue starts a belt at a point facing a Mine\'s ore exit; the points it may end at glow. Blue lays it, and then no belt may start at another ore exit. Blue takes the new belt back into the supply, and returns an older belt to the bank.',
  'Where a belt may end, the one belt a turn at an ore exit, and taking belts back.',
  BELT_RULES_PLAY,
);

// ── Teleporters ────────────────────────────────────────────────────────────────────────────────

export const TELEPORTER_IN_PLAY: PlayExample = {
  id: 'teleporter-in',
  start: {
    scene: {
      pieces: [
        MINE,
        { id: 'sf', type: 'sphereFact', q: -1, r: 1, rot: 2, claims: [[0, 6]] },
        { id: 'pf', type: 'plateFact', q: 0, r: 1, rot: 3, claims: [[0, 3]], output: ['plate'] },
      ],
    },
    turn: { seat: 0, phase: 'actions' },
    players: [{ materials: { ore: 2 }, power: 3 }],
  },
  aspect: 16 / 10,
  frame: { pieces: ['sf', 'pf', 'mine-1'], pad: 2 },
  side: { player: 0, holdings: [0], bank: true, roll: true },
  steps: [
    {
      caption: `**Blue** places a Teleporter on input 1 of the Sphere Factory. Price: the Teleporters on the board (0) + 1 = ${teleporterCost(0)}, paid with an Ore.`,
      moves: [{ act: { type: 'PLACE_TELEPORTER', pieceId: 'sf', bufferType: 'input', inputIndex: 0 } }],
    },
    {
      caption: 'Blue presses Done with actions, and material moves: the Plate passes into input 2. Input 1 touches an ore exit, but its Teleporter cuts it off: the Mine brings it nothing.',
      moves: [{ act: { type: 'END_ACTIONS' } }],
      callouts: [{ mark: '✗', at: { piece: 'sf', teleporter: 'input', slot: 0 }, text: 'No Ore from the Mine into the input with the Teleporter.' }],
    },
    {
      caption: 'On Red\'s turn a 6 is rolled: Blue\'s Sphere Factory is activated.',
      turnTo: { seat: 1, phase: 'roll' },
      moves: [{ act: { type: 'ROLL_DICE', rolls: [6] } }],
    },
    {
      caption: `Blue runs it and hands over an Ore: it leaves Blue's materials, comes out of the portal into input 1, and with the Plate makes a Sphere (${FACTORY_POWER_COST.sphere} Power Tokens).`,
      moves: [{ act: { type: 'OPERATE_BUILDING', pieceId: 'sf', ownerId: 0, supply: ['ore'] }, seat: 0 }],
    },
  ],
};

export const TELEPORTER_IN_PLAY_FIGURE = play(
  'Blue places a Teleporter on one input of Blue\'s Sphere Factory. The Plate Factory\'s Plate passes into the other input; the Mine no longer fills the input with the Teleporter. When the Sphere Factory runs, an Ore from Blue\'s materials comes out of the portal into that input.',
  'An input Teleporter: fed from your materials, through its portal, and from nothing else.',
  TELEPORTER_IN_PLAY,
);

export const TELEPORTER_OUT_PLAY: PlayExample = {
  id: 'teleporter-out',
  start: {
    scene: { pieces: [MINE, { id: 'pf', type: 'plateFact', q: -1, r: 0, rot: 3, claims: [[0, 3]], input: ['ore'] }] },
    turn: { seat: 0, phase: 'actions' },
    players: [{ materials: { ore: 1 } }],
  },
  aspect: 16 / 10,
  frame: { pieces: ['pf', 'mine-1'], pad: 2 },
  side: { player: 0, holdings: [0], roll: true },
  steps: [
    {
      caption: `**Blue** places a Teleporter on the output of the Plate Factory, for ${teleporterCost(0)} (paid with an Ore).`,
      moves: [{ act: { type: 'PLACE_TELEPORTER', pieceId: 'pf', bufferType: 'output' } }],
    },
    {
      caption: 'On Red\'s turn a 3 is rolled: Blue\'s Plate Factory is activated.',
      turnTo: { seat: 1, phase: 'roll' },
      moves: [{ act: { type: 'ROLL_DICE', rolls: [3] } }],
    },
    {
      caption: 'Blue runs it: the Plate goes into the portal on the output and arrives straight in Blue\'s materials.',
      moves: [{ act: { type: 'OPERATE_BUILDING', pieceId: 'pf', ownerId: 0 }, seat: 0 }],
    },
  ],
};

export const TELEPORTER_OUT_PLAY_FIGURE = play(
  'Blue places a Teleporter on the output of Blue\'s Plate Factory. When it runs, the Plate goes into the portal and appears in Blue\'s materials.',
  'An output Teleporter: what the building makes goes straight to you.',
  TELEPORTER_OUT_PLAY,
);

// ── Actions and the bank ───────────────────────────────────────────────────────────────────────

export const ACTIONS_PLAY: PlayExample = {
  id: 'actions',
  start: {
    scene: { pieces: CHAIN_PIECES(0) },
    turn: { seat: 0, phase: 'actions' },
    players: [{ materials: { ore: 0, plate: 1 }, belts: 1 }],
  },
  aspect: 2,
  side: { player: 0, holdings: [0], supply: true, bank: true, hand: true },
  steps: [
    {
      caption: `**Blue** has 1 belt and needs 2: Blue buys one for ${BELT_COST}. Blue hands in the Plate and gets 2 Ore back as change.`,
      moves: [{ act: { type: 'BUY_BELT' } }],
    },
    {
      caption: 'Blue lays the two belts, from the point facing an ore exit to the point facing Blue\'s Plate Factory.',
      moves: [
        { act: { type: 'PLACE_BELT', pieceId: 'b1', fromPoint: 7, toPoint: 10 } },
        { act: { type: 'PLACE_BELT', pieceId: 'b2', fromPoint: 5, toPoint: 1 } },
      ],
    },
    {
      caption: `Blue buys a Leverage card for the number of Mines + 1 = ${cardCost(1)}, paid with the 2 Ore. It goes into Blue's hand.`,
      moves: [{ act: { type: 'BUY_CARD' } }],
    },
    {
      caption: 'Blue presses Done with actions: only now does material move along the new belts, and Ore reaches the Plate Factory.',
      moves: [{ act: { type: 'END_ACTIONS' } }],
    },
  ],
};

export const ACTIONS_PLAY_FIGURE = play(
  'In the actions step Blue buys a belt with a Plate and gets 2 Ore back, lays two belts from a Mine to Blue\'s Plate Factory, buys a Leverage card with the Ore, and presses Done with actions: Ore travels along the new belts.',
  'Actions in any order, as many as you can pay for; material moves along new belts when you are done.',
  ACTIONS_PLAY,
);

export const BANK_PLAY: PlayExample = {
  id: 'bank',
  start: {
    scene: { pieces: [MINE, { id: 'pf', type: 'plateFact', q: -1, r: 0, rot: 3, claims: [[0, 3]], input: ['ore'] }] },
    turn: { seat: 0, phase: 'actions' },
    players: [{ materials: { ore: 0, plate: 1, sphere: 1 } }],
    stacks23: [['blank', 'plateFact'], []],
  },
  aspect: 16 / 10,
  pile: [1],
  side: { player: 0, holdings: [0], bank: true, hand: true },
  steps: [
    {
      caption: `**Blue** buys a belt for ${BELT_COST}. The game pays so that Blue keeps the most valuable materials: it hands in the Plate (3) and gives 2 Ore back.`,
      moves: [{ act: { type: 'BUY_BELT' } }],
    },
    {
      caption: `A Leverage card costs the number of Mines + 1 = ${cardCost(1)}: the 2 Ore pay for it exactly.`,
      moves: [{ act: { type: 'BUY_CARD' } }],
    },
    {
      caption: 'Blue exchanges the Sphere (7) for 2 Plates and 1 Ore (3 + 3 + 1): exchanging down is free.',
      moves: [{ act: { type: 'EXCHANGE_MATERIALS', give: 'sphere' } }],
    },
    {
      caption: `The second Mine costs ${MINE_COSTS[0]}: Blue hands in the 2 Plates (6), and the Mine comes off stack 2 and goes next to the board. Stack 2 opens.`,
      moves: [{ act: { type: 'BUY_MINE', coord: { q: -1, r: 1 }, rotation: 5 } }],
    },
  ],
};

export const BANK_PLAY_FIGURE = play(
  'Blue buys a belt with a Plate and gets 2 Ore change, buys a Leverage card with the 2 Ore, exchanges a Sphere for 2 Plates and an Ore, and buys the second Mine with the 2 Plates.',
  'Paying in material value, with change; exchanging down; buying a Mine.',
  BANK_PLAY,
);

// ── The meeple and the end of a round ──────────────────────────────────────────────────────────

export const MEEPLE_PLAY: PlayExample = {
  id: 'meeple',
  start: {
    scene: { pieces: [MINE, { id: 'gpf', type: 'plateFact', q: -1, r: 0, rot: 3, claims: [[2, 3]], input: ['ore'] }] },
    turn: { seat: 0, phase: 'placeMeeple', order: [0, 1, 2] },
  },
  colors: ['blue', 'red', 'green'],
  aspect: 16 / 9,
  side: { player: 1, holdings: [0, 1, 2], upgrades: true },
  steps: [
    {
      caption: '**Blue** ends the turn with the meeple on the Mine\'s resource point.',
      moves: [{ act: { type: 'PLACE_MEEPLE', pieceId: 'mine-1', slotIndex: 0 } }, { act: { type: 'END_TURN' } }],
    },
    {
      caption: '**Red** puts the meeple on the Mine\'s upgrade point.',
      turnTo: { seat: 1, phase: 'placeMeeple' },
      moves: [{ act: { type: 'PLACE_MEEPLE', pieceId: 'mine-1', slotIndex: 1 } }, { act: { type: 'END_TURN' } }],
    },
    {
      caption: '**Green** puts the meeple on Green\'s own Plate Factory. Green is last in the round, so the round ends: Blue gets 2 Ore, Red 2 Mine credits, and everyone 1 free upgrade.',
      turnTo: { seat: 2, phase: 'placeMeeple' },
      moves: [{ act: { type: 'PLACE_MEEPLE', pieceId: 'gpf' } }, { act: { type: 'END_TURN' } }],
    },
  ],
};

export const MEEPLE_PLAY_FIGURE = play(
  'Three meeples go down at the ends of three turns: Blue\'s on the Mine\'s resource point, Red\'s on its upgrade point, Green\'s on Green\'s Plate Factory. The round ends: Blue receives 2 Ore and Red 2 Mine credits.',
  'Where a meeple can go, and what each spot gives at the end of the round.',
  MEEPLE_PLAY,
);

export const ROUND_END_PLAY: PlayExample = {
  id: 'round-end',
  start: {
    scene: {
      pieces: [MINE, { id: 'bl', type: 'blank', q: -1, r: 0 }, { id: 'gpf', type: 'plateFact', q: -2, r: 0, rot: 0, claims: [[2, 3]] }],
      meeples: [{ player: 2, piece: 'gpf' }],
    },
    turn: { seat: 2, phase: 'roundEnd', order: [2, 0, 1] },
    players: [{}, {}, { materials: { ore: 1 }, freeUpgrades: 1 }],
  },
  colors: ['blue', 'red', 'green'],
  aspect: 16 / 9,
  side: { player: 2, tray: true, upgrades: true, holdings: [2] },
  steps: [
    {
      caption: '**Green**\'s round-end turn: the meeple stands on Green\'s Plate Factory, so Green loads its empty input with an Ore from Green\'s materials.',
      moves: [{ act: { type: 'LOAD_BUILDING_INPUT', pieceId: 'gpf', material: 'ore' } }],
    },
    {
      caption: `Green runs it once, though its number was not rolled: ${FACTORY_POWER_COST.plate} Power Token, and a Plate comes out.`,
      moves: [{ act: { type: 'OPERATE_BUILDING', pieceId: 'gpf' } }],
    },
    {
      caption: 'Green collects the Plate into Green\'s materials.',
      moves: [{ act: { type: 'COLLECT_OUTPUT', pieceId: 'gpf' } }],
    },
    {
      caption: 'Green spends the free upgrade: Control Module 3 becomes a 4, and the 3 goes back to the tray.',
      moves: [{ act: { type: 'UPGRADE_BUILDING', pieceId: 'gpf', oldModule: 3, newModule: 4, freeCredits: 1 } }],
    },
  ],
};

export const ROUND_END_PLAY_FIGURE = play(
  'In Green\'s round-end turn, with the meeple on Green\'s Plate Factory: Green loads an Ore into it, runs it, collects the Plate, and upgrades its Control Module from 3 to 4 with the free upgrade.',
  'A round-end turn: the meeple\'s building, and the free upgrade.',
  ROUND_END_PLAY,
);

// ── Mines ──────────────────────────────────────────────────────────────────────────────────────

export const MINE_DROP_PLAY: PlayExample = {
  id: 'mine-drop',
  start: {
    scene: {
      pieces: [
        MINE,
        { id: 'pf', type: 'plateFact', q: -1, r: 0, rot: 3, claims: [[1, 3]], input: ['ore'] },
        { id: 'pp', type: 'powerPlant', q: 0, r: 1, rot: 1, claims: [[1, 2]], input: ['ore'] },
      ],
    },
    turn: { seat: 0, phase: 'placePiece' },
    stack: ['blank'],
    stacks23: [['sphereFact', 'blank', 'plateFact'], []],
  },
  aspect: 16 / 10,
  pile: [0, 1],
  dice: true,
  side: { player: 1, tray: true, roll: true },
  steps: [
    {
      caption: '**Blue** places the last piece of stack 1. The stack is empty, so the second Mine drops into play and stack 2, under it, opens.',
      moves: [{ act: { type: 'PLACE_PIECE', stackIndex: 0, coord: { q: 2, r: -1 }, rotation: 0 } }],
    },
    {
      caption: '**Red**\'s turn starts with placing that Mine instead of a piece: either half may touch the board.',
      turnTo: { seat: 1, phase: 'placePiece' },
      moves: [{ act: { type: 'PLACE_MINE', coord: { q: -1, r: 1 }, rotation: 5 } }],
    },
    {
      caption: 'With two Mines, two dice are rolled from now on: Red rolls 2 and 5, a total of 7.',
      moves: [{ act: { type: 'ROLL_DICE', rolls: [2, 5] } }],
    },
    {
      caption: 'Control Module 1 is greyed in the tray: a 1 can no longer be rolled. A claim now costs one upgrade less (module − 2 Mines + 1).',
      callouts: [],
    },
  ],
};

export const MINE_DROP_PLAY_FIGURE = play(
  'Blue places the last piece of stack 1; the second Mine drops into play. Red places it, then rolls two dice. Control Module 1 turns grey in Red\'s tray.',
  'A Mine coming into play: another die, a module that can no longer be rolled, cheaper claims.',
  MINE_DROP_PLAY,
);

// ── Leverage cards ─────────────────────────────────────────────────────────────────────────────

export const SINK_HOLE_PLAY: PlayExample = {
  id: 'sink-hole',
  start: {
    scene: {
      pieces: [MINE, { id: 'bl', type: 'blank', q: -1, r: 0 }, { id: 'rpf', type: 'plateFact', q: -2, r: 1, rot: 3, claims: [[1, 3]] }],
      belts: [{ piece: 'bl', a: 7, b: 10, owner: 1 }],
    },
    turn: { seat: 0, phase: 'actions' },
    players: [{ hand: ['sinkHole'] }],
  },
  aspect: 16 / 10,
  side: { player: 0, hand: true, holdings: [1], supply: true },
  steps: [
    {
      caption: '**Blue** plays Sink Hole on the unclaimed blank tile: the tile leaves the table, and Red\'s belt on it goes back to the bank, not to Red.',
      moves: [{ act: { type: 'PLAY_CARD', cardType: 'sinkHole', pieceId: 'bl' } }],
    },
  ],
};

export const SINK_HOLE_PLAY_FIGURE = play(
  'Blue plays Sink Hole on a blank tile carrying Red\'s belt: the tile and the belt lift off the table; Red\'s belts in supply stay the same.',
  'Sink Hole: an unclaimed piece leaves the board, with the belts on it.',
  SINK_HOLE_PLAY,
);

export const CHANGING_PRIORITIES_PLAY: PlayExample = {
  id: 'changing-priorities',
  start: {
    scene: {
      pieces: [
        MINE,
        { id: 'a', type: 'plateFact', q: -1, r: 0, rot: 3, claims: [[0, 5]], input: ['ore'], output: ['plate'], tpIn: 0 },
        { id: 'c', type: 'sphereFact', q: -2, r: 0, rot: 3 },
      ],
    },
    turn: { seat: 0, phase: 'actions' },
    players: [{ hand: ['changingPriorities'] }],
  },
  aspect: 16 / 10,
  frame: { pieces: ['a', 'c', 'mine-1'], pad: 2 },
  side: { player: 0, hand: true, holdings: [0], supply: true },
  steps: [
    {
      caption: '**Blue** plays Changing Priorities: Control Module 5 moves from the Plate Factory to the unclaimed Sphere Factory. It was Blue\'s last one there: the Ore and Plate go to the bank and Blue\'s Teleporter comes back to Blue.',
      moves: [{ act: { type: 'PLAY_CARD', cardType: 'changingPriorities', pieceId: 'a', toPieceId: 'c', controlModule: 5 } }],
    },
  ],
};

export const CHANGING_PRIORITIES_PLAY_FIGURE = play(
  'Blue plays Changing Priorities: Blue\'s Control Module travels from the Plate Factory to the Sphere Factory. The Plate Factory, left without an owner, loses its Ore and Plate to the bank, and Blue\'s Teleporter on it returns to Blue.',
  'Changing Priorities: a module moves; a building left without an owner gives up what it holds.',
  CHANGING_PRIORITIES_PLAY,
);

export const ASSET_FORFEITURE_PLAY: PlayExample = {
  id: 'asset-forfeiture',
  start: {
    scene: {
      pieces: [
        MINE,
        { id: 'bpf', type: 'plateFact', q: -1, r: 0, rot: 3, claims: [[0, 3]], input: ['ore'], output: ['plate'] },
        { id: 'rpf', type: 'plateFact', q: 0, r: 1, rot: 1, claims: [[1, 4]], input: ['ore'], output: ['plate'] },
        { id: 'rsf', type: 'sphereFact', q: -1, r: 1, rot: 3, claims: [[1, 6]], output: ['sphere'] },
      ],
    },
    turn: { seat: 0, phase: 'actions' },
    players: [{ hand: ['assetForfeiture'] }],
  },
  aspect: 16 / 10,
  side: { player: 0, hand: true, holdings: [0, 1] },
  steps: [
    {
      caption: '**Blue** plays Asset Forfeiture: every Plate in every output — Blue\'s and Red\'s — goes into Blue\'s materials. Red\'s Sphere stays.',
      moves: [{ act: { type: 'PLAY_CARD', cardType: 'assetForfeiture' } }],
    },
  ],
};

export const ASSET_FORFEITURE_PLAY_FIGURE = play(
  'Blue plays Asset Forfeiture: the Plates in Blue\'s and Red\'s Plate Factories\' outputs lift out and fly to Blue; the Sphere in Red\'s Sphere Factory stays.',
  'Asset Forfeiture: all the Plates in the outputs, whoever owns them.',
  ASSET_FORFEITURE_PLAY,
);

export const SHORT_SALE_PLAY: PlayExample = {
  id: 'short-sale',
  start: {
    scene: {
      pieces: [
        MINE,
        { id: 'pf', type: 'plateFact', q: -1, r: 0, rot: 3, claims: [[0, 3]], input: ['ore'] },
        { id: 'pp', type: 'powerPlant', q: 0, r: 1, rot: 1, claims: [[0, 2]], input: ['ore'] },
        { id: 'sf', type: 'sphereFact', q: -1, r: 1, rot: 1 },
      ],
    },
    turn: { seat: 0, phase: 'actions' },
    players: [{ hand: ['shortSale'] }],
  },
  aspect: 16 / 10,
  side: { player: 0, hand: true, tray: true },
  steps: [
    {
      caption: '**Blue** plays Short Sale on the unclaimed Sphere Factory: Blue claims it for free with the lowest usable Control Module in the tray, the 1.',
      moves: [{ act: { type: 'PLAY_CARD', cardType: 'shortSale', pieceId: 'sf' } }],
    },
  ],
};

export const SHORT_SALE_PLAY_FIGURE = play(
  'Blue plays Short Sale on an unclaimed Sphere Factory: Control Module 1 travels from Blue\'s tray onto it.',
  'Short Sale: a free claim with your lowest usable Control Module.',
  SHORT_SALE_PLAY,
);

// ── Bonuses and winning ────────────────────────────────────────────────────────────────────────

export const BONUS_PLAY: PlayExample = {
  id: 'bonus',
  start: {
    scene: {
      pieces: [
        MINE,
        { id: 'bpf', type: 'plateFact', q: -1, r: 0, rot: 3, claims: [[0, 9]], input: ['ore'] },
        { id: 'rpf', type: 'plateFact', q: 0, r: 1, rot: 1, claims: [[1, 9]], input: ['ore'] },
      ],
    },
    turn: { seat: 0, phase: 'roundEnd', order: [0, 1] },
    players: [{ credits: 1 }, { credits: 2 }],
  },
  aspect: 16 / 10,
  side: { player: 0, tesseracts: [0, 1] },
  steps: [
    {
      caption: '**Blue** raises a Control Module from 9 to 10 with a Mine credit. Blue now has the highest module in play, at least 10: Blue holds The Investor, which counts as a Tesseract.',
      moves: [{ act: { type: 'UPGRADE_BUILDING', pieceId: 'bpf', oldModule: 9, newModule: 10, fromMineCredit: true } }],
    },
    {
      caption: 'In **Red**\'s round-end turn Red raises a module from 9 to 11, higher than Blue\'s: The Investor moves to Red, and Blue\'s count drops back.',
      moves: [
        { act: { type: 'END_ACTIONS' } },
        { act: { type: 'UPGRADE_BUILDING', pieceId: 'rpf', oldModule: 9, newModule: 11, fromMineCredit: true } },
      ],
    },
  ],
};

export const BONUS_PLAY_FIGURE = play(
  'Blue upgrades a Control Module to 10 and gains The Investor, one more mark in Blue\'s Tesseract count. Red then upgrades to 11: the bonus and the mark move to Red.',
  'A bonus card counts only while you hold it: it moves as soon as someone does better.',
  BONUS_PLAY,
);

export const WIN_PLAY: PlayExample = {
  id: 'win',
  start: {
    scene: {
      pieces: [
        MINE,
        { id: 'tf', type: 'tesseractFact', q: -1, r: 0, rot: 3, claims: [[0, 4]], input: ['ore', 'plate', 'sphere'], tpOut: 0 },
      ],
    },
    turn: { seat: 0, phase: 'roll' },
    players: [{ materials: { tesseract: 3 }, power: 3 }],
  },
  aspect: 16 / 10,
  frame: { pieces: ['tf', 'mine-1'], pad: 2 },
  side: { player: 0, tesseracts: [0], roll: true },
  steps: [
    {
      caption: '**Blue**, holding 3 Tesseracts, rolls a 4 in Blue\'s own turn: Blue\'s Tesseract Factory is activated.',
      moves: [{ act: { type: 'ROLL_DICE', rolls: [4] } }],
    },
    {
      caption: `Blue runs it (${FACTORY_POWER_COST.tesseract} Power Tokens): the Tesseract goes through the output Teleporter into Blue's materials. Four Tesseracts in Blue's own turn: Blue wins.`,
      moves: [{ act: { type: 'OPERATE_BUILDING', pieceId: 'tf', ownerId: 0 } }],
    },
  ],
};

export const WIN_PLAY_FIGURE = play(
  'Blue holds 3 Tesseracts and rolls the number of Blue\'s Tesseract Factory in Blue\'s own turn. It runs; the Tesseract goes through its output Teleporter to Blue, the fourth mark of Blue\'s count lights, and Blue wins.',
  'The winning moment: the fourth Tesseract, counted in your own turn.',
  WIN_PLAY,
);

// ── One whole turn ─────────────────────────────────────────────────────────────────────────────

export const TURN_PLAY: PlayExample = {
  id: 'turn',
  start: {
    scene: {
      pieces: [
        MINE,
        { id: 'pf', type: 'plateFact', q: -1, r: 0, rot: 3, claims: [[0, 3]], input: ['ore'] },
        { id: 'pp', type: 'powerPlant', q: 0, r: 1, rot: 1, claims: [[1, 2]], input: ['ore'] },
      ],
    },
    turn: { seat: 0, phase: 'placePiece', order: [0, 1] },
    stack: ['sphereFact', 'blank'],
    players: [{ materials: { ore: 2 } }],
  },
  aspect: 16 / 10,
  pile: true,
  dice: true,
  side: { player: 0, steps: true, hand: true, holdings: [0], roll: true },
  steps: [
    {
      caption: 'Step 1, **place a piece**: Blue places the top piece of stack 1, a Sphere Factory, next to the board.',
      moves: [{ act: { type: 'PLACE_PIECE', stackIndex: 0, coord: { q: -1, r: 1 }, rotation: 1 } }],
    },
    {
      caption: 'Step 2, **roll**: Blue rolls a 3, and Blue runs the Plate Factory, which has Control Module 3.',
      moves: [{ act: { type: 'ROLL_DICE', rolls: [3] } }, { act: { type: 'OPERATE_BUILDING', pieceId: 'pf', ownerId: 0 } }],
    },
    {
      caption: `Step 3, **actions**: Blue buys a Leverage card for ${cardCost(1)} and presses Done with actions.`,
      moves: [{ act: { type: 'BUY_CARD' } }, { act: { type: 'END_ACTIONS' } }],
    },
    {
      caption: 'Step 4, **place meeple**: Blue\'s meeple goes on the Mine\'s resource point, and Blue\'s turn ends. It is Red\'s turn.',
      moves: [{ act: { type: 'PLACE_MEEPLE', pieceId: 'mine-1', slotIndex: 0 } }, { act: { type: 'END_TURN' } }],
    },
  ],
};

export const TURN_PLAY_FIGURE = play(
  'One turn of Blue\'s: a Sphere Factory comes off stack 1 onto the board, a 3 is rolled and Blue\'s Plate Factory runs, Blue buys a Leverage card, and Blue\'s meeple goes on the Mine\'s resource point.',
  'The four steps of one turn, one after another.',
  TURN_PLAY,
);
