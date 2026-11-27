// What a 3D picture asks the renderer for, and the shared cache that renders each picture once.
// Pure (no DOM, no Three.js): the renderer is injected, so the tests use a fake one.

import type { CalloutAt, FigColor, FigIcon, FigModel, SceneSpec } from './types';

/** A 3D picture to draw: one model, or a staged scene. Sizes are CSS pixels. */
export type FigureJob =
  | { readonly t: 'model'; readonly model: FigModel; readonly color?: FigColor; readonly numeral?: number; readonly orElse?: SceneSpec; readonly w: number; readonly h: number }
  | { readonly t: 'scene'; readonly scene: SceneSpec; readonly marks?: readonly CalloutAt[]; readonly w: number; readonly h: number };

/** A drawn picture: an image address and where each marker sits (fractions of width and height). */
export interface Rendered {
  readonly url: string;
  readonly marks: readonly { readonly x: number; readonly y: number }[];
}

/** Draws pictures. Returns null when it cannot (no WebGL, a model missing or failing to load). */
export interface FigureRenderer {
  render(job: FigureJob): Promise<Rendered | null>;
  dispose(): void;
}

/** Line-up pictures: 4:3, a Mine twice as wide. Scenes: up to the page width. */
export const ITEM_W = 150;
export const ITEM_H = 112;
export const SCENE_W = 680;

export function jobKey(job: FigureJob): string {
  return JSON.stringify(job);
}

/** The interface icon that stands in for a model when its picture cannot be drawn. */
export function modelIcon(model: FigModel): FigIcon | undefined {
  switch (model) {
    case 'ore': return 'ore';
    case 'plate': return 'plate';
    case 'sphere': return 'sphere';
    case 'tesseract': return 'tess';
    case 'power-token': return 'power';
    case 'mine-1': case 'mine-2': case 'mine-3': return 'mine';
    case 'belt': return 'belt';
    case 'teleporter': return 'teleporter';
    case 'meeple': return 'meeple';
    default: return undefined;
  }
}

/**
 * How a model picture is drawn, given the models listed in public/models/manifest.json: the model
 * itself, its stand-in scene (for a model not in the manifest), or nothing (the
 * picture then shows its icon).
 */
export function modelPlan(job: Extract<FigureJob, { t: 'model' }>, available: ReadonlySet<string>): 'model' | 'orElse' | 'none' {
  if (available.has(job.model)) return 'model';
  return job.orElse ? 'orElse' : 'none';
}

export interface CacheOptions {
  /** Dispose the renderer after this long without a picture to draw (ms). */
  readonly idleMs?: number;
  readonly setTimer?: (fn: () => void, ms: number) => unknown;
  readonly clearTimer?: (t: unknown) => void;
}

/**
 * Renders each picture once per session, one at a time, with one renderer made on demand and
 * disposed after a quiet spell or when the guide closes. A failure is remembered as null (the
 * picture then shows its fallback) and is never thrown.
 */
export class FigureCache {
  private readonly done = new Map<string, Promise<Rendered | null>>();
  private renderer: Promise<FigureRenderer | null> | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private pending = 0;
  private timer: unknown = null;
  private readonly idleMs: number;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (t: unknown) => void;
  /** How many pictures have been drawn (for tests and checks). */
  renders = 0;

  constructor(private readonly make: () => Promise<FigureRenderer | null>, opts: CacheOptions = {}) {
    this.idleMs = opts.idleMs ?? 20000;
    this.setTimer = opts.setTimer ?? ((fn, ms): unknown => setTimeout(fn, ms));
    this.clearTimer = opts.clearTimer ?? ((t): void => clearTimeout(t as ReturnType<typeof setTimeout>));
  }

  /** The picture for a job: drawn the first time, from memory after that. */
  get(job: FigureJob): Promise<Rendered | null> {
    const key = jobKey(job);
    const hit = this.done.get(key);
    if (hit) return hit;
    this.pending++;
    this.stopIdle();
    const p = this.queue.then(() => this.draw(job)).catch(() => null).finally(() => {
      this.pending--;
      if (this.pending === 0) this.startIdle();
    });
    this.queue = p;
    this.done.set(key, p);
    return p;
  }

  /** Already drawn (or failed), without drawing. */
  peek(job: FigureJob): Promise<Rendered | null> | undefined {
    return this.done.get(jobKey(job));
  }

  private async draw(job: FigureJob): Promise<Rendered | null> {
    this.renderer ??= this.make().catch(() => null);
    const r = await this.renderer;
    if (!r) return null;
    const out = await r.render(job);
    if (out) this.renders++;
    return out;
  }

  private stopIdle(): void {
    if (this.timer !== null) { this.clearTimer(this.timer); this.timer = null; }
  }

  private startIdle(): void {
    this.stopIdle();
    this.timer = this.setTimer(() => { this.timer = null; this.release(); }, this.idleMs);
  }

  /** Give the WebGL context back now (the guide closed or nothing was drawn for a while). Pictures stay cached. */
  release(): void {
    this.stopIdle();
    const r = this.renderer;
    this.renderer = null;
    if (!r) return;
    // Wait for the picture being drawn, if any, before disposing.
    const drop = (): void => { void r.then(x => x?.dispose()).catch(() => undefined); };
    void this.queue.then(drop, drop);
  }
}
