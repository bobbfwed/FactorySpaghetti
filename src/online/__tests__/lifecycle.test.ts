// The online room lifecycle over the asynchronous, size-limited memory hub: full games, a
// dropped link, host hand-over (including two players leaving at once), a move in flight
// during the hand-over, giving up, deliberate closes, and resuming from a save.

import { describe, it, expect } from 'vitest';
import { chooseAction as greedy } from '../../bots/greedyBot';
import type { PlayerId } from '../../engine/state';
import type { Room } from '../../session/room';
import { activeSeat, isHumanControlled } from '../../session/room';
import { toSave } from '../../session/save';
import { JoinError } from '../../net/conn';
import { OnlineRoom } from '../onlineRoom';
import type { OnlineStatus } from '../onlineRoom';
import { autoplay } from '../autoplay';
import type { World } from './helpers';
import { newWorld, playingTable, pump, settled, tokenFor } from './helpers';

const hostOf = (rooms: OnlineRoom[]): OnlineRoom[] => rooms.filter(r => r.role === 'host' && r.status !== 'closed');
const finished = (rooms: OnlineRoom[]): boolean => rooms.every(r => r.client.room?.phase === 'finished');

function history(room: OnlineRoom): OnlineStatus[] {
  const seen: OnlineStatus[] = [room.status];
  room.subscribe(() => { if (seen[seen.length - 1] !== room.status) seen.push(room.status); });
  return seen;
}

/** Play moves by hand (greedy policy) through the clients until `pred(hostRoom)` holds. */
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

describe('online room over the memory hub', () => {
  it('(1) a host and three clients play a whole game to the end', async () => {
    const w = await playingTable(4);
    const [host] = w.rooms as [OnlineRoom];
    expect(host.role).toBe('host');
    expect(w.rooms.slice(1).map(r => r.client.seat)).toEqual([1, 2, 3]);
    const stops = w.rooms.map(r => autoplay(r.client));
    await pump(w.hub, w.clock, () => finished(w.rooms));
    stops.forEach(s => s());

    const final = host.hostSession!.room;
    expect(final.game!.gameOver).toBe(true);
    for (const r of w.rooms) expect(r.client.room).toEqual(final);
    // Late rooms are bigger than one PeerJS message, so they travelled in parts, and no raw
    // message ever broke the limit.
    expect(new TextEncoder().encode(JSON.stringify(final)).length).toBeGreaterThan(16_300);
    expect(w.hub.oversize).toBe(0);
    expect(w.rooms.every(r => r.status === 'online')).toBe(true);
  }, 120_000);

  it('(2) a client whose own link drops reconnects without anyone noticing a host change', async () => {
    const w = await playingTable(4, { awayPolicy: 'wait' });
    const [host, , cy] = w.rooms as [OnlineRoom, OnlineRoom, OnlineRoom, OnlineRoom];
    const histories = w.rooms.map(history);
    const stops = w.rooms.map(r => autoplay(r.client));
    await pump(w.hub, w.clock, () => host.hostSession!.room.seq >= 60);

    w.hub.sever(w.transports[2]!);
    await pump(w.hub, w.clock, () => cy.status === 'reconnecting');
    await pump(w.hub, w.clock, () => cy.status === 'online' && cy.client.status === 'joined'
      && host.hostSession!.room.seats[2]!.connected);
    expect(cy.client.seat).toBe(2);
    expect(cy.role).toBe('client');

    await pump(w.hub, w.clock, () => finished(w.rooms));
    stops.forEach(s => s());
    expect(hostOf(w.rooms)).toEqual([host]);
    expect(histories[2]).toEqual(['online', 'reconnecting', 'online']);
    for (const i of [0, 1, 3]) expect(histories[i]).toEqual(['online']);
    expect(host.hostSession!.room.log.some(e => /took over as host/.test(e.text))).toBe(false);
  }, 120_000);

  it('(3) when the host vanishes, exactly one successor takes over under the same code and the game finishes', async () => {
    // The old code stays registered for 6 s after the host dies, as the PeerJS broker does.
    const w = await playingTable(4, { awayPolicy: 'bot', awayGraceMs: 5000 }, { releaseDelayMs: 6000 });
    const [ann, bea, cy, dee] = w.rooms as [OnlineRoom, OnlineRoom, OnlineRoom, OnlineRoom];
    const code = ann.code;
    const histories = w.rooms.map(history);
    const stops = w.rooms.map(r => autoplay(r.client));
    await pump(w.hub, w.clock, () => ann.hostSession!.room.seq >= 40);
    const seqBefore = bea.client.room!.seq;

    w.hub.kill(w.transports[0]!);
    stops[0]!();
    ann.leave(); // the vanished browser's leftovers stop too
    await pump(w.hub, w.clock, () => bea.role === 'host' && [cy, dee].every(r => r.status === 'online' && r.client.status === 'joined'));

    expect(hostOf([bea, cy, dee])).toEqual([bea]);
    expect(bea.code).toBe(code);
    expect(histories[1]).toEqual(['online', 'reconnecting', 'taking-over', 'online']);
    expect(histories[2]).toEqual(['online', 'reconnecting', 'online']);
    expect([bea, cy, dee].map(r => r.client.seat)).toEqual([1, 2, 3]);
    const newRoom = bea.hostSession!.room;
    expect(newRoom.hostSeat).toBe(1);
    expect(newRoom.seq).toBeGreaterThanOrEqual(seqBefore);

    await pump(w.hub, w.clock, () => finished([bea, cy, dee]));
    stops.forEach(s => s());
    const final = bea.hostSession!.room;
    expect(final.seq).toBeGreaterThan(seqBefore);
    expect(final.seats[0]).toMatchObject({ connected: false, autopilot: true }); // a bot finished Ann's seat
    expect(cy.client.room).toEqual(final);
    expect(dee.client.room).toEqual(final);
    expect(w.hub.oversize).toBe(0);
  }, 120_000);

  it('(4) when the host and the first successor vanish together, the next in line takes over', async () => {
    const w = await playingTable(4, { awayPolicy: 'bot', awayGraceMs: 5000 });
    const [ann, bea, cy, dee] = w.rooms as [OnlineRoom, OnlineRoom, OnlineRoom, OnlineRoom];
    const stops = w.rooms.map(r => autoplay(r.client));
    await pump(w.hub, w.clock, () => ann.hostSession!.room.seq >= 30);

    w.hub.kill(w.transports[0]!);
    w.hub.kill(w.transports[1]!);
    stops[0]!();
    stops[1]!();
    ann.leave();
    await pump(w.hub, w.clock, () => cy.role === 'host' && dee.status === 'online' && dee.client.status === 'joined');
    expect(hostOf([cy, dee])).toEqual([cy]);
    expect(cy.code).toBe(ann.code);
    expect(dee.client.seat).toBe(3);
    // Bea's browser is offline: it tries to take over, cannot, and ends up lost.
    await pump(w.hub, w.clock, () => bea.status === 'lost');
    expect(bea.role).toBe('client');

    await pump(w.hub, w.clock, () => finished([cy, dee]));
    stops.forEach(s => s());
    expect(cy.hostSession!.room.seats.slice(0, 2).every(s => s.autopilot)).toBe(true);
  }, 120_000);

  for (const when of ['before the host saw it', 'after the host applied it but before anyone heard'] as const) {
    it(`(5) a move in flight during the hand-over is applied exactly once (${when})`, async () => {
      const w = await playingTable(3, { awayPolicy: 'wait' });
      const [ann, bea, cy] = w.rooms as [OnlineRoom, OnlineRoom, OnlineRoom];
      await driveTo(w, ann, r => r.seq >= 20 && activeSeat(r.game) === 2 && r.game!.pendingFactoryOps.length === 0);
      const seqBefore = ann.hostSession!.room.seq;

      const result = cy.client.act(greedy(cy.client.room!.game!, 2));
      const id = cy.client.pending!.id;
      if (when !== 'before the host saw it') {
        await pump(w.hub, w.clock, () => ann.hostSession!.room.seq === seqBefore + 1);
      }
      w.hub.kill(w.transports[0]!);
      ann.leave();
      expect(bea.client.room!.seq).toBe(seqBefore); // nobody heard about the move

      expect(await settled(w, result)).toEqual({ ok: true });
      await pump(w.hub, w.clock, () => bea.role === 'host' && cy.client.room?.seq === bea.hostSession!.room.seq);
      const room = bea.hostSession!.room;
      expect(room.seq).toBe(seqBefore + 1);
      expect(room.recent.filter(r => r.id === id)).toEqual([{ seat: 2, id }]);
      expect(cy.client.pending).toBeNull();
    }, 60_000);
  }

  it('(6) goes "lost" when nobody can host the code, keeping the last room', async () => {
    // The dead host's code is never released, so nobody can register it again.
    const w = await playingTable(3, {}, { releaseDelayMs: Infinity }, { retries: 6 });
    const [ann, bea, cy] = w.rooms as [OnlineRoom, OnlineRoom, OnlineRoom];
    const histories = w.rooms.map(history);
    w.hub.kill(w.transports[0]!);
    ann.leave();
    await pump(w.hub, w.clock, () => bea.status === 'lost' && cy.status === 'lost');
    expect(histories[1]).toEqual(['online', 'reconnecting', 'taking-over', 'lost']);
    // Cy waited for Bea, then tried to take over itself after half its retries.
    expect(histories[2]).toEqual(['online', 'reconnecting', 'taking-over', 'lost']);
    expect(bea.client.room?.phase).toBe('playing'); // the copy a "host it from my copy" would use
    expect(w.clock.pending).toBe(0); // no timers left behind
  }, 60_000);

  it('(7) resumes from a save: players rejoin by name, the host lifts the hold, the game goes on', async () => {
    const w = await playingTable(3);
    const [ann, bea, cy] = w.rooms as [OnlineRoom, OnlineRoom, OnlineRoom];
    const stops = w.rooms.map(r => autoplay(r.client));
    await pump(w.hub, w.clock, () => ann.hostSession!.room.seq >= 30);
    stops.forEach(s => s());
    await pump(w.hub, w.clock, () => w.hub.inFlight === 0 && !w.rooms.some(r => r.client.pending));
    const save = toSave(ann.hostSession!.room, { savedAt: w.clock.now(), app: 'test' });
    const savedSeq = save.room.seq;

    ann.leave({ endRoom: true });
    await pump(w.hub, w.clock, () => bea.status === 'closed' && cy.status === 'closed');
    expect([bea.closedWhy, cy.closedWhy]).toEqual(['ended', 'ended']);

    // Another evening, new devices: Cy hosts the save; Ann and Bea come back by name.
    const w2 = newWorld();
    const host = await settled(w2, OnlineRoom.host({ ...w2.opts(2), resume: save }));
    expect(host.code).not.toBe(ann.code);
    expect(host.client.seat).toBe(2);
    const others = [];
    for (const i of [0, 1]) {
      others.push(await settled(w2, OnlineRoom.join({ ...w2.opts(i), token: tokenFor(['Ann', 'Bea'][i]!, 'two'), code: host.code })));
    }
    expect(others.map(r => r.client.seat)).toEqual([0, 1]);
    await pump(w2.hub, w2.clock, () => host.hostSession!.room.seats.every(s => s.connected));
    expect(host.hostSession!.room.hold).toBe(true);
    expect(host.hostSession!.room.seq).toBe(savedSeq);

    const lifted = await settled(w2, host.client.resumeGame());
    expect(lifted.ok).toBe(true);
    const all = [host, ...others];
    const stops2 = all.map(r => autoplay(r.client));
    await pump(w2.hub, w2.clock, () => finished(all));
    stops2.forEach(s => s());
    expect(host.hostSession!.room.seq).toBeGreaterThan(savedSeq);
    expect(host.hostSession!.room.game!.seed).toBe(save.room.game!.seed);
  }, 120_000);
});

describe('online room edges', () => {
  it('a join to an unknown code rejects with no-room; a full room rejects and leaves nothing behind', async () => {
    const w = newWorld();
    const missing = await settled(w, OnlineRoom.join({ ...w.opts(1), code: 'ZZZZZ' }).catch((e: unknown) => e));
    expect(missing).toBeInstanceOf(JoinError);
    expect((missing as JoinError).kind).toBe('no-room');
    expect(await OnlineRoom.join({ ...w.opts(1), code: 'nope' }).catch((e: unknown) => (e as JoinError).kind)).toBe('no-room');

    const host = await settled(w, OnlineRoom.host(w.opts(0)));
    await settled(w, host.client.configure({ playerCount: 2 }));
    await settled(w, OnlineRoom.join({ ...w.opts(1), code: host.code }));
    const full = await settled(w, OnlineRoom.join({ ...w.opts(2), code: host.code }).catch((e: unknown) => e));
    expect(full).toBeInstanceOf(JoinError);
    expect((full as JoinError).message).toMatch(/full/);
    await pump(w.hub, w.clock, () => w.hub.links().length === 1);
  });

  it('a fixed code that is taken is refused; without a code a fresh one is used', async () => {
    const w = newWorld();
    const a = await settled(w, OnlineRoom.host({ ...w.opts(0), code: 'kqmtv' }));
    expect(a.code).toBe('KQMTV');
    const err = await settled(w, OnlineRoom.host({ ...w.opts(1), code: 'KQMTV' }).catch((e: unknown) => e));
    expect((err as JoinError).kind).toBe('code-taken');
    const b = await settled(w, OnlineRoom.host(w.opts(1)));
    expect(b.code).toMatch(/^[A-HJ-NP-Z]{5}$/);
    expect(b.code).not.toBe('KQMTV');
  });

  it('a kicked player stops for good: status closed, no reconnect attempts', async () => {
    const w = await playingTable(3, { awayPolicy: 'wait' });
    const [ann, , cy] = w.rooms as [OnlineRoom, OnlineRoom, OnlineRoom];
    const h = history(cy);
    const res = await settled(w, ann.client.kick(2));
    expect(res.ok).toBe(true);
    await pump(w.hub, w.clock, () => cy.status === 'closed');
    expect(cy.closedWhy).toBe('kicked');
    await pump(w.hub, w.clock, () => w.clock.pending === 0 && w.hub.inFlight === 0);
    expect(h).toEqual(['online', 'closed']);
  });

  it('a host that leaves on purpose hands the game to the next player', async () => {
    const w = await playingTable(3, { awayPolicy: 'bot', awayGraceMs: 1000 });
    const [ann, bea, cy] = w.rooms as [OnlineRoom, OnlineRoom, OnlineRoom];
    const stops = w.rooms.map(r => autoplay(r.client));
    await pump(w.hub, w.clock, () => ann.hostSession!.room.seq >= 15);
    stops[0]!();
    ann.leave();
    expect(ann.status).toBe('closed');
    await pump(w.hub, w.clock, () => bea.role === 'host' && cy.status === 'online' && cy.client.status === 'joined');
    await pump(w.hub, w.clock, () => finished([bea, cy]));
    stops.forEach(s => s());
  }, 120_000);

  // Regression: this once failed in the session layer (a returning player was refused as 'full'
  // after a hand-over in the lobby, because lobby joiners were only given open seats).
  it('a host that leaves in the lobby hands it over, and the others keep their seats', async () => {
    const w = newWorld();
    const ann = await settled(w, OnlineRoom.host(w.opts(0)));
    await settled(w, ann.client.configure({ playerCount: 3 }));
    const bea = await settled(w, OnlineRoom.join({ ...w.opts(1), code: ann.code }));
    const cy = await settled(w, OnlineRoom.join({ ...w.opts(2), code: ann.code }));
    ann.leave();
    await pump(w.hub, w.clock, () => bea.role === 'host' && cy.status === 'online' && cy.client.status === 'joined');
    expect(cy.client.seat).toBe(2);
    const seats = bea.hostSession!.room.seats;
    expect(seats.slice(1).map(s => [s.kind, s.name])).toEqual([['human', 'Bea'], ['human', 'Cy']]);
    expect(seats[2]!.connected).toBe(true);
  });
});
