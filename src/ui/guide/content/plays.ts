// The guide's animated examples (figures/types.ts PlayExample): real engine moves on a real or
// staged board, played with the game's own animation code. Every example is replayed through the
// engine by __tests__/plays.test.ts, which also checks the numbers its captions give.

import { FACTORY_POWER_COST, POWER_PLANT_MATERIAL_YIELD } from '../../../engine/config';
import type { FigureBlock, PlayExample } from '../figures/types';

// ── Your first claims ──────────────────────────────────────────────────────────────────────────
// The real starting board for 3 players (seed 7: Green starts, then Blue, then Red).

export const FIRST_CLAIMS_PLAY: PlayExample = {
  id: 'first-claims',
  start: { setup: { seed: 7, players: 3 } },
  colors: ['blue', 'red', 'green'],
  aspect: 4 / 3,
  keepMarks: true,
  steps: [
    {
      caption: '**Green**, the starting player, claims a Plate Factory with Control Module 3.',
      moves: [{ act: { type: 'SETUP_CLAIM', pieceId: 's0-plateFact-1' } }],
      callouts: [{ mark: '1', at: { piece: 's0-plateFact-1', centre: true, dx: 20, dz: 14 }, text: 'Green\'s Plate Factory' }],
      glow: 'legal',
    },
    {
      caption: '**Blue**, next in turn order, claims a Plate Factory with Control Module 3.',
      moves: [{ act: { type: 'SETUP_CLAIM', pieceId: 's0-plateFact-0' } }],
      callouts: [{ mark: '2', at: { piece: 's0-plateFact-0', centre: true, dx: 20, dz: 14 }, text: 'Blue\'s Plate Factory' }],
      glow: 'legal',
    },
    {
      caption: '**Red** takes the last Plate Factory with Control Module 3.',
      moves: [{ act: { type: 'SETUP_CLAIM', pieceId: 's0-plateFact-4' } }],
      callouts: [{ mark: '3', at: { piece: 's0-plateFact-4', centre: true, dx: 20, dz: 14 }, text: 'Red\'s Plate Factory' }],
      glow: 'legal',
    },
    {
      caption: 'Now the reverse order: **Red**, who picked last, claims a Power Plant first, with Control Module 2.',
      moves: [{ act: { type: 'SETUP_CLAIM', pieceId: 's0-powerPlant-11' } }],
      callouts: [{ mark: '4', at: { piece: 's0-powerPlant-11', centre: true, dx: 20, dz: 14 }, text: 'Red\'s Power Plant' }],
      glow: 'legal',
    },
    {
      caption: '**Blue** claims a Power Plant with Control Module 2.',
      moves: [{ act: { type: 'SETUP_CLAIM', pieceId: 's0-powerPlant-12' } }],
      callouts: [{ mark: '5', at: { piece: 's0-powerPlant-12', centre: true, dx: 20, dz: 14 }, text: 'Blue\'s Power Plant' }],
      glow: 'legal',
    },
    {
      caption: '**Green**, who picked the first Plate Factory, gets the last Power Plant, with Control Module 2. The first turn can begin.',
      moves: [{ act: { type: 'SETUP_CLAIM', pieceId: 's0-powerPlant-13' } }],
      callouts: [{ mark: '6', at: { piece: 's0-powerPlant-13', centre: true, dx: 20, dz: 14 }, text: 'Green\'s Power Plant' }],
    },
  ],
};

export const FIRST_CLAIMS_FIGURE: FigureBlock = {
  k: 'figure',
  alt: 'A starting board for three players. In turn, Green, Blue and Red each put Control Module 3 on a Plate Factory; then Red, Blue and Green each put Control Module 2 on a Power Plant.',
  caption: 'The first claims on a starting board for three players: Plate Factories in turn order, then Power Plants in the reverse order.',
  show: { kind: 'play', play: FIRST_CLAIMS_PLAY },
};

// ── Place a piece ──────────────────────────────────────────────────────────────────────────────
// The same game, right after the first claims: Green's first turn, then Blue's.

export const PLACE_PLAY: PlayExample = {
  id: 'place-piece',
  // Shown before Green's turn begins, so the top piece of stack 1 is still face down.
  start: { setup: { seed: 7, players: 3, claims: true }, turn: { seat: 1, phase: 'placeMeeple' } },
  colors: ['blue', 'red', 'green'],
  aspect: 4 / 3,
  pile: true,
  keepMarks: true,
  steps: [
    {
      caption: '**Green**\'s turn: the top piece of stack 1 is turned over. It is a Sphere Factory. Every free space that touches the board glows: it may go on any of them.',
      turnTo: { seat: 2, phase: 'placePiece' },
      glow: 'legal',
    },
    {
      caption: 'Green picks one of the glowing spaces, turns the piece the way Green wants (any of the six ways), and places it.',
      moves: [{ act: { type: 'PLACE_PIECE', stackIndex: 0, coord: { q: -1, r: 3 }, rotation: 4 } }],
      callouts: [{ mark: '2', at: { piece: 's0-sphereFact-8', centre: true }, text: 'Green\'s new Sphere Factory' }],
    },
    {
      caption: 'After Green\'s turn it is **Blue**\'s: the next piece, a Plate Factory, is turned over, and every free space touching the board, the new piece included, glows.',
      turnTo: { seat: 0, phase: 'placePiece' },
      glow: 'legal',
    },
    {
      caption: 'Blue places it somewhere else: any free space that touches the board will do.',
      moves: [{ act: { type: 'PLACE_PIECE', stackIndex: 0, coord: { q: -2, r: 0 }, rotation: 0 } }],
      callouts: [{ mark: '4', at: { piece: 's0-plateFact-6', centre: true }, text: 'Blue\'s new Plate Factory' }],
    },
  ],
};

export const PLACE_PLAY_FIGURE: FigureBlock = {
  k: 'figure',
  alt: 'A starting board for three players with stack 1 beside it. Green\'s piece, a Sphere Factory, is turned over, travels to a free space and is placed; then Blue places a Plate Factory on another free space.',
  caption: 'Two turns\' pieces: each is turned over, may go on any glowing space, and is placed.',
  show: { kind: 'play', play: PLACE_PLAY },
};

// ── Roll the dice ──────────────────────────────────────────────────────────────────────────────
// A staged board with two Mines in play, so two dice are rolled.

const PLATE_COST = FACTORY_POWER_COST.plate;
const SPHERE_COST = FACTORY_POWER_COST.sphere;

export const ROLL_PLAY: PlayExample = {
  id: 'roll',
  start: {
    scene: {
      pieces: [
        { id: 'mine-1', type: 'mine', q: 0, r: 0 },
        { id: 'mine-2', type: 'mine', q: 2, r: -1, rot: 3 },
        { id: 'pf', type: 'plateFact', q: -1, r: 0, rot: 3, claims: [[0, 7]], input: ['ore'] },
        { id: 'pp', type: 'powerPlant', q: 0, r: 1, rot: 1, claims: [[1, 7]], input: ['ore'] },
        { id: 'bpp', type: 'powerPlant', q: 1, r: 1, rot: 4, claims: [[0, 5]] },
        { id: 'sf', type: 'sphereFact', q: -1, r: 1, rot: 1, claims: [[1, 9]], input: ['ore', 'plate'] },
      ],
    },
    turn: { seat: 0, phase: 'roll' },
    players: [{ power: 3 }, { power: 2 }],
  },
  aspect: 16 / 10,
  dice: true,
  side: { player: 0, roll: true, holdings: [0, 1] },
  steps: [
    {
      caption: '**Blue** rolls two dice, one for each Mine: 3 and 4 make **7**. Red\'s Power Plant has Control Module 7: it runs at once, uses its Ore and gives Red ' + `${POWER_PLANT_MATERIAL_YIELD.ore} Power Tokens.`,
      moves: [{ act: { type: 'ROLL_DICE', rolls: [3, 4] } }],
    },
    {
      caption: `Blue's Plate Factory has a 7 too. Blue runs it: ${PLATE_COST} Power Token, the Ore is used up and a Plate comes out. Blue's Power Plant (5) and Red's Sphere Factory (9) do nothing.`,
      moves: [{ act: { type: 'OPERATE_BUILDING', pieceId: 'pf', ownerId: 0 } }],
    },
    {
      caption: 'On Red\'s turn Red rolls 4 and 5: **9**. Only Red\'s Sphere Factory has a 9.',
      turnTo: { seat: 1, phase: 'roll' },
      moves: [{ act: { type: 'ROLL_DICE', rolls: [4, 5] } }],
    },
    {
      caption: `Red runs it: ${SPHERE_COST} Power Tokens, the Ore and the Plate are used up, and a Sphere comes out.`,
      moves: [{ act: { type: 'OPERATE_BUILDING', pieceId: 'sf', ownerId: 1 } }],
    },
  ],
};

export const ROLL_PLAY_FIGURE: FigureBlock = {
  k: 'figure',
  alt: 'A board with two Mines. Blue rolls 3 and 4: Red\'s Power Plant and Blue\'s Plate Factory, both with Control Module 7, run; buildings with 5 and 9 do nothing. Then Red rolls 9 and runs Red\'s Sphere Factory.',
  caption: 'Two rolls on a board with two Mines: only buildings whose Control Module equals the total run.',
  show: { kind: 'play', play: ROLL_PLAY },
};

// ── Claiming and upgrading ─────────────────────────────────────────────────────────────────────
// Blue places the last meeple of the round on a Mine's upgrade point; the round ends and Blue
// spends the upgrades in the round-end turn. Then the same later in the game, with two Mines.

export const CLAIM_PLAY: PlayExample = {
  id: 'claim-upgrade',
  start: {
    scene: {
      pieces: [
        { id: 'mine-1', type: 'mine', q: 0, r: 0 },
        { id: 'pf', type: 'plateFact', q: -1, r: 0, rot: 3, claims: [[0, 3]], input: ['ore'] },
        { id: 'pp', type: 'powerPlant', q: 0, r: 1, rot: 1, claims: [[0, 4]], input: ['ore'] },
        { id: 'sf', type: 'sphereFact', q: -1, r: 1, rot: 1 },
        { id: 'rpf', type: 'plateFact', q: 1, r: -1, rot: 2, claims: [[1, 3]] },
      ],
      meeples: [{ player: 1, piece: 'rpf' }],
    },
    turn: { seat: 0, phase: 'placeMeeple', order: [1, 0] },
  },
  aspect: 16 / 10,
  side: { player: 0, tray: true, upgrades: true },
  steps: [
    {
      caption: 'The last turn of the round: **Blue** places the meeple on the first Mine\'s upgrade point. The round ends: Blue gets 2 Mine credits, and every player gets 1 free upgrade (one per Mine).',
      moves: [{ act: { type: 'PLACE_MEEPLE', pieceId: 'mine-1', slotIndex: 1 } }, { act: { type: 'END_TURN' } }],
    },
    {
      caption: 'In the round-end turn Blue claims the Sphere Factory with Control Module 2. It costs 2 − 1 Mine + 1 = **2** Mine credits.',
      moves: [{ act: { type: 'CLAIM_BUILDING', pieceId: 'sf', controlModule: 2, fromFreeClaim: true } }],
    },
    {
      caption: 'Blue upgrades the Power Plant from 4 to 5 with the free upgrade: it costs the difference, **1**. Module 4 goes back to the tray.',
      moves: [{ act: { type: 'UPGRADE_BUILDING', pieceId: 'pp', oldModule: 4, newModule: 5, freeCredits: 1 } }],
    },
    {
      caption: 'Later in the game the second Mine is in play. Blue\'s meeple goes on its upgrade point: 3 Mine credits, and 2 free upgrades for everyone. Control Module 1 is greyed: a 1 can no longer be rolled.',
      jump: {
        scene: {
          pieces: [
            { id: 'mine-1', type: 'mine', q: 0, r: 0 },
            { id: 'mine-2', type: 'mine', q: 2, r: -1, rot: 3 },
            { id: 'pf', type: 'plateFact', q: -1, r: 0, rot: 3, claims: [[0, 3]], input: ['ore'] },
            { id: 'pp', type: 'powerPlant', q: 0, r: 1, rot: 1, claims: [[0, 5]], input: ['ore'] },
            { id: 'sf', type: 'sphereFact', q: -1, r: 1, rot: 1, claims: [[0, 4]] },
            { id: 'rpf', type: 'plateFact', q: 1, r: -1, rot: 2, claims: [[1, 3]] },
            { id: 'tf', type: 'tesseractFact', q: 1, r: 1, rot: 4 },
          ],
          meeples: [{ player: 1, piece: 'rpf' }],
        },
        turn: { seat: 0, phase: 'placeMeeple', order: [1, 0] },
      },
      moves: [{ act: { type: 'PLACE_MEEPLE', pieceId: 'mine-2', slotIndex: 1 } }, { act: { type: 'END_TURN' } }],
    },
    {
      caption: 'With two Mines a claim costs less: Control Module 2 on the Tesseract Factory costs 2 − 2 Mines + 1 = **1** Mine credit.',
      moves: [{ act: { type: 'CLAIM_BUILDING', pieceId: 'tf', controlModule: 2, fromFreeClaim: true } }],
    },
    {
      caption: 'The 2 free upgrades raise the Sphere Factory from 4 to 6: a difference of **2**. Module 4 goes back to the tray.',
      moves: [{ act: { type: 'UPGRADE_BUILDING', pieceId: 'sf', oldModule: 4, newModule: 6, freeCredits: 2 } }],
    },
  ],
};

export const CLAIM_PLAY_FIGURE: FigureBlock = {
  k: 'figure',
  alt: 'Blue\'s meeple goes on the first Mine\'s upgrade point and the round ends. Blue claims a Sphere Factory with Control Module 2 for 2 Mine credits and upgrades a Power Plant from 4 to 5 with the free upgrade. Later, with two Mines, Blue claims a Tesseract Factory with module 2 for 1 Mine credit and upgrades the Sphere Factory from 4 to 6 with 2 free upgrades; module 1 is greyed in the tray.',
  caption: 'Where upgrades come from and what they buy: Control Modules travel from the tray to the buildings, and an upgraded module comes back.',
  show: { kind: 'play', play: CLAIM_PLAY },
};
