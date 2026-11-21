// The bank: belt, Leverage card, Mine, teleporter and exchange, each with its price. A greyed item
// still answers a tap with the reason it cannot be bought now. Prices come from the play view,
// which takes them from the engine's own price rules; nothing is worked out here.

import type { Item } from '../../play';
import { h } from '../dom';
import type { IconName } from '../icons';
import { icon } from '../icons';
import type { Ctx } from './context';

const SHOWN: Record<string, { label: string; icon: IconName }> = {
  'bank:buyBelt': { label: 'Belt', icon: 'belt' },
  'bank:buyCard': { label: 'Leverage card', icon: 'card' },
  'bank:buyMine': { label: 'Mine', icon: 'mine' },
  'bank:teleporter': { label: 'Teleporter', icon: 'teleporter' },
  'bank:exchange': { label: 'Exchange', icon: 'exchange' },
};

/** The price shown on a bank item: the play view's number, a dash when there is none to buy. */
export function bankPrice(it: Item): string {
  if (it.id === 'bank:exchange') return '';
  return it.price === undefined ? '—' : String(it.price);
}

function chip(ctx: Ctx, it: Item, cls: string): HTMLElement {
  const s = SHOWN[it.id]!;
  const p = bankPrice(it);
  const tip = it.enabled ? it.detail ?? it.label : it.reason ?? it.label;
  return h('button', {
    class: `${cls}${it.enabled ? '' : ' off'}${it.id === 'bank:exchange' ? ' wide' : ''}`,
    title: `${it.label}. ${tip}`,
    attrs: {
      'aria-disabled': String(!it.enabled), 'data-item': it.id, 'data-act': it.id,
      'aria-label': `${it.label}${p && p !== '—' ? `, price ${p}` : ''}${it.enabled ? '' : `. ${tip}`}`,
    },
    onclick: () => ctx.play.choose(it.id),
  }, icon(s.icon, ctx.me !== null ? ctx.room.seats[ctx.me]?.color : undefined), h('span', { class: 'lb', text: s.label }), p ? h('span', { class: 'num', text: p }) : null);
}

/** Desktop: the bank panel at the top right. */
export function bankPanel(ctx: Ctx): HTMLElement | null {
  if (ctx.me === null || ctx.game.gameOver) return null;
  const items = ctx.view.bank.filter(i => i.id in SHOWN);
  return h('div', { class: 'tg-bank tray', attrs: { role: 'group', 'aria-label': 'Bank' } },
    h('div', { class: 'label', text: 'Bank · prices in material value' }),
    items.map(it => chip(ctx, it, 'tg-bchip')));
}

/** Phone: the bank as rows inside the tray tab. */
export function bankRows(ctx: Ctx): HTMLElement | null {
  if (ctx.me === null || ctx.game.gameOver) return null;
  const items = ctx.view.bank.filter(i => i.id in SHOWN);
  return h('div', { class: 'tg-bankrows', attrs: { role: 'group', 'aria-label': 'Bank' } }, items.map(it => chip(ctx, it, 'tg-brow well')));
}
