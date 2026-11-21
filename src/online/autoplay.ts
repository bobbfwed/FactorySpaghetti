// Play this client's own seat with a bot, through the normal client path (intents to the host),
// so a whole online game can run unattended: for tests and the network test bench.

import type { PlayerId } from '../engine/state';
import { botById } from '../bots/registry';
import type { ClientSession } from '../session/clientSession';
import type { Room } from '../session/room';
import { activeSeat } from '../session/room';
import type { Scheduler } from '../session/scheduler';
import { realScheduler } from '../session/scheduler';

export interface AutoplayOptions {
  botId?: string;
  /** Pause before each move (ms), so a person can follow it. Default 0. */
  delayMs?: number;
  scheduler?: Scheduler;
}

/** Whether `seat` owes a move in `room` right now (its own factory choice, or its turn). */
export function seatMustAct(room: Room | null, seat: number | null): boolean {
  if (!room || seat === null || room.phase !== 'playing' || room.hold || !room.game || room.game.gameOver) return false;
  const s = room.seats[seat];
  if (!s || s.kind !== 'human' || s.autopilot) return false; // the host's bot plays an autopilot seat
  const g = room.game;
  if (g.pendingFactoryOps.some(e => e.ownerId === seat)) return true;
  return g.pendingFactoryOps.length === 0 && activeSeat(g) === seat;
}

/** Start playing this client's seat with a bot. Returns a function that stops it. */
export function autoplay(client: ClientSession, opts: AutoplayOptions = {}): () => void {
  const bot = botById(opts.botId ?? 'greedy').fn;
  const sched = opts.scheduler ?? realScheduler;
  const delay = opts.delayMs ?? 0;
  let stopped = false;
  let busy = false;
  let timer: unknown = null;
  let refusals = 0;
  let refusedAt = -1;

  const move = async (): Promise<void> => {
    const room = client.room;
    const seat = client.seat;
    if (stopped || busy || client.pending || client.status !== 'joined' || !seatMustAct(room, seat)) return;
    const seq = room!.seq;
    if (refusedAt === seq && refusals >= 3) return; // wait for the room to change
    busy = true;
    let ok = true;
    try {
      const action = bot(room!.game!, seat as PlayerId);
      ok = (await client.act(action)).ok;
    } catch {
      ok = false;
    } finally {
      busy = false;
    }
    if (!ok) {
      if (refusedAt !== seq) { refusedAt = seq; refusals = 0; }
      refusals++;
    }
    tick();
  };

  const tick = (): void => {
    if (stopped || busy || timer !== null) return;
    if (delay <= 0) { void move(); return; }
    if (!seatMustAct(client.room, client.seat)) return;
    timer = sched.setTimeout(() => { timer = null; void move(); }, delay);
  };

  const off = client.subscribe(tick);
  tick();
  return () => {
    stopped = true;
    off();
    if (timer !== null) sched.clearTimeout(timer);
  };
}
