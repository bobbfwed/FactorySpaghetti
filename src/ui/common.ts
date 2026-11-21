// Pieces shared by the lobby and game screens: the top bar, the connection banner, and
// small message strips.

import type { AppController } from '../app/controller';
import type { Child } from './dom';
import { h } from './dom';
import { icon, mark } from './icons';

export function connectionWords(ctrl: AppController): string {
  const online = ctrl.state.online;
  const room = ctrl.room;
  if (!online || !room) return '';
  if (ctrl.state.solo) return 'Solo game on this device';
  if (online.status !== 'online') return 'Connection trouble';
  if (online.role === 'host') return 'Connected · you are the host';
  const host = room.seats[room.hostSeat]?.name;
  return host ? `Connected · ${host} is the host` : 'Connected';
}

export function topBar(ctrl: AppController, subtitle: string, extra: Child = null): HTMLElement {
  const ok = ctrl.state.online?.status === 'online';
  return h('header', { class: 'topbar' },
    h('div', { class: 'brand' }, mark('mark'), h('div', { class: 'wm' }, 'Factory Spaghetti', h('small', { text: subtitle }))),
    h('div', { class: 'right' },
      h('span', { class: `conn ${ok ? 'ok' : 'warn'}` }, icon('wifi'), h('span', { class: 'conn-text', text: connectionWords(ctrl) })),
      extra,
      h('button', {
        class: 'btn btn-quiet', title: 'Leave this room',
        onclick: () => {
          const r = ctrl.room;
          const playing = r && r.phase === 'playing' && !ctrl.state.solo && ctrl.state.online?.status === 'online';
          if (playing && !window.confirm('Leave the game? The others continue, and you can come back with the same room code.')) return;
          ctrl.leave();
        },
      }, icon('leave'), h('span', { class: 'hide-narrow', text: 'Leave' }))));
}

/** The connection banner (reconnecting, taking over, lost, closed), or null. */
export function connectionBanner(ctrl: AppController): HTMLElement | null {
  const b = ctrl.banner;
  if (!b) return null;
  const buttons: Child[] = b.actions.map(a => {
    switch (a) {
      case 'host-copy': return h('button', { class: 'btn btn-gold', onclick: () => { void ctrl.hostFromMyCopy(); } }, 'Host it from my copy');
      case 'reload': return h('button', { class: 'btn btn-gold', onclick: () => window.location.reload() }, 'Reload to update');
      case 'menu': return h('button', { class: 'btn btn-dark', onclick: () => ctrl.backToMenu() }, 'Back to menu');
    }
  });
  const spinning = b.kind === 'reconnecting' || b.kind === 'taking-over';
  return h('div', { class: `banner banner-${b.kind}`, attrs: { role: 'status' } },
    h('div', { class: 'banner-text' }, spinning ? h('span', { class: 'spinner' }) : null, h('span', { text: b.text })),
    buttons.length ? h('div', { class: 'banner-actions' }, buttons) : null);
}

/** The error strip with a dismiss button, or the busy line. */
export function messageStrip(ctrl: AppController): HTMLElement | null {
  const s = ctrl.state;
  if (s.busy) return h('div', { class: 'busy', attrs: { role: 'status' } }, h('span', { class: 'spinner' }), s.busy);
  if (!s.error) return null;
  return h('div', { class: 'error', attrs: { role: 'alert' } },
    h('span', { text: s.error }),
    h('button', { class: 'x', title: 'Dismiss', attrs: { 'aria-label': 'Dismiss' }, onclick: () => ctrl.dismissError() }, icon('cross')));
}
