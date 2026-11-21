// Refusals that arrive after the move was made anyway.
//
// During a host change a move can be applied twice over: the device re-makes its own lost move
// for the new host (session/recovery.ts) and the move that was in flight is sent again. The
// second copy is refused ("It is not your turn.") although the move itself went through. The
// table view drops such a refusal when the room it holds already shows the same move by the same
// seat applied after the move was sent. A refusal for a move that really was not made is kept.
// Pure: the caller passes the moves applied since sending.

import type { Action } from '../../engine/actions';
import type { JournalData } from '../../session/journal';
import { journalFrom } from '../../session/journal';
import type { LogEntry } from '../../session/room';

/** Refusal codes that mean "the game had moved on" rather than "that move is not allowed". */
export const MOVED_ON_CODES: ReadonlySet<string> = new Set(['NOT_YOUR_TURN', 'WRONG_PHASE', 'STALE']);

/** A move this device sent: by which seat, and the room's move number when it was sent. */
export interface SentMove { readonly action: Action; readonly seat: number; readonly seq: number }

/** A move the room shows as applied: its move number, who made it (null when unknown), what it was. */
export interface AppliedMove { readonly seq: number; readonly seat: number | null; readonly action: Action }

/** Same move, ignoring the dice (the host fills them in; the request carries none). */
export function sameMove(a: Action, b: Action): boolean {
  return canonical(strip(a)) === canonical(strip(b));
}

function strip(a: Action): unknown {
  if (a.type !== 'ROLL_DICE') return a;
  return { ...a, rolls: undefined }; // canonical() leaves out undefined fields
}

function canonical(x: unknown): string {
  if (Array.isArray(x)) return `[${x.map(canonical).join(',')}]`;
  if (x && typeof x === 'object') {
    const o = x as Record<string, unknown>;
    return `{${Object.keys(o).filter(k => o[k] !== undefined).sort().map(k => `${JSON.stringify(k)}:${canonical(o[k])}`).join(',')}}`;
  }
  return JSON.stringify(x);
}

/** Drop this refusal? Only for a "moved on" code when the same move by the same seat was applied after sending. */
export function refusalIsStale(code: string, sent: SentMove, applied: readonly AppliedMove[]): boolean {
  if (!MOVED_ON_CODES.has(code)) return false;
  return applied.some(m => m.seq > sent.seq && m.seat === sent.seat && sameMove(m.action, sent.action));
}

/**
 * The moves applied after move number `after`, from this device's journal (what each move was)
 * and the room's log (who made it). Moves missing from either are left out, so nothing is dropped
 * on a guess.
 */
export function appliedSince(journal: JournalData | null, log: readonly LogEntry[], after: number): AppliedMove[] {
  if (!journal) return [];
  const from = journalFrom(journal);
  const seatOf = new Map<number, number>();
  for (const e of log) if (e.seat !== null && !seatOf.has(e.seq)) seatOf.set(e.seq, e.seat);
  const out: AppliedMove[] = [];
  journal.moves.forEach((action, i) => {
    const seq = from + i + 1;
    if (seq <= after) return;
    out.push({ seq, seat: seatOf.get(seq) ?? null, action });
  });
  return out;
}
