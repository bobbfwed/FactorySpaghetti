// A room received from the host is another browser's word: its seats are cleaned (colours to the
// printed four, names to 1-20 characters) and a room of the wrong shape is refused, never thrown on.

import { describe, it, expect } from 'vitest';
import { createGame } from '../../engine';
import { ClientSession } from '../clientSession';
import { memoryPair } from '../memoryConn';
import type { Room } from '../room';
import { SEAT_COLORS } from '../room';
import { acceptHostRoom } from '../save';
import { playingRoom, settle } from './helpers';

const live = (): Room => playingRoom(createGame(7, 3), [
  { kind: 'human', name: 'Ann' }, { kind: 'human', name: 'Bea' }, { kind: 'bot', name: 'Smart Bot' },
], 0);

const copy = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

describe('a room from the host', () => {
  it('passes unchanged when it is well formed', () => {
    const r = live();
    expect(acceptHostRoom(copy(r))).toEqual(r);
  });

  it('gets a printed colour for every seat, without repeats', () => {
    const r = copy(live()) as unknown as { seats: Record<string, unknown>[] };
    r.seats[0]!.color = 'url(javascript:alert(1))';
    r.seats[1]!.color = 'blue';            // taken by seat 0's fallback, so seat 1 gets a free colour
    r.seats[2]!.color = 'blue';            // a repeat
    const ok = acceptHostRoom(r)!;
    const colors = ok.seats.map(s => s.color);
    expect(colors.every(c => SEAT_COLORS.includes(c))).toBe(true);
    expect(new Set(colors).size).toBe(3);
    expect(colors[0]).toBe('blue');        // its own default colour
  });

  it('cleans and clips names to 1 to 20 characters', () => {
    const r = copy(live()) as unknown as { seats: Record<string, unknown>[]; waiting: unknown[] };
    r.seats[0]!.name = '  Ann\u0007 the   Great and Terrible Host of Everything  ';
    r.seats[1]!.name = '   ';
    r.seats[2]!.name = 42;
    r.waiting = [{ id: 'w1', name: '\u0000\u0000' }];
    const ok = acceptHostRoom(r)!;
    expect(ok.seats[0]!.name).toBe('Ann the Great and Te');
    expect(ok.seats.every(s => s.name.length >= 1 && s.name.length <= 20 && s.name === s.name.trim())).toBe(true);
    expect(ok.seats[1]!.name).toBe('Seat 2');
    expect(ok.seats[2]!.name).toBe('Seat 3');
    expect(ok.waiting[0]!.name).toBe('Guest');
  });

  it('refuses a room of the wrong shape without throwing', () => {
    const bad: unknown[] = [
      null, 5, 'room', [], {},
      { ...live(), seats: 'everyone' },
      { ...live(), seats: live().seats.slice(0, 2) },                // 2 seats for a 3-player game
      { ...live(), game: null },                                     // playing, but no game
      { ...live(), seats: [...live().seats, ...live().seats] },      // too many seats
      { ...live(), seats: live().seats.map(s => ({ ...s, index: 'x' })) },
      { ...live(), game: { ...live().game!, playerCount: 4 } },
    ];
    for (const b of bad) expect(() => acceptHostRoom(b)).not.toThrow();
    for (const b of bad) expect(acceptHostRoom(b)).toBeNull();
  });

  it('the client session cleans what it shows and ignores a broken room', async () => {
    const [hostEnd, clientEnd] = memoryPair();
    const good = live();
    const tampered = copy(good) as unknown as { seats: Record<string, unknown>[] };
    tampered.seats[1]!.color = '"><img src=x>';
    tampered.seats[1]!.name = 'B'.repeat(300);
    hostEnd.onmessage = (raw): void => {
      if ((raw as { t: string }).t === 'hello') hostEnd.send({ t: 'welcome', v: 1, seat: 1, room: tampered, now: 1 });
    };
    const c = new ClientSession(clientEnd, { name: 'Bea', token: 'tok-bea-0123456789' });
    await settle();
    expect(c.status).toBe('joined');
    expect(SEAT_COLORS).toContain(c.room!.seats[1]!.color);
    expect(c.room!.seats[1]!.name).toBe('B'.repeat(20));
    const before = c.room;
    hostEnd.send({ t: 'room', room: { ...good, seats: 'nobody' }, now: 2 });
    hostEnd.send({ t: 'room', room: { ...good, phase: 'playing', game: null }, now: 2 });
    await settle();
    expect(c.room).toBe(before);
    // A welcome naming a seat that does not exist is refused too.
    const [h2, c2end] = memoryPair();
    h2.onmessage = (raw): void => {
      if ((raw as { t: string }).t === 'hello') h2.send({ t: 'welcome', v: 1, seat: 9, room: good, now: 1 });
    };
    const c2 = new ClientSession(c2end, { name: 'Cy', token: 'tok-cy-0123456789xx' });
    await settle();
    expect(c2.status).toBe('connecting');
    expect(c2.room).toBeNull();
    c.dispose();
    c2.dispose();
  });
});
