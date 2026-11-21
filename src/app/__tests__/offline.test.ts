// With no connection: hosting and joining say plainly that a connection is needed (no waiting),
// solo play works, and a saved solo game resumes on this device without the network.

import { describe, expect, it } from 'vitest';
import type { Transport } from '../../net/conn';
import type { MemoryHub } from '../../net/memory';
import { createMemoryHub } from '../../net/memory';
import type { SaveStore } from '../../session/store';
import { memoryStore } from '../../session/store';
import { parseSaveFile } from '../../session/save';
import { VirtualClock, pump, settled } from '../../online/__tests__/helpers';
import type { AppDeps, TransportKind } from '../controller';
import { AppController, isSoloSave } from '../controller';
import { lobbyInfo } from '../lobby';

interface World { hub: MemoryHub; clock: VirtualClock }

function world(): World {
  const clock = new VirtualClock();
  return { clock, hub: createMemoryHub({ scheduler: clock, maxMessageBytes: 16_299, chunkBytes: 15 * 1024 }) };
}

function device(w: World, o: { offline: boolean; saves?: SaveStore }): { ctrl: AppController; asked: TransportKind[] } {
  const asked: TransportKind[] = [];
  const offline = { now: o.offline };
  const deps: AppDeps = {
    transport: (kind): Transport => {
      asked.push(kind);
      // The internet transport cannot reach the matchmaking service without a connection.
      if (kind === 'internet' && offline.now) throw new Error('the internet transport was used while offline');
      return w.hub.transport();
    },
    saves: o.saves ?? memoryStore(),
    identity: memoryStore(),
    location: { search: '', hash: '', base: 'https://example.test/fs/', clearHash: (): void => undefined },
    appVersion: 'test',
    scheduler: w.clock,
    autoplayDelayMs: 0,
    isOffline: () => offline.now,
    online: { randomSeed: (): number => 77, retries: 4, retryMs: 500, rejoinDelayMs: 200, welcomeTimeoutMs: 5000 },
  };
  const ctrl = new AppController(deps);
  ctrl.setName('Ann');
  return { ctrl, asked };
}

const until = (w: World, cond: () => boolean): Promise<void> => pump(w.hub, w.clock, cond);
const run = <T>(w: World, p: Promise<T>): Promise<T> => settled(w, p);

describe('offline', () => {
  it('hosting and joining say that a connection is needed, at once', async () => {
    const w = world();
    const d = device(w, { offline: true });
    await d.ctrl.host();
    expect(d.ctrl.state.error).toMatch(/Hosting a game needs an internet connection/);
    expect(d.ctrl.state.error).toMatch(/Play solo vs bots works without one/);
    expect(d.ctrl.state.busy).toBeNull();
    d.ctrl.setJoinCode('KQMTV');
    await d.ctrl.join();
    expect(d.ctrl.state.error).toMatch(/Joining a game needs an internet connection/);
    expect(d.asked).toEqual([]);
    expect(d.ctrl.screen).toBe('menu');
  });

  it('a solo game plays offline, keeps the screen on, and resumes offline from this device', async () => {
    const w = world();
    const saves = memoryStore();
    const a = device(w, { offline: true, saves });
    await run(w, a.ctrl.solo());
    await until(w, () => lobbyInfo(a.ctrl.room!, 0).canStart);
    await run(w, a.ctrl.configure({ playerCount: 2, botDelayMs: 100 }));
    await until(w, () => lobbyInfo(a.ctrl.room!, 0).canStart);
    expect(a.ctrl.wantsScreenOn).toBe(false); // the lobby
    expect(await run(w, a.ctrl.start())).toBe(true);
    await until(w, () => a.ctrl.screen === 'game');
    expect(a.ctrl.wantsScreenOn).toBe(true);
    a.ctrl.toggleAutoplay();
    await until(w, () => (a.ctrl.room?.seq ?? 0) >= 40);
    a.ctrl.toggleAutoplay();
    await until(w, () => w.hub.inFlight === 0 && !a.ctrl.state.online!.client.pending);
    const seq = a.ctrl.room!.seq;
    expect(a.ctrl.room!.game!.gameOver).toBe(false);
    a.ctrl.leave();
    expect(a.ctrl.wantsScreenOn).toBe(false);
    expect(a.asked.every(k => k === 'solo')).toBe(true);

    // Another day, still offline: resume it from the list of saved games.
    const b = device(w, { offline: true, saves });
    const key = b.ctrl.state.saves[0]!.key;
    expect(isSoloSave(parseSaveFile(saves.get(key)!))).toBe(true);
    b.ctrl.resumeStored(key);
    expect(b.ctrl.screen).toBe('resume-setup');
    await run(w, b.ctrl.hostResume());
    expect(b.ctrl.state.error).toBeNull();
    expect(b.asked).toEqual(['solo']);
    expect(b.ctrl.state.solo).toBe(true);
    expect(b.ctrl.room!.seq).toBe(seq);
    expect(await run(w, b.ctrl.continueGame())).toBe(true);
    await until(w, () => b.ctrl.screen === 'game');
    b.ctrl.toggleAutoplay();
    await until(w, () => (b.ctrl.room?.seq ?? 0) >= seq + 10);
    b.ctrl.leave();
  }, 60_000);

  it('a saved game with other players needs a connection to be hosted again', async () => {
    const w = world();
    const saves = memoryStore();
    // Ann hosts online with Bea.
    const ann = device(w, { offline: false, saves });
    const bea = device(w, { offline: false });
    bea.ctrl.setName('Bea');
    await run(w, ann.ctrl.host());
    await run(w, ann.ctrl.configure({ playerCount: 2, botDelayMs: 0, factoryOpTimeoutMs: 0, roundEndTimeoutMs: 0 }));
    await run(w, bea.ctrl.join(ann.ctrl.state.online!.code));
    await run(w, ann.ctrl.setReady(true));
    await run(w, bea.ctrl.setReady(true));
    expect(await run(w, ann.ctrl.start())).toBe(true);
    await until(w, () => ann.ctrl.screen === 'game');
    bea.ctrl.leave();
    ann.ctrl.leave();
    const later = device(w, { offline: true, saves });
    later.ctrl.resumeStored(later.ctrl.state.saves[0]!.key);
    await later.ctrl.hostResume();
    expect(later.ctrl.state.error).toMatch(/needs an internet connection/);
    expect(later.asked).toEqual([]);
  }, 60_000);
});
