// The playtest entries of the game menu (shared by the table view and the text view):
// save the replay, watch this game again, and report a rules problem.

import type { AppController } from '../app/controller';
import type { Child } from './dom';
import { h } from './dom';
import { icon } from './icons';

export function playtestItems(ctrl: AppController, close: () => void, cls = 'item'): Child[] {
  const seated = ctrl.mySeat !== null;
  return [
    h('button', { class: cls, attrs: { 'data-save-replay': '1' }, onclick: () => { ctrl.downloadReplay(); close(); } }, icon('download'), 'Save replay'),
    h('button', { class: cls, attrs: { 'data-watch-again': '1' }, onclick: () => { close(); void ctrl.watchThisGame(); } }, icon('replay'), 'Watch this game again'),
    seated
      ? h('button', { class: cls, attrs: { 'data-report': '1' }, onclick: () => { close(); ctrl.openReport(); } }, icon('flag'), 'Report a rules problem')
      : null,
  ];
}
