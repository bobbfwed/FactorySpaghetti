import { describe, it, expect } from 'vitest';
import { PROTOCOL } from '../protocol';
import type { HostMsg } from '../protocol';
import { memoryPair } from '../memoryConn';
import { HostSession } from '../hostSession';
import { ManualScheduler, join, newLobby, settle } from './helpers';

describe('lobby', () => {
  it('seats joiners in the first open seat and de-duplicates names', async () => {
    const { host, me } = await newLobby();
    expect(me.status).toBe('joined');
    expect(me.seat).toBe(0);
    expect(host.room.seats[0]).toMatchObject({ kind: 'human', name: 'Ann', connected: true });

    const bea = join(host, 'Bea', 'tok-bea').client;
    const bea2 = join(host, ' bea ', 'tok-bea2').client;
    await settle();
    expect(bea.seat).toBe(1);
    expect(bea2.seat).toBe(2);
    expect(host.room.seats[1]!.name).toBe('Bea');
    expect(host.room.seats[2]!.name).toBe('bea 2');
    // Every client holds the same room.
    expect(bea.room).toEqual(host.room);
    expect(me.room).toEqual(host.room);
  });

  it('lets players pick a colour no other player uses', async () => {
    const { host } = await newLobby();
    const bea = join(host, 'Bea', 'tok-bea').client;
    await settle();
    expect(host.room.seats[1]!.color).toBe('red');

    const taken = await bea.setColor('blue'); // the host's colour
    expect(taken).toEqual({ ok: false, error: expect.objectContaining({ code: 'COLOR_TAKEN' }) });

    const swapped = await bea.setColor('green'); // held by an open seat: swapped
    expect(swapped.ok).toBe(true);
    expect(host.room.seats.map(s => s.color)).toEqual(['blue', 'green', 'orange', 'red']);
  });

  it('tracks ready flags, and a settings change clears them', async () => {
    const { host, me } = await newLobby();
    const bea = join(host, 'Bea', 'tok-bea').client;
    await settle();
    expect((await bea.setReady(true)).ok).toBe(true);
    expect((await me.setReady(true)).ok).toBe(true);
    expect(host.room.seats.slice(0, 2).every(s => s.ready)).toBe(true);

    expect((await me.configure({ factoryOpTimeoutMs: 5000 })).ok).toBe(true);
    expect(host.room.settings.factoryOpTimeoutMs).toBe(5000);
    expect(host.room.seats.some(s => s.ready)).toBe(false);
  });

  it('starts only when no seat is open and every connected human is ready', async () => {
    const { host, me } = await newLobby({ settings: { playerCount: 3, botDelayMs: 0 } });
    const bea = join(host, 'Bea', 'tok-bea').client;
    await settle();

    expect(await me.start()).toMatchObject({ ok: false, error: { code: 'SEATS_OPEN' } });
    expect((await me.setSeat(2, 'bot', 'random')).ok).toBe(true);
    expect(host.room.seats[2]).toMatchObject({ kind: 'bot', botId: 'random', name: 'Random Bot' });

    expect(await me.start()).toMatchObject({ ok: false, error: { code: 'NOT_READY' } });
    await me.setReady(true);
    expect(await me.start()).toMatchObject({ ok: false, error: { code: 'NOT_READY' } });
    await bea.setReady(true);

    expect(await me.start()).toEqual({ ok: true });
    expect(host.room.phase).toBe('playing');
    expect(host.room.game?.seed).toBe(4242);
    expect(host.room.game?.playerCount).toBe(3);
    expect(bea.room?.phase).toBe('playing');
  });

  it('refuses host-only commands from anyone else', async () => {
    const { host } = await newLobby();
    const bea = join(host, 'Bea', 'tok-bea').client;
    await settle();
    for (const res of [
      await bea.configure({ playerCount: 2 }),
      await bea.setSeat(3, 'bot'),
      await bea.start(),
      await bea.kick(0),
      await bea.setAutopilot(1, true),
    ]) {
      expect(res).toMatchObject({ ok: false, error: { code: 'NOT_HOST' } });
    }
    expect(host.room.settings.playerCount).toBe(4);
    expect(host.room.seats[3]!.kind).toBe('open');
  });

  it('turns away a fifth joiner and a client with the wrong protocol version', async () => {
    const { host, me } = await newLobby();
    join(host, 'Bea', 'tok-bea');
    join(host, 'Cy', 'tok-cy');
    await settle();
    await me.setSeat(3, 'bot');
    const fifth = join(host, 'Dee', 'tok-dee').client;
    await settle();
    expect(fifth.status).toBe('closed');
    expect(fifth.closedWhy).toBe('full');

    const [hostEnd, clientEnd] = memoryPair();
    host.accept(hostEnd);
    const got: HostMsg[] = [];
    clientEnd.onmessage = (m): void => { got.push(m as HostMsg); };
    clientEnd.send({ t: 'hello', v: PROTOCOL + 1, name: 'Old', token: 'tok-old' });
    await settle();
    expect(got).toEqual([{ t: 'closed', why: 'version' }]);
    expect(clientEnd.open).toBe(false);
  });

  it('changes the player count, but never removes a seated player', async () => {
    const { host, me } = await newLobby();
    join(host, 'Bea', 'tok-bea');
    const cy = join(host, 'Cy', 'tok-cy');
    await settle();
    expect(await me.configure({ playerCount: 2 })).toMatchObject({ ok: false, error: { code: 'SEAT_OCCUPIED' } });

    cy.clientEnd.close(); // Cy leaves: in the lobby the seat simply opens again
    await settle();
    expect(host.room.seats[2]).toMatchObject({ kind: 'open', name: '', connected: false });

    expect((await me.configure({ playerCount: 2 })).ok).toBe(true);
    expect(host.room.seats).toHaveLength(2);
    expect((await me.configure({ playerCount: 3 })).ok).toBe(true);
    expect(host.room.seats.map(s => s.kind)).toEqual(['human', 'human', 'open']);
    expect(new Set(host.room.seats.map(s => s.color)).size).toBe(3);
    expect(await me.configure({ playerCount: 5 as 4 })).toMatchObject({ ok: false, error: { code: 'BAD_SETTINGS' } });
  });

  it('a returning token never takes a seat someone else now holds', async () => {
    const host = new HostSession({ code: 'KQMTV', hostName: 'Ann', hostToken: 'tok-ann', scheduler: new ManualScheduler() });
    const ann = join(host, 'Ann', 'tok-ann');
    await settle();
    expect(ann.client.seat).toBe(0);
    ann.clientEnd.close();                       // the host player drops out of the lobby
    await settle();
    expect(host.room.seats[0]!.kind).toBe('open');
    const bea = join(host, 'Bea', 'tok-bea');
    await settle();
    expect(bea.client.seat).toBe(0);             // the freed seat went to Bea
    const back = join(host, 'Ann', 'tok-ann');   // the host token still points at seat 0, now Bea's
    await settle();
    expect(back.client.seat).toBe(1);
    expect(host.room.seats[0]).toMatchObject({ name: 'Bea', connected: true });
  });

  it('refuses moves before the game starts', async () => {
    const { me } = await newLobby();
    expect(await me.act({ type: 'END_TURN' })).toMatchObject({ ok: false, error: { code: 'NOT_PLAYING' } });
  });
});
