// What to show between two game states: a list of timed animation steps, worked out from the
// table events the host sent with the move (the dice, which buildings activated, what was
// operated, collected, bought, played) and from the difference between the two states.
// Pure and DOM-free. It decides nothing about the rules; the engine already applied the move.
//
// Times are milliseconds at Normal speed. The playback queue scales them (Fast, compression).
// Steps fall in phases that follow the physical turn: dice -> activation pulses -> pieces placed
// -> modules, belts, teleporters, meeples -> operating (power in, inputs used, product out) ->
// material flowing along belts -> material, Power Tokens and cards going to the players.

import type { CardType, Material } from '../engine/config';
import type { BoardPiece, GameState, PlayerId } from '../engine/state';
import { directFlowAllowed, teleporterCutsOff } from '../engine/rules/flow';
import { supplySlots, teleporterOn, teleportersOf } from '../engine/rules/teleporters';
import type { TableEvent } from '../session/room';
import { traceFlow, pathLength, sourceWorld, type FlowSource } from './flowPath';
import { bufferSlotWorld, type XZ } from './layout';
import type { Target } from './types';

export type Buf = 'input' | 'output';
/** Something carried to or from a player's area (drawn over the table as a small token). */
export type Carried = Material | 'power' | 'card' | 'module' | 'teleporter';

export type StepBody =
  /** Dice tumble onto the table and land on these values (one die per mine). */
  | { kind: 'dice'; values: readonly number[] }
  /** A ring pulses on a piece the roll activated, in the owner's colour (null: no owner, e.g. a mine). */
  | { kind: 'pulse'; pieceId: string; owner: number | null }
  /** A new piece travels from its stack (null: from above the board) to its cell, turning into its rotation. */
  | { kind: 'place'; pieceId: string; stack: number | null }
  /** A belt is laid (drops onto its tile). */
  | { kind: 'belt'; beltId: string }
  /** A Control Module drops onto a building: claim (new) or upgrade (number changed). */
  | { kind: 'module'; pieceId: string; index: number; owner: number; upgrade: boolean }
  /** A teleporter appears on one input (`slot`, #55) or on the output (slot 0) of a building. */
  | { kind: 'teleporter'; pieceId: string; buffer: Buf; slot: number; owner: number }
  /**
   * A material slides from `from` to `to` (world mm) within its own buffer slot: it moves aside
   * on its stub as a teleporter lands there (layout.ts teleportedMaterialWorld), or back when one
   * leaves while the material stays.
   */
  | { kind: 'slide'; pieceId: string; buffer: Buf; slot: number; material: Material; from: XZ; to: XZ }
  /** A meeple walks (or drops) onto its piece. */
  | { kind: 'meeple'; player: number; fromPieceId: string | null; fromSlot: number | null }
  /** A material travels along `path` (world mm) into input `slot` of `toPieceId`. */
  | { kind: 'flow'; material: Material; path: readonly XZ[]; toPieceId: string; slot: number; fromPieceId: string | null }
  /**
   * A material in a buffer is used up (shrinks away). `late`: it was not there before the step
   * (it came out of a Teleporter's portal just now), so it is not drawn before the step starts.
   */
  | { kind: 'consume'; pieceId: string; buffer: Buf; slot: number; material: Material; late?: boolean }
  /** A material supplied through the Teleporter on input `slot` comes out of its portal and settles in that input. */
  | { kind: 'portalIn'; pieceId: string; slot: number; material: Material }
  /** A product goes from the output into the portal of the Teleporter on the output (on its way to the owner's materials). */
  | { kind: 'portalOut'; pieceId: string; material: Material }
  /** A material leaves a buffer for good, lifting away (to a player, or to the bank when the building lost its owner). */
  | { kind: 'leave'; pieceId: string; buffer: Buf; slot: number; material: Material }
  /** A piece leaves the board (Sink Hole): drawn from the state before, it lifts and shrinks away. */
  | { kind: 'remove'; pieceId: string }
  /** A belt leaves the board (picked up, taken back, or with its piece): it lifts and shrinks away. */
  | { kind: 'unbelt'; beltId: string }
  /** A Teleporter leaves a building (back to its owner): it lifts and shrinks away. */
  | { kind: 'unteleport'; pieceId: string; buffer: Buf; slot: number; owner: number }
  /**
   * A Control Module leaves a building (index in the claims before): it lifts away. With `toPieceId`
   * it travels to that building instead, landing as claim `toIndex` there (Changing Priorities).
   */
  | { kind: 'unmodule'; pieceId: string; index: number; owner: number; module: number; toPieceId: string | null; toIndex: number }
  /** A material appears in a buffer (a product, or anything whose source is not known). */
  | { kind: 'appear'; pieceId: string; buffer: Buf; slot: number; material: Material }
  /** Tokens fly from the table to a player's area (drawn by the interface over the canvas). */
  | { kind: 'toPlayer'; player: number; item: Carried; count: number; from: Target | null; card?: CardType | null }
  /** Tokens fly from a player's area onto the table. */
  | { kind: 'fromPlayer'; player: number; item: Carried; count: number; to: Target | null; card?: CardType | null };

export type AnimStep = StepBody & { readonly at: number; readonly dur: number };

export interface TransitionPlan {
  readonly steps: readonly AnimStep[];
  /** Length of the whole transition at Normal speed. */
  readonly baseMs: number;
  /** The transition includes a dice roll (its values). */
  readonly roll: readonly number[] | null;
}

/** Steps the 3D table draws; the rest (toPlayer, fromPlayer) are drawn by the interface. */
export function isTableStep(s: AnimStep): boolean {
  return s.kind !== 'toPlayer' && s.kind !== 'fromPlayer';
}

// ── Durations at Normal speed (ms) ─────────────────────────────────────────────────────────────
export const DUR = {
  dice: 760,
  pulse: 560,
  place: 520,
  belt: 260,
  beltGap: 150,
  module: 420,
  teleporter: 380,
  slide: 380,
  meeple: 450,
  consume: 300,
  appear: 320,
  flowMin: 380,
  flowMax: 760,
  flight: 560,
  flightGap: 90,
  /** Material coming out of, or going into, a Teleporter's portal. */
  portal: 420,
  /** Material, a piece, a belt, a Teleporter or a Control Module leaving the table. */
  leave: 420,
  remove: 520,
  /** A Control Module travelling from one building to another. */
  moduleMove: 560,
  /** Phases overlap by this much so the table never sits still between them. */
  overlap: 80,
  /** A phase with many items spreads them over at most this long. */
  spread: 700,
} as const;

const MATS: readonly Material[] = ['ore', 'plate', 'sphere', 'tesseract'];
const MAX_TOKENS = 6;

interface Slot { pieceId: string; buffer: Buf; slot: number; material: Material }

/**
 * The phases of a transition, in order. A phase with nothing in it takes no time, so a move with
 * no removal and no Teleporter supply plays exactly as before these phases existed.
 *   REMOVE: pieces and belts leaving the board (Sink Hole, a belt picked up).
 *   SUPPLY: materials flying from a player's area to the portal of their input Teleporter.
 *   EMERGE: those materials coming out of the portal into the input.
 */
const PHASE = {
  P_DICE: 0, P_PULSE: 1, P_REMOVE: 2, P_PLACE: 3, P_BUILD: 4, P_SUPPLY: 5, P_EMERGE: 6, P_OPERATE: 7, P_FLOW: 8, P_PLAYER: 9,
} as const;
const PHASES = 10;

/** Plan the animation of one accepted move (or a burst of them) from `prev` to `next`. */
export function planTransition(prev: GameState, next: GameState, events: readonly TableEvent[]): TransitionPlan {
  const phases: StepBody[][] = Array.from({ length: PHASES }, () => []);
  const { P_DICE, P_PULSE, P_REMOVE, P_PLACE, P_BUILD, P_SUPPLY, P_EMERGE, P_OPERATE, P_FLOW, P_PLAYER } = PHASE;

  // ── Dice and activation ──
  let roll: number[] | null = null;
  for (const e of events) if (e.kind === 'roll') roll = [...e.dice];
  if (!roll && prev.phase === 'roll' && next.lastRoll && JSON.stringify(next.lastRoll) !== JSON.stringify(prev.lastRoll)) {
    roll = [...next.lastRoll];
  }
  if (roll) phases[P_DICE]!.push({ kind: 'dice', values: roll });
  const pulsed = new Set<string>();
  const usedPower = new Map<number, number>();
  for (const e of events) {
    if (e.kind !== 'activated') continue;
    const key = `${e.pieceId}:${e.seat}`;
    if (pulsed.has(key)) continue;
    pulsed.add(key);
    phases[P_PULSE]!.push({ kind: 'pulse', pieceId: e.pieceId, owner: e.seat });
    if (e.outcome === 'power' && e.amount > 0) {
      phases[P_PLAYER]!.push({ kind: 'toPlayer', player: e.seat, item: 'power', count: e.amount, from: { kind: 'piece', pieceId: e.pieceId } });
      usedPower.set(e.seat, (usedPower.get(e.seat) ?? 0) + e.amount);
    }
  }

  // ── Pieces placed ──
  const before = new Map(prev.board.map(p => [p.id, p]));
  for (const p of next.board) {
    if (before.has(p.id)) continue;
    let stack: number | null = null;
    prev.stacks.forEach((s, i) => { if (s.pieces.some(x => x.id === p.id)) stack = i; });
    if (p.type === 'mine') {
      const n = Number(/(\d+)$/.exec(p.id)?.[1] ?? '0');
      if (n >= 2 && n <= 3) stack = n - 1;
    }
    phases[P_PLACE]!.push({ kind: 'place', pieceId: p.id, stack });
  }

  // Buildings that used their inputs: those may be refilled with the same material at once
  // (ore from a mine), which the state difference alone would hide.
  const used = new Set<string>();
  for (const e of events) {
    if (e.kind === 'operated' || (e.kind === 'activated' && e.outcome === 'power')) used.add(e.pieceId);
  }

  // ── Pieces and belts leaving the board, Control Modules leaving a building ──
  const after = new Map(next.board.map(p => [p.id, p]));
  for (const p of prev.board) if (!after.has(p.id)) phases[P_REMOVE]!.push({ kind: 'remove', pieceId: p.id });
  const newBelts = new Set(next.belts.map(b => b.id));
  for (const b of prev.belts) if (!newBelts.has(b.id)) phases[P_REMOVE]!.push({ kind: 'unbelt', beltId: b.id });
  // Control Modules that left a building: to another building of the same player (the same
  // module, newly there), or away (back to the tray).
  const arrivals = next.board.flatMap(p => claimsChange(before.get(p.id), p).added.filter(a => !a.upgrade).map(a => ({ pieceId: p.id, ...a })));
  const moved = new Set<string>();
  for (const p of prev.board) {
    const now = after.get(p.id);
    if (!now) continue;
    for (const g of claimsChange(p, now).gone) {
      const to = arrivals.find(a => a.owner === g.owner && a.module === g.module && a.pieceId !== p.id && !moved.has(`${a.pieceId}:${a.index}`));
      if (to) moved.add(`${to.pieceId}:${to.index}`);
      phases[P_BUILD]!.push({ kind: 'unmodule', pieceId: p.id, index: g.index, owner: g.owner, module: g.module, toPieceId: to?.pieceId ?? null, toIndex: to?.index ?? 0 });
      if (!to) phases[P_PLAYER]!.push({ kind: 'toPlayer', player: g.owner, item: 'module', count: 1, from: { kind: 'piece', pieceId: p.id } });
    }
  }

  // ── Modules, teleporters, meeples, belts ──
  for (const p of next.board) {
    const old = before.get(p.id);
    // Material that stays in its slot but moves aside (a teleporter lands on its stub, or leaves):
    // it slides there instead of jumping, in the phase before, so the teleporter lands on a clear stub.
    if (old) {
      for (const b of ['input', 'output'] as const) {
        (p[b]?.slots ?? []).forEach((m, i) => {
          if (!m || old[b]?.slots[i] !== m || (b === 'input' && used.has(p.id))) return;
          const from = bufferSlotWorld(old, b, i), to = bufferSlotWorld(p, b, i);
          if (Math.hypot(to.x - from.x, to.z - from.z) > 0.5) phases[P_PLACE]!.push({ kind: 'slide', pieceId: p.id, buffer: b, slot: i, material: m, from, to });
        });
      }
    }
    for (const { index, owner, upgrade } of claimsChange(old, p).added) {
      // A module that arrives from another building travels there itself (unmodule below).
      if (moved.has(`${p.id}:${index}`)) continue;
      phases[P_BUILD]!.push({ kind: 'module', pieceId: p.id, index, owner, upgrade });
    }
    for (const b of ['input', 'output'] as const) {
      for (const { slot, owner } of teleportersOf(p[b])) {
        if (owner !== teleporterOn(old?.[b], slot)) phases[P_BUILD]!.push({ kind: 'teleporter', pieceId: p.id, buffer: b, slot, owner });
      }
      // A Teleporter that left (its owner lost the building): it lifts away and goes back to them.
      if (!old) continue;
      for (const { slot, owner } of teleportersOf(old[b])) {
        if (teleporterOn(p[b], slot) === owner) continue;
        phases[P_OPERATE]!.push({ kind: 'unteleport', pieceId: p.id, buffer: b, slot, owner });
        phases[P_PLAYER]!.push({ kind: 'toPlayer', player: owner, item: 'teleporter', count: 1, from: { kind: 'buffer', pieceId: p.id, buffer: b, slot, portal: true } });
      }
    }
  }
  for (const pl of next.players) {
    const was = prev.players[pl.id];
    if (!pl.meepleOnPieceId) continue;
    if (was && was.meepleOnPieceId === pl.meepleOnPieceId && was.meepleSlotIndex === pl.meepleSlotIndex) continue;
    phases[P_BUILD]!.push({ kind: 'meeple', player: pl.id, fromPieceId: was?.meepleOnPieceId ?? null, fromSlot: was?.meepleSlotIndex ?? null });
  }
  const oldBelts = new Set(prev.belts.map(b => b.id));
  for (const b of next.belts) if (!oldBelts.has(b.id)) phases[P_BUILD]!.push({ kind: 'belt', beltId: b.id });

  // ── Materials in buffers, inventories, power ──
  const filled: Slot[] = [];
  const emptied: Slot[] = [];
  for (const p of next.board) {
    const old = before.get(p.id);
    for (const b of ['input', 'output'] as const) {
      const a = old?.[b]?.slots ?? [];
      const z = p[b]?.slots ?? [];
      for (let i = 0; i < Math.max(a.length, z.length); i++) {
        const was = a[i] ?? null, now = z[i] ?? null;
        if (was === now && !(b === 'input' && used.has(p.id))) continue;
        if (was) emptied.push({ pieceId: p.id, buffer: b, slot: i, material: was });
        if (now) filled.push({ pieceId: p.id, buffer: b, slot: i, material: now });
      }
    }
  }
  // Inventory change per player and material (positive: gained), and power.
  const inv = next.players.map(pl => {
    const was = prev.players[pl.id];
    const d: Record<Material, number> = { ore: 0, plate: 0, sphere: 0, tesseract: 0 };
    for (const m of MATS) d[m] = pl.inventory[m] - (was?.inventory[m] ?? 0);
    return { d, power: pl.powerTokens - (was?.powerTokens ?? 0) - (usedPower.get(pl.id) ?? 0) };
  });
  const take = (player: number, m: Material, n: number): boolean => {
    const d = inv[player]?.d;
    if (!d || Math.sign(d[m]) !== Math.sign(n) || Math.abs(d[m]) < Math.abs(n)) return false;
    d[m] -= n;
    return true;
  };
  const takeSlot = (list: Slot[], fn: (s: Slot) => boolean): Slot | null => {
    const i = list.findIndex(fn);
    return i < 0 ? null : list.splice(i, 1)[0]!;
  };

  // Operated buildings: power goes in, inputs are used, the product appears (or is teleported).
  for (const e of events) {
    if (e.kind !== 'operated') continue;
    const piece = { kind: 'piece' as const, pieceId: e.pieceId };
    if (e.powerChange < 0) {
      phases[P_OPERATE]!.push({ kind: 'fromPlayer', player: e.seat, item: 'power', count: -e.powerChange, to: piece });
      const x = inv[e.seat];
      if (x) x.power -= e.powerChange;
    }
    for (let s = takeSlot(emptied, x => x.pieceId === e.pieceId && x.buffer === 'input'); s; s = takeSlot(emptied, x => x.pieceId === e.pieceId && x.buffer === 'input')) {
      phases[P_OPERATE]!.push({ kind: 'consume', ...s });
    }
    // Inputs completed from the operator's own materials through their input Teleporters: each
    // material flies to the portal of its input, comes out of it into the input, and is used up
    // with the rest. The engine fills the empty inputs with the operator's Teleporter in order,
    // with the supply in material order (production.ts withSupply), so the same is done here.
    const was = before.get(e.pieceId);
    const supplied: Material[] = [];
    for (const m of MATS) {
      const lost = inv[e.seat]?.d[m] ?? 0;
      if (lost < 0 && take(e.seat, m, lost)) for (let k = 0; k < -lost; k++) supplied.push(m);
    }
    const into = was ? supplySlots(was, e.seat as PlayerId) : [];
    supplied.forEach((m, k) => {
      const slot = into[k];
      if (slot === undefined) {
        phases[P_OPERATE]!.push({ kind: 'fromPlayer', player: e.seat, item: m, count: 1, to: { kind: 'buffer', pieceId: e.pieceId, buffer: 'input' } });
        return;
      }
      phases[P_SUPPLY]!.push({ kind: 'fromPlayer', player: e.seat, item: m, count: 1, to: { kind: 'buffer', pieceId: e.pieceId, buffer: 'input', slot, portal: true } });
      phases[P_EMERGE]!.push({ kind: 'portalIn', pieceId: e.pieceId, slot, material: m });
      phases[P_OPERATE]!.push({ kind: 'consume', pieceId: e.pieceId, buffer: 'input', slot, material: m, late: true });
    });
    if (e.product) {
      if (e.teleported) {
        // Into the portal on the output, then to the owner's materials.
        const owner = teleporterOn(next.board.find(p => p.id === e.pieceId)?.output) ?? e.seat;
        if (take(owner, e.product, 1)) {
          phases[P_OPERATE]!.push({ kind: 'portalOut', pieceId: e.pieceId, material: e.product });
          phases[P_PLAYER]!.push({ kind: 'toPlayer', player: owner, item: e.product, count: 1, from: { kind: 'buffer', pieceId: e.pieceId, buffer: 'output', slot: 0, portal: true } });
        }
      } else {
        const s = takeSlot(filled, x => x.pieceId === e.pieceId && x.buffer === 'output');
        if (s) phases[P_OPERATE]!.push({ kind: 'appear', ...s });
      }
    }
  }
  // Collected output goes to the player.
  for (const e of events) {
    if (e.kind !== 'collected') continue;
    for (const m of e.materials) {
      takeSlot(emptied, x => x.pieceId === e.pieceId && x.buffer === 'output' && x.material === m);
      if (take(e.seat, m, 1)) phases[P_PLAYER]!.push({ kind: 'toPlayer', player: e.seat, item: m, count: 1, from: { kind: 'piece', pieceId: e.pieceId } });
    }
  }
  // Inputs filled: along belts from an emptied output or a mine, or from a player's materials.
  const mines = next.board.filter(p => p.type === 'mine');
  const flowFrom = (s: Slot, sources: readonly FlowSource[], straight: boolean): boolean => {
    if (sources.length === 0) return false;
    const trace = traceFlow(next, s.pieceId, s.slot, sources);
    if (!trace && !straight) return false;
    const source = sources[trace?.source ?? nearest(next, sources, s)]!;
    const from = sourceWorld(next, source);
    const dest = next.board.find(p => p.id === s.pieceId);
    const path = trace?.points ?? (from && dest ? [from, bufferSlotWorld(dest, 'input', s.slot)] : []);
    if (path.length < 2) return false;
    takeSlot(filled, x => x === s);
    phases[P_FLOW]!.push({ kind: 'flow', material: s.material, path, toPieceId: s.pieceId, slot: s.slot, fromPieceId: source.pieceId });
    return true;
  };
  const mineSources: FlowSource[] = mines.map(m => ({ pieceId: m.id, kind: 'mine' as const, slot: 0 }));
  for (const s of [...filled]) {
    if (s.buffer !== 'input') continue;
    // From another building's output that emptied: the material clearly moved from there — but
    // only out of a building whose output may pass into this one (one of
    // the same player's: the engine's rule, directFlowAllowed; RULES_CHANGES.md #51).
    const destPiece = next.board.find(p => p.id === s.pieceId);
    const src = emptied.find(x => {
      if (x.buffer !== 'output' || x.material !== s.material || x.pieceId === s.pieceId) return false;
      const from = next.board.find(p => p.id === x.pieceId);
      // A teleporter cuts its buffer off (#53): a teleported output empties only to its owner.
      return !!from && !!destPiece && directFlowAllowed(from, destPiece) &&
        !teleporterCutsOff(from, 'output') && !teleporterCutsOff(destPiece, 'input', s.slot);
    });
    if (src && flowFrom(s, [{ pieceId: src.pieceId, kind: 'output', slot: src.slot }], true)) {
      takeSlot(emptied, x => x === src);
      continue;
    }
    // Ore from a mine that touches the input, directly or by belts.
    if (s.material === 'ore' && flowFrom(s, mineSources, false)) continue;
    // Loaded from a player's materials.
    const loader = next.players.find(pl => (inv[pl.id]?.d[s.material] ?? 0) < 0);
    if (loader && take(loader.id, s.material, -1)) {
      takeSlot(filled, x => x === s);
      phases[P_OPERATE]!.push({ kind: 'fromPlayer', player: loader.id, item: s.material, count: 1, to: { kind: 'buffer', pieceId: s.pieceId, buffer: 'input' } });
      continue;
    }
    // Ore from somewhere unseen: from the nearest mine.
    if (s.material === 'ore') flowFrom(s, mineSources, true);
  }
  // Output emptied while a player gained that material (an output teleporter, or a collect).
  for (const s of [...emptied]) {
    if (s.buffer !== 'output') continue;
    const gainer = next.players.find(pl => (inv[pl.id]?.d[s.material] ?? 0) > 0);
    if (gainer && take(gainer.id, s.material, 1)) {
      takeSlot(emptied, x => x === s);
      // Through the gainer's Teleporter on that output, or lifted out of it (Asset Forfeiture, Personal Jet Pack).
      const throughPortal = teleporterOn(after.get(s.pieceId)?.output) === gainer.id;
      phases[P_OPERATE]!.push(throughPortal
        ? { kind: 'portalOut', pieceId: s.pieceId, material: s.material }
        : { kind: 'leave', ...s });
      phases[P_PLAYER]!.push({
        kind: 'toPlayer', player: gainer.id, item: s.material, count: 1,
        from: throughPortal ? { kind: 'buffer', pieceId: s.pieceId, buffer: 'output', slot: 0, portal: true } : { kind: 'piece', pieceId: s.pieceId },
      });
    }
  }
  for (const s of filled) phases[P_FLOW]!.push({ kind: 'appear', ...s });
  // Material used up where it lay; a building that lost its owner sends its material to the bank: it lifts away.
  const ownerless = (id: string): boolean => (before.get(id)?.claims.length ?? 0) > 0 && (after.get(id)?.claims.length ?? 0) === 0;
  for (const s of emptied) phases[P_OPERATE]!.push(ownerless(s.pieceId) ? { kind: 'leave', ...s } : { kind: 'consume', ...s });
  // Anything else a player gained (meeple benefits, exchanges, cards) comes from the table.
  for (const pl of next.players) {
    const x = inv[pl.id]!;
    for (const m of MATS) if (x.d[m] > 0) phases[P_PLAYER]!.push({ kind: 'toPlayer', player: pl.id, item: m, count: x.d[m], from: null });
    if (x.power > 0) phases[P_PLAYER]!.push({ kind: 'toPlayer', player: pl.id, item: 'power', count: x.power, from: null });
  }

  // ── Leverage cards ──
  const played = new Map<number, CardType[]>();
  for (const e of events) if (e.kind === 'cardPlayed') played.set(e.seat, [...(played.get(e.seat) ?? []), e.card]);
  const bought = new Map<number, (CardType | null)[]>();
  for (const e of events) if (e.kind === 'cardBought') bought.set(e.seat, [...(bought.get(e.seat) ?? []), e.card]);
  for (const pl of next.players) {
    const was = prev.players[pl.id];
    const b = bought.get(pl.id) ?? [];
    const gained = Math.max(b.length, pl.hand.length - (was?.hand.length ?? 0));
    if (gained > 0) {
      phases[P_PLACE]!.push({ kind: 'toPlayer', player: pl.id, item: 'card', count: gained, from: { kind: 'deck' }, card: b[0] ?? null });
    }
    const p = played.get(pl.id) ?? [];
    for (const c of p) phases[P_PULSE]!.push({ kind: 'fromPlayer', player: pl.id, item: 'card', count: 1, to: { kind: 'deck' }, card: c });
  }

  return schedule(phases, roll);
}

interface ClaimsChange {
  /** Claims now on the building that were not before (index in the claims now). `upgrade`: it replaced a lower module of the same player. */
  readonly added: readonly { index: number; owner: number; module: number; upgrade: boolean }[];
  /** Claims that left the building (index in the claims before), not counting a module replaced by an upgrade. */
  readonly gone: readonly { index: number; owner: number; module: number }[];
}

/** How a building's Control Modules changed between two states (compared as owner and number, not by position). */
function claimsChange(old: BoardPiece | undefined, now: BoardPiece): ClaimsChange {
  const was = (old?.claims ?? []).map((c, i) => ({ owner: c.ownerId as number, module: c.controlModule, index: i, used: false }));
  const fresh: { index: number; owner: number; module: number }[] = [];
  now.claims.forEach((c, i) => {
    const same = was.find(w => !w.used && w.owner === c.ownerId && w.module === c.controlModule);
    if (same) same.used = true;
    else fresh.push({ index: i, owner: c.ownerId, module: c.controlModule });
  });
  const added = fresh.map(f => {
    // An upgrade swaps a module of the same player on this building for a higher one (at the same place if it can).
    const lower = was.find(w => !w.used && w.owner === f.owner && w.index === f.index && w.module < f.module)
      ?? was.find(w => !w.used && w.owner === f.owner && w.module < f.module);
    if (lower) lower.used = true;
    return { ...f, upgrade: !!lower };
  });
  return { added, gone: was.filter(w => !w.used).map(({ index, owner, module }) => ({ index, owner, module })) };
}

function nearest(game: GameState, sources: readonly FlowSource[], s: Slot): number {
  const dest = game.board.find(p => p.id === s.pieceId);
  if (!dest) return 0;
  const d = bufferSlotWorld(dest, 'input', s.slot);
  let best = 0, bestD = Infinity;
  sources.forEach((src, i) => {
    const p = sourceWorld(game, src);
    if (!p) return;
    const dd = Math.hypot(p.x - d.x, p.z - d.z);
    if (dd < bestD) { bestD = dd; best = i; }
  });
  return best;
}

function durationOf(s: StepBody): number {
  switch (s.kind) {
    case 'dice': return DUR.dice;
    case 'pulse': return DUR.pulse;
    case 'place': return DUR.place;
    case 'belt': return DUR.belt;
    case 'module': return DUR.module;
    case 'teleporter': return DUR.teleporter;
    case 'slide': return DUR.slide;
    case 'meeple': return DUR.meeple;
    case 'consume': return DUR.consume;
    case 'appear': return DUR.appear;
    case 'portalIn': case 'portalOut': return DUR.portal;
    case 'leave': case 'unbelt': case 'unteleport': return DUR.leave;
    case 'remove': return DUR.remove;
    case 'unmodule': return s.toPieceId ? DUR.moduleMove : DUR.leave;
    case 'flow': return Math.max(DUR.flowMin, Math.min(DUR.flowMax, 300 + pathLength(s.path) * 1.6));
    case 'toPlayer':
    case 'fromPlayer': return DUR.flight + DUR.flightGap * (Math.min(MAX_TOKENS, s.count) - 1);
  }
}

/** Gap between the starts of consecutive items in one phase. */
function gapOf(s: StepBody): number {
  switch (s.kind) {
    case 'belt': return DUR.beltGap;
    case 'dice': return 0;
    case 'pulse': return 70;
    case 'flow': return 110;
    default: return 90;
  }
}

/** Lay the phases out one after another (overlapping a little); items in a phase are staggered. */
function schedule(phases: StepBody[][], roll: number[] | null): TransitionPlan {
  const steps: AnimStep[] = [];
  let end = 0;
  let flowStart = -1;
  phases.forEach((list, pi) => {
    if (list.length === 0) return;
    // Pulses start as the dice land; things going to the players travel at the same time as
    // material flows along the belts.
    const start = pi === PHASE.P_PULSE && roll ? Math.max(0, DUR.dice - 120)
      : pi === PHASE.P_PLAYER && flowStart >= 0 ? flowStart
        : steps.length > 0 ? Math.max(0, end - DUR.overlap) : 0;
    if (pi === PHASE.P_FLOW) flowStart = start;
    const n = list.length;
    let at = start;
    let phaseEnd = start;
    for (let i = 0; i < n; i++) {
      const s = list[i]!;
      const gap = Math.min(gapOf(s), n > 1 ? DUR.spread / (n - 1) : 0);
      const dur = durationOf(s);
      steps.push({ ...s, at: Math.round(at), dur: Math.round(dur) } as AnimStep);
      phaseEnd = Math.max(phaseEnd, at + dur);
      at += gap;
    }
    end = Math.max(end, phaseEnd);
  });
  return { steps, baseMs: Math.round(end), roll };
}

/** Sound cue of a step, if it has one (played when the step starts). */
export type SoundName = 'dice' | 'place' | 'belt' | 'tick' | 'card' | 'turn' | 'alert' | 'refuse' | 'over';

export function soundOf(s: AnimStep): SoundName | null {
  switch (s.kind) {
    case 'dice': return 'dice';
    case 'place': case 'module': case 'meeple': case 'teleporter': return 'place';
    case 'belt': return 'belt';
    case 'flow': case 'appear': case 'portalIn': case 'portalOut': return 'tick';
    case 'toPlayer': case 'fromPlayer': return s.item === 'card' ? 'card' : 'tick';
    default: return null;
  }
}
