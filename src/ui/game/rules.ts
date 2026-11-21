// Reference panels: the game log, a compact rules sheet and the bonus cheat sheet. Every number
// comes from the engine's config, so a tuned value shows up here without editing this file.

import type { Material, PieceType } from '../../engine/config';
import {
  BELT_COST, BONUS_THRESHOLDS, FACTORY_POWER_COST, FACTORY_RECIPES, INVENTORY_CAP, MATERIAL_VALUES, MAX_CARDS_PLAYED_PER_TURN,
  MAX_CLAIMS_PER_BUILDING, MINE_COSTS, POWER_PLANT_BASE_YIELD, POWER_PLANT_MATERIAL_YIELD, POWER_TOKEN_CAP, PRODUCTION_INCREASE_BUDGET,
  TESSERACTS_TO_WIN, bonusesEnabled, cardCost, teleporterCost,
} from '../../engine/config';
import { BUILDING_NAME, MATERIAL_NAME } from '../../session/describe';
import type { Child } from '../dom';
import { h } from '../dom';
import { icon } from '../icons';
import type { Ctx } from './context';
import { seatHex, seatName } from './context';
import { MATERIAL_ICON } from './pieces';

export type BonusKey = 'investor' | 'beltWeaver' | 'factoryEmpire';
export const BONUS_NAME: Record<BonusKey, string> = { investor: 'The Investor', beltWeaver: 'Belt Weaver', factoryEmpire: 'Factory Empire' };

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

export function logList(ctx: Ctx, limit = 60): HTMLElement {
  const lines = ctx.room.log.slice(-limit).reverse();
  if (lines.length === 0) return h('p', { class: 'muted', text: 'Nothing has happened yet.' });
  return h('ol', { class: 'tg-log' }, lines.map(e => h('li', null,
    h('span', { class: 'sw', style: `background:${e.seat === null ? '#5d5a55' : seatHex(ctx.room, e.seat)}` }),
    h('span', { text: e.text }))));
}

function mats(list: readonly Material[]): Child[] {
  const out: Child[] = [];
  list.forEach((m, i) => {
    if (i > 0) out.push(h('span', { class: 'plus', text: '+' }));
    out.push(icon(MATERIAL_ICON[m], undefined, 'ic small'), h('span', { class: 'sr', text: MATERIAL_NAME[m] }));
  });
  return out;
}

function row(k: Child, v: Child): HTMLElement {
  return h('div', { class: 'tg-rrow' }, h('span', { class: 'k' }, k), h('span', { class: 'v' }, v));
}

export function rulesSheet(ctx: Ctx): HTMLElement {
  const g = ctx.game;
  const mines = g.mineCount;
  const factories = (Object.entries(FACTORY_RECIPES) as [PieceType, NonNullable<(typeof FACTORY_RECIPES)[PieceType]>][]);
  return h('div', { class: 'tg-rules' },
    h('h3', { text: 'Your turn' }),
    h('ol', { class: 'tg-turnlist' },
      h('li', null, h('b', { text: 'Place a piece' }), ' next to the board, from a stack that is open.'),
      h('li', null, h('b', { text: 'Roll' }), ` one die per Mine (now ${plural(mines, 'die', 'dice')}). Every building whose Control Module matches the total may run, on anyone's turn.`),
      h('li', null, h('b', { text: 'Actions' }), `: buy and lay belts, buy Leverage cards and Mines, place teleporters, exchange materials, play up to ${MAX_CARDS_PLAYED_PER_TURN} Leverage cards.`),
      h('li', null, h('b', { text: 'Place meeple' }), ' on one of your buildings or on a Mine point.')),
    h('p', { class: 'muted', text: `Round end: each player gets ${plural(mines, 'free upgrade', 'free upgrades')} (one per Mine) for one building, and may load, run and collect the building their meeple stands on.` }),

    h('h3', { text: 'Prices' }),
    row([icon('belt'), 'Belt'], String(BELT_COST)),
    row([icon('card'), 'Leverage card'], `Mines + 1 (now ${cardCost(mines)})`),
    row([icon('mine'), 'Mine'], MINE_COSTS.join(' then ')),
    row([icon('teleporter'), 'Teleporter'], `teleporters placed + 1 (now ${teleporterCost(g.globalTeleporterCount)}), paid exactly`),
    row('Claim with Control Module M', `M − Mines + 1 upgrades (now M − ${mines - 1})`),
    row('Upgrade', 'new − old Control Module, in upgrades'),
    row('Production Increase', `${PRODUCTION_INCREASE_BUDGET} upgrades`),
    h('div', { class: 'tg-values' }, (Object.keys(MATERIAL_VALUES) as Material[]).map(m =>
      h('span', { class: 'tg-count' }, icon(MATERIAL_ICON[m]), h('span', { text: MATERIAL_NAME[m] }), h('b', { class: 'num', text: String(MATERIAL_VALUES[m]) })))),
    h('p', { class: 'muted', text: 'Prices are paid in material value. Exchange breaks a material down into smaller ones.' }),

    h('h3', { text: 'Factories' }),
    factories.map(([type, r]) => {
      const product = r.product as Exclude<Material, 'ore'>;
      const power = FACTORY_POWER_COST[product];
      return h('div', { class: 'tg-recipe' },
        h('b', { text: BUILDING_NAME[type] }),
        h('div', { class: 'ins' }, r.inputs.map((set, i) => h('span', { class: 'set' }, i > 0 ? h('span', { class: 'or', text: 'or' }) : null, mats(set)))),
        h('div', { class: 'out' }, icon('power', undefined, 'ic small'), h('span', { text: `${power} → 1 ` }), icon(MATERIAL_ICON[product], undefined, 'ic small'),
          h('span', { class: 'sr', text: MATERIAL_NAME[product] })));
    }),
    h('h3', { text: 'Power Plant' }),
    row('Nothing in its input', `+${POWER_PLANT_BASE_YIELD}`),
    (Object.keys(POWER_PLANT_MATERIAL_YIELD) as (keyof typeof POWER_PLANT_MATERIAL_YIELD)[]).map(m =>
      row([icon(MATERIAL_ICON[m], undefined, 'ic small'), MATERIAL_NAME[m]], `+${POWER_PLANT_MATERIAL_YIELD[m]}`)),

    h('h3', { text: 'Limits' }),
    row('Each material', `${INVENTORY_CAP}`),
    row('Power Tokens', `${POWER_TOKEN_CAP}`),
    outputBufferRow(g),
    row('Leverage cards played per turn', String(MAX_CARDS_PLAYED_PER_TURN)),
    row('Your claims on one building', String(MAX_CLAIMS_PER_BUILDING)),

    h('h3', { text: 'How to win' }),
    h('p', { text: `Show ${TESSERACTS_TO_WIN} Tesseracts on your own turn (face-up bonus cards count). If the board pieces run out, the round is finished and the most material value wins.` }));
}

/** The output buffer's size, read from a building on the board (the engine builds every output buffer the same). */
function outputBufferRow(g: Ctx['game']): Child {
  const n = g.board.find(p => p.output && p.type !== 'mine')?.output?.slots.length;
  return n === undefined ? null : row('Output buffer', plural(n, 'material', 'materials'));
}

export function bonusSheet(ctx: Ctx): HTMLElement {
  const g = ctx.game;
  if (!bonusesEnabled) return h('p', { class: 'muted', text: 'Bonus Tesseracts are switched off in this game.' });
  const holder = (k: BonusKey): number | null => {
    const p = g.players.find(x => x.bonusTesseracts[k]);
    return p ? p.id : null;
  };
  const rows: { k: BonusKey; text: string }[] = [
    { k: 'investor', text: `Highest Control Module on a claimed building, at least ${BONUS_THRESHOLDS.investor}.` },
    { k: 'beltWeaver', text: `Longest unbroken chain of belts linking buildings (or a Mine and a building), at least ${BONUS_THRESHOLDS.beltWeaver} belts.` },
    { k: 'factoryEmpire', text: `Most buildings claimed (several claims on one count once), at least ${BONUS_THRESHOLDS.factoryEmpire}.` },
  ];
  return h('div', { class: 'tg-bonuses' },
    h('p', { class: 'muted', text: 'Each bonus card counts as one Tesseract toward winning while it lies face-up in front of you. It moves the moment someone beats the holder.' }),
    rows.map(r => {
      const who = holder(r.k);
      return h('div', { class: 'tg-bonus well' },
        h('div', { class: 'hd' }, icon('tess'), h('b', { text: BONUS_NAME[r.k] }),
          h('span', { class: 'who', style: who !== null ? `--seat:${seatHex(ctx.room, who)}` : '' },
            who !== null ? h('span', { class: 'sw' }) : null, who !== null ? (who === ctx.me ? 'You' : seatName(ctx.room, who)) : 'Nobody yet')),
        h('p', { text: r.text }));
    }));
}
