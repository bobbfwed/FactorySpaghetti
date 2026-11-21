// Resume setup: the summary of a save, a rules warning when needed, "Which player are you?",
// and Host this game.

import type { AppController } from '../app/controller';
import { savedWhen } from '../app/controller';
import { actionButton, h, morph } from './dom';
import { COLORS, COLOR_NAME, icon, mark } from './icons';
import { messageStrip } from './common';
import type { View } from './menuView';

export function resumeView(ctrl: AppController): View {
  const el = h('main', { class: 'screen resume' });
  const update = (): void => {
    const r = ctrl.state.resume;
    if (!r) { el.replaceChildren(); return; }
    const sum = r.summary;
    const room = r.save.room;
    const from = r.source === 'device' ? 'Saved on this device' : r.source === 'link' ? 'From a save link' : 'From a save file';
    const players = room.seats.map(s => `${s.name}${s.kind === 'bot' ? ' (bot)' : ''}`).join(', ');
    morph(el, h('main', { class: 'screen resume' },
      h('header', { class: 'resume-head' }, mark('mark'), h('div', null, h('div', { class: 'label', text: from }), h('h1', { text: 'Resume a game' }))),
      h('section', { class: 'tray panel' },
        h('div', { class: 'summary' },
          h('div', { class: 'big' }, `Room ${sum.code} · `, sum.phase === 'finished' ? 'finished' : `round ${sum.round}`),
          h('div', { class: 'muted', text: `${players} · ${savedWhen(sum.savedAt, Date.now())}` })),
        r.sameRules ? null : h('div', { class: 'warn', attrs: { role: 'note' } },
          h('b', { text: 'Saved with different rule settings. ' }),
          'This game was played with rules that differ from this version of the app. It can still be resumed, but the rest of the game uses the current rules.'),
        sum.phase === 'finished' ? h('div', { class: 'warn', text: 'This game has already ended. You can open it to look at the final position.' }) : null,
        messageStrip(ctrl),
        h('h2', { text: 'Which player are you?' }),
        h('div', { class: 'who-list', attrs: { role: 'radiogroup', 'aria-label': 'Which player are you?' } },
          r.seats.map(s => h('button', {
            class: `who-btn well${r.chosen === s.index ? ' on' : ''}`, style: `--seat:${COLORS[s.color]}`,
            attrs: { role: 'radio', 'aria-checked': String(r.chosen === s.index) },
            onclick: () => ctrl.chooseResumeSeat(s.index),
          }, h('span', { class: 'bar' }), icon('meeple', s.color), h('span', { class: 'nm', text: s.name }),
          h('span', { class: 'muted', text: COLOR_NAME[s.color] }), r.chosen === s.index ? icon('check', undefined, 'ic tick') : null))),
        h('p', { class: 'hint', text: 'You host the game under a new room code. The others join with that code and the same names as before, and the game waits until you continue it.' }),
        h('div', { class: 'row end' },
          h('button', { class: 'btn btn-quiet btn-lg', onclick: () => ctrl.cancelResume() }, 'Back'),
          actionButton([icon('crown'), 'Host this game'], 'btn btn-gold btn-lg', () => ctrl.hostResume(), { disabled: r.chosen === null || ctrl.state.busy !== null })))));
  };
  return { el, update };
}
