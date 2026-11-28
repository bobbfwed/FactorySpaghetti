// Turns an animated example (figures/types.ts PlayExample) into everything the player needs: the
// game state at the start and after every step, each move with the table events the host would
// send for it and the animation plan the game would play for it (src/table/transition.ts), what
// glows and which markers show at each rest, and how long each step takes. Pure: no DOM, no
// Three.js. Every move goes through the engine's applyAction; a refused move is an error (the
// guide's tests replay every example; the page falls back to the step list).

import { createGame } from '../../../engine/rules/setup';
import { applyAction } from '../../../engine/reducer';
import { legalActions } from '../../../engine/rules/legalActions';
import type { Action } from '../../../engine/actions';
import type { GameState, Material, PieceType, PlayerId, UnplacedPiece } from '../../../engine/state';
import { moveEvents } from '../../../session/events';
import type { TableEvent } from '../../../session/room';
import { DUR, planTransition, type TransitionPlan } from '../../../table/transition';
import type { Target } from '../../../table/types';
import { HEX_RADIUS, boardBounds, unionBounds, type Bounds, type SideLayout, type XZ } from '../../../table/layout';
import { DEFAULT_COLORS, sceneBelts, scenePieces, scenePlayers, setupState } from './scene';
import type { Callout, FigColor, GlowAt, PlayExample, PlayStart, PlayStep } from './types';

export class PlayError extends Error {}

/** One engine move of a step, with what the game would show for it. */
export interface MoveRun {
  readonly seat: number;
  readonly action: Action;
  readonly before: GameState;
  readonly after: GameState;
  readonly events: readonly TableEvent[];
  readonly plan: TransitionPlan;
}

export interface StepRun {
  readonly caption: string;
  /** The state the step starts from: the previous rest, or a jump / a passed turn applied to it. */
  readonly from: GameState;
  /** The board changed without a move (a jump): shown at once. */
  readonly jumped: boolean;
  readonly moves: readonly MoveRun[];
  /** The state the step rests on. */
  readonly after: GameState;
  /** Every table event of the step's moves. */
  readonly events: readonly TableEvent[];
  /** What glows at rest (in the colour of the player to move). */
  readonly glow: readonly Target[];
  /** Markers at rest: this step's, and with keepMarks every earlier step's. */
  readonly marks: readonly Callout[];
}

export interface Timeline {
  readonly start: GameState;
  readonly startGlow: readonly Target[];
  readonly steps: readonly StepRun[];
  readonly colors: readonly FigColor[];
}

// ── Starting positions ─────────────────────────────────────────────────────────────────────────

const STACK_IDS = 'abcdefghijklmnopqrstuvwxyz';

/** The state an example starts from (or jumps to). */
export function startState(start: PlayStart): GameState {
  if (start.setup) {
    let s = setupState(start.setup.seed, start.setup.players, !!start.setup.claims);
    if (start.turn) s = passTurn(s, start.turn.seat, start.turn.phase, start.turn.order);
    return withHoldings(s, start);
  }
  const scene = start.scene ?? {};
  const players = Math.max(scenePlayers(scene), start.players?.length ?? 0, (start.turn?.seat ?? 0) + 1, start.turn?.order?.length ?? 0, 2) as 2 | 3 | 4;
  const base = createGame(1, Math.min(4, players) as 2 | 3 | 4);
  const board = scenePieces(scene);
  const belts = sceneBelts(scene);
  const mines = board.filter(p => p.type === 'mine').length;
  const onBoard = (id: number): Set<number> => new Set(board.flatMap(p => p.claims.filter(c => c.ownerId === id).map(c => c.controlModule)));
  const stack: UnplacedPiece[] = (start.stack ?? []).map((type: PieceType, i) => ({ id: `st-${type}-${STACK_IDS[i] ?? i}`, type }));
  let s: GameState = {
    ...base,
    board,
    belts,
    players: base.players.map(pl => {
      const used = onBoard(pl.id);
      const m = scene.meeples?.find(x => x.player === pl.id);
      const piece = m ? board.find(p => p.id === m.piece) : undefined;
      return {
        ...pl,
        controlModules: pl.controlModules.filter(n => !used.has(n)),
        meepleOnPieceId: m ? m.piece : null,
        meepleSlotIndex: m && piece?.type === 'mine' ? (m.slot ?? 0) : null,
        beltsRemaining: pl.beltsRemaining - belts.filter(b => b.ownerId === pl.id).length,
      };
    }),
    stacks: [
      { ...base.stacks[0], available: true, pieces: stack },
      { ...base.stacks[1], available: mines >= 2, pieces: (start.stacks23?.[0] ?? []).map((type: PieceType, i) => ({ id: `s2-${type}-${STACK_IDS[i] ?? i}`, type })) },
      { ...base.stacks[2], available: mines >= 3, pieces: (start.stacks23?.[1] ?? []).map((type: PieceType, i) => ({ id: `s3-${type}-${STACK_IDS[i] ?? i}`, type })) },
    ],
    unplacedMines: base.unplacedMines.filter(m => !board.some(p => p.id === m.id)),
    pendingMineIds: [],
    mineCount: Math.max(1, mines),
    globalTeleporterCount: board.reduce((n, p) => n + (p.input?.teleporters.filter(o => o != null).length ?? 0) + (p.output?.teleporters.filter(o => o != null).length ?? 0), 0),
    cardDeck: [],
    cardDiscard: [],
    lastRoll: null,
    drawnStackIndex: null,
    pendingFactoryOps: [],
    overstockPieces: [],
  };
  // Stacks 2 and 3 lie under the Mines not yet in play; a staged board shows no piles but stack 1.
  s = passTurn(s, start.turn?.seat ?? 0, start.turn?.phase ?? 'actions', start.turn?.order);
  return withHoldings(s, start);
}

function withHoldings(s: GameState, start: PlayStart): GameState {
  const h = start.players;
  if (!h) return s;
  return {
    ...s,
    players: s.players.map(pl => {
      const x = h[pl.id];
      if (!x) return pl;
      const inv = { ...pl.inventory };
      for (const [m, n] of Object.entries(x.materials ?? {}) as [Material, number][]) inv[m] = n;
      return {
        ...pl,
        powerTokens: x.power ?? pl.powerTokens,
        inventory: inv,
        freeActionCredits: x.credits ?? pl.freeActionCredits,
        freeUpgradesRemaining: x.freeUpgrades ?? pl.freeUpgradesRemaining,
        hand: x.hand ?? pl.hand,
        beltsRemaining: x.belts ?? pl.beltsRemaining,
        teleportersRemaining: x.teleporters ?? pl.teleportersRemaining,
      };
    }),
  };
}

/** The turn passes to `seat`, in `phase` (not a move: what happens in between is not shown). */
export function passTurn(s: GameState, seat: number, phase: GameState['phase'], order?: readonly number[]): GameState {
  const turnOrder = (order ?? s.turnOrder) as readonly PlayerId[];
  const index = turnOrder.indexOf(seat as PlayerId);
  if (index < 0) throw new PlayError(`player ${seat} is not in the turn order`);
  return {
    ...s,
    turnOrder,
    activePlayerIndex: index,
    phase,
    lastRoll: null,
    drawnStackIndex: null,
    pendingFactoryOps: [],
    mineBeltPlacedThisTurn: false,
    beltsPlacedThisTurn: [],
    cardsPlayedThisTurn: 0,
    productionIncreaseBudget: 0,
    productionIncreaseClaimedThisTurn: false,
  };
}

// ── What glows ─────────────────────────────────────────────────────────────────────────────────

/** The player whose turn it is. */
export const activeSeat = (s: GameState): number => s.turnOrder[s.activePlayerIndex] ?? 0;

/** Things on the table the player to move may choose now, from the engine's legal moves. */
export function legalTargets(s: GameState): Target[] {
  const out = new Map<string, Target>();
  const add = (t: Target): void => { out.set(JSON.stringify(t), t); };
  for (const a of legalActions(s, activeSeat(s) as PlayerId)) {
    if (a.type === 'PLACE_PIECE' || a.type === 'PLACE_MINE') add({ kind: 'cell', q: a.coord.q, r: a.coord.r });
    else if (a.type === 'SETUP_CLAIM' || a.type === 'CLAIM_BUILDING' || a.type === 'UPGRADE_BUILDING') add({ kind: 'piece', pieceId: a.pieceId });
    else if (a.type === 'PLACE_TELEPORTER') add({ kind: 'buffer', pieceId: a.pieceId, buffer: a.bufferType, ...(a.bufferType === 'input' ? { slot: a.inputIndex ?? 0 } : {}) });
    else if (a.type === 'PLACE_MEEPLE') add(a.slotIndex === undefined ? { kind: 'piece', pieceId: a.pieceId } : { kind: 'mineSlot', pieceId: a.pieceId, slot: a.slotIndex });
  }
  return [...out.values()];
}

function glowTarget(g: GlowAt): Target {
  if ('q' in g) return { kind: 'cell', q: g.q, r: g.r };
  if ('point' in g) return { kind: 'point', pieceId: g.piece, point: g.point };
  if ('buffer' in g) return { kind: 'buffer', pieceId: g.piece, buffer: g.buffer };
  return { kind: 'mineSlot', pieceId: g.piece, slot: g.slot };
}

function glowOf(spec: PlayStep['glow'], s: GameState): Target[] {
  if (spec === undefined) return [];
  if (spec === 'legal') return legalTargets(s);
  if ('beltsFrom' in spec) return beltEnds(s, spec.beltsFrom.piece, spec.beltsFrom.point);
  return spec.map(glowTarget);
}

/** Where a belt starting at that point may end, by the engine's legal moves (empty: none may start there). */
export function beltEnds(s: GameState, pieceId: string, point: number): Target[] {
  const out: Target[] = [];
  for (const a of legalActions(s, activeSeat(s) as PlayerId)) {
    if (a.type !== 'PLACE_BELT' || a.pieceId !== pieceId) continue;
    const other = a.fromPoint === point ? a.toPoint : a.toPoint === point ? a.fromPoint : null;
    if (other !== null) out.push({ kind: 'point', pieceId, point: other });
  }
  return out;
}

// ── The whole example ──────────────────────────────────────────────────────────────────────────

/** Replay an example through the engine. Throws PlayError when a move is refused. */
export function buildTimeline(ex: PlayExample): Timeline {
  const start = startState(ex.start);
  let s = start;
  const steps: StepRun[] = [];
  let kept: Callout[] = [];
  ex.steps.forEach((step, i) => {
    let from = s;
    const jumped = !!step.jump;
    if (step.jump) { from = startState(step.jump); kept = []; }
    if (step.turnTo) from = passTurn(from, step.turnTo.seat, step.turnTo.phase);
    let cur = from;
    const moves: MoveRun[] = [];
    for (const [j, m] of (step.moves ?? []).entries()) {
      const seat = m.seat ?? activeSeat(cur);
      const r = applyAction(cur, m.act);
      if (!r.ok) throw new PlayError(`${ex.id} step ${i + 1} move ${j + 1} (${m.act.type}): ${r.error.code} ${r.error.message}`);
      const events = moveEvents(cur, r.state, m.act, seat);
      moves.push({ seat, action: m.act, before: cur, after: r.state, events, plan: planTransition(cur, r.state, events) });
      cur = r.state;
    }
    const marks = [...(ex.keepMarks ? kept : []), ...(step.callouts ?? [])];
    if (ex.keepMarks) kept = marks;
    steps.push({
      caption: step.caption, from, jumped, moves, after: cur,
      events: moves.flatMap(m => m.events),
      glow: glowOf(step.glow, cur),
      marks,
    });
    s = cur;
  });
  return { start, startGlow: ex.start.glow === 'legal' ? legalTargets(start) : [], steps, colors: ex.colors ?? DEFAULT_COLORS };
}

// ── Camera frame and what stands beside the board ──────────────────────────────────────────────

/** Where the camera looks for the whole example, and where stack 1 and the dice stand (or far away). */
export interface PlayLayout {
  readonly bounds: Bounds;
  /** Height to keep in the picture (the pile and the piece held above it). */
  readonly top: number;
  /** View turned by 60-degree steps. */
  readonly turn: number;
  readonly side: SideLayout;
}

const FAR: XZ = { x: 1e6, z: 1e6 };

/** Every state an example shows, in order. */
export function statesOf(tl: Timeline): GameState[] {
  return [tl.start, ...tl.steps.flatMap(s => [s.from, ...s.moves.map(m => m.after)])];
}

export function playLayout(ex: PlayExample, tl: Timeline): PlayLayout {
  const states = statesOf(tl);
  const ids = ex.frame ? new Set(ex.frame.pieces) : null;
  const pieces = new Map<string, GameState['board'][number]>();
  for (const s of states) for (const p of s.board) if (!ids || ids.has(p.id)) pieces.set(`${p.id}@${p.coord.q},${p.coord.r}`, p);
  let b = boardBounds([...pieces.values()]);
  // Spaces that glow at some rest are part of the picture too.
  if (!ids) {
    const cells = [...tl.startGlow, ...tl.steps.flatMap(s => s.glow)].filter((t): t is Extract<Target, { kind: 'cell' }> => t.kind === 'cell');
    if (cells.length) b = unionBounds(b, boardBounds(cells.map(c => ({ type: 'blank' as const, coord: { q: c.q, r: c.r } }))));
  }
  const pad = ex.frame?.pad ?? 0;
  if (pad) b = { minX: b.minX - pad, maxX: b.maxX + pad, minZ: b.minZ - pad, maxZ: b.maxZ + pad };
  const board = b;
  const midZ = (board.minZ + board.maxZ) / 2;
  const stacks: [XZ, XZ, XZ] = [FAR, FAR, FAR];
  let dice: XZ[] = [];
  let top = 12;
  if (ex.pile) {
    // The piles shown stand in a column to the right of the board (a Mine lying on one overhangs it).
    const shown = ex.pile === true ? [0] : ex.pile;
    shown.forEach((k, j) => {
      const at = { x: board.maxX + HEX_RADIUS + 16 + (shown.length > 1 ? 18 : 0), z: midZ + (j - (shown.length - 1) / 2) * (HEX_RADIUS * 2 + 14) };
      stacks[k as 0 | 1 | 2] = at;
      const half = shown.length > 1 ? HEX_RADIUS * 2.1 : HEX_RADIUS;
      b = unionBounds(b, { minX: at.x - half, maxX: at.x + half, minZ: at.z - HEX_RADIUS, maxZ: at.z + HEX_RADIUS });
    });
    top = 36;
  }
  if (ex.dice) {
    const n = Math.max(...states.map(s => s.mineCount));
    dice = Array.from({ length: n }, (_, i) => ({ x: board.maxX + 24 + i * 26, z: board.maxZ - 18 - (i % 2) * 8 }));
    for (const d of dice) b = unionBounds(b, { minX: d.x - 14, maxX: d.x + 14, minZ: d.z - 14, maxZ: d.z + 14 });
  }
  // The dice of a staged board without `dice` still exist in the scene: far away.
  if (!ex.dice) dice = Array.from({ length: 3 }, () => FAR);
  return { bounds: b, top, turn: ex.turn ?? 0, side: { stacks, deck: FAR, discard: FAR, dice } };
}

// ── Timing ─────────────────────────────────────────────────────────────────────────────────────

/** Time between two steps at rest while an example plays through (Normal speed; Fast shortens it). */
export const REST_MS = { normal: 1300, fast: 900 } as const;
/** Before the first step, so the reader sees the starting position. */
export const FIRST_MS = 700;
/** A see-through piece turning on its space before it is placed (the player's choice). */
export const LEAD_PLACE_MS = 900;
/** A Control Module lighting in the tray and travelling to its building. */
export const LEAD_TRAY_MS = DUR.flight + 420;
/** Between two moves of one step. */
export const MOVE_GAP_MS = 260;
/** A step without moves (the turn passes, the board jumps): long enough for a piece to turn over. */
export const STILL_STEP_MS = 650;

/** One move's part of a step: a lead-in (the choice being made), then the game's animation. */
export interface Segment { readonly move: number; readonly at: number; readonly lead: number; readonly anim: number }
export interface StepTiming { readonly segments: readonly Segment[]; readonly total: number }

/** True when the move puts one of the player's Control Modules on a building (a claim or an upgrade). */
export function movesModule(m: MoveRun): boolean {
  return m.action.type === 'SETUP_CLAIM' || m.action.type === 'CLAIM_BUILDING' || m.action.type === 'UPGRADE_BUILDING';
}

/** How a step is laid out in time at speed factor k (1 Normal, 0.5 Fast); `tray`: the side panel shows the tray. */
export function stepTiming(step: StepRun, k: number, tray: boolean): StepTiming {
  const segments: Segment[] = [];
  let t = 0;
  step.moves.forEach((m, i) => {
    if (i > 0) t += MOVE_GAP_MS * k;
    const lead = (m.action.type === 'PLACE_PIECE' ? LEAD_PLACE_MS : tray && movesModule(m) ? LEAD_TRAY_MS : 0) * k;
    const anim = m.plan.baseMs * k;
    segments.push({ move: i, at: t, lead, anim });
    t += lead + anim;
  });
  if (segments.length === 0) t = STILL_STEP_MS * k;
  return { segments, total: Math.max(t, 1) };
}
