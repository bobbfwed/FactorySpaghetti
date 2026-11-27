// Flat pictures, built by the game screen's own HTML code (src/ui/game/pieces.ts), so a Leverage
// card, a die or the Control Module tray in the guide looks exactly like it does in a game.

import { CONTROL_MODULE_MAX } from '../../../engine/config';
import type { TrayEntry } from '../../../play';
import { h } from '../../dom';
import { icon } from '../../icons';
import { cardFace, die, materialWell, moduleTray, pips, totalValue } from '../../game/pieces';
import type { Flat } from './types';

export function flatDom(f: Flat): HTMLElement {
  switch (f.k) {
    case 'card': return cardFace(f.card);
    case 'die': return die(f.n);
    case 'tray': {
      const on = new Set(f.onBoard ?? []);
      const tray: TrayEntry[] = Array.from({ length: CONTROL_MODULE_MAX }, (_, i) => ({ module: i + 1, state: on.has(i + 1) ? 'onBoard' : 'inTray' }));
      return moduleTray(tray, f.color, () => undefined, 'g-tray');
    }
    case 'icon': return h('span', { class: 'g-flaticon' }, icon(f.icon, f.color));
    case 'pips': return pips(f.n);
    case 'well': return materialWell(f.m, f.n);
    case 'total': return totalValue(f.n);
  }
}
