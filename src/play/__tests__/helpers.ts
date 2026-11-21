// Test fixtures for the play controller: a seeded game driver that reaches every phase and
// sub-state, and a gesture driver that makes a controller send a given action using only
// what its view offers.

import { expect } from 'vitest';
import type { Action } from '../../engine/actions';
import type { GameState, PlayerId } from '../../engine/state';
import { applyAction, createGame, legalActions } from '../../engine';
import { PlayController } from '../controller';
import { targetKey } from '../controller';
import type { PlayView } from '../types';
import type { Target } from '../../table/types';
import { actionKey } from '../info';

// ── Seeded randomness ─────────────────────────────────────────────────────────

export class Rand {
  private s: number;
  constructor(seed: number) { this.s = (seed * 2654435761) >>> 0; }
  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  int(n: number): number { return Math.floor(this.next() * n); }
  pick<T>(xs: readonly T[]): T { return xs[this.int(xs.length)]!; }
}

export const ALL_ACTION_TYPES: readonly Action['type'][] = [
  'SETUP_CLAIM', 'PLACE_PIECE', 'ROLL_DICE', 'END_ACTIONS', 'PLACE_MEEPLE', 'END_TURN', 'PLACE_BELT',
  'REMOVE_BELT', 'UNDO_BELTS', 'PLACE_TELEPORTER', 'CLAIM_BUILDING', 'UPGRADE_BUILDING', 'BUY_MINE',
  'PLACE_MINE', 'BUY_CARD', 'PLAY_CARD', 'PLACE_OVERSTOCK_PIECE', 'BUY_BELT', 'LOAD_BUILDING_INPUT',
  'OPERATE_BUILDING', 'COLLECT_OUTPUT', 'SKIP_FACTORY_ROLL', 'EXCHANGE_MATERIALS',
];

export const active = (s: GameState): PlayerId => s.turnOrder[s.activePlayerIndex]!;

/** Who may act now: the active player and every owner of a pending factory activation. */
export function actors(s: GameState): PlayerId[] {
  const out = new Set<PlayerId>([active(s), ...s.pendingFactoryOps.map(e => e.ownerId)]);
  return [...out];
}

export function roll(r: Rand, s: GameState): Action {
  return { type: 'ROLL_DICE', rolls: Array.from({ length: s.mineCount }, () => 1 + r.int(6)) };
}

/** A random move: first a random action type, then one of its actions (so rare kinds happen). */
export function randomMove(r: Rand, s: GameState, p: PlayerId): Action | null {
  if (s.phase === 'roll' && active(s) === p && s.pendingFactoryOps.length === 0) return roll(r, s);
  const legal = legalActions(s, p);
  if (legal.length === 0) return null;
  const types = [...new Set(legal.map(a => a.type))];
  // Keep turns moving: removing belts is offered for every belt and would loop forever.
  const weighted = types.filter(t => t !== 'REMOVE_BELT' || r.next() < 0.2);
  const t = r.pick(weighted.length ? weighted : types);
  return r.pick(legal.filter(a => a.type === t));
}

export interface Sample { state: GameState; player: PlayerId; seed: number; step: number }

/** Plays a seeded random game and calls `visit` on every state with every player who may act. */
export function playRandom(
  seed: number,
  playerCount: 2 | 3 | 4,
  maxSteps: number,
  visit: (s: GameState, p: PlayerId, step: number) => void,
): GameState {
  const r = new Rand(seed);
  let s = createGame(seed, playerCount);
  for (let step = 0; step < maxSteps && !s.gameOver; step++) {
    const who = actors(s);
    for (const p of who) visit(s, p, step);
    const p = r.pick(who);
    const a = randomMove(r, s, p);
    if (!a) break;
    const res = applyAction(s, a);
    if (!res.ok) throw new Error(`random move refused: ${res.error.code} ${JSON.stringify(a)}`);
    s = res.state;
  }
  return s;
}

/** Plays a seeded random game until `pred` holds for some player; returns that state. */
export function findState(
  pred: (s: GameState, p: PlayerId) => boolean,
  opts: { seeds?: readonly number[]; players?: readonly (2 | 3 | 4)[]; maxSteps?: number } = {},
): { state: GameState; player: PlayerId } {
  for (const pc of opts.players ?? [2, 3, 4]) {
    for (const seed of opts.seeds ?? [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]) {
      let found: { state: GameState; player: PlayerId } | null = null;
      try {
        playRandom(seed, pc, opts.maxSteps ?? 2500, (s, p) => {
          if (!found && pred(s, p)) { found = { state: s, player: p }; throw new Stop(); }
        });
      } catch (e) { if (!(e instanceof Stop)) throw e; }
      if (found) return found;
    }
  }
  throw new Error('no state matched');
}
class Stop extends Error {}

/** Plays straight to the active player's actions step with nothing pending. */
export function atActions(seed = 3, playerCount: 2 | 3 | 4 = 2): { state: GameState; player: PlayerId } {
  return findState((s, p) => s.phase === 'actions' && active(s) === p && s.pendingFactoryOps.length === 0
    && s.overstockPieces.length === 0 && s.round >= 3, { seeds: [seed], players: [playerCount] });
}

// ── Controller harness ────────────────────────────────────────────────────────

export function harness(state: GameState | null, me: PlayerId | null): { c: PlayController; sent: Action[] } {
  const sent: Action[] = [];
  const c = new PlayController({ send: (a): void => { sent.push(a); } });
  c.update(state, me);
  return { c, sent };
}

export function isLit(v: PlayView, t: Target): boolean {
  const k = targetKey(t);
  return v.targets.some(x => targetKey(x) === k);
}

export function allItems(v: PlayView): { id: string; enabled: boolean; label: string; reason?: string; detail?: string }[] {
  return [
    ...v.bank, ...v.hand, ...(v.menu?.items ?? []), ...(v.choices?.items ?? []),
    ...v.prompts.flatMap(p => p.options),
    ...v.tray.filter(t => t.state === 'lit').map(t => ({ id: `module:${t.module}`, enabled: true, label: `${t.module}` })),
  ];
}

export class GestureError extends Error {}

function tapLit(c: PlayController, t: Target): void {
  if (!isLit(c.view, t)) throw new GestureError(`not lit: ${targetKey(t)}`);
  c.tap(t);
}

function pick(c: PlayController, id: string): void {
  const it = allItems(c.view).find(i => i.id === id);
  if (!it) throw new GestureError(`not offered: ${id}`);
  if (!it.enabled) throw new GestureError(`disabled: ${id} (${it.reason ?? ''})`);
  c.choose(id);
}

function hasItem(c: PlayController, id: string): boolean {
  return allItems(c.view).some(i => i.id === id && i.enabled);
}

function ok(c: PlayController): void {
  if (!c.view.confirmBar?.confirm) throw new GestureError('confirm not offered');
  c.confirm();
}

function press(c: PlayController): void {
  if (!c.view.primary?.enabled) throw new GestureError(`primary not enabled: ${c.view.primary?.hint ?? ''}`);
  c.primary();
}

function rotateTo(c: PlayController, rotation: number): void {
  for (let i = 0; i < 7; i++) {
    if (c.view.ghost?.rotation === rotation) return;
    if (!c.view.confirmBar?.rotate) break;
    c.rotate(1);
  }
  throw new GestureError(`rotation ${rotation} not reachable (ghost ${c.view.ghost?.rotation})`);
}

function placeAt(c: PlayController, coord: { q: number; r: number }, rotation: number | undefined): void {
  tapLit(c, { kind: 'cell', q: coord.q, r: coord.r });
  rotateTo(c, rotation ?? 0);
  ok(c);
}

/**
 * Drive a controller (already updated with the state) to send `a`, using only lit targets,
 * enabled items, the primary button, confirm and rotate — the way a player would.
 */
export function gesturesFor(c: PlayController, a: Action): void {
  switch (a.type) {
    case 'SETUP_CLAIM': tapLit(c, { kind: 'piece', pieceId: a.pieceId }); ok(c); return;
    case 'PLACE_PIECE':
      if (isLit(c.view, { kind: 'stack', index: a.stackIndex })) tapLit(c, { kind: 'stack', index: a.stackIndex });
      placeAt(c, a.coord, a.rotation); return;
    case 'PLACE_MINE': placeAt(c, a.coord, a.rotation); return;
    case 'PLACE_OVERSTOCK_PIECE': placeAt(c, a.coord, a.rotation); return;
    case 'BUY_MINE': pick(c, 'bank:buyMine'); placeAt(c, a.coord, a.rotation); return;
    case 'ROLL_DICE': case 'END_ACTIONS': case 'END_TURN': press(c); return;
    case 'PLACE_MEEPLE':
      if (a.slotIndex === undefined) tapLit(c, { kind: 'piece', pieceId: a.pieceId });
      else tapLit(c, { kind: 'mineSlot', pieceId: a.pieceId, slot: a.slotIndex });
      ok(c); return;
    case 'PLACE_BELT':
      tapLit(c, { kind: 'point', pieceId: a.pieceId, point: a.fromPoint });
      tapLit(c, { kind: 'point', pieceId: a.pieceId, point: a.toPoint });
      return;
    case 'REMOVE_BELT': tapLit(c, { kind: 'belt', beltId: a.beltId }); pick(c, 'menu:removeBelt'); return;
    case 'UNDO_BELTS': pick(c, 'bank:undoBelts'); return;
    case 'BUY_BELT': pick(c, 'bank:buyBelt'); return;
    case 'BUY_CARD': pick(c, 'bank:buyCard'); return;
    case 'EXCHANGE_MATERIALS': pick(c, 'bank:exchange'); pick(c, `exchange:${a.give}`); return;
    case 'PLACE_TELEPORTER': tapLit(c, { kind: 'piece', pieceId: a.pieceId }); pick(c, `menu:teleporter:${a.bufferType}`); return;
    case 'CLAIM_BUILDING':
      tapLit(c, { kind: 'piece', pieceId: a.pieceId });
      pick(c, `menu:claim:${a.fromProductionIncrease ? 'pi' : 'free'}`);
      pick(c, `module:${a.controlModule}`);
      return;
    case 'UPGRADE_BUILDING': {
      tapLit(c, { kind: 'piece', pieceId: a.pieceId });
      const src = a.fromProductionIncrease ? 'pi' : a.fromMineCredit ? 'mineCredit' : 'endOfRound';
      pick(c, `menu:upgrade:${src}`);
      if (hasItem(c, `old:${a.oldModule}`)) pick(c, `old:${a.oldModule}`);
      pick(c, `module:${a.newModule}`);
      return;
    }
    case 'LOAD_BUILDING_INPUT': tapLit(c, { kind: 'piece', pieceId: a.pieceId }); pick(c, `menu:load:${a.material}`); return;
    case 'COLLECT_OUTPUT': tapLit(c, { kind: 'piece', pieceId: a.pieceId }); pick(c, 'menu:collect'); return;
    case 'OPERATE_BUILDING':
      if (a.ownerId !== undefined) pick(c, `op:${a.pieceId}:run`);
      else { tapLit(c, { kind: 'piece', pieceId: a.pieceId }); pick(c, 'menu:run'); }
      return;
    case 'SKIP_FACTORY_ROLL': pick(c, `op:${a.pieceId}:skip`); return;
    case 'PLAY_CARD': {
      if (a.cardType === 'scoutingDrone') {
        pick(c, 'card:scoutingDrone');
        pick(c, `drone:${a.stackIndex}:${a.pieceIndex}`);
        placeAt(c, a.coord!, a.rotation);
        return;
      }
      pick(c, `card:${a.cardType}`);
      switch (a.cardType) {
        case 'shortSale': case 'sinkHole': tapLit(c, { kind: 'piece', pieceId: a.pieceId! }); break;
        case 'rdTaxWriteOff': tapLit(c, { kind: 'buffer', pieceId: a.pieceId!, buffer: a.bufferType! }); break;
        case 'changingPriorities':
          tapLit(c, { kind: 'piece', pieceId: a.pieceId! });
          tapLit(c, { kind: 'piece', pieceId: a.toPieceId! });
          if (hasItem(c, `cpModule:${a.controlModule}`)) pick(c, `cpModule:${a.controlModule}`);
          break;
        default: break;
      }
      ok(c);
      return;
    }
  }
}

/** The action the controller should send for `a` (the roll's dice are the host's job). */
export function expectedSend(a: Action): Action {
  return a.type === 'ROLL_DICE' ? { type: 'ROLL_DICE', rolls: [] } : a;
}

/** Every action a player may take in `s`, as the controller sees it (legalActions plus the roll). */
export function offered(s: GameState, p: PlayerId): Action[] {
  const legal = legalActions(s, p);
  if (s.phase === 'roll' && active(s) === p && !s.gameOver && s.pendingFactoryOps.length === 0) {
    return [...legal, { type: 'ROLL_DICE', rolls: [] }];
  }
  return legal;
}

export function expectLegal(s: GameState, p: PlayerId, a: Action): void {
  if (a.type === 'ROLL_DICE') {
    expect(s.phase).toBe('roll');
    expect(active(s)).toBe(p);
    return;
  }
  const keys = new Set(legalActions(s, p).map(actionKey));
  if (!keys.has(actionKey(a))) {
    throw new Error(`controller sent an action not in legalActions: ${JSON.stringify(a)} (phase ${s.phase})`);
  }
}
