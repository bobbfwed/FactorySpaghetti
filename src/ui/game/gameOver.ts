// Game over: the winner and why, the final standings and the way back to the menu. The table stays
// visible behind it, and the card can be put away to look at the final board.

import { finalStandings, gameOverWords } from '../../app/gameText';
import { h } from '../dom';
import { icon } from '../icons';
import type { Ctx } from './context';
import { seatHex, seatName } from './context';

export function gameOverCard(ctx: Ctx): HTMLElement | null {
  if (!ctx.game.gameOver) return null;
  if (ctx.ui.overHidden) {
    return h('button', { class: 'btn btn-gold tg-overpill', onclick: () => { ctx.ui.overHidden = false; ctx.redraw(); } }, icon('crown'), 'Show the results');
  }
  const rows = finalStandings(ctx.room);
  return h('div', { class: 'tg-over tray', attrs: { role: 'dialog', 'aria-label': 'Game over' } },
    h('div', { class: 'label gold', text: 'Game over' }),
    h('h2', { class: 'words', text: gameOverWords(ctx.room) }),
    h('ol', { class: 'tg-standings' }, rows.map((r, i) => h('li', { class: r.won ? 'won' : '', style: `--seat:${seatHex(ctx.room, r.seat)}` },
      h('span', { class: 'pos', text: String(i + 1) }),
      h('span', { class: 'sw' }),
      h('b', { class: 'nm', text: seatName(ctx.room, r.seat) + (r.seat === ctx.me ? ' (you)' : '') }),
      r.won ? icon('crown', undefined, 'ic small gold') : null,
      h('span', { class: 'muted', text: `${r.tesseracts} Tesseract${r.tesseracts === 1 ? '' : 's'} · ${r.points} points` })))),
    h('div', { class: 'tg-btnrow' },
      h('button', { class: 'btn btn-dark btn-lg', onclick: () => { ctx.ui.overHidden = true; ctx.redraw(); } }, 'Look at the table'),
      h('button', { class: 'btn btn-gold btn-lg', attrs: { 'data-back': '1' }, onclick: () => ctx.ctrl.backToMenu() }, 'Back to menu')),
    h('div', { class: 'tg-btnrow', style: 'margin-top:8px' },
      h('button', { class: 'btn btn-dark btn-lg', attrs: { 'data-watch-again': '1' }, onclick: () => { void ctx.ctrl.watchThisGame(); } }, icon('replay'), 'Watch this game again'),
      h('button', { class: 'btn btn-quiet btn-lg', attrs: { 'data-save-replay': '1' }, onclick: () => ctx.ctrl.downloadReplay() }, icon('download'), 'Save replay')));
}
