// Previews across a host hand-over: nothing shown before it lingers after it, and previews flow
// again through the new host.

import { describe, it, expect } from 'vitest';
import { chooseAction as greedy } from '../../bots/greedyBot';
import type { PlayerId } from '../../engine/state';
import type { Room } from '../../session/room';
import { activeSeat, isHumanControlled } from '../../session/room';
import type { Preview } from '../../session/preview';
import type { OnlineRoom } from '../onlineRoom';
import type { World } from './helpers';
import { playingTable, pump, settled } from './helpers';

async function driveTo(w: World, host: OnlineRoom, pred: (r: Room) => boolean): Promise<void> {
  for (let n = 0; n < 5000; n++) {
    const r = host.hostSession!.room;
    if (pred(r)) return;
    const g = r.game!;
    const owner = g.pendingFactoryOps.find(e => isHumanControlled(r.seats[e.ownerId]))?.ownerId;
    const seat = owner ?? activeSeat(g)!;
    const res = await settled(w, w.rooms[seat]!.client.act(greedy(g, seat as PlayerId)));
    if (!res.ok) throw new Error(`driveTo: ${res.error.code}`);
    await pump(w.hub, w.clock, () => w.rooms.every(x => x.client.room?.seq === host.hostSession!.room.seq));
  }
  throw new Error('driveTo: too many moves');
}

/** The previews each room's client is showing, kept from its listener. */
function showing(room: OnlineRoom): Map<number, Preview> {
  const live = new Map<number, Preview>();
  room.client.onPreview((seat, p) => { if (p) live.set(seat, p); else live.delete(seat); });
  return live;
}

describe('previews over the memory hub', () => {
  it('a host hand-over in the middle of a preview leaves nothing stale, and previews work again after it', async () => {
    const w = await playingTable(3, { awayPolicy: 'wait' });
    const [ann, bea, cy] = w.rooms as [OnlineRoom, OnlineRoom, OnlineRoom];
    await driveTo(w, ann, r => activeSeat(r.game) === 2 && r.game!.phase === 'placePiece' && r.game!.pendingFactoryOps.length === 0);
    const beaSees = showing(bea);
    const first: Preview = { k: 'piece', q: 1, r: 0, rot: 1 };
    cy.client.sendPreview(first);
    await pump(w.hub, w.clock, () => beaSees.has(2));
    expect(beaSees.get(2)).toEqual(first);

    // The host vanishes while Cy is still considering where to put the piece.
    const seq = bea.client.room!.seq;
    w.hub.kill(w.transports[0]!);
    ann.leave();
    cy.client.sendPreview({ k: 'piece', q: 2, r: 0, rot: 1 }); // while the link is down: harmless
    await pump(w.hub, w.clock, () => bea.role === 'host' && cy.status === 'online' && cy.client.status === 'joined');
    expect(bea.hostSession!.room.seq).toBe(seq);
    expect(beaSees.size).toBe(0);

    // Through the new host, at the same move number.
    const again: Preview = { k: 'piece', q: 0, r: 2, rot: 4 };
    cy.client.sendPreview(again);
    await pump(w.hub, w.clock, () => beaSees.has(2));
    expect(beaSees.get(2)).toEqual(again);
    expect(bea.client.room!.seq).toBe(seq);
  }, 60_000);
});
