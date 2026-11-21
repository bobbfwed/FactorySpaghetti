import { describe, it, expect } from 'vitest';
import { chooseAction as greedy } from '../../bots/greedyBot';
import type { HostSession } from '../hostSession';
import { ClientSession, chooseSuccessor, promoteToHost } from '../clientSession';
import type { RoomSettings } from '../room';
import { activeSeat } from '../room';
import { memoryPair } from '../memoryConn';
import { ManualScheduler, driveHumans, join, newLobby, rejoin, settle } from './helpers';
import type { Joined, Lobby } from './helpers';

const QUIET = { factoryOpTimeoutMs: 0, roundEndTimeoutMs: 0, botDelayMs: 0 };

async function startGame(settings: Partial<RoomSettings>, others: string[]): Promise<Lobby & { players: Joined[] }> {
  const lobby = await newLobby({ settings: { playerCount: (others.length + 1) as 2 | 3, ...QUIET, ...settings } });
  const players = others.map(name => join(lobby.host, name, `tok-${name.toLowerCase()}`));
  await settle();
  await lobby.me.setReady(true);
  for (const p of players) await p.client.setReady(true);
  expect((await lobby.me.start()).ok).toBe(true);
  return { ...lobby, players };
}

describe('a player leaving during play', () => {
  it('marks the seat away, and a bot plays it after the grace period', async () => {
    const { host, sched, players: [bea] } = await startGame({ awayPolicy: 'bot', awayGraceMs: 5000 }, ['Bea']);
    const t = sched.now();
    bea!.clientEnd.close();
    await settle();
    expect(host.room.seats[1]).toMatchObject({ connected: false, awaySince: t, autopilot: false });

    await sched.advance(4999);
    expect(host.room.seats[1]!.autopilot).toBe(false);
    await sched.advance(1);
    expect(host.room.seats[1]).toMatchObject({ autopilot: true, botId: 'greedy', connected: false });
    // The stand-in bot plays whenever seat 1 must act, so the game now waits only on Ann.
    const g = host.room.game!;
    expect(activeSeat(g) === 0 || g.pendingFactoryOps.some(e => e.ownerId === 0)).toBe(true);
  });

  it('keeps waiting under the "wait" policy', async () => {
    const { host, sched, players: [bea] } = await startGame({ awayPolicy: 'wait', awayGraceMs: 5000 }, ['Bea']);
    bea!.clientEnd.close();
    await settle();
    await sched.advance(60_000);
    expect(host.room.seats[1]).toMatchObject({ connected: false, autopilot: false });
  });

  it('gives the seat back on return, by token and by name', async () => {
    const { host, sched, players: [bea] } = await startGame({ awayPolicy: 'bot', awayGraceMs: 1000 }, ['Bea']);
    bea!.clientEnd.close();
    await settle();
    await sched.advance(1000);
    expect(host.room.seats[1]!.autopilot).toBe(true);

    const back = rejoin(host, bea!); // same token
    await settle();
    expect(back.client.seat).toBe(1);
    expect(host.room.seats[1]).toMatchObject({ connected: true, awaySince: null, autopilot: false, botId: null });
    expect(host.room.log.some(e => e.text === 'Bea is back.')).toBe(true);

    back.clientEnd.close();
    await settle();
    // A new device: different token, same name (case and spaces ignored).
    const phone = join(host, '  BEA ', 'tok-bea-phone');
    await settle();
    expect(phone.client.seat).toBe(1);
    expect(host.room.seats[1]).toMatchObject({ connected: true, name: 'Bea', autopilot: false });

    // A stranger while every seat is taken is turned away.
    const stranger = join(host, 'Zed', 'tok-zed');
    await settle();
    expect(stranger.client.closedWhy).toBe('full');
  });
});

describe('host take-over', () => {
  it('a successor picked identically by every client continues the same game', async () => {
    const { host, me: ann, sched, players } = await startGame({ awayPolicy: 'bot', awayGraceMs: 30_000 }, ['Bea', 'Cy']);
    const [bea, cy] = players as [Joined, Joined];
    await driveHumans(host, { 0: ann, 1: bea.client, 2: cy.client },
      r => r.seq >= 25 && activeSeat(r.game) === 2 && r.game!.pendingFactoryOps.length === 0);
    const lastRoom = host.room;
    const seq = lastRoom.seq;

    // Cy sends a move that is lost, and then the host disappears without a word.
    cy.clientEnd.dropOutgoing = true;
    const lost = cy.client.act(greedy(lastRoom.game!, 2));
    const lostId = cy.client.pending!.id;
    let lostHost = 0;
    bea.client.onHostLost(() => { lostHost++; });
    cy.client.onHostLost(() => { lostHost++; });
    await settle();
    host.dispose();
    await settle();
    expect(lostHost).toBe(2);
    expect(bea.client.status).toBe('connecting');

    // Every copy of the room names the same successor.
    const picks = [lastRoom, ann.room!, bea.client.room!, cy.client.room!].map(chooseSuccessor);
    expect(new Set(picks)).toEqual(new Set([1]));

    const newHost: HostSession = promoteToHost(bea.client.room!, 1, { hostToken: 'tok-bea', scheduler: sched });
    expect(newHost.room.hostSeat).toBe(1);
    expect(newHost.room.seats[0]).toMatchObject({ connected: false, autopilot: false, awaySince: sched.now() });
    bea.client.reattach(newHost.connectLocal());
    const [hostEnd, clientEnd] = memoryPair();
    newHost.accept(hostEnd);
    cy.client.reattach(clientEnd);
    await settle();

    expect(bea.client.seat).toBe(1);
    expect(cy.client.seat).toBe(2);
    expect(await lost).toEqual({ ok: true });     // re-sent to the new host and applied once
    expect(newHost.room.seq).toBe(seq + 1);        // the counter carries on from the old host
    expect(newHost.room.recent.filter(r => r.id === lostId)).toEqual([{ seat: 2, id: lostId }]);
    expect(bea.client.room).toEqual(newHost.room);
    expect(newHost.room.game!.seed).toBe(lastRoom.game!.seed);

    // Ann (the old host) does not come back: after the grace period a bot plays her seat.
    await sched.advance(30_000);
    expect(newHost.room.seats[0]).toMatchObject({ connected: false, autopilot: true });

    // Play continues on the new host, with the counter carrying on.
    const after = newHost.room.seq;
    await driveHumans(newHost, { 1: bea.client, 2: cy.client }, r => r.seq >= after + 20);
    expect(newHost.room.phase).toBe('playing');

    // The new host takes host-only commands from Bea, not from Cy.
    expect(await cy.client.setAutopilot(0, false)).toMatchObject({ ok: false, error: { code: 'NOT_HOST' } });
    expect((await bea.client.setAutopilot(0, true)).ok).toBe(true);
    newHost.dispose();
  }, 30_000);

  it('a resumed game waits for its players and lets the host assign or replace seats', async () => {
    const { host, me: ann, players } = await startGame({ awayPolicy: 'bot', awayGraceMs: 0 }, ['Bea', 'Cy']);
    await driveHumans(host, { 0: ann, 1: players[0]!.client, 2: players[1]!.client }, r => r.seq >= 10);
    const saved = host.room;
    host.dispose();

    const sched = new ManualScheduler();
    const { HostSession } = await import('../hostSession');
    const h2 = new HostSession({ code: 'AGAIN', hostName: 'Cy', hostToken: 'tok-cy-2', room: saved, mode: 'resume', scheduler: sched });
    expect(h2.room.hostSeat).toBe(2);
    expect(h2.room.seats.every(s => !s.connected && !s.ready)).toBe(true);
    const cy = new ClientSession(h2.connectLocal(), { name: 'Cy', token: 'tok-cy-2' });
    const bea = join(h2, 'bea', 'tok-bea-new');
    const sam = join(h2, 'Sam', 'tok-sam');
    await settle();
    expect(cy.seat).toBe(2);
    expect(bea.client.seat).toBe(1);   // matched by name
    expect(sam.client.seat).toBeNull(); // waiting: Ann's seat is unclaimed
    expect(h2.room.waiting).toEqual([{ id: expect.any(String), name: 'Sam' }]);
    expect(h2.room.hold).toBe(true);

    expect(await bea.client.assign(h2.room.waiting[0]!.id, 0)).toMatchObject({ ok: false, error: { code: 'NOT_HOST' } });
    expect((await cy.assign(h2.room.waiting[0]!.id, 0)).ok).toBe(true);
    await settle();
    expect(sam.client.seat).toBe(0);
    expect(h2.room.seats[0]).toMatchObject({ kind: 'human', name: 'Sam', connected: true });
    expect(h2.room.waiting).toEqual([]);

    sam.clientEnd.close();
    await settle();
    expect((await cy.setSeat(0, 'bot', 'greedy')).ok).toBe(true);
    expect(h2.room.seats[0]).toMatchObject({ kind: 'bot', botId: 'greedy' });

    expect((await cy.resumeGame()).ok).toBe(true);
    expect(h2.room.hold).toBe(false);
    const seq = h2.room.seq;
    await driveHumans(h2, { 1: bea.client, 2: cy }, r => r.seq >= seq + 10);
    h2.dispose();
  }, 30_000);
});
