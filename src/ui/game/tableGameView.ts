// The game screen: the 3D table filling the window with the HTML interface over it.
//
// Wiring: every room update goes to the table (setGame, seat colours) and to the play controller
// (update); every change of the play controller's view goes to the table (glowing targets, the
// ghost tile) and redraws the HTML in place; a tap on the table goes to the play controller; the
// play controller's moves go to the session, and a refusal comes back as play.refused(...).
// HTML anchored to pieces (building menu, prompts, confirm bar) is positioned from
// table.screenPosition() after each redraw and after each table frame (camera moves).
// The 3D library is loaded only when this screen opens (dynamic import).

import './game.css';
import type { AppController, AppState } from '../../app/controller';
import type { Action } from '../../engine/actions';
import type { PlayerId } from '../../engine/state';
import { PlayController } from '../../play';
import type { Room } from '../../session/room';
import type { PlayerColor, Table, Target, ViewInsets } from '../../table/types';
import { connectionBanner } from '../common';
import type { Child } from '../dom';
import { h, morph } from '../dom';
import type { View } from '../menuView';
import { tableFailed } from '../viewPref';
import { bankPanel } from './bank';
import type { Ctx } from './context';
import { clock, initialUi, seatColor, seatName } from './context';
import type { Flash } from './feedback';
import { errorStrip, flashMarkers, rollChip } from './feedback';
import { cameraButtons, gameMenu, menuButton } from './gameMenu';
import { gameOverCard } from './gameOver';
import { ringDash } from './pieces';
import { buildingMenu, cardModal, choicesPanel } from './popovers';
import { promptCards } from './prompts';
import { seatChips, seatDetails, seatPlates } from './seats';
import { edgeTabs, sidePanel } from './sidePanel';
import { confirmBar, turnBar } from './turnBar';
import { phoneSheet, yourPanel } from './yourArea';

/** Phone layout below this width, or when the window is portrait and narrow. */
const PHONE_MAX_W = 760;
const FLASH_MS = 2600;
const TOAST_MS = 4500;
/** Smallest tile size when framing on a phone, so tiles stay comfortable to tap (pinch out for more). */
const PHONE_MIN_TILE_PX = 64;

/** Below this height the desktop panels leave too little table, so the phone layout is used. */
const PHONE_MAX_H = 560;

export function isPhoneLayout(): boolean {
  const w = window.innerWidth, hgt = window.innerHeight;
  return w < PHONE_MAX_W || hgt < PHONE_MAX_H || (hgt > w * 1.2 && w < 900);
}

function isLandscapePhone(): boolean {
  return isPhoneLayout() && window.innerWidth > window.innerHeight;
}

interface Rect { left: number; top: number; right: number; bottom: number }

export interface GameDebug {
  readonly table: Table | null;
  readonly play: PlayController;
  readonly view: PlayController['view'];
  readonly ui: ReturnType<typeof initialUi>;
  /** Page (client) coordinates of a table target, or null when it is not on screen. */
  point(t: Target): { x: number; y: number } | null;
  redraw(): void;
  free(): Rect;
}

export function tableGameView(ctrl: AppController): View {
  const root = h('div', { class: 'tg' });
  const canvas = h('canvas', { class: 'tg-canvas', attrs: { 'aria-label': 'The game table. Drag to move, pinch or scroll to zoom.' } });
  const hud = h('div', { class: 'tg-hud' });
  const toast = h('div', { class: 'tg-toast', attrs: { role: 'status', 'aria-live': 'polite' }, hidden: true });
  const loading = h('div', { class: 'tg-loading' }, h('span', { class: 'spinner' }), 'Setting up the table…');
  root.append(canvas, hud, toast, loading);

  const ui = initialUi();
  let table: Table | null = null;
  let disposed = false;
  let room: Room | null = null;
  let lastState: AppState | null = null;
  let gameJson = '';
  let seat: number | null | undefined;
  let colorsKey = '';
  let targetsKey = '';
  let ghostKey = '';
  let lastTap: Target | null = null;
  let flash: Flash | null = null;
  let lastSeq = -1;
  let phone = isPhoneLayout();
  let portrait = window.innerHeight > window.innerWidth;
  let queued = 0;
  let insetsKey = '';
  let free: Rect = { left: 8, top: 80, right: window.innerWidth - 8, bottom: window.innerHeight - 260 };
  let toastTimer: ReturnType<typeof setTimeout> | null = null;
  let lastHintView: unknown = null;
  let autoOpened = false;
  let boardSize = 0;
  /** The player has dragged or zoomed the table (until they press Re-centre). */
  let userCamera = false;
  const offs: (() => void)[] = [];
  let downAt: { x: number; y: number } | null = null;
  canvas.addEventListener('pointerdown', (e) => { downAt = { x: e.clientX, y: e.clientY }; });
  canvas.addEventListener('pointermove', (e) => {
    if (downAt && e.buttons && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 8) userCamera = true;
  });
  canvas.addEventListener('pointerup', () => { downAt = null; });
  canvas.addEventListener('wheel', () => { userCamera = true; }, { passive: true });

  // ── Play controller ─────────────────────────────────────────────────────────
  const send = (action: Action): void => {
    const client = ctrl.state.online?.client;
    if (!client) { play.refused('Not connected to the game.'); return; }
    client.act(action).then(
      (res) => { if (!res.ok && !disposed) play.refused(res.error.message); },
      (err: unknown) => { if (!disposed) play.refused(err instanceof Error ? err.message : 'The move could not be sent.'); },
    );
  };
  const play = new PlayController({ send, names: (id): string => seatName(room ?? ctrl.room!, id) });
  offs.push(play.subscribe(() => { onPlayChange(); schedule(); }));

  function onPlayChange(): void {
    const v = play.view;
    if (v.hint && v !== lastHintView) showToast(v.hint);
    lastHintView = v;
    if (!v.confirmBar) lastTap = null;
    // Phone: the module tray lives in the sheet, so open it when a module must be chosen there.
    const lit = v.tray.some(t => t.state === 'lit') && (v.step === 'actions' || v.step === 'roundEnd');
    if (phone && lit && !ui.sheetOpen) { ui.sheetOpen = true; ui.sheetTab = 'tray'; autoOpened = true; }
    else if (phone && !lit && autoOpened) { ui.sheetOpen = false; autoOpened = false; }
    // A flow that needs the table closes the sheet so the glowing targets can be seen.
    if (phone && ui.sheetOpen && !lit && (v.ghost || (v.selection && v.targets.length > 0 && !v.menu && !v.choices))) ui.sheetOpen = false;
  }

  function showToast(text: string): void {
    toast.textContent = text;
    toast.hidden = false;
    toast.classList.remove('show');
    void toast.offsetWidth; // restart the fade
    toast.classList.add('show');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.hidden = true; toast.classList.remove('show'); }, TOAST_MS);
  }

  // ── Room → table + play ─────────────────────────────────────────────────────
  function syncRoom(r: Room): void {
    const prev = room;
    room = r;
    const g = r.game!;
    const json = prev?.game === g ? gameJson : JSON.stringify(g);
    const gameChanged = json !== gameJson;
    gameJson = json;
    const colors = r.seats.map(s => s.color as PlayerColor);
    const ck = colors.join(',');
    if (ck !== colorsKey && table) { colorsKey = ck; table.setPlayerColors(colors); }
    if (gameChanged && table) {
      const grew = g.board.length !== boardSize;
      boardSize = g.board.length;
      table.setGame(g);
      // Until the player moves the camera, keep the whole (growing) board in view.
      if (grew && !userCamera) table.recenter();
    }
    const s = ctrl.mySeat;
    if (gameChanged || s !== seat) { seat = s; play.update(g, s as PlayerId | null); }
    if (r.seq !== lastSeq) {
      if (lastSeq !== -1 && r.lastEvents.some(e => e.kind === 'roll')) {
        const items = r.lastEvents.flatMap(e => (e.kind === 'activated' ? [{ pieceId: e.pieceId, seat: e.seat, outcome: e.outcome }] : []));
        const f: Flash = { seq: r.seq, items };
        flash = f;
        setTimeout(() => { if (flash === f) { flash = null; schedule(); } }, FLASH_MS);
      }
      lastSeq = r.seq;
    }
  }

  // ── Drawing ─────────────────────────────────────────────────────────────────
  function schedule(): void {
    if (queued || disposed) return;
    queued = requestAnimationFrame(render);
  }

  const slot = (name: string, ...c: Child[]): HTMLElement => h('div', { class: `tg-slot ${name}` }, ...c);

  function context(): Ctx | null {
    const r = room;
    if (!r || !r.game) return null;
    return {
      ctrl, room: r, game: r.game, me: ctrl.mySeat, view: play.view, play, ui, phone, landscape: phone && isLandscapePhone(),
      redraw: schedule,
      camera: {
        rotate: () => table?.rotateBy(1),
        recenter: (): void => { userCamera = false; table?.recenter(); },
        topDown: (on) => table?.setTopDown(on),
      },
    };
  }

  function confirmAnchor(ctx: Ctx): string | null {
    const v = ctx.view;
    if (v.ghost) return JSON.stringify({ kind: 'cell', q: v.ghost.q, r: v.ghost.r });
    // A bar with only "cancel" stays docked, so it never covers the next point to tap.
    if (v.confirmBar?.confirm && lastTap) return JSON.stringify(lastTap);
    return null;
  }

  function render(): void {
    queued = 0;
    if (disposed) return;
    const ctx = context();
    if (!ctx) return;
    phone = isPhoneLayout();
    const parts: Child[] = phone
      ? [
        slot('banner', connectionBanner(ctrl)), slot('err', errorStrip(ctx)),
        slot('top', h('div', { class: 'tg-toprow' }, menuButton(ctx), seatChips(ctx))),
        slot('menu', gameMenu(ctx)), slot('seatpop', seatDetails(ctx)),
        slot('cam', cameraButtons(ctx)), slot('roll', rollChip(ctx)),
        slot('flash', flashMarkers(ctx, flash)), slot('prompts', ctx.ui.sheetOpen && !ctx.landscape ? null : promptCards(ctx)),
        slot('bmenu', buildingMenu(ctx)), slot('confirm', confirmBar(ctx, confirmAnchor(ctx))),
        slot('choices', choicesPanel(ctx)), slot('sheet', phoneSheet(ctx)),
        slot('over', gameOverCard(ctx)), slot('modal', cardModal(ctx)),
      ]
      : [
        slot('banner', connectionBanner(ctrl)), slot('err', errorStrip(ctx)),
        slot('menubtn', menuButton(ctx)), slot('menu', gameMenu(ctx)),
        slot('seats', seatPlates(ctx)), slot('seatpop', seatDetails(ctx)),
        slot('cam', cameraButtons(ctx)), slot('bank', bankPanel(ctx)),
        slot('tabs', edgeTabs(ctx)), slot('side', sidePanel(ctx)),
        slot('roll', rollChip(ctx)), slot('flash', flashMarkers(ctx, flash)),
        slot('prompts', promptCards(ctx)), slot('bmenu', buildingMenu(ctx)),
        slot('confirm', confirmBar(ctx, confirmAnchor(ctx))), slot('choices', choicesPanel(ctx)),
        slot('turnbar', turnBar(ctx)), slot('yours', yourPanel(ctx)),
        slot('over', gameOverCard(ctx)), slot('modal', cardModal(ctx)),
      ];
    const fresh = h('div', { class: `tg-hud ${phone ? 'phone' : 'desk'}${ctx.ui.sheetOpen ? ' sheet-open' : ''}${ctx.view.myTurn ? ' my-turn' : ''}` }, ...parts);
    morph(hud, fresh);
    root.classList.toggle('phone', phone);
    root.classList.toggle('landscape', ctx.landscape);
    measureFree();
    placeAnchors();
    syncTable(ctx);
    tick();
  }

  function syncTable(ctx: Ctx): void {
    if (!table) return;
    const v = ctx.view;
    const color = seatColor(ctx.room, ctx.me) as PlayerColor;
    const tk = JSON.stringify(v.targets) + color;
    if (tk !== targetsKey) { targetsKey = tk; table.setTargets(v.targets, color); }
    const gk = JSON.stringify(v.ghost);
    if (gk !== ghostKey) { ghostKey = gk; table.setGhost(v.ghost); }
  }

  // ── Layout: the free area between the panels, and HTML anchored to pieces ────
  function bottomOf(sel: string): number {
    let b = 0;
    for (const el of hud.querySelectorAll<HTMLElement>(sel)) {
      const r = el.getBoundingClientRect();
      if (r.height > 0) b = Math.max(b, r.bottom);
    }
    return b;
  }

  function topOf(sel: string, fallback: number): number {
    let t = fallback;
    for (const el of hud.querySelectorAll<HTMLElement>(sel)) {
      const r = el.getBoundingClientRect();
      if (r.height > 0) t = Math.min(t, r.top);
    }
    return t;
  }

  function measureFree(): void {
    const W = window.innerWidth, H = window.innerHeight;
    const landscape = phone && isLandscapePhone();
    const top = Math.max(phone ? 60 : 70, bottomOf(phone ? '.tg-toprow' : '.tg-seats')) + 8;
    const bottom = landscape ? H - 8 : topOf(phone ? '.tg-sheet' : '.tg-turnbar', H) - 8;
    const sideLeft = landscape ? topOfLeft('.tg-sheet', W) : phone ? W : topOfLeft('.tg-side', W);
    free = { left: 8, top, right: Math.min(W - 8, sideLeft - 8), bottom: Math.max(top + 80, bottom) };
    // Panels that float just above the bottom panel or sheet read its height from here.
    root.style.setProperty('--bottom-h', `${Math.round(H - bottom - 8)}px`);
    // Frame the camera to the free area. On the phone, use the collapsed sheet so pulling it up
    // does not move the table.
    if (!table || (phone && !landscape && ui.sheetOpen)) return;
    const insets: ViewInsets = { top, right: landscape ? W - sideLeft + 8 : 12, bottom: H - free.bottom, left: 12 };
    const key = `${phone ? 'p' : 'd'}:${Math.round(insets.top / 4)}:${Math.round(insets.bottom / 4)}:${Math.round(insets.right / 4)}`;
    if (key !== insetsKey) {
      const first = insetsKey === '';
      insetsKey = key;
      table.setViewport(insets, { minTilePx: phone ? PHONE_MIN_TILE_PX : 0 });
      if (first) table.recenter();
    }
  }

  function topOfLeft(sel: string, fallback: number): number {
    const el = hud.querySelector<HTMLElement>(sel);
    if (!el) return fallback;
    const r = el.getBoundingClientRect();
    return r.width > 0 ? r.left : fallback;
  }

  function tilePx(): number {
    if (!table) return 60;
    const a = table.screenPosition({ kind: 'cell', q: 0, r: 0 });
    const b = table.screenPosition({ kind: 'cell', q: 1, r: 0 });
    if (!a || !b) return 60;
    return Math.max(20, Math.min(240, Math.hypot(a.x - b.x, a.y - b.y)));
  }

  /** Screen points of the glowing targets other than `except` (to keep the confirm bar off them). */
  function litPoints(except: Target): { x: number; y: number }[] {
    if (!table) return [];
    const skip = JSON.stringify(except);
    const out: { x: number; y: number }[] = [];
    for (const t of play.view.targets) {
      if (JSON.stringify(t) === skip) continue;
      const q = table.screenPosition(t);
      if (q) out.push(q);
    }
    return out;
  }

  function placeAnchors(): void {
    const els = hud.querySelectorAll<HTMLElement>('[data-anchor]');
    if (els.length === 0) return;
    const W = window.innerWidth, H = window.innerHeight;
    const tile = tilePx();
    const placed: Rect[] = [];
    const clampX = (x: number, w: number): number => Math.max(Math.max(8, free.left), Math.min(x, Math.min(W - 8, free.right) - w));
    const clampY = (y: number, hh: number): number => {
      const lo = free.top, hi = free.bottom - hh;
      if (hi >= lo) return Math.max(lo, Math.min(y, hi));
      return Math.max(8, Math.min(y, H - 8 - hh));
    };
    // Panels first (they must not overlap each other), markers last.
    const ordered = [...els].sort((a, b) => Number(a.dataset.place === 'center') - Number(b.dataset.place === 'center'));
    for (const el of ordered) {
      let t: Target;
      try { t = JSON.parse(el.dataset.anchor ?? 'null') as Target; } catch { continue; }
      const p0 = table && t ? table.screenPosition(t) : null;
      const kind = el.dataset.place ?? 'side';
      if (!p0 && kind === 'center') { el.style.visibility = 'hidden'; continue; }
      // A panel whose piece cannot be located (table still loading) stays usable in the middle.
      const p = p0 ?? { x: (free.left + free.right) / 2, y: free.top + 40 };
      const w = el.offsetWidth, hh = el.offsetHeight;
      let x: number, y: number;
      let side: 'left' | 'right' | 'above' | 'below' = 'below';
      if (kind === 'center') {
        x = p.x - w / 2; y = p.y - hh / 2;
        const inside = p.x > free.left && p.x < free.right && p.y > free.top && p.y < free.bottom;
        el.style.visibility = inside ? '' : 'hidden';
        el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
        continue;
      }
      if (kind === 'below') {
        // The confirm bar: beside the ghost, on the side that hides the fewest glowing targets.
        // The ghost's tile reaches about half a tile from its centre each way (more across).
        const rx = tile * 0.6, ry = tile * 0.5;
        const pts = litPoints(t);
        const cands: [number, number, 'left' | 'right' | 'above' | 'below'][] = [
          [p.x - w / 2, p.y + ry + 10, 'below'], [p.x + rx + 10, p.y - hh / 2, 'right'],
          [p.x - rx - 10 - w, p.y - hh / 2, 'left'], [p.x - w / 2, p.y - ry - 10 - hh, 'above'],
        ];
        let best = Infinity;
        x = 0; y = 0;
        for (const [cx0, cy0, sd] of cands) {
          const cx = clampX(cx0, w), cy = clampY(cy0, hh);
          const covered = pts.filter(q => q.x > cx - 8 && q.x < cx + w + 8 && q.y > cy - 8 && q.y < cy + hh + 8).length;
          const coversGhost = cx < p.x + rx && cx + w > p.x - rx && cy < p.y + ry && cy + hh > p.y - ry ? 100 : 0;
          const score = covered * 10 + coversGhost + Math.hypot(cx - cx0, cy - cy0) / 20;
          if (score < best) { best = score; x = cx; y = cy; side = sd; }
        }
      } else if (!phone) {
        const gap = tile * 0.45 + 16;
        if (p.x + gap + w <= free.right) { x = p.x + gap; side = 'right'; }
        else if (p.x - gap - w >= free.left) { x = p.x - gap - w; side = 'left'; }
        else { x = clampX(p.x - w / 2, w); side = p.y - free.top > free.bottom - p.y ? 'above' : 'below'; }
        y = side === 'above' ? p.y - gap - hh : side === 'below' ? p.y + gap : p.y - Math.min(40, hh / 2);
        y = clampY(y, hh);
      } else {
        const gap = tile * 0.45 + 14;
        x = clampX(p.x - w / 2, w);
        if (p.y + gap + hh <= free.bottom) { y = p.y + gap; side = 'below'; }
        else { y = p.y - gap - hh; side = 'above'; }
        y = clampY(y, hh);
      }
      // Keep panels from covering each other: push down (or up when there is no room below).
      for (let guard = 0; guard < 6; guard++) {
        const hit = placed.find(r => x < r.right && x + w > r.left && y < r.bottom && y + hh > r.top);
        if (!hit) break;
        y = hit.bottom + 8 + hh <= Math.max(free.bottom, H - 8) ? hit.bottom + 8 : hit.top - 8 - hh;
      }
      el.style.visibility = '';
      el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
      el.dataset.side = side;
      placed.push({ left: x, top: y, right: x + w, bottom: y + hh });
      const ptr = el.querySelector<HTMLElement>(':scope > .tg-ptr');
      if (ptr) {
        if (side === 'left' || side === 'right') {
          ptr.style.top = `${Math.round(Math.max(12, Math.min(hh - 30, p.y - y - 9)))}px`;
          ptr.style.left = side === 'right' ? '-8px' : `${w - 10}px`;
        } else {
          ptr.style.left = `${Math.round(Math.max(12, Math.min(w - 30, p.x - x - 9)))}px`;
          ptr.style.top = side === 'below' ? '-8px' : `${hh - 10}px`;
        }
        // Hide the pointer when the panel had to be pushed away from its piece.
        const far = side === 'left' || side === 'right' ? (p.y < y || p.y > y + hh) : (p.x < x || p.x > x + w);
        ptr.style.display = far ? 'none' : '';
      }
    }
  }

  // ── Countdowns: text only, once a second ────────────────────────────────────
  function tick(): void {
    for (const el of root.querySelectorAll<HTMLElement>('[data-deadline]')) {
      const ms = ctrl.msLeft(Number(el.dataset.deadline));
      if (el.dataset.ring) {
        const arc = el.querySelector('.arc');
        arc?.setAttribute('stroke-dasharray', ringDash(ms ?? 0, Number(el.dataset.total)));
        const v = el.querySelector('.v');
        const s = String(Math.max(0, Math.ceil((ms ?? 0) / 1000)));
        if (v && v.textContent !== s) v.textContent = s;
        el.setAttribute('aria-label', `${clock(ms)} left`);
      } else {
        const text = (el.dataset.prefix ?? '') + clock(ms);
        if (el.textContent !== text) el.textContent = text;
      }
    }
  }

  // ── Input ───────────────────────────────────────────────────────────────────
  function onPick(hit: Target | null): void {
    if (ui.menuOpen || ui.seat !== null) {
      ui.menuOpen = false; ui.seat = null; schedule();
      if (!hit) return;
    }
    if (!hit) {
      if (phone && ui.sheetOpen) { ui.sheetOpen = false; autoOpened = false; schedule(); return; }
      if (play.view.menu) play.cancel();
      return;
    }
    lastTap = hit;
    play.tap(hit);
  }

  function onKey(e: KeyboardEvent): void {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    if (e.key === 'Escape') {
      if (ui.card !== null) ui.card = null;
      else if (ui.menuOpen || ui.seat !== null) { ui.menuOpen = false; ui.seat = null; }
      else play.cancel();
      schedule();
    } else if ((e.key === 'r' || e.key === 'R') && play.view.confirmBar?.rotate) {
      play.rotate(1);
    }
  }

  // Any interface click (except the confirm bar) moves the confirm bar's anchor off the last tap.
  hud.addEventListener('click', (e) => {
    if (!(e.target instanceof Element) || !e.target.closest('.tg-confirm')) lastTap = null;
  }, true);

  // ── Phone sheet: drag the grab handle up or down ────────────────────────────
  let drag: { y: number; id: number } | null = null;
  hud.addEventListener('pointerdown', (e) => {
    const grab = e.target instanceof Element ? e.target.closest('.tg-grab') : null;
    if (grab) drag = { y: e.clientY, id: e.pointerId };
  });
  hud.addEventListener('pointerup', (e) => {
    if (!drag || drag.id !== e.pointerId) return;
    const dy = e.clientY - drag.y;
    drag = null;
    if (Math.abs(dy) < 24) return; // a tap: the button's click toggles
    ui.sheetOpen = dy < 0;
    autoOpened = false;
    suppressClick = true;
    schedule();
  });
  let suppressClick = false;
  hud.addEventListener('click', (e) => {
    if (suppressClick && e.target instanceof Element && e.target.closest('.tg-grab')) { e.stopPropagation(); e.preventDefault(); }
    suppressClick = false;
  }, true);

  // ── Window ──────────────────────────────────────────────────────────────────
  function onResize(): void {
    table?.resize();
    const nowPortrait = window.innerHeight > window.innerWidth;
    const flipped = nowPortrait !== portrait;
    portrait = nowPortrait;
    if (flipped) insetsKey = '';
    render();
  }

  let ticker: ReturnType<typeof setInterval> | null = null;

  async function startTable(): Promise<void> {
    try {
      const mod = await import('../../table');
      if (disposed) return;
      const t = await mod.createTable(canvas);
      if (disposed) { t.dispose(); return; }
      table = t;
      loading.remove();
      colorsKey = ''; targetsKey = ''; ghostKey = ''; insetsKey = '';
      offs.push(t.onPick((hit) => onPick(hit)));
      offs.push(t.onFrame(placeAnchors));
      measureFree();
      if (room) {
        const colors = room.seats.map(s => s.color as PlayerColor);
        colorsKey = colors.join(',');
        t.setPlayerColors(colors);
        if (room.game) { t.setGame(room.game); boardSize = room.game.board.length; }
      }
      render();
    } catch (err) {
      if (disposed) return;
      const msg = err instanceof Error ? err.message : String(err);
      // eslint-disable-next-line no-console
      console.warn('The 3D table could not start', err);
      tableFailed(/webgl/i.test(msg) ? 'This browser or device does not offer WebGL (3D graphics).' : `The table could not be loaded (${msg}).`);
    }
  }

  const debug: GameDebug = {
    get table() { return table; },
    play,
    get view() { return play.view; },
    ui,
    point(t) {
      const p = table?.screenPosition(t);
      if (!p) return null;
      const r = canvas.getBoundingClientRect();
      return { x: p.x + r.left, y: p.y + r.top };
    },
    redraw: schedule,
    free: () => ({ ...free }),
  };

  return {
    el: root,
    update(): void {
      const r = ctrl.room;
      if (!r || !r.game) return;
      let changed = false;
      if (r !== room) { syncRoom(r); changed = true; }
      if (ctrl.state !== lastState) { lastState = ctrl.state; changed = true; }
      if (changed) schedule();
    },
    mounted(): void {
      document.documentElement.classList.add('tg-active');
      window.addEventListener('resize', onResize);
      window.addEventListener('keydown', onKey);
      ticker = setInterval(tick, 1000);
      (window as unknown as { __game?: GameDebug }).__game = debug;
      render();
      void startTable();
    },
    unmounted(): void {
      disposed = true;
      document.documentElement.classList.remove('tg-active');
      window.removeEventListener('resize', onResize);
      window.removeEventListener('keydown', onKey);
      if (ticker) clearInterval(ticker);
      if (toastTimer) clearTimeout(toastTimer);
      if (queued) cancelAnimationFrame(queued);
      for (const off of offs) off();
      table?.dispose();
      table = null;
      const w = window as unknown as { __game?: GameDebug };
      if (w.__game === debug) delete w.__game;
    },
  };
}
