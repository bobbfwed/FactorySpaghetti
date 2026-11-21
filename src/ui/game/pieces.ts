// Small shared drawings of the game screen: Tesseract pips, the Control Module tray, Leverage
// cards, material counts and countdowns. All text goes in as text nodes.

import type { AppController } from '../../app/controller';
import type { CardType, Material } from '../../engine/config';
import { INVENTORY_CAP, PLAY_ON_DRAW_CARDS } from '../../engine/config';
import type { TrayEntry } from '../../play';
import { CARD_NAME, CARD_TEXT, MATERIAL_NAME } from '../../play/words';
import type { SeatColor } from '../../session/room';
import type { Child } from '../dom';
import { h } from '../dom';
import type { IconName } from '../icons';
import { COLORS, icon } from '../icons';
import { clock } from './context';

export const MATERIAL_ICON: Record<Material, IconName> = { ore: 'ore', plate: 'plate', sphere: 'sphere', tesseract: 'tess' };
export const MATERIAL_LIST: readonly Material[] = ['ore', 'plate', 'sphere', 'tesseract'];

/** Four Tesseract pips, `n` of them filled. */
export function pips(n: number, label = 'Tesseracts'): HTMLElement {
  return h('span', { class: 'tg-pips', attrs: { role: 'img', 'aria-label': `${label}: ${n} of 4` } },
    [0, 1, 2, 3].map(i => icon(i < n ? 'pipOn' : 'pipOff', undefined, 'tg-pip')));
}

/** A count with an icon, e.g. ore 3. */
export function count(name: IconName, n: number | string, label: string, color?: SeatColor, cls = ''): HTMLElement {
  return h('span', { class: `tg-count ${cls}`, title: label, attrs: { 'aria-label': `${label}: ${n}` } },
    icon(name, color), h('span', { class: 'num', text: String(n) }));
}

/**
 * The 3×6 Control Module tray, rows from 18 down to 1 like the printed tray. A module on the board
 * leaves an empty pocket; a lit module is a button that chooses it.
 */
export function moduleTray(tray: readonly TrayEntry[], color: SeatColor, choose: (id: string) => void, cls = ''): HTMLElement {
  const by = new Map(tray.map(t => [t.module, t]));
  const cells: HTMLElement[] = [];
  for (let r = 0; r < 6; r++) {
    for (let c = 0; c < 3; c++) {
      const n = 18 - (3 * r + c);
      const t = by.get(n);
      const state = t?.state ?? 'onBoard';
      const under = n === 6 || n === 9 ? ' u' : '';
      if (state === 'onBoard') {
        cells.push(h('span', { class: 'tg-mod empty', title: `Control Module ${n} is on the board`, attrs: { 'aria-label': `Module ${n}: on the board` } }));
      } else if (state === 'lit') {
        const cost = t?.cost ? (/^(\d+)/.exec(t.cost)?.[1] ?? (t.cost === 'free' ? '0' : '')) : '';
        cells.push(h('button', {
          class: `tg-mod lit${under}`, style: `background:${COLORS[color]}`,
          title: `Control Module ${n}${t?.cost ? ` · ${t.cost}` : ''}`,
          attrs: { 'aria-label': `Use Control Module ${n}${t?.cost ? `, costs ${t.cost}` : ''}`, 'data-module': String(n) },
          onclick: () => choose(`module:${n}`),
        }, h('span', { class: 'n', text: String(n) }), cost ? h('span', { class: 'cost', text: cost }) : null));
      } else {
        cells.push(h('span', { class: `tg-mod${under}`, style: `background:${COLORS[color]}`, attrs: { 'aria-label': `Module ${n}: in the tray` } },
          h('span', { class: 'n', text: String(n) })));
      }
    }
  }
  const lit = tray.some(t => t.state === 'lit' && t.cost);
  return h('div', { class: `tg-modwrap ${cls}` },
    h('div', { class: `tg-modtray${lit ? ' has-lit' : ''}`, attrs: { role: 'group', 'aria-label': 'Control Module tray' } }, cells),
    lit ? h('div', { class: 'tg-modnote', text: 'Corner number: upgrades it costs' }) : null);
}

/** A Leverage card face. */
export function cardFace(card: CardType, opts: { count?: number; big?: boolean; off?: boolean } = {}): HTMLElement {
  const foot = PLAY_ON_DRAW_CARDS.has(card) ? 'Played as soon as it is drawn' : 'Step 3 · up to 2 per turn';
  return h('div', { class: `tg-card${opts.big ? ' big' : ''}${opts.off ? ' off' : ''}` },
    h('div', { class: 'top', text: 'LEVERAGE' }),
    h('div', { class: 'band' }, h('span', { text: CARD_NAME[card] }), opts.count && opts.count > 1 ? h('span', { class: 'x', text: `×${opts.count}` }) : null),
    h('div', { class: 'txt', text: CARD_TEXT[card] }),
    h('div', { class: 'foot', text: foot }));
}

/** A material well: icon, name, count, and a "full" mark at the cap. */
export function materialWell(m: Material, n: number, cls = 'tg-mat'): HTMLElement {
  const full = n >= INVENTORY_CAP;
  return h('div', {
    class: `${cls} well${n === 0 ? ' zero' : ''}${full ? ' full' : ''}`,
    attrs: { 'aria-label': `${MATERIAL_NAME[m]}: ${n}${full ? `, the limit of ${INVENTORY_CAP}` : ''}` },
  },
  icon(MATERIAL_ICON[m]), h('span', { class: 'nm', text: MATERIAL_NAME[m] }),
  full ? h('span', { class: 'cap', text: `max ${INVENTORY_CAP}` }) : null,
  h('span', { class: 'num', text: String(n) }));
}

/** Text countdown kept current by the screen's one-second ticker. */
export function countdownText(ctrl: AppController, deadline: number, prefix = '', cls = 'tg-countdown'): HTMLElement {
  return h('span', { class: cls, attrs: { 'data-deadline': String(deadline), 'data-prefix': prefix } }, prefix + clock(ctrl.msLeft(deadline)));
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const RING_R = 22;
const RING_LEN = 2 * Math.PI * RING_R;

/** A countdown ring (operate-or-skip prompts). */
export function countdownRing(ctrl: AppController, deadline: number, totalMs: number): HTMLElement {
  const ms = ctrl.msLeft(deadline) ?? 0;
  const s = document.createElementNS(SVG_NS, 'svg');
  s.setAttribute('viewBox', '0 0 52 52');
  s.setAttribute('aria-hidden', 'true');
  const bg = document.createElementNS(SVG_NS, 'circle');
  const fg = document.createElementNS(SVG_NS, 'circle');
  for (const c of [bg, fg]) {
    c.setAttribute('cx', '26'); c.setAttribute('cy', '26'); c.setAttribute('r', String(RING_R));
    c.setAttribute('fill', 'none'); c.setAttribute('stroke-width', '5');
  }
  bg.setAttribute('stroke', '#2a2a2e');
  fg.setAttribute('stroke', '#e8b730');
  fg.setAttribute('stroke-linecap', 'round');
  fg.setAttribute('class', 'arc');
  fg.setAttribute('stroke-dasharray', ringDash(ms, totalMs));
  s.append(bg, fg);
  return h('span', {
    class: 'tg-ring',
    attrs: { 'data-deadline': String(deadline), 'data-total': String(totalMs), 'data-ring': '1', role: 'timer', 'aria-label': `${clock(ms)} left` },
  }, s as unknown as Node, h('span', { class: 'v', text: String(Math.max(0, Math.ceil(ms / 1000))) }));
}

export function ringDash(ms: number, total: number): string {
  const f = total > 0 ? Math.max(0, Math.min(1, ms / total)) : 0;
  return `${(f * RING_LEN).toFixed(1)} ${RING_LEN.toFixed(1)}`;
}

/** Dice faces for the "Rolled" chip. */
export function die(n: number): HTMLElement {
  const spots: Record<number, [number, number][]> = {
    1: [[50, 50]], 2: [[28, 28], [72, 72]], 3: [[26, 26], [50, 50], [74, 74]],
    4: [[28, 28], [72, 28], [28, 72], [72, 72]], 5: [[26, 26], [74, 26], [50, 50], [26, 74], [74, 74]],
    6: [[28, 24], [72, 24], [28, 50], [72, 50], [28, 76], [72, 76]],
  };
  return h('span', { class: 'tg-die', attrs: { role: 'img', 'aria-label': String(n) } },
    (spots[n] ?? []).map(([x, y]) => h('i', { style: `left:${x}%;top:${y}%` })));
}

export function sectionHead(title: string, extra: Child = null): HTMLElement {
  return h('div', { class: 'tg-sechd' }, h('span', { class: 'label', text: title }), extra);
}
