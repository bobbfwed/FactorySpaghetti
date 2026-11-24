// A bot seat's name follows its kind: when the host changes the kind of a bot seat that still has
// its automatic name, the seat is renamed after the new kind with the usual numbering ("Smart Bot",
// "Smart Bot 2"); a name a person chose is never replaced. Through the in-memory transport.

import { describe, it, expect } from 'vitest';
import { BOT_TYPES } from '../../bots/registry';
import { isAutoBotName } from '../hostSession';
import { join, newLobby, settle } from './helpers';

const label = (id: string): string => BOT_TYPES.find(b => b.id === id)!.label;
const SMART = label('greedy');
const RANDOM = label('random');

describe('a bot seat is named after its kind', () => {
  it('recognises the names the host gives bots, and nothing else', () => {
    for (const b of BOT_TYPES) {
      expect(isAutoBotName(b.label)).toBe(true);
      expect(isAutoBotName(`${b.label} 2`)).toBe(true);
      expect(isAutoBotName(` ${b.label.toLowerCase()} 12 `)).toBe(true);
    }
    for (const name of ['Ann', `${SMART} 0`, `${SMART} two`, `${SMART}2`, `My ${SMART}`, `${SMART} 2 3`, '']) {
      expect(isAutoBotName(name)).toBe(false);
    }
  });

  it('in the lobby, changing a bot\'s kind renames it, with the usual numbering', async () => {
    const { host, me } = await newLobby({ settings: { playerCount: 4, botDelayMs: 0 } });
    expect((await me.setSeat(1, 'bot')).ok).toBe(true);
    expect((await me.setSeat(2, 'bot')).ok).toBe(true);
    expect(host.room.seats.slice(1, 3).map(s => s.name)).toEqual([SMART, `${SMART} 2`]);

    expect((await me.setSeat(2, 'bot', 'random')).ok).toBe(true);
    expect((await me.setSeat(3, 'bot', 'random')).ok).toBe(true);
    expect(host.room.seats.slice(1).map(s => s.name)).toEqual([SMART, RANDOM, `${RANDOM} 2`]);
    expect((await me.setSeat(1, 'bot', 'random')).ok).toBe(true);
    expect(host.room.seats[1]).toMatchObject({ botId: 'random', name: `${RANDOM} 3` });
    host.dispose();
  });

  it('during a game: an automatic name follows the kind; a player\'s name is kept', async () => {
    const { host, me } = await newLobby({ settings: { playerCount: 4, botDelayMs: 0, factoryOpTimeoutMs: 0, roundEndTimeoutMs: 0, awayPolicy: 'wait' } });
    const bea = join(host, 'Bea', 'tok-bea-0123456789');
    await settle();
    expect((await me.setSeat(2, 'bot')).ok).toBe(true);
    expect((await me.setSeat(3, 'bot')).ok).toBe(true);
    await bea.client.setReady(true);
    await me.setReady(true);
    expect((await me.start()).ok).toBe(true);
    expect(host.room.phase).toBe('playing');
    expect(host.room.seats.map(s => s.name)).toEqual(['Ann', 'Bea', SMART, `${SMART} 2`]);

    // Smart Bot 2 becomes a Random Bot: renamed, and the log says so.
    expect((await me.setSeat(3, 'bot', 'random')).ok).toBe(true);
    expect(host.room.seats[3]).toMatchObject({ kind: 'bot', botId: 'random', name: RANDOM });
    expect(host.room.log.some(e => e.text === `${SMART} 2 is replaced by ${RANDOM}.`)).toBe(true);
    // Choosing the kind it already has changes nothing.
    expect((await me.setSeat(3, 'bot', 'random')).ok).toBe(true);
    expect(host.room.seats[3]!.name).toBe(RANDOM);
    // Smart Bot becomes a Random Bot too: numbered.
    expect((await me.setSeat(2, 'bot', 'random')).ok).toBe(true);
    expect(host.room.seats[2]!.name).toBe(`${RANDOM} 2`);
    // And back: Smart Bot is free again.
    expect((await me.setSeat(2, 'bot', 'greedy')).ok).toBe(true);
    expect(host.room.seats[2]!.name).toBe(SMART);

    // Bea leaves; the host gives her seat to a bot, then changes its kind: it stays "Bea".
    bea.clientEnd.close();
    await settle();
    expect((await me.setSeat(1, 'bot')).ok).toBe(true);
    expect(host.room.seats[1]).toMatchObject({ kind: 'bot', botId: 'greedy', name: 'Bea' });
    expect((await me.setSeat(1, 'bot', 'random')).ok).toBe(true);
    expect(host.room.seats[1]).toMatchObject({ kind: 'bot', botId: 'random', name: 'Bea' });
    // Every client holds the same names.
    await settle();
    expect(me.room!.seats.map(s => s.name)).toEqual(host.room.seats.map(s => s.name));
    host.dispose();
  }, 30_000);
});
