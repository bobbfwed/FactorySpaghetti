// The move journal over the asynchronous, size-limited memory hub (messages split at 15 KiB):
// a host hand-over in the middle of a game keeps the journal whole, and it replays to the end.

import { describe, it, expect } from 'vitest';
import { journalEnd, journalFrom, replayTo } from '../../session/journal';
import type { OnlineRoom } from '../onlineRoom';
import { autoplay } from '../autoplay';
import { playingTable, pump } from './helpers';

describe('the journal across a host hand-over (OnlineRoom)', () => {
  it('the successor continues the journal, and every device ends with the same, complete one', async () => {
    const w = await playingTable(4, { awayPolicy: 'bot', awayGraceMs: 5000 });
    const [ann, bea, cy, dee] = w.rooms as [OnlineRoom, OnlineRoom, OnlineRoom, OnlineRoom];
    const stops = w.rooms.map(r => autoplay(r.client));
    await pump(w.hub, w.clock, () => ann.hostSession!.room.seq >= 80);

    w.hub.kill(w.transports[0]!);
    stops[0]!();
    ann.leave();
    await pump(w.hub, w.clock, () => bea.role === 'host' && [cy, dee].every(r => r.status === 'online' && r.client.status === 'joined'));
    await pump(w.hub, w.clock, () => [bea, cy, dee].every(r => r.client.room?.phase === 'finished'));
    stops.forEach(s => s());
    await pump(w.hub, w.clock, () => [bea, cy, dee].every(r => r.client.journalCurrent));

    const final = bea.hostSession!.room;
    const j = bea.hostSession!.journal!;
    expect(journalFrom(j)).toBe(0);
    expect(journalEnd(j)).toBe(final.seq);
    expect(replayTo(j, final.seq)).toEqual(final.game);
    for (const r of [bea, cy, dee]) expect(r.client.journal).toEqual(j);
    expect(w.hub.oversize).toBe(0);
  }, 120_000);
});
