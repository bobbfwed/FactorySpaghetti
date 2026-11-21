// The app controller over the in-memory hub, with memory stores and a virtual clock. No DOM.

import { describe, expect, it } from 'vitest';
import type { Conn, HostHandle, JoinErrorKind, Transport } from '../../net/conn';
import { JoinError } from '../../net/conn';
import type { MemoryHub, MemoryHubOptions, MemoryTransport } from '../../net/memory';
import { createMemoryHub } from '../../net/memory';
import type { SaveStore } from '../../session/store';
import { memoryStore } from '../../session/store';
import { VirtualClock, pump, settled } from '../../online/__tests__/helpers';
import type { AppDeps, TransportKind } from '../controller';
import { AppController, NAME_KEY, TOKEN_KEY, cleanCodeInput, joinErrorMessage, savedWhen } from '../controller';
import { lobbyInfo } from '../lobby';
import { optionGroups } from '../gameText';

interface World { hub: MemoryHub; clock: VirtualClock }

function world(hubOpts: MemoryHubOptions = {}): World {
  const clock = new VirtualClock();
  const hub = createMemoryHub({ scheduler: clock, maxMessageBytes: 16_299, chunkBytes: 15 * 1024, ...hubOpts });
  return { hub, clock };
}

interface Device {
  ctrl: AppController;
  identity: SaveStore;
  saves: SaveStore;
  transports: MemoryTransport[];
  copied: string[];
  cleared: () => boolean;
}

let seed = 11;

function device(w: World, o: {
  name?: string; search?: string; hash?: string; identity?: SaveStore; saves?: SaveStore;
  transport?: (kind: TransportKind) => Transport; clipboard?: boolean;
} = {}): Device {
  const identity = o.identity ?? memoryStore();
  const saves = o.saves ?? memoryStore();
  const transports: MemoryTransport[] = [];
  const copied: string[] = [];
  let cleared = false;
  const location = {
    search: o.search ?? '',
    hash: o.hash ?? '',
    base: 'https://example.test/fs/',
    clearHash(): void { cleared = true; location.hash = ''; },
  };
  const deps: AppDeps = {
    transport: o.transport ?? ((): Transport => { const t = w.hub.transport(); transports.push(t); return t; }),
    saves,
    identity,
    location,
    appVersion: 'test',
    scheduler: w.clock,
    autoplayDelayMs: 0,
    online: { randomSeed: (): number => seed++, retries: 4, retryMs: 500, rejoinDelayMs: 200, welcomeTimeoutMs: 5000 },
    ...(o.clipboard === false ? {} : { clipboard: async (text: string): Promise<void> => { copied.push(text); } }),
  };
  const ctrl = new AppController(deps);
  if (o.name !== undefined) ctrl.setName(o.name);
  return { ctrl, identity, saves, transports, copied, cleared: () => cleared };
}

const until = (w: World, cond: () => boolean): Promise<void> => pump(w.hub, w.clock, cond);
const run = <T>(w: World, p: Promise<T>): Promise<T> => settled(w, p);

/** Ann hosts a 2-player game, Bea joins, both ready, Ann starts. */
async function twoPlayerGame(w: World): Promise<[Device, Device]> {
  const a = device(w, { name: 'Ann' });
  const b = device(w, { name: 'Bea' });
  await run(w, a.ctrl.host());
  await run(w, a.ctrl.configure({ playerCount: 2, factoryOpTimeoutMs: 0, roundEndTimeoutMs: 0, botDelayMs: 0 }));
  await run(w, b.ctrl.join(a.ctrl.state.online!.code));
  await run(w, a.ctrl.setReady(true));
  await run(w, b.ctrl.setReady(true));
  expect(lobbyInfo(a.ctrl.room!, a.ctrl.mySeat).canStart).toBe(true);
  expect(await run(w, a.ctrl.start())).toBe(true);
  await until(w, () => a.ctrl.screen === 'game' && b.ctrl.screen === 'game');
  return [a, b];
}

function finished(...ds: Device[]): boolean {
  return ds.every(d => d.ctrl.room?.phase === 'finished');
}

describe('identity', () => {
  it('keeps the name and a 32-hex device token in the identity store', () => {
    const w = world();
    const a = device(w);
    expect(a.ctrl.token).toMatch(/^[0-9a-f]{32}$/);
    expect(a.identity.get(TOKEN_KEY)).toBe(a.ctrl.token);
    a.ctrl.setName('  Brandon ');
    expect(a.identity.get(NAME_KEY)).toBe('Brandon');
    const again = device(w, { identity: a.identity });
    expect(again.ctrl.token).toBe(a.ctrl.token);
    expect(again.ctrl.state.name).toBe('Brandon');
    a.ctrl.setName('x'.repeat(40));
    expect(a.ctrl.state.name).toHaveLength(20);
  });

  it('refuses to host or join without a name', async () => {
    const w = world();
    const a = device(w);
    await a.ctrl.host();
    expect(a.ctrl.screen).toBe('menu');
    expect(a.ctrl.state.error).toMatch(/name/);
    expect(a.ctrl.state.focus).toBe('name');
  });

  it('?join= pre-fills the code and focuses the join button (or the name when empty)', () => {
    const w = world();
    const named = memoryStore();
    named.set(NAME_KEY, 'Ann');
    const withName = device(w, { search: '?join=kqmtv', identity: named });
    expect(withName.ctrl.state.joinCode).toBe('KQMTV');
    expect(withName.ctrl.state.focus).toBe('join');
    expect(withName.ctrl.screen).toBe('menu'); // it does not join by itself
    const noName = device(w, { search: '?join=KQMTV&t=local' });
    expect(noName.ctrl.state.focus).toBe('name');
    expect(noName.ctrl.state.transportKind).toBe('local');
  });

  it('cleans typed and pasted codes', () => {
    expect(cleanCodeInput('kq-mt')).toBe('KQMT');
    expect(cleanCodeInput('io1kqmtvzz')).toBe('KQMTV');
    expect(cleanCodeInput('https://x.test/?join=abcde')).toBe('ABCDE');
    expect(savedWhen(new Date(2026, 10, 17, 20, 0).getTime(), new Date(2026, 10, 20, 9, 0).getTime())).toBe('saved Tuesday');
  });
});

describe('hosting and joining', () => {
  it('host goes to the lobby; others join by code and by invite link', async () => {
    const w = world();
    const a = device(w, { name: 'Ann' });
    await run(w, a.ctrl.host());
    expect(a.ctrl.screen).toBe('lobby');
    const code = a.ctrl.state.online!.code;
    expect(lobbyInfo(a.ctrl.room!, a.ctrl.mySeat).needs).toMatch(/3 seats open/);

    const b = device(w, { name: 'Bea' });
    b.ctrl.setJoinCode(code.toLowerCase());
    await run(w, b.ctrl.join());
    expect(b.ctrl.screen).toBe('lobby');
    expect(b.ctrl.mySeat).toBe(1);

    await run(w, a.ctrl.copyInvite());
    const invite = a.copied.at(-1)!;
    expect(invite).toBe(`https://example.test/fs/?join=${code}`);
    expect(a.ctrl.state.notice).toMatch(/Invite link copied/);
    const c = device(w, { name: 'Cy' });
    await run(w, c.ctrl.join(invite));
    expect(c.ctrl.mySeat).toBe(2);
    await until(w, () => a.ctrl.room!.seats.filter(s => s.kind === 'human' && s.connected).length === 3);
  });

  it('shows the invite link in a text box when copying is not possible', async () => {
    const w = world();
    const a = device(w, { name: 'Ann', clipboard: false });
    await run(w, a.ctrl.host());
    await run(w, a.ctrl.copyInvite());
    expect(a.ctrl.state.linkBox?.text).toContain('?join=');
  });

  it('words every join failure plainly', async () => {
    const w = world();
    const kinds: JoinErrorKind[] = ['no-room', 'broker-unreachable', 'no-route', 'timeout'];
    for (const kind of kinds) {
      const failing: Transport = {
        host: (): Promise<HostHandle> => Promise.reject(new JoinError(kind, 'x')),
        join: (): Promise<Conn> => Promise.reject(new JoinError(kind, 'x')),
      };
      const d = device(w, { name: 'Ann', transport: () => failing });
      await d.ctrl.join('ABCDE');
      expect(d.ctrl.screen).toBe('menu');
      expect(d.ctrl.state.error).toBe(joinErrorMessage(kind, 'ABCDE'));
    }
    expect(joinErrorMessage('no-room', 'ABCDE')).toMatch(/no game with the code ABCDE/);
    expect(joinErrorMessage('broker-unreachable', null)).toMatch(/matchmaking service/);
    expect(joinErrorMessage('no-route', null)).toMatch(/different network.*network check page/);
    expect(joinErrorMessage('timeout', null)).toMatch(/timed out/);

    // Through the real hub: an unknown code, a bad code, and a full room.
    const d = device(w, { name: 'Dee' });
    await run(w, d.ctrl.join('ZZZZZ'));
    expect(d.ctrl.state.error).toBe(joinErrorMessage('no-room', 'ZZZZZ'));
    await d.ctrl.join('AB1');
    expect(d.ctrl.state.error).toMatch(/five letters/);
    const a = device(w, { name: 'Ann' });
    await run(w, a.ctrl.host());
    await run(w, a.ctrl.configure({ playerCount: 2 }));
    await run(w, device(w, { name: 'Bea' }).ctrl.join(a.ctrl.state.online!.code));
    await run(w, d.ctrl.join(a.ctrl.state.online!.code));
    expect(d.ctrl.state.error).toBe('The game is full.');
    expect(d.ctrl.screen).toBe('menu');
  });

  it('surfaces what is still needed before the host can start', async () => {
    const w = world();
    const a = device(w, { name: 'Ann' });
    const b = device(w, { name: 'Bea' });
    await run(w, a.ctrl.host());
    await run(w, b.ctrl.join(a.ctrl.state.online!.code));
    await until(w, () => a.ctrl.room!.seats[1]!.connected);
    let info = lobbyInfo(a.ctrl.room!, 0);
    expect(info.canStart).toBe(false);
    expect(info.needs).toBe('2 seats open — add bots or wait for players; waiting for you and Bea to be ready.');
    expect(lobbyInfo(b.ctrl.room!, 1).needs).toMatch(/waiting for Ann and you to be ready/);
    expect(await run(w, b.ctrl.start())).toBe(false);
    expect(b.ctrl.state.error).toMatch(/Only the host/);

    await run(w, a.ctrl.seatToBot(2));
    await run(w, a.ctrl.seatToBot(3));
    await run(w, a.ctrl.setReady(true));
    await until(w, () => lobbyInfo(a.ctrl.room!, 0).needs === 'Waiting for Bea to be ready.');
    expect(await run(w, a.ctrl.start())).toBe(false);
    expect(a.ctrl.state.error).toMatch(/ready/);
    await run(w, b.ctrl.setReady(true));
    await until(w, () => lobbyInfo(a.ctrl.room!, 0).canStart);
    expect(lobbyInfo(a.ctrl.room!, 0).needs).toMatch(/Everyone is ready/);
    expect(lobbyInfo(b.ctrl.room!, 1).canStart).toBe(false); // only the host starts
    // A setting change clears the ready flags.
    await run(w, a.ctrl.configure({ factoryOpTimeoutMs: 10_000 }));
    await until(w, () => !lobbyInfo(a.ctrl.room!, 0).canStart);
    expect(a.ctrl.room!.settings.factoryOpTimeoutMs).toBe(10_000);
  });
});

describe('playing', () => {
  it('plays solo against bots with no network, then leaving frees the room', async () => {
    const w = world();
    const a = device(w, { name: 'Ann' });
    await run(w, a.ctrl.solo());
    expect(a.ctrl.screen).toBe('lobby');
    expect(a.ctrl.state.solo).toBe(true);
    await until(w, () => lobbyInfo(a.ctrl.room!, 0).canStart);
    expect(a.ctrl.room!.seats.map(s => s.kind)).toEqual(['human', 'bot', 'bot', 'bot']);
    // Changing the player count keeps the table full of bots and the player ready.
    await run(w, a.ctrl.configure({ playerCount: 2, botDelayMs: 0 }));
    await until(w, () => lobbyInfo(a.ctrl.room!, 0).canStart);
    expect(a.ctrl.room!.seats.map(s => s.kind)).toEqual(['human', 'bot']);
    expect(await run(w, a.ctrl.start())).toBe(true);
    await until(w, () => a.ctrl.screen === 'game');
    a.ctrl.toggleAutoplay();
    expect(a.ctrl.state.autoplay).toBe(true);
    await until(w, () => finished(a));
    expect(a.ctrl.room!.game!.gameOver).toBe(true);
    expect(a.ctrl.room!.seq).toBeGreaterThan(50);
    const code = a.ctrl.state.online!.code;
    expect(w.hub.isTaken(code)).toBe(true);
    a.ctrl.leave();
    expect(a.ctrl.screen).toBe('menu');
    expect(a.ctrl.state.online).toBeNull();
    expect(a.ctrl.state.autoplay).toBe(false);
    await until(w, () => !w.hub.isTaken(code));
    // The finished game is listed among this device's saves.
    expect(a.ctrl.state.saves.map(s => s.code)).toContain(code);
  }, 60_000);

  it('offers legal moves as labelled groups, and a refused move shows its message', async () => {
    const w = world();
    const [a, b] = await twoPlayerGame(w);
    const room = a.ctrl.room!;
    const active = room.game!.turnOrder[room.game!.activePlayerIndex]!;
    const [mine, other] = active === 0 ? [a, b] : [b, a];
    const groups = optionGroups(mine.ctrl.room!, mine.ctrl.mySeat);
    expect(groups.length).toBeGreaterThan(0);
    expect(groups[0]!.options[0]!.label.length).toBeGreaterThan(0);
    expect(optionGroups(other.ctrl.room!, other.ctrl.mySeat)).toEqual([]);
    expect(await run(w, other.ctrl.act(groups[0]!.options[0]!.action))).toBe(false);
    expect(other.ctrl.state.moveError?.code).toBe('NOT_YOUR_TURN');
    expect(await run(w, mine.ctrl.act(groups[0]!.options[0]!.action))).toBe(true);
    expect(mine.ctrl.state.moveError).toBeNull();
  }, 30_000);
});

describe('saving and resuming', () => {
  it('copy save link gives a link that a fresh device resumes; hold until the host continues', async () => {
    const w = world();
    const [a, b] = await twoPlayerGame(w);
    a.ctrl.toggleAutoplay();
    b.ctrl.toggleAutoplay();
    await until(w, () => (a.ctrl.room?.seq ?? 0) >= 40);
    a.ctrl.toggleAutoplay();
    b.ctrl.toggleAutoplay();
    await until(w, () => w.hub.inFlight === 0 && !a.ctrl.state.online!.client.pending && !b.ctrl.state.online!.client.pending);
    await a.ctrl.copySaveLink();
    const link = a.copied.at(-1)!;
    expect(link).toMatch(/^https:\/\/example\.test\/fs\/#save=v1\./);
    expect(a.ctrl.state.notice).toMatch(/Save link copied/);
    const savedSeq = a.ctrl.room!.seq;

    // A fresh device opens the link from the address bar.
    const d = device(w, { name: 'bea', hash: link.slice(link.indexOf('#')) });
    await d.ctrl.ready;
    expect(d.cleared()).toBe(true);
    expect(d.ctrl.screen).toBe('resume-setup');
    const setup = d.ctrl.state.resume!;
    expect(setup.sameRules).toBe(true);
    expect(setup.seats.map(s => s.name)).toEqual(['Ann', 'Bea']);
    expect(setup.chosen).toBe(1); // matched by name, ignoring case

    // Same link pasted on another device; that player is Ann.
    const e = device(w, { name: 'Somebody' });
    await e.ctrl.loadSaveText(`Here you go: ${link}`.slice('Here you go: '.length), 'link');
    expect(e.ctrl.state.resume!.chosen).toBeNull();
    await e.ctrl.hostResume();
    expect(e.ctrl.state.error).toMatch(/Choose which player/);
    e.ctrl.cancelResume();
    expect(e.ctrl.screen).toBe('menu');

    // The old room ends; Bea's new device hosts the save, Ann's new device rejoins by name.
    a.ctrl.leave();
    b.ctrl.leave();
    await run(w, d.ctrl.hostResume());
    expect(d.ctrl.screen).toBe('lobby');
    expect(d.ctrl.mySeat).toBe(1);
    const newCode = d.ctrl.state.online!.code;
    expect(d.ctrl.room!.hold).toBe(true);
    expect(lobbyInfo(d.ctrl.room!, 1).resuming).toBe(true);
    expect(lobbyInfo(d.ctrl.room!, 1).needs).toMatch(/Ann is not back yet/);

    const f = device(w, { name: 'Ann' });
    await run(w, f.ctrl.join(newCode));
    expect(f.ctrl.mySeat).toBe(0);
    expect(f.ctrl.screen).toBe('lobby');
    await until(w, () => d.ctrl.room!.seats.every(s => s.connected));
    expect(lobbyInfo(f.ctrl.room!, 0).needs).toMatch(/Waiting for the host to continue/);
    expect(d.ctrl.room!.seq).toBe(savedSeq);
    expect(await run(w, d.ctrl.continueGame())).toBe(true);
    await until(w, () => d.ctrl.screen === 'game' && f.ctrl.screen === 'game');
    d.ctrl.toggleAutoplay();
    f.ctrl.toggleAutoplay();
    await until(w, () => finished(d, f));
    expect(d.ctrl.room!.seq).toBeGreaterThan(savedSeq);
  }, 120_000);

  it('a waiting visitor is assigned a seat by the host in the resume lobby', async () => {
    const w = world();
    const [a] = await twoPlayerGame(w);
    const file = a.ctrl.saveFile()!;
    expect(file.name).toMatch(/^factory-spaghetti-[A-Z]{5}-round-\d+\.fsgame$/);
    a.ctrl.leave();
    const host = device(w, { name: 'Ann' });
    await host.ctrl.loadSaveText(file.text, 'file');
    expect(host.ctrl.state.resume!.source).toBe('file');
    expect(host.ctrl.state.resume!.chosen).toBe(0);
    await run(w, host.ctrl.hostResume());
    const visitor = device(w, { name: 'Zed' });
    await run(w, visitor.ctrl.join(host.ctrl.state.online!.code));
    expect(visitor.ctrl.mySeat).toBeNull();
    expect(visitor.ctrl.screen).toBe('lobby');
    await until(w, () => host.ctrl.room!.waiting.length === 1);
    expect(await run(w, host.ctrl.assign(host.ctrl.room!.waiting[0]!.id, 1))).toBe(true);
    await until(w, () => visitor.ctrl.mySeat === 1);
    expect(visitor.ctrl.room!.seats[1]!.name).toBe('Zed');
  }, 60_000);

  it('rejects bad save links and files with the specific problem', async () => {
    const w = world();
    const [a] = await twoPlayerGame(w);
    const link = (await a.ctrl.saveLink())!;
    const d = device(w, { name: 'Dee' });
    await d.ctrl.loadSaveText(link.slice(0, Math.floor(link.length / 2)), 'link');
    expect(d.ctrl.screen).toBe('menu');
    expect(d.ctrl.state.error).toMatch(/incomplete.*cut off/);
    await d.ctrl.loadSaveText('hello there', 'link');
    expect(d.ctrl.state.error).toBe('This is not a Factory Spaghetti save.');
    await d.ctrl.loadSaveText('https://example.test/fs/#save=v2.abcdef', 'link');
    expect(d.ctrl.state.error).toMatch(/newer version/);
    await d.ctrl.loadSaveText('', 'link');
    expect(d.ctrl.state.error).toMatch(/Paste a save link/);
    const file = a.ctrl.saveFile()!.text;
    await d.ctrl.loadSaveText(file.slice(0, 300), 'file');
    expect(d.ctrl.state.error).toMatch(/save file is incomplete/);
    await d.ctrl.loadSaveText(JSON.stringify({ ...JSON.parse(file), v: 2 }), 'file');
    expect(d.ctrl.state.error).toMatch(/newer version/);
    await d.ctrl.loadSaveText('{"x":1}', 'file');
    expect(d.ctrl.state.error).toBe('This is not a Factory Spaghetti save.');
    const different = JSON.parse(file) as { rules: string };
    different.rules = 'deadbeef';
    await d.ctrl.loadSaveText(JSON.stringify(different), 'file');
    expect(d.ctrl.screen).toBe('resume-setup');
    expect(d.ctrl.state.resume!.sameRules).toBe(false);
  }, 30_000);

  it('lists this device\'s saves newest first; resume and delete from the list', async () => {
    const w = world();
    const [a] = await twoPlayerGame(w);
    a.ctrl.leave();
    expect(a.ctrl.state.saves).toHaveLength(1);
    const listing = a.ctrl.state.saves[0]!;
    expect(listing.names).toEqual(['Ann', 'Bea']);
    a.ctrl.resumeStored(listing.key);
    expect(a.ctrl.screen).toBe('resume-setup');
    expect(a.ctrl.state.resume!.chosen).toBe(0);
    a.ctrl.cancelResume();
    a.ctrl.deleteSave(listing.key);
    expect(a.ctrl.state.saves).toEqual([]);
  }, 30_000);
});

describe('connection trouble', () => {
  it('when nobody can host the code: "lost", then host it from my copy', async () => {
    const w = world({ releaseDelayMs: Infinity });
    const [a, b] = await twoPlayerGame(w);
    a.ctrl.toggleAutoplay();
    b.ctrl.toggleAutoplay();
    await until(w, () => (b.ctrl.room?.seq ?? 0) >= 20);
    const oldCode = a.ctrl.state.online!.code;
    w.hub.kill(a.transports[0]!);
    await until(w, () => b.ctrl.banner?.kind === 'reconnecting');
    expect(b.ctrl.banner!.text).toMatch(/you will take over as host/);
    await until(w, () => b.ctrl.banner?.kind === 'lost');
    expect(b.ctrl.banner!.actions).toEqual(['host-copy', 'menu']);
    expect(b.ctrl.state.autoplay).toBe(true);
    const seq = b.ctrl.room!.seq;
    await run(w, b.ctrl.hostFromMyCopy());
    expect(b.ctrl.state.online!.code).not.toBe(oldCode);
    expect(b.ctrl.state.online!.role).toBe('host');
    expect(b.ctrl.screen).toBe('lobby');
    expect(b.ctrl.mySeat).toBe(1);
    expect(b.ctrl.room!.hold).toBe(true);
    expect(b.ctrl.room!.seq).toBe(seq);
    expect(b.ctrl.banner).toBeNull();
  }, 60_000);

  it('a removed player sees why, and goes back to the menu', async () => {
    const w = world();
    const [a, b] = await twoPlayerGame(w);
    await run(w, a.ctrl.kick(1));
    await until(w, () => b.ctrl.banner?.kind === 'closed');
    expect(b.ctrl.banner!.text).toBe('The host removed you from this game.');
    expect(b.ctrl.banner!.actions).toEqual(['menu']);
    b.ctrl.backToMenu();
    expect(b.ctrl.screen).toBe('menu');
  }, 30_000);
});
