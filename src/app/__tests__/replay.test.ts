// The playtest tools through the app controller (no DOM): save a replay and open it on another
// device, watch this game again, report a rules problem, and keep the moves across a resume.

import { describe, expect, it } from 'vitest';
import type { MemoryHub } from '../../net/memory';
import { createMemoryHub } from '../../net/memory';
import type { SaveStore } from '../../session/store';
import { journalKey, memoryStore } from '../../session/store';
import { journalFrom, replayTo } from '../../session/journal';
import { VirtualClock, pump, settled } from '../../online/__tests__/helpers';
import type { AppDeps } from '../controller';
import { AppController } from '../controller';
import { lobbyInfo } from '../lobby';

interface World { hub: MemoryHub; clock: VirtualClock }

function world(): World {
  const clock = new VirtualClock();
  const hub = createMemoryHub({ scheduler: clock, maxMessageBytes: 16_299, chunkBytes: 15 * 1024 });
  return { hub, clock };
}

interface Device { ctrl: AppController; saves: SaveStore; files: { name: string; text: string }[] }

let seed = 501;

function device(w: World, name: string, o: { saves?: SaveStore; download?: boolean } = {}): Device {
  const saves = o.saves ?? memoryStore();
  const files: { name: string; text: string }[] = [];
  const deps: AppDeps = {
    transport: () => w.hub.transport(),
    saves,
    identity: memoryStore(),
    location: { search: '', hash: '', base: 'https://example.test/fs/', clearHash: (): void => undefined },
    appVersion: 'test',
    scheduler: w.clock,
    autoplayDelayMs: 0,
    online: { randomSeed: (): number => seed++, retries: 4, retryMs: 500, rejoinDelayMs: 200, welcomeTimeoutMs: 5000 },
    ...(o.download === false ? {} : { download: (n: string, t: string): void => { files.push({ name: n, text: t }); } }),
  };
  const ctrl = new AppController(deps);
  ctrl.setName(name);
  return { ctrl, saves, files };
}

const until = (w: World, cond: () => boolean): Promise<void> => pump(w.hub, w.clock, cond);
const run = <T>(w: World, p: Promise<T>): Promise<T> => settled(w, p);

/** A solo game against bots, with this player's seat on autoplay, played until `stop`. */
async function soloGame(w: World, d: Device, stop: () => boolean): Promise<void> {
  await run(w, d.ctrl.solo());
  await until(w, () => lobbyInfo(d.ctrl.room!, 0).canStart);
  await run(w, d.ctrl.configure({ playerCount: 3, botDelayMs: 0 }));
  await until(w, () => lobbyInfo(d.ctrl.room!, 0).canStart);
  expect(await run(w, d.ctrl.start())).toBe(true);
  await until(w, () => d.ctrl.screen === 'game');
  d.ctrl.toggleAutoplay();
  await until(w, stop);
  if (d.ctrl.state.autoplay) d.ctrl.toggleAutoplay();
  await until(w, () => w.hub.inFlight === 0 && !d.ctrl.state.online!.client.pending && d.ctrl.state.online!.client.journalCurrent);
}

describe('replays through the app', () => {
  it('a finished solo game: "Save replay" opens on a fresh device and ends on the same position', async () => {
    const w = world();
    const a = device(w, 'Ann');
    await soloGame(w, a, () => !!a.ctrl.room?.game?.gameOver);
    const final = a.ctrl.room!.game!;
    a.ctrl.downloadReplay();
    expect(a.files).toHaveLength(1);
    expect(a.files[0]!.name).toMatch(/^factory-spaghetti-[A-Z]{5}-final\.fsreplay$/);

    // Another device opens the pasted text.
    const b = device(w, 'Bea');
    await run(w, b.ctrl.openReplayText(a.files[0]!.text, 'paste'));
    expect(b.ctrl.screen).toBe('replay');
    const rs = b.ctrl.state.replay!;
    expect(rs.status).toBe('ready');
    expect(rs.cursor!.refused).toBeNull();
    expect(rs.cursor!.partial).toBe(false);
    expect(rs.cursor!.stateAt(rs.cursor!.length)).toEqual(final);
    b.ctrl.closeReplay();
    expect(b.ctrl.screen).toBe('menu');

    // "Watch this game again" on the device that played it.
    await run(w, a.ctrl.watchThisGame());
    expect(a.ctrl.screen).toBe('replay');
    expect(a.ctrl.state.replay!.kind).toBe('this-game');
    expect(a.ctrl.state.replay!.cursor!.stateAt(a.ctrl.state.replay!.cursor!.length)).toEqual(final);
    a.ctrl.closeReplay();
    expect(a.ctrl.screen).toBe('game');
  }, 60_000);

  it('refuses bad replay text with words for the player', async () => {
    const w = world();
    const a = device(w, 'Ann');
    await run(w, a.ctrl.openReplayText('', 'paste'));
    expect(a.ctrl.state.error).toMatch(/paste the text of a replay/i);
    await run(w, a.ctrl.openReplayText('', 'file'));
    expect(a.ctrl.state.error).toBe('That file is empty.');
    await run(w, a.ctrl.openReplayText('{"kind":"factory-spaghetti-replay","v":7}', 'paste'));
    expect(a.ctrl.state.error).toMatch(/newer version/);
    await run(w, a.ctrl.openReplayText(`{"x":"${'y'.repeat(5 * 1024 * 1024)}"}`, 'file'));
    expect(a.ctrl.state.error).toMatch(/too large/);
    a.ctrl.replayFileTooLarge();
    expect(a.ctrl.state.error).toMatch(/too large/);
    expect(a.ctrl.screen).toBe('menu');
  });

  it('the save file carries the moves; resuming it keeps a whole-game journal', async () => {
    const w = world();
    const a = device(w, 'Ann');
    await soloGame(w, a, () => (a.ctrl.room?.seq ?? 0) >= 60);
    const file = a.ctrl.saveFile()!;
    const parsed = JSON.parse(file.text) as { journal?: { moves: unknown[] } };
    expect(parsed.journal?.moves.length).toBe(a.ctrl.room!.seq);
    const link = (await a.ctrl.saveLink())!;
    a.ctrl.leave();

    // A phone that never saw the game: the file resumes with every move.
    const b = device(w, 'Ann');
    await run(w, b.ctrl.loadSaveText(file.text, 'file'));
    expect(b.ctrl.state.resume!.save.journal).toBeDefined();
    await run(w, b.ctrl.hostResume());
    await until(w, () => !!b.ctrl.state.online?.client.journalCurrent);
    const host = b.ctrl.state.online!.hostSession!;
    expect(journalFrom(host.journal!)).toBe(0);
    expect(replayTo(host.journal!, b.ctrl.room!.seq)).toEqual(b.ctrl.room!.game);
    b.ctrl.leave();

    // (Packing and unpacking a link use the platform's compression streams, not the test clock,
    // so they are awaited directly.) The link carries no moves, but the device that played
    // keeps them beside its save.
    const again = device(w, 'Ann', { saves: a.saves });
    expect(a.saves.get(journalKey(a.ctrl.state.saves[0]!.code))).not.toBeNull();
    await again.ctrl.loadSaveText(link, 'link');
    expect(again.ctrl.state.resume!.save.journal?.moves.length).toBe(again.ctrl.state.resume!.save.room.seq);
    // A device with nothing: the link resumes with a journal that starts at the save.
    const fresh = device(w, 'Ann');
    await fresh.ctrl.loadSaveText(link, 'link');
    expect(fresh.ctrl.state.resume!.save.journal).toBeUndefined();
    await run(w, fresh.ctrl.hostResume());
    await until(w, () => !!fresh.ctrl.state.online?.client.journalCurrent);
    expect(fresh.ctrl.state.online!.client.journalStart).toBe(fresh.ctrl.room!.seq);
    fresh.ctrl.leave();

    // Deleting a saved game deletes its moves too.
    const code = a.ctrl.state.saves[0]!.code;
    a.ctrl.deleteSave(a.ctrl.state.saves[0]!.key);
    expect(a.saves.get(journalKey(code))).toBeNull();
  }, 60_000);

  it('"Report a rules problem" makes one file that opens in the viewer at the reported position', async () => {
    const w = world();
    const a = device(w, 'Ann');
    await soloGame(w, a, () => (a.ctrl.room?.seq ?? 0) >= 50);
    // A refused move is remembered for the report.
    const room = a.ctrl.room!;
    expect(await run(w, a.ctrl.act({ type: 'BUY_MINE', coord: { q: 40, r: 40 } }))).toBe(false);
    expect(a.ctrl.lastRefused?.action.type).toBe('BUY_MINE');
    a.ctrl.openReport();
    expect(a.ctrl.state.report).toEqual({ saved: null });
    a.ctrl.saveReport('I expected to be able to buy a Mine here.');
    expect(a.ctrl.state.report!.saved).toMatch(/\.fsreport$/);
    const file = a.files.at(-1)!;
    const report = JSON.parse(file.text) as Record<string, unknown>;
    expect(report.note).toBe('I expected to be able to buy a Mine here.');
    expect((report.reporter as { seat: number }).seat).toBe(0);
    expect((report.lastRefused as { error: { code: string } }).error.code).toBeTruthy();
    expect(Array.isArray(report.legalActions)).toBe(true);
    a.ctrl.closeReport();

    const d = device(w, 'Designer');
    await run(w, d.ctrl.openReplayText(file.text, 'file'));
    const rs = d.ctrl.state.replay!;
    expect(rs.kind).toBe('report');
    expect(rs.report!.note).toBe('I expected to be able to buy a Mine here.');
    expect(rs.matchesReport).toBe(true);
    expect(rs.cursor!.seqAt(rs.cursor!.length)).toBe(room.seq);
  }, 60_000);

  it('without downloads, the report text is shown to copy by hand', async () => {
    const w = world();
    const a = device(w, 'Ann', { download: false });
    await soloGame(w, a, () => (a.ctrl.room?.seq ?? 0) >= 20);
    a.ctrl.openReport();
    a.ctrl.saveReport('note');
    expect(a.ctrl.state.report).toBeNull();
    expect(a.ctrl.state.linkBox?.title).toBe('Rules problem report');
    expect(a.ctrl.state.linkBox?.text).toMatch(/^\{"kind":"factory-spaghetti-report"/);
  }, 60_000);
});
