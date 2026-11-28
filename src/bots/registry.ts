// Registry of selectable bot personalities, surfaced in the pre-game lobby.
// Add a new bot here and it automatically appears as a seat option.

import type { BotFn } from './botInterface';
import { chooseAction as greedyBot } from './greedyBot';
import { chooseAction as greedyClassic } from './classic/greedyClassic';
import { chooseAction as randomBot } from './randomBot';
import { STYLE_BOTS } from './styles/profiles';

export interface BotType {
  readonly id: string;
  readonly label: string;
  readonly fn: BotFn;
}

export const BOT_TYPES: readonly BotType[] = [
  // The strong default opponent and the stand-in for an away player. id kept as 'greedy' (saved
  // games store it).
  { id: 'greedy', label: 'Smart Bot', fn: greedyBot },
  // Play-style bots (styles/): one shared plan-following procedure, each with its own priorities.
  ...STYLE_BOTS.map(({ style, fn }) => ({ id: style.id, label: style.label, fn })),
  { id: 'random', label: 'Random Bot', fn: randomBot },
];

/**
 * Bots the simulator knows but the lobby does not offer: the Smart Bot as it was before
 * 2026-11-27 ('greedy-classic'), kept so every new version can be measured against it.
 */
export const SIM_ONLY_BOTS: readonly BotType[] = [
  { id: 'greedy-classic', label: 'Smart Bot (classic)', fn: greedyClassic },
];

export function botById(id: string): BotType {
  return BOT_TYPES.find(b => b.id === id) ?? BOT_TYPES[0]!;
}
