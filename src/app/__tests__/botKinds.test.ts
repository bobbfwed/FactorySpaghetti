// Choosing which kind of bot plays a seat: through the app controller over the in-memory hub
// (lobby, solo set-up, save and resume), plus the lobby's pure helpers. No DOM.

import { describe, expect, it } from 'vitest';
import type { Transport } from '../../net/conn';
import type { MemoryHub } from '../../net/memory';
import { createMemoryHub } from '../../net/memory';
import { memoryStore } from '../../session/store';
import { openSeat } from '../../session/room';
import { BOT_TYPES } from '../../bots/registry';
import { VirtualClock, pump, settled } from '../../online/__tests__/helpers';
import type { AppDeps } from '../controller';
import { AppController } from '../controller';
import { DEFAULT_BOT_ID, botChoices, botKindOf, lobbyInfo } from '../lobby';

interface World { hub: MemoryHub; clock: VirtualClock }

function world(): World {
  const clock = new VirtualClock();
  return { hub: createMemoryHub({ scheduler: clock, maxMessageBytes: 16_299, chunkBytes: 15 * 1024 }), clock };
}

let seed = 101;

function device(w: World, name: string): AppController {
  const deps: AppDeps = {
    transport: (): Transport => w.hub.transport(),
    saves: memoryStore(),
    identity: memoryStore(),
    location: { search: '', hash: '', base: 'https://example.test/fs/', clearHash: (): void => undefined },
    appVersion: 'test',
    scheduler: w.clock,
    autoplayDelayMs: 0,
    online: { randomSeed: (): number => seed++, retries: 4, retryMs: 500, rejoinDelayMs: 200, welcomeTimeoutMs: 5000 },
  };
  const ctrl = new AppController(deps);
  ctrl.setName(name);
  return ctrl;
}

const run = <T>(w: World, p: Promise<T>): Promise<T> => settled(w, p);
const until = (w: World, cond: () => boolean): Promise<void> => pump(w.hub, w.clock, cond);

describe('lobby bot helpers', () => {
  it('lists every registry bot in order and marks the seat\'s kind; Smart Bot is the default', () => {
    expect(BOT_TYPES.some(b => b.id === DEFAULT_BOT_ID)).toBe(true);
    expect(BOT_TYPES.find(b => b.id === DEFAULT_BOT_ID)!.label).toBe('Smart Bot');
    const seat = { ...openSeat(1, 'red'), kind: 'bot' as const, name: 'Random Bot', botId: 'random' };
    const choices = botChoices(seat);
    expect(choices.map(c => c.id)).toEqual(BOT_TYPES.map(b => b.id));
    expect(choices.filter(c => c.current).map(c => c.id)).toEqual(['random']);
    expect(botKindOf(seat).label).toBe('Random Bot');
  });

  it('shows an unknown or missing bot id as the bot that actually plays it (the default)', () => {
    for (const botId of ['no-such-bot', null]) {
      const seat = { ...openSeat(2, 'green'), kind: 'bot' as const, name: 'Bot', botId };
      expect(botKindOf(seat).id).toBe(DEFAULT_BOT_ID);
      expect(botChoices(seat).filter(c => c.current).map(c => c.id)).toEqual([DEFAULT_BOT_ID]);
    }
  });
});

describe('choosing the kind of bot', () => {
  it('the host sets a bot seat to every kind in the registry; everyone in the room sees it', async () => {
    const w = world();
    const ann = device(w, 'Ann');
    const bea = device(w, 'Bea');
    await run(w, ann.host());
    await run(w, ann.configure({ playerCount: 3 }));
    await run(w, bea.join(ann.state.online!.code));
    await until(w, () => ann.room!.seats[1]!.kind === 'human');

    // "Add bot" puts a Smart Bot in the open seat.
    expect(await run(w, ann.seatToBot(2))).toBe(true);
    expect(ann.room!.seats[2]).toMatchObject({ kind: 'bot', botId: DEFAULT_BOT_ID, name: 'Smart Bot' });

    for (const kind of [...BOT_TYPES].reverse()) {
      if (ann.room!.seats[2]!.botId !== kind.id) expect(await run(w, ann.setBotKind(2, kind.id))).toBe(true);
      expect(ann.room!.seats[2]).toMatchObject({ kind: 'bot', botId: kind.id, name: kind.label });
      await until(w, () => bea.room!.seats[2]!.botId === kind.id);
      expect(botKindOf(bea.room!.seats[2]!).label).toBe(kind.label);
    }
    // Choosing the kind it already has sends nothing.
    expect(await run(w, ann.setBotKind(2, ann.room!.seats[2]!.botId!))).toBe(false);

    // Only the host changes it.
    expect(await run(w, bea.setBotKind(2, 'random'))).toBe(false);
    expect(bea.state.error).toBeTruthy();
    expect(ann.room!.seats[2]!.botId).toBe(BOT_TYPES[0]!.id);
    // A seat that is not a bot has no kind to change.
    expect(await run(w, ann.setBotKind(1, 'random'))).toBe(false);
    expect(ann.room!.seats[1]!.kind).toBe('human');
  }, 30_000);

  it('an unknown bot id falls back to Smart Bot', async () => {
    const w = world();
    const ann = device(w, 'Ann');
    await run(w, ann.host());
    expect(await run(w, ann.seatToBot(1, 'no-such-bot'))).toBe(true);
    expect(ann.room!.seats[1]).toMatchObject({ kind: 'bot', botId: DEFAULT_BOT_ID, name: 'Smart Bot' });
    expect(await run(w, ann.setBotKind(1, 'random'))).toBe(true);
    expect(await run(w, ann.setBotKind(1, 'also-not-a-bot'))).toBe(true);
    expect(ann.room!.seats[1]).toMatchObject({ botId: DEFAULT_BOT_ID, name: 'Smart Bot' });
  }, 30_000);

  it('solo: the set-up chooses each opponent\'s kind, which survives a player-count change and a save and resume', async () => {
    const w = world();
    const ann = device(w, 'Ann');
    await run(w, ann.solo());
    await until(w, () => lobbyInfo(ann.room!, 0).canStart);
    expect(ann.room!.seats.slice(1).map(s => s.botId)).toEqual([DEFAULT_BOT_ID, DEFAULT_BOT_ID, DEFAULT_BOT_ID]);

    expect(await run(w, ann.setBotKind(1, 'random'))).toBe(true);
    expect(ann.room!.seats[1]).toMatchObject({ kind: 'bot', botId: 'random', name: 'Random Bot' });
    // Fewer players: the chosen bot keeps its kind; more again: new seats get Smart Bots.
    await run(w, ann.configure({ playerCount: 2, botDelayMs: 0, factoryOpTimeoutMs: 0, roundEndTimeoutMs: 0 }));
    await run(w, ann.configure({ playerCount: 3 }));
    await until(w, () => lobbyInfo(ann.room!, 0).canStart);
    expect(ann.room!.seats.map(s => s.botId)).toEqual([null, 'random', DEFAULT_BOT_ID]);

    expect(await run(w, ann.start())).toBe(true);
    await until(w, () => ann.screen === 'game');
    expect(ann.room!.seats[1]!.botId).toBe('random');

    // Save to a file, leave, and resume it on another device.
    const file = ann.saveFile()!;
    ann.leave();
    const again = device(w, 'Ann');
    await again.loadSaveText(file.text, 'file');
    expect(again.state.resume!.chosen).toBe(0);
    await run(w, again.hostResume());
    expect(again.screen).toBe('lobby');
    expect(lobbyInfo(again.room!, 0).resuming).toBe(true);
    expect(again.room!.seats.map(s => s.botId)).toEqual([null, 'random', DEFAULT_BOT_ID]);

    // While the resumed game waits to continue, the host can still change a bot's kind; the seat's
    // automatic name follows the kind (numbered, as Random Bot is taken).
    expect(await run(w, again.setBotKind(2, 'random'))).toBe(true);
    expect(again.room!.seats[2]).toMatchObject({ kind: 'bot', botId: 'random', name: 'Random Bot 2' });
  }, 60_000);
});
