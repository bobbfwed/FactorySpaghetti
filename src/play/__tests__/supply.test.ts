// The supply chooser (RULES_CHANGES.md #45): running a building with my teleporter on its input.
// Every listed run — plain and with each supply — has its own button that sends exactly that move;
// nothing is ever supplied that the player did not pick; Power Plant decisions; the case where
// nothing can be supplied.

import { describe, expect, it } from 'vitest';
import type { Action } from '../../engine/actions';
import type { BoardPiece, GameState, Material, Player, PlayerId } from '../../engine/state';
import { legalActions } from '../../engine';
import { W } from '../words';
import { operatePrompts } from '../../app/gameText';
import type { Room } from '../../session/room';
import { active, atActions, findState, gesturesFor, harness } from './helpers';

type Inv = Record<Material, number>;

function patchPlayer(s: GameState, p: PlayerId, patch: Partial<Player>): GameState {
  return { ...s, players: s.players.map((x, i) => (i === p ? { ...x, ...patch } : x)) };
}

function patchPiece(s: GameState, id: string, patch: Partial<BoardPiece>): GameState {
  return { ...s, board: s.board.map(x => (x.id === id ? { ...x, ...patch } : x)) };
}

/** A building of `owner`'s turned into `type` with their teleporter on its input, activated for them. */
function activated(owner: 'active' | 'other', type: 'tesseractFact' | 'sphereFact' | 'powerPlant', slots: (Material | null)[], inv: Inv, power = 5):
  { s: GameState; p: PlayerId; pieceId: string } {
  const { state } = atActions(5, 3);
  const me = active(state);
  const p = owner === 'active' ? me : state.turnOrder.find(x => x !== me)!;
  const kind = type === 'powerPlant' ? 'powerPlant' : 'plateFact';
  const piece = state.board.find(x => x.type === kind && x.claims.some(c => c.ownerId === p))!;
  let s = patchPiece(state, piece.id, {
    type,
    input: { slots, teleporterOwner: p },
    output: type === 'powerPlant' ? piece.output : { slots: [null], teleporterOwner: null },
  });
  s = patchPlayer(s, p, { inventory: inv, powerTokens: power });
  s = { ...s, pendingFactoryOps: [{ pieceId: piece.id, ownerId: p }] };
  return { s, p, pieceId: piece.id };
}

const operates = (s: GameState, p: PlayerId, id: string): Action[] =>
  legalActions(s, p).filter(a => (a.type === 'OPERATE_BUILDING' || a.type === 'SKIP_FACTORY_ROLL') && a.pieceId === id);

/** Every listed answer is reached by its own gesture, and each button sends exactly its own move. */
function everyAnswerReachable(s: GameState, p: PlayerId, id: string): void {
  const listed = operates(s, p, id);
  expect(listed.length).toBeGreaterThan(0);
  for (const a of listed) {
    const { c, sent } = harness(s, p);
    gesturesFor(c, a);
    expect(sent).toEqual([a]);
  }
  // The prompt offers nothing else: one button per listed move.
  const { c } = harness(s, p);
  const pr = c.view.prompts.find(x => x.id === `op:${id}`)!;
  expect(pr.options.length).toBe(listed.length);
  for (const o of pr.options) {
    const h2 = harness(s, p);
    h2.c.choose(o.id);
    expect(h2.sent).toHaveLength(1);
    expect(listed).toContainEqual(h2.sent[0]);
  }
}

describe('supply chooser: a factory with my teleporter on its empty input', () => {
  const inv: Inv = { ore: 1, plate: 1, sphere: 2, tesseract: 0 };

  it('offers one button per way to run it, in the designer\'s words, and each sends exactly that run', () => {
    const { s, p, pieceId } = activated('active', 'tesseractFact', [null, null, null], inv);
    const listed = operates(s, p, pieceId);
    expect(listed.some(a => a.type === 'OPERATE_BUILDING' && (a.supply?.length ?? 0) === 3)).toBe(true);
    const { c } = harness(s, p);
    const pr = c.view.prompts[0]!;
    expect(pr.supply).not.toBeNull();
    expect(pr.supply!.heading).toMatch(/^The Tesseract Factory needs one of these to run: /);
    expect(pr.supply!.slots).toEqual([null, null, null]);
    expect(pr.supply!.have).toEqual(inv);
    expect(pr.supply!.missing).toBeNull();
    const labels = pr.options.map(o => o.label);
    expect(labels).toContain('Provide a Sphere, a Plate and an Ore');
    expect(labels).toContain('Provide 2 Spheres and a Plate');
    expect(labels).toContain('Provide 2 Spheres and an Ore');
    expect(labels[labels.length - 1]).toBe(W.promptSkip);
    // Each supplied option shows its materials and what running costs and makes, without hovering.
    for (const o of pr.options.filter(x => x.id.includes(':run:'))) {
      expect(o.materials?.length).toBe(3);
      expect(o.detail).toMatch(/^Pay 3 Power Tokens, use .+, make 1 Tesseract$/);
    }
    everyAnswerReachable(s, p, pieceId);
  });

  it('one recipe left: "needs a Plate to run", and the plain run is not offered while the input is not full', () => {
    const { s, p, pieceId } = activated('active', 'sphereFact', ['ore', null], inv);
    const { c } = harness(s, p);
    const pr = c.view.prompts[0]!;
    expect(pr.supply!.heading).toBe('The Sphere Factory needs a Plate to run.');
    expect(pr.options.map(o => o.label)).toEqual(['Provide a Plate', W.promptSkip]);
    everyAnswerReachable(s, p, pieceId);
  });

  it('never sends a supplied run the player did not pick: Skip and closing send nothing supplied', () => {
    const { s, p, pieceId } = activated('active', 'sphereFact', ['ore', null], inv);
    const { c, sent } = harness(s, p);
    c.tap({ kind: 'piece', pieceId });
    expect(c.view.menu?.supply).toEqual(c.view.prompts[0]!.supply);
    c.cancel();
    expect(sent).toEqual([]);
    c.choose(`op:${pieceId}:skip`);
    expect(sent).toEqual([{ type: 'SKIP_FACTORY_ROLL', pieceId, ownerId: p }]);
  });

  it('nothing to supply: says what is missing and offers only what is listed (Skip)', () => {
    const { s, p, pieceId } = activated('active', 'tesseractFact', [null, null, null], { ore: 2, plate: 0, sphere: 0, tesseract: 0 });
    // The engine does not activate it then; the entry stands for one gone stale.
    const listed = operates(s, p, pieceId);
    expect(listed.map(a => a.type)).toEqual(['SKIP_FACTORY_ROLL']);
    const { c } = harness(s, p);
    const pr = c.view.prompts[0]!;
    expect(pr.supply!.missing).toBe(W.supplyLacking);
    expect(pr.options.map(o => o.id)).toEqual([`op:${pieceId}:skip`]);
    everyAnswerReachable(s, p, pieceId);
  });

  it('not enough Power Tokens: says so', () => {
    const { s, p } = activated('active', 'tesseractFact', [null, null, null], inv, 1);
    const pr = harness(s, p).c.view.prompts[0]!;
    expect(pr.supply!.missing).toBe(W.supplyNoPower(3, 1));
  });

  it('on another player\'s turn the prompt says what the timer does', () => {
    const { s, p, pieceId } = activated('other', 'sphereFact', ['ore', null], inv);
    expect(active(s)).not.toBe(p);
    const pr = harness(s, p).c.view.prompts[0]!;
    expect(pr.timeout).toBe(W.promptTimeout);
    expect(harness(s, active(s)).c.view.prompts).toEqual([]);
    everyAnswerReachable(s, p, pieceId);
  });
});

describe('supply chooser: Power Plant decisions', () => {
  it('runs as it is or with one material for more tokens; no Skip', () => {
    const { s, p, pieceId } = activated('active', 'powerPlant', [null], { ore: 1, plate: 1, sphere: 1, tesseract: 1 }, 2);
    const pr = harness(s, p).c.view.prompts[0]!;
    expect(pr.supply!.heading).toBe(W.supplyPlantAsk);
    expect(pr.options.map(o => o.label)).toEqual([W.runPlantAsIs(1), 'Provide an Ore', 'Provide a Plate', 'Provide a Sphere']);
    expect(pr.options.map(o => o.detail)).toEqual([W.runPowerPlant(1, 'nothing'), '+2 Power Tokens', '+5 Power Tokens', '+8 Power Tokens (your limit is 10)']);
    expect(pr.options.some(o => o.id.endsWith(':skip'))).toBe(false);
    everyAnswerReachable(s, p, pieceId);
  });

  it('at the Power Token limit only Skip is offered, and the prompt says why', () => {
    const { s, p, pieceId } = activated('active', 'powerPlant', [null], { ore: 1, plate: 0, sphere: 0, tesseract: 0 }, 10);
    const pr = harness(s, p).c.view.prompts[0]!;
    expect(pr.supply!.missing).toBe(W.supplyPlantFull);
    expect(pr.options.map(o => o.id)).toEqual([`op:${pieceId}:skip`]);
    everyAnswerReachable(s, p, pieceId);
  });
});

describe('supply chooser: the meeple\'s building at round end', () => {
  it('offers each listed supply in the building menu', () => {
    const { state, player } = findState((s, p) => {
      if (s.phase !== 'roundEnd' || active(s) !== p) return false;
      const pl = s.players[p]!;
      const b = s.board.find(x => x.id === pl.meepleOnPieceId);
      return !!b && b.type === 'plateFact' && pl.meepleSlotIndex === null && !pl.meepleOperatedThisRound;
    });
    const id = state.players[player]!.meepleOnPieceId!;
    let s = patchPiece(state, id, { input: { slots: [null], teleporterOwner: player }, output: { slots: [null], teleporterOwner: null } });
    s = patchPlayer(s, player, { inventory: { ore: 2, plate: 0, sphere: 0, tesseract: 0 } });
    const runs = legalActions(s, player).filter(a => a.type === 'OPERATE_BUILDING' && a.pieceId === id);
    expect(runs).toEqual([{ type: 'OPERATE_BUILDING', pieceId: id, supply: ['ore'] }]);
    const { c, sent } = harness(s, player);
    c.tap({ kind: 'piece', pieceId: id });
    expect(c.view.menu?.supply?.heading).toBe('The Plate Factory needs an Ore to run.');
    expect(c.view.menu?.items.some(i => i.id === 'menu:run:ore' && i.label === 'Provide an Ore')).toBe(true);
    c.choose('menu:run:ore');
    expect(sent).toEqual(runs);
  });
});

describe('text view: supplied runs are told apart', () => {
  it('names what each run provides', () => {
    const { s, pieceId } = activated('active', 'tesseractFact', [null, null, null], { ore: 1, plate: 1, sphere: 2, tesseract: 0 });
    const room = { game: s, phase: 'playing', seats: s.players.map((_, i) => ({ name: `P${i + 1}` })) } as unknown as Room;
    const pr = operatePrompts(room).find(x => x.pieceId === pieceId)!;
    expect(pr.options.map(o => o.label)).toEqual([
      'Run the Tesseract Factory, providing a Sphere, a Plate and an Ore',
      'Run the Tesseract Factory, providing 2 Spheres and an Ore',
      'Run the Tesseract Factory, providing 2 Spheres and a Plate',
      'Skip the Tesseract Factory',
    ]);
  });
});
