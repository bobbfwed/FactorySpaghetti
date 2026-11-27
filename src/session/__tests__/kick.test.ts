// The host removes a player ("kick"): during a game a bot plays the seat at once (skipping the
// away countdown) until the player comes back; in the lobby the seat opens. It is never a ban.

import { describe, it, expect } from 'vitest';
import type { GameState } from '../../engine/state';
import { HostSession } from '../hostSession';
import { ClientSession } from '../clientSession';
import type { RoomSettings } from '../room';
import { activeSeat } from '../room';
import { driveHumans, join, newLobby, rejoin, settle } from './helpers';
import type { Joined, Lobby } from './helpers';

const QUIET: Partial<RoomSettings> = { factoryOpTimeoutMs: 0, roundEndTimeoutMs: 0, botDelayMs: 0 };
const BEA = 'tok-bea-0123456789';
const removedNote = 'Bea was removed by the host; a bot plays their seat.';

/** Ann hosts, Bea joins, seat 2 is a bot; the game is started. */
async function table(settings: Partial<RoomSettings> = {}): Promise<Lobby & { bea: Joined }> {
  const lobby = await newLobby({ settings: { playerCount: 3, ...QUIET, awayPolicy: 'bot', awayGraceMs: 60_000, ...settings } });
  const bea = join(lobby.host, 'Bea', BEA);
  await settle();
  expect(await lobby.me.setSeat(2, 'bot', 'greedy')).toEqual({ ok: true });
  await lobby.me.setReady(true);
  await bea.client.setReady(true);
  expect(await lobby.me.start()).toEqual({ ok: true });
  await lobby.sched.flushDue();
  return { ...lobby, bea };
}

/** Who the game waits on: the owner of the first owed choice, else the active player. */
function waitingOn(g: GameState): number | null {
  return g.pendingFactoryOps[0]?.ownerId ?? activeSeat(g);
}

/** Play the people's seats until it is Bea's own turn with no choices owed. */
async function untilBeasTurn(l: Lobby & { bea: Joined }): Promise<void> {
  await driveHumans(l.host, { 0: l.me, 1: l.bea.client },
    r => activeSeat(r.game) === 1 && r.game!.pendingFactoryOps.length === 0, 5000, l.sched);
}

describe('removing a player during a game', () => {
  it('during the away countdown: a bot takes the seat at once, and the old timer never fires', async () => {
    const l = await table();
    const { host, me, sched, bea } = l;
    bea.clientEnd.close();
    await settle();
    const away = host.room.seats[1]!;
    expect(away).toMatchObject({ connected: false, autopilot: false });
    expect(away.awaySince).not.toBeNull();

    expect(await me.kick(1)).toEqual({ ok: true });
    expect(host.room.seats[1]).toMatchObject({ connected: false, awaySince: away.awaySince, autopilot: true, botId: 'greedy' });
    expect(host.room.log.some(e => e.text === removedNote)).toBe(true);

    // The countdown that was running is gone: nothing more happens to the seat when it would end.
    await sched.advance(60_000);
    expect(host.room.log.some(e => e.text.startsWith('A bot plays for Bea'))).toBe(false);
    expect(host.room.seats[1]).toMatchObject({ autopilot: true, botId: 'greedy' });

    // Bea's device was only disconnected (it never heard it was removed): it reconnects and plays again.
    const back = rejoin(host, bea);
    await settle();
    expect(back.client.seat).toBe(1);
    expect(host.room.seats[1]).toMatchObject({ connected: true, awaySince: null, autopilot: false, botId: null });
    expect(host.room.log.at(-1)!.text).toBe('Bea is back.');
    host.dispose();
  });

  it('a connected player is disconnected with "kicked", and the bot plays their turn straight away', async () => {
    const l = await table();
    const { host, me, sched, bea } = l;
    await untilBeasTurn(l);
    const seq = host.room.seq;

    expect(await me.kick(1)).toEqual({ ok: true });
    await sched.advance(50);
    expect(bea.client.status).toBe('closed');
    expect(bea.client.closedWhy).toBe('kicked');
    expect(bea.clientEnd.open).toBe(false);
    expect(host.room.seats[1]).toMatchObject({ connected: false, autopilot: true, botId: 'greedy' });
    expect(host.room.seats[1]!.awaySince).not.toBeNull();
    // The stand-in played Bea's turn: moves were made for seat 1 and the turn moved on.
    expect(host.room.seq).toBeGreaterThan(seq);
    expect(host.room.log.some(e => e.seq > seq && e.seat === 1 && e.text !== removedNote)).toBe(true);
    expect(waitingOn(host.room.game!)).toBe(0); // the bots have played; only Ann is left to act
    host.dispose();
  });

  it('the removed player joins again from the same device and gets the seat back', async () => {
    const { host, me, sched, bea } = await table();
    expect(await me.kick(1)).toEqual({ ok: true });
    await sched.advance(50);
    expect(bea.client.closedWhy).toBe('kicked');

    const again = join(host, 'Bea', BEA);
    await settle();
    expect(again.client.closedWhy).toBeNull();
    expect(again.client.seat).toBe(1);
    expect(host.room.seats[1]).toMatchObject({ name: 'Bea', connected: true, awaySince: null, autopilot: false, botId: null });
    expect(host.room.log.at(-1)!.text).toBe('Bea is back.');
    host.dispose();
  });

  it('the removed player can also come back by name from another device', async () => {
    const { host, me, sched } = await table();
    expect(await me.kick(1)).toEqual({ ok: true });
    await sched.advance(50);

    const phone = join(host, 'bea', 'tok-bea-phone-0123456789');
    await settle();
    expect(phone.client.seat).toBe(1);
    expect(host.room.seats[1]).toMatchObject({ name: 'Bea', connected: true, autopilot: false, botId: null });
    host.dispose();
  });

  it('works under the "wait" away rule too', async () => {
    const { host, me, sched, bea } = await table({ awayPolicy: 'wait' });
    bea.clientEnd.close();
    await settle();
    await sched.advance(120_000);
    expect(host.room.seats[1]).toMatchObject({ connected: false, autopilot: false }); // the game waits for Bea

    expect(await me.kick(1)).toEqual({ ok: true });
    await sched.flushDue();
    expect(host.room.seats[1]).toMatchObject({ connected: false, autopilot: true, botId: 'greedy' });
    // The game no longer waits on Bea: whatever is owed now is owed by Ann.
    expect(waitingOn(host.room.game!)).toBe(0);
    host.dispose();
  });

  it('while a resumed game is on hold, the bot waits for the host to continue', async () => {
    const { host, sched, bea } = await table();
    const saved = host.room;
    host.dispose();
    await settle();
    const h2 = new HostSession({ code: 'AGAIN', hostName: 'Ann', hostToken: 'tok-ann-2-0123456789', room: saved, mode: 'resume', scheduler: sched });
    const ann = new ClientSession(h2.connectLocal(), { name: 'Ann', token: 'tok-ann-2-0123456789' });
    rejoin(h2, bea);
    await settle();
    expect(bea.client.seat).toBe(1);
    expect(h2.room.hold).toBe(true);
    const seq = h2.room.seq;

    expect(await ann.kick(1)).toEqual({ ok: true });
    await sched.advance(50);
    expect(bea.client.closedWhy).toBe('kicked');
    expect(h2.room.seats[1]).toMatchObject({ connected: false, autopilot: true });
    expect(h2.room.seq).toBe(seq);
    expect(await ann.resumeGame()).toEqual({ ok: true });
    expect(h2.room.seats[1]).toMatchObject({ autopilot: true });
    h2.dispose();
  });

  it('is refused from anyone but the host, and for the host\'s own seat or a bot seat', async () => {
    const { host, me, bea } = await table();
    expect(await bea.client.kick(0)).toMatchObject({ ok: false, error: { code: 'NOT_HOST' } });
    expect(await bea.client.kick(1)).toMatchObject({ ok: false, error: { code: 'NOT_HOST' } });
    expect(await me.kick(0)).toMatchObject({ ok: false, error: { code: 'BAD_SEAT' } });
    expect(await me.kick(2)).toMatchObject({ ok: false, error: { code: 'BAD_SEAT' } });
    expect(await me.kick(9)).toMatchObject({ ok: false, error: { code: 'BAD_SEAT' } });
    expect(host.room.seats.map(s => s.autopilot)).toEqual([false, false, false]);
    expect(host.room.seats[1]!.connected).toBe(true);
    host.dispose();
  });
});

describe('removing a player in the lobby', () => {
  it('opens the seat, and the same device may join again', async () => {
    const { host, me, sched } = await newLobby({ settings: { playerCount: 2 } });
    const bea = join(host, 'Bea', BEA);
    await settle();
    expect(bea.client.seat).toBe(1);

    expect(await me.kick(1)).toEqual({ ok: true });
    await sched.advance(50);
    expect(bea.client.closedWhy).toBe('kicked');
    expect(host.room.seats[1]).toMatchObject({ kind: 'open' });

    const again = join(host, 'Bea', BEA);
    await settle();
    expect(again.client.closedWhy).toBeNull();
    expect(again.client.seat).toBe(1);
    expect(host.room.seats[1]).toMatchObject({ kind: 'human', name: 'Bea', connected: true, ready: false });
    host.dispose();
  });
});
