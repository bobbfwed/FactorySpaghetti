// Fills the picture boxes of the page on show (render.ts): each 3D picture is drawn when it comes
// near the visible part of the page, through the shared cache (one offscreen renderer, each
// picture drawn once per visit). A picture that cannot be drawn keeps its caption and shows the
// interface's small icon for the piece, if it has one; nothing is thrown or logged.

import type { IconName } from '../../icons';
import { icon } from '../../icons';
import type { SeatColor } from '../../../session/room';
import { FigureCache, type FigureJob, type Rendered } from './jobs';
import { markTone } from './render';

let cache: FigureCache | null = null;

/** The session's picture cache. The renderer (and Three.js) is loaded the first time it draws. */
export function figureCache(): FigureCache {
  cache ??= new FigureCache(() => import('./three').then(m => m.createFigureRenderer()));
  return cache;
}

function show(el: HTMLElement, res: Rendered | null): void {
  el.classList.remove('is-loading');
  if (!res) {
    el.classList.add('is-fallback');
    const name = el.dataset.icon as IconName | undefined;
    if (name && !el.querySelector('.ic')) el.append(icon(name, el.dataset.color as SeatColor | undefined));
    return;
  }
  const img = document.createElement('img');
  img.className = 'g-img';
  img.alt = '';
  img.decoding = 'async';
  img.src = res.url;
  el.append(img);
  let marks: string[] = [];
  try { marks = JSON.parse(el.dataset.marks ?? '[]') as string[]; } catch { marks = []; }
  res.marks.forEach((m, i) => {
    const label = marks[i];
    if (!label || m.x < 0 || m.x > 1 || m.y < 0 || m.y > 1) return;
    const s = document.createElement('span');
    s.className = `g-mark g-onpic${markTone(label)}`;
    s.setAttribute('aria-hidden', 'true');
    s.textContent = label;
    s.style.left = `${(m.x * 100).toFixed(2)}%`;
    s.style.top = `${(m.y * 100).toFixed(2)}%`;
    el.append(s);
  });
  el.classList.add('is-ready');
}

function load(el: HTMLElement, c: FigureCache): void {
  let job: FigureJob;
  try { job = JSON.parse(el.dataset.fig ?? '') as FigureJob; } catch { show(el, null); return; }
  el.classList.add('is-loading');
  void c.get(job).then(res => show(el, res), () => show(el, null));
}

/**
 * Draw the pictures inside `root` as they come within reach of the visible part of `scroller`.
 * Returns a function that stops watching (call it when the page is replaced).
 */
export function mountFigures(root: HTMLElement, scroller: HTMLElement | null, c: FigureCache = figureCache()): () => void {
  const boxes = [...root.querySelectorAll<HTMLElement>('.g-pic[data-fig]')];
  if (!boxes.length) return () => undefined;
  if (typeof IntersectionObserver !== 'function') {
    for (const el of boxes) load(el, c);
    return () => undefined;
  }
  const io = new IntersectionObserver(entries => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      io.unobserve(e.target);
      load(e.target as HTMLElement, c);
    }
  }, { root: scroller, rootMargin: '600px 0px' });
  for (const el of boxes) io.observe(el);
  return () => io.disconnect();
}

/** The guide closed: give the WebGL context back. Drawn pictures stay for the next visit. */
export function releaseFigures(): void {
  cache?.release();
}
