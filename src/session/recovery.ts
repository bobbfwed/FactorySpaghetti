// Re-making moves a new host never received. When the host's browser closes while its last
// broadcast is on its way, the player who takes over may be a move or two behind what another
// device saw. That device keeps the missing moves (its "ahead list"); each seat's own device makes
// its own lost moves again, as ordinary moves, and the host checks them like any move. A roll is
// re-sent without dice: the host rolls from the seeded dice stream in the room, which is at the
// same position as before, so the same dice come out. Nobody vouches for another seat's move.
//
// Pure helpers here; ClientSession runs the procedure.

import type { Action } from '../engine/actions';
import type { GameState } from '../engine/state';
import { applyAction } from '../engine';
import { actorOf } from './replay';

export interface AheadEntry {
  /** room.seq before the move (the move becomes number pos + 1). */
  pos: number;
  /** The move as it was applied (a roll carries its dice). */
  action: Action;
  /** The seat that made it. */
  seat: number;
}

/** How long a device waits for another seat's device (or bot) to re-make that seat's move. */
export const RECOVERY_WAIT_MS = 10_000;

/**
 * The lost moves with their seats, by applying them from the new host's position (`state` at
 * move `pos`). The list stops at a move the engine refuses there (it cannot be re-made).
 */
export function aheadEntries(state: GameState, pos: number, moves: readonly Action[]): AheadEntry[] {
  const out: AheadEntry[] = [];
  let s = state;
  for (let i = 0; i < moves.length; i++) {
    const action = moves[i]!;
    let res: ReturnType<typeof applyAction>;
    try { res = applyAction(s, action); } catch { break; }
    if (!res.ok) break;
    out.push({ pos: pos + i, action, seat: actorOf(s, action) });
    s = res.state;
  }
  return out;
}

/** The move to send again: as the player would send it (a roll without dice; the host rolls). */
export function resendable(action: Action): Action {
  return action.type === 'ROLL_DICE' ? { type: 'ROLL_DICE', rolls: [] } : action;
}

/** Equal moves, whatever the order of their fields. */
export function sameAction(a: Action, b: Action): boolean {
  return canonical(a) === canonical(b);
}

function canonical(x: unknown): string {
  if (Array.isArray(x)) return `[${x.map(canonical).join(',')}]`;
  if (x && typeof x === 'object') {
    const o = x as Record<string, unknown>;
    return `{${Object.keys(o).filter(k => o[k] !== undefined).sort().map(k => `${JSON.stringify(k)}:${canonical(o[k])}`).join(',')}}`;
  }
  return JSON.stringify(x);
}
