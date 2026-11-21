// The stage: between room updates and the screen. Every new room goes into the playback queue
// (src/table/playback.ts); the queue says when to snap and when to animate which transition, and
// the stage carries that out on the 3D table (animateTo / setGame), on the HTML effects layer
// (flights to and from the players) and in sound. The game screen draws the *displayed* room
// (`stage.room`) and offers input only when `stage.drained`.

import type { Room } from '../../session/room';
import type { Table, Target } from '../../table/types';
import { Playback, snapReason, type AnimSpeed, type PlayCommand } from '../../table/playback';
import { DUR, isTableStep, planTransition, soundOf, type AnimStep, type TransitionPlan } from '../../table/transition';
import type { Feel } from './feel';
import type { FxLayer, Point } from './fx';
import type { Sound } from './sound';

export interface Entry { room: Room; json: string; plan: TransitionPlan | null }

/** What the screen is told each time the displayed room changes. */
export interface Shown {
  room: Room;
  /** The transition being played into this room, or null for a snap. */
  plan: TransitionPlan | null;
  /** Multiplier applied to the plan's times (speed and compression). */
  scale: number;
}

export interface StageHost {
  table(): Table | null;
  me(): number | null;
  feel(): Feel;
  readonly sound: Sound;
  readonly fx: FxLayer;
  /** Page position of a table target (null target or off screen: null). */
  point(t: Target | null): Point | null;
  /** Page position of a player's area (seat plate, or your own area). */
  seatPoint(player: number): Point;
  seatColor(player: number): string;
  /** Somewhere sensible on the table when a flight has no known end. */
  centre(): Point;
  shown(info: Shown): void;
  drained(): void;
}

/** When in its step a sound plays (0 = at the start, 1 = at the end). */
const SOUND_AT: Partial<Record<AnimStep['kind'], number>> = { dice: 0, belt: 0.7, flow: 0.95, toPlayer: 0.85, fromPlayer: 0.85, appear: 0.2 };

export class Stage {
  private readonly q = new Playback<Entry>();
  private resync = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly soundTimers = new Set<ReturnType<typeof setTimeout>>();
  private disposed = false;
  private wasDrained = true;
  /** Counters for checks: transitions played, snaps, skips. */
  readonly stats = { played: 0, snaps: 0, skips: 0 };
  /** The transition started last (for checks and screenshots): its steps, start time and scale. */
  lastPlay: { seq: number; steps: readonly AnimStep[]; start: number; scale: number } | null = null;

  constructor(private readonly host: StageHost) {
    this.q.setSpeed(host.feel().speed);
  }

  /** The room on screen (may lag the newest while transitions play). */
  get room(): Room | null { return this.q.shown?.data.room ?? null; }
  /** The newest room received. */
  get newest(): Room | null { return this.q.newest?.data.room ?? null; }
  /** Nothing playing or waiting: the screen shows the newest state. */
  get drained(): boolean { return this.q.drained; }
  lagMs(): number { return this.q.lagMs(performance.now()); }

  /** The connection dropped or a new host took over: the next new state snaps. */
  markResync(): void { this.resync = true; }

  receive(room: Room): void {
    const g = room.game;
    if (!g || this.disposed) return;
    const last = this.q.newest;
    const json = JSON.stringify(g);
    if (last && last.seq === room.seq && last.data.json === json) {
      // Same state (seats, settings or deadlines changed): keep the newest room for its seats.
      last.data.room = room;
      if (this.q.shown === last) this.host.shown({ room, plan: null, scale: 0 });
      return;
    }
    const lastGame = last?.data.room.game ?? null;
    const reason = snapReason(
      last && lastGame ? { seq: last.seq, game: String(lastGame.seed) } : null,
      { seq: room.seq, game: String(g.seed), events: room.lastEvents.length },
      { speed: this.q.speed, resync: this.resync, hidden: typeof document !== 'undefined' && document.hidden, tableReady: !!this.host.table() },
    );
    this.resync = false;
    let plan: TransitionPlan | null = null;
    if (!reason && lastGame) {
      try { plan = planTransition(lastGame, g, room.lastEvents); } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('Could not plan the animation of this move; showing it at once.', err);
      }
    }
    const me = this.host.me();
    const active = g.turnOrder[g.activePlayerIndex];
    const urgent = me !== null && g.pendingFactoryOps.some(o => o.ownerId === me && active !== me);
    this.run(this.q.push({ seq: room.seq, data: { room, json, plan }, baseMs: plan?.baseMs ?? 0 }, performance.now(), { snap: !plan, urgent }));
  }

  /** Jump to the newest state (a tap on the table, the Skip button, the page hidden). */
  skip(): void {
    if (this.q.drained) return;
    this.stats.skips++;
    this.run(this.q.skip());
  }

  setSpeed(speed: AnimSpeed): void { this.run(this.q.setSpeed(speed)); }

  /** The 3D table finished loading: show the displayed state on it. */
  tableReady(): void {
    this.skip();
    const r = this.room;
    if (r?.game) this.host.table()?.setGame(r.game);
  }

  private run(cmds: readonly PlayCommand<Entry>[]): void {
    if (this.disposed) return;
    for (const c of cmds) {
      if (c.kind === 'snap') this.snap(c.item.data);
      else this.play(c.item.data, c.scale);
    }
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    const at = this.q.nextAt();
    if (at !== null) this.timer = setTimeout(() => { this.timer = null; this.run(this.q.tick(performance.now())); }, Math.max(0, at - performance.now()));
    // Tell the screen when the picture has caught up (also when the last transition simply ended).
    const drained = this.q.drained;
    if (drained && (cmds.length > 0 || !this.wasDrained)) this.host.drained();
    this.wasDrained = drained;
  }

  private snap(e: Entry): void {
    this.stats.snaps++;
    this.clearSounds();
    this.host.fx.clear();
    if (e.room.game) this.host.table()?.setGame(e.room.game);
    this.host.shown({ room: e.room, plan: null, scale: 0 });
  }

  private play(e: Entry, scale: number): void {
    const plan = e.plan;
    const game = e.room.game;
    if (!plan || !game) { this.snap(e); return; }
    this.stats.played++;
    this.lastPlay = { seq: e.room.seq, steps: plan.steps, start: performance.now(), scale };
    this.clearSounds();
    this.host.fx.clear();
    this.host.table()?.animateTo(game, plan.steps, scale);
    for (const s of plan.steps) {
      if (!isTableStep(s)) this.flight(s, scale);
      const name = soundOf(s);
      if (name) this.soundAt((s.at + s.dur * (SOUND_AT[s.kind] ?? 0.85)) * scale, name);
    }
    this.host.shown({ room: e.room, plan, scale });
  }

  private flight(s: AnimStep, scale: number): void {
    if (s.kind !== 'toPlayer' && s.kind !== 'fromPlayer') return;
    const seat = this.host.seatPoint(s.player);
    const there = (s.kind === 'toPlayer' ? this.host.point(s.from) : this.host.point(s.to)) ?? this.host.centre();
    const [from, to] = s.kind === 'toPlayer' ? [there, seat] : [seat, there];
    this.host.fx.flight(s.item, s.count, from, to, {
      delay: s.at * scale, dur: DUR.flight * scale, gap: DUR.flightGap * scale,
      color: s.item === 'card' ? this.host.seatColor(s.player) : undefined,
    });
  }

  private soundAt(ms: number, name: Parameters<Sound['play']>[0]): void {
    const sound = this.host.sound;
    if (ms <= 0) { sound.play(name); return; }
    const t = setTimeout(() => { this.soundTimers.delete(t); sound.play(name); }, ms);
    this.soundTimers.add(t);
  }

  private clearSounds(): void {
    for (const t of this.soundTimers) clearTimeout(t);
    this.soundTimers.clear();
  }

  dispose(): void {
    this.disposed = true;
    if (this.timer) clearTimeout(this.timer);
    this.clearSounds();
  }
}
