// The play styles offered in the lobby. Each is the shared decision procedure (styleBot.ts)
// with its own priorities — what a player of that kind values and how eagerly they spend.

import type { BotFn } from '../botInterface';
import { BASE_STYLE } from './style';
import type { Style } from './style';
import { makeStyleBot } from './styleBot';

/** Balanced and plan-driven: supply chains with belts, modules for the dice in play, spends with care. */
export const PLANNER: Style = {
  ...BASE_STYLE,
  id: 'planner',
  label: 'Planner Bot',
};

/** Buys the next Mine as soon as it can and sets its modules for the bigger dice sums early. */
export const MINE_RUSHER: Style = {
  ...BASE_STYLE,
  id: 'mineRusher',
  label: 'Mine Rusher Bot',
  mineAppetite: 1,
  lookAheadDice: 1,
  cardAppetite: 0.15,
};

/** Buys a Leverage card whenever it can and plays two a turn. */
export const CARD_SHARK: Style = {
  ...BASE_STYLE,
  id: 'cardShark',
  label: 'Card Shark Bot',
  cardAppetite: 1,
  cardPlayThreshold: 0.3,
  teleporterAppetite: 0.3,
  mineAppetite: 0.2,
};

/** Goes for the three Bonus Tesseracts (The Investor, Belt Weaver, Factory Empire). */
export const BONUS_HUNTER: Style = {
  ...BASE_STYLE,
  id: 'bonusHunter',
  label: 'Bonus Hunter Bot',
  bonusWeight: { investor: 1.5, beltWeaver: 1.2, factoryEmpire: 1.3 },
  breadth: 4,
  meepleUpgrade: 3,
  maxRouteBelts: 6,
};

/** Keeps materials for points and empties the stacks to end the game when ahead. */
export const HOARDER: Style = {
  ...BASE_STYLE,
  id: 'hoarder',
  label: 'Hoarder Bot',
  hoard: true,
  cardAppetite: 0.25,
  teleporterAppetite: 0.3,
  mineAppetite: 0.1,
  meepleMine: 2,
  maxRouteBelts: 3,
};

/** Lives on Mine income and teleporters, so the meeple is free for the Mines. */
export const TELEPORTER: Style = {
  ...BASE_STYLE,
  id: 'teleporter',
  label: 'Teleporter Bot',
  teleporterAppetite: 1,
  meepleMine: 2.5,
  cardAppetite: 0.2,
};

export const STYLES: readonly Style[] = [PLANNER, MINE_RUSHER, CARD_SHARK, BONUS_HUNTER, HOARDER, TELEPORTER];

export const STYLE_BOTS: ReadonlyArray<{ readonly style: Style; readonly fn: BotFn }> =
  STYLES.map(style => ({ style, fn: makeStyleBot(style) }));
