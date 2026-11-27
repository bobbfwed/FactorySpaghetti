// A second belt route in the same turn that the engine refuses (only one belt touching a Mine's
// ore exit per turn): the route says why, offers no Place button, and can be cancelled on its own
// (or, when part of it was laid this turn, those belts taken back) without touching the first route.

import { describe, expect, it } from 'vitest';
import type { Action, PlaceBeltAction } from '../../engine/actions';
import type { GameState, Player, PlayerId } from '../../engine/state';
import { applyAction, legalActions } from '../../engine';
import { refusalText } from '../../app/gameText';
import { placeAction, planRoute, planningState, routeEnds, type Seg } from '../route';
import { W } from '../words';
import type { PlayController } from '../controller';
import { active, allItems, findState, harness } from './helpers';

function patchPlayer(s: GameState, p: PlayerId, patch: Partial<Player>): GameState {
  return { ...s, players: s.players.map((x, i) => (i === p ? { ...x, ...patch } : x)) };
}

function apply(s: GameState, a: Action): GameState {
  const r = applyAction(s, a);
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
  return r.state;
}

/** Apply what the controller sent from `from` on, one move at a time, as the host would. */
function play(s: GameState, p: PlayerId, c: PlayController, sent: Action[], from = 0): GameState {
  for (let done = from, guard = 0; guard < 40 && done < sent.length; guard++, done++) {
    s = apply(s, sent[done]!);
    c.update(s, p);
  }
  return s;
}

/** Does this belt have an end facing a Mine's ore exit? Asked of the engine. */
function touchesMine(s: GameState, p: PlayerId, seg: Seg): boolean {
  const r = applyAction(planningState(s, p), placeAction(seg));
  return r.ok && r.state.mineBeltPlacedThisTurn;
}

const ACTIONS_STEP = (s: GameState, p: PlayerId): boolean => s.phase === 'actions' && active(s) === p
  && s.pendingFactoryOps.length === 0 && s.overstockPieces.length === 0 && !s.mineBeltPlacedThisTurn;

interface Fixture {
  /** My actions step, plenty of belts in the supply, nothing laid yet this turn. */
  s: GameState;
  p: PlayerId;
  /** The first route: one belt touching a Mine's ore exit. */
  first: PlaceBeltAction;
  /** The second route's two ends and its planned belts (after the first route is down). */
  from: { pieceId: string; position: number };
  to: { pieceId: string; position: number };
  segs: Seg[];
}

/**
 * A first route of one belt touching a Mine, and a second route (planned after it) whose belt
 * number `mineAt` (0 = its first) is the first one touching a Mine.
 */
function fixture(mineAt: number): Fixture {
  let found: Fixture | null = null;
  findState((s0, p) => {
    if (!ACTIONS_STEP(s0, p)) return false;
    const s = patchPlayer(s0, p, { beltsRemaining: 20 });
    const firsts = legalActions(s, p).filter((a): a is PlaceBeltAction => a.type === 'PLACE_BELT'
      && touchesMine(s, p, { pieceId: a.pieceId, from: a.fromPoint, to: a.toPoint }));
    for (const first of firsts.slice(0, 4)) {
      const s1 = apply(s, first);
      const ends = routeEnds(s1, p);
      for (const from of ends.slice(0, 24)) {
        for (const to of ends) {
          if (to.pieceId === from.pieceId && to.position === from.position) continue;
          const segs = planRoute(s1, p, from, to);
          if (!segs || segs.length < mineAt + 1 || segs.length > mineAt + 3) continue;
          const touching = segs.map(x => touchesMine(s1, p, x));
          if (touching.indexOf(true) !== mineAt) continue;
          found = { s, p, first, from, to, segs };
          return true;
        }
      }
    }
    return false;
  });
  return found!;
}

/** Lay the first route (one belt) through the controller, then plan the second route. */
function twoRoutes(f: Fixture): { c: PlayController; sent: Action[]; s: GameState } {
  const { c, sent } = harness(f.s, f.p);
  c.choose('bank:placeBelt');
  c.tap({ kind: 'point', pieceId: f.first.pieceId, point: f.first.fromPoint });
  c.tap({ kind: 'point', pieceId: f.first.pieceId, point: f.first.toPoint });
  expect(c.view.primary?.enabled).toBe(true);
  c.primary();
  expect(sent).toEqual([f.first]);
  const s = play(f.s, f.p, c, sent);
  // The first route is complete: back to choosing where the next belts start.
  expect(c.view.instruction).toBe(W.beltPickStart);
  c.tap({ kind: 'point', pieceId: f.from.pieceId, point: f.from.position });
  c.tap({ kind: 'point', pieceId: f.to.pieceId, point: f.to.position });
  expect(c.view.route).toHaveLength(f.segs.length);
  return { c, sent, s };
}

const ids = (c: PlayController): string[] => c.view.choices?.items.map(i => i.id) ?? [];
const label = (c: PlayController, id: string): string | undefined => allItems(c.view).find(i => i.id === id)?.label;
const MINE_REASON = refusalText({ code: 'MINE_BELT_LIMIT' });

describe('a belt route refused at its first belt', () => {
  const f = fixture(0);

  it('says why, offers no Place button, and "Cancel this route" is the big button', () => {
    const { c, sent, s } = twoRoutes(f);
    expect(c.view.instruction).toContain(MINE_REASON);
    expect(c.view.instruction).toContain(W.routeRefused);
    expect(ids(c)).toEqual(['route:cancel', 'route:later']);
    expect(label(c, 'route:cancel')).toBe(W.routeCancel);
    expect(W.routeCancel).toBe('Cancel this route');
    expect(c.view.primary).toMatchObject({ label: 'Cancel this route', enabled: true });
    expect(c.view.choices?.items.some(i => /^(Place|Buy)\b/.test(i.label))).toBe(false);
    // The reason stays while the route is shown (a tap elsewhere does not wipe it).
    c.tap({ kind: 'cell', q: 99, r: 99 });
    expect(c.view.instruction).toContain(MINE_REASON);
    // Cancel: the plan is gone, nothing is sent, the first route's belt stays.
    c.primary();
    expect(sent).toEqual([f.first]);
    expect(c.view.route ?? null).toBeNull();
    expect(c.view.instruction).toBe(W.beltPickStart);
    expect(s.belts.some(b => b.pieceId === f.first.pieceId && b.fromPoint === f.first.fromPoint && b.toPoint === f.first.toPoint)).toBe(true);
    // Forgotten: Lay a belt does not offer it again.
    expect(ids(c)).not.toContain('route:continue');
  });

  it('the ✕ (cancel) drops the plan too', () => {
    const { c, sent } = twoRoutes(f);
    c.cancel();
    expect(c.view.route ?? null).toBeNull();
    c.choose('bank:placeBelt');
    expect(ids(c)).not.toContain('route:continue');
    expect(sent).toEqual([f.first]);
  });

  it('"Keep the plan for a later turn" keeps it, and it can be laid on the next turn', () => {
    const { c, sent, s } = twoRoutes(f);
    c.choose('route:later');
    expect(c.view.route ?? null).toBeNull();
    expect(sent).toEqual([f.first]);
    // A later turn of mine (the once-per-turn Mine belt is free again).
    const next: GameState = { ...s, mineBeltPlacedThisTurn: false, beltsPlacedThisTurn: [] };
    c.update(next, f.p);
    c.choose('bank:placeBelt');
    expect(ids(c)).toContain('route:continue');
    c.choose('route:continue');
    expect(c.view.instruction).not.toContain(MINE_REASON);
    expect(c.view.primary).toMatchObject({ label: W.routePlaceAll(f.segs.length), enabled: true });
    c.primary();
    const after = play(next, f.p, c, sent, 1);
    expect(sent.slice(1).map(a => a.type)).toEqual(f.segs.map(() => 'PLACE_BELT'));
    for (const seg of f.segs) expect(after.belts.some(b => b.pieceId === seg.pieceId && new Set([b.fromPoint, b.toPoint]).has(seg.from))).toBe(true);
  });
});

describe('a belt route stopped part-way by the Mine rule', () => {
  const f = fixture(1);

  /** Lay the first route, then as much of the second as the engine allows this turn. */
  function partLaid(): { c: PlayController; sent: Action[]; s: GameState; laid: string[] } {
    const t = twoRoutes(f);
    expect(c0(t.c)).toBe(true);
    t.c.primary();
    const placedSecond = t.sent.slice(1);
    expect(placedSecond.length).toBeGreaterThan(0);
    const s = play(t.s, f.p, t.c, t.sent, 1);
    const laid = s.beltsPlacedThisTurn.filter(id => id !== s.beltsPlacedThisTurn[0]);
    return { ...t, s, laid };
  }
  const c0 = (c: PlayController): boolean => c.view.primary?.label === W.routePlaceAll(f.segs.length);

  it('offers "Drop the rest of the route" and "Take back this route", with the reason', () => {
    const { c, laid } = partLaid();
    expect(laid).toHaveLength(1);
    expect(c.view.route).toHaveLength(f.segs.length - 1);
    expect(c.view.instruction).toContain(MINE_REASON);
    expect(c.view.instruction).toContain(W.routeRestRefused);
    expect(ids(c)).toEqual(['route:cancel', 'route:takeBack', 'route:later']);
    expect(label(c, 'route:cancel')).toBe('Drop the rest of the route');
    expect(label(c, 'route:takeBack')).toBe('Take back this route');
    expect(c.view.primary).toMatchObject({ label: 'Drop the rest of the route', enabled: true });
  });

  it('"Take back this route" picks up exactly its belts laid this turn; the first route stays', () => {
    const { c, sent, s, laid } = partLaid();
    const supply = s.players[f.p]!.beltsRemaining;
    const before = sent.length;
    c.choose('route:takeBack');
    const after = play(s, f.p, c, sent, before);
    expect(sent.slice(before)).toEqual(laid.slice().reverse().map(beltId => ({ type: 'REMOVE_BELT', beltId })));
    expect(after.players[f.p]!.beltsRemaining).toBe(supply + laid.length);
    for (const id of laid) expect(after.belts.some(b => b.id === id)).toBe(false);
    expect(after.belts.some(b => b.pieceId === f.first.pieceId && b.fromPoint === f.first.fromPoint && b.toPoint === f.first.toPoint)).toBe(true);
    expect(after.belts.length).toBe(s.belts.length - laid.length);
    expect(c.view.route ?? null).toBeNull();
    c.choose('bank:placeBelt');
    expect(ids(c)).not.toContain('route:continue');
  });

  it('"Drop the rest of the route" leaves the laid belts and forgets the plan', () => {
    const { c, sent, s } = partLaid();
    const before = sent.length;
    c.primary();
    expect(sent.length).toBe(before);
    expect(c.view.route ?? null).toBeNull();
    expect(ids(c)).not.toContain('route:continue');
    expect(s.belts.length).toBe(f.s.belts.length + 2);
  });

  it('kept for a later turn, the belts laid on the earlier turn are not taken back', () => {
    const { c, sent, s } = partLaid();
    c.choose('route:later');
    const next: GameState = { ...s, mineBeltPlacedThisTurn: false, beltsPlacedThisTurn: [] };
    c.update(next, f.p);
    c.choose('bank:placeBelt');
    c.choose('route:continue');
    expect(c.view.route).toHaveLength(f.segs.length - 1);
    expect(ids(c)).not.toContain('route:takeBack');
    expect(label(c, 'route:cancel')).toBe(W.routeDropRest);
    const before = sent.length;
    c.primary();
    expect(sent.length).toBeGreaterThan(before);
    expect(sent.slice(before).every(a => a.type === 'PLACE_BELT')).toBe(true);
  });
});
