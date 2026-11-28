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
  /** Extra worth (× the Investor's worth) of locking The Investor at module 18. */
  readonly lockBonus: number;
  /** Most search steps for one Belt Weaver route (a node budget, never the clock: speed on phones). */
  readonly weaveBudget: number;
  /** Measurement only: turn one feature off to see what it is worth (never set in play). */
  readonly ablate?: { readonly dice?: boolean; readonly supply?: boolean; readonly power?: boolean };
}

export const SMART_STYLE: SmartConfig = {
  ...BASE_STYLE,
  id: 'greedy',
  label: 'Smart Bot',
  // Go for the Bonus Tesseracts: each is weighed above a real Tesseract (attempt 3e took the Bonus
  // Hunter's weights; 5a raised The Investor to 2.0 and Factory Empire to 1.7 Tesseracts; the
  // sweep brought Factory Empire back to 1.4 in 11e). Belt Weaver at 1.2 (≥ 1) means the bot lays
  // deliberately long chains for it. One more claimed building is worth 5 (5a).
  bonusWeight: { investor: 2, beltWeaver: 1.2, factoryEmpire: 1.4 },
  breadth: 5,
  // Attempt 8f (kept, weight sweep): a smaller bias for the Mine upgrade point (3 -> 1).
  meepleUpgrade: 1,
  // Attempt 6d (kept, weight sweep): buy teleporters more reluctantly (appetite 0.5 -> 0.2).
  teleporterAppetite: 0.2,
  // Attempt 9c (kept, weight sweep): a Power Token is worth 1.6 in material value, not 1.2.
  powerValue: 1.6,
  // Attempt 7b (kept, weight sweep): buy a Leverage card only when the cards left are worth well
  // over the price on average (appetite 0.35 -> 0).
  cardAppetite: 0,
  maxRouteBelts: 4, // attempt 10c (kept, weight sweep): back to routes of at most 4 belts
  endgameThrift: false,
  denyWeight: 0,
  endgamePower: false,
  hurryWhenAhead: false,
  planCredits: false,
  placeDeny: 0,
  endgamePoints: false,
  closer: true, // attempt 4d (kept)
  lockBonus: 0,
  weaveBudget: 1500, // attempt 5e (kept for speed: no measurable loss, worst decision far lower)
};
