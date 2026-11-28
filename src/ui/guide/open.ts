// Opening the game guide. This small module is all the menu and the game screens import; the
// guide itself (its text, pages and styles) is a separate chunk, loaded the first time it is
// opened. Like every built file, that chunk is stored by the service worker for offline play.

import { h } from '../dom';
import { icon } from '../icons';

let host: HTMLElement | null = null;
let guideOpen = false;
const guideWatchers = new Set<(open: boolean) => void>();

/** Whether the guide is open (it covers the whole screen, the 3D table included). */
export function isGuideOpen(): boolean {
  return guideOpen;
}

/** Be told when the guide opens or closes (the 3D table rests its portals meanwhile). Returns the way to stop. */
export function onGuideOpen(fn: (open: boolean) => void): () => void {
  guideWatchers.add(fn);
  return () => { guideWatchers.delete(fn); };
}

/** The guide viewer says it opened or closed. */
export function setGuideOpen(open: boolean): void {
  if (open === guideOpen) return;
  guideOpen = open;
  for (const fn of [...guideWatchers]) fn(open);
}

/** Where the guide overlay goes (mount.ts gives it its own element beside the screens). */
export function setGuideHost(el: HTMLElement): void {
  host = el;
}

/** Open the guide at its table of contents, or at a topic ("belts", "cards#sinkHole"). */
export function openGuide(target: string | null = null): void {
  void import('./viewer')
    .then(m => { m.showGuide(host ?? document.body, target); })
    .catch((err: unknown) => {
      // eslint-disable-next-line no-console
      console.warn('The game guide could not be loaded', err);
    });
}

/** The round "Game guide" button beside the camera buttons on the 3D table. */
export function guideRoundButton(): HTMLElement {
  return h('button', {
    class: 'round', title: 'Game guide', attrs: { 'aria-label': 'Open the game guide', 'data-guide': '1' },
    onclick: () => openGuide(),
  }, icon('book'));
}
