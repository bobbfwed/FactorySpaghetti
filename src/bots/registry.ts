// Registry of selectable bot personalities, surfaced in the pre-game lobby.
// Add a new bot here and it automatically appears as a seat option.

import type { BotFn } from './botInterface';
import { chooseAction as greedyBot } from './greedyBot';
import { chooseAction as randomBot } from './randomBot';

export interface BotType {
  readonly id: string;
  readonly label: string;
  readonly fn: BotFn;
}

export const BOT_TYPES: readonly BotType[] = [
  // Evaluation-driven bot (claim economy, credit-banking, power management, round-end
  // produce/convert) — the strong opponent. id kept as 'greedy' for lobby-default stability.
  { id: 'greedy', label: 'Smart Bot', fn: greedyBot },
  { id: 'random', label: 'Random Bot', fn: randomBot },
];

export function botById(id: string): BotType {
  return BOT_TYPES.find(b => b.id === id) ?? BOT_TYPES[0]!;
}
