// The Smart Bot's decision procedure (id 'greedy'). It began 2026-11-27 as a copy of the play-style
// bots' procedure (styles/styleBot.ts) and is improved here one measured step at a time; every
// step and its numbers are in docs/SMART_BOT_LOG.md. It follows a plan the way a player does:
// decide whether to run an activated factory, put the drawn piece where it feeds its own
// buildings, spend on what the plan needs (belts, a teleporter, a card, the next Mine) while
// keeping the materials for the next recipe, place the meeple where the round end pays most, and
// at the round end claim and upgrade for the dice in play. Every step reads the state through
// styles/analysis.ts and is checked by applyAction before it is returned, so it never sends a
// move the engine refuses.
//
// Deterministic: nothing here reads the clock or Math.random; ties go to the first candidate in
// the engine's own move order. The hidden order of the face-down stacks and of the Leverage deck
// is never read — only what a player at the table could know.

import type { Action } from '../../engine/actions';
import type { BoardPiece, CardType, GameState, Material, PieceType, Player, PlayerId } from '../../engine/state';
import type { BotFn } from '../botInterface';
import { applyAction, legalActions } from '../../engine/reducer';
import {
  BELT_COST, BONUS_THRESHOLDS, INVENTORY_CAP, MATERIAL_VALUES, MINE_COSTS, POWER_TOKEN_CAP,
  cardCost, pieceTemplate, teleporterCost,
} from '../../engine/config';
import { payMaterials } from '../../engine/rules/flow';
import { freeTeleporterSlots, teleporterOn, withTeleporter } from '../../engine/rules/teleporters';
import { lossIfModuleLeaves, mayAddClaim } from '../../engine/rules/ownership';
import { adjAt, getRole } from '../../engine/rules/flow';
import { canLoadMaterial, factoryProduct } from '../../engine/rules/recipes';
import { findInputCompletion } from '../../engine/rules/production';
import { mineSlotReward, cappedAmount } from '../../engine/rules/mineRewards';
import { hexNeighbours, isCoordsOccupied, mineSecondaryCoord } from '../../engine/rules/pieces';
import { longestBeltChain } from '../../engine/rules/beltWeaver';
import { tesseractCount, resourcePoints } from '../../engine/rules/scoring';
import {
  MATS, PRODUCT, POWER_COST, across, bufferedValue, buildingValue, fedFraction, feedAt, hexDistance,
  isBuilding, myBuildings, myModules, outputFeedsMine, owns, pointsWithRole, powerYield, runWorth,
  runsPerRound, unfedInputs,
} from '../styles/analysis';
import { hitChance, nextMineWeight, stateDice } from '../styles/dice';
import { longRoute, routeToInput, thisTurnChainEnd } from '../styles/routes';
import type { SmartConfig as Style } from './config';

// ── Context ───────────────────────────────────────────────────────────────────

interface Ctx {
  readonly state: GameState;
  readonly me: PlayerId;
  readonly style: Style;
  readonly p: Player;
  /** Worth of one Power Token right now. */
  readonly pv: number;
  /** Extra worth per unit of each material for the plan (on top of its point value). */
  readonly need: Record<Material, number>;
  /** Rounds the game is likely to last (pieces left / players), at most 10 — the planning horizon. */
  readonly horizon: number;
  /** How much the next Mine's dice weigh in module choices. */
  readonly fw: number;
  readonly ownsTess: boolean;
  /** Materials to keep for the next recipe (not spent on purchases). */
  readonly reserve: Record<Material, number>;
  /** Points lead over the best opponent (inventory value). */
  readonly lead: number;
  /** The board is about to run out: buy nothing that only pays back over later rounds. */
  readonly thrifty: boolean;
}

const TESS_WIN_WORTH = 23;

function makeCtx(state: GameState, me: PlayerId, style: Style): Ctx {
  const p = state.players[me]!;
  const mine = myBuildings(state, me);
  const ownsTess = mine.some(b => b.type === 'tesseractFact');
  const ownsSphere = mine.some(b => b.type === 'sphereFact');
  const wantPower = ownsTess ? 3 : ownsSphere ? 2 : 1;
  let pv = style.powerValue;
  // Power balance: a token is worth more when short of what my buildings burn, less near the cap.
  if (style.ablate?.power) { /* ablation: a flat token value */ } else if (p.powerTokens < wantPower) pv *= 1.8;
  else if (p.powerTokens >= 8) pv *= 0.5;
  let piecesLeft = 0;
  for (const s of state.stacks) piecesLeft += s.pieces.length;
  const roundsLeft = piecesLeft / state.playerCount;
  // Power Tokens score no points: as the board runs out they are only worth the runs left.
  if (style.endgamePower && state.pendingMineIds.length === 0) pv *= Math.max(0.15, Math.min(1, roundsLeft / 2.5));

  const inv = p.inventory;
  const need: Record<Material, number> = { ore: 0, plate: 0, sphere: 0, tesseract: 0 };
  const reserve: Record<Material, number> = { ore: 0, plate: 0, sphere: 0, tesseract: 0 };
  const held = tesseractCount(state, me);
  // A real Tesseract is the goal: worth its points plus a share of the win, more as the win nears.
  need.tesseract = style.hoard ? 6 : 14 + 6 * held;
  if (ownsTess) {
    if (inv.sphere < 1) need.sphere += 6;
    if (inv.plate < 1) need.plate += 2.5;
    if (inv.ore + inv.plate < 2) need.ore += 0.8;
    reserve.sphere = 1; reserve.plate = 1; reserve.ore = 1;
  } else if (state.mineCount >= 2 && !style.hoard) {
    if (inv.sphere < 1) need.sphere += 2;
  }
  if (ownsSphere && inv.plate < 2) need.plate += 1;
  // One Tesseract from the win: what the last Tesseract Factory run needs (three Power Tokens and
  // its inputs) is worth much more than usual.
  if (style.closer && held >= 3 && ownsTess) {
    if (p.powerTokens < 3) pv *= 2;
    if (inv.sphere < 1) need.sphere += 6;
    if (inv.plate < 1) need.plate += 3;
  }
  // In the last round or so a material is worth its points and nothing more: no later recipe needs it.
  if (style.endgamePoints && roundsLeft <= 1.2 && state.pendingMineIds.length === 0) for (const m of MATS) need[m] = 0;
  // Materials beyond the 6-per-material limit are worth nothing more.
  for (const m of MATS) if (inv[m] >= INVENTORY_CAP) need[m] = -MATERIAL_VALUES[m];

  const horizon = Math.max(1, Math.min(10, piecesLeft / state.playerCount));
  const fw = state.mineCount >= 3 ? 0 : Math.max(nextMineWeight(state), style.lookAheadDice * (state.mineCount === 1 ? 0.6 : 0.4));
  const mePts = resourcePoints(p);
  let best = 0;
  for (const o of state.players) if (o.id !== me) best = Math.max(best, resourcePoints(o));
  const thrifty = style.endgameThrift && roundsLeft <= 1.5 && state.pendingMineIds.length === 0;
  return { state, me, style, p, pv, need, horizon, fw, ownsTess, reserve, lead: mePts - best, thrifty };
}

// ── Features (with the switches that turn one off, to measure what it is worth) ──

/** How much of a building's recipe arrives by itself (supply connectivity), 0–1. */
function fedOf(ctx: Ctx, state: GameState, b: BoardPiece): number {
  return ctx.style.ablate?.supply ? 0.5 : fedFraction(state, b, ctx.me);
}

/** Expected runs per round of a building with these modules (expected production, from the dice odds). */
function runsOf(ctx: Ctx, state: GameState, mods: readonly number[]): number {
  if (ctx.style.ablate?.dice) {
    // Ablation: every reachable sum equally likely (ignores the bell shape of several dice).
    const lo = state.mineCount;
    const hi = 6 * state.mineCount;
    return mods.filter(m => m >= lo && m <= hi).length / (hi - lo + 1) * state.playerCount;
  }
  return runsPerRound(state, mods, ctx.fw);
}

/** A building's worth per round to me (as analysis.buildingValue, through the switches above). */
function valueOf(ctx: Ctx, state: GameState, b: BoardPiece, mods: readonly number[]): number {
  if (!ctx.style.ablate) return buildingValue(state, b, ctx.me, ctx.pv, mods, ctx.fw);
  if (mods.length === 0) return 0;
  const fed = fedOf(ctx, state, b);
  const carriesAway = teleporterOn(b.output) === ctx.me || b.type === 'powerPlant' || outputFeedsMine(state, b, ctx.me);
  return runsOf(ctx, state, mods) * runWorth(b.type, ctx.pv) * (0.35 + 0.65 * fed) * (carriesAway ? 1 : 0.25);
}

function worth(ctx: Ctx, m: Material): number {
  return MATERIAL_VALUES[m] + ctx.need[m];
}

/** The bot's sense of its own economy: inventory, power and what sits in its buffers. */
function econ(ctx: Ctx, s: GameState): number {
  const p = s.players[ctx.me]!;
  let v = 0;
  for (const m of MATS) v += p.inventory[m] * worth(ctx, m);
  v += powerWorth(ctx, p.powerTokens);
  for (const b of s.board) {
    if (b.type === 'mine' || !owns(b, ctx.me)) continue;
    v += buffersWorth(ctx, b);
  }
  return v;
}

/** What the material in one of my buildings' buffers is worth to me (as econ counts it). */
function buffersWorth(ctx: Ctx, b: BoardPiece): number {
  let v = 0;
  if (b.output) for (const x of b.output.slots) if (x) v += 0.75 * worth(ctx, x);
  if (b.input) for (const x of b.input.slots) if (x && x !== 'ore') v += 0.4 * MATERIAL_VALUES[x];
  return v;
}

/**
 * Worth of holding `tokens` Power Tokens. Tokens are fuel: the first few (enough for the next
 * Tesseract run) are worth a lot, later ones less, and none past what a turn or two can burn —
 * so a bot never trades a Sphere for ten tokens it will not use.
 */
function powerWorth(ctx: Ctx, tokens: number): number {
  let v = 0;
  for (let i = 0; i < tokens; i++) v += ctx.pv * (i < 3 ? 1.5 : i < 6 ? 0.8 : 0.25);
  return v;
}

/** The listed move that leaves the bot's economy best (null if none is listed). */
function bestByEcon(ctx: Ctx, acts: readonly Action[]): { a: Action; gain: number } | null {
  const base = econ(ctx, ctx.state);
  let best: { a: Action; gain: number } | null = null;
  for (const a of acts) {
    const s = after(ctx.state, a);
    if (!s) continue;
    const gain = econ(ctx, s) - base;
    if (best === null || gain > best.gain + 1e-9) best = { a, gain };
  }
  return best;
}

/** Moves of the step itself, without the Leverage card plays now listed in every step of the turn. */
function stepMoves(acts: readonly Action[]): Action[] {
  return acts.filter(a => a.type !== 'PLAY_CARD' && !((a.type === 'CLAIM_BUILDING' || a.type === 'UPGRADE_BUILDING') && a.fromProductionIncrease === true));
}

function legal(state: GameState, a: Action): boolean {
  return applyAction(state, a).ok;
}

function after(state: GameState, a: Action): GameState | null {
  const r = applyAction(state, a);
  return r.ok ? r.state : null;
}

/** Can `cost` be paid while keeping the reserve for the next recipe? */
function affordable(ctx: Ctx, cost: number, ignoreReserve = false): boolean {
  const left = payMaterials(ctx.p.inventory, cost);
  if (!left) return false;
  if (ignoreReserve) return true;
  return MATS.every(m => left[m] >= Math.min(ctx.reserve[m], ctx.p.inventory[m]));
}

function pickBest<T>(items: readonly T[], score: (t: T) => number): { item: T; score: number } | null {
  let best: { item: T; score: number } | null = null;
  for (const it of items) {
    const s = score(it);
    if (best === null || s > best.score) best = { item: it, score: s };
  }
  return best;
}

// ── Entry point ───────────────────────────────────────────────────────────────

/**
 * For tests: what the bot thinks its Control Modules are worth if they stood as in `changes`
 * (building id → my modules on it; other buildings as they are) — production over the planning
 * horizon plus the Bonus Tesseracts held or approached.
 */
export function claimWorthFor(state: GameState, me: PlayerId, style: Style, changes: ReadonlyMap<string, number[]>): number {
  return claimSetWorth(makeCtx(state, me, style), new Map(changes));
}

export function makeSmartBot(style: Style): BotFn {
  return (state: GameState, me: PlayerId): Action => decide(state, me, style);
}

function decide(state: GameState, me: PlayerId, style: Style): Action {
  if (state.phase === 'roll' && !state.pendingFactoryOps.some(e => e.ownerId === me)) {
    return { type: 'ROLL_DICE', rolls: stateDice(state, me) };
  }
  const ctx = makeCtx(state, me, style);
  let a: Action | null = null;
  if (state.pendingFactoryOps.some(e => e.ownerId === me)) a = decidePending(ctx);
  else {
    switch (state.phase) {
      case 'setupClaimPF':
      case 'setupClaimPP': a = decideSetup(ctx); break;
      case 'placePiece': a = decidePlacePiece(ctx); break;
      case 'actions': a = decideActions(ctx); break;
      case 'placeMeeple': a = decideMeeple(ctx); break;
      case 'roundEnd': a = decideRoundEnd(ctx); break;
      default: break;
    }
  }
  if (a && legal(state, a)) return a;
  return fallback(state, me);
}

/** A safe listed move: end the step when possible, else the first one listed. */
function fallback(state: GameState, me: PlayerId): Action {
  const acts = legalActions(state, me);
  const end = acts.find(x => x.type === 'END_ACTIONS' || x.type === 'END_TURN' || x.type === 'SKIP_FACTORY_ROLL');
  const a = end ?? acts[0];
  if (!a) throw new Error(`style bot: no legal move for player ${me} in phase "${state.phase}"`);
  return a;
}

// ── Run or skip an activated factory ──────────────────────────────────────────

function decidePending(ctx: Ctx): Action | null {
  // Each listed run names what it takes from the inventory through the input teleporter (its
  // supply); weigh each against what is handed over and take the best, else skip. A Power Plant
  // with the bot's teleporter must run (no skip is listed), so the best run is taken anyway —
  // usually with nothing supplied.
  const acts = legalActions(ctx.state, ctx.me);
  const first = acts.find(a => a.type === 'OPERATE_BUILDING' || a.type === 'SKIP_FACTORY_ROLL');
  const pieceId = first && (first.type === 'OPERATE_BUILDING' || first.type === 'SKIP_FACTORY_ROLL') ? first.pieceId : null;
  const mine = acts.filter(a => (a.type === 'OPERATE_BUILDING' || a.type === 'SKIP_FACTORY_ROLL') && a.pieceId === pieceId);
  const skip = mine.find(a => a.type === 'SKIP_FACTORY_ROLL');
  const best = bestByEcon(ctx, mine.filter(a => a.type === 'OPERATE_BUILDING'));
  if (best && (best.gain > 0.01 || !skip)) return best.a;
  return skip ?? null;
}

// ── Setup claims ──────────────────────────────────────────────────────────────

function decideSetup(ctx: Ctx): Action | null {
  const acts = legalActions(ctx.state, ctx.me);
  const best = pickBest(acts, a => {
    if (a.type !== 'SETUP_CLAIM') return -Infinity;
    const piece = ctx.state.board.find(b => b.id === a.pieceId);
    if (!piece) return -Infinity;
    // A building whose input faces a Mine ore exit runs by itself; one whose output faces
    // another building's input can start a chain.
    let s = 10 * fedOf(ctx, ctx.state, piece);
    for (const pos of pointsWithRole(piece, 'output_buffer')) {
      const n = across(ctx.state.board, piece.coord, piece.rotation ?? 0, pos);
      if (n && n.role === 'input_buffer') s += 1;
    }
    return s;
  });
  return best?.item ?? null;
}

// ── Draw and place a piece ────────────────────────────────────────────────────

/** How much the bot wants a piece of each kind right now. */
function typeWants(ctx: Ctx): Record<PieceType, number> {
  const mine = myBuildings(ctx.state, ctx.me);
  const has = (t: PieceType): boolean => mine.some(b => b.type === t);
  return {
    tesseractFact: has('tesseractFact') ? 1.2 : 3,
    sphereFact: has('sphereFact') ? 1 : 1.6,
    plateFact: 1,
    powerPlant: ctx.p.powerTokens < 3 ? 1.3 : 0.6,
    blank: ctx.style.bonusWeight.beltWeaver >= 1 ? 1 : 0.4,
    mine: 0,
  };
}

/** Would the bot like the game to end soon? (Ahead on points, hoarding style.) */
function wantsEnd(ctx: Ctx): boolean {
  if (ctx.style.hurryWhenAhead && ctx.lead >= 4) return true; // the board-exhaustion ending would go my way
  return ctx.style.hoard && ctx.lead > 0;
}

function decideDraw(ctx: Ctx, acts: readonly Action[]): Action | null {
  const want = typeWants(ctx);
  const hurry = wantsEnd(ctx) || ctx.style.mineAppetite >= 0.9;
  const best = pickBest(acts, a => {
    if (a.type !== 'DRAW_PIECE') return -Infinity;
    const pieces = ctx.state.stacks[a.stackIndex].pieces; // kinds left are public; the order is not read
    if (pieces.length === 0) return -Infinity;
    let s = 0;
    for (const pc of pieces) s += want[pc.type];
    s /= pieces.length;
    if (hurry) s += 3 / pieces.length; // empty the shortest stack: the next Mine (or the end) comes sooner
    return s;
  });
  return best?.item ?? null;
}

function accepts(type: PieceType, m: Material): boolean {
  const n = type === 'sphereFact' ? 2 : type === 'tesseractFact' ? 3 : 1;
  return canLoadMaterial(type, new Array<Material | null>(n).fill(null), m);
}

/** Input points of the bot's own buildings that nothing feeds yet (as piece:pos keys). */
function myUnfedPoints(ctx: Ctx): Set<string> {
  const out = new Set<string>();
  for (const b of myBuildings(ctx.state, ctx.me)) for (const u of unfedInputs(ctx.state, b, ctx.me)) out.add(`${b.id}:${u.pos}`);
  return out;
}

const TYPE_SCALE: Record<PieceType, number> = { tesseractFact: 2, sphereFact: 1.4, plateFact: 1, powerPlant: 0.8, blank: 1, mine: 0 };

/**
 * How good a spot is for a piece of `type`: inputs facing Mine ore or a fitting output of the
 * bot's own buildings, the output facing one of its own inputs, belt points next to its unfed
 * inputs (for blanks). An opponent's building touching it neither feeds it nor draws from it
 * (RULES_CHANGES.md #51), so such a neighbour counts as neutral.
 */
function placementScore(ctx: Ctx, type: PieceType, coord: { q: number; r: number }, rot: number, unfed: Set<string>): number {
  const board = ctx.state.board;
  const product = PRODUCT[type];
  const me = ctx.me;
  let s = 0;
  for (const pt of pieceTemplate({ type, id: '__new' }).points) {
    const n = across(board, coord, rot, pt.position);
    if (!pt.enabled) { if (n && n.role === 'ore_output') s -= 0.15; continue; }
    if (pt.role === 'input_buffer') {
      if (!n) { s += 0.1; continue; }
      if (n.role === 'ore_output') s += accepts(type, 'ore') ? 1 : -0.2;
      else if (n.role === 'output_buffer') {
        const m = PRODUCT[n.piece.type];
        // Another player's output no longer passes into my building (#51): neutral (0).
        if (m && accepts(type, m)) s += owns(n.piece, me) ? 1.6 : n.piece.claims.length > 0 ? 0 : 0.4;
        else s -= 0.3;
      } else if (n.role === 'belt') s += 0.15;
      else s -= 0.3;
    } else if (pt.role === 'output_buffer') {
      if (!n) { s += 0.1; continue; }
      if (n.role === 'input_buffer') {
        // My output no longer leaks into another player's building (#51): neutral (0).
        if (product && accepts(n.piece.type, product)) s += owns(n.piece, me) ? 1.6 : n.piece.claims.length > 0 ? 0 : 0.3;
        else s -= 0.3;
      } else if (n.role === 'belt') s += 0.15;
      else s -= 0.2;
    } else if (pt.role === 'belt' && n) {
      if (n.role === 'ore_output') s += type === 'blank' ? 0.2 : -0.1;
      else if (n.role === 'input_buffer' && owns(n.piece, me)) s += unfed.has(`${n.piece.id}:${n.pos}`) ? 0.6 : 0.05;
      else if (n.role === 'output_buffer' && owns(n.piece, me)) s += 0.2;
    }
  }
  s *= TYPE_SCALE[type];
  let near = Infinity;
  for (const b of board) if (isBuilding(b) && owns(b, me)) near = Math.min(near, hexDistance(b.coord, coord));
  if (near !== Infinity) s -= 0.05 * near;
  return s;
}

/**
 * Scores spots for a piece of `type`: how well it fits my buildings, less (when placeDeny is on)
 * how well it would fit the best-placed opponent's — a building put where another player's
 * outputs already reach it is one they claim next.
 */
function spotScorer(ctx: Ctx, type: PieceType): (coord: { q: number; r: number }, rot: number) => number {
  const unfed = myUnfedPoints(ctx);
  const deny = ctx.style.placeDeny;
  if (deny <= 0 || !isBuilding({ type } as BoardPiece)) return (c, r) => placementScore(ctx, type, c, r, unfed);
  const others = ctx.state.players.filter(o => o.id !== ctx.me).map(o => {
    const oc = makeCtx(ctx.state, o.id, ctx.style);
    return { oc, unfed: myUnfedPoints(oc) };
  });
  return (c, r) => {
    let worst = 0;
    for (const o of others) worst = Math.max(worst, placementScore(o.oc, type, c, r, o.unfed));
    return placementScore(ctx, type, c, r, unfed) - deny * worst;
  };
}

function mineSpotScore(ctx: Ctx, mineId: string, coord: { q: number; r: number }, rot: number): number {
  const state = ctx.state;
  const mine: BoardPiece = {
    id: mineId, type: 'mine', coord, rotation: rot, claims: [], input: null,
    output: { slots: [null], teleporters: [] },
  };
  const board2 = [...state.board, mine];
  const sec = mineSecondaryCoord(coord, rot);
  let s = 0;
  for (const b of state.board) {
    if (!isBuilding(b) || !b.input) continue;
    if (hexDistance(b.coord, coord) !== 1 && hexDistance(b.coord, sec) !== 1) continue;
    for (const pos of pointsWithRole(b, 'input_buffer')) {
      const n = adjAt(b.coord, b.rotation ?? 0, pos, board2);
      if (!n || n.piece.id !== mineId || getRole(mine, n.pos) !== 'ore_output') continue;
      if (feedAt(state, b, pos, ctx.me) || !accepts(b.type, 'ore')) continue;
      s += owns(b, ctx.me) ? 3 : b.claims.length > 0 ? -2 : 0.4;
    }
  }
  for (const nb of hexNeighbours(coord)) if (!isCoordsOccupied(nb, board2)) s += 0.25;
  return s;
}

function decidePlacePiece(ctx: Ctx): Action | null {
  const state = ctx.state;
  const acts = stepMoves(legalActions(state, ctx.me));
  if (acts.length === 0) return null;
  if (acts[0]!.type === 'DRAW_PIECE') return decideDraw(ctx, acts);
  if (acts[0]!.type === 'PLACE_MINE') {
    const id = state.pendingMineIds[0]!;
    return pickBest(acts, a => a.type === 'PLACE_MINE' ? mineSpotScore(ctx, id, a.coord, a.rotation ?? 0) : -Infinity)?.item ?? null;
  }
  const first = acts[0]!;
  if (first.type !== 'PLACE_PIECE') return null;
  const top = state.stacks[first.stackIndex].pieces[0]; // the drawn piece, face-up now
  if (!top) return null;
  const score = spotScorer(ctx, top.type);
  return pickBest(acts, a => a.type === 'PLACE_PIECE' ? score(a.coord, a.rotation ?? 0) : -Infinity)?.item ?? null;
}

// ── Claims and upgrades ───────────────────────────────────────────────────────

function maxOtherModule(state: GameState, me: PlayerId): number {
  let m = 0;
  for (const b of state.board) for (const c of b.claims) if (c.ownerId !== me) m = Math.max(m, c.controlModule);
  return m;
}

function distinctClaimed(state: GameState, who: PlayerId): number {
  return state.board.filter(b => isBuilding(b) && owns(b, who)).length;
}

function maxOtherDistinct(state: GameState, me: PlayerId): number {
  let m = 0;
  for (const o of state.players) if (o.id !== me) m = Math.max(m, distinctClaimed(state, o.id));
  return m;
}

const TOP_MODULE = 18;

/**
 * Worth of my modules on all buildings after a change — production over the planning horizon
 * (discounted: plans slip) plus the Bonus Tesseracts they hold or move towards — so a claim or
 * upgrade is judged by the difference it makes.
 */
function claimSetWorth(ctx: Ctx, changes: Map<string, number[]>): number {
  const { state, me } = ctx;
  let v = 0;
  let myMax = 0;
  let distinct = 0;
  let tessFactories = 0;
  for (const b of state.board) {
    if (!isBuilding(b)) continue;
    const mods = changes.get(b.id) ?? myModules(b, me);
    if (mods.length === 0) continue;
    distinct++;
    if (b.type === 'tesseractFact') tessFactories++;
    for (const m of mods) myMax = Math.max(myMax, m);
    v += valueOf(ctx, state, b, mods) * ctx.horizon * 0.6;
  }
  // A Tesseract Factory is the gateway to real Tesseracts: the first one is worth a lot.
  if (tessFactories > 0 && !ctx.style.hoard) v += 14;
  const w = ctx.style.bonusWeight;
  // The Investor: highest Control Module in play, at least 10; a tie keeps it with its holder,
  // so the first to reach 18 keeps it for good. Climbing is worth something on the way.
  const otherMax = maxOtherModule(state, me);
  const holdsInvestor = ctx.p.bonusTesseracts.investor;
  const leads = myMax >= BONUS_THRESHOLDS.investor && (myMax > otherMax || (holdsInvestor && myMax >= otherMax));
  if (otherMax < TOP_MODULE || leads) {
    const locked = leads && myMax >= TOP_MODULE;
    const share = locked ? 1 : (leads ? 0.6 : 0) + 0.4 * Math.max(0, Math.min(1, (myMax - 3) / (TOP_MODULE - 3)));
    v += TESS_WIN_WORTH * w.investor * share;
  }
  // Factory Empire: most distinct buildings claimed, at least 6 (a tie keeps it with its holder).
  const otherDistinct = maxOtherDistinct(state, me);
  const empire = distinct >= BONUS_THRESHOLDS.factoryEmpire &&
    (distinct > otherDistinct || (ctx.p.bonusTesseracts.factoryEmpire && distinct >= otherDistinct));
  v += TESS_WIN_WORTH * w.factoryEmpire * (empire ? 1 : 0.4 * Math.min(1, distinct / BONUS_THRESHOLDS.factoryEmpire));
  v += distinct * ctx.style.breadth;
  // Taking a Bonus Tesseract away from another player costs them one: worth more the closer
  // they are to four.
  if (ctx.style.denyWeight > 0) {
    for (const o of state.players) {
      if (o.id === me) continue;
      const threat = 0.5 + 0.25 * tesseractCount(state, o.id);
      if (o.bonusTesseracts.investor && leads) v += TESS_WIN_WORTH * ctx.style.denyWeight * threat;
      if (o.bonusTesseracts.factoryEmpire && empire) v += TESS_WIN_WORTH * ctx.style.denyWeight * threat;
    }
  }
  return v;
}

function claimChangeGain(ctx: Ctx, a: Action, base: number): number {
  const { state, me } = ctx;
  const changes = new Map<string, number[]>();
  if (a.type === 'CLAIM_BUILDING') {
    const b = state.board.find(x => x.id === a.pieceId);
    if (!b) return -Infinity;
    changes.set(b.id, [...myModules(b, me), a.controlModule]);
  } else if (a.type === 'UPGRADE_BUILDING') {
    const b = state.board.find(x => x.id === a.pieceId);
    if (!b) return -Infinity;
    const mods = myModules(b, me);
    const i = mods.indexOf(a.oldModule);
    if (i < 0) return -Infinity;
    mods[i] = a.newModule;
    changes.set(b.id, mods);
  } else if (a.type === 'PLAY_CARD' && a.cardType === 'changingPriorities' && a.pieceId && a.toPieceId && a.controlModule !== undefined) {
    const from = state.board.find(x => x.id === a.pieceId);
    const to = state.board.find(x => x.id === a.toPieceId);
    if (!from || !to) return -Infinity;
    const fm = myModules(from, me);
    fm.splice(fm.indexOf(a.controlModule), 1);
    changes.set(from.id, fm);
    changes.set(to.id, [...myModules(to, me), a.controlModule]);
    // Moving my last module off it: its material goes to the bank (RULES_CHANGES.md #58).
    if (lossIfModuleLeaves(from, me).materials > 0) return claimSetWorth(ctx, changes) - base - buffersWorth(ctx, from);
  } else if (a.type === 'PLAY_CARD' && a.cardType === 'shortSale' && a.pieceId) {
    const b = state.board.find(x => x.id === a.pieceId);
    const low = [...ctx.p.controlModules].filter(m => m >= state.mineCount).sort((x, y) => x - y)[0];
    if (!b || low === undefined) return -Infinity;
    changes.set(b.id, [...myModules(b, me), low]);
  } else return -Infinity;
  return claimSetWorth(ctx, changes) - base;
}

// ── Meeple ────────────────────────────────────────────────────────────────────

/** Value of upgrade credits: the best claim (and the upgrade left over) they could buy. */
function creditsWorth(ctx: Ctx, credits: number): number {
  const { state, me } = ctx;
  const base = claimSetWorth(ctx, new Map());
  let best = 0;
  const floor = state.mineCount;
  const mods = ctx.p.controlModules.filter(m => m >= floor);
  for (const b of state.board) {
    if (!isBuilding(b)) continue;
    if (!mayAddClaim(b, me)) continue;
    if (myModules(b, me).length >= 3) continue;
    for (const m of mods) {
      if (m - floor + 1 > credits) continue;
      const g = claimSetWorth(ctx, new Map([[b.id, [...myModules(b, me), m]]])) - base;
      if (g > best) best = g;
    }
  }
  // Or upgrades on what I hold.
  for (const b of myBuildings(state, me)) {
    const cur = myModules(b, me);
    cur.forEach((old, i) => {
      for (const m of mods) {
        if (m <= old || m - old > credits) continue;
        const next = [...cur]; next[i] = m;
        const g = claimSetWorth(ctx, new Map([[b.id, next]])) - base;
        if (g > best) best = g;
      }
    });
  }
  return best;
}

/** What the meeple on one of my buildings yields at the round end: collect + one run. */
function harvestWorth(ctx: Ctx, b: BoardPiece): number {
  let v = 0;
  if (b.output) for (const x of b.output.slots) if (x && ctx.p.inventory[x] < INVENTORY_CAP) v += worth(ctx, x);
  const inv = ctx.p.inventory;
  if (b.type === 'powerPlant') {
    const room = POWER_TOKEN_CAP - ctx.p.powerTokens;
    if (room <= 0) return v;
    let bestRun = Math.min(room, powerYield(b.input?.slots[0] ?? null)) * ctx.pv;
    if (b.input && b.input.slots[0] === null) {
      for (const m of ['ore', 'plate', 'sphere'] as Material[]) {
        if (inv[m] <= 0) continue;
        bestRun = Math.max(bestRun, Math.min(room, powerYield(m)) * ctx.pv - worth(ctx, m));
      }
    }
    return v + bestRun;
  }
  if (!b.input || !b.output) return v;
  // A Mine refills its directly fed inputs before the round-end turns.
  const inputPts = pointsWithRole(b, 'input_buffer');
  const slots = b.input.slots.map((x, i): Material | null => {
    if (x) return x;
    const f = feedAt(ctx.state, b, inputPts[i]!, ctx.me);
    return f && f.material === 'ore' && f.viaBelts === 0 ? 'ore' : null;
  });
  let product: Material | null = slots.every(x => x !== null) ? factoryProduct(b.type, slots) : null;
  let consumed = 0;
  if (!product) {
    const comp = findInputCompletion(b.type, slots, inv);
    if (comp) {
      product = factoryProduct(b.type, comp.newSlots);
      for (const m of MATS) consumed += (inv[m] - comp.newInventory[m]) * worth(ctx, m);
    }
  }
  if (product && ctx.p.powerTokens >= POWER_COST[product]) {
    const gain = worth(ctx, product) - consumed - POWER_COST[product] * ctx.pv;
    if (gain > 0) v += gain;
  }
  return v;
}

function decideMeeple(ctx: Ctx): Action | null {
  const { state } = ctx;
  const acts = stepMoves(legalActions(state, ctx.me));
  if (acts.length === 1) return acts[0]!;
  const creditCache = new Map<number, number>();
  const best = pickBest(acts, a => {
    if (a.type !== 'PLACE_MEEPLE') return -Infinity;
    const piece = state.board.find(b => b.id === a.pieceId);
    if (!piece) return -Infinity;
    if (piece.type === 'mine') {
      if (a.slotIndex === 1) {
        // Each Mine's upgrade point pays the credits printed on it (2 / 3 / 4).
        const r = mineSlotReward(state, piece.id, 1);
        const credits = r && r.kind === 'credits' ? r.amount : state.mineCount + 1;
        if (!creditCache.has(credits)) creditCache.set(credits, creditsWorth(ctx, credits));
        return creditCache.get(credits)! + ctx.style.meepleUpgrade;
      }
      const r = mineSlotReward(state, piece.id, 0);
      if (!r || r.kind !== 'material') return -Infinity;
      return cappedAmount(ctx.p.inventory, r.material, r.amount) * worth(ctx, r.material) + ctx.style.meepleMine;
    }
    return harvestWorth(ctx, piece);
  });
  return best?.item ?? null;
}

// ── Round end ─────────────────────────────────────────────────────────────────

function decideRoundEnd(ctx: Ctx): Action | null {
  const { state, me } = ctx;
  const acts = legalActions(state, me);
  const base = claimSetWorth(ctx, new Map());

  // 1. Claims (the Mine's free claim), then upgrades (Mine credits, then the free upgrades).
  let kinds: ReadonlyArray<'claim' | 'mineUpgrade' | 'freeUpgrade'> = ['claim', 'mineUpgrade', 'freeUpgrade'];
  if (ctx.style.planCredits) {
    const planned = planCreditSpend(ctx, acts, base);
    if (planned) return planned;
    if (planned === null) kinds = ['freeUpgrade']; // the plan is to spend no Mine credit
  }
  for (const kind of kinds) {
    const cands = acts.filter(a =>
      kind === 'claim' ? a.type === 'CLAIM_BUILDING'
        : kind === 'mineUpgrade' ? a.type === 'UPGRADE_BUILDING' && a.fromMineCredit === true
          : a.type === 'UPGRADE_BUILDING' && a.fromMineCredit !== true);
    const best = pickBest(cands, a => claimChangeGain(ctx, a, base));
    if (best && best.score > 0.05) return best.item;
  }

  // 2. The meeple's building: collect, run once, collect again.
  const conv = roundEndRun(ctx, acts);
  if (conv) return conv;
  return acts.find(a => a.type === 'END_ACTIONS') ?? null;
}

/**
 * The Mine credits as one plan: a claim is judged together with the best upgrade its leftover
 * credits still buy, and against spending all the credits on upgrades instead. Returns the first
 * step of the best plan, null to spend nothing, or undefined when there is no claim to weigh
 * (the ordinary order then applies).
 */
function planCreditSpend(ctx: Ctx, acts: readonly Action[], base: number): Action | null | undefined {
  const claims = acts.filter(a => a.type === 'CLAIM_BUILDING');
  if (claims.length === 0) return undefined;
  const followUp = (s: GameState): number => {
    const c2 = makeCtx(s, ctx.me, ctx.style);
    const b2 = claimSetWorth(c2, new Map());
    let best = 0;
    for (const u of legalActions(s, ctx.me)) {
      if (u.type !== 'UPGRADE_BUILDING' || u.fromMineCredit !== true) continue;
      best = Math.max(best, claimChangeGain(c2, u, b2));
    }
    return best;
  };
  const scored = claims.map(a => ({ a, g: claimChangeGain(ctx, a, base) })).sort((x, y) => y.g - x.g).slice(0, 6);
  let best: { a: Action | null; v: number } = { a: null, v: 0.05 };
  for (const { a, g } of scored) {
    const s = after(ctx.state, a);
    if (!s) continue;
    const v = g + followUp(s);
    if (v > best.v) best = { a, v };
  }
  // Upgrades only (no claim): the best Mine-credit upgrade, then what is left.
  for (const u of acts) {
    if (u.type !== 'UPGRADE_BUILDING' || u.fromMineCredit !== true) continue;
    const g = claimChangeGain(ctx, u, base);
    if (g <= best.v) continue;
    const s = after(ctx.state, u);
    const v = g + (s ? followUp(s) : 0);
    if (v > best.v) best = { a: u, v };
  }
  return best.a;
}

function roundEndRun(ctx: Ctx, acts: readonly Action[]): Action | null {
  const { state } = ctx;
  const collect = acts.find(a => a.type === 'COLLECT_OUTPUT');
  if (collect) return collect;
  // The meeple's run: the plain run or one naming what its input teleporter takes from the inventory.
  const run = bestByEcon(ctx, acts.filter(a => a.type === 'OPERATE_BUILDING'));
  if (run && run.gain > 0.01) return run.a;
  const p = ctx.p;
  if (p.meepleOperatedThisRound || p.meepleOnPieceId === null || p.meepleSlotIndex !== null) return null;
  const b = state.board.find(x => x.id === p.meepleOnPieceId);
  if (!b || !b.input) return null;
  const loads = acts.filter(a => a.type === 'LOAD_BUILDING_INPUT');
  if (loads.length === 0) return null;
  if (b.type === 'powerPlant') {
    const room = POWER_TOKEN_CAP - p.powerTokens;
    const best = pickBest(loads, a => a.type === 'LOAD_BUILDING_INPUT'
      ? Math.min(room, powerYield(a.material)) * ctx.pv - worth(ctx, a.material) - Math.min(room, 1) * ctx.pv : -Infinity);
    return best && best.score > 0 ? best.item : null;
  }
  // Complete a recipe from the inventory only when the run is worth more than what it uses.
  const comp = findInputCompletion(b.type, b.input.slots, p.inventory);
  if (!comp) return null;
  const product = factoryProduct(b.type, comp.newSlots);
  if (!product || p.powerTokens < POWER_COST[product]) return null;
  let used = 0;
  for (const m of MATS) used += (p.inventory[m] - comp.newInventory[m]) * worth(ctx, m);
  if (worth(ctx, product) - used - POWER_COST[product] * ctx.pv <= 0) return null;
  for (let i = 0; i < b.input.slots.length; i++) {
    if (b.input.slots[i] === null && comp.newSlots[i]) {
      const m = comp.newSlots[i]!;
      const load = loads.find(a => a.type === 'LOAD_BUILDING_INPUT' && a.material === m);
      if (load) return load;
    }
  }
  return null;
}

// ── Actions step ──────────────────────────────────────────────────────────────

function decideActions(ctx: Ctx): Action | null {
  const { state, me } = ctx;
  if (state.overstockPieces.length > 0) {
    const piece = state.overstockPieces[0]!;
    const score = spotScorer(ctx, piece.type);
    const acts = legalActions(state, me).filter(a => a.type === 'PLACE_OVERSTOCK_PIECE');
    return pickBest(acts, a => a.type === 'PLACE_OVERSTOCK_PIECE' ? score(a.coord, a.rotation ?? 0) : -Infinity)?.item ?? null;
  }
  return playCard(ctx)
    ?? spendProductionIncrease(ctx)
    ?? buyMine(ctx)
    ?? buyTeleporter(ctx)
    ?? layBelts(ctx)
    ?? buyCard(ctx)
    ?? { type: 'END_ACTIONS' };
}

function spendProductionIncrease(ctx: Ctx): Action | null {
  if (ctx.state.productionIncreaseBudget <= 0) return null;
  const acts = legalActions(ctx.state, ctx.me).filter(a =>
    (a.type === 'CLAIM_BUILDING' || a.type === 'UPGRADE_BUILDING') && a.fromProductionIncrease === true);
  const base = claimSetWorth(ctx, new Map());
  const best = pickBest(acts, a => claimChangeGain(ctx, a, base));
  return best && best.score > 0.05 ? best.item : null;
}

// ── The next Mine ─────────────────────────────────────────────────────────────

/** Change in per-round production value for `who` if one more die were rolled. */
function diceShift(ctx: Ctx, who: PlayerId): number {
  const { state } = ctx;
  let d = 0;
  for (const b of state.board) {
    if (!isBuilding(b)) continue;
    const w = runWorth(b.type, ctx.style.powerValue);
    for (const c of b.claims) {
      if (c.ownerId !== who) continue;
      d += (hitChance(c.controlModule, state.mineCount + 1) - hitChance(c.controlModule, state.mineCount)) * w * state.playerCount;
    }
  }
  return d;
}

function buyMine(ctx: Ctx): Action | null {
  const { state, me, style } = ctx;
  if (ctx.thrifty || state.unplacedMines.length === 0 || state.pendingMineIds.length > 0) return null;
  const cost = MINE_COSTS[2 - state.unplacedMines.length];
  if (cost === undefined || !affordable(ctx, cost, style.mineAppetite >= 0.9)) return null;
  let others = 0;
  for (const o of state.players) if (o.id !== me) others += diceShift(ctx, o.id);
  others /= Math.max(1, state.playerCount - 1);
  const swing = (diceShift(ctx, me) - others) * ctx.horizon;
  // Mine 2 opens the stacks with the Tesseract Factories; a Mine also raises the Mine rewards.
  const access = state.mineCount === 1 ? 8 : 4;
  const score = swing + access + style.mineAppetite * 14 - cost * (1.2 - 0.6 * style.mineAppetite);
  if (score <= 0) return null;
  const id = state.unplacedMines[0]!.id;
  const acts = legalActions(state, me).filter(a => a.type === 'BUY_MINE');
  return pickBest(acts, a => a.type === 'BUY_MINE' ? mineSpotScore(ctx, id, a.coord, a.rotation ?? 0) : -Infinity)?.item ?? null;
}

// ── Teleporters ───────────────────────────────────────────────────────────────

// What a teleporter of mine on `b` is worth: on the output, the runs it carries away; on input
// `inputIndex`, the share of the recipe it adds (#55: it supplies that one input and cuts it off
// from belts, so an input my belts or a Mine already feed gains nothing — the bot picks an input
// its supply chain does not reach).
function teleporterWorth(ctx: Ctx, b: BoardPiece, buffer: 'input' | 'output', inputIndex = 0): number {
  const { state, me } = ctx;
  const mods = myModules(b, me);
  const runs = runsOf(ctx, state, mods);
  const product = PRODUCT[b.type];
  if (buffer === 'output') {
    if (!product || !b.output) return 0;
    if (outputFeedsMine(state, b, me)) return 0.1;
    // Without it the output buffer holds one piece until the meeple comes: most runs are lost.
    const fed = 0.3 + 0.7 * fedOf(ctx, state, b);
    return runs * worth(ctx, product) * fed * ctx.horizon * 0.45;
  }
  if (!b.input || b.type === 'powerPlant') return 0;
  const withMine: BoardPiece = { ...b, input: withTeleporter(b.input, inputIndex, me) };
  const gain = ctx.style.ablate?.supply ? 0.25 : fedFraction(state, withMine, me) - fedFraction(state, b, me);
  if (gain <= 0) return 0;
  return runs * runWorth(b.type, ctx.pv) * gain * ctx.horizon * (b.type === 'tesseractFact' ? 0.6 : 0.3);
}

function buyTeleporter(ctx: Ctx): Action | null {
  const { state, style } = ctx;
  if (ctx.thrifty || ctx.p.teleportersRemaining <= 0 || style.teleporterAppetite <= 0) return null;
  const cost = teleporterCost(state.globalTeleporterCount);
  if (!affordable(ctx, cost, style.teleporterAppetite >= 0.9)) return null;
  const cands: Array<{ a: Action; v: number }> = [];
  for (const b of myBuildings(state, ctx.me)) {
    for (const inputIndex of freeTeleporterSlots(b.input)) {
      cands.push({ a: { type: 'PLACE_TELEPORTER', pieceId: b.id, bufferType: 'input', inputIndex }, v: teleporterWorth(ctx, b, 'input', inputIndex) });
    }
    if (freeTeleporterSlots(b.output).length > 0) {
      cands.push({ a: { type: 'PLACE_TELEPORTER', pieceId: b.id, bufferType: 'output' }, v: teleporterWorth(ctx, b, 'output') });
    }
  }
  const best = pickBest(cands, c => c.v);
  if (!best) return null;
  if (best.score * (0.5 + style.teleporterAppetite) <= cost + 1.5) return null;
  return best.item.a;
}

// ── Belts ─────────────────────────────────────────────────────────────────────

function beltBudget(ctx: Ctx): number {
  let buyable = 0;
  let inv = ctx.p.inventory;
  while (buyable < 8 && !ctx.thrifty) {
    const next = payMaterials(inv, BELT_COST);
    if (!next || !MATS.every(m => next[m] >= Math.min(ctx.reserve[m], ctx.p.inventory[m]))) break;
    inv = next;
    buyable++;
  }
  return ctx.p.beltsRemaining + buyable;
}

/** The next belt to lay (or buy) for the bot's supply plan, or for a Belt Weaver chain. */
function layBelts(ctx: Ctx): Action | null {
  const { state, me, style } = ctx;
  const budget = beltBudget(ctx);
  if (budget <= 0) return null;

  // Belt Weaver: a deliberately long chain, when the style wants the bonus and nobody can beat it cheaply.
  if (style.bonusWeight.beltWeaver >= 1 && !ctx.p.bonusTesseracts.beltWeaver) {
    const weave = weaverStep(ctx, budget);
    if (weave) return weave;
  }

  const buildings = myBuildings(state, me)
    .map(b => ({ b, v: valueOf(ctx, state, b, myModules(b, me)) }))
    .sort((x, y) => y.v - x.v);
  for (const { b, v } of buildings) {
    if (v <= 0.05) continue;
    for (const u of unfedInputs(state, b, me)) {
      const route = routeToInput(state, me, b, u.pos, u.wants, Math.min(budget, style.maxRouteBelts));
      if (!route || route.belts.length === 0) continue;
      const next = route.belts[0]!;
      const place: Action = { type: 'PLACE_BELT', pieceId: next.pieceId, fromPoint: next.fromPoint, toPoint: next.toPoint };
      if (ctx.p.beltsRemaining <= 0) return legal(state, { type: 'BUY_BELT' }) ? { type: 'BUY_BELT' } : null;
      if (legal(state, place)) return place;
    }
  }
  return null;
}

function weaverStep(ctx: Ctx, budget: number): Action | null {
  const { state, me } = ctx;
  let best = 0;
  for (const o of state.players) if (o.id !== me) best = Math.max(best, longestBeltChain(state, o.id));
  const target = Math.max(BONUS_THRESHOLDS.beltWeaver, best + 1);
  const mine = longestBeltChain(state, me);
  if (mine >= target) return null;
  // Lay the whole chain in one turn, source end first; each step continues the chain begun
  // this turn (belts placed this turn are its first part).
  const cont = thisTurnChainEnd(state, me);
  const route = longRoute(state, me, target, target + 2, 6000, cont);
  if (!route || route.length === 0) return null;
  if (!cont && route.length > budget) return null;
  if (ctx.p.beltsRemaining <= 0 || (!cont && ctx.p.beltsRemaining < route.length)) {
    return legal(state, { type: 'BUY_BELT' }) ? { type: 'BUY_BELT' } : null;
  }
  const blt = route[0]!;
  const place: Action = { type: 'PLACE_BELT', pieceId: blt.pieceId, fromPoint: blt.fromPoint, toPoint: blt.toPoint };
  return legal(state, place) ? place : null;
}

// ── Leverage cards ────────────────────────────────────────────────────────────

/** A rough worth of each card to this bot right now (for buying; plays are valued exactly). */
function cardWorth(ctx: Ctx, card: CardType): number {
  const { state } = ctx;
  switch (card) {
    case 'embezzlement': return worth(ctx, 'sphere');
    case 'mineInspection': return state.mineCount * worth(ctx, 'plate');
    case 'productionIncrease': return 4;
    case 'shortSale': return 5;
    case 'scoutingDrone': return wantsEnd(ctx) ? 5 : 3.5;
    case 'personalJetPack': return Math.max(1, bufferedValue(state, ctx.me) * 0.8);
    case 'rdTaxWriteOff': return ctx.p.teleportersRemaining > 0 ? 3 + teleporterCost(state.globalTeleporterCount) : 0;
    case 'netSurplusSellOff': return 2.5 * ctx.pv;
    case 'changingPriorities': return 2;
    case 'solarFlare': return 2 * ctx.pv - 1;
    case 'overstockSupplies': return wantsEnd(ctx) ? 5 : 0.5;
    case 'assetForfeiture': return 1.5;
    case 'sinkHole': return 0.5;
  }
}

function buyCard(ctx: Ctx): Action | null {
  const { state, style } = ctx;
  // The deck's order is hidden; what is left in it is known (the discards are face-up). An
  // empty deck is refilled from the discard pile when a card is bought.
  const pool = state.cardDeck.length > 0 ? state.cardDeck : state.cardDiscard;
  if (pool.length === 0 || ctx.thrifty) return null;
  const cost = cardCost(state.mineCount);
  if (!affordable(ctx, cost)) return null;
  let sum = 0;
  for (const c of pool) sum += cardWorth(ctx, c);
  const expected = sum / pool.length;
  if (expected * (0.6 + style.cardAppetite) <= cost) return null;
  return { type: 'BUY_CARD' };
}

function playCard(ctx: Ctx): Action | null {
  const { state, me, style } = ctx;
  if (state.cardsPlayedThisTurn >= 2 || ctx.p.hand.length === 0) return null;
  const acts = legalActions(state, me).filter(a => a.type === 'PLAY_CARD');
  if (acts.length === 0) return null;
  const base = claimSetWorth(ctx, new Map());
  const econBase = econ(ctx, state);
  let unfed: Set<string> | null = null;
  let best: { a: Action; v: number } | null = null;
  for (const a of acts) {
    if (a.type !== 'PLAY_CARD') continue;
    let v: number;
    switch (a.cardType) {
      case 'shortSale':
      case 'changingPriorities':
        v = claimChangeGain(ctx, a, base);
        break;
      case 'productionIncrease':
        v = piWorth(ctx, base);
        break;
      case 'scoutingDrone':
        unfed ??= myUnfedPoints(ctx);
        v = droneWorth(ctx, a, unfed);
        break;
      case 'rdTaxWriteOff': {
        const b = state.board.find(x => x.id === a.pieceId);
        v = b && a.bufferType ? teleporterWorth(ctx, b, a.bufferType, a.inputIndex) + teleporterCost(state.globalTeleporterCount) * 0.5 : -Infinity;
        break;
      }
      case 'sinkHole':
        v = sinkHoleWorth(ctx, a);
        break;
      default: {
        const s = after(state, a);
        v = s ? econ(ctx, s) - econBase : -Infinity;
        if (a.cardType === 'netSurplusSellOff' && s) v += 0.3 * (state.playerCount - 1);
      }
    }
    if (best === null || v > best.v) best = { a, v };
  }
  return best && best.v >= style.cardPlayThreshold ? best.a : null;
}

function piWorth(ctx: Ctx, base: number): number {
  // Four upgrade units this turn: the best single claim or upgrade they buy (a lower bound).
  const { state, me } = ctx;
  const floor = state.mineCount;
  let best = 0;
  for (const b of state.board) {
    if (!isBuilding(b)) continue;
    const mods = myModules(b, me);
    if (!mayAddClaim(b, me)) continue;
    if (mods.length < 3) {
      for (const m of ctx.p.controlModules) {
        if (m < floor || m - floor + 1 > 4) continue;
        best = Math.max(best, claimSetWorth(ctx, new Map([[b.id, [...mods, m]]])) - base);
      }
    }
    mods.forEach((old, i) => {
      for (const m of ctx.p.controlModules) {
        if (m <= old || m - old > 4 || m < floor) continue;
        const next = [...mods]; next[i] = m;
        best = Math.max(best, claimSetWorth(ctx, new Map([[b.id, next]])) - base);
      }
    });
  }
  return best;
}

function droneWorth(ctx: Ctx, a: Action, unfed: Set<string>): number {
  if (a.type !== 'PLAY_CARD' || a.stackIndex === undefined || a.pieceIndex === undefined || !a.coord) return -Infinity;
  // The Scouting Drone lets its player look through the stack, so the kind of piece is known.
  const piece = ctx.state.stacks[a.stackIndex].pieces[a.pieceIndex];
  if (!piece) return -Infinity;
  const want = typeWants(ctx)[piece.type];
  const spot = placementScore(ctx, piece.type, a.coord, a.rotation ?? 0, unfed);
  let v = want * 1.5 + spot;
  if (wantsEnd(ctx)) v += 3 / Math.max(1, ctx.state.stacks[a.stackIndex].pieces.length);
  return v;
}

function sinkHoleWorth(ctx: Ctx, a: Action): number {
  if (a.type !== 'PLAY_CARD' || !a.pieceId) return -Infinity;
  const b = ctx.state.board.find(x => x.id === a.pieceId);
  if (!b || !isBuilding(b)) return -Infinity;
  // The belts lying on the piece go to the bank (RULES_CHANGES.md #56): mine are lost (a belt
  // must be bought again), an opponent's loss is a small gain.
  const beltsHere = ctx.state.belts.filter(x => x.pieceId === b.id);
  const mine = beltsHere.filter(x => x.ownerId === ctx.me).length;
  const beltLoss = mine * BELT_COST - (beltsHere.length - mine) * 0.3 * BELT_COST;
  // Deny an unclaimed Tesseract Factory that sits fed next to an opponent's output.
  if (b.type !== 'tesseractFact') return -beltLoss;
  let s = 0.5 - beltLoss;
  for (const pos of pointsWithRole(b, 'input_buffer')) {
    const f = feedAt(ctx.state, b, pos, ctx.me);
    if (f && f.material !== 'ore') {
      const src = ctx.state.board.find(x => x.id === f.fromPieceId);
      if (src && src.claims.length > 0 && !owns(src, ctx.me)) s += 2;
    }
  }
  return s;
}
