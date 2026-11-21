// Desktop: the collapsible right-hand panel with the game log, the rules reference and the bonus
// cheat sheet, opened from tabs on the right edge.

import { h } from '../dom';
import { icon } from '../icons';
import type { Ctx, SideTab } from './context';
import { cachedBonuses, cachedLog, cachedRules } from './memo';

const TABS: { id: SideTab; label: string }[] = [
  { id: 'log', label: 'Log' }, { id: 'rules', label: 'Rules' }, { id: 'bonuses', label: 'Bonuses' },
];

export function edgeTabs(ctx: Ctx): HTMLElement {
  return h('div', { class: `tg-edgetabs${ctx.ui.side ? ' shifted' : ''}`, attrs: { role: 'tablist', 'aria-label': 'Reference' } }, TABS.map(t => h('button', {
    class: ctx.ui.side === t.id ? 'on' : '',
    attrs: { role: 'tab', 'aria-selected': String(ctx.ui.side === t.id), 'data-side': t.id },
    onclick: () => { ctx.ui.side = ctx.ui.side === t.id ? null : t.id; ctx.redraw(); },
  }, t.label)));
}

export function sidePanel(ctx: Ctx): HTMLElement | null {
  const tab = ctx.ui.side;
  if (!tab) return null;
  const title = TABS.find(t => t.id === tab)!.label;
  return h('aside', { class: 'tg-side tray', attrs: { role: 'tabpanel', 'aria-label': title } },
    h('div', { class: 'hd' }, h('b', { text: tab === 'bonuses' ? 'Bonus Tesseracts' : tab === 'rules' ? 'Rules reference' : 'Game log' }),
      h('button', { class: 'x round small', title: 'Close', attrs: { 'aria-label': 'Close' }, onclick: () => { ctx.ui.side = null; ctx.redraw(); } }, icon('cross'))),
    h('div', { class: 'body' }, tab === 'log' ? cachedLog(ctx) : tab === 'rules' ? cachedRules(ctx) : cachedBonuses(ctx)));
}
