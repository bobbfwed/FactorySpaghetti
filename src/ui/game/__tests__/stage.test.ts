// The stage carries out the playback queue: snaps, animated transitions, flights, and telling the
// screen when the picture has caught up. Checked with a fake table and effects layer.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { applyAction, legalActions } from '../../../engine/reducer';
import { createGame } from '../../../engine/rules/setup';
import type { GameState, PlayerId } from '../../../engine/state';
import type { Action } from '../../../engine/actions';
import { moveEvents } from '../../../session/events';
import { newLobbyRoom, type Room } from '../../../session/room';
import type { Table } from '../../../table/types';
import { Stage, type StageHost } from '../stage';
import { defaultFeel } from '../feel';
import type { FxLayer } from '../fx';
import type { Sound } from '../sound';

/** Rooms of a short game, one per accepted move, as the host would send them. */
function rooms(n: number): Room[] {
  let g: GameState = createGame(3, 2);
  const base = newLobbyRoom('ABCDE', 'Ann');
  const out: Room[] = [{ ...base, phase: 'playing', game: g, seq: 0 }];
  for (let seq = 1; seq <= n; seq++) {
    const pending = g.pendingFactoryOps[0];
    const id = (pending ? pending.ownerId : g.turnOrder[g.activePlayerIndex]) as PlayerId;
    const a: Action = g.phase === 'roll' && !pending ? { type: 'ROLL_DICE', rolls: Array.from({ length: g.mineCount }, () => 4) } : legalActions(g, id)[0]!;
    const res = applyAction(g, a);
    if (!res.ok) throw new Error(res.error.message);
    out.push({ ...base, phase: 'playing', game: res.state, seq, lastEvents: moveEvents(g, res.state, a, id) });
    g = res.state;
  }
  return out;
}

type FakeHost = StageHost & { calls: string[]; shownSeqs: number[]; drainedCount: number };

function fakeHost(): FakeHost {
  const calls: string[] = [];
  const table = {
    setGame: () => { calls.push('setGame'); },
    animateTo: () => { calls.push('animateTo'); },
  } as unknown as Table;
  const host: FakeHost = {
    calls, shownSeqs: [], drainedCount: 0,
    table: () => table,
    me: () => 0,
    feel: () => defaultFeel(false),
    sound: { play: () => undefined } as unknown as Sound,
    fx: { flight: () => { calls.push('flight'); }, clear: () => undefined } as unknown as FxLayer,
    point: () => ({ x: 10, y: 10 }),
    seatPoint: () => ({ x: 100, y: 100 }),
    seatColor: () => '#fff',
    centre: () => ({ x: 50, y: 50 }),
    shown(info) { host.shownSeqs.push(info.room.seq); },
    drained() { host.drainedCount++; },
  };
  return host;
}

describe('Stage', () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] }); });
  afterEach(() => { vi.useRealTimers(); });

  it('snaps the first room, animates the next ones in order and reports when it has caught up', () => {
    const rs = rooms(12);
    const host = fakeHost();
    const stage = new Stage(host);
    stage.receive(rs[0]!);
    expect(host.calls).toEqual(['setGame']);
    expect(stage.drained).toBe(true);
    for (const r of rs.slice(1)) stage.receive(r);
    expect(stage.drained).toBe(false);
    expect(host.calls).toContain('animateTo');
    const before = host.drainedCount;
    vi.advanceTimersByTime(3000);
    expect(stage.drained).toBe(true);
    expect(stage.room?.seq).toBe(12);
    // The last transition ended on its timer: the screen was told (the bug this guards against).
    expect(host.drainedCount).toBeGreaterThan(before);
    // Shown in order, never backwards.
    expect([...host.shownSeqs].sort((a, b) => a - b)).toEqual(host.shownSeqs);
  });

  it('skip() shows the newest room at once; speed Off snaps every room', () => {
    const rs = rooms(6);
    const host = fakeHost();
    const stage = new Stage(host);
    stage.receive(rs[0]!);
    for (const r of rs.slice(1)) stage.receive(r);
    stage.skip();
    expect(stage.drained).toBe(true);
    expect(stage.room?.seq).toBe(6);
    stage.setSpeed('off');
    const n = host.calls.length;
    const more = rooms(8).slice(7);
    for (const r of more) stage.receive(r);
    expect(host.calls.slice(n).every(c => c === 'setGame')).toBe(true);
  });

  it('a room with only seat changes does not replay anything', () => {
    const rs = rooms(2);
    const host = fakeHost();
    const stage = new Stage(host);
    stage.receive(rs[0]!);
    stage.receive(rs[1]!);
    vi.advanceTimersByTime(3000);
    const n = host.calls.length;
    stage.receive({ ...rs[1]!, seats: rs[1]!.seats.map(s => ({ ...s, connected: !s.connected })), game: JSON.parse(JSON.stringify(rs[1]!.game)) as GameState });
    expect(host.calls.length).toBe(n);
    expect(stage.room?.seats[0]?.connected).toBe(!rs[1]!.seats[0]!.connected);
  });

  it('after a reconnect the next room snaps', () => {
    const rs = rooms(3);
    const host = fakeHost();
    const stage = new Stage(host);
    stage.receive(rs[0]!);
    stage.markResync();
    stage.receive(rs[1]!);
    expect(host.calls).toEqual(['setGame', 'setGame']);
    stage.receive(rs[2]!);
    expect(host.calls[2]).toBe('animateTo');
  });
});
