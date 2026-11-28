// Brings the animated examples of a page to life (render.ts draws their boxes and step lists):
// a picture drawn by the guide's one renderer through the shared cache (jobs.ts view()), the
// side panel built with the game screen's own HTML (the Control Module tray, Power Tokens and
// materials, the dice and what the roll did), tokens flying between them as in the game, the
// controls and the step list. The playback itself is figures/player.ts.
//
// Nothing here runs while nothing moves: frames are asked for only while a step plays, flights
// are Web Animations held at a time the player sets, and everything stops when the page changes
// or the guide closes. A picture that cannot be drawn leaves the step list; nothing is thrown or logged.

import { BELT_COST, CONTROL_MODULE_MAX, MATERIAL_VALUES, MINE_COSTS, cardCost, teleporterCost } from '../../../engine/config';
import type { GameState, Material, PlayerId } from '../../../engine/state';
import { tesseractCount } from '../../../engine/rules/scoring';
import { nextMinePrice } from '../../../play/info';
import type { TrayEntry } from '../../../play';
import type { TableEvent } from '../../../session/room';
import { DUR, type AnimStep, type Carried } from '../../../table/transition';
import { PLAYER_COLOR_HEX, type Ghost, type Target } from '../../../table/types';
import { h } from '../../dom';
import { COLORS } from '../../icons';
import { cardFace, count, die, moduleTray, pips } from '../../game/pieces';
import { FLIGHT_EASING, flightFrames, flightToken, type Point } from '../../game/fx';
import { outcomeOf, outcomeText } from '../../game/rollOutcome';
import { deviceStorage, loadFeel, prefersReducedMotion } from '../../game/feel';
import type { FigureCache, PlayLook, PlayView } from './jobs';
import { figureCache } from './mount';
import {
  activeSeat, buildTimeline, legalTargets, movesModule, playLayout, stepTiming, REST_MS, FIRST_MS,
  type MoveRun, type PlayLayout, type StepTiming, type Timeline,
} from './play';
import { Coordinator, Player, type Clock, type Motion, type PlayStage, type PlayerUi } from './player';
import { markTone } from './render';
import type { Callout, FigColor, PlayExample } from './types';

const MATS: readonly Material[] = ['ore', 'plate', 'sphere', 'tesseract'];
const MAT_WORD: Record<Material, string> = { ore: 'Ore', plate: 'Plate', sphere: 'Sphere', tesseract: 'Tesseract' };
const COLOR_WORD: Record<FigColor, string> = { blue: 'Blue', red: 'Red', orange: 'Orange', green: 'Green' };
const MAT_ICON = { ore: 'ore', plate: 'plate', sphere: 'sphere', tesseract: 'tess' } as const;
/** The four steps of a turn, as the game's turn bar names them (turnBar.ts). */
const TURN_STEPS = ['Place a piece', 'Roll', 'Actions', 'Place meeple'] as const;
/** Moves that pay the bank or exchange with it (the bank row says what went in and came back). */
const BANK_MOVES: ReadonlySet<string> = new Set(['BUY_BELT', 'BUY_CARD', 'BUY_MINE', 'EXCHANGE_MATERIALS', 'PLACE_TELEPORTER']);
const amountWord = (n: number, m: Material): string => `${n} ${MAT_WORD[m]}${n === 1 || m === 'ore' ? '' : 's'}`;
const nodes = (...xs: (Node | null)[]): Node[] => xs.filter((x): x is Node => x !== null);
const totalValueOf = (inv: Readonly<Record<Material, number>>): number => MATS.reduce((t, m) => t + inv[m] * MATERIAL_VALUES[m], 0);

const coordinator = new Coordinator();
/** Which example the shared view shows now (another example must switch it back before drawing). */
let owner: { stage: DomStage; view: PlayView } | null = null;

/** Whether examples move: never with reduced motion or Animation Off; Fast or Normal as the game. */
export function playMotion(): Motion {
  if (prefersReducedMotion()) return 'stills';
  const speed = loadFeel(deviceStorage(), false).speed;
  return speed === 'off' ? 'stills' : speed;
}

const realClock: Clock = {
  now: () => performance.now(),
  frame: fn => requestAnimationFrame(fn),
  cancelFrame: h0 => cancelAnimationFrame(h0 as number),
  later: (fn, ms) => setTimeout(fn, ms),
  cancel: h0 => clearTimeout(h0 as ReturnType<typeof setTimeout>),
};

interface Flight {
  el: HTMLElement; anim: Animation | null; t0: number; dur: number; started: boolean; done: boolean;
  /** When the token leaves (a module's pocket empties) and when it lands. */
  onStart?: (() => void) | undefined; onLand?: (() => void) | undefined;
}

/** The drawing side of one example: picture, markers, side panel and flights. */
class DomStage implements PlayStage {
  private view: PlayView | null = null;
  private asking: Promise<PlayView | null> | null = null;
  private readonly ctx: CanvasRenderingContext2D | null;
  private readonly canvas: HTMLCanvasElement;
  private readonly marksEl: HTMLElement;
  private readonly fxEl: HTMLElement;
  private flights: Flight[] = [];
  private size = { w: 0, h: 0 };
  /** The step playing: its timing and which part of it the view is set up for. */
  private cur: { i: number; k: number; timing: StepTiming; key: string; ghostRot: number } | null = null;
  private wantRest: number | null = null;
  private holding = false;
  private readonly colors: readonly string[];
  private readonly layout: PlayLayout;
  private readonly side: SidePanel | null;

  constructor(
    private readonly ex: PlayExample, private readonly tl: Timeline, private readonly pic: HTMLElement,
    sideEl: HTMLElement | null, private readonly cache: FigureCache,
  ) {
    this.colors = tl.colors.map(c => PLAYER_COLOR_HEX[c]);
    this.layout = playLayout(ex, tl);
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'g-pcanvas';
    this.canvas.setAttribute('aria-hidden', 'true');
    this.ctx = this.canvas.getContext('2d');
    this.marksEl = h('div', { class: 'g-pmarkslayer', attrs: { 'aria-hidden': 'true' } });
    this.fxEl = h('div', { class: 'g-pfx', attrs: { 'aria-hidden': 'true' } });
    pic.append(this.canvas, this.marksEl);
    // Flights cross from the picture to the side panel: their layer covers the whole figure.
    (pic.parentElement ?? pic).append(this.fxEl);
    this.side = sideEl && ex.side ? new SidePanel(sideEl, ex, tl) : null;
  }

  async prepare(): Promise<boolean> {
    if (!this.ctx) return false;
    return !!(await this.acquire());
  }

  private acquire(): Promise<PlayView | null> {
    if (this.view?.alive) return Promise.resolve(this.view);
    this.asking ??= this.cache.view().then(v => { this.view = v; this.asking = null; return v; }, () => { this.asking = null; return null; });
    return this.asking;
  }

  /** The view, set to this example (null while it is being made again: the caller tries later). */
  private ready(): PlayView | null {
    const v = this.view;
    if (!v?.alive || !this.ctx) {
      void this.acquire().then(x => { if (x && this.wantRest !== null) this.rest(this.wantRest); });
      return null;
    }
    const w = Math.max(1, Math.round(this.pic.clientWidth || 340));
    const hgt = Math.max(1, Math.round(w / (this.ex.aspect ?? 16 / 9)));
    const resized = w !== this.size.w || hgt !== this.size.h;
    if (resized) {
      this.size = { w, h: hgt };
      this.canvas.width = Math.round(w * v.ratio);
      this.canvas.height = Math.round(hgt * v.ratio);
    }
    if (resized || owner?.stage !== this || owner.view !== v) {
      const look: PlayLook = { colors: this.colors, layout: this.layout, w, h: hgt };
      v.use(look);
      owner = { stage: this, view: v };
      if (this.cur) this.cur.key = '';
    }
    return v;
  }

  private stateAt(i: number): GameState { return i < 0 ? this.tl.start : this.tl.steps[i]!.after; }

  rest(i: number): void {
    this.wantRest = i;
    this.cur = null;
    this.clearFlights();
    const v = this.ready();
    const state = this.stateAt(i);
    this.side?.show(state, i, null, i >= 0 ? this.tl.steps[i]!.from : state);
    if (!v || !this.ctx) return;
    const step = i >= 0 ? this.tl.steps[i] : undefined;
    const glow = i < 0 ? this.tl.startGlow : step!.glow;
    v.show(state, { glow, glowColor: this.colorOf(activeSeat(state)) }, 0);
    v.draw(0, this.ctx);
    this.placeMarks(v, state, step?.marks ?? []);
  }

  begin(i: number, k: number): void {
    this.wantRest = null;
    this.clearFlights();
    this.cur = { i, k, timing: stepTiming(this.tl.steps[i]!, k, !!this.ex.side?.tray), key: '', ghostRot: -1 };
    const prev = i > 0 ? this.tl.steps[i - 1]! : null;
    const step = this.tl.steps[i]!;
    // Markers built up by earlier steps stay while the next step plays.
    const v = this.ready();
    if (v) this.placeMarks(v, step.from, this.ex.keepMarks && prev && !step.jumped ? prev.marks : []);
    this.side?.show(step.from, i - 1, null, step.from);
  }

  tick(i: number, t: number): void {
    const cur = this.cur;
    const v = this.ready();
    if (!cur || cur.i !== i || !v || !this.ctx) return;
    const step = this.tl.steps[i]!;
    if (step.moves.length === 0) {
      // The turn passes (a piece turns over on its pile) or the board jumps.
      if (cur.key !== 'still') {
        cur.key = 'still';
        v.show(step.from, {}, 0);
        v.show(step.after, {}, 0, !step.jumped);
      }
      v.draw(t, this.ctx);
      return;
    }
    const segs = cur.timing.segments;
    let s = 0;
    for (let j = 0; j < segs.length; j++) if (t >= segs[j]!.at) s = j;
    const seg = segs[s]!;
    const move = step.moves[seg.move]!;
    const inLead = t < seg.at + seg.lead;
    const key = `${s}:${inLead ? 'lead' : 'anim'}`;
    if (inLead) {
      const p = seg.lead > 0 ? (t - seg.at) / seg.lead : 1;
      const ghost = this.leadGhost(move, p);
      const rot = ghost?.rotation ?? -1;
      if (key !== cur.key || rot !== cur.ghostRot) {
        const fresh = key !== cur.key;
        cur.key = key;
        cur.ghostRot = rot;
        v.show(move.before, { glow: ghost ? legalTargets(move.before) : [], glowColor: this.colorOf(move.seat), ghost }, 0);
        if (fresh) this.startLead(v, move, seg.at, seg.lead, cur.k);
      }
    } else if (key !== cur.key) {
      cur.key = key;
      const base = seg.at + seg.lead;
      v.show(move.before, {}, 0);
      v.animate(move.after, move.plan.steps, cur.k, base);
      this.startAnim(v, move, base, cur.k);
    }
    // The side panel shows the state before the move until it has played, then after.
    const shown = t >= seg.at + seg.lead + seg.anim ? move.after : move.before;
    // The last roll may have come in an earlier step (a factory run after it).
    const roll = [...this.tl.steps.slice(0, i).flatMap(x => x.events), ...(this.rollShown(step, s, t, seg.at + seg.lead, cur.k) ?? [])];
    this.side?.show(shown, i - 1, roll, step.from);
    v.draw(t, this.ctx);
    this.updateFlights(t);
  }

  running(on: boolean): void {
    if (on === this.holding) return;
    this.holding = on;
    if (on) this.cache.hold(); else this.cache.unhold();
  }

  dispose(): void {
    this.running(false);
    this.clearFlights();
    if (owner?.stage === this) owner = null;
  }

  // ── Pieces of a step ──

  private colorOf(seat: number): string { return this.colors[seat] ?? '#e8b730'; }

  /** A piece about to be placed: see-through on its space, turning to the rotation chosen. */
  private leadGhost(m: MoveRun, p: number): Ghost | null {
    if (m.action.type !== 'PLACE_PIECE') return null;
    const top = m.before.stacks[m.action.stackIndex]?.pieces[0];
    if (!top) return null;
    const final = m.action.rotation ?? 0;
    const turns = Math.min(2, Math.floor(p * 3.2));
    return { pieceType: top.type, q: m.action.coord.q, r: m.action.coord.r, rotation: (final - 2 + turns + 6) % 6, valid: true };
  }

  /** The lead-in of a claim or an upgrade: the module lights in the tray and travels to the building. */
  private startLead(v: PlayView, m: MoveRun, at: number, lead: number, k: number): void {
    if (!this.side?.hasTray || !movesModule(m) || lead <= 0) return;
    const n = moduleOf(m);
    if (n === null) return;
    const piece = pieceOf(m);
    this.side.light(n);
    const from = this.side.cellPoint(n, this.fxEl);
    const to = piece ? this.picPoint(v, { kind: 'piece', pieceId: piece }, m.after) : null;
    if (!from || !to) return;
    // The module is lit for a moment first, then lifts out of its pocket.
    const t0 = at + 320 * k;
    this.flight(this.side.moduleToken(n), from, to, t0, DUR.flight * k, () => undefined, () => this.side?.leave(n));
  }

  /** The game's flights of a move: Power Tokens and materials, and an upgraded module going home. */
  private startAnim(v: PlayView, m: MoveRun, base: number, k: number): void {
    const side = this.side;
    if (!side) return;
    for (const s of m.plan.steps) {
      if (s.kind === 'module' && s.upgrade && side.hasTray) {
        const old = m.before.board.find(p => p.id === s.pieceId)?.claims[s.index]?.controlModule;
        const from = this.picPoint(v, { kind: 'piece', pieceId: s.pieceId }, m.after);
        const to = old !== undefined ? side.cellPoint(old, this.fxEl) : null;
        if (old !== undefined && from && to) this.flight(side.moduleToken(old), from, to, base + s.at * k, DUR.flight * k, () => side.home(old), () => side.depart(old));
      }
      if (s.kind !== 'toPlayer' && s.kind !== 'fromPlayer') continue;
      if (s.item === 'card') { this.cardFlight(v, m, s, base, k); continue; }
      const holder = side.holdPoint(s.player, s.item, this.fxEl);
      const there = this.flightEnd(v, s, m.after);
      if (!holder || !there) continue;
      const [from, to] = s.kind === 'toPlayer' ? [there, holder] : [holder, there];
      const n = Math.max(1, Math.min(6, s.count));
      for (let j = 0; j < n; j++) {
        this.flight(flightToken(s.item), from, to, base + (s.at + j * DUR.flightGap) * k, DUR.flight * k, undefined, undefined, j);
      }
    }
  }

  /** A Leverage card: bought, from the top of the picture to the hand; played, from the hand to what it acts on (or the table). */
  private cardFlight(v: PlayView, m: MoveRun, s: Extract<AnimStep, { kind: 'toPlayer' | 'fromPlayer' }>, base: number, k: number): void {
    const side = this.side;
    const hand = side?.handPoint(s.player, s.card ?? null, this.fxEl);
    if (!side || !hand) return;
    const a = m.action;
    const target = a.type === 'PLAY_CARD' && a.pieceId ? this.picPoint(v, { kind: 'piece', pieceId: a.pieceId }, m.before) : null;
    const r = this.pic.getBoundingClientRect(), l = this.fxEl.getBoundingClientRect();
    const table = target ?? { x: r.left - l.left + r.width * 0.5, y: r.top - l.top + r.height * 0.35 };
    const deck = { x: r.left - l.left + r.width * 0.88, y: r.top - l.top + r.height * 0.12 };
    const [from, to] = s.kind === 'toPlayer' ? [deck, hand] : [hand, table];
    this.flight(flightToken('card', this.colorOf(s.player)), from, to, base + s.at * k, DUR.flight * k);
  }

  private flightEnd(v: PlayView, s: Extract<AnimStep, { kind: 'toPlayer' | 'fromPlayer' }>, game: GameState): Point | null {
    const t = s.kind === 'toPlayer' ? s.from : s.to;
    return t ? this.picPoint(v, t, game) : null;
  }

  /** The roll line: from when the dice have landed in the roll of this step, or the last roll before. */
  private rollShown(step: Timeline['steps'][number], seg: number, t: number, base: number, k: number): TableEvent[] | null {
    const done = step.moves.slice(0, seg).flatMap(m => m.events);
    const m = step.moves[seg]!;
    const rolls = m.events.some(e => e.kind === 'roll');
    const now = !rolls || t >= base + DUR.dice * k ? m.events : [];
    return [...done, ...now];
  }

  /** A point on the picture, in pixels of the flight layer. */
  private picPoint(v: PlayView, at: Target, game: GameState): Point | null {
    const f = v.where(at, game);
    if (!f) return null;
    const a = this.pic.getBoundingClientRect(), b = this.fxEl.getBoundingClientRect();
    return { x: a.left - b.left + f.x * a.width, y: a.top - b.top + f.y * a.height };
  }

  private placeMarks(v: PlayView, game: GameState, marks: readonly Callout[]): void {
    this.marksEl.replaceChildren();
    for (const c of marks) {
      const f = v.where(c.at, game);
      if (!f || f.x < 0 || f.x > 1 || f.y < 0 || f.y > 1) continue;
      const s = h('span', { class: `g-mark g-onpic${markTone(c.mark)}`, text: c.mark });
      s.style.left = `${(f.x * 100).toFixed(2)}%`;
      s.style.top = `${(f.y * 100).toFixed(2)}%`;
      this.marksEl.append(s);
    }
  }

  // ── Flights: the game's tokens, held at the example's own time ──

  private flight(el: HTMLElement, from: Point, to: Point, t0: number, dur: number, onLand?: () => void, onStart?: () => void, i = 0): void {
    this.fxEl.append(el);
    let anim: Animation | null = null;
    try {
      anim = el.animate(flightFrames(from, to, i), { duration: Math.max(120, dur), easing: FLIGHT_EASING, fill: 'both' });
      anim.pause();
      anim.currentTime = 0;
    } catch {
      // No Web Animations: no token, but the tray and counters still change.
      anim = null;
      el.style.opacity = '0';
    }
    this.flights.push({ el, anim, t0, dur: Math.max(120, dur), started: false, done: false, onStart, onLand });
  }

  private updateFlights(t: number): void {
    for (const f of this.flights) {
      if (f.done) continue;
      const local = t - f.t0;
      if (local >= 0 && !f.started) { f.started = true; f.onStart?.(); }
      if (f.anim) {
        try { f.anim.currentTime = Math.max(0, Math.min(f.dur, local)); } catch { /* ignore */ }
      }
      if (local >= f.dur) {
        f.done = true;
        f.el.remove();
        f.onLand?.();
      }
    }
  }

  private clearFlights(): void {
    for (const f of this.flights) { try { f.anim?.cancel(); } catch { /* ignore */ } f.el.remove(); }
    this.flights = [];
  }
}

/** The Control Module a claim or an upgrade puts on the building. */
function moduleOf(m: MoveRun): number | null {
  const a = m.action;
  if (a.type === 'CLAIM_BUILDING') return a.controlModule;
  if (a.type === 'UPGRADE_BUILDING') return a.newModule;
  if (a.type === 'SETUP_CLAIM') {
    const p = m.after.board.find(x => x.id === a.pieceId);
    return p?.claims[p.claims.length - 1]?.controlModule ?? null;
  }
  return null;
}

function pieceOf(m: MoveRun): string | null {
  const a = m.action;
  return a.type === 'CLAIM_BUILDING' || a.type === 'UPGRADE_BUILDING' || a.type === 'SETUP_CLAIM' ? a.pieceId : null;
}

// ── The side panel: parts of a player's area, built by the game screen's own code ──

class SidePanel {
  readonly hasTray: boolean;
  private readonly trayEl: HTMLElement | null = null;
  private readonly upsEl: HTMLElement | null = null;
  private readonly holdEls = new Map<number, HTMLElement>();
  private readonly rollEl: HTMLElement | null = null;
  private readonly stepsEl: HTMLElement | null = null;
  private readonly bankEl: HTMLElement | null = null;
  private readonly handEl: HTMLElement | null = null;
  private readonly tessEls = new Map<number, HTMLElement>();
  private restIndex = -1;
  /** Modules lit (being chosen), travelling (pocket empty before the state says so), or coming home. */
  private lit: number | null = null;
  private away = new Set<number>();
  private coming = new Set<number>();
  private lastKey = '';
  private game: GameState | null = null;
  private events: readonly TableEvent[] = [];
  /** The state whose turn step the step indicator marks: the one the step being shown is about. */
  private turnOf: GameState | null = null;

  constructor(private readonly el: HTMLElement, private readonly ex: PlayExample, private readonly tl: Timeline) {
    const s = ex.side!;
    this.hasTray = !!s.tray;
    const colorName = (p: number): string => COLOR_WORD[tl.colors[p] ?? 'blue'];
    if (s.steps) { this.stepsEl = h('div', { class: 'g-pturn' }); el.append(this.stepsEl); }
    if (s.tray) { this.trayEl = h('div', { class: 'g-ptray' }); el.append(this.trayEl); }
    if (s.upgrades) { this.upsEl = h('div', { class: 'g-pups' }); el.append(this.upsEl); }
    for (const p of s.holdings ?? []) {
      const row = h('div', { class: 'g-phold', style: `--seat:${PLAYER_COLOR_HEX[tl.colors[p] ?? 'blue']}` });
      row.dataset.name = colorName(p);
      this.holdEls.set(p, row);
      el.append(row);
    }
    for (const p of s.tesseracts ?? []) {
      const row = h('div', { class: 'g-ptess', style: `--seat:${PLAYER_COLOR_HEX[tl.colors[p] ?? 'blue']}` });
      row.dataset.name = colorName(p);
      this.tessEls.set(p, row);
      el.append(row);
    }
    if (s.hand) { this.handEl = h('div', { class: 'g-phand' }); el.append(this.handEl); }
    if (s.bank) { this.bankEl = h('div', { class: 'g-pbank' }); el.append(this.bankEl); }
    if (s.roll) { this.rollEl = h('div', { class: 'g-proll' }); el.append(this.rollEl); }
  }

  private color(): FigColor { return this.tl.colors[this.ex.side!.player] ?? 'blue'; }

  /** Show `game` (the rest after step `restIndex`); `roll`: the events whose last roll to describe. */
  show(game: GameState, restIndex: number, roll: TableEvent[] | null, turnOf: GameState = game): void {
    this.turnOf = turnOf;
    this.game = game;
    if (roll === null) { this.lit = null; this.away.clear(); this.coming.clear(); }
    const events = roll ?? this.tl.steps.slice(0, restIndex + 1).flatMap(s => s.events);
    this.events = events;
    if (restIndex !== -2) this.restIndex = restIndex;
    const key = JSON.stringify([game.players, game.mineCount, game.phase, game.activePlayerIndex, game.globalTeleporterCount, game.unplacedMines.length, turnOf.phase, turnOf.activePlayerIndex, this.lit, [...this.away], [...this.coming], events.length, this.restIndex, roll === null]);
    if (key === this.lastKey) return;
    this.lastKey = key;
    const me = game.players[this.ex.side!.player];
    if (this.trayEl && me) this.drawTray(game);
    if (this.upsEl && me) {
      this.upsEl.replaceChildren(
        h('span', { class: 'g-pchip' }, 'Mine credits ', h('b', { text: String(me.freeActionCredits) })),
        h('span', { class: 'g-pchip' }, 'Free upgrades ', h('b', { text: String(me.freeUpgradesRemaining) })));
    }
    for (const [p, row] of this.holdEls) {
      const pl = game.players[p];
      if (!pl) continue;
      const name = row.dataset.name ?? '';
      row.replaceChildren(...nodes(
        h('span', { class: 'g-pname' }, h('span', { class: 'sw' }), name),
        h('span', { attrs: { 'data-hold': `${p}-power` } }, count('power', pl.powerTokens, 'Power Tokens')),
        ...MATS.filter(m => pl.inventory[m] > 0 || m === 'ore' || m === 'plate').map(m =>
          h('span', { attrs: { 'data-hold': `${p}-${m}` } }, count(MAT_ICON[m], pl.inventory[m], MAT_WORD[m], undefined, pl.inventory[m] === 0 ? 'zero' : ''))),
        this.ex.side!.bank ? h('span', { class: 'g-ptotal', text: `= ${totalValueOf(pl.inventory)}` }) : null,
        this.ex.side!.supply ? h('span', { attrs: { 'data-hold': `${p}-belt` } }, count('belt', pl.beltsRemaining, 'Belts')) : null,
        this.ex.side!.supply ? h('span', { attrs: { 'data-hold': `${p}-teleporter` } }, count('teleporter', pl.teleportersRemaining, 'Teleporters')) : null));
    }
    for (const [p, row] of this.tessEls) {
      row.replaceChildren(h('span', { class: 'g-pname' }, h('span', { class: 'sw' }), row.dataset.name ?? ''), pips(tesseractCount(game, p as PlayerId)));
    }
    if (this.stepsEl) this.drawSteps(this.turnOf);
    if (this.handEl && me) {
      this.handEl.replaceChildren(h('span', { class: 'g-plabel' }, `${COLOR_WORD[this.color()]}'s Leverage cards`),
        me.hand.length ? h('div', { class: 'g-pcards' }, me.hand.map(c => { const f = cardFace(c); f.dataset.card = c; return f; })) : h('span', { class: 'g-pnone', text: 'None in hand' }));
    }
    if (this.bankEl) this.drawBank(game, roll === null);
    if (this.rollEl) this.drawRoll(events);
  }

  /** The turn steps as the game's turn bar shows them (turnBar.ts), the current one marked. */
  private drawSteps(game: GameState): void {
    const seat = game.turnOrder[game.activePlayerIndex] ?? 0;
    const color = PLAYER_COLOR_HEX[this.tl.colors[seat] ?? 'blue'];
    const idx = ({ placePiece: 1, roll: 2, actions: 3, placeMeeple: 4 } as Record<string, number>)[game.phase] ?? 0;
    const who = `${COLOR_WORD[this.tl.colors[seat] ?? 'blue']}'s ${game.phase === 'roundEnd' ? 'round-end turn' : 'turn'}`;
    this.stepsEl!.replaceChildren(...nodes(
      h('span', { class: 'g-pname', style: `--seat:${color}` }, h('span', { class: 'sw' }), who),
      idx ? h('div', { class: 'tg-steps' }, TURN_STEPS.map((label, i) => {
        const n = i + 1;
        return h('span', { class: `tg-step${n < idx ? ' done' : n === idx ? ' now' : ''}`, style: `--seat:${color}`, attrs: n === idx ? { 'aria-current': 'step' } : {} },
          h('span', { class: 'n', text: String(n) }), label);
      })) : null));
  }

  /** The bank's prices now, and (at rest) what the last purchase or exchange handed in and gave back. */
  private drawBank(game: GameState, atRest: boolean): void {
    const mine = nextMinePrice(game, MINE_COSTS);
    const price = (label: string, n: number | null): HTMLElement => h('span', { class: 'g-pprice' }, label, ' ', h('b', { text: n === null ? '—' : String(n) }));
    const step = this.tl.steps[this.restIndex];
    const me = this.ex.side!.player;
    let line: string | null = null;
    if (atRest && step && step.moves.some(m => BANK_MOVES.has(m.action.type))) {
      const a = step.from.players[me]!.inventory, b = step.after.players[me]!.inventory;
      const gave = MATS.filter(m => b[m] < a[m]).map(m => amountWord(a[m] - b[m], m));
      const got = MATS.filter(m => b[m] > a[m]).map(m => amountWord(b[m] - a[m], m));
      line = `Handed in: ${gave.length ? gave.join(', ') : 'nothing'}${got.length ? ` · Back: ${got.join(', ')}` : ''}`;
    }
    this.bankEl!.replaceChildren(...nodes(
      h('span', { class: 'g-plabel' }, 'The bank'),
      h('div', { class: 'g-pprices' }, price('Belt', BELT_COST), price('Leverage card', cardCost(game.mineCount)), price('Mine', mine), price('Teleporter', teleporterCost(game.globalTeleporterCount))),
      line ? h('div', { class: 'g-ppaid', text: line }) : null));
  }

  handPoint(player: number, card: string | null, layer: HTMLElement): Point | null {
    if (player !== this.ex.side!.player || !this.handEl) return null;
    const el = (card ? this.handEl.querySelector<HTMLElement>(`[data-card="${card}"]`) : null) ?? this.handEl;
    return centre(el, layer);
  }

  private drawTray(game: GameState): void {
    const me = game.players[this.ex.side!.player]!;
    const inTray = new Set(me.controlModules);
    const entries: TrayEntry[] = Array.from({ length: CONTROL_MODULE_MAX }, (_, i) => {
      const n = i + 1;
      // Lifted out and travelling to a building, or travelling home: its pocket is empty meanwhile.
      if (!inTray.has(n) || this.away.has(n) || this.coming.has(n)) return { module: n, state: 'onBoard' };
      if (this.lit === n) return { module: n, state: 'lit' };
      if (n < game.mineCount) return { module: n, state: 'skipped', label: `Control Module ${n}: below the number of Mines` };
      return { module: n, state: 'inTray' };
    });
    const tray = moduleTray(entries, this.color(), () => undefined, 'g-tray');
    tray.setAttribute('inert', '');
    this.trayEl!.replaceChildren(h('span', { class: 'g-plabel' }, `${COLOR_WORD[this.color()]}'s Control Module tray`), tray);
  }

  private drawRoll(events: readonly TableEvent[]): void {
    const o = outcomeOf(0, events);
    if (!o) { this.rollEl!.replaceChildren(); this.rollEl!.hidden = true; return; }
    this.rollEl!.hidden = false;
    const name = (seat: number): string => COLOR_WORD[this.tl.colors[seat] ?? 'blue'];
    this.rollEl!.replaceChildren(
      h('div', { class: 'tg-roll tray has-line g-prollchip', style: `--seat:${PLAYER_COLOR_HEX[this.tl.colors[o.roller] ?? 'blue']}` },
        h('div', { class: 'top' }, h('span', { class: 'sw' }), o.dice.map(n => die(n)), h('span', { text: 'Rolled' }), h('b', { class: 'big num', text: String(o.total) })),
        h('div', { class: 'line', text: outcomeText(o, name, null) })));
  }

  // ── Module travel ──
  light(n: number): void { this.lit = n; this.redraw(); }
  leave(n: number): void { this.away.add(n); this.lit = null; this.redraw(); }
  depart(n: number): void { this.coming.add(n); this.redraw(); }
  home(n: number): void { this.coming.delete(n); this.redraw(); }

  private redraw(): void {
    this.lastKey = '';
    if (this.game) this.show(this.game, -2, [...this.events], this.turnOf ?? this.game);
  }

  cellPoint(n: number, layer: HTMLElement): Point | null {
    const cells = this.trayEl?.querySelectorAll<HTMLElement>('.tg-mod');
    const cell = cells?.[CONTROL_MODULE_MAX - n];
    return cell ? centre(cell, layer) : null;
  }

  holdPoint(player: number, item: Carried, layer: HTMLElement): Point | null {
    const row = this.holdEls.get(player);
    const exact = row?.querySelector<HTMLElement>(`[data-hold="${player}-${item}"]`);
    // A material the row does not list goes to the row itself; a card, module or Teleporter only where it is shown.
    const el = exact ?? (item === 'card' || item === 'module' || item === 'teleporter' ? null : row?.querySelector<HTMLElement>(`[data-hold="${player}-power"]`));
    return el ? centre(el, layer) : null;
  }

  moduleToken(n: number): HTMLElement {
    return h('div', { class: 'tg-fly g-flymod' }, h('span', { class: 'tg-mod', style: `background:${COLORS[this.color()]}` }, h('span', { class: 'n', text: String(n) })));
  }
}

function centre(el: HTMLElement, layer: HTMLElement): Point {
  const a = el.getBoundingClientRect(), b = layer.getBoundingClientRect();
  return { x: a.left - b.left + a.width / 2, y: a.top - b.top + a.height / 2 };
}

// ── The controls and the step list ──

function bindUi(fig: HTMLElement, player: () => Player | null): (ui: PlayerUi) => void {
  const bar = fig.querySelector<HTMLElement>('.g-pbar');
  const primary = fig.querySelector<HTMLButtonElement>('[data-pc="primary"]');
  const prev = fig.querySelector<HTMLButtonElement>('[data-pc="prev"]');
  const next = fig.querySelector<HTMLButtonElement>('[data-pc="next"]');
  const steps = [...fig.querySelectorAll<HTMLElement>('.g-pstep')];
  const live = fig.querySelector<HTMLElement>('.g-sr');
  const pic = fig.querySelector<HTMLElement>('.g-playpic');
  primary?.addEventListener('click', () => player()?.primary());
  prev?.addEventListener('click', () => player()?.previous());
  next?.addEventListener('click', () => player()?.next());
  pic?.addEventListener('click', () => player()?.tap());
  if (bar) bar.hidden = false;
  let lastIndex = -2;
  return ui => {
    fig.classList.toggle('is-stills', ui.motion === 'stills' || ui.noPicture);
    fig.classList.toggle('is-nopic', ui.noPicture);
    if (primary) {
      primary.hidden = ui.motion === 'stills' || ui.noPicture;
      const label = ui.playing && !ui.paused ? 'Pause' : ui.playing || (ui.index >= 0 && ui.index < ui.count - 1) ? 'Play' : ui.index >= ui.count - 1 ? 'Play again' : 'Play';
      primary.textContent = label;
      primary.setAttribute('aria-label', label === 'Pause' ? 'Pause the example' : label === 'Play again' ? 'Play the example again' : 'Play the example');
    }
    const floor = ui.motion === 'stills' || ui.noPicture ? 0 : -1;
    if (prev) prev.disabled = ui.index <= floor && !ui.moving;
    if (next) next.disabled = ui.index >= ui.count - 1 && !ui.moving;
    steps.forEach((li, i) => {
      const done = i < ui.index || (i === ui.index && !ui.moving);
      li.classList.toggle('done', done);
      li.classList.toggle('on', i === ui.index);
      if (i === ui.index) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current');
    });
    if (ui.fromReader && live && ui.index !== lastIndex) {
      const li = steps[ui.index];
      live.textContent = ui.index < 0 ? 'The starting position.' : `Step ${ui.index + 1} of ${ui.count}: ${li?.querySelector('.g-ptext')?.textContent ?? ''}`;
    }
    lastIndex = ui.index;
  };
}

/**
 * Bring the examples inside `root` to life. Returns a function that stops them all (call it when
 * the page is replaced or the guide closes): no frame, timer or observer survives it.
 */
export function mountPlays(root: HTMLElement, scroller: HTMLElement | null, c: FigureCache = figureCache(), opts: { motion?: Motion; clock?: Clock } = {}): () => void {
  const figs = [...root.querySelectorAll<HTMLElement>('figure.g-play[data-play]')];
  if (!figs.length) return () => undefined;
  const motion = opts.motion ?? playMotion();
  const players: Player[] = [];
  const stages: DomStage[] = [];
  const observers: IntersectionObserver[] = [];
  for (const fig of figs) {
    let ex: PlayExample;
    let tl: Timeline;
    try {
      ex = JSON.parse(fig.dataset.play ?? '') as PlayExample;
      tl = buildTimeline(ex);
    } catch {
      fig.classList.add('is-nopic', 'is-stills');
      continue;
    }
    const pic = fig.querySelector<HTMLElement>('.g-playpic');
    if (!pic) continue;
    const stage = new DomStage(ex, tl, pic, fig.querySelector<HTMLElement>('.g-pside'), c);
    stages.push(stage);
    let player: Player | null = null;
    const onUi = bindUi(fig, () => player);
    player = new Player({
      count: tl.steps.length,
      duration: (i: number, k: number): number => stepTiming(tl.steps[i]!, k, !!ex.side?.tray).total,
      stage, clock: opts.clock ?? realClock, motion, coordinator, onUi, restMs: REST_MS, firstMs: FIRST_MS,
    });
    players.push(player);
    onUi(player.state);
    const p = player;
    if (typeof IntersectionObserver !== 'function') { p.show(); continue; }
    // Near the view: draw its still. 60% in view: it may start by itself.
    const near = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) { near.disconnect(); p.show(); } }, { root: scroller, rootMargin: '600px 0px' });
    const seen = new IntersectionObserver(es => { for (const e of es) p.setVisible(e.isIntersecting ? e.intersectionRatio : 0); }, { root: scroller, threshold: [0, 0.3, 0.6, 0.8, 1] });
    near.observe(fig);
    seen.observe(pic);
    observers.push(near, seen);
  }
  return () => {
    for (const o of observers) o.disconnect();
    for (const p of players) p.dispose();
    for (const s of stages) s.dispose();
  };
}
