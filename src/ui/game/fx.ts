// Effects drawn over the table with HTML: materials, Power Tokens and Leverage cards flying
// between a piece on the table and a player's area, and the "Your turn" cue. Uses the Web
// Animations API, so nothing here needs a frame loop; everything is cleared on a snap.

import type { Carried } from '../../table/transition';
import { h } from '../dom';
import { icon, type IconName } from '../icons';
import { MATERIAL_ICON } from './pieces';

export interface Point { x: number; y: number }

const ICON: Record<Exclude<Carried, 'module'>, IconName> = { ...MATERIAL_ICON, power: 'power', card: 'card', teleporter: 'teleporter' };
const MAX_TOKENS = 6;

/** The pace of a flight (shared with the guide's animated examples, which draw the same flights). */
export const FLIGHT_EASING = 'cubic-bezier(.45,.05,.35,1)';

/** The token that flies: an icon of the item (a card in the player's colour), with an optional count. */
export function flightToken(item: Carried, color?: string, label?: string): HTMLElement {
  // A Control Module going back to its owner: a small block in their colour.
  const face = item === 'module' ? h('span', { class: 'mod' }) : icon(ICON[item]);
  return h('div', { class: `tg-fly ${item === 'card' || item === 'module' ? item : ''}`, style: color ? `--seat:${color}` : '' },
    face, label ? h('b', { text: label }) : null);
}

/**
 * The keyframes of the `i`-th token flying from `from` to `to` (pixels in its layer): a gentle arc,
 * up by a fraction of the distance and a little to the side for each token after the first.
 */
export function flightFrames(from: Point, to: Point, i: number): Keyframe[] {
  const dx = to.x - from.x, dy = to.y - from.y;
  const dist = Math.hypot(dx, dy);
  const mx = from.x + dx * 0.5 + (i % 2 ? 1 : -1) * Math.min(40, dist * 0.08) * (i > 0 ? 1 : 0);
  const my = from.y + dy * 0.5 - Math.min(90, 30 + dist * 0.18);
  return [
    { transform: `translate(${from.x}px, ${from.y}px) translate(-50%, -50%) scale(0.6)`, opacity: 0 },
    { transform: `translate(${from.x}px, ${from.y}px) translate(-50%, -50%) scale(1.1)`, opacity: 1, offset: 0.12 },
    { transform: `translate(${mx}px, ${my}px) translate(-50%, -50%) scale(1.15)`, opacity: 1, offset: 0.55 },
    { transform: `translate(${to.x}px, ${to.y}px) translate(-50%, -50%) scale(0.8)`, opacity: 1, offset: 0.92 },
    { transform: `translate(${to.x}px, ${to.y}px) translate(-50%, -50%) scale(0.4)`, opacity: 0 },
  ];
}

export class FxLayer {
  readonly el = h('div', { class: 'tg-fx', attrs: { 'aria-hidden': 'true' } });
  private timers = new Set<ReturnType<typeof setTimeout>>();

  /** Tokens flying from `from` to `to` (page pixels), `count` of them a little apart. */
  flight(item: Carried, count: number, from: Point, to: Point, opts: { delay: number; dur: number; gap: number; color?: string | undefined }): void {
    const n = Math.max(1, Math.min(MAX_TOKENS, count));
    for (let i = 0; i < n; i++) {
      // More than fit: the first token says how many.
      const label = i === 0 && count > MAX_TOKENS ? `×${count}` : undefined;
      this.later(opts.delay + i * opts.gap, () => this.token(item, from, to, opts.dur, i, opts.color, label));
    }
  }

  private token(item: Carried, from: Point, to: Point, dur: number, i: number, color?: string, label?: string): void {
    const el = flightToken(item, color, label);
    this.el.append(el);
    try {
      const a = el.animate(flightFrames(from, to, i), { duration: Math.max(120, dur), easing: FLIGHT_EASING, fill: 'forwards' });
      a.onfinish = (): void => el.remove();
      a.oncancel = (): void => el.remove();
    } catch {
      el.remove();
    }
  }

  /** "Your turn": a banner in the player's colour that rises, holds and fades (about 1.4 s). */
  yourTurn(color: string, text = 'Your turn', reduced = false): void {
    const el = h('div', { class: 'tg-yourturn', style: `--seat:${color}`, attrs: { role: 'status' } }, h('span', { class: 'sw' }), text);
    this.el.append(el);
    try {
      const a = el.animate(reduced ? [
        { opacity: 0 }, { opacity: 1, offset: 0.15 }, { opacity: 1, offset: 0.8 }, { opacity: 0 },
      ] : [
        { transform: 'translate(-50%, -50%) scale(0.7)', opacity: 0 },
        { transform: 'translate(-50%, -50%) scale(1.06)', opacity: 1, offset: 0.16 },
        { transform: 'translate(-50%, -50%) scale(1)', opacity: 1, offset: 0.26 },
        { transform: 'translate(-50%, -50%) scale(1)', opacity: 1, offset: 0.78 },
        { transform: 'translate(-50%, -60%) scale(0.96)', opacity: 0 },
      ], { duration: 1400, easing: 'ease-out', fill: 'forwards' });
      a.onfinish = (): void => el.remove();
    } catch {
      this.later(1400, () => el.remove());
    }
  }

  /** Remove every flight in progress or waiting to start (the screen jumped to a newer state). */
  clear(): void {
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    for (const el of [...this.el.querySelectorAll('.tg-fly')]) el.remove();
  }

  private later(ms: number, fn: () => void): void {
    if (ms <= 0) { fn(); return; }
    const t = setTimeout(() => { this.timers.delete(t); fn(); }, ms);
    this.timers.add(t);
  }

  dispose(): void {
    this.clear();
    this.el.remove();
  }
}
