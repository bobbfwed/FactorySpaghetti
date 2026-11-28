// The animation, sound and vibration settings in the game menu, and the room's bot speed
// (the host chooses it; everyone else sees it).

import type { BotSpeed } from '../../session/pacing';
import type { AnimSpeed } from '../../table/playback';
import { h } from '../dom';
import type { Ctx } from './context';
import { movingPortals, setMovingPortals } from '../portalPref';

const SPEEDS: readonly [AnimSpeed, string][] = [['off', 'Off'], ['fast', 'Fast'], ['normal', 'Normal']];
const BOT_SPEEDS: readonly [BotSpeed, string][] = [['instant', 'Instant'], ['fast', 'Fast'], ['normal', 'Normal']];

function toggle(label: string, on: boolean, attr: string, flip: () => void): HTMLElement {
  return h('button', {
    class: `item switch-item${on ? ' on' : ''}`, attrs: { role: 'switch', 'aria-checked': String(on), [attr]: '1' },
    onclick: flip,
  }, label, h('span', { class: 'knob' }));
}

/** A switch with a short note under its label (what turning it on costs). */
function noted(label: string, note: string, on: boolean, attr: string, flip: () => void): HTMLElement {
  return h('button', {
    class: `item switch-item noted${on ? ' on' : ''}`, attrs: { role: 'switch', 'aria-checked': String(on), [attr]: '1' },
    onclick: flip,
  }, h('span', { class: 'lb2' }, label, h('small', { text: note })), h('span', { class: 'knob' }));
}

function segmented<T extends string>(label: string, options: readonly [T, string][], value: T, attr: string, pick: (v: T) => void): HTMLElement {
  return h('div', { class: 'tg-feel', attrs: { role: 'group', 'aria-label': label } },
    h('span', { class: 'lbl', text: label }),
    h('div', { class: 'tg-seg', attrs: { role: 'radiogroup', 'aria-label': label } },
      options.map(([v, text]) => h('button', {
        class: `seg${value === v ? ' on' : ''}`, attrs: { role: 'radio', 'aria-checked': String(value === v), [attr]: v },
        onclick: () => pick(v),
      }, text))));
}

/** Menu entries: animation speed, sound, vibration (where the device can), moving portals, bot speed. */
export function feelItems(ctx: Ctx): HTMLElement[] {
  const f = ctx.feel.settings;
  const set = (patch: Parameters<Ctx['feel']['set']>[0]): void => { ctx.feel.set(patch); ctx.redraw(); };
  const items: HTMLElement[] = [
    segmented('Animation', SPEEDS, f.speed, 'data-speed', v => set({ speed: v })),
    toggle('Sound', f.sound, 'data-sound', () => set({ sound: !f.sound })),
  ];
  if (ctx.feel.canVibrate) items.push(toggle('Vibration', f.vibrate, 'data-vibrate', () => set({ vibrate: !f.vibrate })));
  // Remembered on this device (portalPref.ts); takes effect on the table at once.
  const portals = movingPortals();
  items.push(noted('Moving Teleporter portals', 'Uses more battery', portals, 'data-portals', () => { setMovingPortals(!portals); ctx.redraw(); }));
  const bots = ctx.room.seats.some(s => s.kind === 'bot' || s.autopilot);
  const botSpeed = ctx.room.settings.botSpeed;
  if (bots && ctx.ctrl.state.online?.role === 'host') {
    items.push(segmented('Bot speed', BOT_SPEEDS, botSpeed, 'data-botspeed', v => { void ctx.ctrl.setBotSpeed(v).then(() => ctx.redraw()); }));
  } else if (bots) {
    const word = BOT_SPEEDS.find(([v]) => v === botSpeed)?.[1] ?? botSpeed;
    items.push(h('div', { class: 'tg-feel ro' }, h('span', { class: 'lbl', text: 'Bot speed' }), h('span', { class: 'v', text: `${word} · set by the host` })));
  }
  return items;
}
