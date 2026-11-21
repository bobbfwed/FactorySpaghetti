// The playback queue between room updates and the screen. Pure and DOM-free (time is passed in),
// so Vitest can check it.
//
// Every accepted move arrives as a new state. The screen shows a *displayed* state that may lag
// the newest one while transitions play, one after another, in order. Rules (decided in N8):
//   - Lag is capped: if more is waiting than can be shown in about LAG_CAP_MS, durations are
//     compressed (down to MIN_COMPRESS of their length) and, beyond that, the oldest waiting
//     transitions are skipped (the screen snaps past them), so the newest state is on screen no
//     later than about LAG_CAP_MS after it arrived. An urgent state (an off-turn prompt with a
//     countdown) uses the shorter URGENT_CAP_MS.
//   - skip() jumps straight to the newest state.
//   - With speed 'off' every state is shown at once (a snap), as before N8.
//   - snapReason() lists when a new state must snap instead of animating.

export type AnimSpeed = 'off' | 'fast' | 'normal';

/** Duration multiplier of each speed (Normal = the planned durations). */
export const SPEED_FACTOR: Readonly<Record<AnimSpeed, number>> = { off: 0, fast: 0.5, normal: 1 };
/** The screen is never more than about this far behind the newest state. */
export const LAG_CAP_MS = 2500;
/** Tighter cap while the newest state holds a prompt with a countdown for this player. */
export const URGENT_CAP_MS = 1000;
/** Transitions are compressed to no less than this share of their length before older ones are skipped. */
export const MIN_COMPRESS = 0.35;
/** A jump in seq larger than this cannot be explained by one transition: snap. */
export const MAX_EXPLAINED_JUMP = 40;

export interface PlayItem<T> {
  readonly seq: number;
  readonly data: T;
  /** Length of the transition from the previous item to this one at Normal speed (0 = nothing to show). */
  readonly baseMs: number;
}

export type PlayCommand<T> =
  /** Show this item at once (no animation). */
  | { readonly kind: 'snap'; readonly item: PlayItem<T> }
  /** Animate from the shown item to this one over durMs; step times are scaled by `scale` (= durMs / baseMs). */
  | { readonly kind: 'play'; readonly item: PlayItem<T>; readonly durMs: number; readonly scale: number };

interface Waiting<T> { item: PlayItem<T>; arrived: number; urgent: boolean }
interface Playing<T> { item: PlayItem<T>; start: number; end: number }

export interface PlaybackOptions {
  capMs?: number;
  urgentCapMs?: number;
  minCompress?: number;
}

export class Playback<T> {
  private shownItem: PlayItem<T> | null = null;
  private current: Playing<T> | null = null;
  private pending: Waiting<T>[] = [];
  private speedName: AnimSpeed = 'normal';
  private readonly cap: number;
  private readonly urgentCap: number;
  private readonly minC: number;
  /** Arrival time and urgency of the newest item (for the lag budget). */
  private newestArrived = 0;
  /** When the current run of urgent states began (null: the newest state is not urgent). */
  private urgentSince: number | null = null;

  constructor(opts: PlaybackOptions = {}) {
    this.cap = opts.capMs ?? LAG_CAP_MS;
    this.urgentCap = opts.urgentCapMs ?? URGENT_CAP_MS;
    this.minC = opts.minCompress ?? MIN_COMPRESS;
  }

  get speed(): AnimSpeed { return this.speedName; }

  /** Change the speed. Turning animation off jumps to the newest state (the returned commands). */
  setSpeed(speed: AnimSpeed): PlayCommand<T>[] {
    this.speedName = speed;
    return speed === 'off' ? this.skip() : [];
  }

  /** The item on screen (the target of the transition playing, once it started). */
  get shown(): PlayItem<T> | null { return this.current?.item ?? this.shownItem; }
  /** The newest item received. */
  get newest(): PlayItem<T> | null {
    return this.pending.length > 0 ? this.pending[this.pending.length - 1]!.item : this.shown;
  }
  /** Nothing playing and nothing waiting: the screen shows the newest state and input may be offered. */
  get drained(): boolean { return this.current === null && this.pending.length === 0; }
  /** Items still waiting to play (not counting the one playing). */
  get waiting(): number { return this.pending.length; }
  /** When the transition playing ends (call tick() then), or null. */
  nextAt(): number | null { return this.current ? this.current.end : null; }

  /** How long until the newest state is fully on screen, at the current plan (ms; waiting transitions are compressed to fit the cap). */
  lagMs(now: number): number {
    if (this.drained) return 0;
    const k = SPEED_FACTOR[this.speedName];
    const playing = this.current ? Math.max(0, this.current.end - now) : 0;
    let waiting = 0;
    for (const w of this.pending) waiting += w.item.baseMs * k;
    return Math.min(playing + waiting, Math.max(playing, this.budget(now)));
  }

  /**
   * A new state arrived. `snap` (see snapReason) shows it at once and drops anything waiting;
   * `urgent` tightens the lag cap while it is the newest state.
   */
  push(item: PlayItem<T>, now: number, opts: { snap?: boolean; urgent?: boolean } = {}): PlayCommand<T>[] {
    if (opts.snap || this.speedName === 'off' || this.shown === null) return this.reset(item);
    this.pending.push({ item, arrived: now, urgent: !!opts.urgent });
    this.newestArrived = now;
    // The tighter budget counts from the first urgent state, so later moves cannot keep pushing it back.
    this.urgentSince = opts.urgent ? (this.urgentSince ?? now) : null;
    const out: PlayCommand<T>[] = [];
    // The transition playing may be too long for the newest state's budget (only possible with
    // the urgent cap): finish it now.
    if (this.current && this.current.end - now > this.budget(now) * 0.5) {
      out.push({ kind: 'snap', item: this.current.item });
      this.shownItem = this.current.item;
      this.current = null;
    }
    return out.concat(this.tick(now));
  }

  /** Show `item` at once and forget everything waiting (first load, resume, reconnect...). */
  reset(item: PlayItem<T>): PlayCommand<T>[] {
    this.urgentSince = null;
    this.pending = [];
    this.current = null;
    this.shownItem = item;
    return [{ kind: 'snap', item }];
  }

  /** Jump straight to the newest state. */
  skip(): PlayCommand<T>[] {
    const n = this.newest;
    if (!n || this.drained) return [];
    return this.reset(n);
  }

  /** Advance the clock: finish the transition playing if its time is up and start the next ones. */
  tick(now: number): PlayCommand<T>[] {
    const out: PlayCommand<T>[] = [];
    if (this.current && now >= this.current.end) {
      this.shownItem = this.current.item;
      this.current = null;
    }
    if (this.current || this.pending.length === 0) return out;

    const k = SPEED_FACTOR[this.speedName];
    const budget = this.budget(now);
    // Keep the newest items that fit in the budget at the strongest compression; skip the rest.
    let keep = 0;
    let fullMs = 0;
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const ms = this.pending[i]!.item.baseMs * k;
      if (keep > 0 && (fullMs + ms) * this.minC > budget) break;
      keep++;
      fullMs += ms;
    }
    const skipped = this.pending.length - keep;
    if (skipped > 0) {
      const last = this.pending[skipped - 1]!.item;
      this.pending = this.pending.slice(skipped);
      this.shownItem = last;
      out.push({ kind: 'snap', item: last });
    }
    const c = fullMs > budget ? budget / fullMs : 1;
    // Start the next transition; ones with nothing to show are shown at once.
    while (this.pending.length > 0) {
      const next = this.pending.shift()!.item;
      const durMs = next.baseMs * k * c;
      if (durMs < 1) {
        this.shownItem = next;
        out.push({ kind: 'snap', item: next });
        continue;
      }
      this.current = { item: next, start: now, end: now + durMs };
      out.push({ kind: 'play', item: next, durMs, scale: durMs / next.baseMs });
      break;
    }
    return out;
  }

  /** Time left for the newest state to reach the screen within its cap. */
  private budget(now: number): number {
    if (this.urgentSince !== null) return Math.max(0, this.urgentCap - (now - this.urgentSince));
    return Math.max(0, this.cap - (now - this.newestArrived));
  }
}

/** What identifies one game, so a different game (another seed) is never animated into. */
export interface Stamp { readonly seq: number; readonly game: string }

/**
 * Why a new state must be shown at once instead of animated, or null to animate.
 * `events` is the number of table events that came with it (a resumed room has none).
 */
export function snapReason(
  prev: Stamp | null,
  next: Stamp & { readonly events: number },
  opts: { speed: AnimSpeed; resync?: boolean; hidden?: boolean; tableReady?: boolean },
): string | null {
  if (opts.speed === 'off') return 'animation off';
  if (opts.tableReady === false) return 'table not ready';
  if (opts.hidden) return 'page hidden';
  if (!prev) return 'first state';
  if (opts.resync) return 'reconnected';
  if (prev.game !== next.game) return 'another game';
  const jump = next.seq - prev.seq;
  if (jump <= 0) return 'seq did not advance';
  if (jump > MAX_EXPLAINED_JUMP) return 'seq jumped too far';
  if (jump > 1 && next.events === 0) return 'seq jumped without events';
  return null;
}
