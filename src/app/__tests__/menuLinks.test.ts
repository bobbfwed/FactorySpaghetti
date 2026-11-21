// Links carry only what they need; saved games: untouched solo games are not kept, finished ones
// are offered as replays.

import { describe, expect, it } from 'vitest';
import type { MemoryHub } from '../../net/memory';
import { createMemoryHub } from '../../net/memory';
import type { SaveStore } from '../../session/store';
import { journalKey, memoryStore, saveKey } from '../../session/store';
import { VirtualClock, pump, settled } from '../../online/__tests__/helpers';
import type { AppDeps } from '../controller';
import { AppController, inviteUrl, pageAddress, saveUrl } from '../controller';
import { lobbyInfo } from '../lobby';

interface World { hub: MemoryHub; clock: VirtualClock }
const world = (): World => {
  const clock = new VirtualClock();
  return { clock, hub: createMemoryHub({ scheduler: clock }) };
};

function device(w: World, o: { saves?: SaveStore; search?: string } = {}): AppController {
  const deps: AppDeps = {
    transport: () => w.hub.transport(),
    saves: o.saves ?? memoryStore(),
    identity: memoryStore(),
    location: { search: o.search ?? '', hash: '', base: 'https://example.test/fs/', clearHash: (): void => undefined },
    appVersion: 'test',
    scheduler: w.clock,
    autoplayDelayMs: 0,
    online: { randomSeed: (): number => 99, retries: 4, retryMs: 500, rejoinDelayMs: 200, welcomeTimeoutMs: 5000 },
  };
  const c = new AppController(deps);
  c.setName('Ann');
  return c;
}

const until = (w: World, cond: () => boolean): Promise<void> => pump(w.hub, w.clock, cond);
const run = <T>(w: World, p: Promise<T>): Promise<T> => settled(w, p);

async function soloStarted(w: World, c: AppController): Promise<void> {
  await run(w, c.solo());
  await until(w, () => lobbyInfo(c.room!, 0).canStart);
  await run(w, c.configure({ playerCount: 2, botDelayMs: 0 }));
  await until(w, () => lobbyInfo(c.room!, 0).canStart);
  expect(await run(w, c.start())).toBe(true);
  await until(w, () => c.screen === 'game');
}

describe('links', () => {
  it('are built from the page address only', () => {
    expect(pageAddress('https://example.test/fs/?t=local&debug&view=text#save=x')).toBe('https://example.test/fs/');
    expect(saveUrl('https://example.test/fs/?debug', 'v1.abc')).toBe('https://example.test/fs/#save=v1.abc');
    expect(inviteUrl('https://example.test/fs/?view=text', 'KQMTV', false)).toBe('https://example.test/fs/?join=KQMTV');
    expect(inviteUrl('https://example.test/fs/', 'KQMTV', true)).toBe('https://example.test/fs/?join=KQMTV&t=local');
  });

  it('a save link copied in a same-browser test session carries no t=local', async () => {
    const w = world();
    const c = device(w, { search: '?t=local&debug' });
    expect(c.state.transportKind).toBe('local');
    // (The same-browser transport needs a browser; the solo room is enough for a save link.)
    await soloStarted(w, c);
    c.toggleAutoplay();
    await until(w, () => (c.room?.seq ?? 0) >= 10);
    const link = (await c.saveLink())!;
    expect(link.startsWith('https://example.test/fs/#save=v1.')).toBe(true);
    c.leave();
  }, 60_000);
});

describe('saved games on this device', () => {
  it('a solo game left before the first roll is not kept; one with rolls is', async () => {
    const w = world();
    const saves = memoryStore();
    const c = device(w, { saves });
    await soloStarted(w, c);
    const code = c.room!.code;
    expect(saves.get(saveKey(code))).not.toBeNull();
    c.leave();
    expect(saves.get(saveKey(code))).toBeNull();
    expect(saves.get(journalKey(code))).toBeNull();
    expect(c.state.saves).toEqual([]);

    await soloStarted(w, c);
    c.toggleAutoplay();
    await until(w, () => (c.room?.seq ?? 0) >= 30); // well past the first roll
    const code2 = c.room!.code;
    c.leave();
    expect(c.state.saves.map(s => s.code)).toEqual([code2]);
  }, 60_000);

  it('a finished game is listed as finished, with its moves, and opens as a replay', async () => {
    const w = world();
    const saves = memoryStore();
    const c = device(w, { saves });
    await soloStarted(w, c);
    c.toggleAutoplay();
    await until(w, () => !!c.room?.game?.gameOver);
    const final = c.room!.game!;
    c.leave();
    const listed = c.state.saves[0]!;
    expect(listed.phase).toBe('finished');
    expect(listed.hasMoves).toBe(true);
    await run(w, c.watchSaved(listed.key));
    expect(c.screen).toBe('replay');
    const cur = c.state.replay!.cursor!;
    expect(cur.stateAt(cur.length)).toEqual(final);
  }, 60_000);
});
