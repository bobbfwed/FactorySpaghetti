// The playback of one animated example: when it starts, how it moves from step to step, Pause,
// Play again, Previous and Next, and which example may play (one at a time). Pure: the clock, the
// frame callbacks and the drawing ("stage") are passed in, so the tests drive it with a fake clock.
//
// Decided by the owner (2026-11-27): an example starts by itself once about 60% of it is in view,
// plays through once and rests on its last step, with Play again and step-by-step buttons. Leaving
// the view pauses it; coming back resumes it only if it never finished and the reader has not
// taken over. Where the device or the game's Animation setting says no motion, nothing moves by
// itself: each step is a still picture of the state after it, with Previous and Next.

/** 'stills': no motion (Animation Off, or the device asks for reduced motion). */
export type Motion = 'stills' | 'fast' | 'normal';

/** Speed factor of the game's animation durations (as SPEED_FACTOR in src/table/playback.ts). */
export const MOTION_SCALE: Readonly<Record<Exclude<Motion, 'stills'>, number>> = { fast: 0.5, normal: 1 };

/** Share of the example that must be in view before it starts by itself. */
export const AUTO_RATIO = 0.6;

/** Draws the example. Every call is synchronous; prepare() loads what drawing needs. */
export interface PlayStage {
  /** Load the renderer and the models. False: nothing can be drawn (the step list stays). */
  prepare(): Promise<boolean>;
  /** Show the rest after step `i` (-1: the starting position). */
  rest(i: number): void;
  /** Step `i` starts playing from rest i - 1; `k` is the speed factor. */
  begin(i: number, k: number): void;
  /** Draw step `i` at `t` ms into it. */
  tick(i: number, t: number): void;
  /** A run starts or ends (the stage keeps the renderer meanwhile). */
  running(on: boolean): void;
}

export interface Clock {
  now(): number;
  frame(fn: (t: number) => void): unknown;
  cancelFrame(h: unknown): void;
  later(fn: () => void, ms: number): unknown;
  cancel(h: unknown): void;
}

/** What the controls and the step list show. */
export interface PlayerUi {
  /** The step shown: being played (moving) or at rest after it; -1 the starting position. */
  readonly index: number;
  readonly count: number;
  readonly moving: boolean;
  /** Playing through (also while paused): the main button says Pause / Play. */
  readonly playing: boolean;
  readonly paused: boolean;
  readonly finished: boolean;
  readonly motion: Motion;
  /** Nothing can be drawn: the step list alone. */
  readonly noPicture: boolean;
  /** The change came from a button the reader pressed (announce it). */
  readonly fromReader: boolean;
}

export interface PlayerOptions {
  readonly count: number;
  /** Length of step i at speed factor k (ms). */
  readonly duration: (i: number, k: number) => number;
  readonly stage: PlayStage;
  readonly clock: Clock;
  readonly motion: Motion;
  readonly coordinator: Coordinator;
  readonly onUi: (ui: PlayerUi) => void;
  /** Pause between two steps while playing through, and before the first step (ms at Normal speed). */
  readonly restMs?: { readonly normal: number; readonly fast: number };
  readonly firstMs?: number;
}

/** Lets one example play at a time. */
export class Coordinator {
  private readonly all = new Set<Player>();
  private current: Player | null = null;

  add(p: Player): void { this.all.add(p); }
  remove(p: Player): void {
    this.all.delete(p);
    if (this.current === p) { this.current = null; this.kick(); }
  }
  get playing(): Player | null { return this.current; }

  /** `p` starts a run: any other example stops at the rest of its current step. */
  claim(p: Player): void {
    if (this.current && this.current !== p) this.current.yieldTo();
    this.current = p;
  }

  /** `p`'s run ended: another example in view that never finished may now start by itself. */
  release(p: Player): void {
    if (this.current !== p) return;
    this.current = null;
    this.kick();
  }

  private kick(): void {
    for (const p of this.all) if (p.wantsAuto()) { p.autoStart(); return; }
  }
}

export class Player {
  private index = -1;
  private moving = false;
  private playing = false;
  private paused = false;
  private finished = false;
  private noPicture = false;
  /** The reader pressed a control or another example took over: no more starting by itself. */
  private taken = false;
  /** Paused because it left the view (resumes when it comes back, if it never finished). */
  private hiddenPause = false;
  private visible = false;
  private ready: Promise<boolean> | null = null;
  private disposed = false;
  /** Time into the step playing, or into the pause between steps. */
  private elapsed = 0;
  private gapMs = 0;
  private last = 0;
  private frameH: unknown = null;
  private timerH: unknown = null;
  private readonly k: number;

  constructor(private readonly o: PlayerOptions) {
    this.k = o.motion === 'stills' ? 0 : MOTION_SCALE[o.motion];
    // Without motion the example opens on step 1's still; with motion, on the starting position.
    this.index = o.motion === 'stills' ? 0 : -1;
    o.coordinator.add(this);
  }

  // ── What the page tells the player ──

  /** The share of the example in view (0-1). */
  setVisible(ratio: number): void {
    const was = this.visible;
    this.visible = ratio >= AUTO_RATIO;
    if (this.disposed || was === this.visible) return;
    if (!this.visible && this.playing && !this.paused) {
      this.hiddenPause = true;
      this.freeze();
      this.ui(false);
    } else if (this.visible && this.playing && this.paused && this.hiddenPause) {
      this.hiddenPause = false;
      this.resumeRun();
    } else if (this.visible && this.wantsAuto() && !this.o.coordinator.playing) {
      this.autoStart();
    }
  }

  /** Draw the still the example shows now (once it is near the view). */
  show(): void {
    void this.prepare().then(ok => { if (ok && !this.disposed && !this.moving) this.o.stage.rest(this.index); });
  }

  /** Main button: Pause while playing, Play when paused or partway, Play again at the end. */
  primary(): void {
    if (this.disposed || this.o.motion === 'stills' || this.noPicture) return;
    this.taken = true;
    this.hiddenPause = false;
    if (this.playing && !this.paused) { this.freeze(); this.ui(true); return; }
    if (this.playing && this.paused) { this.resumeRun(true); return; }
    if (this.index >= this.o.count - 1) this.goRest(-1, false);
    this.run(true);
  }

  /** A tap on the picture: pause or carry on a run (nothing else). */
  tap(): void {
    if (this.playing) this.primary();
  }

  next(): void {
    if (this.disposed) return;
    this.taken = true;
    if (this.moving) { this.stopRun(); this.goRest(this.index, true); return; }
    this.stopRun();
    if (this.index >= this.o.count - 1) return;
    if (this.o.motion === 'stills' || this.noPicture) { this.goRest(this.index + 1, true); return; }
    // One step, played, then rest.
    void this.prepare().then(ok => {
      if (this.disposed) return;
      if (!ok) { this.goRest(this.index + 1, true); return; }
      this.o.coordinator.claim(this);
      this.o.stage.running(true);
      this.playing = false;
      this.beginStep(this.index + 1, true);
    });
  }

  previous(): void {
    if (this.disposed) return;
    this.taken = true;
    const wasMoving = this.moving;
    this.stopRun();
    const floor = this.o.motion === 'stills' || this.noPicture ? 0 : -1;
    // While a step plays, Previous goes back to before it.
    const target = wasMoving ? this.index - 1 : this.index - 1;
    if (target < floor && !wasMoving) return;
    this.goRest(Math.max(floor, target), true);
  }

  /** Another example starts: stop at the rest of the current step. */
  yieldTo(): void {
    if (!this.playing && !this.moving) return;
    const moving = this.moving;
    this.taken = true;
    this.halt();
    if (moving) this.goRest(this.index, false);
    else this.ui(false);
  }

  /** Would start by itself now: in view, motion allowed, never finished, nobody took over. */
  wantsAuto(): boolean {
    return !this.disposed && this.visible && this.o.motion !== 'stills' && !this.noPicture && !this.finished &&
      !this.taken && !this.playing && !this.moving;
  }

  autoStart(): void {
    if (this.wantsAuto()) this.run(false);
  }

  dispose(): void {
    this.halt();
    this.disposed = true;
    this.o.coordinator.remove(this);
  }

  /** For tests and checks. */
  get state(): PlayerUi { return this.snapshot(false); }

  // ── Inside ──

  private prepare(): Promise<boolean> {
    this.ready ??= this.o.stage.prepare().catch(() => false).then(ok => {
      if (!ok) { this.noPicture = true; this.ready = Promise.resolve(false); this.ui(false); }
      return ok;
    });
    return this.ready;
  }

  /** Play through from the current position. */
  private run(fromReader: boolean): void {
    void this.prepare().then(ok => {
      if (!ok || this.disposed) return;
      if (!fromReader && !this.wantsAuto()) return;
      this.o.coordinator.claim(this);
      this.o.stage.running(true);
      this.playing = true;
      this.paused = false;
      if (this.index < 0) this.gap(this.o.firstMs ?? 700, fromReader);
      else this.beginStep(this.index + 1, fromReader);
    });
  }

  private beginStep(i: number, fromReader: boolean): void {
    this.index = i;
    this.moving = true;
    this.elapsed = 0;
    this.o.stage.begin(i, this.k);
    this.o.stage.tick(i, 0);
    this.ui(fromReader);
    this.loop();
  }

  private loop(): void {
    this.last = this.o.clock.now();
    const step = (t: number): void => {
      this.frameH = null;
      if (this.disposed || this.paused || !this.moving) return;
      this.elapsed += Math.max(0, t - this.last);
      this.last = t;
      const dur = this.o.duration(this.index, this.k);
      if (this.elapsed >= dur) { this.endStep(); return; }
      this.o.stage.tick(this.index, this.elapsed);
      this.frameH = this.o.clock.frame(step);
    };
    this.frameH = this.o.clock.frame(step);
  }

  private endStep(): void {
    this.moving = false;
    this.o.stage.rest(this.index);
    if (this.playing && this.index < this.o.count - 1) {
      const rest = this.o.restMs ?? { normal: 1300, fast: 900 };
      this.gap(this.o.motion === 'fast' ? rest.fast : rest.normal, false);
      return;
    }
    if (this.index >= this.o.count - 1 && this.playing) this.finished = true;
    this.halt();
    this.ui(false);
  }

  /** A pause between steps while playing through (no frames are drawn meanwhile). */
  private gap(ms: number, fromReader: boolean): void {
    this.gapMs = ms;
    this.elapsed = 0;
    this.ui(fromReader);
    this.waitGap();
  }

  private waitGap(): void {
    this.last = this.o.clock.now();
    this.timerH = this.o.clock.later(() => {
      this.timerH = null;
      if (this.disposed || this.paused) return;
      this.beginStep(this.index + 1, false);
    }, Math.max(0, this.gapMs - this.elapsed));
  }

  /** Stop the clock where it is (Pause, or out of view). */
  private freeze(): void {
    if (this.paused) return;
    this.paused = true;
    const now = this.o.clock.now();
    if (this.timerH !== null) { this.o.clock.cancel(this.timerH); this.timerH = null; this.elapsed += now - this.last; }
    if (this.frameH !== null) { this.o.clock.cancelFrame(this.frameH); this.frameH = null; }
  }

  private resumeRun(fromReader = false): void {
    if (!this.paused) return;
    this.o.coordinator.claim(this);
    this.paused = false;
    this.ui(fromReader);
    if (this.moving) {
      // The view may have shown another example meanwhile: the stage picks up at this moment.
      this.o.stage.tick(this.index, this.elapsed);
      this.loop();
    } else {
      this.waitGap();
    }
  }

  /** End a run (Previous, Next, another example): no frames or timers left. */
  private stopRun(): void {
    if (!this.playing && !this.moving) return;
    this.halt();
  }

  private halt(): void {
    if (this.frameH !== null) { this.o.clock.cancelFrame(this.frameH); this.frameH = null; }
    if (this.timerH !== null) { this.o.clock.cancel(this.timerH); this.timerH = null; }
    const wasRunning = this.playing || this.moving;
    this.playing = false;
    this.paused = false;
    this.moving = false;
    this.hiddenPause = false;
    if (wasRunning) {
      this.o.stage.running(false);
      this.o.coordinator.release(this);
    }
  }

  private goRest(i: number, fromReader: boolean): void {
    this.index = i;
    this.moving = false;
    void this.prepare().then(ok => { if (ok && !this.disposed && !this.moving && this.index === i) this.o.stage.rest(i); });
    this.ui(fromReader);
  }

  private snapshot(fromReader: boolean): PlayerUi {
    return {
      index: this.index, count: this.o.count, moving: this.moving, playing: this.playing, paused: this.paused,
      finished: this.finished, motion: this.o.motion, noPicture: this.noPicture, fromReader,
    };
  }

  private ui(fromReader: boolean): void {
    if (!this.disposed) this.o.onUi(this.snapshot(fromReader));
  }
}
