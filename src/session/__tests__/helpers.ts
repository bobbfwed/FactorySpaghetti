// Shared fixtures for the session tests: a controllable clock, in-memory connections,
// room builders, and drivers that play a game through the session layer.

import type { GameState, PlayerId } from '../../engine/state';
import { applyAction, createGame } from '../../engine';
import { chooseAction as greedy } from '../../bots/greedyBot';
import type { Scheduler } from '../scheduler';
import type { Room, RoomSettings, Seat } from '../room';
import { SEAT_COLORS, activeSeat, defaultSettings, isHumanControlled, newLobbyRoom, openSeat } from '../room';
import { HostSession } from '../hostSession';
import type { HostOptions } from '../hostSession';
import { ClientSession } from '../clientSession';
import type { MemoryConn } from '../memoryConn';
import { memoryPair } from '../memoryConn';
import { diceRngFromSeed, rollDice } from '../dice';
import type { SaveStore } from '../store';

/** Let every in-flight message and reply be delivered. */
export async function settle(): Promise<void> {
  for (let i = 0; i < 3; i++) await new Promise<void>(r => setTimeout(r, 0));
}

/** A clock that only moves when the test says so. */
export class ManualScheduler implements Scheduler {
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

  private earliest(limit: number): [number, { at: number; fn: () => void }] | null {
    let best: [number, { at: number; fn: () => void }] | null = null;
    for (const entry of this.timers) {
      if (entry[1].at > limit) continue;
      if (!best || entry[1].at < best[1].at || (entry[1].at === best[1].at && entry[0] < best[0])) best = entry;
    }
    return best;
  }

  private fire(entry: [number, { at: number; fn: () => void }]): void {
    this.timers.delete(entry[0]);
    this.t = Math.max(this.t, entry[1].at);
    entry[1].fn();
  }

  /** Move the clock forward, firing due timers in order and letting messages settle. */
  async advance(ms: number): Promise<void> {
    const end = this.t + ms;
    for (;;) {
      const next = this.earliest(end);
      if (!next) break;
      this.fire(next);
      await settle();
    }
    this.t = end;
    await settle();
  }

  /** Fire the timers that are already due (such as instant bots continuing their run), without moving the clock. */
  async flushDue(): Promise<void> {
    for (let i = 0; i < 10_000; i++) {
      const next = this.earliest(this.t);
      if (!next) break;
      this.fire(next);
      await settle();
    }
    await settle();
  }

  /** Fire timers (synchronously, no settling) until none remain or `stop` says so. */
  runUntil(stop: () => boolean, maxFires = 200_000): void {
    for (let i = 0; i < maxFires && !stop(); i++) {
      const next = this.earliest(Infinity);
      if (!next) return;
      this.fire(next);
    }
  }
}

export interface Joined { client: ClientSession; hostEnd: MemoryConn; clientEnd: MemoryConn }

/** Connect a remote client over an in-memory pair whose ends the test can control. */
export function join(host: HostSession, name: string, token: string, store?: SaveStore): Joined {
  const [hostEnd, clientEnd] = memoryPair();
  host.accept(hostEnd);
  const client = new ClientSession(clientEnd, store ? { name, token, store } : { name, token });
  return { client, hostEnd, clientEnd };
}

/** Reconnect an existing client over a fresh pair. */
export function rejoin(host: HostSession, j: Joined): Joined {
  const [hostEnd, clientEnd] = memoryPair();
  host.accept(hostEnd);
  j.client.reattach(clientEnd);
  return { client: j.client, hostEnd, clientEnd };
}

export interface Lobby { host: HostSession; sched: ManualScheduler; me: ClientSession }

/** A new host plus the host player's own client, connected and settled. */
export async function newLobby(opts: Partial<HostOptions> & { settings?: Partial<RoomSettings> } = {}): Promise<Lobby> {
  const { settings, ...hostOpts } = opts;
  const sched = new ManualScheduler();
  const host = new HostSession({
    code: 'KQMTV', hostName: 'Ann', hostToken: 'tok-ann-0123456789', scheduler: sched, randomSeed: (): number => 4242, ...hostOpts,
  });
  const me = new ClientSession(host.connectLocal(), { name: 'Ann', token: opts.hostToken ?? 'tok-ann-0123456789' });
  await settle();
  if (settings) {
    const r = await me.configure(settings);
    if (!r.ok) throw new Error(r.error.message);
  }
  return { host, sched, me };
}

/** A playing room built around a given engine state. */
export function playingRoom(game: GameState, seats: Array<{ kind: 'human' | 'bot'; name: string }>, hostSeat: number, settings: Partial<RoomSettings> = {}): Room {
  const base = newLobbyRoom('ROOMA', seats[hostSeat]!.name, { ...defaultSettings(), playerCount: game.playerCount, ...settings });
  const roomSeats: Seat[] = seats.map((s, i) => ({
    ...openSeat(i, SEAT_COLORS[i]!), kind: s.kind, name: s.name, botId: s.kind === 'bot' ? 'greedy' : null,
  }));
  return { ...base, phase: 'playing', hostSeat, seats: roomSeats, game, diceRng: diceRngFromSeed(99) };
}

/**
 * Play greedy games straight through the engine (host-style seeded dice) until a state
 * satisfies `pred`. Deterministic: the same predicate always finds the same state.
 */
export function findState(playerCount: 2 | 3 | 4, pred: (s: GameState) => boolean): GameState {
  for (let seed = 1; seed < 60; seed++) {
    let s = createGame(seed, playerCount);
    let dice = diceRngFromSeed(seed);
    for (let n = 0; n < 4000 && !s.gameOver; n++) {
      if (pred(s)) return s;
      const actor = (s.pendingFactoryOps[0]?.ownerId ?? activeSeat(s)) as PlayerId;
      let action = greedy(s, actor);
      if (action.type === 'ROLL_DICE') {
        const [rolls, next] = rollDice(dice, s.mineCount);
        dice = next;
        action = { type: 'ROLL_DICE', rolls };
      }
      const res = applyAction(s, action);
      if (!res.ok) throw new Error(`fixture search: ${res.error.code}`);
      s = res.state;
    }
  }
  throw new Error('no state matched');
}

/**
 * Let the human clients play with the greedy policy (pending choices first, then the active
 * player) until `until(room)` holds. Bots in the room play themselves.
 */
export async function driveHumans(host: HostSession, clients: Record<number, ClientSession>, until: (r: Room) => boolean, maxMoves = 5000, sched?: ManualScheduler): Promise<number> {
  for (let n = 0; n < maxMoves; n++) {
    await settle();
    if (sched) await sched.flushDue(); // instant bots finish their run on the next tick
    const r = host.room;
    if (until(r)) return n;
    if (r.phase !== 'playing' || !r.game) throw new Error(`driveHumans: phase ${r.phase}`);
    const g = r.game;
    const owner = g.pendingFactoryOps.find(e => isHumanControlled(r.seats[e.ownerId]))?.ownerId;
    const seat = owner ?? activeSeat(g);
    const client = seat === null ? undefined : clients[seat];
    if (seat === null || !client) throw new Error(`driveHumans: nobody to play seat ${String(seat)}`);
    const res = await client.act(greedy(g, seat));
    if (!res.ok) throw new Error(`driveHumans: ${res.error.code} ${res.error.message}`);
  }
  throw new Error('driveHumans: too many moves');
}
