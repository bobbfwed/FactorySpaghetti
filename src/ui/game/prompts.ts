// Operate-or-skip prompts: a card anchored to each activated building of mine (also on other
// players' turns), with what running it costs and makes and a countdown ring while another
// player's turn waits on me. A building with my teleporter on its input shows the supply chooser
// (supply.ts): what it needs, my materials and one button per way to run it. The phone sheet
// lists them too, so they cannot be missed.

import type { Prompt } from '../../play';
import type { Child } from '../dom';
import { h } from '../dom';
import type { Ctx } from './context';
import { activePlayer, seatHex, seatName } from './context';
import { countdownRing } from './pieces';
import { supplyBlock, supplyButtons } from './supply';

function ring(ctx: Ctx): Child {
  const d = ctx.room.opDeadline;
  const a = activePlayer(ctx.game);
  if (d === null || a === ctx.me) return null;
  return countdownRing(ctx.ctrl, d, ctx.room.settings.factoryOpTimeoutMs);
}

/** What happens when the time runs out, shown while the countdown runs. */
function timeoutLine(ctx: Ctx, p: Prompt): Child {
  if (!p.timeout || ctx.room.opDeadline === null || activePlayer(ctx.game) === ctx.me) return null;
  return h('p', { class: 'tg-timeout muted', text: p.timeout });
}

function buttons(ctx: Ctx, p: Prompt): HTMLElement {
  if (p.supply) {
    return h('div', { class: 'tg-supplyrow' }, supplyButtons(p.options, id => ctx.play.choose(id), p.id), ring(ctx));
  }
  return h('div', { class: 'tg-btnrow' },
    p.options.map((o, i) => h('button', {
      class: `btn ${i === 0 ? 'btn-gold' : 'btn-dark'}${o.enabled ? '' : ' is-disabled'}`,
      title: o.enabled ? o.detail ?? o.label : o.reason ?? o.label,
      attrs: { 'aria-disabled': String(!o.enabled), 'data-item': o.id, 'data-act': o.id, 'data-strict': '1' },
      onclick: () => ctx.play.choose(o.id),
    }, o.label)),
    ring(ctx));
}

function others(ctx: Ctx): Child {
  const ids = [...new Set(ctx.game.pendingFactoryOps.map(e => e.ownerId).filter(id => id !== ctx.me))];
  if (ids.length === 0) return null;
  return h('div', { class: 'tg-also' }, 'Also deciding:',
    ids.map(id => h('span', { class: 'tag', style: `--seat:${seatHex(ctx.room, id)}` }, h('span', { class: 'sw' }), seatName(ctx.room, id))));
}

/** Cards anchored to the activated buildings (hidden while the same building's menu is open). */
export function promptCards(ctx: Ctx): HTMLElement[] {
  const menuOn = ctx.view.menu ? JSON.stringify(ctx.view.menu.anchor) : null;
  const shown = ctx.view.prompts.filter(p => JSON.stringify(p.anchor) !== menuOn);
  // Phone: the sheet (or the side panel held sideways) already holds the whole decision with its
  // buttons and timer, so the table only points at the building, with a short tag. Two full
  // copies covered most of a small screen, the top row included.
  if (ctx.phone) {
    return shown.map(p => h('div', {
      class: 'tg-prompt tray compact tg-ptag',
      attrs: { 'data-anchor': JSON.stringify(p.anchor), 'data-place': 'side', role: 'note', 'aria-label': p.title },
    },
    h('span', { class: 'tg-ptr' }),
    h('div', { class: 't', text: 'This building was activated' }),
    h('div', { class: 'where', text: ctx.landscape ? 'Run it or skip it in the panel on the right.' : 'Run it or skip it in the panel below.' })));
  }
  return shown.map(p => h('div', {
    class: `tg-prompt tray${ctx.phone ? ' compact' : ''}${p.supply ? ' has-supply' : ''}`,
    attrs: { 'data-anchor': JSON.stringify(p.anchor), 'data-place': 'side', role: 'alertdialog', 'aria-label': p.title },
  },
  h('span', { class: 'tg-ptr' }),
  h('div', { class: 't', text: p.title }),
  p.supply ? supplyBlock(p.supply, ctx.phone) : ctx.phone ? null : h('div', { class: 'recipe well', text: p.detail }),
  buttons(ctx, p),
  timeoutLine(ctx, p),
  ctx.phone ? null : others(ctx)));
}

/** Phone sheet: the same decisions as a list at the top of the sheet. */
export function promptList(ctx: Ctx): HTMLElement | null {
  if (!ctx.phone || ctx.view.prompts.length === 0) return null;
  return h('div', { class: 'tg-promptlist', attrs: { role: 'group', 'aria-label': 'Decisions' } },
    ctx.view.prompts.map(p => h('div', { class: 'tg-pitem well' },
      h('div', { class: 't', text: p.title }),
      p.supply ? supplyBlock(p.supply, true) : h('div', { class: 'd muted', text: p.detail }),
      buttons(ctx, p),
      timeoutLine(ctx, p))),
    others(ctx));
}
