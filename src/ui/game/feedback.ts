// Feedback over the table: the "Rolled N" chip with the dice, markers that briefly flash on the
// buildings a roll activated, and the error strip for failed menu commands.

import type { ActivationOutcome } from '../../session/room';
import { h } from '../dom';
import { icon } from '../icons';
import type { Ctx } from './context';
import { activePlayer, seatHex, seatName } from './context';
import { die } from './pieces';

export interface Flash { seq: number; items: { pieceId: string; seat: number; outcome: ActivationOutcome }[] }

/** "Rolled 7" with the dice, while the roll still matters (the rest of that turn). */
export function rollChip(ctx: Ctx): HTMLElement | null {
  const g = ctx.game;
  const roll = g.lastRoll;
  if (!roll || roll.length === 0 || g.gameOver) return null;
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
