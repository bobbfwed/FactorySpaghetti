import { describe, it, expect } from 'vitest';
import { lobbyInfo } from '../../app/lobby';
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

    const bea = join(host, 'Bea', 'tok-bea-0123456789').client;
    const bea2 = join(host, ' bea ', 'tok-bea2-0123456789').client;
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
    const bea = join(host, 'Bea', 'tok-bea-0123456789').client;
    await settle();
    expect(host.room.seats[1]!.color).toBe('red');

    const taken = await bea.setColor('blue'); // the host's colour
    expect(taken).toEqual({ ok: false, error: expect.objectContaining({ code: 'COLOR_TAKEN' }) });

    const swapped = await bea.setColor('green'); // held by an open seat: swapped
    expect(swapped.ok).toBe(true);
    expect(host.room.seats.map(s => s.color)).toEqual(['blue', 'green', 'orange', 'red']);
  });

  it('tracks ready flags: a change to the game asks the others again, pacing and timers do not', async () => {
    const { host, me } = await newLobby();
    const bea = join(host, 'Bea', 'tok-bea-0123456789').client;
    await settle();
    expect((await bea.setReady(true)).ok).toBe(true);
    expect((await me.setReady(true)).ok).toBe(true);
    expect(host.room.seats.slice(0, 2).every(s => s.ready)).toBe(true);

    // Timers, the away rule and bot speed do not change the game the players agreed to.
    expect((await me.configure({ factoryOpTimeoutMs: 5000, awayGraceMs: 0, awayPolicy: 'wait' })).ok).toBe(true);
    expect((await me.configure({ botSpeed: 'fast' })).ok).toBe(true);
    expect(host.room.settings.factoryOpTimeoutMs).toBe(5000);
    expect(host.room.seats.slice(0, 2).every(s => s.ready)).toBe(true);

    // The number of players does: Bea is asked again; the host, who changed it, stays ready.
    expect((await me.configure({ playerCount: 3 })).ok).toBe(true);
    expect(host.room.seats[0]!.ready).toBe(true);
    expect(host.room.seats[1]!.ready).toBe(false);
    // Changing the seats (a bot instead of an open seat) asks Bea again too.
    expect((await bea.setReady(true)).ok).toBe(true);
    expect((await me.setSeat(2, 'bot')).ok).toBe(true);
    expect(host.room.seats[0]!.ready).toBe(true);
    expect(host.room.seats[1]!.ready).toBe(false);
  });

  it('a host alone with bots can always start, ready or not; bots are always ready', async () => {
    const { host, me } = await newLobby({ settings: { playerCount: 3, botDelayMs: 0 } });
    expect((await me.setSeat(1, 'bot')).ok).toBe(true);
    expect((await me.setSeat(2, 'bot')).ok).toBe(true);
    expect(host.room.seats[0]!.ready).toBe(false);
    expect(lobbyInfo(host.room, 0).canStart).toBe(true);
    expect((await me.start()).ok).toBe(true);
    expect(host.room.phase).toBe('playing');
    // The log says who goes first, and that a roll decided it.
    const first = host.room.game!.turnOrder[0]!;
    expect(host.room.log[1]!.text).toBe(`${host.room.seats[first]!.name} goes first: a roll of the dice decided the order of play.`);
    host.dispose();
  });

  it('starts only when no seat is open and every connected human is ready', async () => {
    const { host, me } = await newLobby({ settings: { playerCount: 3, botDelayMs: 0 } });
    const bea = join(host, 'Bea', 'tok-bea-0123456789').client;
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
    const bea = join(host, 'Bea', 'tok-bea-0123456789').client;
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
    const { host, me, sched } = await newLobby();
    join(host, 'Bea', 'tok-bea-0123456789');
    join(host, 'Cy', 'tok-cy-0123456789');
    await settle();
    await me.setSeat(3, 'bot');
    const fifth = join(host, 'Dee', 'tok-dee-0123456789').client;
    await settle();
    expect(fifth.status).toBe('closed');
    expect(fifth.closedWhy).toBe('full');

    const [hostEnd, clientEnd] = memoryPair();
    host.accept(hostEnd);
    const got: HostMsg[] = [];
    clientEnd.onmessage = (m): void => { got.push(m as HostMsg); };
    clientEnd.send({ t: 'hello', v: PROTOCOL + 1, name: 'Old', token: 'tok-old-0123456789' });
    await settle();
    expect(got).toEqual([{ t: 'closed', why: 'version' }]);
    expect(clientEnd.open).toBe(true);           // the close follows shortly, so the message gets out first
    await sched.advance(50);
    expect(clientEnd.open).toBe(false);
  });

  it('turns away a hello with an unusable token or name', async () => {
    const { host, sched } = await newLobby();
    for (const [name, token] of [
      ['Bea', 'short'],
      ['Bea', 'x'.repeat(65)],
      ['   ', 'tok-blank-0123456789'],
      ['\u0007\u0001', 'tok-ctrl-0123456789'],
      ['A'.repeat(21), 'tok-long-0123456789'],
    ]) {
      const j = join(host, name!, token!);
      await settle();
      expect(j.client.closedWhy).toBe('invalid');
    }
    const ok = join(host, ' Bea\u0007  Bee ', 'tok-bea-0123456789');
    await settle();
    expect(host.room.seats[ok.client.seat!]!.name).toBe('Bea Bee');
    await sched.advance(50);
  });

  it('changes the player count, but never removes a seated player', async () => {
    const { host, me } = await newLobby();
    join(host, 'Bea', 'tok-bea-0123456789');
    const cy = join(host, 'Cy', 'tok-cy-0123456789');
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

  it('the host can leave the lobby and come back, still the host', async () => {
    const host = new HostSession({ code: 'KQMTV', hostName: 'Ann', hostToken: 'tok-ann-0123456789', scheduler: new ManualScheduler() });
    const ann = join(host, 'Ann', 'tok-ann-0123456789');
    await settle();
    expect(ann.client.seat).toBe(0);
    ann.clientEnd.close();                       // the host player drops out of the lobby
    await settle();
    expect(host.room.seats[0]).toMatchObject({ kind: 'human', name: 'Ann', connected: false });
    const bea = join(host, 'Bea', 'tok-bea-0123456789');
    const fakeAnn = join(host, 'Ann', 'tok-other-ann-0123456789'); // same name, different token
    await settle();
    expect(bea.client.seat).toBe(1);             // the host's seat is not handed out
    expect(fakeAnn.client.seat).toBe(2);         // nor claimed by name
    expect(host.room.seats[2]!.name).toBe('Ann 2');
    const back = join(host, 'Ann', 'tok-ann-0123456789');
    await settle();
    expect(back.client.seat).toBe(0);
    expect(host.room.hostSeat).toBe(0);
    expect((await back.client.configure({ botDelayMs: 0 })).ok).toBe(true);
    expect(await bea.client.configure({ botDelayMs: 1 })).toMatchObject({ ok: false, error: { code: 'NOT_HOST' } });
  });

  it('clamps settings to sensible ranges and rejects unusable values', async () => {
    const { host, me } = await newLobby();
    expect(await me.configure({ factoryOpTimeoutMs: 999_999, roundEndTimeoutMs: -5, awayGraceMs: 1e12, botDelayMs: 60_000 })).toEqual({ ok: true });
    expect(host.room.settings).toMatchObject({ factoryOpTimeoutMs: 120_000, roundEndTimeoutMs: 0, awayGraceMs: 3_600_000, botDelayMs: 5_000 });
    for (const bad of [{ botDelayMs: NaN }, { awayGraceMs: '10' as unknown as number }, { awayPolicy: 'never' as 'bot' }]) {
      expect(await me.configure(bad)).toMatchObject({ ok: false, error: { code: 'BAD_SETTINGS' } });
    }
    expect(host.room.settings.botDelayMs).toBe(5_000);
  });

  it('refuses moves before the game starts', async () => {
    const { me } = await newLobby();
    expect(await me.act({ type: 'END_TURN' })).toMatchObject({ ok: false, error: { code: 'NOT_PLAYING' } });
  });
});
