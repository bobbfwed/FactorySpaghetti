// Feedback over the table: the "Rolled N" chip with the dice, markers that briefly flash on the
// buildings a roll activated, the error strip for failed menu commands, and the Skip button shown
// while the table is still playing what happened.

import type { ActivationOutcome } from '../../session/room';
import { h } from '../dom';
import { icon } from '../icons';
import type { Ctx } from './context';
import { activePlayer, seatHex, seatName } from './context';
import { die } from './pieces';

export interface Flash { seq: number; items: { pieceId: string; seat: number; outcome: ActivationOutcome }[] }

/**
 * The last roll: its dice and total, and in one line what it produced (which buildings it
 * activated, for whom, and what they did). Stays until the next roll.
 */
export function rollChip(ctx: Ctx): HTMLElement | null {
  const g = ctx.game;
  const o = ctx.ui.rollOutcome;
  if (g.gameOver || ctx.ui.diceRolling) return null;
  if (o) {
    return h('div', { class: 'tg-roll tray has-line', style: `--seat:${seatHex(ctx.room, o.roller)}`, attrs: { role: 'status', 'data-roll-outcome': '1' } },
      h('div', { class: 'top' }, h('span', { class: 'sw' }), o.dice.map(n => die(n)), h('span', { text: 'Rolled' }), h('b', { class: 'big num', text: String(o.total) })),
      h('div', { class: 'line', text: o.text }));
  }
  const roll = g.lastRoll;
  if (!roll || roll.length === 0) return null;
  if (g.phase !== 'actions' && g.phase !== 'placeMeeple' && g.pendingFactoryOps.length === 0) return null;
  const total = roll.reduce((a, b) => a + b, 0);
  const a = activePlayer(g);
  return h('div', { class: 'tg-roll tray', style: `--seat:${seatHex(ctx.room, a)}`, attrs: { role: 'status', 'aria-label': `${seatName(ctx.room, a)} rolled ${total}` } },
    h('span', { class: 'sw' }),
    roll.map(n => die(n)),
    h('span', { text: 'Rolled' }), h('b', { class: 'big num', text: String(total) }));
}

const OUTCOME_WORD: Record<ActivationOutcome, string> = {
  'awaiting-choice': 'deciding', power: 'power', 'power-capped': 'power full', 'output-full': 'output full',
  'input-missing': 'no input', 'no-power': 'no power',
};

/** Rings on the buildings the last roll activated (anchored; placed with the other anchors). */
export function flashMarkers(ctx: Ctx, flash: Flash | null): HTMLElement[] {
  if (!flash) return [];
  return flash.items.map(it => h('div', {
    class: `tg-flash ${it.outcome}`, style: `--seat:${seatHex(ctx.room, it.seat)}`,
    attrs: { 'data-anchor': JSON.stringify({ kind: 'piece', pieceId: it.pieceId }), 'data-place': 'center', 'aria-hidden': 'true' },
  }, h('span', { class: 'ring' }), h('span', { class: 'lbl', text: OUTCOME_WORD[it.outcome] })));
}

export function errorStrip(ctx: Ctx): HTMLElement | null {
  const err = ctx.ctrl.state.error;
  if (!err) return null;
  return h('div', { class: 'tg-error error', attrs: { role: 'alert' } },
    h('span', { text: err }),
    h('button', { class: 'x round small', title: 'Dismiss', attrs: { 'aria-label': 'Dismiss' }, onclick: () => ctx.ctrl.dismissError() }, icon('cross')));
}

/** "Skip" while the table is still playing earlier moves: jumps to the newest state. */
export function skipButton(ctx: Ctx): HTMLElement | null {
  if (!ctx.busy) return null;
  return h('button', {
    class: 'btn btn-dark tg-skip', title: 'Show the newest state now',
    attrs: { 'aria-label': 'Skip the animation and show the newest state', 'data-skip': '1' },
    onclick: () => ctx.skip(),
  }, 'Skip', h('span', { class: 'chev', text: '»' }));
}

/** The wording matches the game menu's save entries (gameMenu.ts) and the text view. */
export const CANNOT_STORE_TEXT = 'This device cannot store the game; use Copy save link or Download save file in the game menu.';

/**
 * A lasting strip (not a toast) while the automatic save cannot be written to this device, with a
 * button that opens the game menu where the save entries are. The player can put it away.
 */
export function storageStrip(ctx: Ctx): HTMLElement | null {
  if (!ctx.ctrl.state.cannotStore || ctx.ui.storeDismissed || ctx.ui.menuOpen) return null;
  return h('div', { class: 'tg-store', attrs: { role: 'alert', 'data-store': '1' } },
    h('span', { class: 'tx', text: CANNOT_STORE_TEXT }),
    h('button', {
      class: 'btn btn-dark tg-storebtn', attrs: { 'data-store-menu': '1' },
      onclick: () => { ctx.ui.menuOpen = true; ctx.ui.seat = null; ctx.redraw(); },
    }, icon('menu'), 'Game menu'),
    h('button', {
      class: 'x round small', title: 'Dismiss', attrs: { 'aria-label': 'Dismiss', 'data-store-dismiss': '1' },
      onclick: () => { ctx.ui.storeDismissed = true; ctx.redraw(); },
    }, icon('cross')));
}
