// The turn queue on screen: this round's players in order (done, playing now with the step, next),
// the end of the round and who starts the next one. Desktop: a column at the top left, always
// visible. Phone: a row of coloured initials under the top row; a tap opens the full list. It
// follows the displayed state, so it moves in step with the table's animations.

import type { PlayerId } from '../../engine/state';
import { turnQueue, type QueueItem } from '../../play';
import { h } from '../dom';
import { icon } from '../icons';
import type { Ctx } from './context';
import { seatHex, seatName } from './context';

/** Who plays after the current player, for "next" tags on the seat plates (null: the end of the round). */
export function nextSeat(ctx: Ctx): number | null {
  return turnQueue(ctx.game, (p: PlayerId) => seatName(ctx.room, p), ctx.upcomingOrder ?? null).next;
}

function chip(ctx: Ctx, it: Extract<QueueItem, { kind: 'turn' }>, compact: boolean): HTMLElement {
  const name = seatName(ctx.room, it.seat);
  const you = it.seat === ctx.me;
  const label = compact ? name.trim().charAt(0).toUpperCase() || '?' : `${name}${you ? ' (you)' : ''}`;
  const words = [`${name}${you ? ', you' : ''}`, it.status === 'done' ? 'done' : it.status === 'active' ? `now: ${it.step ?? ''}` : it.status === 'next' ? 'next' : '', it.first ? 'first this round' : '']
    .filter(Boolean).join(', ');
  return h('li', {
    class: `tg-q ${it.status}${you ? ' you' : ''}`, style: `--seat:${seatHex(ctx.room, it.seat)}`,
    attrs: { 'aria-label': words, 'data-q-seat': String(it.seat), ...(it.status === 'active' ? { 'aria-current': 'step' } : {}) },
  },
  h('span', { class: 'dot' }, it.status === 'done' ? icon('check') : compact ? label : null),
  h('span', { class: 'nm', text: label }),
  !compact && it.status === 'active' && it.step ? h('span', { class: 'st', text: it.step }) : null,
  !compact && it.status === 'next' ? h('span', { class: 'tag', text: 'next' }) : null,
  it.first ? h('span', { class: 'first', text: '1st' }) : null);
}

function mark(it: Extract<QueueItem, { kind: 'mark' }>, compact: boolean): HTMLElement | null {
  if (compact && it.role === 'next') return null;
  const text = compact ? (it.role === 'roundEnd' ? 'End' : it.role === 'round' ? it.text.replace('Round ', 'R') : it.role === 'setup' ? (it.text.startsWith('Set') ? 'PF' : 'PP') : it.text) : it.text;
  return h('li', { class: `tg-qm ${it.status} q-${it.role}`, attrs: { 'aria-label': it.text } }, text);
}

/** Desktop: the full queue as a column; phone: initials, a tap opens the full list. */
export function queueView(ctx: Ctx): HTMLElement {
  const q = turnQueue(ctx.game, (p: PlayerId) => seatName(ctx.room, p), ctx.upcomingOrder ?? null);
  const list = (compact: boolean): HTMLElement => h('ol', { class: `tg-qlist${compact ? ' compact' : ''}` },
    q.items.map(it => (it.kind === 'turn' ? chip(ctx, it, compact) : mark(it, compact))));
  if (!ctx.phone) {
    return h('nav', { class: 'tg-queue desk', attrs: { 'aria-label': 'Turn order' } }, list(false));
  }
  const open = ctx.ui.queueOpen;
  return h('nav', { class: `tg-queue phone${open ? ' open' : ''}`, attrs: { 'aria-label': 'Turn order' } },
    h('button', {
      class: 'tg-qbtn', attrs: { 'aria-expanded': String(open), 'aria-label': open ? 'Close the turn order' : 'Show the turn order', 'data-queue': '1' },
      onclick: () => { ctx.ui.queueOpen = !ctx.ui.queueOpen; ctx.redraw(); },
    }, list(true)),
    open ? h('div', { class: 'tg-qpop tray' }, list(false)) : null);
}
