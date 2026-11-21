// Who gets which seat: across a host change, in the lobby, after a kick, on a second device.

import { describe, it, expect } from 'vitest';
import { HostSession, SessionError } from '../hostSession';
import { ClientSession, chooseSuccessor, promoteToHost } from '../clientSession';
import type { RoomSettings } from '../room';
import { memoryPair } from '../memoryConn';
import { ManualScheduler, join, newLobby, rejoin, settle } from './helpers';
import type { Joined, Lobby } from './helpers';

const QUIET: Partial<RoomSettings> = { factoryOpTimeoutMs: 0, roundEndTimeoutMs: 0, botDelayMs: 0, awayGraceMs: 60_000 };
const tok = (name: string): string => `tok-${name.toLowerCase().replace(/\s/g, '')}-0123456789`;

/** Ann hosts; the others join in order. Started unless `start` is false. */
async function table(others: string[], start = true): Promise<Lobby & { p: Joined[] }> {
  const lobby = await newLobby({ settings: { playerCount: (others.length + 1) as 2 | 3 | 4, ...QUIET } });
  const p: Joined[] = [];
  for (const name of others) { p.push(join(lobby.host, name, tok(`${name}${p.length}`))); await settle(); }
  if (start) {
    await lobby.me.setReady(true);
    for (const j of p) await j.client.setReady(true);
    expect(await lobby.me.start()).toEqual({ ok: true });
    await lobby.sched.flushDue();
  }
  return { ...lobby, p };
}

function reconnect(host: HostSession, j: Joined): void {
  const [hostEnd, clientEnd] = memoryPair();
  host.accept(hostEnd);
  j.client.reattach(clientEnd);
}

describe('after a host change', () => {
  for (const order of ['Bea first', 'Bea 2 first']) {
    it(`players named "Bea" and "Bea 2" both get their own seats back (${order})`, async () => {
      const { host, sched, p } = await table(['Cy', 'Bea', 'Bea']);
      const [cy, bea, bea2] = p as [Joined, Joined, Joined];
      expect(host.room.seats.map(s => s.name)).toEqual(['Ann', 'Cy', 'Bea', 'Bea 2']);
      const last = cy.client.room!;
      host.dispose();
      await settle();
      expect(chooseSuccessor(last)).toBe(1);
      const nh = promoteToHost(last, 1, { hostToken: tok('cy0'), scheduler: sched });
      cy.client.reattach(nh.connectLocal());
      for (const j of order === 'Bea first' ? [bea, bea2] : [bea2, bea]) { reconnect(nh, j); await settle(); }
      expect(bea.client.seat).toBe(2);
      expect(bea2.client.seat).toBe(3);
      expect(nh.room.waiting).toEqual([]);
      expect(nh.room.seats.slice(1).every(s => s.connected)).toBe(true);
      nh.dispose();
    });
  }

  it('a take-over keeps a held game held, with no away timers', async () => {
    const { host, p, me } = await table(['Bea']);
    const saved = host.room;
    host.dispose();
    const sched = new ManualScheduler();
    const resumed = new HostSession({ code: 'HELDX', hostName: 'Ann', hostToken: tok('ann-2'), room: saved, mode: 'resume', scheduler: sched });
    expect(resumed.room.hold).toBe(true);
    const nh = promoteToHost(resumed.room, 1, { hostToken: tok('bea0'), scheduler: sched });
    resumed.dispose();
    expect(nh.room.hold).toBe(true);
    expect(sched.pending).toBe(0);
    const bea = p[0]!;
    bea.client.reattach(nh.connectLocal());
    await settle();
    expect(await bea.client.act({ type: 'END_TURN' })).toMatchObject({ ok: false, error: { code: 'ON_HOLD' } });
    expect(me.status).not.toBe('joined');
    nh.dispose();
  });
});

describe('a host change in the lobby', () => {
  async function lobbyTakeover(): Promise<{ nh: HostSession; ann: ClientSession; bea: Joined; cy: Joined; sched: ManualScheduler }> {
    const { host, me: ann, sched, p } = await table(['Bea', 'Cy'], false);
    const [bea, cy] = p as [Joined, Joined];
    for (const c of [ann, bea.client, cy.client]) await c.setReady(true);
    const last = bea.client.room!;
    host.dispose();
    await settle();
    const nh = promoteToHost(last, 1, { hostToken: tok('bea0'), scheduler: sched, randomSeed: (): number => 9 });
    bea.client.reattach(nh.connectLocal());
    reconnect(nh, cy);
    await settle();
    expect(bea.client.seat).toBe(1);
    expect(cy.client.seat).toBe(2);
    expect(nh.room.phase).toBe('lobby');
    expect(nh.room.seats[0]).toMatchObject({ kind: 'human', name: 'Ann', connected: false });
    return { nh, ann, bea, cy, sched };
  }

  it('everyone returns to their seat, and start waits for absent players', async () => {
    const { nh, ann, bea, cy } = await lobbyTakeover();
    expect(await bea.client.start()).toMatchObject({ ok: false, error: { code: 'SEATS_ABSENT' } });
    reconnect(nh, { client: ann } as Joined); // the old host comes back as a player
    await settle();
    expect(ann.seat).toBe(0);
    for (const c of [ann, bea.client, cy.client]) expect((await c.setReady(true)).ok).toBe(true);
    expect(await bea.client.start()).toEqual({ ok: true });
    expect(nh.room.phase).toBe('playing');
    nh.dispose();
  });

  it('the new host can open or fill an absent player\'s seat', async () => {
    const { nh, bea, cy } = await lobbyTakeover();
    expect(await cy.client.setSeat(0, 'bot')).toMatchObject({ ok: false, error: { code: 'NOT_HOST' } });
    expect(await bea.client.setSeat(0, 'bot', 'greedy')).toEqual({ ok: true });
    for (const c of [bea.client, cy.client]) await c.setReady(true);
    expect(await bea.client.start()).toEqual({ ok: true });
    nh.dispose();
  });
});

describe('resuming a save', () => {
  it('needs to know which seat is the host\'s', async () => {
    const { host } = await table(['Bea']);
    const saved = host.room;
    host.dispose();
    let thrown: unknown = null;
    try {
      new HostSession({ code: 'NEWRM', hostName: 'Zed', hostToken: tok('zed'), room: saved, mode: 'resume' });
    } catch (e) { thrown = e; }
    expect(thrown).toBeInstanceOf(SessionError);
    expect((thrown as SessionError).code).toBe('SEAT_REQUIRED');

    const h = new HostSession({ code: 'NEWRM', hostName: 'Zed', hostToken: tok('zed'), room: saved, mode: 'resume', hostSeat: 1, scheduler: new ManualScheduler() });
    expect(h.room.hostSeat).toBe(1);
    expect(h.room.seats[1]!.name).toBe('Zed');
    h.dispose();
  });
});

describe('connections and seats', () => {
  it('a second connection with the same token replaces the first, which is told why', async () => {
    const { host, sched } = await newLobby();
    const first = join(host, 'Bea', tok('bea'));
    await settle();
    let lost = 0;
    first.client.onHostLost(() => { lost++; });
    const second = join(host, 'Bea', tok('bea'));
    await settle();
    await sched.advance(50);
    expect(second.client.seat).toBe(1);
    expect(first.client.status).toBe('closed');
    expect(first.client.closedWhy).toBe('replaced');
    expect(first.clientEnd.open).toBe(false);
    expect(lost).toBe(0);
    expect(host.room.seats[1]).toMatchObject({ name: 'Bea', connected: true });
  });

  it('a kicked player\'s seat goes to a bot and stays locked until the host assigns it', async () => {
    const { host, me, sched, p } = await table(['Bea', 'Cy']);
    const bea = p[0]!;
    expect(await me.kick(1)).toEqual({ ok: true });
    await sched.advance(50);
    expect(bea.client.closedWhy).toBe('kicked');
    expect(host.room.seats[1]).toMatchObject({ connected: false, autopilot: true, botId: 'greedy' });

    const sameToken = join(host, 'Bea', tok('bea0'));
    await settle();
    expect(sameToken.client.closedWhy).toBe('kicked');
    const byName = join(host, 'Bea', tok('bea-phone'));
    await settle();
    expect(byName.client.seat).toBeNull(); // the name no longer reclaims the seat
    expect(host.room.waiting).toEqual([{ id: expect.any(String), name: 'Bea 2' }]);

    expect(await me.assign(host.room.waiting[0]!.id, 1)).toEqual({ ok: true });
    await settle();
    expect(byName.client.seat).toBe(1);
    expect(host.room.seats[1]).toMatchObject({ connected: true, autopilot: false, name: 'Bea 2' });
    await sched.advance(50);
    host.dispose();
  });

  it('a player may switch off their own autopilot, but not switch it on or touch other seats', async () => {
    const { host, me, p } = await table(['Bea', 'Cy']);
    const bea = p[0]!.client;
    expect(await me.setAutopilot(1, true)).toEqual({ ok: true });
    expect(await bea.setAutopilot(1, true)).toMatchObject({ ok: false, error: { code: 'NOT_HOST' } });
    expect(await bea.setAutopilot(2, false)).toMatchObject({ ok: false, error: { code: 'NOT_HOST' } });
    // (With instant bots, Bea's stand-in may already have played; she takes the seat back now.)
    expect(await bea.setAutopilot(1, false)).toEqual({ ok: true });
    expect(host.room.seats[1]).toMatchObject({ autopilot: false, botId: null });
    host.dispose();
  });

  it('someone waiting under a seat\'s name takes it when that seat\'s old connection drops', async () => {
    const { host, p, sched } = await table(['Bea', 'Cy']);
    const [bea, cy] = p as [Joined, Joined];
    cy.clientEnd.close(); // an away seat exists, so newcomers wait instead of being turned away
    await settle();
    const phone = join(host, 'Bea', tok('bea-phone'));
    await settle();
    expect(phone.client.seat).toBeNull();
    bea.clientEnd.close(); // the old laptop finally drops
    await settle();
    expect(phone.client.seat).toBe(1);
    expect(host.room.waiting).toEqual([]);
    expect(host.room.seats[1]).toMatchObject({ name: 'Bea', connected: true });
    // Cy can still come back to seat 2.
    const back = rejoin(host, cy);
    await settle();
    expect(back.client.seat).toBe(2);
    await sched.advance(50);
    host.dispose();
  });
});
