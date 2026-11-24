// The game menu (save link, save file, share, autoplay, text view, leave) and the camera buttons.

import type { Child } from '../dom';
import { actionButton, h } from '../dom';
import { icon } from '../icons';
import { setPreferredView } from '../viewPref';
import type { Ctx } from './context';
import { feelItems } from './feelMenu';
import { playtestItems } from '../playtestMenu';
import { askLeave } from '../common';
import { versionTag } from '../version';
import { guideRoundButton, openGuide } from '../guide/open';

export function menuButton(ctx: Ctx): HTMLElement {
  return h('button', {
    class: `round tg-menubtn${ctx.ui.menuOpen ? ' open' : ''}`, title: 'Game menu',
    attrs: { 'aria-label': 'Game menu', 'aria-expanded': String(ctx.ui.menuOpen), 'data-menu': '1' },
    // Opening the menu puts the phone sheet away (one large panel at a time).
    onclick: () => { ctx.ui.menuOpen = !ctx.ui.menuOpen; ctx.ui.seat = null; if (ctx.ui.menuOpen) ctx.ui.sheetOpen = false; ctx.redraw(); },
  }, icon('menu'));
}

export function gameMenu(ctx: Ctx): HTMLElement | null {
  if (!ctx.ui.menuOpen) return null;
  const c = ctx.ctrl;
  const close = (): void => { ctx.ui.menuOpen = false; ctx.redraw(); };
  const seat = ctx.me === null ? undefined : ctx.room.seats[ctx.me];
  const items: Child[] = [
    actionButton([icon('link'), 'Copy save link'], 'item', async () => { await c.copySaveLink(); close(); }),
    h('button', { class: 'item', onclick: () => { c.downloadSave(); close(); } }, icon('download'), 'Download save file'),
    c.canShare ? actionButton([icon('share'), 'Share save…'], 'item', async () => { await c.shareSave(); close(); }) : null,
    h('hr'),
    ...playtestItems(c, close),
    h('hr'),
    ctx.me !== null && !ctx.game.gameOver
      ? h('button', {
        class: `item switch-item${c.state.autoplay ? ' on' : ''}`, attrs: { role: 'switch', 'aria-checked': String(c.state.autoplay), 'data-autoplay': '1' },
        onclick: () => { c.toggleAutoplay(); close(); },
      }, icon('bot'), 'Autoplay my seat', h('span', { class: 'knob' }))
      : null,
    seat?.autopilot ? actionButton([icon('bot'), 'Take my seat back'], 'item', async () => { await c.takeSeatBack(); close(); }) : null,
    h('button', { class: 'item', attrs: { 'data-textview': '1' }, onclick: () => { close(); setPreferredView('text'); } }, icon('list'), 'Switch to the text view'),
    h('button', { class: 'item', attrs: { 'data-guide-item': '1' }, onclick: () => { close(); openGuide(); } }, icon('book'), 'Game guide'),
    h('hr'),
    ...feelItems(ctx),
    h('hr'),
    h('button', {
      class: 'item danger',
      onclick: () => {
        const text = c.state.solo ? 'Leave this solo game? It stays in your saved games.'
          : 'Leave the game? The others continue, and you can come back with the same room code.';
        if (ctx.game.gameOver || c.state.online?.status !== 'online') c.leave();
        else askLeave(c, text);
      },
    }, icon('leave'), 'Leave game'),
    versionTag(c.appVersion, 'version-line'),
  ];
  return h('div', { class: 'tg-menu tray', attrs: { role: 'menu' } }, items);
}

export function cameraButtons(ctx: Ctx): HTMLElement {
  return h('div', { class: 'tg-cam', attrs: { role: 'toolbar', 'aria-label': 'Camera' } },
    h('button', { class: 'round', title: 'Turn the table 60°', attrs: { 'aria-label': 'Turn the table 60 degrees' }, onclick: () => ctx.camera.rotate() }, icon('rotate')),
    h('button', { class: 'round', title: 'Re-centre', attrs: { 'aria-label': 'Re-centre the table' }, onclick: () => ctx.camera.recenter() }, icon('recenter')),
    h('button', {
      class: `round${ctx.ui.topDown ? ' on' : ''}`, title: 'Top-down view',
      attrs: { 'aria-label': 'Top-down view', 'aria-pressed': String(ctx.ui.topDown) },
      onclick: () => { ctx.ui.topDown = !ctx.ui.topDown; ctx.camera.topDown(ctx.ui.topDown); ctx.redraw(); },
    }, icon('topdown')),
    guideRoundButton());
}
