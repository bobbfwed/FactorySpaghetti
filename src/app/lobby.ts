// What the lobby says about a room: whether the host could start now and, if not, what is
// still needed, in plain words. Mirrors the host session's own start checks.

import type { BotType } from '../bots/registry';
import { BOT_TYPES, botById } from '../bots/registry';
import type { Room, Seat, SeatColor } from '../session/room';
import { SEAT_COLORS } from '../session/room';

export interface LobbyInfo {
  isHost: boolean;
  /** A resumed game waiting for the host to continue it. */
  resuming: boolean;
  /** True when the host's Start (or Continue) would be accepted now. */
  canStart: boolean;
  /** The one line under the seats: what is still needed, or that everyone is ready. */
  needs: string;
  readyCount: number;
  humanCount: number;
}

export function listNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

export function lobbyInfo(room: Room, mySeat: number | null): LobbyInfo {
  const isHost = mySeat !== null && mySeat === room.hostSeat;
  const humans = room.seats.filter(s => s.kind === 'human');
  const readyCount = room.seats.filter(s => s.kind === 'bot' || (s.kind === 'human' && s.ready)).length;
  const base = { isHost, readyCount, humanCount: humans.length };

  if (room.phase !== 'lobby') {
    const missing = humans.filter(s => !s.connected).map(s => s.name);
    const waiting = room.waiting.length;
    let needs: string;
    if (missing.length === 0) needs = isHost ? 'Everyone is back. Continue when you are ready.' : 'Everyone is back. Waiting for the host to continue the game.';
    else {
      const who = `${listNames(missing)} ${missing.length === 1 ? 'is' : 'are'} not back yet`;
      needs = isHost
        ? `${who}. ${waiting > 0 ? 'Assign someone who is waiting, ' : 'Wait, '}give the seat to a bot, or continue anyway (a bot plays an empty seat after the grace time).`
        : `${who}. Waiting for the host to continue the game.`;
    }
    return { ...base, resuming: true, canStart: isHost && room.hold, needs };
  }

  const open = room.seats.filter(s => s.kind === 'open').length;
  const away = humans.filter(s => !s.connected).map(s => s.name);
  // A host playing alone with bots can always start: there is nobody else to agree.
  const alone = humans.length === 1 && humans[0]!.index === room.hostSeat;
  const notReady = alone ? [] : humans.filter(s => s.connected && !s.ready).map(s => s.name);
  const parts: string[] = [];
  if (open > 0) parts.push(open === 1 ? '1 seat open — add a bot or wait for a player' : `${open} seats open — add bots or wait for players`);
  if (away.length > 0) parts.push(`${listNames(away)} ${away.length === 1 ? 'is' : 'are'} not connected`);
  if (notReady.length > 0) {
    const me = mySeat !== null ? room.seats[mySeat] : undefined;
    const names = notReady.map(n => (me && me.name === n ? 'you' : n));
    parts.push(`waiting for ${listNames(names)} to be ready`);
  }
  const canStart = isHost && parts.length === 0;
  let needs: string;
  if (parts.length > 0) needs = capitalise(parts.join('; ')) + '.';
  else needs = isHost ? 'Everyone is ready. Start when you like.' : 'Everyone is ready. Waiting for the host to start.';
  return { ...base, resuming: false, canStart, needs };
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** The kind of bot a new bot seat gets: Smart Bot. */
export const DEFAULT_BOT_ID = 'greedy';

/** The kind of bot playing a seat, as the host runs it (an unknown id plays as the default). */
export function botKindOf(seat: Seat): BotType {
  return botById(seat.botId ?? DEFAULT_BOT_ID);
}

/** Every kind of bot the host may choose for a bot seat, in registry order, marking the current one. */
export function botChoices(seat: Seat): { id: string; label: string; current: boolean }[] {
  const cur = botKindOf(seat).id;
  return BOT_TYPES.map(b => ({ id: b.id, label: b.label, current: b.id === cur }));
}

/** Colours this seat may switch to: free, or held only by an open or bot seat (they swap). */
export function colorChoices(room: Room, seat: number): { color: SeatColor; free: boolean; mine: boolean }[] {
  return SEAT_COLORS.map(color => {
    const holder: Seat | undefined = room.seats.find(s => s.color === color);
    const mine = holder?.index === seat;
    return { color, mine, free: mine || !holder || holder.kind !== 'human' };
  });
}

// Timer steps for the lobby steppers, in milliseconds (within the host session's clamped ranges).
export const OPERATE_STEPS = [0, 4_000, 6_000, 8_000, 10_000, 15_000, 20_000, 30_000, 45_000, 60_000, 90_000, 120_000];
export const ROUND_END_STEPS = [0, 10_000, 15_000, 20_000, 30_000, 45_000, 60_000, 90_000, 120_000, 180_000, 300_000, 600_000];
export const GRACE_STEPS = [0, 15_000, 30_000, 60_000, 90_000, 120_000, 180_000, 300_000, 600_000];

/** The next value up or down a list of steps from `current` (which need not be on the list). */
export function stepValue(steps: readonly number[], current: number, dir: 1 | -1): number {
  if (dir > 0) return steps.find(v => v > current) ?? steps[steps.length - 1]!;
  for (let i = steps.length - 1; i >= 0; i--) if (steps[i]! < current) return steps[i]!;
  return steps[0]!;
}

/** "8 s", "2 min", "Off". */
export function durationWords(ms: number): string {
  if (ms <= 0) return 'Off';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  if (s % 60 === 0) return `${s / 60} min`;
  return `${Math.floor(s / 60)} min ${s % 60} s`;
}
