// "Report a rules problem": a short note, then one downloadable file with the whole game. The
// dialog says plainly what the file contains and that nothing is sent anywhere.

import type { AppController, ReportDialog } from '../app/controller';
import { describeAction } from '../session/describe';
import { actorOf } from '../session/replay';
import { NOTE_MAX } from '../session/report';
import type { Child } from './dom';
import { h } from './dom';
import { icon } from './icons';

export function reportDialogView(ctrl: AppController, dialog: ReportDialog): HTMLElement {
  const close = (): void => ctrl.closeReport();
  const head = h('div', { class: 'linkbox-head' },
    h('b', null, icon('flag', undefined, 'ic gold'), ' Report a rules problem'),
    h('button', { class: 'x', title: 'Close', attrs: { 'aria-label': 'Close' }, onclick: close }, icon('cross')));

  let body: Child[];
  if (dialog.saved) {
    body = [
      h('p', { class: 'rp-done' }, h('b', { text: `Saved ${dialog.saved}.` })),
      h('p', { class: 'muted', text: 'Send this file to the designer yourself, by email or in a message. They can open it with “Watch a replay” on the start menu to see the game move by move.' }),
      h('div', { class: 'row end' }, h('button', { class: 'btn btn-gold btn-lg', attrs: { 'data-report-done': '1' }, onclick: close }, 'Done')),
    ];
  } else {
    const note = h('textarea', {
      class: 'paste rp-note', placeholder: 'What did you expect to happen, and what happened instead?',
      attrs: { rows: '5', maxlength: String(NOTE_MAX), 'aria-label': 'What you expected, and what happened', spellcheck: 'true' },
    });
    const refused = ctrl.lastRefused;
    let refusedText: string | null = null;
    const room = ctrl.room;
    if (refused) {
      refusedText = `Your last refused move is included: “${refused.error.message}”`;
      // The move in words, when the position it was refused in is still the current one.
      if (room?.game && room.seq === refused.seq) {
        try {
          const name = room.seats[actorOf(room.game, refused.action)]?.name ?? 'You';
          refusedText = `Your last refused move is included: “${describeAction(room.game, refused.action, name)}” — ${refused.error.message}`;
        } catch { /* keep the short form */ }
      }
    }
    body = [
      h('p', { class: 'muted', text: 'Write what you expected and what happened. The game makes one file for the designer from it.' }),
      note,
      h('div', { class: 'warn rp-privacy' },
        h('b', { text: 'The file holds the whole game: ' }),
        'every player’s hand and cards, the board, all the moves so far, the version of the app, and the moves the rules allow you now. ',
        h('b', { text: 'Nothing is sent anywhere. ' }),
        'Send the file to the designer yourself.'),
      refusedText ? h('p', { class: 'muted rp-refused', text: refusedText }) : null,
      h('div', { class: 'row end' },
        h('button', { class: 'btn btn-quiet btn-lg', onclick: close }, 'Cancel'),
        h('button', { class: 'btn btn-gold btn-lg', attrs: { 'data-report-save': '1' }, onclick: () => ctrl.saveReport(note.value) }, icon('download'), 'Save the report file')),
    ];
    queueMicrotask(() => note.focus());
  }
  const panel = h('div', { class: 'linkbox report-dialog tray', attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Report a rules problem' } }, head, ...body);
  const veil = h('div', { class: 'veil', onclick: (e) => { if (e.target === veil && !dialog.saved) return; if (e.target === veil) close(); } }, panel);
  return veil;
}
