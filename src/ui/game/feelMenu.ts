// The animation, sound and vibration settings in the game menu.

import type { AnimSpeed } from '../../table/playback';
import { h } from '../dom';
import type { Ctx } from './context';

const SPEEDS: readonly [AnimSpeed, string][] = [['off', 'Off'], ['fast', 'Fast'], ['normal', 'Normal']];

function toggle(label: string, on: boolean, attr: string, flip: () => void): HTMLElement {
  return h('button', {
    class: `item switch-item${on ? ' on' : ''}`, attrs: { role: 'switch', 'aria-checked': String(on), [attr]: '1' },
    onclick: flip,
  }, label, h('span', { class: 'knob' }));
}

/** Menu entries: animation speed (Off / Fast / Normal), sound, vibration (where the device can). */
export function feelItems(ctx: Ctx): HTMLElement[] {
  const f = ctx.feel.settings;
  const set = (patch: Parameters<Ctx['feel']['set']>[0]): void => { ctx.feel.set(patch); ctx.redraw(); };
  const items: HTMLElement[] = [
    h('div', { class: 'tg-feel', attrs: { role: 'group', 'aria-label': 'Animation' } },
      h('span', { class: 'lbl', text: 'Animation' }),
      h('div', { class: 'tg-seg', attrs: { role: 'radiogroup', 'aria-label': 'Animation speed' } },
        SPEEDS.map(([v, label]) => h('button', {
          class: `seg${f.speed === v ? ' on' : ''}`, attrs: { role: 'radio', 'aria-checked': String(f.speed === v), 'data-speed': v },
          onclick: () => set({ speed: v }),
        }, label)))),
    toggle('Sound', f.sound, 'data-sound', () => set({ sound: !f.sound })),
  ];
  if (ctx.feel.canVibrate) items.push(toggle('Vibration', f.vibrate, 'data-vibrate', () => set({ vibrate: !f.vibrate })));
  return items;
}
