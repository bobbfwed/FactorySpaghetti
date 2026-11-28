// From table events + state difference to animation steps, checked on real bot games.

import { describe, it, expect, beforeAll } from 'vitest';
import type { Action } from '../../engine/actions';
import { applyAction, legalActions } from '../../engine/reducer';
import { createGame } from '../../engine/rules/setup';
import type { GameState, PlayerId } from '../../engine/state';
import { createRng, nextIntBelow, type RngState } from '../../engine/rng';
import { chooseAction as greedy } from '../../bots/greedyBot';
import { moveEvents } from '../../session/events';
import type { TableEvent } from '../../session/room';
import { DUR, isTableStep, planTransition, type AnimStep, type TransitionPlan } from '../transition';
import { traceFlow, pointAlong, pathLength } from '../flowPath';
import * as THREE from 'three';
import { bufferSlotWorld, boardBounds, positionsWithRole, sideLayout } from '../layout';
import { Animator } from '../animator';
import { withTeleporter } from '../../engine/rules/teleporters';
import { findRoute, routeDests, routeSources } from '../../engine/routing';

interface Move { action: Action; prev: GameState; next: GameState; events: TableEvent[]; plan: TransitionPlan }

/** A whole game, move by move, with the events the host would send and the plan of each move. */
function playGame(seed: number, players: 2 | 3 | 4, kind: 'greedy' | 'random', maxMoves = 6000): Move[] {
  let s = createGame(seed, players);
  let rng: RngState = createRng(seed ^ 0x77);
  const out: Move[] = [];
  for (let i = 0; i < maxMoves && !s.gameOver; i++) {
    const pending = s.pendingFactoryOps[0];
    const id = (pending ? pending.ownerId : s.turnOrder[s.activePlayerIndex]) as PlayerId;
    let action: Action;
    if (s.phase === 'roll' && !pending) {
      const rolls: number[] = [];
      for (let d = 0; d < s.mineCount; d++) { const [v, n] = nextIntBelow(rng, 6); rng = n; rolls.push(v + 1); }
      action = { type: 'ROLL_DICE', rolls };
    } else if (kind === 'greedy') {
      action = greedy(s, id);
    } else {
      const legal = legalActions(s, id);
      const [k, n] = nextIntBelow(rng, legal.length); rng = n;
      action = legal[k]!;
    }
    const res = applyAction(s, action);
    if (!res.ok) throw new Error(res.error.message);
    const events = moveEvents(s, res.state, action, id);
    out.push({ action, prev: s, next: res.state, events, plan: planTransition(s, res.state, events) });
    s = res.state;
  }
  return out;
}

let moves: Move[] = [];
beforeAll(() => {
  // Seed 21 joins the first three since #55 changed the moves listed (a teleporter per input), and
  // with it these random games: they carried material along belts too rarely to test flows.
  moves = [...playGame(7, 3, 'random'), ...playGame(11, 4, 'greedy'), ...playGame(5, 2, 'random'), ...playGame(21, 3, 'random')];
}, 120_000);

const ofKind = <K extends AnimStep['kind']>(p: TransitionPlan, k: K): Extract<AnimStep, { kind: K }>[] =>
  p.steps.filter(s => s.kind === k) as Extract<AnimStep, { kind: K }>[];

describe('planTransition', () => {
  it('plans every move of whole games with sane timings', () => {
    expect(moves.length).toBeGreaterThan(500);
    for (const m of moves) {
      for (const s of m.plan.steps) {
        expect(s.at).toBeGreaterThanOrEqual(0);
        expect(s.dur).toBeGreaterThan(0);
        expect(s.at + s.dur).toBeLessThanOrEqual(m.plan.baseMs);
      }
      // One move stays short: well inside the 2.5 s lag cap.
      expect(m.plan.baseMs).toBeLessThan(2500);
    }
  });

  it('a roll tumbles one die per mine onto the rolled values, then pulses the activated buildings', () => {
    const rolls = moves.filter(m => m.action.type === 'ROLL_DICE');
    expect(rolls.length).toBeGreaterThan(50);
    let pulses = 0;
    for (const m of rolls) {
      const dice = ofKind(m.plan, 'dice');
      expect(dice).toHaveLength(1);
      expect(dice[0]!.at).toBe(0);
      expect(dice[0]!.values).toEqual(m.action.type === 'ROLL_DICE' ? m.action.rolls : null);
      expect(dice[0]!.values).toHaveLength(m.prev.mineCount);
      const activated = m.events.filter(e => e.kind === 'activated');
      const p = ofKind(m.plan, 'pulse');
      expect(p).toHaveLength(activated.length);
      for (const s of p) {
        expect(s.at).toBeGreaterThanOrEqual(DUR.dice - 200);
        const e = activated.find(x => x.kind === 'activated' && x.pieceId === s.pieceId);
        expect(e?.seat).toBe(s.owner);
      }
      pulses += p.length;
      // Power Plants that produced send their Power Tokens to the owner.
      for (const e of activated) {
        if (e.kind === 'activated' && e.outcome === 'power') {
          expect(m.plan.steps.some(s => s.kind === 'toPlayer' && s.item === 'power' && s.player === e.seat)).toBe(true);
        }
      }
    }
    expect(pulses).toBeGreaterThan(5);
  });

  it('a placed piece travels from the stack it was drawn from', () => {
    const placed = moves.filter(m => m.action.type === 'PLACE_PIECE');
    expect(placed.length).toBeGreaterThan(20);
    for (const m of placed) {
      const [s] = ofKind(m.plan, 'place');
      expect(s).toBeDefined();
      const from = m.prev.stacks.findIndex(st => st.pieces.some(p => p.id === s!.pieceId));
      expect(s!.stack).toBe(from);
    }
  });

  it('belts, claims, upgrades and meeples each get their step', () => {
    const find = (t: Action['type']): Move[] => moves.filter(m => m.action.type === t);
    for (const m of find('PLACE_BELT')) expect(ofKind(m.plan, 'belt')).toHaveLength(1);
    for (const m of [...find('CLAIM_BUILDING'), ...find('SETUP_CLAIM')]) {
      const s = ofKind(m.plan, 'module');
      expect(s.length).toBeGreaterThanOrEqual(1);
      expect(s.some(x => !x.upgrade)).toBe(true);
    }
    for (const m of find('UPGRADE_BUILDING')) expect(ofKind(m.plan, 'module').some(x => x.upgrade)).toBe(true);
    for (const m of find('PLACE_MEEPLE')) expect(ofKind(m.plan, 'meeple')).toHaveLength(1);
    expect(find('PLACE_BELT').length).toBeGreaterThan(5);
  });

  it('operating uses the inputs, shows the product and takes the Power Tokens', () => {
    const ops = moves.filter(m => m.action.type === 'OPERATE_BUILDING');
    expect(ops.length).toBeGreaterThan(3);
    for (const m of ops) {
      const e = m.events.find(x => x.kind === 'operated');
      if (!e || e.kind !== 'operated') continue;
      const hadInput = m.prev.board.find(p => p.id === e.pieceId)?.input?.slots.some(Boolean) ?? false;
      if (hadInput) expect(ofKind(m.plan, 'consume').length + ofKind(m.plan, 'fromPlayer').length).toBeGreaterThan(0);
      // A Power Plant's tokens go to its owner.
      if (e.powerChange > 0) expect(ofKind(m.plan, 'toPlayer').some(s => s.item === 'power')).toBe(true);
      if (e.product && !e.teleported) expect(ofKind(m.plan, 'appear').some(s => s.pieceId === e.pieceId && s.buffer === 'output')).toBe(true);
      if (e.powerChange < 0) expect(ofKind(m.plan, 'fromPlayer').some(s => s.item === 'power' && s.count === -e.powerChange)).toBe(true);
    }
  });

  it('collected output and bought cards go to the player', () => {
    for (const m of moves.filter(x => x.action.type === 'COLLECT_OUTPUT')) {
      expect(ofKind(m.plan, 'toPlayer').some(s => s.item !== 'power' && s.item !== 'card')).toBe(true);
    }
    const buys = moves.filter(x => x.action.type === 'BUY_CARD');
    expect(buys.length).toBeGreaterThan(0);
    for (const m of buys) expect(ofKind(m.plan, 'toPlayer').some(s => s.item === 'card')).toBe(true);
  });

  it('material flows end in the input they filled; ore comes from a mine', () => {
    const flows = moves.flatMap(m => ofKind(m.plan, 'flow').map(f => ({ m, f })));
    expect(flows.length).toBeGreaterThan(3);
    for (const { m, f } of flows) {
      const dest = m.next.board.find(p => p.id === f.toPieceId)!;
      const end = f.path[f.path.length - 1]!;
      const slot = bufferSlotWorld(dest, 'input', f.slot);
      expect(Math.hypot(end.x - slot.x, end.z - slot.z)).toBeLessThan(0.01);
      if (f.material === 'ore') expect(m.next.board.find(p => p.id === f.fromPieceId)?.type).toBe('mine');
    }
  });

  it('loading an input from your materials flies from your area, not from a mine', () => {
    const loads = moves.filter(m => m.action.type === 'LOAD_BUILDING_INPUT');
    expect(loads.length).toBeGreaterThan(0);
    for (const m of loads) {
      expect(ofKind(m.plan, 'fromPlayer').some(s => s.to?.kind === 'buffer')).toBe(true);
      expect(ofKind(m.plan, 'flow')).toHaveLength(0);
    }
  });

  it('an operated building that is refilled at once still shows its inputs used', () => {
    const ops = moves.filter(m => m.action.type === 'OPERATE_BUILDING' && m.events.some(e => e.kind === 'operated'));
    for (const m of ops) {
      const id = (m.action as { pieceId: string }).pieceId;
      const had = m.prev.board.find(p => p.id === id)?.input?.slots.filter(Boolean).length ?? 0;
      expect(ofKind(m.plan, 'consume').filter(s => s.pieceId === id && s.buffer === 'input').length).toBe(had);
    }
  });

  it('table steps and interface steps are told apart', () => {
    const all = moves.flatMap(m => m.plan.steps);
    expect(all.filter(s => !isTableStep(s)).every(s => s.kind === 'toPlayer' || s.kind === 'fromPlayer')).toBe(true);
    expect(all.some(isTableStep)).toBe(true);
  });

  it('a burst of moves (merged events, one state jump) still plans one transition within the cap', () => {
    const start = moves.findIndex(m => m.prev.round >= 6);
    const burst = moves.slice(start, start + 40);
    const events = burst.flatMap(m => m.events);
    const plan = planTransition(burst[0]!.prev, burst[burst.length - 1]!.next, events);
    expect(plan.steps.length).toBeGreaterThan(3);
    expect(plan.baseMs).toBeLessThan(6000);
  });
});

describe('flow paths', () => {
  it('walks a polyline evenly', () => {
    const pts = [{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 10 }];
    expect(pathLength(pts)).toBe(20);
    expect(pointAlong(pts, 0.25)).toEqual({ x: 5, z: 0 });
    expect(pointAlong(pts, 0.75)).toEqual({ x: 10, z: 5 });
    expect(pointAlong(pts, 1)).toEqual({ x: 10, z: 10 });
  });

  it('follows a chain of belts from a mine to an input (chain laid by the engine router)', () => {
    let checked = 0;
    for (const m of moves) {
      if (checked >= 2 || m.next.round < 4 || m.next.belts.length % 3 !== 0) continue;
      const g = m.next;
      for (const me of [0, 1, 2, 3] as PlayerId[]) {
        if (me >= g.playerCount || checked >= 2) continue;
        for (const dest of routeDests(g, me)) {
          const piece = g.board.find(p => p.id === dest.pieceId)!;
          const slot = positionsWithRole(piece.type, 'input_buffer').indexOf(dest.position);
          const src = routeSources(g, me).find(s => g.board.find(p => p.id === s.pieceId)?.type === 'mine');
          if (!src || slot < 0) continue;
          const route = findRoute(g, src, dest, me, 4);
          if (!route || route.cost < 2) continue;
          const belts = [...g.belts, ...route.belts.map((b, i) => ({ id: `t${i}`, ownerId: me, ...b }))];
          const trace = traceFlow({ board: g.board, belts }, dest.pieceId, slot, [{ pieceId: src.pieceId, kind: 'mine', slot: 0 }]);
          expect(trace).not.toBeNull();
          expect(trace!.belts).toBe(route.cost);
          // Starts on the mine, ends on the input slot, and passes every belt of the chain.
          const end = trace!.points[trace!.points.length - 1]!;
          const want = bufferSlotWorld(piece, 'input', slot);
          expect(Math.hypot(end.x - want.x, end.z - want.z)).toBeLessThan(0.01);
          checked++;
          break;
        }
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('returns null for a building nothing reaches', () => {
    const m = moves.find(x => x.next.board.some(p => p.type === 'plateFact' && p.claims.length === 0))!;
    const lonely = m.next.board.find(p => p.type === 'plateFact' && p.claims.length === 0)!;
    const t = traceFlow({ board: m.next.board, belts: [] }, lonely.id, 0, []);
    expect(t).toBeNull();
  });
});

describe('material moving aside for a teleporter (slide)', () => {
  // A Plate Factory from a real setup, with Ore in its input, owned by player 0.
  const base = createGame(7, 2);
  const factory = base.board.find(p => p.type === 'plateFact')!;
  const owned = { ...factory, claims: [{ ownerId: 0 as PlayerId, controlModule: 3 }] };
  const withPiece = (piece: GameState['board'][number]): GameState => ({ ...base, board: base.board.map(p => (p.id === piece.id ? piece : p)) });
  const plain = { ...owned, input: { slots: ['ore' as const], teleporters: [] as Array<PlayerId | null> } };
  const teleported = { ...plain, input: withTeleporter(plain.input, 0, 0) };

  it('a teleporter placed on a stub that holds material: the material slides aside, starting just before the teleporter appears', () => {
    const plan = planTransition(withPiece(plain), withPiece(teleported), []);
    const slides = ofKind(plan, 'slide');
    expect(slides).toHaveLength(1);
    const s = slides[0]!;
    expect(s).toMatchObject({ pieceId: factory.id, buffer: 'input', slot: 0, material: 'ore', dur: DUR.slide });
    expect(s.from).toEqual(bufferSlotWorld(plain, 'input', 0));
    expect(s.to).toEqual(bufferSlotWorld(teleported, 'input', 0));
    expect(Math.hypot(s.to.x - s.from.x, s.to.z - s.from.z)).toBeGreaterThan(5);
    const t = ofKind(plan, 'teleporter')[0]!;
    expect(s.at).toBeLessThanOrEqual(t.at);
    expect(s.at + s.dur).toBeGreaterThan(t.at);
    // Nothing else happens to that material (no shrinking away and popping up).
    expect(ofKind(plan, 'consume')).toHaveLength(0);
    expect(ofKind(plan, 'appear')).toHaveLength(0);
  });

  it('no slide when the stub is empty, and none when the material does not move', () => {
    const emptyPlain = { ...plain, input: { slots: [null], teleporters: [] as Array<PlayerId | null> } };
    expect(ofKind(planTransition(withPiece(emptyPlain), withPiece({ ...emptyPlain, input: withTeleporter(emptyPlain.input, 0, 0) }), []), 'slide')).toHaveLength(0);
    expect(ofKind(planTransition(withPiece(teleported), withPiece(teleported), []), 'slide')).toHaveLength(0);
  });

  it('a building that loses its owner (#58): its material is used up where it lay, beside the teleporter, with no slide', () => {
    const lost = { ...teleported, claims: [], input: { slots: [null], teleporters: [] as Array<PlayerId | null> } };
    const plan = planTransition(withPiece(teleported), withPiece(lost), []);
    expect(ofKind(plan, 'slide')).toHaveLength(0);
    expect(ofKind(plan, 'consume').map(c => [c.pieceId, c.buffer, c.slot])).toEqual([[factory.id, 'input', 0]]);
  });

  it('a teleporter that leaves while the material stays: the material slides back', () => {
    const plan = planTransition(withPiece(teleported), withPiece(plain), []);
    const s = ofKind(plan, 'slide')[0]!;
    expect(s.from).toEqual(bufferSlotWorld(teleported, 'input', 0));
    expect(s.to).toEqual(bufferSlotWorld(plain, 'input', 0));
  });

  it('the animator draws the sliding material between the two spots and hides it in its slot until it arrives', () => {
    const prev = withPiece(plain), next = withPiece(teleported);
    const plan = planTransition(prev, next, []);
    const a = new Animator(new THREE.Group(), () => new THREE.Color());
    const s = ofKind(plan, 'slide')[0]!;
    a.start(prev, next, plan.steps, 1, 0, sideLayout(boardBounds(next.board), next.mineCount));
    a.update(s.at + s.dur / 2);
    expect(a.slot(factory.id, 'input', 0)).toBe(0);
    const ore = a.extras().find(e => e.material === 'ore')!;
    const mid = { x: (s.from.x + s.to.x) / 2, z: (s.from.z + s.to.z) / 2 };
    expect(Math.hypot(ore.x - mid.x, ore.z - mid.z)).toBeLessThan(0.5);
    a.update(s.at + s.dur + 1);
    expect(a.slot(factory.id, 'input', 0)).not.toBe(0);
    a.dispose();
  });
});
