// Fixtures for the online-room tests: a virtual clock that jumps to the next timer only when
// the network has gone quiet, and builders for a hub plus a table of online rooms.

import type { Scheduler } from '../../session/scheduler';
import type { RoomSettings } from '../../session/room';
import type { MemoryHub, MemoryHubOptions, MemoryTransport } from '../../net/memory';
import { createMemoryHub } from '../../net/memory';
import type { OnlineOptions } from '../onlineRoom';
import { OnlineRoom } from '../onlineRoom';

/** A clock that only moves when the test (or `pump`) moves it. */
export class VirtualClock implements Scheduler {
  t = 1_000_000;
  private seq = 0;
  private readonly timers = new Map<number, { at: number; fn: () => void }>();

  now(): number { return this.t; }
  setTimeout(fn: () => void, ms: number): unknown {
    const id = ++this.seq;
    this.timers.set(id, { at: this.t + Math.max(0, ms), fn });
    return id;
  }
  clearTimeout(h: unknown): void { this.timers.delete(h as number); }
  get pending(): number { return this.timers.size; }

  /** Fire the earliest timer, moving the clock to it. False if there is none. */
  fireNext(): boolean {
    let best: [number, { at: number; fn: () => void }] | null = null;
    for (const e of this.timers) {
      if (!best || e[1].at < best[1].at || (e[1].at === best[1].at && e[0] < best[0])) best = e;
    }
    if (!best) return false;
    this.timers.delete(best[0]);
    this.t = Math.max(this.t, best[1].at);
    best[1].fn();
    return true;
  }
}

export const tick = (): Promise<void> => new Promise(r => setImmediate(r));

/**
 * Run the world until `cond` holds: let messages flow, and whenever the network has been quiet
 * for a few rounds, jump the clock to the next timer. Throws if nothing is left to happen or the
 * virtual time limit passes.
 */
export async function pump(hub: MemoryHub, clock: VirtualClock, cond: () => boolean, limitMs = 30 * 60_000): Promise<void> {
  const start = clock.now();
  let quiet = 0;
  for (let i = 0; i < 5_000_000; i++) {
    if (cond()) return;
    await tick();
    if (hub.inFlight > 0) { quiet = 0; continue; }
    if (++quiet < 4) continue;
    quiet = 0;
    if (!clock.fireNext()) {
      // Nothing scheduled: give promises one more chance, then give up.
      for (let k = 0; k < 20 && !cond(); k++) await tick();
      if (cond()) return;
      throw new Error('pump: nothing left to happen and the condition still fails');
    }
    if (clock.now() - start > limitMs) throw new Error('pump: virtual time limit reached');
  }
  throw new Error('pump: too many steps');
}

/** Settings that keep the host from acting on its own clock during play. */
export const QUIET: Partial<RoomSettings> = { factoryOpTimeoutMs: 0, roundEndTimeoutMs: 0, botDelayMs: 0 };

export const NAMES = ['Ann', 'Bea', 'Cy', 'Dee'] as const;
/** A device token of the required length (16-64 characters). */
export const tokenFor = (name: string, device = 'one'): string => `token-${name.toLowerCase()}-${device}-0123456789`;

export interface World {
  hub: MemoryHub;
  clock: VirtualClock;
  transports: MemoryTransport[];
  rooms: OnlineRoom[];
  opts(i: number): OnlineOptions;
}

/** A hub that behaves like the PeerJS service: asynchronous, size-limited, split at 15 KiB. */
export function newWorld(hubOpts: MemoryHubOptions = {}, extra: Partial<OnlineOptions> = {}): Omit<World, 'rooms'> {
  const clock = new VirtualClock();
  const hub = createMemoryHub({ scheduler: clock, maxMessageBytes: 16_299, chunkBytes: 15 * 1024, ...hubOpts });
  const transports = NAMES.map(() => hub.transport());
  let seedN = 7;
  return {
    hub, clock, transports,
    opts: (i: number): OnlineOptions => ({
      transport: transports[i]!, name: NAMES[i]!, token: tokenFor(NAMES[i]!), scheduler: clock,
      randomSeed: (): number => seedN++, ...extra,
    }),
  };
}

/**
 * A playing table: seat 0 hosts, seats 1..n-1 join, everyone is ready, the host starts.
 * Returns once every client holds the started room.
 */
export async function playingTable(players: 2 | 3 | 4, settings: Partial<RoomSettings> = {}, hubOpts: MemoryHubOptions = {}, extra: Partial<OnlineOptions> = {}): Promise<World> {
  const w = newWorld(hubOpts, extra);
  const host = await settled(w, OnlineRoom.host(w.opts(0)));
  const cfg = await settled(w, host.client.configure({ playerCount: players, ...QUIET, ...settings }));
  if (!cfg.ok) throw new Error(cfg.error.message);
  const rooms = [host];
  for (let i = 1; i < players; i++) rooms.push(await settled(w, OnlineRoom.join({ ...w.opts(i), code: host.code })));
  for (const r of rooms) {
    const res = await settled(w, r.client.setReady(true));
    if (!res.ok) throw new Error(res.error.message);
  }
  const started = await settled(w, host.client.start());
  if (!started.ok) throw new Error(started.error.message);
  await pump(w.hub, w.clock, () => rooms.every(r => r.client.room?.phase === 'playing'));
  return { ...w, rooms };
}

/** Await a promise while pumping the world. */
export async function settled<T>(w: Pick<World, 'hub' | 'clock'>, p: Promise<T>): Promise<T> {
  let done = false;
  let value: T | undefined;
  let error: unknown = null;
  p.then(v => { value = v; done = true; }, (e: unknown) => { error = e; done = true; });
  await pump(w.hub, w.clock, () => done);
  if (error !== null) throw error;
  return value as T;
}
