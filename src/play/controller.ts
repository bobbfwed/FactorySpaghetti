// The play controller: turns "what the rules allow right now" (legalActions) into "what the
// player can touch, and what each touch does". Pure logic — no DOM, no Three.js. The table and
// the HTML interface render `view` and forward taps here; every action this sends comes from
// legalActions for the current state (the dice roll excepted, which the host fills in).

import type {
  Action,
  ClaimBuildingAction,
  PlaceMeepleAction,
  PlayCardAction,
  UpgradeBuildingAction,
} from '../engine/actions';
import type { BoardPiece, CardType, GameState, HexCoord, Material, PieceType, Player, PlayerId } from '../engine/state';
import { BELT_COST, CONTROL_MODULE_MAX, INVENTORY_CAP, MAX_CARDS_PLAYED_PER_TURN, MINE_COSTS, POWER_TOKEN_CAP, cardCost, pieceTemplate, teleporterCost } from '../engine/config';
import { applyAction } from '../engine/reducer';
import { cappedAmount, mineSlotReward } from '../engine/rules/mineRewards';
import { piecesExhausted, revealedStack as revealedStackOf } from '../engine/rules/pieces';
import { cardsLeftToDraw } from '../engine/rules/cards';
import { moduleBelowFloor } from '../engine/rules/modules';
import { beltLaidThisTurn } from '../engine/rules/flow';
import { hasTeleporter, teleportersOf } from '../engine/rules/teleporters';
import { lossIfModuleLeaves } from '../engine/rules/ownership';
import type { RoutePoint } from '../engine/routing';
import { refusalText } from '../app/gameText';
import { placement, planningState as planningStateOf, planRoute, reachableEnds, remaining, routeEnds, stillPossible, tiers, type Seg } from './route';
import type { Ghost, Target } from '../table/types';
import type { Item, PlayView, Prompt, Selection, SupplyView, TrayEntry } from './types';
import {
  EXCHANGE_GETS, MATERIALS, actionKey, activeId, canSupply, collectable, exchangeOutcome, factoryRunCost, inputWaitsForFeed, inventoryValue, isBuilding,
  legalFor, neededSets, nextMinePrice, paymentWithChange, pieceById, runBlock, runPreview, teleporterSpotFree,
} from './info';
import {
  CARD_NAME, CARD_TEXT, MATERIAL_NAME, W, amountOf, materialList, pieceName, playerName, selectionLabel, supplyWords,
} from './words';

// ── Modes (what is "picked up") ───────────────────────────────────────────────

type PlaceSrc =
  | { kind: 'stack'; stack: 0 | 1 | 2 }
  | { kind: 'mine' }
  | { kind: 'buyMine' }
  | { kind: 'overstock' }
  | { kind: 'drone'; stack: 0 | 1 | 2; index: number };

type UpSrc = 'pi' | 'endOfRound' | 'mineCredit';
type ClaimSrc = 'pi' | 'free';
type Buf = 'input' | 'output';

type Mode =
  | { k: 'idle' }
  | { k: 'setupClaim'; pieceId: string }
  | { k: 'place'; src: PlaceSrc; coord: HexCoord | null; rotation: number; auto: boolean }
  | { k: 'menu'; pieceId: string }
  | { k: 'opMenu'; pieceId: string }
  | { k: 'claim'; src: ClaimSrc; pieceId: string }
  | { k: 'upgradeOld'; src: UpSrc; pieceId: string }
  | { k: 'upgrade'; src: UpSrc; pieceId: string; old: number }
  | { k: 'belt'; start: RoutePoint | null }
  /** A planned belt route is shown (the plan itself is kept in `plan`). */
  | { k: 'route' }
  /** Remove a belt: my removable belts are lit; one may be selected for removal. */
  | { k: 'removeBelt'; beltId: string | null }
  | { k: 'teleporter'; pick: TpSpot | null; whichOn: string | null }
  | { k: 'exchange' }
  /** One material pressed in my inventory: break it down, awaiting confirmation. */
  | { k: 'exchangeOne'; give: Material }
  | { k: 'card'; card: CardType; a: string | null; b: string | null; module: number | null; spot: TpSpot | null; whichOn: string | null }
  | { k: 'drone' }
  | { k: 'meeple'; pieceId: string; slot: 0 | 1 | null }
  | { k: 'meepleSlot'; pieceId: string }
  | { k: 'pi' };

/** Where a teleporter may go: one input of a building (`input` = its index, #55) or its output (`input` null). */
interface TpSpot { readonly pieceId: string; readonly buffer: Buf; readonly input: number | null }

const IDLE: Mode = { k: 'idle' };

/** Modes of a Leverage card being played or a Production Increase being spent: any step of my own turn. */
function isExtraMode(m: Mode): boolean {
  return m.k === 'card' || m.k === 'drone' || m.k === 'pi' || m.k === 'menu' || m.k === 'claim'
    || m.k === 'upgradeOld' || m.k === 'upgrade' || (m.k === 'place' && m.src.kind === 'drone');
}

/** Actions-step modes in which a tap on the Leverage deck buys a card (nothing waits for a particular pick). */
const DECK_MODES: ReadonlySet<Mode['k']> = new Set<Mode['k']>(['idle', 'menu', 'belt', 'route', 'removeBelt', 'exchange', 'pi']);

/** Rotation order for the rotate button: single tiles turn 0→5; a mine's second hex walks clockwise. */
const TILE_ROT_ORDER = [0, 1, 2, 3, 4, 5] as const;
const MINE_ROT_ORDER = [0, 2, 5, 1, 3, 4] as const;

const NO_TARGET_CARDS: ReadonlySet<CardType> = new Set<CardType>([
  'embezzlement', 'netSurplusSellOff', 'productionIncrease', 'personalJetPack', 'assetForfeiture',
]);

// ── Small helpers ─────────────────────────────────────────────────────────────

type Of<T extends Action['type']> = Extract<Action, { type: T }>;

function ofType<T extends Action['type']>(legal: readonly Action[], t: T): Of<T>[] {
  return legal.filter((a): a is Of<T> => a.type === t);
}

/** The spot a listed teleporter move names: an input (the first when none is named) or the output. */
function tpSpotOf(pieceId: string, buffer: Buf, inputIndex: number | undefined): TpSpot {
  return { pieceId, buffer, input: buffer === 'input' ? inputIndex ?? 0 : null };
}
const sameSpot = (x: TpSpot, y: TpSpot): boolean => x.pieceId === y.pieceId && x.buffer === y.buffer && x.input === y.input;
/** The table target of a spot: that one input (its stub, material and teleporter), or the output. */
function spotTarget(s: TpSpot): Target {
  return s.input === null ? { kind: 'buffer', pieceId: s.pieceId, buffer: s.buffer } : { kind: 'buffer', pieceId: s.pieceId, buffer: s.buffer, slot: s.input };
}
/** "the output", "the input", "input 2". */
function spotWords(piece: BoardPiece, s: TpSpot): string {
  return W.spotName(s.buffer, s.input, piece.input?.slots.length ?? 0);
}
/** The spot is one of several inputs: say what a teleporter there does to the others. */
const severalInputs = (piece: BoardPiece, s: TpSpot): boolean => s.buffer === 'input' && (piece.input?.slots.length ?? 0) > 1;
/** What lies in input `i` of the building, in rulebook words, or null when it is empty. */
function holds(piece: BoardPiece, i: number): string | null {
  const m = piece.input?.slots[i] ?? null;
  return m ? MATERIAL_NAME[m] : null;
}

export function targetKey(t: Target): string {
  switch (t.kind) {
    case 'cell': return `cell:${t.q},${t.r}`;
    case 'piece': return `piece:${t.pieceId}`;
    case 'point': return `point:${t.pieceId}:${t.point}`;
    case 'buffer': return `buffer:${t.pieceId}:${t.buffer}${t.slot === undefined ? '' : `:${t.slot}`}`;
    case 'mineSlot': return `mineSlot:${t.pieceId}:${t.slot}`;
    case 'belt': return `belt:${t.beltId}`;
    case 'stack': return `stack:${t.index}`;
    case 'deck': return 'deck';
  }
}

const sameCoord = (a: HexCoord, b: HexCoord): boolean => a.q === b.q && a.r === b.r;

function claimSrc(a: ClaimBuildingAction): ClaimSrc | null {
  if (a.fromProductionIncrease) return 'pi';
  if (a.fromFreeClaim) return 'free';
  return null;
}

function upSrc(a: UpgradeBuildingAction): UpSrc | null {
  if (a.fromProductionIncrease) return 'pi';
  if (a.fromMineCredit) return 'mineCredit';
  if (a.freeCredits !== undefined) return 'endOfRound';
  return null;
}

type PlaceLike = Of<'PLACE_PIECE'> | Of<'PLACE_MINE'> | Of<'BUY_MINE'> | Of<'PLACE_OVERSTOCK_PIECE'> | PlayCardAction;

function coordOf(a: PlaceLike): HexCoord | null {
  return a.coord ?? null;
}

// ── View builder ──────────────────────────────────────────────────────────────

class Builder {
  readonly view: PlayView;
  readonly taps = new Map<string, () => void>();
  readonly fns = new Map<string, () => void>();
  readonly reasons = new Map<string, string>();
  onPrimary: (() => void) | null = null;
  onConfirm: (() => void) | null = null;
  onRotate: ((steps: number) => void) | null = null;

  constructor(view: PlayView) { this.view = view; }

  lit(t: Target, fn: () => void): void {
    const k = targetKey(t);
    if (!this.taps.has(k)) this.view.targets.push(t);
    this.taps.set(k, fn);
  }

  /** A tap that does something without the target glowing (another choice beside the selected one). */
  quiet(t: Target, fn: () => void): void {
    const k = targetKey(t);
    if (!this.taps.has(k)) (this.view.quietTargets ??= []).push(t);
    this.taps.set(k, fn);
  }

  clearTargets(): void {
    this.view.targets = [];
    delete this.view.quietTargets;
    this.taps.clear();
  }

  item(it: Item, fn?: () => void): Item {
    if (it.enabled && fn) this.fns.set(it.id, fn);
    else if (it.reason) this.reasons.set(it.id, it.reason);
    return it;
  }
}

function emptyView(): PlayView {
  return {
    step: 'waiting', stepIndex: null, myTurn: false, activePlayer: null, instruction: '',
    primary: null, targets: [], ghost: null, confirmBar: null, selection: null, menu: null,
    tray: [], bank: [], inventory: [], totalValue: null, hand: [], prompts: [], choices: null, route: null, meeplePick: null, hint: null,
  };
}

// ── Controller ────────────────────────────────────────────────────────────────

export interface PlayControllerOptions {
  /** Hands an action to the session layer (which sends it to the host). */
  send: (action: Action) => void;
  /** Display name of a seat, for "Red is placing a piece". Default "Player N". */
  names?: (id: PlayerId) => string;
}

export class PlayController {
  private game: GameState | null = null;
  private me: PlayerId | null = null;
  private mode: Mode = IDLE;
  private piActive = false;
  private queue: Action[] = [];
  private queueSent: Action | null = null;
  private hintText: string | null = null;
  private readonly listeners = new Set<() => void>();
  private readonly sendFn: (action: Action) => void;
  private readonly nameOf: (id: PlayerId) => string;
  private current: Builder = new Builder(emptyView());
  /**
   * The belt route planned last, kept on this device for the rest of the page's life (not saved,
   * not sent): its unlaid part is offered again when "Lay a belt" is opened on a later turn.
   */
  private plan: Seg[] | null = null;
  /**
   * The ids of the belts on the board when `plan` was made. A belt of the plan is "this route's"
   * only if it was not already there, so taking back a route never picks up an earlier route.
   */
  private planBase: ReadonlySet<string> = new Set();

  constructor(opts: PlayControllerOptions) {
    this.sendFn = opts.send;
    this.nameOf = opts.names ?? ((id: PlayerId): string => playerName(id));
    this.render(false);
  }

  get view(): PlayView { return this.current.view; }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }

  /** A new state arrived (or my seat changed). Recompute; keep the selection only if it is still possible. */
  update(game: GameState | null, me: PlayerId | null): void {
    const prev = this.game;
    const seatChanged = me !== this.me;
    this.game = game;
    this.me = me;
    this.hintText = null;
    if (seatChanged || !game || me === null || game.gameOver) {
      this.mode = IDLE; this.queue = []; this.queueSent = null; this.piActive = false;
      // A planned route belongs to the seat (and game) that planned it: never offered to another.
      this.dropPlan();
    } else {
      if (this.piActive && (game.productionIncreaseBudget <= 0 || !this.piActions(game, me).length)) {
        this.piActive = false;
        if (this.mode.k === 'pi') this.mode = IDLE;
      }
      if (prev !== game) this.pumpQueue(prev);
    }
    this.render(true);
  }

  /** The host refused the last move: drop any selection and route in progress, and say why. */
  refused(message: string): void {
    this.queue = []; this.queueSent = null;
    this.mode = IDLE;
    this.render(false);
    this.hintText = message;
    this.current.view.hint = message;
    this.notify();
  }

  tap(target: Target): void {
    const fn = this.current.taps.get(targetKey(target))
      // One input of a buffer (#55) stands for its whole buffer where only the buffer is lit.
      ?? (target.kind === 'buffer' && target.slot !== undefined
        ? this.current.taps.get(targetKey({ kind: 'buffer', pieceId: target.pieceId, buffer: target.buffer }))
        : undefined)
      ?? (target.kind === 'buffer' || target.kind === 'point' || target.kind === 'mineSlot'
        ? this.current.taps.get(targetKey({ kind: 'piece', pieceId: target.pieceId }))
        : undefined);
    if (fn) { this.hintText = null; fn(); this.render(false); return; }
    // Step 4: a tap anywhere but a glowing spot puts back the spot chosen so far, so Confirm is
    // only ever offered for the spot the player pressed last.
    if (this.mode.k === 'meeple' || this.mode.k === 'meepleSlot') {
      this.mode = IDLE;
      this.hintText = W.meepleOffTarget;
      this.render(false);
      return;
    }
    this.hintText = this.whyNot(target);
    this.render(false);
  }

  /**
   * A tap that hit nothing on the table (past the table's edge): closes a building menu and puts
   * back a meeple spot awaiting confirmation; anything else stays as it is.
   */
  tapNothing(): void {
    if (this.current.view.menu || this.mode.k === 'meeple' || this.mode.k === 'meepleSlot') this.cancel();
  }

  choose(id: string): void {
    const fn = this.current.fns.get(id);
    if (fn) { this.hintText = null; fn(); this.render(false); return; }
    this.hintText = this.current.reasons.get(id) ?? W.notLit;
    this.render(false);
  }

  primary(): void {
    const fn = this.current.onPrimary;
    const p = this.current.view.primary;
    if (fn && p?.enabled) { this.hintText = null; fn(); this.render(false); return; }
    if (p && !p.enabled) { this.hintText = p.hint ?? null; this.render(false); }
  }

  confirm(): void {
    const fn = this.current.onConfirm;
    if (!fn) return;
    this.hintText = null;
    fn();
    this.render(false);
  }

  cancel(): void {
    // While queued steps (a route being laid, a route being taken back) are being sent one by one,
    // Escape and the ✕ close panels only: stopping half-way would leave belts half laid or half
    // taken back with the plan already gone. The steps finish, or stop for their own reasons as
    // before (a refused move, a step no longer legal, a seat change).
    if (this.queue.length > 0 || this.queueSent !== null) {
      if (this.mode.k !== 'route' && this.mode.k !== 'pi') this.mode = IDLE;
      this.hintText = null;
      this.render(false);
      return;
    }
    if (this.mode.k === 'pi') this.piActive = false;
    // The ✕ of a planned route (and Escape) drops its unlaid part, like its "Cancel" button; belts
    // already laid stay. "Keep the plan for a later turn" is the way to put a plan aside.
    if (this.mode.k === 'route') this.dropPlan();
    this.mode = IDLE;
    this.queue = []; this.queueSent = null;
    this.hintText = null;
    this.render(false);
  }

  rotate(steps = 1): void {
    const fn = this.current.onRotate;
    if (!fn) return;
    fn(steps);
    this.render(false);
  }

  // ── Plumbing ────────────────────────────────────────────────────────────────

  private notify(): void {
    for (const fn of [...this.listeners]) fn();
  }

  private send(action: Action, next: Mode = IDLE): void {
    this.mode = next;
    // A purchase paid with change: say what it leaves, right away (not only in a tooltip).
    const paid = this.purchaseHint(action);
    if (paid) this.hintText = paid;
    this.sendFn(action);
  }

  /** "Paid 3. You keep 1 Plate and 2 Ore." for a purchase that gives change; null otherwise. */
  private purchaseHint(a: Action): string | null {
    const g = this.game, me = this.me;
    const player = g && me !== null ? g.players[me] : undefined;
    if (!g || !player) return null;
    const price = a.type === 'BUY_CARD' ? cardCost(g.mineCount)
      : a.type === 'BUY_BELT' ? BELT_COST
        : a.type === 'BUY_MINE' ? nextMinePrice(g, MINE_COSTS)
          : a.type === 'PLACE_TELEPORTER' ? teleporterCost(g.globalTeleporterCount) : null;
    if (price === null) return null;
    const k = keptAfter(player, [price]);
    return k ? W.paidKeep(price, k.kept, k.lost) : null;
  }

  private setMode(m: Mode): void { this.mode = m; }

  private render(fromUpdate: boolean): void {
    let b = this.newBuilder();
    if (!this.build(b)) {
      if (fromUpdate && !this.isSoft(this.mode)) this.hintText = W.selectionGone;
      this.mode = IDLE;
      b = this.newBuilder();
      this.build(b);
    }
    b.view.hint = this.hintText;
    this.current = b;
    this.notify();
  }

  private newBuilder(): Builder {
    return new Builder(emptyView());
  }

  /** Selections that disappear quietly when the state moves on (nothing the player chose is lost). */
  private isSoft(m: Mode): boolean {
    return (m.k === 'place' && m.auto) || (m.k === 'belt' && m.start === null) || m.k === 'pi' || m.k === 'idle'
      || m.k === 'route' || (m.k === 'removeBelt' && m.beltId === null);
  }

  // ── Route queue (multi-belt route helper) ───────────────────────────────────

  private startQueue(actions: Action[]): void {
    this.queue = [...actions];
    this.queueSent = null;
    this.pumpQueue(null);
  }

  /** Send the next queued route step once the previous one has shown up in the state. */
  private pumpQueue(prev: GameState | null): void {
    const g = this.game, me = this.me;
    if (!g || me === null) return;
    if (this.queueSent && prev && !this.progressed(prev, g, this.queueSent)) return;
    this.queueSent = null;
    if (this.queue.length === 0) return;
    const next = this.queue[0]!;
    const legal = legalFor(g, me);
    if (next.type === 'END_TURN') {
      // The turn ends by itself once the meeple is down, when ending it is the only move left.
      this.queue = [];
      const only = legal.length === 1 && legal[0]!.type === 'END_TURN' ? legal[0]! : null;
      if (only) { this.queueSent = only; this.sendFn(only); }
      return;
    }
    const match = next.type === 'PLACE_BELT'
      ? ofType(legal, 'PLACE_BELT').find(a => a.pieceId === next.pieceId
        && ((a.fromPoint === next.fromPoint && a.toPoint === next.toPoint)
          || (a.fromPoint === next.toPoint && a.toPoint === next.fromPoint)))
      : legal.find(a => actionKey(a) === actionKey(next));
    if (!match) {
      this.queue = [];
      this.hintText = W.routeStopped;
      return;
    }
    this.queue.shift();
    this.queueSent = match;
    this.sendFn(match);
  }

  private progressed(prev: GameState, next: GameState, a: Action): boolean {
    const me = this.me;
    if (me === null) return true;
    if (a.type === 'BUY_BELT') {
      return (next.players[me]?.beltsRemaining ?? 0) > (prev.players[me]?.beltsRemaining ?? 0);
    }
    if (a.type === 'PLACE_MEEPLE') return next.players[me]?.meepleOnPieceId != null;
    if (a.type === 'PLACE_BELT') {
      return next.belts.some(b => b.pieceId === a.pieceId && b.ownerId === me
        && ((b.fromPoint === a.fromPoint && b.toPoint === a.toPoint) || (b.fromPoint === a.toPoint && b.toPoint === a.fromPoint)));
    }
    if (a.type === 'REMOVE_BELT') return !next.belts.some(b => b.id === a.beltId);
    return true;
  }

  // ── The view ────────────────────────────────────────────────────────────────

  /** Builds the view for the current mode; false if the mode is no longer possible. */
  private build(b: Builder): boolean {
    const g = this.game, me = this.me;
    const v = b.view;
    if (!g || me === null) {
      v.instruction = g ? W.spectating : W.noGame;
      return true;
    }
    const player = g.players[me];
    if (!player) { v.instruction = W.spectating; return true; }
    const active = activeId(g);
    v.activePlayer = active;
    v.stepIndex = stepIndexOf(g);
    if (g.gameOver) {
      v.step = 'over';
      v.stepIndex = null;
      v.tray = baseTray(b, player, g.mineCount);
      v.totalValue = inventoryValue(player);
      const how = W.gameOverHow(g.gameOverReason);
      v.instruction = g.winner !== null ? W.gameOverWinner(this.nameOf(g.winner), how)
        : g.tiedWinners.length ? W.gameOverTie(g.tiedWinners.map(id => this.nameOf(id)).join(', '), how)
          : W.gameOverNone;
      return true;
    }

    const legal = legalFor(g, me);
    const myTurn = active === me;
    v.myTurn = myTurn;
    v.tray = baseTray(b, player, g.mineCount);
    v.totalValue = inventoryValue(player);
    const myPending = g.pendingFactoryOps.filter(e => e.ownerId === me);
    v.bank = this.bankItems(b, g, player, legal, myTurn, myPending.length > 0);
    v.inventory = this.inventoryItems(b, g, player, legal, myTurn, myPending.length > 0);
    v.hand = this.handItems(b, g, player, legal, myTurn, myPending.length > 0);
    v.prompts = this.promptsFor(b, g, me, player, legal);

    if (myPending.length > 0) return this.buildPending(b, g, myTurn, myPending.length);
    if (!myTurn) return this.buildWaiting(b, g, active);

    if (this.mode.k === 'idle') this.mode = this.defaultMode(g, me, legal);

    switch (g.phase) {
      case 'setupClaimPF':
      case 'setupClaimPP': return this.buildSetup(b, g, legal);
      case 'placePiece': return this.buildPlace(b, g, me, player, legal);
      case 'roll': return this.buildRoll(b, g, me, player, legal);
      case 'actions': return this.buildActions(b, g, me, player, legal);
      case 'placeMeeple': return this.buildMeeple(b, g, me, player, legal);
      case 'roundEnd': return this.buildRoundEnd(b, g, me, player, legal);
    }
  }

  /** The idle state of the current step: a forced placement takes over when one is owed. */
  private defaultMode(g: GameState, me: PlayerId, legal: readonly Action[]): Mode {
    if (g.turnOrder[g.activePlayerIndex] !== me) return IDLE;
    // A Production Increase played this turn, outside the actions step: spend it first (Done returns to the step).
    if ((g.phase === 'placePiece' || g.phase === 'roll' || g.phase === 'placeMeeple')
      && this.piActive && g.productionIncreaseBudget > 0 && this.piActions(g, me).length > 0) return { k: 'pi' };
    if (g.phase === 'placePiece') {
      if (ofType(legal, 'PLACE_MINE').length > 0) return { k: 'place', src: { kind: 'mine' }, coord: null, rotation: 0, auto: true };
      const stacks = [...new Set(ofType(legal, 'PLACE_PIECE').map(a => a.stackIndex))];
      if (stacks.length === 1) return { k: 'place', src: { kind: 'stack', stack: stacks[0]! }, coord: null, rotation: 0, auto: true };
    }
    if (g.phase === 'actions') {
      if (ofType(legal, 'PLACE_OVERSTOCK_PIECE').length > 0) {
        return { k: 'place', src: { kind: 'overstock' }, coord: null, rotation: 0, auto: true };
      }
      if (this.piActive && g.productionIncreaseBudget > 0 && this.piActions(g, me).length > 0) return { k: 'pi' };
    }
    return IDLE;
  }

  // ── Pending factory activations (any turn) ──────────────────────────────────

  private promptsFor(b: Builder, g: GameState, me: PlayerId, player: Player, legal: readonly Action[]): Prompt[] {
    const total = g.lastRoll ? g.lastRoll.reduce((x, y) => x + y, 0) : 0;
    const myTurn = activeId(g) === me;
    const out: Prompt[] = [];
    for (const e of g.pendingFactoryOps) {
      if (e.ownerId !== me) continue;
      const piece = pieceById(g, e.pieceId);
      if (!piece) continue;
      // Every listed way to run it: from its input, and with each supply through my input teleporter.
      const runs = ofType(legal, 'OPERATE_BUILDING').filter(a => a.pieceId === e.pieceId && a.ownerId === me);
      const skip = ofType(legal, 'SKIP_FACTORY_ROLL').find(a => a.pieceId === e.pieceId && a.ownerId === me);
      const mine = piece.claims.filter(c => c.ownerId === me).map(c => c.controlModule);
      const module = mine.find(m => m === total) ?? mine[0] ?? 0;
      const anchor: Target = { kind: 'piece', pieceId: piece.id };
      const title = W.promptTitle(pieceName(piece.type), module, total);
      const timeout = myTurn ? null : W.promptTimeout;
      if (canSupply(piece, me)) {
        // My teleporter is on its input and a slot is empty: the supply chooser.
        const supply = this.supplyView(piece, player, runs, false);
        out.push({
          id: `op:${piece.id}`, anchor, title, detail: supply.missing ? `${supply.heading} ${supply.missing}` : supply.heading,
          options: this.supplyOptions(b, `op:${piece.id}`, piece, player, runs, skip), supply, timeout,
        });
        continue;
      }
      const run = runs[0];
      const pv = runPreview(piece, player);
      // Should "run" be offered while the output is full (the building cannot run), the engine
      // refuses it. Say so.
      const outFull = (piece.output?.slots ?? []).some(x => x !== null);
      const detail = outFull ? W.promptCannotRun
        : pv && pv.product ? W.runDetail(pv.power, materialList(pv.consumed), pv.product)
          : W.promptRunUnknown;
      out.push({ id: `op:${piece.id}`, anchor, title, detail, options: this.opOptions(b, piece.id, run, skip, detail), supply: null, timeout });
    }
    return out;
  }

  /** The supply chooser's picture: what the building holds and needs, my materials, and why nothing can be supplied. */
  private supplyView(piece: BoardPiece, player: Player, runs: readonly Of<'OPERATE_BUILDING'>[], roundEnd: boolean): SupplyView {
    const name = pieceName(piece.type);
    const sets = neededSets(piece);
    const heading = piece.type === 'powerPlant' ? W.supplyPlantAsk
      : sets.length === 0 ? W.badRecipe
        : sets.length === 1 ? W.supplyNeeds(name, supplyWords(sets[0]!))
          : W.supplyNeedsOneOf(name, sets.map(s => supplyWords(s)));
    let missing: string | null = null;
    if (!runs.some(a => (a.supply?.length ?? 0) > 0)) {
      if (roundEnd && player.meepleOperatedThisRound) missing = W.alreadyRan;
      else if (piece.type === 'powerPlant') missing = player.powerTokens >= POWER_TOKEN_CAP ? W.supplyPlantFull : W.supplyPlantNothing;
      else if ((piece.output?.slots ?? []).some(x => x !== null)) missing = W.promptCannotRun;
      else if (inputWaitsForFeed(piece, player.id)) missing = W.supplyWaitsForFeed;
      else if (player.powerTokens < factoryRunCost(piece)) missing = W.supplyNoPower(factoryRunCost(piece), player.powerTokens);
      else missing = W.supplyLacking;
    }
    return { heading, slots: [...(piece.input?.slots ?? [])], have: { ...player.inventory }, missing };
  }

  /**
   * One item per listed way to run the building (ids `<prefix>:run` for the plain run and
   * `<prefix>:run:<materials>` for a supplied one), then the skip when it is listed. Each item
   * sends exactly its own listed move.
   */
  private supplyOptions(b: Builder, prefix: string, piece: BoardPiece, player: Player,
    runs: readonly Of<'OPERATE_BUILDING'>[], skip: Action | undefined): Item[] {
    const plant = piece.type === 'powerPlant';
    const items: Item[] = [];
    const plain = runs.find(a => (a.supply?.length ?? 0) === 0);
    if (plain) {
      const pv = runPreview(piece, player);
      const detail = !pv ? undefined : plant ? W.runPowerPlant(pv.gain, materialList(pv.consumed))
        : pv.product ? W.runDetail(pv.power, materialList(pv.consumed), pv.product) : undefined;
      items.push(b.item({
        id: `${prefix}:run`, label: plant ? W.runPlantAsIs(pv?.gain ?? 0) : W.runAsIs, ...(detail ? { detail } : {}), enabled: true, materials: [],
      }, () => this.send(plain)));
    }
    for (const a of runs) {
      const sup = a.supply ?? [];
      if (sup.length === 0) continue;
      const pv = runPreview(piece, player, sup);
      const detail = !pv ? undefined : plant ? W.plantGain(pv.gain, pv.nominal)
        : pv.product ? W.runDetail(pv.power, materialList(pv.consumed), pv.product) : undefined;
      items.push(b.item({
        id: `${prefix}:run:${sup.join(',')}`, label: W.provide(supplyWords(sup)), ...(detail ? { detail } : {}), enabled: true, materials: [...sup],
      }, () => this.send(a)));
    }
    if (skip) items.push(b.item({ id: `${prefix}:skip`, label: W.promptSkip, detail: W.promptSkipDetail, enabled: true }, () => this.send(skip)));
    return items;
  }

  private opOptions(b: Builder, pieceId: string, run: Action | undefined, skip: Action | undefined, detail: string): Item[] {
    return [
      b.item({ id: `op:${pieceId}:run`, label: W.promptRun, detail, enabled: !!run }, run ? (): void => this.send(run) : undefined),
      b.item({ id: `op:${pieceId}:skip`, label: W.promptSkip, detail: W.promptSkipDetail, enabled: !!skip }, skip ? (): void => this.send(skip) : undefined),
    ];
  }

  private buildPending(b: Builder, g: GameState, myTurn: boolean, n: number): boolean {
    const v = b.view;
    v.step = myTurn ? 'actions' : 'waiting';
    v.instruction = n > 1 ? W.pendingMineMany(n) : W.pendingMine;
    if (myTurn) v.primary = { label: W.actionsDone, enabled: false, hint: W.decideFirst };
    for (const p of v.prompts) {
      if (!p.options.some(o => o.enabled)) continue;
      const pieceId = (p.anchor as { pieceId: string }).pieceId;
      b.lit(p.anchor, () => this.setMode({ k: 'opMenu', pieceId }));
    }
    if (this.mode.k === 'opMenu') {
      const pieceId = this.mode.pieceId;
      const p = v.prompts.find(x => x.id === `op:${pieceId}`);
      if (!p) return false;
      const piece = pieceById(g, pieceId)!;
      v.menu = { anchor: p.anchor, title: pieceName(piece.type), subtitle: p.title, items: p.options, supply: p.supply };
      v.selection = { kind: 'building', label: selectionLabel.building(pieceName(piece.type)) };
      v.confirmBar = { confirm: false, rotate: false, cancel: true };
      return true;
    }
    return this.mode.k === 'idle';
  }

  // ── Not my turn ─────────────────────────────────────────────────────────────

  private buildWaiting(b: Builder, g: GameState, active: PlayerId | null): boolean {
    const v = b.view;
    v.step = 'waiting';
    const name = active === null ? '' : this.nameOf(active);
    switch (g.phase) {
      case 'setupClaimPF': case 'setupClaimPP': v.instruction = W.waitingSetup(name); break;
      case 'placePiece': {
        // Choosing a pile, or the drawn piece (face-up for everyone) waiting to be placed.
        const drawn = g.drawnStackIndex ?? null;
        const top = drawn !== null ? g.stacks[drawn].pieces[0] : undefined;
        if (top) v.instruction = W.waitingDrew(name, pieceName(top.type));
        else if (active !== null && legalFor(g, active).some(a => a.type === 'DRAW_PIECE')) v.instruction = W.waitingDraw(name);
        else v.instruction = W.waitingPlace(name);
        break;
      }
      case 'roll': v.instruction = W.waitingRoll(name); break;
      case 'actions': v.instruction = W.waitingActions(name); break;
      case 'placeMeeple': v.instruction = W.waitingMeeple(name); break;
      case 'roundEnd': v.instruction = W.waitingRoundEnd(name); break;
    }
    return this.mode.k === 'idle';
  }

  // ── Setup claims ────────────────────────────────────────────────────────────

  private buildSetup(b: Builder, g: GameState, legal: readonly Action[]): boolean {
    const v = b.view;
    v.step = 'setup';
    const pf = g.phase === 'setupClaimPF';
    v.instruction = pf ? W.setupPF : W.setupPP;
    const claims = ofType(legal, 'SETUP_CLAIM');
    for (const c of claims) {
      b.lit({ kind: 'piece', pieceId: c.pieceId }, () => this.setMode({ k: 'setupClaim', pieceId: c.pieceId }));
    }
    const m = this.mode;
    if (m.k === 'idle') return true;
    if (m.k !== 'setupClaim') return false;
    const c = claims.find(x => x.pieceId === m.pieceId);
    const piece = pieceById(g, m.pieceId);
    if (!c || !piece) return false;
    const module = pf ? 3 : 2;
    v.instruction = W.setupConfirm(pieceName(piece.type), module);
    v.selection = { kind: 'building', label: selectionLabel.building(pieceName(piece.type)) };
    v.confirmBar = { confirm: true, rotate: false, cancel: true };
    v.tray = v.tray.map(t => (t.module === module ? { module, state: 'lit', cost: W.free, upgradeCost: 0 } : t));
    b.onConfirm = (): void => this.send(c);
    return true;
  }

  // ── Step 1: place a piece (or a dropped mine) ───────────────────────────────

  private buildPlace(b: Builder, g: GameState, me: PlayerId, player: Player, legal: readonly Action[]): boolean {
    const v = b.view;
    v.step = 'place';
    const mines = ofType(legal, 'PLACE_MINE');
    const m = this.mode;
    // A Leverage card (or a Production Increase being spent) before the piece: the card's flow.
    if (isExtraMode(m)) {
      v.instruction = mines.length > 0 ? W.mineDropped : W.placePickStack;
      return this.buildExtra(b, g, me, player, legal);
    }
    if (mines.length > 0) {
      v.instruction = W.mineDropped;
      if (m.k !== 'place' || m.src.kind !== 'mine') return false;
      return this.placement(b, m, mines, 'mine', selectionLabel.mine, 'mine', W.minePlaceConfirm);
    }
    // Several piles open: first choose one to draw from (the drawn piece must then be placed).
    const draws = ofType(legal, 'DRAW_PIECE');
    if (draws.length > 0) {
      v.instruction = W.drawPick;
      for (const a of draws) b.lit({ kind: 'stack', index: a.stackIndex }, () => this.send(a));
      return m.k === 'idle';
    }
    const pieces = ofType(legal, 'PLACE_PIECE');
    const stacks = [...new Set(pieces.map(a => a.stackIndex))].sort();
    v.instruction = W.placePickStack;
    // One pile: its top piece is already face-up and the spaces are lit at once (default mode), so
    // the pile is not a step of its own and does not glow.
    for (const s of stacks.length > 1 ? stacks : []) {
      b.lit({ kind: 'stack', index: s }, () => this.setMode({
        k: 'place', src: { kind: 'stack', stack: s }, coord: null,
        rotation: this.mode.k === 'place' ? this.mode.rotation : 0, auto: false,
      }));
    }
    if (m.k === 'idle') return true;
    if (m.k !== 'place' || m.src.kind !== 'stack') return false;
    const si = m.src.stack;
    const top = g.stacks[si].pieces[0];
    if (!top) return false;
    const what = pieceName(top.type);
    v.instruction = W.placePickCell(what);
    return this.placement(b, m, pieces.filter(a => a.stackIndex === si), top.type,
      selectionLabel.tile(what, si), 'tile', W.placeTurnConfirm(what));
  }

  /**
   * Generic "put a tile down" flow: lit cells → ghost on a cell with only the rotations that
   * are legal there → confirm sends the matching legal action.
   */
  private placement(
    b: Builder,
    m: Extract<Mode, { k: 'place' }>,
    cands: readonly PlaceLike[],
    pieceType: PieceType,
    label: string,
    kind: Selection['kind'],
    confirmText: string,
  ): boolean {
    if (cands.length === 0) return false;
    const v = b.view;
    const seen = new Set<string>();
    for (const a of cands) {
      const c = coordOf(a);
      if (!c) continue;
      const k = `${c.q},${c.r}`;
      if (seen.has(k)) continue;
      seen.add(k);
      b.lit({ kind: 'cell', q: c.q, r: c.r }, () => this.pickCell(m, c, cands, pieceType));
    }
    v.selection = { kind, label };
    if (!m.coord) {
      v.confirmBar = m.auto ? null : { confirm: false, rotate: false, cancel: true };
      return true;
    }
    const at = m.coord;
    const order = pieceType === 'mine' ? MINE_ROT_ORDER : TILE_ROT_ORDER;
    const here = cands.filter(a => { const c = coordOf(a); return c !== null && sameCoord(c, at); });
    const rots: number[] = order.filter(r => here.some(a => (a.rotation ?? 0) === r));
    if (rots.length === 0) return false;
    const rotation = rots.includes(m.rotation) ? m.rotation : rots[0]!;
    const chosen = here.find(a => (a.rotation ?? 0) === rotation)!;
    const ghost: Ghost = { pieceType, q: at.q, r: at.r, rotation, valid: true };
    v.ghost = ghost;
    v.instruction = confirmText;
    v.confirmBar = { confirm: true, rotate: rots.length > 1, cancel: true };
    b.onConfirm = (): void => this.send(chosen);
    b.onRotate = (steps: number): void => {
      const i = rots.indexOf(rotation);
      const n = rots.length;
      const j = (((i + Math.trunc(steps)) % n) + n) % n;
      this.mode = { ...m, rotation: rots[j]! };
    };
    return true;
  }

  private pickCell(m: Extract<Mode, { k: 'place' }>, c: HexCoord, cands: readonly PlaceLike[], pieceType: PieceType): void {
    const order = pieceType === 'mine' ? MINE_ROT_ORDER : TILE_ROT_ORDER;
    const rots: number[] = order.filter(r => cands.some(a => { const ac = coordOf(a); return ac !== null && sameCoord(ac, c) && (a.rotation ?? 0) === r; }));
    const rotation = rots.includes(m.rotation) ? m.rotation : (rots[0] ?? 0);
    this.mode = { ...m, coord: { q: c.q, r: c.r }, rotation, auto: false };
  }

  // ── Step 2: roll ────────────────────────────────────────────────────────────

  private buildRoll(b: Builder, g: GameState, me: PlayerId, player: Player, legal: readonly Action[]): boolean {
    const v = b.view;
    v.step = 'roll';
    // With the pieces gone the turn starts here (there is nothing to place).
    v.instruction = piecesExhausted(g) ? W.rollNoPieces : W.rollNow;
    v.primary = { label: W.rollLabel(g.mineCount), enabled: true };
    b.onPrimary = (): void => this.send({ type: 'ROLL_DICE', rolls: [] });
    if (isExtraMode(this.mode)) return this.buildExtra(b, g, me, player, legal);
    return this.mode.k === 'idle';
  }

  // ── Step 3: actions ─────────────────────────────────────────────────────────

  private buildActions(b: Builder, g: GameState, me: PlayerId, player: Player, legal: readonly Action[]): boolean {
    const v = b.view;
    v.step = 'actions';
    v.instruction = W.actionsIdle;
    const end = legal.find(a => a.type === 'END_ACTIONS');
    let hint: string | undefined;
    if (!end) {
      if (g.overstockPieces.length > 0) hint = W.overstockFirst;
      else if (g.pendingFactoryOps.length > 0) {
        const names = [...new Set(g.pendingFactoryOps.map(e => e.ownerId))].map(id => this.nameOf(id)).join(', ');
        hint = W.othersDeciding(names);
      }
    } else if (g.productionIncreaseBudget > 0) {
      hint = W.unspentPI(g.productionIncreaseBudget);
    }
    v.primary = { label: W.actionsDone, enabled: !!end, ...(hint ? { hint } : {}) };
    if (end) b.onPrimary = (): void => this.send(end);

    this.actionsIdleTargets(b, g, player, legal);
    if (!this.buildActionsMode(b, g, me, player, legal)) return false;
    // The Leverage deck answers a tap while nothing waits for a particular pick: idle, and while a
    // tool is in use (laying or removing belts, a planned route, Production Increase, a menu).
    const buy = legal.find(a => a.type === 'BUY_CARD');
    if (buy && DECK_MODES.has(this.mode.k)) b.lit({ kind: 'deck' }, () => this.send(buy, this.modeAfterBuy()));
    return true;
  }

  /** Buying a card keeps a tool the player is using (Lay a belt, Remove a belt, a planned route). */
  private modeAfterBuy(): Mode {
    const m = this.mode;
    return m.k === 'belt' || m.k === 'route' || m.k === 'removeBelt' || m.k === 'pi' ? m : IDLE;
  }

  /** The current mode's part of the Actions step; false if the mode is no longer possible. */
  private buildActionsMode(b: Builder, g: GameState, me: PlayerId, player: Player, legal: readonly Action[]): boolean {
    const v = b.view;
    const m = this.mode;
    switch (m.k) {
      case 'idle': return true;
      case 'place': {
        if (m.src.kind === 'overstock') {
          const cands = ofType(legal, 'PLACE_OVERSTOCK_PIECE');
          const next = g.overstockPieces[0];
          if (!next) return false;
          const what = pieceName(next.type);
          const total = g.overstockPieces.length;
          v.instruction = W.overstockPlace(1, total, what);
          return this.placement(b, m, cands, next.type, selectionLabel.overstock(what), 'overstock', W.placeTurnConfirm(what));
        }
        b.clearTargets();
        if (m.src.kind === 'buyMine') {
          v.instruction = W.minePick;
          return this.placement(b, m, ofType(legal, 'BUY_MINE'), 'mine', selectionLabel.mine, 'mine', W.minePlaceConfirm);
        }
        if (m.src.kind === 'drone') return this.buildExtra(b, g, me, player, legal);
        return false;
      }
      case 'menu': case 'claim': case 'upgradeOld': case 'upgrade': case 'card': case 'drone': case 'pi':
        return this.buildExtra(b, g, me, player, legal);
      case 'belt': return this.buildBelt(b, g, me, legal, m);
      case 'route': return this.buildRoute(b, g, me, legal);
      case 'removeBelt': return this.buildRemove(b, legal, m);
      case 'teleporter': return this.buildTeleporter(b, g, legal, m);
      case 'exchange': {
        const items = this.exchangeItems(b, player, legal);
        if (!items.some(i => i.enabled)) return false;
        v.choices = { title: W.exchangeTitle, items };
        v.confirmBar = { confirm: false, rotate: false, cancel: true };
        return true;
      }
      case 'exchangeOne': return this.buildExchangeOne(b, g, me, legal, m);
      default: return false;
    }
  }

  /**
   * A Leverage card being played, or a Production Increase being spent: the same flows in every
   * step of my own turn (RULES_CHANGES.md #50). Outside the actions step the step's own targets
   * are put away while the card waits for its choices; it comes back once the card is played or
   * cancelled. False if the mode is no longer possible.
   */
  private buildExtra(b: Builder, g: GameState, me: PlayerId, player: Player, legal: readonly Action[]): boolean {
    const v = b.view;
    const m = this.mode;
    if (g.phase !== 'actions') b.clearTargets();
    switch (m.k) {
      case 'place': {
        if (m.src.kind !== 'drone') return false;
        b.clearTargets();
        const src = m.src;
        const piece = g.stacks[src.stack].pieces[src.index];
        if (!piece) return false;
        const what = pieceName(piece.type);
        const cands = ofType(legal, 'PLAY_CARD').filter(a => a.cardType === 'scoutingDrone'
          && a.stackIndex === src.stack && a.pieceIndex === src.index);
        v.instruction = W.placePickCell(what);
        return this.placement(b, m, cands, piece.type, selectionLabel.drone(what), 'drone', W.placeTurnConfirm(what));
      }
      case 'menu': return this.buildMenu(b, g, me, player, legal, m.pieceId);
      case 'claim': return this.buildClaim(b, g, legal, m);
      case 'upgradeOld': return this.buildUpgradeOld(b, g, legal, m);
      case 'upgrade': return this.buildUpgrade(b, g, legal, m);
      case 'card': return this.buildCard(b, g, player, legal, m);
      case 'drone': {
        const plays = ofType(legal, 'PLAY_CARD').filter(a => a.cardType === 'scoutingDrone');
        if (plays.length === 0) return false;
        b.clearTargets();
        // One choice per piece the list offers (whatever its position in the stack), named by stack
        // and piece type; only when one stack offers the same type twice does the position show.
        const seen = new Set<string>();
        const offers: { si: 0 | 1 | 2; pi: number; type: PieceType }[] = [];
        for (const a of plays) {
          const si = a.stackIndex, pi = a.pieceIndex;
          if (si === undefined || pi === undefined) continue;
          const k = `${si}:${pi}`;
          if (seen.has(k)) continue;
          seen.add(k);
          const piece = g.stacks[si].pieces[pi];
          if (piece) offers.push({ si, pi, type: piece.type });
        }
        offers.sort((x, y) => x.si - y.si || x.pi - y.pi);
        const items: Item[] = offers.map(({ si, pi, type }) => {
          const twin = offers.some(o => o.si === si && o.type === type && o.pi !== pi);
          const label = twin ? W.droneItemAt(si + 1, pi + 1, pieceName(type)) : W.droneItem(si + 1, pieceName(type));
          return b.item({ id: `drone:${si}:${pi}`, label, enabled: true },
            () => this.setMode({ k: 'place', src: { kind: 'drone', stack: si, index: pi }, coord: null, rotation: 0, auto: false }));
        });
        v.instruction = W.droneInstruction;
        v.choices = { title: W.dronePile, items };
        v.selection = { kind: 'card', label: selectionLabel.card(CARD_NAME.scoutingDrone) };
        v.confirmBar = { confirm: false, rotate: false, cancel: true };
        return true;
      }
      case 'pi': {
        b.clearTargets();
        const pis = this.piActions(g, me);
        this.lightMenus(b, g, player, legal, new Set(pis.map(a => a.pieceId)));
        if (pis.length === 0) return false;
        v.instruction = W.piInstruction(g.productionIncreaseBudget);
        v.choices = {
          title: CARD_NAME.productionIncrease,
          items: [b.item({ id: 'pi:done', label: g.phase === 'actions' ? W.piDone : W.piDoneStep, detail: W.piDoneDetail, enabled: true }, () => {
            this.piActive = false;
            this.mode = IDLE;
          })],
        };
        v.selection = { kind: 'card', label: selectionLabel.card(CARD_NAME.productionIncrease) };
        return true;
      }
      default: return false;
    }
  }

  private piActions(g: GameState, me: PlayerId): (ClaimBuildingAction | UpgradeBuildingAction)[] {
    const legal = legalFor(g, me);
    return [
      ...ofType(legal, 'CLAIM_BUILDING').filter(a => a.fromProductionIncrease),
      ...ofType(legal, 'UPGRADE_BUILDING').filter(a => a.fromProductionIncrease),
    ];
  }

  /** In the actions step: my buildings with something to do, my belts, belt start points, the deck. */
  private actionsIdleTargets(b: Builder, g: GameState, player: Player, legal: readonly Action[]): void {
    const pieces = new Set<string>();
    for (const a of legal) {
      if (a.type === 'PLACE_TELEPORTER' || a.type === 'CLAIM_BUILDING' || a.type === 'UPGRADE_BUILDING') pieces.add(a.pieceId);
    }
    this.lightMenus(b, g, player, legal, pieces);
    // Belt points and placed belts are not lit here: laying and removing belts are their own modes
    // (Lay a belt, Remove a belt), so the board stays calm until the player picks one. The deck is
    // lit by buildActions (see DECK_MODES).
  }

  // ── Building menu ───────────────────────────────────────────────────────────

  /**
   * Light the pieces whose menu would offer at least one move that can be made now; a piece whose
   * every entry is greyed out (for example "Run" after the building already ran this round) stays
   * dark, and a tap on it says why (whyNot).
   */
  private lightMenus(b: Builder, g: GameState, player: Player, legal: readonly Action[], ids: Iterable<string>): void {
    for (const id of ids) {
      const piece = pieceById(g, id);
      if (!piece || !this.menuItems(new Builder(emptyView()), g, player, legal, piece).some(i => i.enabled)) continue;
      b.lit({ kind: 'piece', pieceId: id }, () => this.setMode({ k: 'menu', pieceId: id }));
    }
  }

  /** Why a piece's menu has nothing to do now: the reason of its first greyed-out entry, if any. */
  private menuReason(g: GameState, me: PlayerId, pieceId: string): string | null {
    const piece = pieceById(g, pieceId);
    const player = g.players[me];
    if (!piece || !player) return null;
    const items = this.menuItems(new Builder(emptyView()), g, player, legalFor(g, me), piece);
    if (items.some(i => i.enabled)) return null;
    return items.find(i => i.reason)?.reason ?? null;
  }

  private buildMenu(b: Builder, g: GameState, me: PlayerId, player: Player, legal: readonly Action[], pieceId: string): boolean {
    const piece = pieceById(g, pieceId);
    if (!piece) return false;
    const items = this.menuItems(b, g, player, legal, piece);
    if (items.length === 0) return false;
    const v = b.view;
    // The building my meeple stands on at round end, with my teleporter on its input: the supply chooser.
    const supply = g.phase === 'roundEnd' && player.meepleOnPieceId === pieceId && player.meepleSlotIndex === null
      && isBuilding(piece) && canSupply(piece, me)
      ? this.supplyView(piece, player, ofType(legal, 'OPERATE_BUILDING').filter(a => a.pieceId === pieceId && a.ownerId === undefined), true)
      : null;
    const note = skippedNote(g, me, piece);
    v.menu = { anchor: { kind: 'piece', pieceId }, title: pieceName(piece.type), subtitle: this.pieceSummary(g, piece), items, supply, ...(note ? { note } : {}) };
    v.selection = { kind: 'building', label: selectionLabel.building(pieceName(piece.type)) };
    v.confirmBar = { confirm: false, rotate: false, cancel: true };
    return true;
  }

  private menuItems(b: Builder, g: GameState, player: Player, legal: readonly Action[], piece: BoardPiece): Item[] {
    const items: Item[] = [];
    const id = piece.id;
    const claims = ofType(legal, 'CLAIM_BUILDING').filter(a => a.pieceId === id);
    const ups = ofType(legal, 'UPGRADE_BUILDING').filter(a => a.pieceId === id);

    // Round end: the meeple building first.
    if (g.phase === 'roundEnd' && player.meepleOnPieceId === id && player.meepleSlotIndex === null && isBuilding(piece)) {
      for (const mat of MATERIALS) {
        const load = legal.find(a => a.type === 'LOAD_BUILDING_INPUT' && a.pieceId === id && a.material === mat);
        if (load) items.push(b.item({ id: `menu:load:${mat}`, label: W.menuLoad(mat), enabled: true }, () => this.send(load)));
      }
      const runs = ofType(legal, 'OPERATE_BUILDING').filter(a => a.pieceId === id && a.ownerId === undefined);
      const run = runs[0];
      const pv = runPreview(piece, player);
      const detail = pv ? (pv.product ? W.runDetail(pv.power, materialList(pv.consumed), pv.product)
        : W.runPowerPlant(pv.gain, materialList(pv.consumed))) : undefined;
      if (canSupply(piece, player.id)) {
        // My teleporter is on its input: one item per listed way to run it (the supply chooser).
        const opts = this.supplyOptions(b, 'menu', piece, player, runs, undefined);
        if (opts.length > 0) items.push(...opts);
        else items.push(b.item({ id: 'menu:run', label: W.menuRun, enabled: false, reason: this.supplyView(piece, player, runs, true).missing ?? W.nothingHere }));
      } else if (run) {
        items.push(b.item({ id: 'menu:run', label: W.menuRun, ...(detail ? { detail } : {}), enabled: true }, () => this.send(run)));
      } else {
        const blk = runBlock(piece, player);
        const reason = blk ? runBlockText(blk.why, blk.need ?? 0, player.powerTokens) : W.nothingHere;
        items.push(b.item({ id: 'menu:run', label: W.menuRun, enabled: false, reason }));
      }
      const collect = legal.find(a => a.type === 'COLLECT_OUTPUT' && a.pieceId === id);
      const inOut = (piece.output?.slots ?? []).filter((s): s is Material => s !== null);
      if (collect) {
        items.push(b.item({ id: 'menu:collect', label: W.menuCollect, detail: W.collectDetail(materialList(collectable(piece, player))), enabled: true }, () => this.send(collect)));
      } else if (inOut.length > 0) {
        items.push(b.item({ id: 'menu:collect', label: W.menuCollect, enabled: false, reason: W.inventoryFull(materialList([...new Set(inOut)])) }));
      }
    }

    // Claims, one item per currency.
    for (const src of ['pi', 'free'] as const) {
      if (!claims.some(a => claimSrc(a) === src)) continue;
      items.push(b.item({
        id: `menu:claim:${src}`,
        label: src === 'pi' ? W.menuClaim : W.menuClaimFree,
        detail: src === 'pi' ? W.payPI(g.productionIncreaseBudget) : W.payFreeClaim(player.freeActionCredits),
        enabled: true,
      }, () => this.setMode({ k: 'claim', src, pieceId: id })));
    }
    // Upgrades, one item per currency.
    for (const src of ['pi', 'endOfRound', 'mineCredit'] as const) {
      const mine = ups.filter(a => upSrc(a) === src);
      if (mine.length === 0) continue;
      const olds = [...new Set(mine.map(a => a.oldModule))];
      items.push(b.item({
        id: `menu:upgrade:${src}`,
        label: src === 'pi' ? W.menuUpgrade : src === 'endOfRound' ? W.menuUpgradeEndOfRound : W.menuUpgradeMineCredit,
        detail: src === 'pi' ? W.payPI(g.productionIncreaseBudget)
          : src === 'endOfRound' ? W.payEndOfRound(player.freeUpgradesRemaining) : W.payMineCredit(player.freeActionCredits),
        enabled: true,
      }, () => this.setMode(olds.length === 1
        ? { k: 'upgrade', src, pieceId: id, old: olds[0]! }
        : { k: 'upgradeOld', src, pieceId: id })));
    }
    // Teleporters: one item per free input (#55) and the output. On a building with several inputs
    // the item opens the teleporter step with that input lit, so the player sees which input it is
    // before confirming.
    for (const tp of ofType(legal, 'PLACE_TELEPORTER').filter(a => a.pieceId === id)) {
      const spot = tpSpotOf(id, tp.bufferType, tp.inputIndex);
      const price = teleporterCost(g.globalTeleporterCount);
      const several = severalInputs(piece, spot);
      items.push(b.item({
        id: `menu:teleporter:${tp.bufferType}${spot.input === null ? '' : `:${spot.input}`}`,
        label: W.teleporterOn(spotWords(piece, spot)),
        detail: (several ? `${W.inputHolds(holds(piece, spot.input ?? 0))} · ` : '') + W.teleporterDetail(price) + keepText(player, [price]),
        enabled: true, danger: true,
      }, () => (several ? this.setMode({ k: 'teleporter', pick: spot, whichOn: null }) : this.send(tp))));
    }
    return items;
  }

  private pieceSummary(g: GameState, piece: BoardPiece): string {
    const parts: string[] = [];
    if (piece.claims.length === 0) parts.push(W.menuSubtitleNone);
    else {
      const byOwner = new Map<PlayerId, number[]>();
      for (const c of piece.claims) byOwner.set(c.ownerId, [...(byOwner.get(c.ownerId) ?? []), c.controlModule]);
      parts.push(W.menuSubtitleModules([...byOwner].map(([o, ms]) => W.modulesOf(this.nameOf(o), W.moduleNumbers(ms, g.mineCount))).join('; ')));
    }
    const buf = (slots: ReadonlyArray<Material | null>): string => slots.map(s => (s ? MATERIAL_NAME[s] : W.empty)).join(', ');
    if (piece.input) {
      // On a building with several inputs, say which carry a teleporter (#55).
      const on = teleportersOf(piece.input).map(t => t.slot);
      const mark = on.length === 0 ? '' : piece.input.slots.length > 1 ? W.teleporterMarkInputs(on) : W.teleporterMark;
      parts.push(W.menuInput(buf(piece.input.slots)) + mark);
    }
    if (piece.output) parts.push(W.menuOutput(buf(piece.output.slots)) + (hasTeleporter(piece.output) ? W.teleporterMark : ''));
    return parts.join(' · ');
  }

  // ── Claim / upgrade with the module tray ────────────────────────────────────

  private claimCands(legal: readonly Action[], src: ClaimSrc, pieceId: string): ClaimBuildingAction[] {
    return ofType(legal, 'CLAIM_BUILDING').filter(a => a.pieceId === pieceId && claimSrc(a) === src);
  }

  private upCands(legal: readonly Action[], src: UpSrc, pieceId: string): UpgradeBuildingAction[] {
    return ofType(legal, 'UPGRADE_BUILDING').filter(a => a.pieceId === pieceId && upSrc(a) === src);
  }

  private buildClaim(b: Builder, g: GameState, legal: readonly Action[], m: Extract<Mode, { k: 'claim' }>): boolean {
    const cands = this.claimCands(legal, m.src, m.pieceId);
    const piece = pieceById(g, m.pieceId);
    if (cands.length === 0 || !piece) return false;
    const v = b.view;
    v.instruction = W.claimOn(pieceName(piece.type));
    v.selection = { kind: 'building', label: selectionLabel.building(pieceName(piece.type)) };
    v.confirmBar = { confirm: false, rotate: false, cancel: true };
    const back = this.backMode();
    v.tray = v.tray.map(t => {
      const a = cands.find(c => c.controlModule === t.module);
      if (!a) return t;
      b.item({ id: `module:${t.module}`, label: '', enabled: true }, () => this.send(a, back));
      return { module: t.module, state: 'lit', cost: W.moduleCost(t.module - g.mineCount + 1), upgradeCost: t.module - g.mineCount + 1 };
    });
    return true;
  }

  private buildUpgradeOld(b: Builder, g: GameState, legal: readonly Action[], m: Extract<Mode, { k: 'upgradeOld' }>): boolean {
    const cands = this.upCands(legal, m.src, m.pieceId);
    const piece = pieceById(g, m.pieceId);
    if (cands.length === 0 || !piece) return false;
    const olds = [...new Set(cands.map(a => a.oldModule))].sort((x, y) => x - y);
    const v = b.view;
    v.instruction = W.pickOld;
    v.selection = { kind: 'building', label: selectionLabel.building(pieceName(piece.type)) };
    v.confirmBar = { confirm: false, rotate: false, cancel: true };
    v.choices = {
      title: W.pickOld,
      items: olds.map(o => b.item({ id: `old:${o}`, label: W.oldModule(o, g.mineCount), enabled: true },
        () => this.setMode({ k: 'upgrade', src: m.src, pieceId: m.pieceId, old: o }))),
    };
    return true;
  }

  private buildUpgrade(b: Builder, g: GameState, legal: readonly Action[], m: Extract<Mode, { k: 'upgrade' }>): boolean {
    const cands = this.upCands(legal, m.src, m.pieceId).filter(a => a.oldModule === m.old);
    const piece = pieceById(g, m.pieceId);
    if (cands.length === 0 || !piece) return false;
    const v = b.view;
    v.instruction = W.upgradeOn(pieceName(piece.type), m.old);
    v.selection = { kind: 'building', label: selectionLabel.building(pieceName(piece.type)) };
    v.confirmBar = { confirm: false, rotate: false, cancel: true };
    const back = this.backMode();
    v.tray = v.tray.map(t => {
      const a = cands.find(c => c.newModule === t.module);
      if (!a) return t;
      b.item({ id: `module:${t.module}`, label: '', enabled: true }, () => this.send(a, back));
      return { module: t.module, state: 'lit', cost: W.moduleCost(t.module - m.old), upgradeCost: t.module - m.old };
    });
    return true;
  }

  /** Where a claim/upgrade returns to: the Production Increase mode while it is running. */
  private backMode(): Mode {
    return this.piActive ? { k: 'pi' } : IDLE;
  }

  // ── Belts ───────────────────────────────────────────────────────────────────

  /**
   * Lay a belt: tap where the belts start, then where they end (any point a belt of mine could
   * end at, on any piece). The shortest route between them is planned whatever it costs.
   */
  private buildBelt(b: Builder, g: GameState, me: PlayerId, _legal: readonly Action[], m: Extract<Mode, { k: 'belt' }>): boolean {
    const ends = routeEnds(g, me);
    if (ends.length === 0) return false;
    const v = b.view;
    b.clearTargets();
    v.selection = { kind: 'belt', label: selectionLabel.belt };
    v.confirmBar = { confirm: false, rotate: false, cancel: true };
    if (!m.start) {
      v.instruction = W.beltPickStart;
      for (const p of ends) b.lit({ kind: 'point', pieceId: p.pieceId, point: p.position }, () => this.setMode({ k: 'belt', start: p }));
      // A route planned earlier on this device that can still be laid.
      const left = this.plan ? remaining(g, me, this.plan) : [];
      if (left.length > 0 && stillPossible(g, me, left)) {
        v.choices = {
          title: W.beltPickStart,
          items: [b.item({ id: 'route:continue', label: W.routeContinue(left.length), detail: W.routeContinueDetail, enabled: true }, () => this.setMode({ k: 'route' }))],
        };
      }
      return true;
    }
    const start = m.start;
    if (!ends.some(p => p.pieceId === start.pieceId && p.position === start.position)) return false;
    v.instruction = W.beltPickEnd;
    v.selection = { kind: 'belt', label: W.beltStart };
    b.lit({ kind: 'point', pieceId: start.pieceId, point: start.position }, () => this.setMode({ k: 'belt', start: null }));
    // Only ends a route can reach from this start are lit.
    for (const p of reachableEnds(g, me, start)) {
      b.lit({ kind: 'point', pieceId: p.pieceId, point: p.position }, () => this.planBetween(start, p));
    }
    return true;
  }

  /** The second point of a route was tapped: plan the shortest route, whatever it costs. */
  private planBetween(start: RoutePoint, end: RoutePoint): void {
    const g = this.game, me = this.me;
    if (!g || me === null) return;
    const segs = planRoute(g, me, start, end);
    if (!segs) { this.hintText = W.noRoute; return; }
    this.plan = segs;
    this.planBase = new Set(g.belts.map(x => x.id));
    this.mode = { k: 'route' };
  }

  /** Forget the planned route (its unlaid part); belts already on the board stay. */
  private dropPlan(): void {
    this.plan = null;
    this.planBase = new Set();
  }

  /**
   * The belts of the planned route laid this turn, which can be picked up again, last laid first.
   * Never a belt of an earlier route (it was on the board when the plan was made) and never one
   * laid on an earlier turn (only this turn's belts count).
   */
  private routeLaidThisTurn(g: GameState, me: PlayerId, legal: readonly Action[]): string[] {
    const plan = this.plan;
    if (!plan) return [];
    const removable = new Set(ofType(legal, 'REMOVE_BELT').map(a => a.beltId));
    const byId = new Map(g.belts.map(x => [x.id, x]));
    return [...g.beltsPlacedThisTurn].reverse().filter(id => {
      const belt = byId.get(id);
      return !!belt && belt.ownerId === me && removable.has(id) && !this.planBase.has(id)
        && plan.some(s => s.pieceId === belt.pieceId
          && ((s.from === belt.fromPoint && s.to === belt.toPoint) || (s.from === belt.toPoint && s.to === belt.fromPoint)));
    });
  }

  /**
   * The planned route: its totals, and placing from the supply, buying first, keeping it for later,
   * or cancelling. When the engine refuses its next belt now (for example the one Mine belt of the
   * turn is already down), the reason stays in the instruction, no Place button is offered, and
   * cancelling is the big button.
   */
  private buildRoute(b: Builder, g: GameState, me: PlayerId, legal: readonly Action[]): boolean {
    const v = b.view;
    const left = this.plan ? remaining(g, me, this.plan) : [];
    if (left.length === 0) {
      // All laid: back to choosing where the next belts go.
      if (this.plan) this.hintText = W.routeDone;
      this.dropPlan();
      this.mode = { k: 'belt', start: null };
      return this.buildBelt(b, g, me, [], this.mode);
    }
    if (!stillPossible(g, me, left)) {
      this.dropPlan();
      this.hintText = W.planGone;
      return false;
    }
    b.clearTargets();
    const t = tiers(g, me, left);
    v.route = t.map(x => ({ pieceId: x.pieceId, from: x.from, to: x.to, tier: x.tier }));
    const own = t.filter(x => x.tier === 'own').length;
    const buy = t.filter(x => x.tier === 'buy').length;
    const short = t.length - own - buy;
    const have = g.players[me]?.beltsRemaining ?? 0;
    const totals = have === 0 ? W.routeNoSupply(t.length, buy) : W.routeTotals(t.length, have, buy, short);
    v.instruction = totals;
    v.selection = { kind: 'belt', label: selectionLabel.belt };
    v.confirmBar = { confirm: false, rotate: false, cancel: true };
    // Tapping another start point plans a new route.
    for (const p of routeEnds(g, me)) b.lit({ kind: 'point', pieceId: p.pieceId, point: p.position }, () => this.setMode({ k: 'belt', start: p }));
    const items: Item[] = [];
    const placeOwn = (): void => this.layPlan(false);
    const placeBuy = (): void => this.layPlan(true);
    const later = (): void => { this.mode = IDLE; };

    // Cancelling: what was laid of this route this turn can be picked up again; belts laid on an
    // earlier turn stay (they are no longer this turn's to take back).
    const laidNow = this.routeLaidThisTurn(g, me, legal);
    const laidBefore = (this.plan?.length ?? 0) - left.length - laidNow.length;
    const drop = (): void => { this.dropPlan(); this.mode = { k: 'belt', start: null }; };
    const takeBack = (): void => {
      this.dropPlan();
      this.mode = { k: 'belt', start: null };
      this.startQueue(laidNow.map((beltId): Action => ({ type: 'REMOVE_BELT', beltId })));
    };
    const partly = laidNow.length > 0 || laidBefore > 0;
    const cancelItem = b.item(partly
      ? { id: 'route:cancel', label: W.routeDropRest, detail: W.routeDropRestDetail, enabled: true }
      : { id: 'route:cancel', label: W.routeCancel, detail: W.routeCancelDetail, enabled: true }, drop);
    const takeBackItem = laidNow.length > 0
      ? b.item({ id: 'route:takeBack', label: W.routeTakeBack, detail: W.routeTakeBackDetail(laidNow.length), enabled: true }, takeBack)
      : null;

    // Belts are at hand (in the supply or to buy) but the engine refuses the next one now: say
    // why for as long as the route is shown, and offer no Place button that would only fail.
    const tryOwn = own > 0 ? placement(g, me, left, false) : null;
    const tryBuy = buy > 0 ? placement(g, me, left, true) : null;
    const refusal = (tryOwn?.placed ?? 0) === 0 && (tryBuy?.placed ?? 0) === 0
      ? tryOwn?.refusal ?? tryBuy?.refusal ?? null : null;
    if (refusal) {
      // Nothing of it can be laid now: every belt is drawn and counted as one for a later turn,
      // not as "from your supply" or "to buy now".
      v.route = t.map(x => ({ pieceId: x.pieceId, from: x.from, to: x.to, tier: 'cant' as const }));
      v.instruction = `${totals} ${partly ? W.routeRestRefused : W.routeRefused} ${refusalText(refusal)}`;
      items.push(cancelItem);
      if (takeBackItem) items.push(takeBackItem);
      items.push(b.item({ id: 'route:later', label: W.routeLater, detail: W.routeLaterDetail, enabled: true }, later));
      v.primary = { label: cancelItem.label, enabled: true };
      b.onPrimary = drop;
      v.choices = { title: v.instruction, items };
      return true;
    }

    if (own === t.length) {
      v.primary = { label: W.routePlaceAll(own), enabled: true };
      b.onPrimary = placeOwn;
    } else {
      if (own > 0) items.push(b.item({ id: 'route:own', label: W.routePlaceOwn(own), detail: W.routeOwnDetail, enabled: true }, placeOwn));
      if (buy > 0) items.push(b.item({ id: 'route:buy', label: W.routeBuyPlace(buy, own + buy), detail: W.routeBuyDetail(buy * BELT_COST) + (g.players[me] ? keepText(g.players[me], new Array<number>(buy).fill(BELT_COST)) : ''), enabled: true }, placeBuy));
      const first = items[0];
      if (first) {
        v.primary = { label: first.label, enabled: true };
        b.onPrimary = first.id === 'route:own' ? placeOwn : placeBuy;
      } else {
        // Nothing can be laid now (no button with a zero count): the plan waits for a later turn.
        items.push(b.item({ id: 'route:later', label: W.routeLater, detail: W.routeLaterDetail, enabled: true }, later));
        v.instruction = `${totals} ${W.routeNothingNow}`;
        v.primary = { label: W.routeLater, enabled: true };
        b.onPrimary = later;
      }
    }
    items.push(cancelItem);
    if (takeBackItem) items.push(takeBackItem);
    v.choices = { title: totals, items };
    return true;
  }

  /** Lay the planned route from its start (buying first when asked); a refused belt stops it there. */
  private layPlan(withBuy: boolean): void {
    const g = this.game, me = this.me;
    if (!g || me === null || !this.plan) return;
    const left = remaining(g, me, this.plan);
    const r = placement(g, me, left, withBuy);
    if (r.placed === 0) {
      this.hintText = r.refusal ? refusalText(r.refusal) : W.routeBlocked;
      return;
    }
    this.mode = { k: 'route' };
    // Belts bought for the route: what paying for them leaves.
    const bought = r.actions.filter(x => x.type === 'BUY_BELT').length;
    const player = g.players[me];
    const k = bought > 0 && player ? keptAfter(player, new Array<number>(bought).fill(BELT_COST)) : null;
    if (k) this.hintText = W.paidKeep(bought * BELT_COST, k.kept, k.lost);
    this.startQueue(r.actions);
    if (r.refusal) this.hintText = refusalText(r.refusal);
  }

  /** Remove a belt: my belts that can be taken back are lit; one tap selects, the big button removes. */
  private buildRemove(b: Builder, legal: readonly Action[], m: Extract<Mode, { k: 'removeBelt' }>): boolean {
    const rms = ofType(legal, 'REMOVE_BELT');
    if (rms.length === 0) return false;
    const v = b.view;
    b.clearTargets();
    const sel = m.beltId ? rms.find(a => a.beltId === m.beltId) ?? null : null;
    // Once one is chosen only that belt glows, so it can be told apart from a belt beside or across
    // it on the same tile; the others still answer a tap (choosing them instead).
    for (const a of rms) {
      const t: Target = { kind: 'belt', beltId: a.beltId };
      const fn = (): void => this.setMode({ k: 'removeBelt', beltId: a.beltId === m.beltId ? null : a.beltId });
      if (sel && a.beltId !== sel.beltId) b.quiet(t, fn);
      else b.lit(t, fn);
    }
    // Say before the confirm which way the belt goes (RULES_CHANGES.md #54): laid this turn, back
    // to the player's own belts; laid earlier, back to the bank, to be bought again.
    const ownBack = !!sel && !!this.game && beltLaidThisTurn(this.game, sel.beltId);
    v.instruction = sel ? (ownBack ? W.removeConfirm : W.removeConfirmBank) : W.removePick;
    v.selection = { kind: 'belt', label: W.removeSelection };
    v.confirmBar = { confirm: !!sel, rotate: false, cancel: true, ...(sel ? { label: ownBack ? W.removeBelt : W.removeBeltToBank } : {}) };
    if (sel) b.onConfirm = (): void => this.send(sel, { k: 'removeBelt', beltId: null });
    return true;
  }

  // ── Teleporter (bank) ───────────────────────────────────────────────────────

  private buildTeleporter(b: Builder, g: GameState, legal: readonly Action[], m: Extract<Mode, { k: 'teleporter' }>): boolean {
    const tps = ofType(legal, 'PLACE_TELEPORTER');
    if (tps.length === 0) return false;
    const v = b.view;
    b.clearTargets();
    v.instruction = W.teleporterPick;
    v.selection = { kind: 'teleporter', label: selectionLabel.teleporter };
    v.confirmBar = { confirm: false, rotate: false, cancel: true };
    const spots = tps.map(a => tpSpotOf(a.pieceId, a.bufferType, a.inputIndex));
    this.teleporterTargets(b, g, spots, m.whichOn,
      pick => this.setMode({ ...m, pick, whichOn: null }),
      pieceId => this.setMode({ ...m, pick: null, whichOn: pieceId }));
    if (m.whichOn && !spots.some(s => s.pieceId === m.whichOn)) return false;
    if (m.pick) {
      const pick = m.pick;
      const tp = tps.find(a => sameSpot(tpSpotOf(a.pieceId, a.bufferType, a.inputIndex), pick));
      const piece = pieceById(g, pick.pieceId);
      if (!tp || !piece) return false;
      v.instruction = W.teleporterConfirm(spotWords(piece, pick), pieceName(piece.type), severalInputs(piece, pick));
      v.confirmBar = { confirm: true, rotate: false, cancel: true };
      b.onConfirm = (): void => this.send(tp);
    }
    return true;
  }

  /**
   * Light every spot a teleporter may go: each input on its own (#55) and the output. Tapping a
   * spot picks it; tapping the building picks its only spot or lists them (`whichOn`).
   */
  private teleporterTargets(
    b: Builder, g: GameState, spots: readonly TpSpot[], whichOn: string | null,
    pick: (p: TpSpot) => void,
    ask: (pieceId: string) => void,
  ): void {
    for (const o of spots) b.lit(spotTarget(o), () => pick(o));
    for (const id of new Set(spots.map(o => o.pieceId))) {
      const mine = spots.filter(o => o.pieceId === id);
      b.lit({ kind: 'piece', pieceId: id }, () => (mine.length === 1 ? pick(mine[0]!) : ask(id)));
    }
    const piece = whichOn ? pieceById(g, whichOn) : null;
    const here = spots.filter(o => o.pieceId === whichOn);
    if (!piece || here.length === 0) return;
    b.view.choices = {
      title: W.teleporterWhich,
      items: here.map(o => b.item({
        id: `buffer:${o.buffer}${o.input === null ? '' : `:${o.input}`}`, label: W.teleporterOn(spotWords(piece, o)),
        ...(o.buffer === 'input' && (piece.input?.slots.length ?? 0) > 1 ? { detail: W.inputHolds(holds(piece, o.input ?? 0)) } : {}),
        enabled: true,
      }, () => pick(o))),
    };
  }

  // ── Exchange ────────────────────────────────────────────────────────────────

  private exchangeItems(b: Builder, player: Player, legal: readonly Action[]): Item[] {
    return (['plate', 'sphere', 'tesseract'] as const).map(give => {
      const a = legal.find(x => x.type === 'EXCHANGE_MATERIALS' && x.give === give);
      const gets = EXCHANGE_GETS[give];
      const getsText = (Object.entries(gets) as [Material, number][]).map(([m, n]) => `${n} ${MATERIAL_NAME[m]}`).join(' + ');
      const over = (Object.entries(gets) as [Material, number][]).filter(([m, n]) => player.inventory[m] + n > INVENTORY_CAP).map(([m]) => m);
      const it: Item = {
        id: `exchange:${give}`,
        label: W.exchangeLabel(give, getsText),
        enabled: !!a,
        ...(over.length && a ? { detail: W.exchangeOverflow(materialList(over)), danger: true } : {}),
        ...(a ? {} : { reason: W.exchangeNone(give) }),
      };
      return b.item(it, a ? (): void => this.send(a) : undefined);
    });
  }

  /** One material pressed in my inventory: what it breaks down into (and what the limit cuts), then confirm. */
  private buildExchangeOne(b: Builder, g: GameState, me: PlayerId, legal: readonly Action[], m: Extract<Mode, { k: 'exchangeOne' }>): boolean {
    const a = ofType(legal, 'EXCHANGE_MATERIALS').find(x => x.give === m.give);
    const out = a ? exchangeOutcome(g, me, m.give) : null;
    if (!a || !out) return false;
    const v = b.view;
    b.clearTargets();
    v.instruction = W.exchangeAsk(m.give, out.gets) + out.cut.map(([mat, n, got]) => W.exchangeCut(mat, n, got)).join('');
    v.selection = { kind: 'exchange', label: W.exchangeSelection(m.give) };
    v.confirmBar = { confirm: true, rotate: false, cancel: true, label: W.exchangeConfirm };
    b.onConfirm = (): void => this.send(a);
    return true;
  }

  // ── Leverage cards ──────────────────────────────────────────────────────────

  private buildCard(b: Builder, g: GameState, player: Player, legal: readonly Action[], m: Extract<Mode, { k: 'card' }>): boolean {
    const plays = ofType(legal, 'PLAY_CARD').filter(a => a.cardType === m.card);
    if (plays.length === 0) return false;
    const v = b.view;
    const name = CARD_NAME[m.card];
    b.clearTargets();
    v.selection = { kind: 'card', label: selectionLabel.card(name) };
    v.confirmBar = { confirm: false, rotate: false, cancel: true };
    const ready = (a: PlayCardAction, text: string): void => {
      v.instruction = text;
      v.confirmBar = { confirm: true, rotate: false, cancel: true };
      b.onConfirm = (): void => {
        if (a.cardType === 'productionIncrease') { this.piActive = true; this.send(a, { k: 'pi' }); }
        else this.send(a);
      };
    };

    if (NO_TARGET_CARDS.has(m.card)) {
      ready(plays[0]!, `${W.playCard(name)} ${CARD_TEXT[m.card]}`);
      return true;
    }

    switch (m.card) {
      case 'shortSale':
      case 'sinkHole': {
        for (const a of plays) {
          if (a.pieceId) { const id = a.pieceId; b.lit({ kind: 'piece', pieceId: id }, () => this.setMode({ ...m, a: id })); }
        }
        const module = [...player.controlModules].filter(x => x >= g.mineCount).sort((x, y) => x - y)[0] ?? 0;
        v.instruction = m.card === 'shortSale' ? W.shortSalePick(module) : W.sinkHolePick;
        if (m.a) {
          const a = plays.find(x => x.pieceId === m.a);
          const piece = pieceById(g, m.a);
          if (!a || !piece) return false;
          ready(a, m.card === 'shortSale' ? W.shortSaleConfirm(pieceName(piece.type), module) : W.sinkHoleConfirm(pieceName(piece.type), g.belts.filter(x => x.pieceId === piece.id).length));
        }
        return true;
      }
      case 'rdTaxWriteOff': {
        v.instruction = W.rdPick;
        const spots = plays.filter(a => a.pieceId && a.bufferType).map(a => tpSpotOf(a.pieceId!, a.bufferType!, a.inputIndex));
        this.teleporterTargets(b, g, spots, m.whichOn,
          p => this.setMode({ ...m, a: p.pieceId, spot: p, whichOn: null }),
          id => this.setMode({ ...m, a: null, spot: null, whichOn: id }));
        if (m.whichOn && !spots.some(s => s.pieceId === m.whichOn)) return false;
        if (m.spot) {
          const spot = m.spot;
          const a = plays.find(x => x.pieceId && x.bufferType && sameSpot(tpSpotOf(x.pieceId, x.bufferType, x.inputIndex), spot));
          const piece = pieceById(g, spot.pieceId);
          if (!a || !piece) return false;
          ready(a, W.rdConfirm(spotWords(piece, spot), pieceName(piece.type), severalInputs(piece, spot)));
        }
        return true;
      }
      case 'changingPriorities': {
        if (!m.a) {
          v.instruction = W.cpPickFrom;
          for (const id of new Set(plays.map(a => a.pieceId!))) {
            b.lit({ kind: 'piece', pieceId: id }, () => this.setMode({ ...m, a: id, b: null, module: null }));
          }
          return true;
        }
        const from = m.a;
        const fromPlays = plays.filter(a => a.pieceId === from);
        if (fromPlays.length === 0) return false;
        b.lit({ kind: 'piece', pieceId: from }, () => this.setMode({ ...m, a: null, b: null, module: null }));
        if (!m.b) {
          v.instruction = W.cpPickTo;
          for (const id of new Set(fromPlays.map(a => a.toPieceId!))) {
            b.lit({ kind: 'piece', pieceId: id }, () => {
              const mods = [...new Set(fromPlays.filter(a => a.toPieceId === id).map(a => a.controlModule!))];
              this.setMode({ ...m, b: id, module: mods.length === 1 ? mods[0]! : null });
            });
          }
          return true;
        }
        const to = m.b;
        const pairPlays = fromPlays.filter(a => a.toPieceId === to);
        if (pairPlays.length === 0) return false;
        b.lit({ kind: 'piece', pieceId: to }, () => this.setMode({ ...m, b: null, module: null }));
        const mods = [...new Set(pairPlays.map(a => a.controlModule!))].sort((x, y) => x - y);
        if (m.module === null) {
          v.instruction = W.cpPickModule;
          v.choices = {
            title: W.cpPickModule,
            items: mods.map(n => b.item({ id: `cpModule:${n}`, label: W.oldModule(n), enabled: true }, () => this.setMode({ ...m, module: n }))),
          };
          return true;
        }
        const a = pairPlays.find(x => x.controlModule === m.module);
        const fp = pieceById(g, from), tp = pieceById(g, to);
        if (!a || !fp || !tp) return false;
        // Moving their last Control Module off it: say what goes to the bank and what comes back (#58).
        ready(a, W.cpConfirm(m.module, pieceName(fp.type), pieceName(tp.type), lossIfModuleLeaves(fp, player.id)));
        return true;
      }
      default:
        return false;
    }
  }

  // ── Step 4: meeple ──────────────────────────────────────────────────────────

  private buildMeeple(b: Builder, g: GameState, me: PlayerId, player: Player, legal: readonly Action[]): boolean {
    const v = b.view;
    v.step = 'meeple';
    const end = legal.find(a => a.type === 'END_TURN');
    const places = ofType(legal, 'PLACE_MEEPLE');
    // Leverage cards (or a Production Increase) are still playable here, before and after the meeple is down.
    const cardsLeft = legal.some(a => a.type === 'PLAY_CARD') || this.piActions(g, me).length > 0;
    if (places.length === 0) {
      // Nothing to choose: one explicit button ends the turn.
      const placed = !!player.meepleOnPieceId;
      v.instruction = placed ? (cardsLeft ? W.meepleDoneCards : W.meepleDone) : W.noMeepleSpot;
      v.primary = { label: placed ? W.endTurn : W.noMeepleSpotEnd, enabled: !!end };
      if (end) b.onPrimary = (): void => this.send(end);
      if (isExtraMode(this.mode)) return this.buildExtra(b, g, me, player, legal);
      return this.mode.k === 'idle';
    }
    v.primary = { label: W.meepleChoose, enabled: false, hint: W.meepleChooseWhy };
    v.instruction = W.meeplePlace;
    if (isExtraMode(this.mode)) return this.buildExtra(b, g, me, player, legal);
    const minePieces = new Set<string>();
    for (const a of places) {
      if (a.slotIndex === undefined) {
        b.lit({ kind: 'piece', pieceId: a.pieceId }, () => this.setMode({ k: 'meeple', pieceId: a.pieceId, slot: null }));
      } else {
        const slot = a.slotIndex;
        b.lit({ kind: 'mineSlot', pieceId: a.pieceId, slot }, () => this.setMode({ k: 'meeple', pieceId: a.pieceId, slot }));
        minePieces.add(a.pieceId);
      }
    }
    for (const id of minePieces) {
      const slots = places.filter(a => a.pieceId === id).map(a => a.slotIndex!);
      b.lit({ kind: 'piece', pieceId: id }, () => this.setMode(slots.length === 1
        ? { k: 'meeple', pieceId: id, slot: slots[0]! }
        : { k: 'meepleSlot', pieceId: id }));
    }
    const m = this.mode;
    if (m.k === 'idle') return true;
    v.selection = { kind: 'meeple', label: selectionLabel.meeple };
    v.confirmBar = { confirm: false, rotate: false, cancel: true };
    if (m.k === 'meepleSlot') {
      const slots = places.filter(a => a.pieceId === m.pieceId && a.slotIndex !== undefined);
      if (slots.length === 0) return false;
      v.instruction = W.meepleWhich;
      v.choices = {
        title: W.meepleWhich,
        items: slots.map(a => {
          const gain = this.mineGain(g, m.pieceId, a.slotIndex!);
          return b.item({ id: `slot:${a.slotIndex}`, label: a.slotIndex === 1 ? W.upgradePoint : W.resourcePoint, ...(gain ? { detail: W.meepleSlotDetail(gain.what) } : {}), enabled: true },
            () => this.setMode({ k: 'meeple', pieceId: m.pieceId, slot: a.slotIndex! }));
        }),
      };
      return true;
    }
    if (m.k !== 'meeple') return false;
    const a = places.find((x: PlaceMeepleAction) => x.pieceId === m.pieceId && (m.slot === null ? x.slotIndex === undefined : x.slotIndex === m.slot));
    const piece = pieceById(g, m.pieceId);
    if (!a || !piece) return false;
    const where = piece.type === 'mine' ? (m.slot === 1 ? W.upgradePoint : W.resourcePoint) : pieceName(piece.type);
    const gain = piece.type === 'mine' && m.slot !== null ? this.mineGain(g, piece.id, m.slot) : null;
    v.instruction = gain ? W.meepleConfirmGain(where, gain.what) + gain.cut : W.meepleConfirm(where);
    v.meeplePick = { pieceId: m.pieceId, slot: m.slot };
    v.confirmBar = { confirm: true, rotate: false, cancel: true };
    // Placing the meeple is the last thing a turn needs: the turn then ends by itself.
    b.onConfirm = (): void => { this.mode = IDLE; this.startQueue([a, { type: 'END_TURN' }]); };
    return true;
  }

  /**
   * What my meeple on this Mine point would gain at the end of the round, as things stand (the
   * engine's own reward table), and a note when the limit of 6 would cut it.
   */
  private mineGain(g: GameState, mineId: string, slot: number): { what: string; cut: string } | null {
    const r = mineSlotReward(g, mineId, slot);
    const player = this.me !== null ? g.players[this.me] : undefined;
    if (!r || !player) return null;
    if (r.kind === 'credits') return { what: W.meepleGainUpgrades(r.amount), cut: '' };
    const fits = cappedAmount(player.inventory, r.material, r.amount);
    return {
      what: W.meepleGainMaterial(r.amount, r.material),
      cut: fits < r.amount ? W.meepleGainCut(r.material, player.inventory[r.material], fits) : '',
    };
  }

  // ── Round end ───────────────────────────────────────────────────────────────

  private buildRoundEnd(b: Builder, g: GameState, me: PlayerId, player: Player, legal: readonly Action[]): boolean {
    const v = b.view;
    v.step = 'roundEnd';
    v.instruction = W.roundEndIdle;
    const end = legal.find(a => a.type === 'END_ACTIONS');
    v.primary = { label: W.roundEndDone, enabled: !!end };
    if (end) b.onPrimary = (): void => this.send(end);
    const pieces = new Set<string>();
    for (const a of legal) {
      if (a.type === 'LOAD_BUILDING_INPUT' || a.type === 'OPERATE_BUILDING' || a.type === 'COLLECT_OUTPUT'
        || a.type === 'CLAIM_BUILDING' || a.type === 'UPGRADE_BUILDING') pieces.add(a.pieceId);
    }
    // The meeple's building is lit only when something can be done there; a tap on it otherwise
    // says why it cannot run (whyNot).
    this.lightMenus(b, g, player, legal, pieces);
    const m = this.mode;
    switch (m.k) {
      case 'idle': return true;
      case 'menu': return this.buildMenu(b, g, me, player, legal, m.pieceId);
      case 'claim': return this.buildClaim(b, g, legal, m);
      case 'upgradeOld': return this.buildUpgradeOld(b, g, legal, m);
      case 'upgrade': return this.buildUpgrade(b, g, legal, m);
      case 'exchange': {
        const items = this.exchangeItems(b, player, legal);
        if (!items.some(i => i.enabled)) return false;
        v.choices = { title: W.exchangeTitle, items };
        v.confirmBar = { confirm: false, rotate: false, cancel: true };
        return true;
      }
      case 'exchangeOne': return this.buildExchangeOne(b, g, me, legal, m);
      default: return false;
    }
  }

  // ── Bank and hand (always shown while seated) ───────────────────────────────

  private gate(g: GameState, myTurn: boolean, pending: boolean, roundEndToo: boolean): string | null {
    if (pending) return W.decideFirst;
    if (!myTurn) return W.notYourTurn;
    if (g.phase === 'actions') return null;
    if (roundEndToo && g.phase === 'roundEnd') return null;
    return roundEndToo ? W.onlyActionsOrRoundEnd : W.onlyActions;
  }

  private bankItems(b: Builder, g: GameState, player: Player, legal: readonly Action[], myTurn: boolean, pending: boolean): Item[] {
    const gate = this.gate(g, myTurn, pending, false);
    const worth = inventoryValue(player);
    const has = (t: Action['type']): boolean => legal.some(a => a.type === t);
    const items: Item[] = [];
    const add = (it: Omit<Item, 'enabled' | 'reason'>, enabled: boolean, reason: () => string, fn: () => void): void => {
      items.push(b.item(enabled ? { ...it, enabled } : { ...it, enabled, reason: gate ?? reason() }, enabled ? fn : undefined));
    };

    const canPlan = gate === null && this.me !== null && routeEnds(g, this.me).length > 0;
    add({ id: 'bank:placeBelt', label: W.bankPlaceBelt, detail: W.bankPlaceBeltDetail(player.beltsRemaining) }, canPlan,
      () => W.noBeltPoint, () => this.setMode({ k: 'belt', start: null }));
    add({ id: 'bank:removeBelt', label: W.bankRemoveBelt, detail: W.bankRemoveBeltDetail }, has('REMOVE_BELT'),
      () => W.noBeltToRemove, () => this.setMode({ k: 'removeBelt', beltId: null }));
    const keep = (price: number): string => keepText(player, [price]);
    add({ id: 'bank:buyBelt', label: W.bankBuyBelt, detail: W.price(BELT_COST) + keep(BELT_COST), price: BELT_COST }, has('BUY_BELT'),
      () => W.cantAfford(BELT_COST, worth), () => this.send({ type: 'BUY_BELT' }));
    add({ id: 'bank:undoBelts', label: W.bankUndoBelts, detail: W.bankUndoDetail(g.beltsPlacedThisTurn.length) }, has('UNDO_BELTS'),
      () => W.noBeltsThisTurn, () => this.send({ type: 'UNDO_BELTS' }));
    const cc = cardCost(g.mineCount);
    // The deck runs out only when the discard pile is empty too: it is shuffled into a new deck (RULES_CHANGES.md #48).
    add({ id: 'bank:buyCard', label: W.bankBuyCard, detail: W.cardPriceDetail(cc, g.cardDeck.length, g.cardDiscard.length) + keep(cc), price: cc }, has('BUY_CARD'),
      () => (cardsLeftToDraw(g) === 0 ? W.deckEmpty : W.cantAfford(cc, worth)), () => this.send({ type: 'BUY_CARD' }, this.modeAfterBuy()));
    const mp = nextMinePrice(g, MINE_COSTS);
    add({ id: 'bank:buyMine', label: W.bankBuyMine, detail: mp === null ? W.allMinesIn : W.price(mp) + keep(mp), ...(mp === null ? {} : { price: mp }) }, has('BUY_MINE'),
      () => (mp === null ? W.allMinesIn : g.pendingMineIds.length > 0 ? W.mineDropPending : W.cantAfford(mp, worth)),
      () => this.setMode({ k: 'place', src: { kind: 'buyMine' }, coord: null, rotation: 0, auto: false }));
    const tpPrice = teleporterCost(g.globalTeleporterCount);
    add({ id: 'bank:teleporter', label: W.bankTeleporter, detail: W.teleporterPrice(tpPrice) + keep(tpPrice), price: tpPrice }, has('PLACE_TELEPORTER'),
      () => this.teleporterReason(g, player, tpPrice, worth),
      () => this.setMode({ k: 'teleporter', pick: null, whichOn: null }));
    const exGate = this.gate(g, myTurn, pending, true);
    const exOk = has('EXCHANGE_MATERIALS');
    items.push(b.item(exOk
      ? { id: 'bank:exchange', label: W.bankExchange, detail: W.bankExchangeDetail, enabled: true }
      : { id: 'bank:exchange', label: W.bankExchange, detail: W.bankExchangeDetail, enabled: false, reason: exGate ?? W.nothingToExchange },
    exOk ? (): void => this.setMode({ k: 'exchange' }) : undefined));
    // A Production Increase played this turn with upgrades left: spend them now, in any step of the turn.
    const me = this.me;
    if (me !== null && myTurn && !pending && g.productionIncreaseBudget > 0 && this.piActions(g, me).length > 0) {
      const inPi = this.mode.k === 'pi' || (this.mode.k === 'idle' && this.piActive);
      items.push(b.item(inPi
        ? { id: 'bank:pi', label: W.piSpend, detail: W.piSpendDetail(g.productionIncreaseBudget), enabled: false, reason: W.piSpending }
        : { id: 'bank:pi', label: W.piSpend, detail: W.piSpendDetail(g.productionIncreaseBudget), enabled: true },
      inPi ? undefined : (): void => { this.piActive = true; this.mode = { k: 'pi' }; }));
    }
    return items;
  }

  /**
   * Why no teleporter can be placed now (in my Actions step), asked of the engine: none left, or
   * the price (the engine lists teleporters once the same state with plenty of materials does),
   * or no buffer of mine is free.
   */
  private teleporterReason(g: GameState, player: Player, price: number, worth: number): string {
    if (player.teleportersRemaining <= 0) return W.noTeleporters;
    if (!teleporterSpotFree(g, player.id)) return W.noFreeBuffer;
    // Otherwise the materials are the problem: paid with change, only their total value counts.
    return W.cantAfford(price, worth);
  }

  /** Plate, Sphere, Tesseract in my materials: pressing one offers to break it down, when the engine allows it. */
  private inventoryItems(b: Builder, g: GameState, player: Player, legal: readonly Action[], myTurn: boolean, pending: boolean): Item[] {
    const gate = this.gate(g, myTurn, pending, true);
    return (['plate', 'sphere', 'tesseract'] as const).map(give => {
      const a = ofType(legal, 'EXCHANGE_MATERIALS').find(x => x.give === give);
      const gets = (Object.entries(EXCHANGE_GETS[give]) as [Material, number][]).map(([m, n]) => amountOf(n, m)).join(' and ');
      const it: Item = a
        ? { id: `inv:${give}`, label: MATERIAL_NAME[give], detail: W.exchangeInvDetail(give, gets), enabled: true }
        : {
          id: `inv:${give}`, label: MATERIAL_NAME[give], enabled: false,
          reason: player.inventory[give] <= 0 ? W.exchangeNone(give) : gate ?? W.nothingHere,
        };
      return b.item(it, a ? (): void => this.setMode({ k: 'exchangeOne', give }) : undefined);
    });
  }

  private handItems(b: Builder, g: GameState, player: Player, legal: readonly Action[], myTurn: boolean, pending: boolean): PlayView['hand'] {
    const counts = new Map<CardType, number>();
    for (const c of player.hand) counts.set(c, (counts.get(c) ?? 0) + 1);
    const out: PlayView['hand'] = [];
    for (const [card, n] of counts) {
      const plays = ofType(legal, 'PLAY_CARD').filter(a => a.cardType === card);
      const enabled = plays.length > 0;
      let reason: string | undefined;
      if (!enabled) {
        if (pending) reason = W.decideFirst;
        else if (!myTurn) reason = W.notYourTurn;
        else if (g.phase === 'roundEnd' || g.phase === 'setupClaimPF' || g.phase === 'setupClaimPP') reason = W.cardOwnTurnOnly;
        else if (g.cardsPlayedThisTurn >= MAX_CARDS_PLAYED_PER_TURN) reason = W.cardsMaxed;
        else if (card === 'scoutingDrone' && g.phase === 'placePiece' && (g.drawnStackIndex ?? null) !== null) reason = W.droneBeforeDraw;
        else if (card === 'shortSale' && !player.controlModules.some(x => x >= g.mineCount)) reason = W.cardNoModule(g.mineCount);
        else if (card === 'rdTaxWriteOff' && player.teleportersRemaining <= 0) reason = W.cardNoTeleporters;
        else reason = W.cardNoTarget;
      }
      const it: Item = { id: `card:${card}`, label: W.cardCount(CARD_NAME[card], n), count: n, enabled, ...(reason ? { reason } : {}) };
      b.item(it, enabled ? (): void => this.setMode(card === 'scoutingDrone'
        ? { k: 'drone' }
        : { k: 'card', card, a: null, b: null, module: null, spot: null, whichOn: null }) : undefined);
      out.push({ ...it, card, text: CARD_TEXT[card] });
    }
    return out;
  }

  // ── Why not? ────────────────────────────────────────────────────────────────

  private inBeltMode(): boolean {
    const k = this.mode.k;
    return k === 'belt' || k === 'route';
  }

  /**
   * Why a belt cannot end at this point: ask the engine. With a start chosen, the belt (or route)
   * from it; otherwise a belt from this point to any other point of its piece, on the planning
   * state (so a missing belt in the supply is not the reason given).
   */
  private whyNotPoint(g: GameState, me: PlayerId, pieceId: string, point: number): string {
    if (g.phase !== 'actions') return W.nothingHere;
    const m = this.mode;
    if (m.k === 'belt' && m.start) {
      if (m.start.pieceId === pieceId) {
        const r = applyAction(planningStateOf(g, me), { type: 'PLACE_BELT', pieceId, fromPoint: m.start.position, toPoint: point });
        if (!r.ok) return refusalText(r.error);
      }
      return W.noRoute;
    }
    // Outside Lay a belt, a point where belts could start: say how to lay them.
    if (m.k !== 'belt' && m.k !== 'route' && routeEnds(g, me).some(p => p.pieceId === pieceId && p.position === point)) return W.layBeltFirst;
    const plan = planningStateOf(g, me);
    let first: string | null = null;
    for (const other of piecePoints(g, pieceId)) {
      if (other === point) continue;
      const r = applyAction(plan, { type: 'PLACE_BELT', pieceId, fromPoint: point, toPoint: other });
      if (r.ok) return W.nothingHere;
      // The reasons about this point come before ones about the other end.
      if (first === null && r.error.code !== 'POINTS_TOO_CLOSE' && r.error.code !== 'SAME_POINT') first = refusalText(r.error);
    }
    return first ?? W.noBeltEndsHere;
  }

  private whyNot(t: Target): string | null {
    const g = this.game, me = this.me;
    if (!g || me === null || g.gameOver) return null;
    if (g.pendingFactoryOps.some(e => e.ownerId === me)) return W.promptHint;
    if (activeId(g) !== me) return W.notYourTurn;
    // Several piles open: anything but a pile waits for the draw.
    if (t.kind !== 'stack' && g.phase === 'placePiece' && legalFor(g, me).some(a => a.type === 'DRAW_PIECE')) return W.drawFirst;
    switch (t.kind) {
      case 'cell':
        if (g.phase === 'placePiece' && legalFor(g, me).some(a => a.type === 'DRAW_PIECE')) return W.drawFirst;
        if (g.phase === 'placeMeeple' && legalFor(g, me).some(a => a.type === 'PLACE_MEEPLE')) return W.meepleOffTarget;
        return this.mode.k === 'place' || g.phase === 'placePiece' ? W.notAdjacent : W.nothingHere;
      case 'stack': {
        const s = g.stacks[t.index as 0 | 1 | 2];
        if (!s) return W.nothingHere;
        if (!s.available) return W.stackLocked;
        if (s.pieces.length === 0) return W.stackEmpty;
        const drawn = g.drawnStackIndex ?? null;
        if (g.phase === 'placePiece' && drawn !== null && drawn !== t.index) return W.notDrawnPile(drawn + 1);
        if (g.phase !== 'placePiece') return W.pileNotNow;
        // The face-up piece of the pile in play: say what it is and where it goes.
        const top = s.pieces[0];
        if (top && revealedStackOf(g) === t.index && legalFor(g, me).some(a => a.type === 'PLACE_PIECE')) return W.pileTopPlace(pieceName(top.type));
        return W.nothingHere;
      }
      case 'piece': case 'buffer': case 'mineSlot': {
        // In a belt mode a tap there was meant for a connection point: explain the point.
        if (this.inBeltMode()) return t.kind === 'buffer' ? W.bufferNoBelt : W.noBeltEndsHere;
        // A building with only greyed-out entries (the meeple's building that already ran): say why.
        const greyed = this.menuReason(g, me, t.pieceId);
        if (greyed) return greyed;
        const piece = pieceById(g, t.pieceId);
        if (piece && piece.claims.length > 0 && !piece.claims.some(c => c.ownerId === me)) return W.notYourBuilding;
        // My building with a Control Module that cannot be rolled: say so.
        const skipped = piece ? skippedNote(g, me, piece) : null;
        if (skipped) return skipped;
        return W.nothingHere;
      }
      case 'belt': {
        const belt = g.belts.find(x => x.id === t.beltId);
        return belt && belt.ownerId !== me ? W.notYourBelt : W.nothingHere;
      }
      case 'point': return this.whyNotPoint(g, me, t.pieceId, t.point);
      // The deck: the same reason the bank's Leverage card gives (empty deck, price, not now).
      case 'deck': return this.current.reasons.get('bank:buyCard')
        ?? (legalFor(g, me).some(a => a.type === 'BUY_CARD') ? W.deckFinishFirst : W.nothingHere);
    }
  }
}

// ── Module-level helpers ──────────────────────────────────────────────────────

/** The belt points of a piece's template (config data), to ask the engine about a tapped point. */
function piecePoints(g: GameState, pieceId: string): number[] {
  const piece = g.board.find(p => p.id === pieceId);
  if (!piece) return [];
  return pieceTemplate(piece).points.filter(d => d.enabled && d.role === 'belt').map(d => d.position);
}

function stepIndexOf(g: GameState): 1 | 2 | 3 | 4 | null {
  switch (g.phase) {
    case 'placePiece': return 1;
    case 'roll': return 2;
    case 'actions': return 3;
    case 'placeMeeple': return 4;
    default: return null;
  }
}

/** The menu line for my building when some of my Control Modules on it cannot be rolled; null otherwise. */
function skippedNote(g: GameState, me: PlayerId, piece: BoardPiece): string | null {
  const mine = piece.claims.filter(c => c.ownerId === me).map(c => c.controlModule);
  const skipped = mine.filter(m => moduleBelowFloor(m, g.mineCount)).sort((x, y) => x - y);
  if (skipped.length === 0) return null;
  return W.moduleSkippedOnBuilding(skipped, g.mineCount, skipped.length < mine.length);
}

/**
 * My 18 Control Modules: on the board, in the tray, or in the tray but skipped (below the number
 * of Mines in play, moduleBelowFloor). A skipped module's tap says why (its reason in `b`).
 */
function baseTray(b: Builder, player: Player, mineCount: number): TrayEntry[] {
  const inTray = new Set(player.controlModules);
  return Array.from({ length: CONTROL_MODULE_MAX }, (_, i): TrayEntry => {
    const module = i + 1;
    if (!inTray.has(module)) return { module, state: 'onBoard' };
    if (!moduleBelowFloor(module, mineCount)) return { module, state: 'inTray' };
    b.item({ id: `module:${module}`, label: '', enabled: false, reason: W.moduleSkipped(module, mineCount) });
    return { module, state: 'skipped', label: W.moduleSkippedLabel(module, mineCount) };
  });
}

/**
 * " · You keep 1 Plate and 2 Ore" when paying `prices` (one purchase each, with change) gives
 * change back; empty when it is paid with exactly what is handed in, or cannot be paid.
 */
export function keepText(player: Player, prices: readonly number[]): string {
  const k = keptAfter(player, prices);
  return k ? W.payKeep(k.kept, k.lost) : '';
}

/** What paying `prices` with change leaves, in words ("1 Plate and 2 Ore"); null when no change comes back. */
function keptAfter(player: Player, prices: readonly number[]): { kept: string; lost: number } | null {
  const pay = paymentWithChange(player.inventory, prices);
  if (!pay) return null;
  const held = [...MATERIALS].reverse().filter(m => pay.kept[m] > 0).map(m => amountOf(pay.kept[m], m));
  const kept = held.length === 0 ? 'nothing'
    : held.length === 1 ? held[0]! : `${held.slice(0, -1).join(', ')} and ${held[held.length - 1]!}`;
  return { kept, lost: pay.lost };
}

function runBlockText(why: string, need: number, have: number): string {
  switch (why) {
    case 'alreadyRan': return W.alreadyRan;
    case 'powerFull': return W.powerFull;
    case 'outputFull': return W.outputFull;
    case 'loadFirst': return W.loadFirst;
    case 'badRecipe': return W.badRecipe;
    case 'needPower': return W.needPower(need, have);
    default: return W.nothingHere;
  }
}
