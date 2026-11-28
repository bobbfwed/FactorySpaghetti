// The Smart Bot (id 'greedy'): the game's default computer opponent and the stand-in for a
// player who drops out. See docs/SMART_BOT_LOG.md for how it was built and measured; the bot as
// it was before 2026-11-27 is kept for comparison in classic/ (simulator id 'greedy-classic').

import type { BotFn } from './botInterface';
import { makeSmartBot } from './smart/smartBot';
import { SMART_STYLE } from './smart/config';

export const chooseAction: BotFn = makeSmartBot(SMART_STYLE);
