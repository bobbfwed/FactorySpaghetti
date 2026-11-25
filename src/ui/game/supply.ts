// The supply chooser: running a building that has my teleporter on its input. It shows what the
// building needs, its input slots (filled or empty) and my materials, and one button per way the
// rules allow it to run now (each button is one listed move: "Provide a Sphere and a Plate",
// "Run it with what is in it", Skip). Nothing here decides what is allowed: the buttons are the
// play view's items, which come from legalActions.

import type { Item, SupplyView } from '../../play';
import type { Material } from '../../engine/config';
import { MATERIAL_NAME } from '../../session/describe';
import { W } from '../../play/words';
import { h } from '../dom';
import { icon } from '../icons';
import { MATERIAL_ICON, MATERIAL_LIST } from './pieces';

function slot(m: Material | null): HTMLElement {
  return m
    ? h('span', { class: 'tg-sslot full', attrs: { 'aria-label': MATERIAL_NAME[m] } }, icon(MATERIAL_ICON[m]))
    : h('span', { class: 'tg-sslot empty', attrs: { 'aria-label': W.empty } });
}

/** The picture: what it needs, its input slots, my materials, and why nothing can be supplied. */
export function supplyBlock(s: SupplyView, compact = false): HTMLElement {
  return h('div', { class: `tg-supply${compact ? ' compact' : ''}` },
    h('p', { class: 'need', text: s.heading }),
    h('div', { class: 'row' },
      h('span', { class: 'k', text: W.supplyInput }),
      h('span', { class: 'slots', attrs: { role: 'img', 'aria-label': `${W.supplyInput}: ${s.slots.map(x => (x ? MATERIAL_NAME[x] : W.empty)).join(', ')}` } }, s.slots.map(slot))),
    h('div', { class: 'row' },
      h('span', { class: 'k', text: W.supplyYouHold }),
      h('span', { class: 'have' }, MATERIAL_LIST.map(m => h('span', {
        class: `tg-count${s.have[m] === 0 ? ' zero' : ''}`, attrs: { 'aria-label': `${MATERIAL_NAME[m]}: ${s.have[m]}` },
      }, icon(MATERIAL_ICON[m], undefined, 'ic small'), h('span', { class: 'num', text: String(s.have[m]) }))))),
    s.missing ? h('p', { class: 'miss', text: s.missing }) : null);
}

/**
 * One button per listed way to run it: the materials it hands over as icons, its words and what
 * it costs and makes (shown, not only on hover). `actKey` keeps each button's press guard apart.
 */
export function supplyButtons(items: readonly Item[], choose: (id: string) => void, actKey: string, first: 'gold' | 'none' = 'gold'): HTMLElement {
  return h('div', { class: 'tg-supplybtns', attrs: { role: 'group', 'aria-label': W.supplyYouHold } }, items.map((o, i) => h('button', {
    class: `tg-supplybtn${i === 0 && first === 'gold' ? ' first' : ''}${o.id.endsWith(':skip') ? ' skip' : ''}${o.enabled ? '' : ' off'}`,
    title: o.enabled ? o.detail ?? o.label : o.reason ?? o.label,
    attrs: { 'aria-disabled': String(!o.enabled), 'data-item': o.id, 'data-act': `${actKey}|${o.id}`, 'data-strict': '1' },
    onclick: () => choose(o.id),
  },
  o.materials && o.materials.length > 0
    ? h('span', { class: 'mats', attrs: { 'aria-hidden': 'true' } }, o.materials.map(m => icon(MATERIAL_ICON[m], undefined, 'ic small')))
    : null,
  h('span', { class: 'tx' },
    h('span', { class: 'lb', text: o.label }),
    o.enabled ? (o.detail ? h('span', { class: 'dt', text: o.detail }) : null) : h('span', { class: 'dt', text: o.reason ?? '' })))));
}
