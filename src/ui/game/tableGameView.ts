// The game screen: the 3D table filling the window with the HTML interface over it.
//
// Wiring: every room update goes to the table (setGame, seat colours) and to the play controller
// (update); every change of the play controller's view goes to the table (glowing targets, the
// ghost tile) and redraws the HTML in place; a tap on the table goes to the play controller; the
// play controller's moves go to the session, and a refusal comes back as play.refused(...).
// HTML anchored to pieces (building menu, prompts, confirm bar) is positioned from
// table.screenPosition() after each redraw and after each table frame (camera moves).
// The 3D library is loaded only when this screen opens (dynamic import).
//
// N8: room updates pass through the stage (./stage.ts, the playback queue). The table and the
// panels show the *displayed* room, which lags the newest while moves are animated; lit targets,
// the primary button, menus, prompts and the confirm bar come from the newest state and are only
// offered once the picture has caught up (any input before that just catches it up).

import './game.css';
import type { AppController, AppState } from '../../app/controller';
import type { Action } from '../../engine/actions';
import type { GameState, PieceType, PlayerId } from '../../engine/state';
import { PlayController, reshuffledBy } from '../../play';
import type { PlayView } from '../../play';
import type { Room } from '../../session/room';
import type { PlayerColor, Table, Target, ViewInsets } from '../../table/types';
import { connectionBanner } from '../common';
import type { Child } from '../dom';
import { h, morph } from '../dom';
import type { View } from '../menuView';
import { tableFailed } from '../viewPref';
import { bankPanel } from './bank';
import type { Ctx, FeelCtl, PlayInput } from './context';
import { activePlayer, clock, initialUi, seatColor, seatHex, seatName } from './context';
import type { Flash } from './feedback';
import { errorStrip, flashMarkers, rollChip, skipButton, storageStrip } from './feedback';
import { appliedSince, refusalIsStale, type SentMove } from './refusals';
import { outcomeOf, outcomeText, update as updateOutcome, type RollOutcome } from './rollOutcome';
import { planTransition } from '../../table/transition';
import { tableSeat } from '../../table/seat';
import type { Feel, Haptic } from './feel';
import { canVibrate, deviceStorage, loadFeel, prefersReducedMotion, saveFeel, vibrate } from './feel';
import { movingPortals, onPortalMotionChange } from '../portalPref';
import { FxLayer } from './fx';
import { Sound } from './sound';
import { Stage, type Shown, type StageHost } from './stage';
import { allowPress, observe, type Seen } from './pressGuard';
import { placeAll, type AnchorItem, type Pt } from './anchors';
import { refusalText } from '../../app/gameText';
import { DUR } from '../../table/transition';
import { cameraButtons, gameMenu, menuButton } from './gameMenu';
import { queueView } from './queueView';
import { revealedStack, upcomingTurnOrder } from '../../engine';
import type { Preview as TablePreview } from '../../table/types';
import type { Preview as WirePreview } from '../../session/preview';
import { gameOverCard } from './gameOver';
import { ringDash } from './pieces';
import { buildingMenu, cardModal, choicesPanel } from './popovers';
import { promptCards } from './prompts';
import { seatChips, seatDetails, seatPlates } from './seats';
import { edgeTabs, sidePanel } from './sidePanel';
import { confirmBar, turnBar } from './turnBar';
import { handPopover, phoneSheet, yourPanel } from './yourArea';
import { fitHand } from './handFit';
import { carve } from './freeArea';
import { icon } from '../icons';
import { W } from '../../play/words';

/** Phone layout below this width, or when the window is portrait and narrow. */
const PHONE_MAX_W = 760;
const FLASH_MS = 2600;
const TOAST_MS = 4500;
/** A card played as soon as it was drawn stays announced this long (or until closed). */
const ANNOUNCE_MS = 10_000;
/** The roll outcome stays open this long after it appears (or until the first tap on the table). */
const ROLL_OPEN_MS = 6000;
/** Floating panels the board is framed clear of (desktop, phone). The notices at the top are not: each closes with one tap on its ✕ ([data-dismiss]). */
const DESK_PANELS = '.tg-roll.has-line, .tg-bank, .tg-choices, .tg-confirm.docked';
const PHONE_PANELS = '.tg-roll.has-line, .tg-choices, .tg-confirm.docked';
/** Smallest tile size when framing on a phone, so tiles stay comfortable to tap (pinch out for more). */
const PHONE_MIN_TILE_PX = 64;

/** Below this height the desktop panels leave too little table, so the phone layout is used. */
const PHONE_MAX_H = 560;

/** The order the end of the round and the next round use (engine), or null if it cannot be worked out. */
function safeUpcoming(g: GameState): readonly PlayerId[] | null {
  try { return upcomingTurnOrder(g); } catch { return null; }
}

/** A pressed move control shows "Sending…" when the host has not answered after this long. */
const SENDING_AFTER_MS = 400;

/** The page exposes window.__game (for scripted checks) only in development or with ?debug. */
function debugWanted(): boolean {
  try { return import.meta.env.DEV || new URLSearchParams(location.search).has('debug'); } catch { return false; }
}

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
  /** What the interface offers now (nothing lit while the picture is catching up). */
  readonly view: PlayController['view'];
  /** The picture shows the newest state (no animation playing or waiting). */
  readonly drained: boolean;
  /** Milliseconds until the newest state is fully shown. */
  readonly lag: number;
  /** seq of the room on screen. */
  readonly shownSeq: number;
  /** Inputs that arrived while the picture lagged (each only caught the picture up). */
  readonly blocked: number;
  /** Refusals not shown because the room already showed the move made. */
  readonly staleRefusals: number;
  /** Other players' previews on this table now, by seat (null: none). */
  readonly previews: Record<number, unknown>;
  readonly stage: Stage;
  readonly feel: FeelCtl;
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
  const fx = new FxLayer();
  root.append(canvas, hud, fx.el, toast, loading);

  // ── Feel: animation speed, sound, vibration ─────────────────────────────────
  let feelState: Feel = loadFeel(deviceStorage(), prefersReducedMotion());
  const sound = new Sound();
  sound.enabled = feelState.sound;
  const feel: FeelCtl = {
    get settings() { return feelState; },
    set(patch) {
      const before = feelState;
      feelState = { ...feelState, ...patch };
      saveFeel(deviceStorage(), feelState);
      sound.enabled = feelState.sound;
      if (feelState.speed !== before.speed) stage.setSpeed(feelState.speed);
      if (patch.vibrate) haptic('confirm');
    },
    canVibrate: canVibrate(),
  };
  const haptic = (kind: Haptic): void => vibrate(kind, feelState);
  const unlockAudio = (): void => sound.unlock();

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
  let phone = isPhoneLayout();
  let portrait = window.innerHeight > window.innerWidth;
  let queued = 0;
  let insetsKey = '';
  let free: Rect = { left: 8, top: 80, right: window.innerWidth - 8, bottom: window.innerHeight - 260 };
  let toastTimer: ReturnType<typeof setTimeout> | null = null;
  /** Where the last table tap was (a hint it causes is shown there). */
  let tapToastAt: { x: number; y: number; t: number } | null = null;
  let lastHint: string | null = null;
  /** The phone sheet was closed by the player while these modules were lit: do not reopen it for them. */
  let sheetDismissedFor: string | null = null;
  // Double-tap guard (pressGuard.ts): what each move control showed, and when the picture last changed.
  let seenByEl = new WeakMap<Element, Seen>();
  let stateChangedAt = -1e9;
  // A move in flight: which control was pressed and when, to show "Sending…" after a moment.
  let pressedEl: Element | null = null;
  let sendStartedAt = 0;
  let sendingTimer: ReturnType<typeof setTimeout> | null = null;
  let lastPending = false;
  const anchorCache = new Map<string, Target | null>();
  let litCache: { view: unknown; list: { key: string; t: Target }[] } = { view: null, list: [] };
  let autoOpened = false;
  let boardSize = 0;
  /** The room on screen (from the stage) and the controller that describes it while it lags. */
  let shownRoom: Room | null = null;
  const displayPlay = new PlayController({ send: (): void => undefined, names: (id): string => seatName(room ?? ctrl.room!, id) });
  let displayGame: GameState | null = null;
  let displaySeat: number | null = null;
  let blocked = 0;
  /** Refusals dropped because the move had been made anyway (refusals.ts). */
  let staleRefusals = 0;
  let lastCannotStore = false;
  // Previews (unconfirmed choices): mine, as shown and sent; others', with the move number they belong to.
  let routeKey = '';
  let ownPreviewKey = '';
  const otherPreviews = new Map<number, { p: WirePreview; seq: number }>();
  const shownPreviewKeys = new Map<number, string>();
  /** The last roll's outcome (events of the roll, then runs and skips of what it activated). */
  let outcome: RollOutcome | null = null;
  let promptIds = new Set<string>();
  let flashTimer: ReturnType<typeof setTimeout> | null = null;
  let announceTimer: ReturnType<typeof setTimeout> | null = null;
  let rollTimer: ReturnType<typeof setTimeout> | null = null;
  /** The player has dragged or zoomed the table (until they press Re-centre). */
  let userCamera = false;
  const offs: (() => void)[] = [];
  let downAt: { x: number; y: number } | null = null;
  canvas.addEventListener('pointerdown', (e) => {
    downAt = { x: e.clientX, y: e.clientY };
    // The first tap on the table puts away what floats over it for reading: the roll outcome and,
    // on the phone, the opened turn order.
    if (ui.rollOpen || ui.queueOpen) { ui.rollOpen = false; ui.queueOpen = false; schedule(); }
  });
  canvas.addEventListener('pointermove', (e) => {
    if (downAt && e.buttons && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 8) userCamera = true;
  });
  canvas.addEventListener('pointerup', () => { downAt = null; });
  canvas.addEventListener('wheel', () => { userCamera = true; }, { passive: true });

  // ── Play controller ─────────────────────────────────────────────────────────
  const send = (action: Action): void => {
    const client = ctrl.state.online?.client;
    if (!client) { refuse('Not connected to the game.'); return; }
    if (client.pending) return; // input is locked while a move is in flight; never a refusal
    sendStartedAt = performance.now();
    // A move made: the opened turn order (phone) gives the table back.
    if (ui.queueOpen) ui.queueOpen = false;
    if (sendingTimer) clearTimeout(sendingTimer);
    sendingTimer = setTimeout(() => { sendingTimer = null; schedule(); }, SENDING_AFTER_MS + 10);
    const me = ctrl.mySeat;
    const sent: SentMove | null = me === null ? null : { action, seat: me, seq: ctrl.room?.seq ?? 0 };
    client.act(action).then(
      (res) => {
        if (disposed) return;
        schedule();
        // BUSY only means another move was still in flight: ignore it (the selection stays).
        if (res.ok || res.error.code === 'BUSY') return;
        // During a host change the same move can be applied and then refused as a second copy
        // (refusals.ts): when the room already shows it made, the refusal is not shown.
        const now = ctrl.state.online?.client;
        if (sent && now?.room && refusalIsStale(res.error.code, sent, appliedSince(now.journal, now.room.log, sent.seq))) { staleRefusals++; return; }
        refuse(refusalText(res.error));
      },
      () => { if (!disposed) { schedule(); refuse('The move could not be sent.'); } },
    );
  };
  const refuse = (message: string): void => {
    play.refused(message);
    sound.play('refuse');
    haptic('refuse');
  };
  const play = new PlayController({ send, names: (id): string => seatName(room ?? ctrl.room!, id) });
  offs.push(play.subscribe(() => { onPlayChange(); schedule(); }));

  function onPlayChange(): void {
    const v = play.view;
    // The same hint is shown once, not again on every redraw (each rotate, each tap that changes nothing).
    if (v.hint && v.hint !== lastHint) showToast(v.hint);
    lastHint = v.hint;
    if (!v.confirmBar) lastTap = null;
    // Panels follow the newest state only once the picture has caught up with it.
    if (!stage.drained) return;
    // Phone: the module tray lives in the sheet, so open it when a module must be chosen there.
    const lit = v.tray.some(t => t.state === 'lit') && (v.step === 'actions' || v.step === 'roundEnd');
    const litKey = lit ? `${v.instruction}|${v.tray.filter(t => t.state === 'lit').map(t => t.module).join(',')}` : null;
    // The player closed the sheet while modules were lit: leave it closed for this choice.
    if (ui.sheetUserClosed) { ui.sheetUserClosed = false; sheetDismissedFor = litKey; autoOpened = false; }
    if (litKey === null) sheetDismissedFor = null;
    if (phone && lit && !ui.sheetOpen && litKey !== sheetDismissedFor) { ui.sheetOpen = true; ui.sheetTab = 'tray'; autoOpened = true; }
    else if (phone && !lit && autoOpened) { ui.sheetOpen = false; autoOpened = false; }
    // A flow that needs the table closes the sheet so the glowing targets can be seen.
    if (phone && ui.sheetOpen && !lit && (v.ghost || (v.selection && v.targets.length > 0 && !v.menu && !v.choices))) ui.sheetOpen = false;
  }

  function showToast(text: string): void {
    toast.textContent = text;
    toast.hidden = false;
    toast.classList.remove('show');
    // Right after a tap on the table: beside the tapped spot (above it, or below near the top).
    const at = tapToastAt && performance.now() - tapToastAt.t < 600 ? tapToastAt : null;
    tapToastAt = null;
    toast.classList.toggle('at-tap', !!at);
    if (at) {
      const rr = root.getBoundingClientRect();
      // Measure with the whole width available (at left: 50% it could only take half of it).
      toast.style.left = '0px';
      toast.style.top = '0px';
      const w = toast.offsetWidth, hh = toast.offsetHeight;
      const x = Math.min(Math.max(at.x - rr.left, 12 + w / 2), rr.width - 12 - w / 2);
      const above = at.y - rr.top - hh - 22;
      toast.style.left = `${x}px`;
      toast.style.top = `${above >= 8 ? above : at.y - rr.top + 22}px`;
    } else {
      toast.style.left = '';
      toast.style.top = '';
    }
    void toast.offsetWidth; // restart the fade
    toast.classList.add('show');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.hidden = true; toast.classList.remove('show'); }, TOAST_MS);
  }

  // ── Room → stage (table + panels) and play ─────────────────────────────────
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
    stage.receive(r);
    const s = ctrl.mySeat;
    if (gameChanged || s !== seat) {
      // A seat taken (or left) mid-game: the default view moves to that player's side of the table.
      if (s !== seat) applyHomeView(g, s);
      seat = s; play.update(g, s as PlayerId | null);
    }
  }

  /** Look from the player's own side of the table (seat.ts); the table keeps a view the player moved. */
  function applyHomeView(g: GameState, me: number | null): void {
    table?.setHomeView(tableSeat(g.turnOrder, me), g.turnOrder.length);
  }

  /** The stage put a new room on screen (a snap, or the start of its transition). */
  function onShown(info: Shown): void {
    const prev = shownRoom;
    shownRoom = info.room;
    if (!prev || prev.seq !== info.room.seq) {
      stateChangedAt = performance.now();
      if (ownPreviewKey && ctrl.mySeat !== null) table?.setPreview(ctrl.mySeat, null);
      ownPreviewKey = '';
    }
    const g = info.room.game!;
    if (table) {
      const grew = g.board.length !== boardSize;
      boardSize = g.board.length;
      // Until the player moves the camera, keep the whole (growing) board in view: the camera
      // moves only when something would be out of view, and never zooms in (framing.ts).
      if (grew && !userCamera && prev) table.keepInView();
    }
    noteRollOutcome(prev, info);
    if (prev && info.room.seq !== prev.seq) {
      if (info.room.lastEvents.some(e => e.kind === 'roll')) {
        // The activation markers appear as the dice land.
        const wait = info.plan?.roll ? DUR.dice * info.scale : 0;
        ui.diceRolling = wait > 0;
        const items = info.room.lastEvents.flatMap(e => (e.kind === 'activated' ? [{ pieceId: e.pieceId, seat: e.seat, outcome: e.outcome }] : []));
        const f: Flash = { seq: info.room.seq, items };
        if (flashTimer) clearTimeout(flashTimer);
        flashTimer = setTimeout(() => {
          ui.diceRolling = false;
          flash = f;
          setTimeout(() => { if (flash === f) { flash = null; schedule(); } }, FLASH_MS);
          schedule();
        }, wait);
      }
      cues(prev, info.room);
      announcePlayOnDraw(info.room, prev.game ? reshuffledBy(prev.game, info.room.lastEvents) : 0);
    }
    schedule();
  }

  /**
   * A Leverage card played as soon as it was drawn, and a discard pile shuffled into a new deck
   * (a card bought from an empty deck): say so on the table, for the buyer and everyone else.
   */
  function announcePlayOnDraw(r: Room, reshuffled: number): void {
    const bought = r.lastEvents.find(e => e.kind === 'cardBought');
    const ev = r.lastEvents.find(e => e.kind === 'cardBought' && e.playedOnDraw);
    const shuffleText = reshuffled > 0 ? W.reshuffled(reshuffled) : '';
    if (!ev || ev.kind !== 'cardBought' || !ev.card || !r.game) {
      if (!shuffleText || !bought) return;
      setAnnounce({ seq: r.seq, seat: bought.seat, text: shuffleText });
      return;
    }
    const you = ev.seat === ctrl.mySeat;
    const n = ev.card === 'overstockSupplies' ? r.game.overstockPieces.length : 0;
    setAnnounce({ seq: r.seq, seat: ev.seat, text: `${shuffleText ? `${shuffleText} ` : ''}${W.playOnDraw(ev.card, seatName(r, ev.seat), n, you)}` });
  }

  function setAnnounce(a: { seq: number; seat: number; text: string }): void {
    ui.announce = a;
    if (announceTimer) clearTimeout(announceTimer);
    announceTimer = setTimeout(() => { if (ui.announce === a) { ui.announce = null; schedule(); } }, ANNOUNCE_MS);
  }

  function announceStrip(ctx: Ctx): HTMLElement | null {
    const a = ctx.ui.announce;
    if (!a) return null;
    return h('div', { class: 'tg-announce', style: `--seat:${seatHex(ctx.room, a.seat)}`, attrs: { role: 'status', 'data-dismiss': 'close' } },
      icon('card'), h('span', { class: 'tx', text: a.text }),
      h('button', { class: 'x round small', title: 'Close', attrs: { 'aria-label': 'Close' }, onclick: () => { ui.announce = null; schedule(); } }, icon('cross')));
  }

  /** What the last roll produced, for the roll chip and the log (from the room's events). */
  function noteRollOutcome(prev: Room | null, info: Shown): void {
    const r = info.room;
    if (prev && prev.seq === r.seq) return;
    const events = r.lastEvents;
    if (events.some(e => e.kind === 'roll')) {
      // Ore that flowed out of the Mines on this roll, from the same plan the animation uses.
      let ore = 0;
      try {
        const plan = info.plan ?? (prev?.game && r.game ? planTransition(prev.game, r.game, events) : null);
        ore = plan ? plan.steps.filter(s => s.kind === 'flow' && s.material === 'ore').length : 0;
      } catch { ore = 0; }
      outcome = outcomeOf(r.seq, events, ore);
      // A new roll: its outcome opens in full (and shrinks again after a while or the first tap).
      ui.rollOpen = true;
      if (rollTimer) { clearTimeout(rollTimer); rollTimer = null; }
    } else if (outcome) {
      outcome = updateOutcome(outcome, events);
    }
    if (!outcome) { ui.rollOutcome = null; return; }
    const text = outcomeText(outcome, (seat) => seatName(r, seat), ctrl.mySeat);
    ui.rollOutcome = { seq: outcome.seq, roller: outcome.roller, total: outcome.total, dice: outcome.dice, text };
    ui.rollNotes = { ...ui.rollNotes, [outcome.seq]: text };
    const keys = Object.keys(ui.rollNotes).map(Number).sort((a, b) => a - b);
    for (const k of keys.slice(0, Math.max(0, keys.length - 40))) delete ui.rollNotes[k];
  }

  /** Your turn, game over: sound, vibration and the banner, when the picture reaches them. */
  function cues(prev: Room, next: Room): void {
    const a = prev.game, b = next.game;
    const me = ctrl.mySeat;
    if (!a || !b) return;
    if (!a.gameOver && b.gameOver) {
      // Nothing may stay open over the game-over card.
      ui.menuOpen = false; ui.seat = null; ui.card = null; ui.sheetOpen = false; ui.side = null;
      sound.play('over');
      return;
    }
    if (me === null || b.gameOver) return;
    if (activePlayer(a) !== me && activePlayer(b) === me) {
      fx.yourTurn(seatHex(next, me), 'Your turn', feelState.speed === 'off');
      sound.play('turn');
      haptic('turn');
    }
  }

  const stageHost: StageHost = {
    table: () => table,
    me: () => ctrl.mySeat,
    feel: () => feelState,
    sound,
    fx,
    point: (t) => (t ? debug.point(t) : null),
    seatPoint: (player) => {
      const mine = player === ctrl.mySeat;
      const el = hud.querySelector<HTMLElement>(mine ? (phone ? '.tg-sheet' : '.tg-yours') : `[data-seat="${player}"]`);
      const r = el?.getBoundingClientRect();
      if (!r || r.width === 0) return { x: window.innerWidth / 2, y: mine ? window.innerHeight - 40 : 40 };
      return mine ? { x: r.left + Math.min(r.width / 2, 160), y: r.top + 28 } : { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    },
    seatColor: (player) => seatHex(room ?? ctrl.room!, player),
    centre: () => ({ x: (free.left + free.right) / 2, y: (free.top + free.bottom) / 2 }),
    shown: onShown,
    drained: () => { onPlayChange(); schedule(); },
  };
  const stage = new Stage(stageHost);

  /** While the picture lags: nothing lit, nothing to press (the view describes the displayed state). */
  function busyView(v: PlayView): PlayView {
    return {
      ...v,
      primary: v.primary ? { label: v.primary.label, enabled: false } : null,
      targets: [], ghost: null, confirmBar: null, selection: null, menu: null, choices: null, prompts: [], hint: null, route: null, meeplePick: null,
      tray: v.tray.map(t => (t.state === 'lit' ? { module: t.module, state: 'inTray' as const } : t)),
      bank: v.bank.map(({ reason: _r, ...b }) => ({ ...b, enabled: false })),
      inventory: v.inventory.map(({ reason: _r, ...b }) => ({ ...b, enabled: false })),
      hand: v.hand.map(({ reason: _r, ...c }) => ({ ...c, enabled: false })),
    };
  }

  /** Any input while the picture lags only catches the picture up. */
  const catchUp = (): void => { blocked++; stage.skip(); };
  const busyInput: PlayInput = { tap: catchUp, choose: catchUp, primary: catchUp, confirm: catchUp, cancel: catchUp, rotate: catchUp };
  /** While a move is in flight, or a bot plays this seat: input does nothing. */
  const ignore = (): void => { blocked++; };
  const lockedInput: PlayInput = { tap: ignore, choose: ignore, primary: ignore, confirm: ignore, cancel: ignore, rotate: ignore };

  /** Why input is locked now: the host closed the connection, a move in flight, or a bot (autoplay or the host's stand-in) plays my seat. */
  function lockReason(): 'closed' | 'sending' | 'bot' | null {
    // The host closed this device's connection (removed this player, ended the room, ...): the
    // game shown is no longer live, and nothing can be sent.
    if (ctrl.state.connection === 'closed') return 'closed';
    const me = ctrl.mySeat;
    if (me === null) return null;
    if (ctrl.state.autoplay || ctrl.room?.seats[me]?.autopilot) return 'bot';
    if (ctrl.state.online?.client.pending) return 'sending';
    return null;
  }
  const liveInput: PlayInput = {
    tap: (t) => play.tap(t),
    choose: (id) => play.choose(id),
    primary: () => { if (play.view.primary?.enabled) haptic('confirm'); play.primary(); },
    confirm: () => { haptic('confirm'); play.confirm(); },
    cancel: () => play.cancel(),
    rotate: (n) => play.rotate(n),
  };

  // ── Drawing ─────────────────────────────────────────────────────────────────
  function schedule(): void {
    if (queued || disposed) return;
    queued = requestAnimationFrame(render);
  }

  const slot = (name: string, ...c: Child[]): HTMLElement => h('div', { class: `tg-slot ${name}` }, ...c);

  function context(): Ctx | null {
    const newest = room;
    const shown = shownRoom ?? newest;
    if (!newest || !shown || !shown.game) return null;
    const busy = !stage.drained;
    const me = ctrl.mySeat;
    // The displayed room, with the newest seats, settings and deadlines.
    const r: Room = shown === newest ? shown : {
      ...shown, seats: newest.seats, hostSeat: newest.hostSeat, waiting: newest.waiting, settings: newest.settings,
      opDeadline: newest.opDeadline, roundEndDeadline: newest.roundEndDeadline, hold: newest.hold,
    };
    const lock = lockReason();
    // A bot plays this seat: nothing to press. A move in flight: nothing lit, and the controls stay
    // where they are (inert) so the pressed one can say it is sending.
    let view = lock === 'bot' || lock === 'closed' ? busyView(play.view) : lock === 'sending' ? { ...play.view, targets: [] } : play.view;
    if (busy) {
      if (displayGame !== shown.game || displaySeat !== me) {
        displayGame = shown.game;
        displaySeat = me;
        displayPlay.update(shown.game, me as PlayerId | null);
      }
      view = busyView(displayPlay.view);
    }
    return {
      ctrl, room: r, game: shown.game, me, view, play: lock ? lockedInput : busy ? busyInput : liveInput, ui, phone, landscape: phone && isLandscapePhone(),
      feel, busy, skip: () => stage.skip(),
      upcomingOrder: safeUpcoming(shown.game),
      redraw: schedule,
      camera: {
        rotate: () => table?.rotateBy(1),
        recenter: (): void => { userCamera = false; table?.recenter(); },
        topDown: (on) => table?.setTopDown(on),
      },
    };
  }

  /** Notices at the top of the table: a failed menu command, and the storage warning. */
  function notes(ctx: Ctx): HTMLElement | null {
    // On the phone the storage notice sits at the top of the bottom sheet instead (yourArea.ts).
    const a = errorStrip(ctx), b = ctx.phone ? null : storageStrip(ctx), c = announceStrip(ctx);
    return a || b || c ? h('div', { class: 'tg-notes' }, a, b, c) : null;
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
    // The layout first: the context below carries it (ctx.phone) to every part.
    phone = isPhoneLayout();
    const ctx = context();
    if (!ctx) return;
    // The connection was closed by the host (this player was removed, the room ended, ...): the
    // table stays as a still picture behind a panel that says why, with the ways on. No turn
    // bar, prompts or controls: nothing here is live any more.
    const ended = lockReason() === 'closed';
    const parts: Child[] = ended
      ? [slot('ended', h('div', { class: 'tg-ended' }, connectionBanner(ctrl)))]
      : phone
      ? [
        slot('banner', connectionBanner(ctrl)), slot('err', notes(ctx)),
        slot('top', h('div', { class: 'tg-toprow' }, menuButton(ctx), seatChips(ctx))), slot('queue', queueView(ctx)),
        slot('menu', gameMenu(ctx)), slot('seatpop', seatDetails(ctx)),
        slot('cam', cameraButtons(ctx)), slot('roll', rollChip(ctx)), slot('skip', skipButton(ctx)),
        slot('flash', flashMarkers(ctx, flash)), slot('deciding', previewLabels(ctx)), slot('prompts', ctx.ui.sheetOpen && !ctx.landscape ? null : promptCards(ctx)),
        slot('bmenu', buildingMenu(ctx)), slot('confirm', confirmBar(ctx, confirmAnchor(ctx))),
        slot('choices', choicesPanel(ctx)), slot('sheet', phoneSheet(ctx)),
        slot('over', gameOverCard(ctx)), slot('modal', cardModal(ctx)),
      ]
      : [
        slot('banner', connectionBanner(ctrl)), slot('err', notes(ctx)),
        slot('menubtn', menuButton(ctx)), slot('queue', queueView(ctx)), slot('menu', gameMenu(ctx)),
        slot('seats', seatPlates(ctx)), slot('seatpop', seatDetails(ctx)),
        slot('cam', cameraButtons(ctx)), slot('bank', bankPanel(ctx)),
        slot('tabs', edgeTabs(ctx)), slot('side', sidePanel(ctx)),
        slot('roll', rollChip(ctx)), slot('skip', skipButton(ctx)), slot('flash', flashMarkers(ctx, flash)), slot('deciding', previewLabels(ctx)),
        slot('prompts', promptCards(ctx)), slot('bmenu', buildingMenu(ctx)),
        slot('confirm', confirmBar(ctx, confirmAnchor(ctx))), slot('choices', choicesPanel(ctx)),
        slot('turnbar', turnBar(ctx)), slot('yours', yourPanel(ctx)), slot('handpop', handPopover(ctx)),
        slot('over', gameOverCard(ctx)), slot('modal', cardModal(ctx)),
      ];
    const fresh = h('div', { class: `tg-hud ${phone ? 'phone' : 'desk'}${ctx.ui.sheetOpen ? ' sheet-open' : ''}${ctx.view.myTurn && !ended ? ' my-turn' : ''}${ctx.busy ? ' busy' : ''}${ended ? ' ended' : ''}` }, ...parts);
    morph(hud, fresh);
    root.classList.toggle('phone', phone);
    root.classList.toggle('landscape', ctx.landscape);
    if (!phone) fitHand(hud.querySelector<HTMLElement>('.tg-yours'));
    observeControls();
    syncRollTimer();
    measureFree();
    placeAnchors();
    syncTable(ctx);
    tick();
    promptCue(ctx);
  }

  /** Record what each move control shows now (double-tap guard) and mark the one sending. */
  function observeControls(): void {
    const now = performance.now();
    for (const el of hud.querySelectorAll<HTMLElement>('[data-act]')) seenByEl.set(el, observe(seenByEl.get(el), el.dataset.act ?? '', now));
    const pending = !!ctrl.state.online?.client.pending;
    const showSending = pending && now - sendStartedAt >= SENDING_AFTER_MS;
    for (const el of hud.querySelectorAll('[data-sending]')) if (el !== pressedEl || !showSending) el.removeAttribute('data-sending');
    if (showSending && pressedEl?.isConnected) pressedEl.setAttribute('data-sending', '1');
    if (!pending) pressedEl = null;
  }

  // A press on a move control that just changed under the finger is dropped (see pressGuard.ts).
  // A tap anywhere outside the opened turn order (phone) closes it.
  hud.addEventListener('pointerdown', (e) => {
    if (ui.queueOpen && !(e.target instanceof Element && e.target.closest('.tg-queue'))) { ui.queueOpen = false; schedule(); }
  }, true);

  hud.addEventListener('click', (e) => {
    const el = e.target instanceof Element ? e.target.closest<HTMLElement>('[data-act]') : null;
    if (!el) return;
    const ok = allowPress(seenByEl.get(el), el.dataset.act ?? '', performance.now(), { strict: el.dataset.strict === '1', stateChangedAt });
    if (!ok) { blocked++; e.stopImmediatePropagation(); e.preventDefault(); return; }
    pressedEl = el;
  }, true);

  /** A new off-turn decision for me, once it is shown: alert sound and vibration. */
  function promptCue(ctx: Ctx): void {
    const ids = new Set(ctx.view.prompts.map(p => p.id));
    if (!ctx.busy && !ctx.view.myTurn && [...ids].some(id => !promptIds.has(id))) {
      sound.play('alert');
      haptic('prompt');
    }
    if (!ctx.busy) promptIds = ids;
  }

  function syncTable(ctx: Ctx): void {
    if (!table) return;
    const v = ctx.view;
    const color = seatColor(ctx.room, ctx.me) as PlayerColor;
    const tk = JSON.stringify(v.targets) + color;
    if (tk !== targetsKey) { targetsKey = tk; table.setTargets(v.targets, color); }
    // My own choice is shown as the same preview the others see (one piece, not two): the local
    // ghost remains only for a space that would not be valid.
    const ghost = v.ghost && !v.ghost.valid ? v.ghost : null;
    const gk = JSON.stringify(ghost);
    if (gk !== ghostKey) { ghostKey = gk; table.setGhost(ghost); }
    const rk = JSON.stringify(v.route) + color;
    if (rk !== routeKey) { routeKey = rk; table.setRoute(v.route, color); }
    syncOwnPreview(ctx);
    syncOtherPreviews(ctx);
  }

  /** My unconfirmed piece or meeple: on my table and sent to the others; kept through the confirm. */
  function syncOwnPreview(ctx: Ctx): void {
    const me = ctx.me, v = ctx.view;
    if (!table || me === null || ctx.busy) return;
    let tp: TablePreview | null = null;
    let wire: WirePreview | null = null;
    if (v.ghost && v.ghost.valid) {
      tp = { k: 'piece', pieceType: v.ghost.pieceType, q: v.ghost.q, r: v.ghost.r, rotation: v.ghost.rotation };
      wire = { k: 'piece', q: v.ghost.q, r: v.ghost.r, rot: ((v.ghost.rotation % 6) + 6) % 6 };
    } else if (v.meeplePick) {
      tp = { k: 'meeple', pieceId: v.meeplePick.pieceId, slot: v.meeplePick.slot };
      wire = tp;
    }
    const key = JSON.stringify(tp);
    if (key === ownPreviewKey || (ownPreviewKey === '' && !tp)) return;
    // The choice was just confirmed (move in flight): leave it until the move shows on the table.
    if (!tp && ctrl.state.online?.client.pending) return;
    ownPreviewKey = tp ? key : '';
    table.setPreview(me, tp);
    ctrl.sendPreview(wire);
  }

  /** Other players' unconfirmed choices, only for the move number the picture shows. */
  function syncOtherPreviews(ctx: Ctx): void {
    if (!table) return;
    const shownSeq = ctx.room.seq;
    const seats = new Set<number>([...otherPreviews.keys(), ...shownPreviewKeys.keys()]);
    for (const seat of seats) {
      if (seat === ctx.me) continue;
      const e = otherPreviews.get(seat);
      const tp = e && !ctx.busy && e.seq === shownSeq ? toTable(ctx.game, e.p) : null;
      const key = JSON.stringify(tp);
      if ((shownPreviewKeys.get(seat) ?? 'null') === key) continue;
      shownPreviewKeys.set(seat, key);
      table.setPreview(seat, tp);
    }
  }

  /** A preview from the wire, completed from the state: which piece it is (the drawn piece or the dropped Mine). */
  function toTable(g: GameState, p: WirePreview): TablePreview | null {
    if (p.k === 'meeple') return p;
    let type: PieceType;
    if (g.pendingMineIds.length > 0) type = 'mine';
    else {
      const si = revealedStack(g);
      const top = si === null ? undefined : g.stacks[si].pieces[0];
      if (!top) return null;
      type = top.type;
    }
    return { k: 'piece', pieceType: type, q: p.q, r: p.r, rotation: p.rot };
  }

  /** Labels by other players' previewed pieces: "Bea is deciding". */
  function previewLabels(ctx: Ctx): HTMLElement[] {
    if (ctx.busy) return [];
    const out: HTMLElement[] = [];
    for (const [seat, e] of otherPreviews) {
      if (seat === ctx.me || e.seq !== ctx.room.seq) continue;
      const anchor: Target = e.p.k === 'piece' ? { kind: 'cell', q: e.p.q, r: e.p.r }
        : e.p.slot === null ? { kind: 'piece', pieceId: e.p.pieceId } : { kind: 'mineSlot', pieceId: e.p.pieceId, slot: e.p.slot };
      out.push(h('div', {
        class: 'tg-deciding', style: `--seat:${seatHex(ctx.room, seat)}`,
        attrs: { 'data-anchor': JSON.stringify(anchor), 'data-place': 'center', role: 'status' },
      }, h('span', { class: 'lbl' }, h('span', { class: 'sw' }), `${seatName(ctx.room, seat)} is deciding`)));
    }
    return out;
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
    const top = Math.max(phone ? 60 : 70, bottomOf(phone ? '.tg-toprow, .tg-queue.phone .tg-qbtn' : '.tg-seats')) + 8;
    const bottom = landscape ? H - 8 : topOf(phone ? '.tg-sheet' : '.tg-turnbar', H) - 8;
    const sideLeft = landscape ? topOfLeft('.tg-sheet', W) : phone ? W : topOfLeft('.tg-side', W);
    const hb = hud.getBoundingClientRect();
    const base = { left: 8 + Math.max(0, hb.left), top, right: Math.min(hb.right - 8, sideLeft - 8), bottom: Math.max(top + 80, bottom) };
    // Opaque panels floating over the board are cut out of its area (freeArea.ts), so the board
    // is framed clear of them and no lit target sits underneath one.
    free = carve(base, panelRects(phone ? PHONE_PANELS : DESK_PANELS));
    // Panels that float just above the bottom panel or sheet read its height from here.
    root.style.setProperty('--bottom-h', `${Math.round(H - bottom - 8)}px`);
    // Frame the camera to the free area. On the phone, use the collapsed sheet so pulling it up
    // does not move the table.
    if (!table || (phone && !landscape && ui.sheetOpen)) return;
    // The HUD keeps to the safe area (game.css), so its edges are the notch and gesture-bar insets.
    const hr = hud.getBoundingClientRect();
    const safeL = Math.max(0, hr.left), safeR = Math.max(0, W - hr.right);
    const insets: ViewInsets = {
      top: Math.max(top, free.top),
      right: Math.max(landscape ? W - sideLeft + 8 : 12 + safeR, W - free.right),
      bottom: H - free.bottom,
      left: Math.max(12 + safeL, free.left),
    };
    const key = `${phone ? 'p' : 'd'}:${Math.round(insets.top / 4)}:${Math.round(insets.bottom / 4)}:${Math.round(insets.right / 4)}:${Math.round(insets.left / 4)}`;
    if (key !== insetsKey) {
      const first = insetsKey === '';
      insetsKey = key;
      table.setViewport(insets, { minTilePx: phone ? PHONE_MIN_TILE_PX : 0 });
      // First measure (or the screen turned): frame the table. A panel came or went: move only
      // if the board is now hidden (unless the player has moved the camera), and never zoom in,
      // so panels coming and going do not pull the view back and forth.
      if (first) table.recenter();
      else if (!userCamera) table.keepInView();
    }
  }

  /** Screen boxes of the visible floating panels matching `sel`. */
  function panelRects(sel: string): Rect[] {
    const out: Rect[] = [];
    for (const el of hud.querySelectorAll<HTMLElement>(sel)) {
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1 || getComputedStyle(el).visibility === 'hidden') continue;
      out.push({ left: r.left, top: r.top, right: r.right, bottom: r.bottom });
    }
    return out;
  }

  /** Keep the roll outcome open for a few seconds after it appears, then shrink it to the chip. */

  function syncRollTimer(): void {
    const open = ui.rollOpen && !!ui.rollOutcome && !ui.diceRolling;
    if (open && !rollTimer) rollTimer = setTimeout(() => { rollTimer = null; ui.rollOpen = false; schedule(); }, ROLL_OPEN_MS);
    if (!ui.rollOpen && rollTimer) { clearTimeout(rollTimer); rollTimer = null; }
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

  /** The glowing targets with their keys, worked out once per view (not on every frame). */
  function litTargets(): { key: string; t: Target }[] {
    const v = play.view;
    if (litCache.view !== v) litCache = { view: v, list: v.targets.map(t => ({ key: JSON.stringify(t), t })) };
    return litCache.list;
  }

  function anchorOf(raw: string): Target | null {
    let t = anchorCache.get(raw);
    if (t === undefined) {
      try { t = JSON.parse(raw) as Target; } catch { t = null; }
      if (anchorCache.size > 200) anchorCache.clear();
      anchorCache.set(raw, t);
    }
    return t;
  }

  /**
   * The desktop turn queue lets taps through to the table; when a lit target lies under it, it
   * also fades nearly out, so nothing to tap is hidden by it.
   */
  function fadeQueue(): void {
    const q = hud.querySelector<HTMLElement>('.tg-queue.desk');
    const list = q?.querySelector<HTMLElement>('.tg-qlist');
    if (!q || !list || !table) return;
    const r = list.getBoundingClientRect();
    let under = false;
    for (const x of litTargets()) {
      const p = table.screenPosition(x.t);
      if (p && p.x >= r.left - 6 && p.x <= r.right + 6 && p.y >= r.top - 6 && p.y <= r.bottom + 6) { under = true; break; }
    }
    q.classList.toggle('under', under);
  }

  function placeAnchors(): void {
    fadeQueue();
    const els = [...hud.querySelectorAll<HTMLElement>('[data-anchor]')];
    if (els.length === 0) return;
    // Read: every size and screen point first …
    const tile = tilePx();
    const items: AnchorItem[] = els.map((el) => {
      const raw = el.dataset.anchor ?? 'null';
      const t = anchorOf(raw);
      const kind = (el.dataset.place ?? 'side') as AnchorItem['kind'];
      const p: Pt | null = table && t ? table.screenPosition(t) : null;
      const lit = kind === 'below' && table
        ? litTargets().filter(x => x.key !== raw).flatMap(x => { const q = table!.screenPosition(x.t); return q ? [q] : []; })
        : undefined;
      return { kind, p, w: el.offsetWidth, h: el.offsetHeight, ...(lit ? { lit } : {}), hasPointer: !!el.querySelector(':scope > .tg-ptr') };
    });
    const out = placeAll(items, { free, W: window.innerWidth, H: window.innerHeight, tile, phone });
    // The HUD sits inside the safe area: positions are written relative to it.
    const hr = hud.getBoundingClientRect();
    // … then write every position.
    els.forEach((el, i) => {
      const o = out[i]!;
      el.style.visibility = o.visible ? '' : 'hidden';
      if (!o.visible && !items[i]!.p) return;
      el.style.transform = `translate(${Math.round(o.x - hr.left)}px, ${Math.round(o.y - hr.top)}px)`;
      if (items[i]!.kind !== 'center') el.dataset.side = o.side;
      if (o.ptr) {
        const ptr = el.querySelector<HTMLElement>(':scope > .tg-ptr');
        if (ptr) {
          ptr.style.left = `${o.ptr.left}px`;
          ptr.style.top = `${o.ptr.top}px`;
          ptr.style.display = o.ptr.hidden ? 'none' : '';
        }
      }
    });
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
        const text = (el.dataset.prefix ?? '') + clock(ms) + (el.dataset.suffix ?? '');
        if (el.textContent !== text) el.textContent = text;
      }
    }
  }

  // ── Input ───────────────────────────────────────────────────────────────────
  function onPick(hit: Target | null): void {
    // A tap while the picture lags jumps to the newest state; it is never taken as a move.
    if (!stage.drained) { stage.skip(); return; }
    // A move in flight or a bot playing this seat: the table does not take moves.
    if (lockReason() && hit) { blocked++; return; }
    if (ui.menuOpen || ui.seat !== null) {
      ui.menuOpen = false; ui.seat = null; schedule();
      if (!hit) return;
    }
    if (!hit) {
      if (phone && ui.sheetOpen) { ui.sheetOpen = false; ui.sheetUserClosed = true; autoOpened = false; schedule(); return; }
      // Past the table's edge: closes a building menu, puts back a meeple spot awaiting confirmation.
      play.tapNothing();
      return;
    }
    // The explanation of a tap on something that is not lit appears next to what was tapped.
    const p = table?.screenPosition(hit) ?? null;
    tapToastAt = p ? { x: p.x, y: p.y, t: performance.now() } : null;
    play.tap(hit);
    // The confirm bar stands by the last tap that chose something: a refused tap does not move it
    // (it would look like a Confirm for the empty spot just tapped).
    if (play.view.hint) { sound.play('refuse'); haptic('refuse'); } else lastTap = hit;
  }

  function onKey(e: KeyboardEvent): void {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    if (!stage.drained) {
      if (e.key === 'Escape') stage.skip();
      return;
    }
    if (lockReason() && e.key !== 'Escape') return;
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
    if (!ui.sheetOpen) ui.sheetUserClosed = true;
    else { ui.menuOpen = false; ui.seat = null; }
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
    schedule();
  }

  let ticker: ReturnType<typeof setInterval> | null = null;
  /** A hidden page shows the newest state when it comes back (nothing animates unseen). */
  const onVisibility = (): void => { if (document.hidden) stage.skip(); };

  async function startTable(): Promise<void> {
    try {
      const mod = await import('../../table');
      if (disposed) return;
      const t = await mod.createTable(canvas);
      if (disposed) { t.dispose(); return; }
      table = t;
      loading.remove();
      // The player's own side of the table, before the first frame of the game.
      const home = (shownRoom ?? room)?.game;
      if (home) applyHomeView(home, ctrl.mySeat);
      colorsKey = ''; targetsKey = ''; ghostKey = ''; insetsKey = '';
      // The player's "Moving Teleporter portals" setting, now and whenever it is flipped.
      t.setPortalMotion(movingPortals());
      offs.push(onPortalMotionChange(() => t.setPortalMotion(movingPortals())));
      offs.push(t.onPick((hit) => onPick(hit)));
      offs.push(ctrl.onPreview((seat, pv) => {
        if (pv) otherPreviews.set(seat, { p: pv, seq: ctrl.room?.seq ?? -1 });
        else otherPreviews.delete(seat);
        schedule();
      }));
      offs.push(t.onFrame(placeAnchors));
      measureFree();
      if (room) {
        const colors = room.seats.map(s => s.color as PlayerColor);
        colorsKey = colors.join(',');
        t.setPlayerColors(colors);
        stage.tableReady();
        const g = (shownRoom ?? room).game;
        if (g) boardSize = g.board.length;
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
    get view() { return context()?.view ?? play.view; },
    get drained() { return stage.drained; },
    get lag() { return stage.lagMs(); },
    get shownSeq() { return shownRoom?.seq ?? -1; },
    get blocked() { return blocked; },
    get staleRefusals() { return staleRefusals; },
    get previews() { return Object.fromEntries([...shownPreviewKeys].map(([k, v]) => [k, JSON.parse(v) as unknown])); },
    stage,
    feel,
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
      // A dropped connection or a new host: the next state is shown at once, not animated.
      const status = ctrl.state.online?.status;
      if (status && status !== 'online') stage.markResync();
      let changed = false;
      const pending = !!ctrl.state.online?.client.pending;
      if (pending !== lastPending) { lastPending = pending; changed = true; }
      // The storage strip comes back only if storage recovers and then fails again.
      if (ctrl.state.cannotStore !== lastCannotStore) {
        lastCannotStore = ctrl.state.cannotStore;
        if (!lastCannotStore) ui.storeDismissed = false;
        changed = true;
      }
      if (r !== room) { syncRoom(r); changed = true; }
      if (ctrl.state !== lastState) { lastState = ctrl.state; changed = true; }
      if (changed) schedule();
    },
    mounted(): void {
      document.documentElement.classList.add('tg-active');
      window.addEventListener('resize', onResize);
      window.addEventListener('keydown', onKey);
      window.addEventListener('pointerdown', unlockAudio, true);
      window.addEventListener('keydown', unlockAudio, true);
      document.addEventListener('visibilitychange', onVisibility);
      ticker = setInterval(tick, 1000);
      if (debugWanted()) (window as unknown as { __game?: GameDebug }).__game = debug;
      render();
      void startTable();
    },
    unmounted(): void {
      disposed = true;
      document.documentElement.classList.remove('tg-active');
      window.removeEventListener('resize', onResize);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', unlockAudio, true);
      window.removeEventListener('keydown', unlockAudio, true);
      document.removeEventListener('visibilitychange', onVisibility);
      stage.dispose();
      fx.dispose();
      sound.dispose();
      if (flashTimer) clearTimeout(flashTimer);
      if (sendingTimer) clearTimeout(sendingTimer);
      seenByEl = new WeakMap();
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
