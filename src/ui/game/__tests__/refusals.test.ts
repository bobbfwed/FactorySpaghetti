// A refusal for a move that the room already shows as made (a second copy during a host change)
// is dropped; a refusal for a move that really was not made is kept.

import { describe, it, expect } from 'vitest';
import type { Action } from '../../../engine/actions';
import type { JournalData } from '../../../session/journal';
import type { LogEntry } from '../../../session/room';
import { appliedSince, refusalIsStale, sameMove, type SentMove } from '../refusals';

const roll: Action = { type: 'ROLL_DICE', rolls: [] };
const rolled: Action = { type: 'ROLL_DICE', rolls: [3, 5] };
const endActions: Action = { type: 'END_ACTIONS' };
const sent: SentMove = { action: roll, seat: 1, seq: 20 };

describe('stale refusals', () => {
  it('compares moves without the dice the host filled in', () => {
    expect(sameMove(roll, rolled)).toBe(true);
    expect(sameMove(roll, endActions)).toBe(false);
  });

  it('drops "It is not your turn." when the same move by the same seat was applied after sending', () => {
    expect(refusalIsStale('NOT_YOUR_TURN', sent, [{ seq: 21, seat: 1, action: rolled }])).toBe(true);
    expect(refusalIsStale('STALE', sent, [{ seq: 22, seat: 1, action: rolled }])).toBe(true);
  });

  it('keeps the refusal when the move was not made', () => {
    // Nothing applied since.
    expect(refusalIsStale('NOT_YOUR_TURN', sent, [])).toBe(false);
    // Another seat's move, or another move of mine.
    expect(refusalIsStale('NOT_YOUR_TURN', sent, [{ seq: 21, seat: 0, action: rolled }])).toBe(false);
    expect(refusalIsStale('NOT_YOUR_TURN', sent, [{ seq: 21, seat: 1, action: endActions }])).toBe(false);
    // The same move made before this one was sent (an earlier turn).
    expect(refusalIsStale('NOT_YOUR_TURN', sent, [{ seq: 20, seat: 1, action: rolled }])).toBe(false);
    // Who made it is unknown: no guess.
    expect(refusalIsStale('NOT_YOUR_TURN', sent, [{ seq: 21, seat: null, action: rolled }])).toBe(false);
  });

  it('keeps refusals that say the move is not allowed, whatever happened since', () => {
    expect(refusalIsStale('CANNOT_AFFORD', sent, [{ seq: 21, seat: 1, action: rolled }])).toBe(false);
  });

  it('reads the moves since sending from the journal, and who made them from the log', () => {
    const journal = { start: { kind: 'seed', seed: 1, playerCount: 2 }, moves: [endActions, rolled, endActions] } as unknown as JournalData;
    const log: LogEntry[] = [{ seq: 1, seat: 0, text: 'a' }, { seq: 2, seat: 1, text: 'b' }, { seq: 2, seat: null, text: 'note' }];
    const since = appliedSince(journal, log, 1);
    expect(since).toEqual([{ seq: 2, seat: 1, action: rolled }, { seq: 3, seat: null, action: endActions }]);
    expect(refusalIsStale('NOT_YOUR_TURN', { action: roll, seat: 1, seq: 1 }, since)).toBe(true);
    expect(appliedSince(null, log, 0)).toEqual([]);
  });
});
