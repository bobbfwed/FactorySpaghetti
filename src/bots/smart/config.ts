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
  /** Value Power Tokens less as the board runs out (they score no points). */
  readonly endgamePower: boolean;
  /** Empty the shortest stack (end the game sooner) when ahead on points. */
  readonly hurryWhenAhead: boolean;
  /** Spend the Mine upgrade point's credits as one plan (a claim together with the upgrades left over). */
  readonly planCredits: boolean;
  /** Weight of keeping a drawn building away from where it would fit another player (0 = off). */
  readonly placeDeny: number;
  /** In the last round, value materials at their points only (no premium for the next recipe). */
  readonly endgamePoints: boolean;
  /** One Tesseract from the win: value the power and inputs of the last run much more. */
  readonly closer: boolean;
  /** Measurement only: turn one feature off to see what it is worth (never set in play). */
  readonly ablate?: { readonly dice?: boolean; readonly supply?: boolean; readonly power?: boolean };
}

export const SMART_STYLE: SmartConfig = {
  ...BASE_STYLE,
  id: 'greedy',
  label: 'Smart Bot',
  endgameThrift: false,
  denyWeight: 0,
  endgamePower: false,
  hurryWhenAhead: false,
  planCredits: false,
  placeDeny: 0,
  endgamePoints: false,
  closer: false,
};
