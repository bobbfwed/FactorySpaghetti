// Mounts the views into the page: picks the view for the controller's screen, redraws on
// change (at most once per frame), keeps countdowns ticking, and shows the notice toast and
// the "copy this by hand" link box.

import type { AppController, LinkBox, Screen } from '../app/controller';
import { h } from './dom';
import { icon } from './icons';
import { gameView } from './gameView';
import { lobbyView } from './lobbyView';
import type { View } from './menuView';
import { menuView } from './menuView';
import { resumeView } from './resumeView';

export function mountApp(root: HTMLElement, ctrl: AppController, version: string): void {
  const screenHost = h('div', { class: 'screen-host' });
  const toast = h('div', { class: 'toast', attrs: { role: 'status', 'aria-live': 'polite' }, hidden: true });
  const overlay = h('div', { class: 'overlay-host' });
  root.replaceChildren(screenHost, toast, overlay);

  let screen: Screen | null = null;
  let view: View | null = null;
  let frame = 0;
  let lastBox: LinkBox | null = null;

  const draw = (): void => {
    frame = 0;
    const next = ctrl.screen;
    if (next !== screen || !view) {
      screen = next;
      view = next === 'menu' ? menuView(ctrl, version)
        : next === 'lobby' ? lobbyView(ctrl)
          : next === 'game' ? gameView(ctrl)
            : resumeView(ctrl);
      view.update();
      screenHost.replaceChildren(view.el);
      document.body.dataset.screen = next;
      window.scrollTo(0, 0);
      view.mounted?.();
    } else {
      view.update();
    }
    const notice = ctrl.state.notice;
    toast.hidden = !notice;
    toast.textContent = notice ?? '';
    if (ctrl.state.linkBox !== lastBox) {
      lastBox = ctrl.state.linkBox;
      overlay.replaceChildren(...(lastBox ? [linkBoxView(ctrl, lastBox)] : []));
    }
  };

  // A redraw between press and release would swallow the click, so wait for the release.
  let pressed = false;
  let deferred = false;
  const schedule = (): void => {
    if (pressed) { deferred = true; return; }
    if (frame) return;
    frame = requestAnimationFrame(draw);
  };
  document.addEventListener('pointerdown', () => { pressed = true; }, true);
  const release = (): void => {
    pressed = false;
    if (deferred) { deferred = false; setTimeout(schedule, 0); }
  };
  document.addEventListener('pointerup', release, true);
  document.addEventListener('pointercancel', release, true);

  ctrl.subscribe(schedule);
  draw();
  // Countdowns (operate prompts, round-end turns, away grace) are drawn from the clock.
  setInterval(() => {
    const room = ctrl.room;
    if (!room || (screen !== 'game' && screen !== 'lobby')) return;
    const ticking = room.opDeadline !== null || room.roundEndDeadline !== null || room.seats.some(s => s.awaySince !== null && !s.connected);
    if (ticking) schedule();
  }, 1000);
}

function linkBoxView(ctrl: AppController, box: LinkBox): HTMLElement {
  const area = h('textarea', { class: 'linkbox-text', value: box.text, attrs: { readonly: '', rows: '5', spellcheck: 'false', 'aria-label': box.title } });
  const panel = h('div', { class: 'linkbox tray', attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-label': box.title } },
    h('div', { class: 'linkbox-head' }, h('b', { text: box.title }),
      h('button', { class: 'x', title: 'Close', attrs: { 'aria-label': 'Close' }, onclick: () => ctrl.dismissLinkBox() }, icon('cross'))),
    h('p', { class: 'muted', text: box.hint }),
    area,
    h('div', { class: 'row end' },
      h('button', { class: 'btn btn-dark', onclick: () => { area.focus(); area.select(); } }, 'Select all'),
      h('button', { class: 'btn btn-gold', onclick: () => ctrl.dismissLinkBox() }, 'Done')));
  const veil = h('div', { class: 'veil', onclick: (e) => { if (e.target === veil) ctrl.dismissLinkBox(); } }, panel);
  queueMicrotask(() => { area.focus(); area.select(); });
  return veil;
}
