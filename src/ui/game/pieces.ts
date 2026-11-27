// Small shared drawings of the game screen: Tesseract pips, the Control Module tray, Leverage
// cards, material counts and countdowns. All text goes in as text nodes.

import type { AppController } from '../../app/controller';
import type { CardType, Material } from '../../engine/config';
import { CONTROL_MODULE_MAX, INVENTORY_CAP, MAX_CARDS_PLAYED_PER_TURN, PLAY_ON_DRAW_CARDS, TESSERACTS_TO_WIN } from '../../engine/config';
import type { Item, TrayEntry } from '../../play';
import { CARD_NAME, CARD_TEXT, MATERIAL_NAME, W } from '../../play/words';
import type { SeatColor } from '../../session/room';
import type { Child } from '../dom';
import { h } from '../dom';
import type { IconName } from '../icons';
import { COLORS, icon } from '../icons';
import { clock } from './context';

export const MATERIAL_ICON: Record<Material, IconName> = { ore: 'ore', plate: 'plate', sphere: 'sphere', tesseract: 'tess' };
export const MATERIAL_LIST: readonly Material[] = ['ore', 'plate', 'sphere', 'tesseract'];

/** One pip per Tesseract needed to win, `n` of them filled. */
export function pips(n: number, label = 'Tesseracts'): HTMLElement {
  return h('span', { class: 'tg-pips', attrs: { role: 'img', 'aria-label': `${label}: ${n} of ${TESSERACTS_TO_WIN}` } },
    Array.from({ length: TESSERACTS_TO_WIN }, (_, i) => icon(i < n ? 'pipOn' : 'pipOff', undefined, 'tg-pip')));
}

/** A count with an icon, e.g. ore 3. */
export function count(name: IconName, n: number | string, label: string, color?: SeatColor, cls = ''): HTMLElement {
  return h('span', { class: `tg-count ${cls}`, title: label, attrs: { 'aria-label': `${label}: ${n}` } },
    icon(name, color), h('span', { class: 'num', text: String(n) }));
}

/**
 * The Control Module tray, three wide, rows from the highest module down to 1 like the printed tray. A module on the board
 * leaves an empty pocket; a lit module is a button that chooses it.
 */
export function moduleTray(tray: readonly TrayEntry[], color: SeatColor, choose: (id: string) => void, cls = '', actContext = ''): HTMLElement {
  const by = new Map(tray.map(t => [t.module, t]));
  const cells: HTMLElement[] = [];
  const rows = Math.ceil(CONTROL_MODULE_MAX / 3);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < 3; c++) {
      const n = CONTROL_MODULE_MAX - (3 * r + c);
      if (n < 1) continue;
      const t = by.get(n);
      const state = t?.state ?? 'onBoard';
      const under = n === 6 || n === 9 ? ' u' : '';
      if (state === 'onBoard') {
        cells.push(h('span', { class: 'tg-mod empty', title: `Control Module ${n} is on the board`, attrs: { 'aria-label': `Control Module ${n}: on the board` } }));
      } else if (state === 'lit') {
        const cost = t?.upgradeCost === undefined ? '' : String(t.upgradeCost);
        cells.push(h('button', {
          class: `tg-mod lit${under}`, style: `background:${COLORS[color]}`,
          title: `Control Module ${n}${t?.cost ? ` · ${t.cost}` : ''}`,
          attrs: { 'aria-label': `Use Control Module ${n}${t?.cost ? `, costs ${t.cost}` : ''}`, 'data-module': String(n), 'data-act': `module:${n}:${cost}:${actContext}` },
          onclick: () => choose(`module:${n}`),
        }, h('span', { class: 'n', text: String(n) }), cost ? h('span', { class: 'cost', text: cost }) : null));
      } else if (state === 'skipped') {
        // Below the number of Mines in play: greyed out like a tile turned face down; a tap says why.
        cells.push(h('button', {
          class: `tg-mod skipped${under}`,
          attrs: { 'aria-label': t?.label ?? `Control Module ${n}: skipped`, 'data-module': String(n) },
          onclick: () => choose(`module:${n}`),
        }, h('span', { class: 'n', text: String(n) })));
      } else {
        cells.push(h('span', { class: `tg-mod${under}`, style: `background:${COLORS[color]}`, attrs: { 'aria-label': `Control Module ${n}: in the tray` } },
          h('span', { class: 'n', text: String(n) })));
      }
    }
  }
  const lit = tray.some(t => t.state === 'lit' && t.cost);
  return h('div', { class: `tg-modwrap ${cls}` },
    h('div', { class: `tg-modtray${lit ? ' has-lit' : ''}`, attrs: { role: 'group', 'aria-label': 'Control Module tray' } }, cells),
    lit ? h('div', { class: 'tg-modnote', text: 'Small number = upgrades needed to place it' }) : null);
}

/** A Leverage card face. */
export function cardFace(card: CardType, opts: { count?: number; big?: boolean; off?: boolean } = {}): HTMLElement {
  const foot = PLAY_ON_DRAW_CARDS.has(card) ? 'Played as soon as it is drawn' : `Any step of your turn · up to ${MAX_CARDS_PLAYED_PER_TURN} per turn`;
  return h('div', { class: `tg-card${opts.big ? ' big' : ''}${opts.off ? ' off' : ''}` },
    h('div', { class: 'top', text: 'LEVERAGE' }),
    h('div', { class: 'band' }, h('span', { text: CARD_NAME[card] }), opts.count && opts.count > 1 ? h('span', { class: 'x', text: `×${opts.count}` }) : null),
    h('div', { class: 'txt', text: CARD_TEXT[card] }),
    h('div', { class: 'foot', text: foot }));
}

/**
 * A material well: icon, name, count, and a "full" mark at the cap. With `press` (Plate, Sphere,
 * Tesseract) it is a button that offers to break the material down: lit when the exchange is
 * possible now; otherwise pressing it says why.
 */
export function materialWell(m: Material, n: number, cls = 'tg-mat', press?: { item: Item; choose: (id: string) => void }): HTMLElement {
  const full = n >= INVENTORY_CAP;
  const label = `${MATERIAL_NAME[m]}: ${n}${full ? `, the limit of ${INVENTORY_CAP}` : ''}`;
  const kids = [
    icon(MATERIAL_ICON[m]), h('span', { class: 'nm', text: MATERIAL_NAME[m] }),
    full ? h('span', { class: 'cap', text: `max ${INVENTORY_CAP}` }) : null,
    h('span', { class: 'num', text: String(n) }),
  ];
  const base = `${cls} well${n === 0 ? ' zero' : ''}${full ? ' full' : ''}`;
  if (!press) return h('div', { class: base, attrs: { 'aria-label': label } }, ...kids);
  const it = press.item;
  const say = it.enabled ? it.detail ?? it.label : it.reason ?? it.label;
  return h('button', {
    class: `${base} tg-matbtn${it.enabled ? ' lit' : ''}`,
    title: say,
    attrs: { 'aria-label': `${label}. ${say}`, 'aria-disabled': String(!it.enabled), 'data-item': it.id },
    onclick: () => press.choose(it.id),
  }, ...kids);
}

/** "Total Value: 11": what all of a player's materials are worth together. */
export function totalValue(n: number, cls = 'tg-total'): HTMLElement {
  return h('div', { class: cls, attrs: { 'aria-label': W.totalValue(n) } }, h('span', { class: 'k', text: 'Total Value:' }), h('span', { class: 'num', text: String(n) }));
}

/** Text countdown kept current by the screen's one-second ticker. */
export function countdownText(ctrl: AppController, deadline: number, prefix = '', cls = 'tg-countdown', suffix = ''): HTMLElement {
  // A timer, not announced every second even inside a status region.
  return h('span', { class: cls, attrs: { 'data-deadline': String(deadline), 'data-prefix': prefix, 'data-suffix': suffix, role: 'timer', 'aria-live': 'off' } }, prefix + clock(ctrl.msLeft(deadline)) + suffix);
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
    attrs: { 'data-deadline': String(deadline), 'data-total': String(totalMs), 'data-ring': '1', role: 'timer', 'aria-live': 'off', 'aria-label': `${clock(ms)} left` },
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
