// Where Teleporters sit on a building (RULES_CHANGES.md #55). A Teleporter sits on ONE input of a
// building, or on its output. `Buffer.teleporters[i]` is the owner of the Teleporter on slot i of
// that buffer (input slot i belongs to input i; an output has one slot); an entry that is null or
// missing means none, and the list is kept without trailing nulls, so a buffer with no Teleporter
// has []. Pure helpers, shared by the engine, the interface, the table and the bots.

import type { BoardPiece, Buffer, PlayerId } from '../state';

/** The owner of the Teleporter on slot `slot` of `buf` (input `slot`; the output is slot 0), or null. */
export function teleporterOn(buf: Buffer | null | undefined, slot = 0): PlayerId | null {
  return buf?.teleporters[slot] ?? null;
}

/** `buf` with the Teleporter on slot `slot` set to `owner` (null removes it); trailing nulls trimmed. */
export function withTeleporter(buf: Buffer, slot: number, owner: PlayerId | null): Buffer {
  const list: Array<PlayerId | null> = [];
  const n = Math.max(buf.teleporters.length, slot + 1);
  for (let i = 0; i < n; i++) list.push(i === slot ? owner : buf.teleporters[i] ?? null);
  while (list.length > 0 && list[list.length - 1] === null) list.pop();
  return { ...buf, teleporters: list };
}

/** Every Teleporter on `buf`: its slot and its owner, in slot order. */
export function teleportersOf(buf: Buffer | null | undefined): Array<{ slot: number; owner: PlayerId }> {
  const out: Array<{ slot: number; owner: PlayerId }> = [];
  buf?.teleporters.forEach((owner, slot) => { if (owner != null && slot < buf.slots.length) out.push({ slot, owner }); });
  return out;
}

/** True when `buf` carries at least one Teleporter. */
export function hasTeleporter(buf: Buffer | null | undefined): boolean {
  return !!buf && buf.teleporters.some((o, i) => o != null && i < buf.slots.length);
}

/** How many Teleporters sit on `piece` (its inputs and its output). */
export function teleporterCount(piece: Pick<BoardPiece, 'input' | 'output'>): number {
  return teleportersOf(piece.input).length + teleportersOf(piece.output).length;
}

/**
 * The input slots of `piece` that carry `owner`'s Teleporter and are empty: the slots `owner`
 * supplies from their inventory when they run it (#45, per input since #55), in slot order.
 */
export function supplySlots(piece: Pick<BoardPiece, 'input'>, owner: PlayerId): number[] {
  const input = piece.input;
  if (!input) return [];
  const out: number[] = [];
  input.slots.forEach((m, i) => { if (m === null && teleporterOn(input, i) === owner) out.push(i); });
  return out;
}

/** True when `owner` has a Teleporter on at least one input of `piece`. */
export function hasInputTeleporterOf(piece: Pick<BoardPiece, 'input'>, owner: PlayerId): boolean {
  return teleportersOf(piece.input).some(t => t.owner === owner);
}

/**
 * The slots of a buffer that a Teleporter may still be put on: each input without one, or the
 * output (slot 0) when it has none.
 */
export function freeTeleporterSlots(buf: Buffer | null | undefined): number[] {
  if (!buf) return [];
  const out: number[] = [];
  for (let i = 0; i < buf.slots.length; i++) if (teleporterOn(buf, i) === null) out.push(i);
  return out;
}
