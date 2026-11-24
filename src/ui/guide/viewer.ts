// The game guide overlay. It lives in its own host element outside the app's screens, so the
// views' redraws (morph on every state change) never touch it: an open guide keeps its page and
// scroll position while the game carries on underneath.
//
// Navigation: a stack of pages (state.ts). Each page opened pushes one browser history entry
// (same address, no hash, so it cannot clash with "#save=" links or room links), so a phone's
// Back button steps back through the guide and finally closes it instead of leaving the app.
// The guide's own Back button and Escape do the same through history.back(); Close removes all
// of the guide's history entries at once.

import './guide.css';
import { icon } from '../icons';
import { GUIDE } from './content';
import { splitTarget } from './inline';
import { renderPage, renderSideList } from './render';
import type { GuideEvent, GuideState } from './state';
import { CLOSED, currentPage, offersContents, reduce } from './state';
import { toDom } from './vdom';

const HISTORY_KEY = 'fsGuide';

let state: GuideState = CLOSED;
let root: HTMLElement | null = null;
let body: HTMLElement | null = null;
let main: HTMLElement | null = null;
let side: HTMLElement | null = null;
let shownKey = '';
/** History entries this guide has pushed and not yet seen popped. */
let pushed = 0;
/** A history.go(-n) is on its way after Close; its popstate is ours to ignore. */
let unwinding = false;
let opener: HTMLElement | null = null;
let listening = false;

function historyWorks(): boolean {
  try { return typeof window.history?.pushState === 'function'; } catch { return false; }
}

function pushEntry(): void {
  if (!historyWorks()) return;
  try {
    const prev = (window.history.state as Record<string, unknown> | null) ?? {};
    window.history.pushState({ ...prev, [HISTORY_KEY]: pushed + 1 }, '');
    pushed++;
  } catch { /* history not available (sandboxed frame): navigation stays in memory */ }
}

/** Apply an event; push history entries for pages added; redraw or close as needed. */
function dispatch(e: GuideEvent, fromHistory = false): void {
  const before = state.stack.length;
  state = reduce(state, e);
  if (!fromHistory) for (let i = before; i < state.stack.length; i++) pushEntry();
  sync();
}

/** Back one page: through history when we own entries there, so the phone's Back stays in step. */
function back(): void {
  if (pushed > 0 && historyWorks() && !unwinding) { window.history.back(); return; }
  dispatch({ type: 'back' }, true);
}

function close(): void {
  if (pushed > 0 && historyWorks()) {
    unwinding = true;
    const n = pushed;
    pushed = 0;
    try { window.history.go(-n); } catch { unwinding = false; }
  }
  dispatch({ type: 'close' }, true);
}

function onPopState(): void {
  if (unwinding) { unwinding = false; return; }
  if (!state.open || pushed === 0) return;
  pushed--;
  dispatch({ type: 'back' }, true);
}

function onKey(e: KeyboardEvent): void {
  if (!state.open) return;
  // The game underneath must not react to keys while the guide covers it.
  e.stopPropagation();
  if (e.key === 'Escape') { e.preventDefault(); back(); }
}

function onClick(e: MouseEvent): void {
  const el = e.target instanceof Element ? e.target.closest<HTMLElement>('[data-go],[data-nav]') : null;
  if (!el || !root?.contains(el)) return;
  const go = el.getAttribute('data-go');
  if (go !== null) {
    const { topic, anchor } = splitTarget(go);
    const known = GUIDE.topics.some(t => t.id === topic);
    dispatch({ type: 'go', topic: known ? topic : null, anchor: known ? anchor : null });
    return;
  }
  const nav = el.getAttribute('data-nav');
  if (nav === 'back') back();
  else if (nav === 'close') close();
  else if (nav === 'contents') dispatch({ type: 'go', topic: null });
}

function onScroll(): void {
  if (body && state.open) state = reduce(state, { type: 'scroll', y: Math.round(body.scrollTop) });
}

function build(host: HTMLElement): void {
  const closeBtn = document.createElement('button');
  closeBtn.className = 'g-hbtn g-close';
  closeBtn.setAttribute('type', 'button');
  closeBtn.setAttribute('data-nav', 'close');
  closeBtn.setAttribute('aria-label', 'Close the guide');
  closeBtn.title = 'Close the guide';
  closeBtn.append(icon('cross'));

  const backBtn = document.createElement('button');
  backBtn.className = 'g-hbtn g-back';
  backBtn.setAttribute('type', 'button');
  backBtn.setAttribute('data-nav', 'back');
  backBtn.append(icon('chevron'), Object.assign(document.createElement('span'), { className: 'g-backtext', textContent: 'Back' }));

  const title = document.createElement('div');
  title.className = 'g-htitle';
  title.append(icon('book'), Object.assign(document.createElement('span'), { className: 'g-htitletext', textContent: 'Game guide' }));

  // Straight to the table of contents from any topic page (narrow screens: wide ones have the side list).
  const contentsBtn = document.createElement('button');
  contentsBtn.className = 'g-hbtn g-contentsbtn';
  contentsBtn.setAttribute('type', 'button');
  contentsBtn.setAttribute('data-nav', 'contents');
  contentsBtn.setAttribute('aria-label', 'Contents');
  contentsBtn.title = 'Contents';
  contentsBtn.hidden = true;
  contentsBtn.append(icon('list'), Object.assign(document.createElement('span'), { className: 'g-contentstext', textContent: 'Contents' }));

  const head = document.createElement('header');
  head.className = 'g-head';
  head.append(backBtn, title, contentsBtn, closeBtn);

  side = document.createElement('div');
  side.className = 'g-sidewrap';
  main = document.createElement('div');
  main.className = 'g-main';
  const layout = document.createElement('div');
  layout.className = 'g-layout';
  layout.append(side, main);
  body = document.createElement('div');
  body.className = 'g-body';
  body.append(layout);
  body.addEventListener('scroll', onScroll, { passive: true });

  root = document.createElement('div');
  root.className = 'guide';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-label', 'Game guide');
  root.append(head, body);
  root.addEventListener('click', onClick);
  host.append(root);
}

function sync(): void {
  if (!state.open) {
    if (root) {
      root.remove();
      root = body = main = side = null;
      shownKey = '';
      document.documentElement.classList.remove('guide-open');
      window.removeEventListener('keydown', onKey, true);
      // The popstate listener stays: the history.go() sent by Close arrives after this.
      const back = opener;
      opener = null;
      if (back?.isConnected) back.focus({ preventScroll: true });
    }
    return;
  }
  const cur = currentPage(state);
  if (!cur || !main || !side || !body || !root) return;
  const key = `${state.stack.length}:${cur.topic ?? ''}:${cur.anchor ?? ''}`;
  if (key === shownKey) return;
  shownKey = key;

  main.replaceChildren(toDom(renderPage(GUIDE, cur.topic)));
  side.replaceChildren(toDom(renderSideList(GUIDE, cur.topic)));
  const backBtn = root.querySelector<HTMLElement>('.g-back');
  const onContents = cur.topic === null && state.stack.length === 1;
  backBtn?.setAttribute('aria-label', onContents ? 'Close the guide' : 'Back');
  backBtn?.setAttribute('title', onContents ? 'Close the guide' : 'Back');
  const contentsBtn = root.querySelector<HTMLElement>('.g-contentsbtn');
  if (contentsBtn) contentsBtn.hidden = !offersContents(state);

  // Where to look: the heading asked for, or where the reader was, or the top.
  const target = cur.anchor ? main.querySelector<HTMLElement>(`[data-anchor="${CSS.escape(cur.anchor)}"]`) : null;
  if (target) {
    body.scrollTop = 0;
    body.scrollTop = Math.max(0, target.getBoundingClientRect().top - body.getBoundingClientRect().top - 8);
  } else {
    body.scrollTop = cur.scroll;
  }
  main.querySelector<HTMLElement>('.g-title')?.focus({ preventScroll: true });
}

/** Open the guide (at a topic, "topic#anchor", or the contents), or go there if it is open. */
export function showGuide(host: HTMLElement, target: string | null = null): void {
  const { topic, anchor } = target ? splitTarget(target) : { topic: null, anchor: null };
  const known = topic !== null && GUIDE.topics.some(t => t.id === topic);
  if (!state.open) {
    opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    build(host);
    document.documentElement.classList.add('guide-open');
    window.addEventListener('keydown', onKey, true);
    if (!listening) { window.addEventListener('popstate', onPopState); listening = true; }
  }
  dispatch({ type: 'open', topic: known ? topic : null, anchor: known ? anchor : null });
}

/** For scripted browser checks: what the guide shows. */
export function guideState(): GuideState {
  return state;
}
