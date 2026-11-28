// The guide's pictures: line-ups of the pieces and small staged scenes, all drawn live from the
// game's own models and drawing code (see ../figures). Numbers come from the engine's config.
// Every scene is checked against the rules by __tests__/figures.test.ts.

import type { CardType, Material } from '../../../engine/config';
import {
  BELT_COST, FACTORY_POWER_COST, FACTORY_RECIPES, MATERIAL_VALUES, MINE_COSTS, POWER_PLANT_BASE_YIELD,
  POWER_PLANT_MATERIAL_YIELD, TESSERACTS_TO_WIN,
} from '../../../engine/config';
import { hexNeighbours, mineSecondaryCoord } from '../../../engine/rules/pieces';
import type { FigureBlock, LineupItem, ScenePiece, SceneSpec } from '../figures/types';
import { BUILDING_NAME, CARD_NAME, MATERIAL_NAME, MINE_RESOURCE_REWARD, MINE_UPGRADE_REWARD, amount, count, exchangeDown } from './facts';

const MATERIALS: readonly Material[] = ['ore', 'plate', 'sphere', 'tesseract'];

// ── Line-ups ───────────────────────────────────────────────────────────────────────────────────

export const MATERIALS_FIGURE: FigureBlock = {
  k: 'figure',
  alt: `The four materials and the Power Token: ${MATERIALS.map(m => `${MATERIAL_NAME[m]}, value ${MATERIAL_VALUES[m]}`).join('; ')}; Power Token, no value.`,
  caption: 'The materials, with their value. Power Tokens run your factories; they have no value.',
  show: {
    kind: 'lineup', items: [
      ...MATERIALS.map((m): LineupItem => ({ pic: { model: m }, label: MATERIAL_NAME[m], value: `Value ${MATERIAL_VALUES[m]}` })),
      { pic: { model: 'power-token' }, label: 'Power Token', value: 'No value' },
    ],
  },
};

export const BOARD_PIECES_FIGURE: FigureBlock = {
  k: 'figure',
  alt: 'The five kinds of six-sided board piece: Plate Factory, Sphere Factory, Tesseract Factory, Power Plant and blank tile.',
  caption: 'The six-sided board pieces. Factories and Power Plants are buildings.',
  show: {
    kind: 'lineup', items: [
      { pic: { model: 'tile-plate-factory' }, big: true, label: BUILDING_NAME.plateFact },
      { pic: { model: 'tile-sphere-factory' }, big: true, label: BUILDING_NAME.sphereFact },
      { pic: { model: 'tile-tesseract-factory' }, big: true, label: BUILDING_NAME.tesseractFact },
      { pic: { model: 'tile-power-plant' }, big: true, label: BUILDING_NAME.powerPlant },
      { pic: { model: 'tile-blank' }, big: true, label: 'Blank tile' },
    ],
  },
};

export const MINES_FIGURE: FigureBlock = {
  k: 'figure',
  alt: 'The three Mines, each a double-size piece.',
  caption: 'The three Mines. The first starts on the table; the second and third lie on stacks 2 and 3 until they come into play.',
  show: {
    kind: 'lineup', items: [
      { pic: { model: 'mine-1' }, label: 'First Mine', wide: true, big: true },
      { pic: { model: 'mine-2' }, label: 'Second Mine', wide: true, big: true },
      { pic: { model: 'mine-3' }, label: 'Third Mine', wide: true, big: true },
    ],
  },
};

/** A Mine with each point's reward under it (Mines topic). */
export const MINE_REWARDS_FIGURE: FigureBlock = {
  k: 'figure',
  alt: 'The three Mines with what their resource point and upgrade point give.',
  caption: 'What each Mine\'s two meeple points give at the end of the round.',
  show: {
    kind: 'lineup', items: (['mine-1', 'mine-2', 'mine-3'] as const).map((model, i): LineupItem => ({
      pic: { model }, wide: true, big: true,
      label: ['First Mine', 'Second Mine', 'Third Mine'][i]!,
      value: `Resource point: ${amount(MINE_RESOURCE_REWARD[i]!.n, MINE_RESOURCE_REWARD[i]!.material)} · Upgrade point: ${MINE_UPGRADE_REWARD[i]} Mine credits`,
    })),
  },
};

/** A blank tile with one blue belt: how a belt looks on the table. */
const BELT_ON_TILE: SceneSpec = { pieces: [{ id: 't', type: 'blank', q: 0, r: 0 }], belts: [{ piece: 't', a: 1, b: 6 }], aspect: 150 / 112 };

export const PLAYER_PIECES_FIGURE: FigureBlock = {
  k: 'figure',
  alt: 'Each player\'s pieces: a meeple in each of the four colours, a Control Module, the Control Module tray, a belt, a teleporter, a Power Token, and the starting player marker.',
  caption: 'Each player\'s pieces, in their colour, and the starting player marker.',
  show: {
    kind: 'lineup', items: [
      { pic: { model: 'meeple', color: 'blue' }, label: 'Meeple', value: 'Blue' },
      { pic: { model: 'meeple', color: 'red' }, label: 'Meeple', value: 'Red' },
      { pic: { model: 'meeple', color: 'orange' }, label: 'Meeple', value: 'Orange' },
      { pic: { model: 'meeple', color: 'green' }, label: 'Meeple', value: 'Green' },
      { pic: { model: 'control-module', color: 'blue', numeral: 7 }, label: 'Control Module', value: 'Numbered 1 to 18' },
      { pic: { model: 'control-module-tray' }, label: 'Control Module tray' },
      { pic: { scene: BELT_ON_TILE, icon: 'belt' }, label: 'Belt', value: 'On a blank tile' },
      { pic: { model: 'teleporter', color: 'blue' }, label: 'Teleporter' },
      { pic: { model: 'power-token' }, label: 'Power Token' },
      { pic: { model: 'starting-player' }, label: 'Starting player marker' },
    ],
  },
};

export const CARD_AND_DICE_FIGURE: FigureBlock = {
  k: 'figure',
  alt: 'A Leverage card (Scouting Drone) and two dice.',
  caption: 'A Leverage card as it appears in your hand, and the dice: one die for each Mine on the board.',
  show: {
    kind: 'lineup', items: [
      { pic: { flat: { k: 'card', card: 'scoutingDrone' } }, label: 'Leverage card' },
      { pic: { flat: { k: 'die', n: 3 } }, label: 'Die' },
      { pic: { flat: { k: 'die', n: 5 } }, label: 'Die' },
    ],
  },
};

export const PLAYER_AREA_FIGURE: FigureBlock = {
  k: 'figure',
  alt: 'Part of a player area: the Control Module tray with modules 2 and 3 on the board, 2 Ore, 1 Plate, and Total Value 5.',
  caption: 'From your area: the Control Module tray (modules 2 and 3 are on the board, so their pockets are empty) and your materials with their Total Value.',
  show: {
    kind: 'lineup', items: [
      { pic: { flat: { k: 'tray', color: 'blue', onBoard: [2, 3] } }, label: 'Control Module tray' },
      { pic: { flat: { k: 'well', m: 'ore', n: 2 } }, label: '' },
      { pic: { flat: { k: 'well', m: 'plate', n: 1 } }, label: '' },
      { pic: { flat: { k: 'total', n: 2 * MATERIAL_VALUES.ore + MATERIAL_VALUES.plate } }, label: '' },
    ],
  },
};

export const TURN_STEPS_FIGURE: FigureBlock = {
  k: 'figure',
  alt: 'The four steps of a turn: place a piece, roll, actions, place your meeple.',
  caption: 'The four steps of every turn, in this order.',
  show: {
    kind: 'lineup', items: [
      { pic: { model: 'tile-sphere-factory' }, label: '1 · Place a piece' },
      { pic: { flat: { k: 'die', n: 4 } }, label: '2 · Roll' },
      { pic: { scene: BELT_ON_TILE, icon: 'belt' }, label: '3 · Actions' },
      { pic: { model: 'meeple', color: 'blue' }, label: '4 · Place meeple' },
    ],
  },
};

export const ROLL_FIGURE: FigureBlock = {
  k: 'figure',
  alt: 'Two dice showing 2 and 5, a total of 7, and a Control Module numbered 7.',
  caption: 'With two Mines, two dice are rolled. A 2 and a 5 make 7: every building with a Control Module 7 activates.',
  show: {
    kind: 'lineup', items: [
      { pic: { flat: { k: 'die', n: 2 } }, label: '' },
      { sign: '+' },
      { pic: { flat: { k: 'die', n: 5 } }, label: '' },
      { sign: '=' },
      { pic: { model: 'control-module', color: 'blue', numeral: 7 }, label: 'Control Module 7' },
    ],
  },
};

export const UPGRADE_FIGURE: FigureBlock = {
  k: 'figure',
  alt: 'A Control Module 4 swapped for a Control Module 6.',
  caption: 'Upgrading: swap a Control Module on your building for a higher one. A 4 for a 6 costs 2 upgrades.',
  show: {
    kind: 'lineup', items: [
      { pic: { model: 'control-module', color: 'blue', numeral: 4 }, label: 'Control Module 4' },
      { sign: '→' },
      { pic: { model: 'control-module', color: 'blue', numeral: 6 }, label: 'Control Module 6', value: count(2, 'upgrade') },
    ],
  },
};

export const TRAY_FIGURE: FigureBlock = {
  k: 'figure',
  alt: 'The Control Module tray on the screen, with modules 2, 3 and 5 on the board.',
  caption: 'Your tray on the screen: a module on a building leaves its pocket empty (here 2, 3 and 5).',
  show: { kind: 'lineup', items: [{ pic: { flat: { k: 'tray', color: 'blue', onBoard: [2, 3, 5] } }, label: '' }] },
};

export const POWER_PLANT_FIGURE: FigureBlock = {
  k: 'figure',
  alt: `What a Power Plant gives: empty, ${POWER_PLANT_BASE_YIELD} Power Token; with Ore ${POWER_PLANT_MATERIAL_YIELD.ore}; with a Plate ${POWER_PLANT_MATERIAL_YIELD.plate}; with a Sphere ${POWER_PLANT_MATERIAL_YIELD.sphere}.`,
  caption: 'Power Tokens a Power Plant gives when it runs, by what lies in its input.',
  show: {
    kind: 'lineup', items: [
      { pic: { model: 'tile-power-plant' }, label: 'Nothing', value: `+${POWER_PLANT_BASE_YIELD}` },
      ...(['ore', 'plate', 'sphere'] as const).map((m): LineupItem => ({ pic: { model: m }, label: MATERIAL_NAME[m], value: `+${POWER_PLANT_MATERIAL_YIELD[m]}` })),
    ],
  },
};

const FACTORY_MODEL = { plateFact: 'tile-plate-factory', sphereFact: 'tile-sphere-factory', tesseractFact: 'tile-tesseract-factory' } as const;

/** One factory with every set of inputs it takes and what it makes. */
export function recipeFigure(type: keyof typeof FACTORY_MODEL): FigureBlock {
  const r = FACTORY_RECIPES[type]!;
  const product = r.product as Exclude<Material, 'ore'>;
  const sets = r.inputs.map(s => s.map(m => MATERIAL_NAME[m]).join(' + '));
  return {
    k: 'figure',
    alt: `${BUILDING_NAME[type]}: ${sets.join(', or ')}, makes 1 ${MATERIAL_NAME[product]}.`,
    show: {
      kind: 'recipe', factory: FACTORY_MODEL[type], name: BUILDING_NAME[type],
      note: `${count(FACTORY_POWER_COST[product], 'Power Token')} to run`, inputs: r.inputs, product,
    },
  };
}

export const BANK_FIGURE: FigureBlock = {
  k: 'figure',
  alt: `What the bank sells: a belt for ${BELT_COST}, a Leverage card for the number of Mines + 1, a Mine for ${MINE_COSTS.join(' or ')}, a teleporter for the teleporters on the board + 1.`,
  caption: 'What the bank sells, with the price in material value.',
  show: {
    kind: 'lineup', items: [
      { pic: { scene: BELT_ON_TILE, icon: 'belt' }, label: 'Belt', value: String(BELT_COST) },
      { pic: { flat: { k: 'card', card: 'productionIncrease' } }, label: 'Leverage card', value: 'Mines + 1' },
      { pic: { model: 'mine-2' }, label: 'Mine', value: `${MINE_COSTS[0]}, then ${MINE_COSTS[1]}`, wide: true },
      { pic: { model: 'teleporter', color: 'blue' }, label: 'Teleporter', value: 'On the board + 1' },
    ],
  },
};

/** Breaking a Sphere down, as the bank does it. */
export function exchangeFigure(): FigureBlock {
  const got = exchangeDown('sphere')!;
  const out = MATERIALS.filter(m => got[m]).reverse().flatMap(m => Array.from({ length: got[m]! }, () => m));
  return {
    k: 'figure',
    alt: `One Sphere exchanged for ${out.map(m => MATERIAL_NAME[m]).join(', ')}.`,
    caption: `Exchanging down: 1 Sphere (${MATERIAL_VALUES.sphere}) gives ${out.map(m => MATERIAL_NAME[m]).join(' + ')} (${out.reduce((n, m) => n + MATERIAL_VALUES[m], 0)}).`,
    show: {
      kind: 'lineup', items: [
        { pic: { model: 'sphere' }, label: 'Sphere' },
        { sign: '→' },
        ...out.flatMap((m, i): LineupItem[] => [...(i ? [{ sign: '+' }] : []), { pic: { model: m }, label: MATERIAL_NAME[m] }]),
      ],
    },
  };
}

export function cardFigure(card: CardType): FigureBlock {
  return { k: 'figure', alt: `The ${CARD_NAME[card]} card.`, show: { kind: 'lineup', items: [{ pic: { flat: { k: 'card', card } }, label: '' }] } };
}

export const TESSERACT_COUNT_FIGURE: FigureBlock = {
  k: 'figure',
  alt: `A Tesseract, and the Tesseract count of a player area: 2 of ${TESSERACTS_TO_WIN}.`,
  caption: `Your area counts your Tesseracts and bonus cards together: here 2 of the ${TESSERACTS_TO_WIN} you need.`,
  show: {
    kind: 'lineup', items: [
      { pic: { model: 'tesseract' }, label: 'Tesseract', value: `Value ${MATERIAL_VALUES.tesseract}` },
      { pic: { flat: { k: 'pips', n: 2 } }, label: 'Tesseracts toward winning' },
    ],
  },
};

export const WIN_FIGURE: FigureBlock = {
  k: 'figure',
  alt: `The Tesseract count of a player area, full: ${TESSERACTS_TO_WIN} of ${TESSERACTS_TO_WIN}.`,
  caption: `All ${TESSERACTS_TO_WIN} marks lit during your own turn: you win.`,
  show: { kind: 'lineup', items: [{ pic: { flat: { k: 'pips', n: TESSERACTS_TO_WIN } }, label: '' }] },
};

// ── Staged scenes ──────────────────────────────────────────────────────────────────────────────

/** Free spaces touching the pieces: where the next piece may go (what the game makes glow). */
export function freeSpaces(pieces: readonly ScenePiece[]): { q: number; r: number }[] {
  const taken = new Set<string>();
  for (const p of pieces) {
    taken.add(`${p.q},${p.r}`);
    if (p.type === 'mine') { const s = mineSecondaryCoord({ q: p.q, r: p.r }, p.rot ?? 0); taken.add(`${s.q},${s.r}`); }
  }
  const out: { q: number; r: number }[] = [];
  for (const key of taken) {
    const [q, r] = key.split(',').map(Number) as [number, number];
    for (const n of hexNeighbours({ q, r })) {
      const k = `${n.q},${n.r}`;
      if (!taken.has(k) && !out.some(o => o.q === n.q && o.r === n.r)) out.push({ q: n.q, r: n.r });
    }
  }
  return out;
}

const PLACE_PIECES: ScenePiece[] = [
  { id: 'mine-1', type: 'mine', q: 0, r: 0 },
  { id: 'pp', type: 'powerPlant', q: 0, r: 1, rot: 1 },
  { id: 'b1', type: 'blank', q: -1, r: 0 },
  { id: 'pf', type: 'plateFact', q: 1, r: -1, rot: 2 },
];

export const PLACE_FIGURE: FigureBlock = {
  k: 'figure',
  alt: 'A small board: the first Mine with a Power Plant, a Plate Factory and a blank tile. Every free space touching the board glows; a Sphere Factory waits, see-through, on one of them.',
  caption: 'Every free space that touches the board glows. Tap one, turn the piece, and confirm.',
  show: {
    kind: 'scene',
    scene: { pieces: PLACE_PIECES, glow: { color: 'blue', at: freeSpaces(PLACE_PIECES) }, ghost: { type: 'sphereFact', q: -1, r: 1, rot: 1 } },
  },
};

export const MINE_FIGURE: FigureBlock = {
  k: 'figure',
  alt: 'The first Mine, with markers on an ore exit of its larger half, an ore exit of its smaller half, its resource point and its upgrade point.',
  caption: 'The first Mine. Ore leaves it where the printed rays and tracks reach the edge.',
  show: {
    kind: 'scene',
    scene: { pieces: [{ id: 'mine-1', type: 'mine', q: 0, r: 0 }], aspect: 16 / 9 },
    callouts: [
      { mark: '1', at: { piece: 'mine-1', point: 7 }, text: 'The larger half: an ore exit on both points of every outer edge.' },
      { mark: '2', at: { piece: 'mine-1', point: 17 }, text: 'The smaller half: the first Mine has 3 ore exits here, one on every other edge. The second and third Mines have none.' },
      { mark: '3', at: { piece: 'mine-1', slot: 0 }, text: 'The resource point, room for one meeple.' },
      { mark: '4', at: { piece: 'mine-1', slot: 1 }, text: 'The upgrade point, room for one meeple.' },
    ],
    icon: 'mine',
  },
};

export const FACTORY_TILE_FIGURE: FigureBlock = {
  k: 'figure',
  alt: 'A Sphere Factory claimed with Control Module 6, holding Ore and a Plate in its input and a Sphere in its output, with markers on the input, the output, a belt hole and the Control Module.',
  caption: 'A Sphere Factory, claimed by Blue, with a full input and a finished Sphere in its output.',
  show: {
    kind: 'scene',
    scene: { pieces: [{ id: 'sf', type: 'sphereFact', q: 0, r: 0, claims: [[0, 6]], input: ['ore', 'plate'], output: ['sphere'] }], aspect: 4 / 3 },
    callouts: [
      { mark: '1', at: { piece: 'sf', buffer: 'input' }, text: '**Input**: one slot for each material the recipe needs, here an Ore and a Plate.' },
      { mark: '2', at: { piece: 'sf', buffer: 'output' }, text: '**Output**: holds one finished material.' },
      { mark: '3', at: { piece: 'sf', point: 4 }, text: 'A **belt hole** (connection point): anyone\'s belt may end here.' },
      { mark: '4', at: { piece: 'sf', centre: true, dz: -22 }, text: 'A **Control Module**: Blue has claimed the building, and it runs when the dice show 6.' },
    ],
  },
};

export const CLAIMED_FIGURE: FigureBlock = {
  k: 'figure',
  alt: 'Three claimed buildings: Blue\'s Plate Factory with Control Module 5, Blue\'s Sphere Factory with modules 4 and 9, and Red\'s Tesseract Factory with module 7.',
  caption: 'Control Modules on buildings, in their owners\' colours.',
  show: {
    kind: 'scene',
    scene: {
      pieces: [
        { id: 'pf', type: 'plateFact', q: 0, r: 0, claims: [[0, 5]] },
        { id: 'sf', type: 'sphereFact', q: 1, r: 0, claims: [[0, 4], [0, 9]] },
        { id: 'tf', type: 'tesseractFact', q: 0, r: 1, claims: [[1, 7]] },
      ],
    },
    callouts: [
      { mark: '1', at: { piece: 'pf', centre: true, dz: -22 }, text: 'Blue\'s Control Module 5: this Plate Factory activates when the dice show 5.' },
      { mark: '2', at: { piece: 'sf', centre: true, dz: -22 }, text: 'Two of Blue\'s modules on one building: it activates on a 4 and on a 9.' },
      { mark: '3', at: { piece: 'tf', centre: true, dz: -22 }, text: 'Red\'s Tesseract Factory: Blue cannot put a module on it.' },
    ],
  },
};

export const PRODUCTION_FIGURE: FigureBlock = {
  k: 'figure',
  alt: 'The first Mine touching a Plate Factory and a Power Plant, both holding Ore. A belt on a blank tile runs from the Plate Factory\'s output to a Sphere Factory, which holds a Plate.',
  caption: 'Material on its way: Ore by direct contact, a Plate along a belt.',
  show: {
    kind: 'scene',
    scene: {
      pieces: [
        { id: 'mine-1', type: 'mine', q: 0, r: 0 },
        { id: 'pf', type: 'plateFact', q: -1, r: 0, rot: 3, claims: [[0, 3]], input: ['ore'] },
        { id: 'bl', type: 'blank', q: -2, r: 0 },
        { id: 'sf', type: 'sphereFact', q: -2, r: 1, rot: 1, claims: [[0, 6]], input: ['plate', null] },
        { id: 'pp', type: 'powerPlant', q: 0, r: 1, rot: 1, claims: [[0, 2]], input: ['ore'] },
      ],
      belts: [{ piece: 'bl', a: 6, b: 9 }],
      aspect: 2.1,
    },
    callouts: [
      { mark: '1', at: { piece: 'pf', buffer: 'input' }, text: '**Direct contact**: the Plate Factory\'s input touches an ore exit, so the Mine fills it with Ore.' },
      { mark: '2', at: { piece: 'bl', belt: 0 }, text: 'A **belt** from the Plate Factory\'s output to the Sphere Factory\'s input carried the Plate it made.' },
      { mark: '3', at: { piece: 'pp', buffer: 'input' }, text: 'The Power Plant touches the Mine too: with Ore in it, it gives more Power Tokens when it runs.' },
    ],
  },
};

export const BELT_CHAIN_FIGURE: FigureBlock = {
  k: 'figure',
  alt: 'Two belts on two blank tiles carry Ore from an ore exit of the first Mine to a Plate Factory\'s input.',
  caption: 'A chain of two belts from a Mine to a Plate Factory. The chevrons point the way material flows.',
  show: {
    kind: 'scene',
    scene: {
      pieces: [
        { id: 'mine-1', type: 'mine', q: 0, r: 0 },
        { id: 'b1', type: 'blank', q: -1, r: 0 },
        { id: 'b2', type: 'blank', q: -2, r: 1 },
        { id: 'pf', type: 'plateFact', q: -3, r: 1, rot: 3, claims: [[0, 4]], input: ['ore'] },
      ],
      belts: [{ piece: 'b1', a: 7, b: 10 }, { piece: 'b2', a: 5, b: 1 }],
      aspect: 2.6,
    },
    callouts: [
      { mark: '1', at: { piece: 'b1', belt: 0 }, text: 'The first belt starts at the point facing an ore exit.' },
      { mark: '2', at: { piece: 'b2', belt: 0 }, text: 'The next belt starts at the matching point of the neighbouring piece.' },
      { mark: '3', at: { piece: 'pf', buffer: 'input' }, text: 'The last belt ends at the point facing the input: Ore arrives.' },
    ],
  },
};

export const BELT_RULE_FIGURE: FigureBlock = {
  k: 'figure',
  alt: 'Two blank tiles. On the left, a belt from point 3 to point 9, allowed. On the right, a belt from point 5 to point 7, across one corner, not allowed.',
  caption: 'A belt\'s two ends must be more than two points apart.',
  show: {
    kind: 'scene',
    scene: {
      pieces: [{ id: 'l', type: 'blank', q: 0, r: 0 }, { id: 'r', type: 'blank', q: 1, r: 0 }],
      belts: [{ piece: 'l', a: 2, b: 8 }, { piece: 'r', a: 4, b: 6, illegal: 'POINTS_TOO_CLOSE' }],
      aspect: 2,
    },
    callouts: [
      { mark: '✓', at: { piece: 'l', belt: 0 }, text: 'From #3 to #9: far enough apart.' },
      { mark: '✗', at: { piece: 'r', belt: 0 }, text: 'From #5 to #7: only two points apart, across one corner. The game does not allow it.' },
    ],
  },
};

export const TELEPORTER_FIGURE: FigureBlock = {
  k: 'figure',
  alt: 'Blue\'s Plate Factory with a teleporter on its output, and Blue\'s Power Plant with a teleporter on its input.',
  caption: 'Two of Blue\'s teleporters: one on an output, one on an input.',
  show: {
    kind: 'scene',
    scene: {
      pieces: [
        { id: 'pf', type: 'plateFact', q: 0, r: 0, claims: [[0, 3]], tpOut: 0 },
        { id: 'pp', type: 'powerPlant', q: 0, r: 1, claims: [[0, 2]], tpIn: 0 },
      ],
      aspect: 4 / 3,
    },
    callouts: [
      { mark: '1', at: { piece: 'pf', teleporter: 'output' }, text: 'On the output: whatever the Plate Factory makes goes straight into your materials.' },
      { mark: '2', at: { piece: 'pp', teleporter: 'input' }, text: 'On the input: when the Power Plant runs, you may hand over a material of yours for more Power Tokens.' },
    ],
    icon: 'teleporter',
  },
};

export const MEEPLE_FIGURE: FigureBlock = {
  k: 'figure',
  alt: 'Blue\'s meeple on the first Mine\'s resource point, Red\'s on its upgrade point, and Orange\'s on Orange\'s Plate Factory.',
  caption: 'Meeples on both points of a Mine and on a building of their owner.',
  show: {
    kind: 'scene',
    scene: {
      pieces: [
        { id: 'mine-1', type: 'mine', q: 0, r: 0 },
        { id: 'pf', type: 'plateFact', q: -1, r: 0, rot: 3, claims: [[2, 3]], input: ['ore'] },
      ],
      meeples: [{ player: 0, piece: 'mine-1', slot: 0 }, { player: 1, piece: 'mine-1', slot: 1 }, { player: 2, piece: 'pf' }],
      aspect: 2.4,
    },
    callouts: [
      { mark: '1', at: { piece: 'mine-1', slot: 0 }, text: 'Blue on the resource point: Blue gets the Mine\'s material at the end of the round.' },
      { mark: '2', at: { piece: 'mine-1', slot: 1 }, text: 'Red on the upgrade point: Red gets Mine credits.' },
      { mark: '3', at: { piece: 'pf', centre: true, dz: 22 }, text: 'Orange on Orange\'s own Plate Factory: in the round-end turn Orange may load it, run it and collect from it.' },
    ],
    icon: 'meeple',
  },
};

export const SETUP_FIGURE: FigureBlock = {
  k: 'figure',
  alt: 'A starting board for three players: four pieces per player laid around the first Mine, with each player\'s Control Module 3 on a Plate Factory and 2 on a Power Plant.',
  caption: 'A starting board for three players, after the first claims: each player\'s 3 on a Plate Factory and 2 on a Power Plant.',
  show: { kind: 'scene', scene: { setup: { seed: 7, players: 3, claims: true }, colors: ['blue', 'red', 'green'], aspect: 4 / 3 } },
};
