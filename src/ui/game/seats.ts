// Opponents: seat plates along the top (desktop) or chips (phone) with colour, name, connection
// state, Tesseract pips and counts; tapping one opens that player's full details.

import type { PlayerId } from '../../engine/state';
import { TESSERACTS_TO_WIN } from '../../engine/config';
import { tesseractCount } from '../../engine/rules/scoring';
import { BONUS_NAME } from './rules';
import { BUILDING_NAME, MATERIAL_NAME } from '../../session/describe';
import type { Seat } from '../../session/room';
import type { Child } from '../dom';
import { h } from '../dom';
import { icon } from '../icons';
import type { Ctx } from './context';
import { activePlayer, seatHex } from './context';
import { MATERIAL_LIST, MATERIAL_ICON, count, countdownText, pips } from './pieces';
import { nextSeat } from './queueView';

/** The seats shown as opponents: everyone but me. */
export function opponents(ctx: Ctx): Seat[] {
  return ctx.room.seats.filter(s => s.index !== ctx.me);
}

function status(ctx: Ctx, s: Seat): { text: Child[]; warn: boolean; online: boolean | null } {
  const room = ctx.room;
  const g = ctx.game;
  const out: Child[] = [];
  let warn = false;
  let online: boolean | null = null;
  if (s.kind === 'bot') out.push('bot');
  else if (s.autopilot) { out.push('bot is playing'); warn = true; online = s.connected; }
  else if (!s.connected) {
    warn = true; online = false;
    if (room.settings.awayPolicy === 'bot' && s.awaySince !== null && !room.hold) {
      out.push(countdownText(ctx.ctrl, s.awaySince + room.settings.awayGraceMs, 'away · bot in ', 'tg-cd-inline'));
    } else out.push('away');
  } else online = true;
  if (!g.gameOver) {
    const a = activePlayer(g);
    const owes = g.pendingFactoryOps.some(e => e.ownerId === s.index);
    if (owes) {
      out.push(out.length ? ' · deciding' : 'deciding');
      if (s.index !== a && room.opDeadline !== null) out.push(' ', countdownText(ctx.ctrl, room.opDeadline, '', 'tg-cd-inline'));
    } else if (s.index === a) out.push(out.length ? ' · their turn' : 'their turn');
    else if (s.index === nextSeat(ctx)) out.push(out.length ? ' · ' : '', h('span', { class: 'tg-nexttag', text: 'next' }));
  }
  return { text: out, warn, online };
}

function counts(ctx: Ctx, s: Seat): HTMLElement {
  const p = ctx.game.players[s.index]!;
  return h('div', { class: 'tg-counts' },
    MATERIAL_LIST.filter(m => m !== 'tesseract').map(m => count(MATERIAL_ICON[m], p.inventory[m], MATERIAL_NAME[m])),
    count('power', p.powerTokens, 'Power Tokens'),
    count('card', p.hand.length, 'Leverage cards in hand'),
    count('belt', p.beltsRemaining, 'Belts left', s.color));
}

/** Desktop seat plates. */
export function seatPlates(ctx: Ctx): HTMLElement {
  const a = activePlayer(ctx.game);
  return h('div', { class: 'tg-seats', attrs: { role: 'list', 'aria-label': 'Other players' } }, opponents(ctx).map(s => {
    const st = status(ctx, s);
    const t = tesseractCount(ctx.game, s.index as PlayerId);
    return h('div', { class: 'tg-li', attrs: { role: 'listitem' } }, h('button', {
      class: `tg-plate tray${s.index === a && !ctx.game.gameOver ? ' turn' : ''}${ctx.ui.seat === s.index ? ' open' : ''}`,
      style: `--seat:${seatHex(ctx.room, s.index)}`,
      attrs: { 'aria-expanded': String(ctx.ui.seat === s.index), 'data-seat': String(s.index) },
      onclick: () => { ctx.ui.seat = ctx.ui.seat === s.index ? null : s.index; ctx.redraw(); },
    },
    h('span', { class: 'stripe' }),
    h('span', { class: 'body' },
      h('span', { class: 'row' },
        h('span', { class: 'name', text: s.name || `Player ${s.index + 1}` }),
        st.online === null ? null : h('span', { class: `dot ${st.online ? 'on' : 'off'}` }),
        h('span', { class: `status${st.warn ? ' is-warn' : ''}` }, st.text),
        h('span', { class: 'grow' }),
        pips(t)),
      counts(ctx, s))));
  }));
}

/** Phone chips. */
export function seatChips(ctx: Ctx): HTMLElement {
  const a = activePlayer(ctx.game);
  return h('div', { class: 'tg-chips', attrs: { role: 'list', 'aria-label': 'Other players' } }, opponents(ctx).map(s => {
    const st = status(ctx, s);
    const t = tesseractCount(ctx.game, s.index as PlayerId);
    return h('div', { class: 'tg-li', attrs: { role: 'listitem' } }, h('button', {
      class: `tg-chip tray${s.index === a && !ctx.game.gameOver ? ' turn' : ''}`,
      style: `--seat:${seatHex(ctx.room, s.index)}`,
      attrs: { 'aria-expanded': String(ctx.ui.seat === s.index), 'data-seat': String(s.index) },
      onclick: () => { ctx.ui.seat = ctx.ui.seat === s.index ? null : s.index; ctx.redraw(); },
    },
    h('span', { class: 'stripe' }),
    h('span', { class: 'col' },
      h('span', { class: 'nm', text: s.name || `Player ${s.index + 1}` }),
      h('span', { class: `st${st.warn ? ' is-warn' : ''}` }, st.text.length ? st.text : `${t} of ${TESSERACTS_TO_WIN}`)),
    pips(t)));
  }));
}

/** Everything about one player: the full tray as a list. */
export function seatDetails(ctx: Ctx): HTMLElement | null {
  const i = ctx.ui.seat;
  if (i === null) return null;
  const s = ctx.room.seats[i];
  const p = ctx.game.players[i];
  if (!s || !p) return null;
  const g = ctx.game;
  const onBoard = g.board.filter(b => b.claims.some(c => c.ownerId === i)).map(b => {
    const mods = b.claims.filter(c => c.ownerId === i).map(c => c.controlModule).join(', ');
    return `${BUILDING_NAME[b.type]} ${mods}`;
  });
  const meeple = p.meepleOnPieceId === null ? 'in their supply'
    : ((): string => {
      const piece = g.board.find(b => b.id === p.meepleOnPieceId);
      if (!piece) return 'on the board';
      if (piece.type === 'mine') return p.meepleSlotIndex === 1 ? 'on a Mine upgrade point' : 'on a Mine resource point';
      return `on the ${BUILDING_NAME[piece.type]}`;
    })();
  const bonuses = (Object.keys(p.bonusTesseracts) as (keyof typeof p.bonusTesseracts)[]).filter(k => p.bonusTesseracts[k]);
  const close = (): void => { ctx.ui.seat = null; ctx.redraw(); };
  return h('div', { class: 'tg-seatpop tray', style: `--seat:${seatHex(ctx.room, i)}`, attrs: { role: 'dialog', 'aria-label': `${s.name} details` } },
    h('div', { class: 'hd' }, h('span', { class: 'sw' }), h('b', { text: s.name || `Player ${i + 1}` }),
      h('span', { class: 'grow' }), pips(tesseractCount(g, i as PlayerId)),
      h('button', { class: 'x round small', title: 'Close', attrs: { 'aria-label': 'Close' }, onclick: close }, icon('cross'))),
    h('div', { class: 'tg-kvs' },
      kv('Materials', h('span', { class: 'tg-counts' }, MATERIAL_LIST.map(m => count(MATERIAL_ICON[m], p.inventory[m], MATERIAL_NAME[m])))),
      kv('Power Tokens', String(p.powerTokens)),
      kv('Leverage cards in hand', String(p.hand.length)),
      kv('Belts left', String(p.beltsRemaining)),
      kv('Teleporters left', String(p.teleportersRemaining)),
      kv('Meeple', meeple),
      kv('Control Modules in the tray', p.controlModules.length ? [...p.controlModules].sort((a, b) => a - b).join(', ') : 'none'),
      kv('Control Modules on the board', onBoard.length ? onBoard.join(' · ') : 'none'),
      kv('Bonus cards', bonuses.length ? bonuses.map(b => BONUS_NAME[b]).join(', ') : 'none')));
}

function kv(k: string, v: Child): HTMLElement {
  return h('div', { class: 'tg-kv' }, h('span', { class: 'k', text: k }), h('span', { class: 'v' }, v));
}
