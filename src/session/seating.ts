// Pure seating helpers: who gets which seat, name de-duplication, seat-count changes,
// and the host-succession rule every client applies identically.

import type { Room, Seat, SeatColor } from './room';
import { SEAT_COLORS, openSeat, sameName } from './room';

/** `name`, or `name 2`, `name 3`, ... so it differs from every name in `taken`. */
export function dedupeName(name: string, taken: readonly string[]): string {
  if (!taken.some(t => sameName(t, name))) return name;
  for (let n = 2; ; n++) {
    const candidate = `${name} ${n}`;
    if (!taken.some(t => sameName(t, candidate))) return candidate;
  }
}

/** Names already in use by other people at the table (connected humans, bots, waiting visitors). */
export function namesInUse(room: Room, exceptSeat: number | null = null): string[] {
  const names: string[] = [];
  for (const s of room.seats) {
    if (s.index === exceptSeat) continue;
    if ((s.kind === 'human' && s.connected) || s.kind === 'bot') names.push(s.name);
  }
  for (const w of room.waiting) names.push(w.name);
  return names;
}

export function firstOpenSeat(room: Room): number | null {
  return room.seats.find(s => s.kind === 'open')?.index ?? null;
}

/** An away human seat whose name matches (trimmed, case-insensitive). */
export function awaySeatByName(room: Room, name: string): number | null {
  return room.seats.find(s => s.kind === 'human' && !s.connected && sameName(s.name, name))?.index ?? null;
}

export function hasAwayHumanSeat(room: Room): boolean {
  return room.seats.some(s => s.kind === 'human' && !s.connected);
}

export function unusedColor(seats: readonly Seat[]): SeatColor {
  return SEAT_COLORS.find(c => !seats.some(s => s.color === c)) ?? SEAT_COLORS[0]!;
}

/** Seats for a new player count, or null if a human would lose their seat. */
export function resizeSeats(seats: readonly Seat[], count: number): Seat[] | null {
  if (seats.slice(count).some(s => s.kind === 'human')) return null;
  const next = seats.slice(0, count).map(s => ({ ...s }));
  while (next.length < count) next.push(openSeat(next.length, unusedColor(next)));
  return next;
}

/**
 * The seat that becomes host when the host disappears: the first seat in index order that
 * is human, connected and not the old host. Every client holds the same room, so every
 * client picks the same seat without talking to the others.
 */
export function chooseSuccessor(room: Room): number | null {
  return room.seats.find(s => s.kind === 'human' && s.connected && s.index !== room.hostSeat)?.index ?? null;
}
