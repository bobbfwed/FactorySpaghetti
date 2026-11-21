// Effects drawn over the table with HTML: materials, Power Tokens and Leverage cards flying
// between a piece on the table and a player's area, and the "Your turn" cue. Uses the Web
// Animations API, so nothing here needs a frame loop; everything is cleared on a snap.

import type { Carried } from '../../table/transition';
import { h } from '../dom';
import { icon, type IconName } from '../icons';
import { MATERIAL_ICON } from './pieces';

export interface Point { x: number; y: number }

const ICON: Record<Carried, IconName> = { ...MATERIAL_ICON, power: 'power', card: 'card' };
const MAX_TOKENS = 6;

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
    const el = h('div', { class: `tg-fly ${item === 'card' ? 'card' : ''}`, style: color ? `--seat:${color}` : '' },
      icon(ICON[item]), label ? h('b', { text: label }) : null);
    this.el.append(el);
    // A gentle arc: up by a fraction of the distance, a little to the side for each token.
    const dx = to.x - from.x, dy = to.y - from.y;
    const dist = Math.hypot(dx, dy);
    const mx = from.x + dx * 0.5 + (i % 2 ? 1 : -1) * Math.min(40, dist * 0.08) * (i > 0 ? 1 : 0);
    const my = from.y + dy * 0.5 - Math.min(90, 30 + dist * 0.18);
    try {
      const a = el.animate([
        { transform: `translate(${from.x}px, ${from.y}px) translate(-50%, -50%) scale(0.6)`, opacity: 0 },
        { transform: `translate(${from.x}px, ${from.y}px) translate(-50%, -50%) scale(1.1)`, opacity: 1, offset: 0.12 },
        { transform: `translate(${mx}px, ${my}px) translate(-50%, -50%) scale(1.15)`, opacity: 1, offset: 0.55 },
        { transform: `translate(${to.x}px, ${to.y}px) translate(-50%, -50%) scale(0.8)`, opacity: 1, offset: 0.92 },
        { transform: `translate(${to.x}px, ${to.y}px) translate(-50%, -50%) scale(0.4)`, opacity: 0 },
      ], { duration: Math.max(120, dur), easing: 'cubic-bezier(.45,.05,.35,1)', fill: 'forwards' });
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
