// How fast bots move ("Bot speed"), so a person can follow each move on the table. Applies to
// bot seats, to the stand-in bot of an away player (both paced by the host), and to a player's
// own autoplay (paced by their client). Pacing is the host's clock only; the engine has none.
//
//   instant  no pause; the host plays bot moves in runs (tests and the simulator use this)
//   fast     a fixed short pause: settings.botDelayMs (300 ms by default)
//   normal   long enough for the previous move's animation at Normal animation speed

import type { RoomSettings, TableEvent } from './room';

export type BotSpeed = 'instant' | 'fast' | 'normal';
export const BOT_SPEEDS: readonly BotSpeed[] = ['instant', 'fast', 'normal'];
export const DEFAULT_BOT_SPEED: BotSpeed = 'normal';
/** The "fast" pause when settings.botDelayMs is not positive. */
export const FAST_DELAY_MS = 300;

/** Pauses at Normal speed (ms). */
export const NORMAL_PAUSE = {
  /** After a roll that activated buildings: production, operate prompts, materials moving. */
  rollActive: 2000,
  /** After a roll that activated nothing. */
  rollQuiet: 1200,
  /** After any other move. */
  other: 800,
  /** A bot answering an operate-or-skip choice on someone else's turn. */
  offTurn: 500,
} as const;

/** The room's bot speed; a missing or unknown value (an older save) is the default. */
export function botSpeedOf(settings: Pick<RoomSettings, 'botSpeed'> | { botSpeed?: unknown }): BotSpeed {
  const v = (settings as { botSpeed?: unknown }).botSpeed;
  return BOT_SPEEDS.includes(v as BotSpeed) ? (v as BotSpeed) : DEFAULT_BOT_SPEED;
}

export type LastMove = 'roll-active' | 'roll-quiet' | 'other';

/** What the last move (or run of moves) was, from the room's lastEvents. */
export function lastMoveOf(events: readonly TableEvent[]): LastMove {
  if (!events.some(e => e.kind === 'roll')) return 'other';
  return events.some(e => e.kind === 'activated') ? 'roll-active' : 'roll-quiet';
}

/** The pause before a bot's next move. 0 means instant (the host may play several at once). */
export function botPauseMs(settings: Pick<RoomSettings, 'botDelayMs'> & { botSpeed?: unknown }, last: LastMove, offTurnAnswer: boolean): number {
  switch (botSpeedOf(settings)) {
    case 'instant': return 0;
    case 'fast': return settings.botDelayMs > 0 ? settings.botDelayMs : FAST_DELAY_MS;
    case 'normal':
      if (offTurnAnswer) return NORMAL_PAUSE.offTurn;
      return last === 'roll-active' ? NORMAL_PAUSE.rollActive : last === 'roll-quiet' ? NORMAL_PAUSE.rollQuiet : NORMAL_PAUSE.other;
  }
}

/** Settings from a save or another host, with the bot speed filled in. */
export function normalizeSettings<T extends RoomSettings>(s: T): T {
  return { ...s, botSpeed: botSpeedOf(s) };
}
