// The Smart Bot's priorities and switches. Starts from the balanced play style (styles/style.ts
// BASE_STYLE); every change from it is a measured step in docs/SMART_BOT_LOG.md. The switches
// exist so a candidate change can be measured against the current bot in the simulator
// (an --import file builds the candidate with makeSmartBot({ ...SMART_STYLE, switch: true })).

import type { Style } from '../styles/style';
import { BASE_STYLE } from '../styles/style';

export interface SmartConfig extends Style {
  /** Spend nothing on long-term investments (belts, teleporters, cards, Mines) when the board is about to run out. */
  readonly endgameThrift: boolean;
  /** Extra worth (× a real Tesseract) of taking a Bonus Tesseract away from another player; 0 = off. */
  readonly denyWeight: number;
}

export const SMART_STYLE: SmartConfig = {
  ...BASE_STYLE,
  id: 'greedy',
  label: 'Smart Bot',
  endgameThrift: false,
  denyWeight: 0,
};
