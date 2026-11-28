// Animations added for things the table used to show only as a jump: material through a
// Teleporter's portal (in and out), pieces, belts and Teleporters leaving the table, a Control
// Module leaving a building (or travelling to another), and material leaving a building. Each
// is planned from a real engine move (the events the host would send) and drawn by the animator.

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import type { Action } from '../../engine/actions';
import { applyAction } from '../../engine/reducer';
import { createGame } from '../../engine/rules/setup';
import { makeBuffers } from '../../engine/rules/pieces';
import { withTeleporter } from '../../engine/rules/teleporters';
import type { BoardPiece, CardType, GameState, Material, PieceType, PlayerId } from '../../engine/state';
import { moveEvents } from '../../session/events';
import { Animator } from '../animator';
import { boardBounds, bufferSlotWorld, portalWorld, sideLayout } from '../layout';
import { DUR, planTransition, type AnimStep, type TransitionPlan } from '../transition';

const ofKind = <K extends AnimStep['kind']>(p: TransitionPlan, k: K): Extract<AnimStep, { kind: K }>[] =>
  p.steps.filter(s => s.kind === k) as Extract<AnimStep, { kind: K }>[];

function piece(id: string, type: PieceType, q: number, r: number, owner: PlayerId | null, module = 5, rot = 0): BoardPiece {
  const b = makeBuffers(type);
  return { id, type, coord: { q, r }, rotation: rot, claims: owner === null ? [] : [{ ownerId: owner, controlModule: module }], input: b.input, output: b.output };
}

/** A two-player game in player 0's actions step on a small board of our own. */
function staged(board: BoardPiece[], patch: (s: GameState) => GameState = s => s): GameState {
  const g = createGame(7, 2);
  const mine = g.board.find(p => p.type === 'mine')!;
  const s: GameState = {
    ...g, board: [mine, ...board], belts: [], phase: 'actions', activePlayerIndex: g.turnOrder.indexOf(0), lastRoll: [5],
    players: g.players.map(p => ({ ...p, powerTokens: 5, controlModules: p.controlModules.filter(m => !board.some(b => b.claims.some(c => c.ownerId === p.id && c.controlModule === m))) })),
    globalTeleporterCount: 0,
  };
  return patch(s);
}

function move(s: GameState, action: Action, seat = 0): { prev: GameState; next: GameState; plan: TransitionPlan } {
  const r = applyAction(s, action);
  if (!r.ok) throw new Error(`${r.error.code} ${r.error.message}`);
  return { prev: s, next: r.state, plan: planTransition(s, r.state, moveEvents(s, r.state, action, seat)) };
}

const withHand = (s: GameState, card: CardType): GameState => ({ ...s, players: s.players.map(p => (p.id === 0 ? { ...p, hand: [card] } : p)) });
const animator = (): Animator => new Animator(new THREE.Group(), () => new THREE.Color());
const mid = (s: AnimStep): number => s.at + s.dur / 2;

describe('through the portal', () => {
  // Player 0's Plate Factory with player 0's Teleporter on its empty input, and Ore in player 0's materials.
  const f = piece('f', 'plateFact', -1, 0, 0, 5, 3);
  const fed = { ...f, input: withTeleporter(f.input!, 0, 0) };
  const start = staged([fed], s => ({
    ...s, pendingFactoryOps: [{ pieceId: 'f', ownerId: 0 }], globalTeleporterCount: 1,
    players: s.players.map(p => (p.id === 0 ? { ...p, inventory: { ...p.inventory, ore: 2 } } : p)),
  }));

  it('a material supplied through an input Teleporter flies to its portal, comes out into the input, and is used up', () => {
    const { prev, next, plan } = move(start, { type: 'OPERATE_BUILDING', pieceId: 'f', ownerId: 0, supply: ['ore'] });
    const fly = ofKind(plan, 'fromPlayer').find(s => s.item === 'ore')!;
    expect(fly.to).toEqual({ kind: 'buffer', pieceId: 'f', buffer: 'input', slot: 0, portal: true });
    const out = ofKind(plan, 'portalIn');
    expect(out).toEqual([expect.objectContaining({ pieceId: 'f', slot: 0, material: 'ore', dur: DUR.portal })]);
    const used = ofKind(plan, 'consume').find(s => s.late)!;
    expect(used).toMatchObject({ pieceId: 'f', buffer: 'input', slot: 0, material: 'ore' });
    // In order: the flight lands, the material comes out of the portal, then it is used up.
    expect(fly.at + DUR.flight).toBeLessThanOrEqual(out[0]!.at + DUR.overlap);
    expect(out[0]!.at + out[0]!.dur).toBeLessThanOrEqual(used.at + DUR.overlap);
    // Drawn: out of the portal, half way to the input at half time; not in the input before.
    const a = animator();
    a.start(prev, next, plan.steps, 1, 0, sideLayout(boardBounds(next.board), next.mineCount));
    a.update(out[0]!.at - 5);
    expect(a.extras().filter(e => e.material === 'ore')).toHaveLength(0);
    a.update(mid(out[0]!));
    const ore = a.extras().find(e => e.material === 'ore')!;
    const from = portalWorld(prev.board.find(p => p.id === 'f')!, 'input', 0), to = bufferSlotWorld(prev.board.find(p => p.id === 'f')!, 'input', 0);
    const d = (p: { x: number; z: number }): number => Math.hypot(ore.x - p.x, ore.z - p.z);
    expect(d(from)).toBeGreaterThan(0.5);
    expect(d(to)).toBeGreaterThan(0.5);
    expect(d(from) + d(to)).toBeLessThan(Math.hypot(from.x - to.x, from.z - to.z) + 3);
    a.dispose();
  });

  it('the portal is the glowing end of the Teleporter, standing above its stub', () => {
    const p = portalWorld(fed, 'input', 0), slot = bufferSlotWorld(fed, 'input', 0);
    expect(p.y).toBeGreaterThan(3);
    expect(Math.hypot(p.x - slot.x, p.z - slot.z)).toBeLessThan(20);
  });

  it('a product taken by an output Teleporter goes into its portal, then flies to the owner from there', () => {
    const g = piece('g', 'plateFact', -1, 0, 0, 5, 3);
    const out = { ...g, input: { ...g.input!, slots: ['ore' as const] }, output: withTeleporter(g.output!, 0, 0) };
    const s = staged([out], x => ({ ...x, pendingFactoryOps: [{ pieceId: 'g', ownerId: 0 }], globalTeleporterCount: 1 }));
    const { next, plan } = move(s, { type: 'OPERATE_BUILDING', pieceId: 'g', ownerId: 0 });
    expect(next.players[0]!.inventory.plate).toBe(1);
    const into = ofKind(plan, 'portalOut');
    expect(into).toEqual([expect.objectContaining({ pieceId: 'g', material: 'plate' })]);
    const fly = ofKind(plan, 'toPlayer').find(x => x.item === 'plate')!;
    expect(fly.from).toEqual({ kind: 'buffer', pieceId: 'g', buffer: 'output', slot: 0, portal: true });
    expect(fly.at).toBeGreaterThanOrEqual(into[0]!.at + into[0]!.dur - DUR.overlap - 1);
    expect(ofKind(plan, 'appear').filter(x => x.pieceId === 'g')).toHaveLength(0);
  });

  describe('a material out of the portal is drawn without a break until it is used up, and only once', () => {
    // Every input of each factory type carries player 0's Teleporter; the whole recipe comes from
    // player 0's materials. Sampled every 2 ms from the moment it starts coming out of the portal
    // until its use-up step ends: on the stub's way from the portal to the input, exactly one
    // material of its kind must be drawn at every moment.
    const cases: { type: PieceType; supply: Material[] }[] = [
      { type: 'plateFact', supply: ['ore'] },
      { type: 'sphereFact', supply: ['plate', 'plate'] },
      { type: 'sphereFact', supply: ['ore', 'plate'] },
      { type: 'tesseractFact', supply: ['plate', 'sphere', 'sphere'] },
      { type: 'tesseractFact', supply: ['sphere', 'sphere', 'sphere'] },
      // A Power Plant costs no Power Token: nothing comes before the use-up in its phase.
      { type: 'powerPlant', supply: ['plate'] },
    ];
    for (const c of cases) {
      it(`${c.type}, supplied ${c.supply.join(', ')}`, () => {
        const f = piece('t', c.type, -1, 0, 0, 5, 3);
        let inp = f.input!;
        for (let i = 0; i < inp.slots.length; i++) inp = withTeleporter(inp, i, 0);
        const s = staged([{ ...f, input: inp }], x => ({
          ...x, pendingFactoryOps: [{ pieceId: 't', ownerId: 0 }], globalTeleporterCount: inp.slots.length,
          players: x.players.map(p => (p.id === 0 ? { ...p, inventory: { ore: 3, plate: 3, sphere: 3, tesseract: 0 } } : p)),
        }));
        const { prev, next, plan } = move(s, { type: 'OPERATE_BUILDING', pieceId: 't', ownerId: 0, supply: c.supply });
        const portals = ofKind(plan, 'portalIn');
        expect(portals).toHaveLength(c.supply.length);
        const built = prev.board.find(p => p.id === 't')!;
        const a = animator();
        a.start(prev, next, plan.steps, 1, 0, sideLayout(boardBounds(next.board), next.mineCount));
        for (const pin of portals) {
          const used = ofKind(plan, 'consume').find(x => x.late && x.slot === pin.slot && x.material === pin.material)!;
          expect(used).toBeDefined();
          const from = portalWorld(built, 'input', pin.slot), to = bufferSlotWorld(built, 'input', pin.slot);
          // Distance (in the table's plane) from the segment portal -> input of this slot.
          const off = (e: { x: number; z: number }): number => {
            const dx = to.x - from.x, dz = to.z - from.z;
            const u = Math.max(0, Math.min(1, ((e.x - from.x) * dx + (e.z - from.z) * dz) / (dx * dx + dz * dz)));
            return Math.hypot(e.x - (from.x + u * dx), e.z - (from.z + u * dz));
          };
          const bad: string[] = [];
          for (let t = pin.at + 1; t < used.at + used.dur; t += 2) {
            a.update(t);
            const n = a.extras().filter(e => e.material === pin.material && off(e) < 0.6).length;
            if (n !== 1) bad.push(`t=${t}: ${n}`);
          }
          expect(bad.slice(0, 5), `slot ${pin.slot} (${pin.material}): portal ${pin.at}-${pin.at + pin.dur}, used up ${used.at}-${used.at + used.dur}`).toEqual([]);
        }
        a.dispose();
      });
    }
  });

  it('a move with no Teleporter and nothing leaving plays exactly as before (no new steps, same length)', () => {
    const h = piece('h', 'plateFact', -1, 0, 0, 5, 3);
    const s = staged([{ ...h, input: { ...h.input!, slots: ['ore'] } }], x => ({ ...x, pendingFactoryOps: [{ pieceId: 'h', ownerId: 0 }] }));
    const { plan } = move(s, { type: 'OPERATE_BUILDING', pieceId: 'h', ownerId: 0 });
    for (const k of ['portalIn', 'portalOut', 'leave', 'remove', 'unbelt', 'unteleport', 'unmodule'] as const) expect(ofKind(plan, k)).toHaveLength(0);
    expect(plan.steps.map(x => x.kind)).toEqual(['fromPlayer', 'consume', 'appear', 'flow']);
  });
});

describe('leaving the table', () => {
  it('Sink Hole: the piece and the belts on it lift and shrink away', () => {
    const blank = piece('b', 'blank', -1, 0, null);
    let s = withHand(staged([blank]), 'sinkHole');
    s = { ...s, belts: [{ id: 'belt-p1-b-1-6', ownerId: 1, pieceId: 'b', fromPoint: 1, toPoint: 6 }] };
    const { prev, next, plan } = move(s, { type: 'PLAY_CARD', cardType: 'sinkHole', pieceId: 'b' });
    expect(next.board.some(p => p.id === 'b')).toBe(false);
    const rm = ofKind(plan, 'remove');
    expect(rm.map(x => x.pieceId)).toEqual(['b']);
    expect(ofKind(plan, 'unbelt').map(x => x.beltId)).toEqual(['belt-p1-b-1-6']);
    const a = animator();
    a.start(prev, next, plan.steps, 1, 0, sideLayout(boardBounds(next.board), next.mineCount));
    // Before its step it stands where it was; half way it is lifted and smaller; then gone.
    a.update(0);
    expect(a.leaving().pieces).toEqual([expect.objectContaining({ y: 0, s: 1 })]);
    a.update(mid(rm[0]!));
    const mid1 = a.leaving();
    expect(mid1.pieces[0]!.y).toBeGreaterThan(5);
    expect(mid1.pieces[0]!.s).toBeLessThan(1);
    expect(mid1.belts.map(b => b.beltId)).toEqual(['belt-p1-b-1-6']);
    a.update(plan.baseMs + 1);
    expect(a.leaving().pieces).toHaveLength(0);
    a.dispose();
  });

  it('a belt picked up lifts away', () => {
    const blank = piece('b', 'blank', -1, 0, null);
    const s = { ...staged([blank]), belts: [{ id: 'belt-p0-b-1-6', ownerId: 0 as PlayerId, pieceId: 'b', fromPoint: 1, toPoint: 6 }] };
    const { plan } = move(s, { type: 'REMOVE_BELT', beltId: 'belt-p0-b-1-6' });
    expect(ofKind(plan, 'unbelt').map(x => x.beltId)).toEqual(['belt-p0-b-1-6']);
  });

  it('Changing Priorities: the last Control Module travels to the other building; the Teleporter goes home and the material to the bank', () => {
    const from = { ...piece('a', 'plateFact', -1, 0, 0, 5, 3) };
    const fromFull = { ...from, input: withTeleporter({ ...from.input!, slots: ['ore'] }, 0, 0), output: { ...from.output!, slots: ['plate' as const] } };
    const to = piece('c', 'sphereFact', 0, 1, null);
    const s = withHand(staged([fromFull, to], x => ({ ...x, globalTeleporterCount: 1 })), 'changingPriorities');
    const { prev, next, plan } = move(s, { type: 'PLAY_CARD', cardType: 'changingPriorities', pieceId: 'a', toPieceId: 'c', controlModule: 5 });
    expect(next.board.find(p => p.id === 'a')!.claims).toEqual([]);
    const um = ofKind(plan, 'unmodule');
    expect(um).toEqual([expect.objectContaining({ pieceId: 'a', owner: 0, module: 5, toPieceId: 'c', toIndex: 0, dur: DUR.moduleMove })]);
    // It is not also dropped onto the other building from above.
    expect(ofKind(plan, 'module').filter(x => x.pieceId === 'c')).toHaveLength(0);
    expect(ofKind(plan, 'unteleport')).toEqual([expect.objectContaining({ pieceId: 'a', buffer: 'input', slot: 0, owner: 0 })]);
    expect(ofKind(plan, 'toPlayer').filter(x => x.item === 'teleporter').map(x => x.player)).toEqual([0]);
    expect(ofKind(plan, 'leave').map(x => `${x.buffer}:${x.material}`).sort()).toEqual(['input:ore', 'output:plate']);
    expect(ofKind(plan, 'consume')).toHaveLength(0);
    const a = animator();
    a.start(prev, next, plan.steps, 1, 0, sideLayout(boardBounds(next.board), next.mineCount));
    a.update(mid(um[0]!));
    const m = a.leaving().modules[0]!;
    expect(m.to?.piece.id).toBe('c');
    expect(m.to!.t).toBeGreaterThan(0);
    expect(m.to!.t).toBeLessThan(1);
    expect(a.claim('c', 0)).toBe('hide');
    a.update(um[0]!.at + um[0]!.dur + 1);
    expect(a.claim('c', 0)).not.toBe('hide');
    a.dispose();
  });

  it('Changing Priorities with a module staying behind: it moves to its new spot with the leaving one, not at once', () => {
    const from = piece('a', 'tesseractFact', -1, 0, 0, 4, 3);
    const two = { ...from, claims: [{ ownerId: 0 as PlayerId, controlModule: 4 }, { ownerId: 0 as PlayerId, controlModule: 6 }] };
    const to = piece('c', 'sphereFact', 0, 1, null);
    const s = withHand(staged([two, to]), 'changingPriorities');
    const { prev, next, plan } = move(s, { type: 'PLAY_CARD', cardType: 'changingPriorities', pieceId: 'a', toPieceId: 'c', controlModule: 4 });
    expect(next.board.find(p => p.id === 'a')!.claims).toEqual([{ ownerId: 0, controlModule: 6 }]);
    const um = ofKind(plan, 'unmodule');
    const leaving = um.find(x => x.module === 4)!;
    expect(leaving).toMatchObject({ pieceId: 'a', index: 0, toPieceId: 'c' });
    // Module 6 was the second of two on the building; now it is the only one, in the middle.
    const stays = um.find(x => x.module === 6)!;
    expect(stays).toMatchObject({ pieceId: 'a', index: 1, owner: 0, toPieceId: 'a', toIndex: 0 });
    // Together with (or after) the leaving one, never before it.
    expect(stays.at).toBeGreaterThanOrEqual(leaving.at);
    expect(stays.at).toBeLessThan(leaving.at + leaving.dur);
    // Nothing comes back to the tray or drops from above for it.
    expect(ofKind(plan, 'toPlayer').filter(x => x.item === 'module')).toHaveLength(0);
    expect(ofKind(plan, 'module').filter(x => x.pieceId === 'a')).toHaveLength(0);
    // Drawn: at its old spot until its step starts, travelling meanwhile, then in its new spot.
    const a = animator();
    a.start(prev, next, plan.steps, 1, 0, sideLayout(boardBounds(next.board), next.mineCount));
    a.update(0);
    expect(a.claim('a', 0)).toBe('hide');
    expect(a.leaving().modules.find(x => x.module === 6)).toMatchObject({ index: 1, of: 2, to: { index: 0, of: 1, t: 0 } });
    a.update(mid(stays));
    const m = a.leaving().modules.find(x => x.module === 6)!;
    expect(m.to!.piece.id).toBe('a');
    expect(m.to!.t).toBeGreaterThan(0);
    expect(m.to!.t).toBeLessThan(1);
    a.update(stays.at + stays.dur + 1);
    expect(a.claim('a', 0)).not.toBe('hide');
    expect(a.leaving().modules.find(x => x.module === 6)).toBeUndefined();
    a.dispose();
  });

  it('Asset Forfeiture: Plates lift out of every output and fly to the player', () => {
    const mine = piece('p', 'plateFact', -1, 0, 0, 5, 3), theirs = piece('q', 'plateFact', 0, 1, 1, 4);
    const s = withHand(staged([{ ...mine, output: { ...mine.output!, slots: ['plate'] } }, { ...theirs, output: { ...theirs.output!, slots: ['plate'] } }]), 'assetForfeiture');
    const { plan } = move(s, { type: 'PLAY_CARD', cardType: 'assetForfeiture' });
    expect(ofKind(plan, 'leave').map(x => x.pieceId).sort()).toEqual(['p', 'q']);
    const flights = ofKind(plan, 'toPlayer').filter(x => x.item === 'plate');
    expect(flights.map(x => x.player)).toEqual([0, 0]);
    const leave = ofKind(plan, 'leave')[0]!;
    expect(flights[0]!.at).toBeGreaterThanOrEqual(leave.at);
  });

  it('an upgrade is still an upgrade (the module hops in place), not a module leaving', () => {
    const b = piece('u', 'plateFact', -1, 0, 0, 4, 3);
    const s = staged([b], x => ({ ...x, phase: 'roundEnd', players: x.players.map(p => (p.id === 0 ? { ...p, freeUpgradesRemaining: 1 } : p)) }));
    const { plan } = move(s, { type: 'UPGRADE_BUILDING', pieceId: 'u', oldModule: 4, newModule: 5, freeCredits: 1 });
    expect(ofKind(plan, 'module')).toEqual([expect.objectContaining({ pieceId: 'u', upgrade: true, replaced: 4 })]);
    expect(ofKind(plan, 'unmodule')).toHaveLength(0);
  });

  it('an upgrade names the module it replaced by owner and number, not by its place among the claims', () => {
    // Two of player 0's modules on one building, the order changed between the states: 4 and 6
    // before, 6 and 7 after. The 7 replaced the 4 (the 6 stayed), though the 7 sits where the 6 was.
    const b = piece('u', 'tesseractFact', -1, 0, 0, 4, 3);
    const prev = staged([{ ...b, claims: [{ ownerId: 0, controlModule: 4 }, { ownerId: 0, controlModule: 6 }] }]);
    const next = { ...prev, board: prev.board.map(p => (p.id === 'u' ? { ...p, claims: [{ ownerId: 0 as PlayerId, controlModule: 6 }, { ownerId: 0 as PlayerId, controlModule: 7 }] } : p)) };
    const plan = planTransition(prev, next, []);
    expect(ofKind(plan, 'module')).toEqual([expect.objectContaining({ pieceId: 'u', index: 1, upgrade: true, replaced: 4 })]);
  });
});
