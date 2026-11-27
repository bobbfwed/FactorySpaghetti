// Popovers over the table: the building (or belt) menu anchored to its piece, the floating list of
// choices a flow needs (Scouting Drone's pile, exchange options, …), and the enlarged hand card.

import { CARD_NAME } from '../../play/words';
import { h } from '../dom';
import { icon } from '../icons';
import type { Ctx } from './context';
import { seatHex } from './context';
import { cardFace } from './pieces';
import { supplyBlock, supplyButtons } from './supply';

/** A way to run the building (plain, supplied) or skip it: shown as supply buttons beside the chooser. */
function isRun(it: { id: string }): boolean {
  return /^(menu|op:[^:]+):(run|skip)(:|$)/.test(it.id);
}

/** The building menu: title, subtitle, a note, items with detail; greyed items show their reason. */
export function buildingMenu(ctx: Ctx): HTMLElement | null {
  const m = ctx.view.menu;
  if (!m) return null;
  return h('div', {
    class: 'tg-pop tray', attrs: { 'data-anchor': JSON.stringify(m.anchor), 'data-place': 'side', role: 'menu', 'aria-label': m.title },
  },
  h('span', { class: 'tg-ptr' }),
  h('div', { class: 'hd' },
    h('div', { class: 'tt' }, h('span', { class: 't', text: m.title }), m.subtitle ? h('span', { class: 'sub', text: m.subtitle }) : null),
    h('button', { class: 'x round small', title: 'Close', attrs: { 'aria-label': 'Close', 'data-close': 'menu' }, onclick: () => ctx.play.cancel() }, icon('cross'))),
  // A line about the building itself (a Control Module of mine on it that cannot be rolled).
  m.note ? h('div', { class: 'note', attrs: { role: 'note' }, text: m.note }) : null,
  // Running a building through my input teleporter: the supply chooser, then the menu's other items.
  m.supply ? supplyBlock(m.supply, ctx.phone) : null,
  m.supply ? supplyButtons(m.items.filter(isRun), id => ctx.play.choose(id), JSON.stringify(m.anchor), 'none') : null,
  (m.supply ? m.items.filter(it => !isRun(it)) : m.items).map(it => h('button', {
    class: `item${it.enabled ? '' : ' off'}${it.danger ? ' danger' : ''}`,
    title: it.enabled ? it.detail ?? it.label : it.reason ?? it.label,
    attrs: { role: 'menuitem', 'aria-disabled': String(!it.enabled), 'data-item': it.id, 'data-act': `${JSON.stringify(m.anchor)}|${it.id}` },
    onclick: () => ctx.play.choose(it.id),
  },
  h('span', { class: 'lb', text: it.label }),
  it.enabled ? (it.detail ? h('span', { class: 'dt', text: it.detail }) : null) : h('span', { class: 'dt', text: it.reason ?? '' }),
  it.danger && it.enabled ? h('span', { class: 'warnline', text: 'You cannot take it back.' }) : null)));
}

/** What the three looks of a planned route mean, with how many belts each has. */
function routeLegend(ctx: Ctx): HTMLElement | null {
  const r = ctx.view.route;
  if (!r) return null;
  const n = (t: 'own' | 'buy' | 'cant'): number => r.filter(x => x.tier === t).length;
  const key = (t: 'own' | 'buy' | 'cant', text: string): HTMLElement | null => (n(t) > 0
    ? h('span', { class: `k ${t}` }, h('span', { class: 'sw' }), `${n(t)} ${text}`) : null);
  return h('div', { class: 'tg-routekey', style: `--seat:${seatHex(ctx.room, ctx.me ?? 0)}`, attrs: { 'aria-label': 'Route key' } },
    key('own', 'from your supply'), key('buy', 'to buy now'), key('cant', 'for a later turn'));
}

/** The list a flow is waiting on; it floats, so the table stays usable around it. */
export function choicesPanel(ctx: Ctx): HTMLElement | null {
  const c = ctx.view.choices;
  if (!c) return null;
  // A planned belt route docks at the side, so it does not cover the route on the board.
  // On the phone a planned route keeps the panel to one row of buttons, so the route stays visible.
  const compact = !!ctx.view.route && ctx.phone;
  return h('div', { class: `tg-choices tray${ctx.view.route ? ' route' : ''}${compact ? ' compact' : ''}`, attrs: { role: 'dialog', 'aria-label': c.title } },
    h('div', { class: 'hd' }, h('b', { text: c.title }),
      h('button', { class: 'x round small', title: 'Cancel', attrs: { 'aria-label': 'Cancel', 'data-close': 'choices' }, onclick: () => ctx.play.cancel() }, icon('cross'))),
    ctx.view.route ? routeLegend(ctx) : null,
    h('div', { class: 'list' }, c.items.map(it => h('button', {
      class: `item well${it.enabled ? '' : ' off'}${it.danger ? ' danger' : ''}`,
      title: it.enabled ? it.detail ?? it.label : it.reason ?? it.label,
      attrs: { 'aria-disabled': String(!it.enabled), 'data-item': it.id, 'data-act': `${c.title}|${it.id}` },
      onclick: () => ctx.play.choose(it.id),
    },
    h('span', { class: 'lb', text: it.label }),
    it.enabled ? (it.detail ? h('span', { class: 'dt', text: it.detail }) : null) : h('span', { class: 'dt', text: it.reason ?? '' })))));
}

/** A hand card shown large, with its rules text and Play (or why it cannot be played now). */
export function cardModal(ctx: Ctx): HTMLElement | null {
  const card = ctx.ui.card;
  if (card === null) return null;
  const it = ctx.view.hand.find(c => c.card === card);
  const close = (): void => { ctx.ui.card = null; ctx.redraw(); };
  if (!it) { ctx.ui.card = null; return null; }
  const cnt = it.count ?? 1;
  const veil = h('div', {
    class: 'tg-veil', attrs: { 'data-veil': 'card' },
    onclick: (e) => { if (e.target === veil) close(); },
  },
  h('div', { class: 'tg-cardmodal', attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-label': CARD_NAME[card] } },
    cardFace(card, { big: true, count: cnt }),
    it.enabled ? null : h('p', { class: 'reason', text: it.reason ?? '' }),
    h('div', { class: 'tg-btnrow' },
      h('button', { class: 'btn btn-dark btn-lg', attrs: { 'data-close': 'card' }, onclick: close }, 'Close'),
      h('button', {
        class: `btn btn-gold btn-lg${it.enabled ? '' : ' is-disabled'}`,
        attrs: { 'aria-disabled': String(!it.enabled), 'data-play': card, 'data-act': `play:${card}` },
        onclick: () => { if (it.enabled) { ctx.ui.card = null; if (ctx.phone) ctx.ui.sheetOpen = false; } ctx.play.choose(it.id); },
      }, icon('play'), 'Play'))));
  return veil;
}
