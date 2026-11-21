// Table sounds, synthesized with the Web Audio API (no audio files). The audio context is only
// created after a user gesture (browser autoplay rules); until then, and wherever audio is
// unavailable, play() does nothing. Nothing here ever throws.

import type { SoundName } from '../../table/transition';

type Ctx = AudioContext;

/** The same sound is not started again within this many milliseconds (a burst of ticks). */
const MIN_GAP_MS: Partial<Record<SoundName, number>> = { tick: 70, belt: 60, place: 60, card: 90, dice: 300 };

export class Sound {
  enabled = true;
  private ctx: Ctx | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private last = new Map<SoundName, number>();

  /** Call from a user gesture (pointerdown / keydown): creates or resumes the audio context. */
  unlock(): void {
    try {
      if (!this.ctx) {
        const AC = (window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext);
        if (!AC) return;
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.5;
        this.master.connect(this.ctx.destination);
      }
      if (this.ctx.state === 'suspended') void this.ctx.resume().catch(() => undefined);
    } catch {
      this.ctx = null;
    }
  }

  get ready(): boolean { return !!this.ctx && this.ctx.state === 'running'; }

  play(name: SoundName): void {
    if (!this.enabled || !this.ctx || !this.master || this.ctx.state !== 'running') return;
    const now = performance.now();
    const gap = MIN_GAP_MS[name] ?? 0;
    if (now - (this.last.get(name) ?? -1e9) < gap) return;
    this.last.set(name, now);
    try {
      RECIPES[name](this.ctx, this.master, this);
    } catch { /* a node type missing in an old browser: stay silent */ }
  }

  /** One second of white noise, made once. */
  noiseBuffer(ctx: Ctx): AudioBuffer {
    if (!this.noise) {
      const n = ctx.sampleRate;
      const b = ctx.createBuffer(1, n, n);
      const d = b.getChannelData(0);
      let seed = 1;
      for (let i = 0; i < n; i++) { seed = (seed * 16807) % 2147483647; d[i] = (seed / 2147483647) * 2 - 1; }
      this.noise = b;
    }
    return this.noise;
  }

  dispose(): void {
    try { void this.ctx?.close(); } catch { /* already closed */ }
    this.ctx = null;
    this.master = null;
  }
}

// ── Recipes ─────────────────────────────────────────────────────────────────────────────────────

/** A tone with an attack/decay envelope, optionally gliding to `to` Hz. */
function tone(ctx: Ctx, out: AudioNode, o: { type: OscillatorType; from: number; to?: number; at?: number; dur: number; gain: number }): void {
  const t = ctx.currentTime + (o.at ?? 0);
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = o.type;
  osc.frequency.setValueAtTime(o.from, t);
  if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, t + o.dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(o.gain, t + Math.min(0.012, o.dur / 4));
  g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
  osc.connect(g).connect(out);
  osc.start(t);
  osc.stop(t + o.dur + 0.02);
}

/** A burst of filtered noise. */
function hiss(ctx: Ctx, out: AudioNode, s: Sound, o: { at?: number; dur: number; gain: number; freq: number; q?: number; sweepTo?: number }): void {
  const t = ctx.currentTime + (o.at ?? 0);
  const src = ctx.createBufferSource();
  src.buffer = s.noiseBuffer(ctx);
  const f = ctx.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.setValueAtTime(o.freq, t);
  if (o.sweepTo) f.frequency.exponentialRampToValueAtTime(o.sweepTo, t + o.dur);
  f.Q.value = o.q ?? 1.2;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(o.gain, t + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
  src.connect(f).connect(g).connect(out);
  src.start(t, Math.random() * 0.5);
  src.stop(t + o.dur + 0.02);
}

const RECIPES: Record<SoundName, (ctx: Ctx, out: AudioNode, s: Sound) => void> = {
  // Dice rattling on wood: a handful of short knocks, closer together as they settle.
  dice: (ctx, out, s) => {
    const hits = [0, 0.09, 0.16, 0.25, 0.31, 0.4, 0.46, 0.55];
    hits.forEach((at, i) => {
      hiss(ctx, out, s, { at, dur: 0.05, gain: 0.5 - i * 0.04, freq: 1800 + (i % 3) * 700, q: 3 });
      tone(ctx, out, { type: 'triangle', from: 520 + (i % 2) * 140, at, dur: 0.05, gain: 0.12 });
    });
  },
  // A tile set down: a soft low thump and a click.
  place: (ctx, out, s) => {
    tone(ctx, out, { type: 'sine', from: 170, to: 70, dur: 0.16, gain: 0.55 });
    hiss(ctx, out, s, { dur: 0.04, gain: 0.22, freq: 2600, q: 2 });
  },
  // A belt link clicking into a hole.
  belt: (ctx, out, s) => {
    hiss(ctx, out, s, { dur: 0.03, gain: 0.3, freq: 3200, q: 4 });
    tone(ctx, out, { type: 'square', from: 1400, to: 900, dur: 0.035, gain: 0.05 });
  },
  // A material arriving: a short bright tick.
  tick: (ctx, out) => {
    tone(ctx, out, { type: 'sine', from: 1250, to: 1600, dur: 0.06, gain: 0.16 });
  },
  // A card sliding: a swish.
  card: (ctx, out, s) => {
    hiss(ctx, out, s, { dur: 0.18, gain: 0.32, freq: 900, q: 0.8, sweepTo: 3800 });
  },
  // Your turn: two rising bell notes.
  turn: (ctx, out) => {
    tone(ctx, out, { type: 'triangle', from: 659, dur: 0.35, gain: 0.32 });
    tone(ctx, out, { type: 'sine', from: 1318, dur: 0.3, gain: 0.08 });
    tone(ctx, out, { type: 'triangle', from: 988, at: 0.13, dur: 0.5, gain: 0.32 });
    tone(ctx, out, { type: 'sine', from: 1976, at: 0.13, dur: 0.4, gain: 0.06 });
  },
  // A decision is waiting for you: three quick beeps.
  alert: (ctx, out) => {
    for (const at of [0, 0.13, 0.26]) tone(ctx, out, { type: 'square', from: 880, at, dur: 0.08, gain: 0.1 });
  },
  // Not allowed: a low buzz.
  refuse: (ctx, out) => {
    tone(ctx, out, { type: 'sawtooth', from: 190, to: 120, dur: 0.2, gain: 0.12 });
  },
  // Game over: a little rising arpeggio.
  over: (ctx, out) => {
    [523, 659, 784, 1047].forEach((f, i) => tone(ctx, out, { type: 'triangle', from: f, at: i * 0.12, dur: i === 3 ? 0.7 : 0.25, gain: 0.28 }));
  },
};
