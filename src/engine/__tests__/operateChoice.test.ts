import { describe, it, expect } from 'vitest';
import { createGame } from '../rules/setup';
import { applyAction } from '../reducer';
import { makeBuffers } from '../rules/pieces';
import type { GameState, BoardPiece, Player, PlayerId, Material } from '../state';

// Build a roll-phase 2-player state with the given extra pieces; both players have power.
function rollBoard(extra: BoardPiece[], activeIndex = 0): GameState {
  const base = createGame(1, 2);
  return {
    ...base,
    board: [...base.board, ...extra],
    players: base.players.map((p): Player => ({ ...p, powerTokens: 10 })) as ReadonlyArray<Player>,
    turnOrder: [0, 1],
    activePlayerIndex: activeIndex,
    phase: 'roll',
  };
}

function factory(id: string, type: BoardPiece['type'], owner: PlayerId, module: number, slots: (Material | null)[]): BoardPiece {
  const buf = makeBuffers(type);
  return {
    id, type, coord: { q: 50, r: 0 }, rotation: 0, // far from the mine (no auto-feed)
    claims: [{ ownerId: owner, controlModule: module }],
    input: buf.input ? { slots, teleporters: [] } : null,
    output: buf.output ? { slots: [null], teleporters: [] } : null,
  };
}

describe('operate-on-any-roll is the owner\'s choice', () => {
  it('a roll activates every owner\'s factory as a pending choice (nothing auto-produces)', () => {
    const p0 = factory('pf0', 'plateFact', 0, 3, ['ore']);
    const p1 = factory('pf1', 'plateFact', 1, 3, ['ore']);
    const res = applyAction(rollBoard([p0, p1], 0), { type: 'ROLL_DICE', rolls: [3] });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    // Both defer to their owners; neither produced.
    expect(res.state.pendingFactoryOps).toContainEqual({ pieceId: 'pf0', ownerId: 0 });
    expect(res.state.pendingFactoryOps).toContainEqual({ pieceId: 'pf1', ownerId: 1 });
    expect(res.state.board.find(p => p.id === 'pf0')!.output?.slots[0]).toBeNull();
    expect(res.state.board.find(p => p.id === 'pf1')!.output?.slots[0]).toBeNull();
  });

  it('power plants are exempt — they auto-operate and are never pending', () => {
    const pp = factory('pp', 'powerPlant', 1, 3, [null]); // owned by non-active player 1
    const base = rollBoard([pp], 0);
    // Start player 1 below the token cap so auto-generation is observable.
    const before: GameState = {
      ...base,
      players: base.players.map((p, i): Player => (i === 1 ? { ...p, powerTokens: 0 } : p)),
    };
    const startTokens = before.players[1]!.powerTokens;
    const res = applyAction(before, { type: 'ROLL_DICE', rolls: [3] });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.state.pendingFactoryOps.some(e => e.pieceId === 'pp')).toBe(false);
    expect(res.state.players[1]!.powerTokens).toBeGreaterThan(startTokens); // auto-generated
  });

  it('blocks END_ACTIONS until every activation is resolved', () => {
    const p1 = factory('pf1', 'plateFact', 1, 3, ['ore']);
    const rolled = applyAction(rollBoard([p1], 0), { type: 'ROLL_DICE', rolls: [3] });
    expect(rolled.ok).toBe(true);
    if (!rolled.ok) return;

    // Active player 0 can't end actions while player 1's activation is unresolved.
    const blocked = applyAction(rolled.state, { type: 'END_ACTIONS' });
    expect(blocked.ok).toBe(false);
    if (blocked.ok) return;
    expect(blocked.error.code).toBe('PENDING_FACTORY_OPS');

    // Player 1 resolves their own activation off-turn (operate), then END_ACTIONS works.
    const op = applyAction(rolled.state, { type: 'OPERATE_BUILDING', pieceId: 'pf1', ownerId: 1 });
    expect(op.ok).toBe(true);
    if (!op.ok) return;
    expect(op.state.board.find(p => p.id === 'pf1')!.output?.slots[0]).toBe('plate');
    const ended = applyAction(op.state, { type: 'END_ACTIONS' });
    expect(ended.ok).toBe(true);
  });

  it('SKIP resolves an activation without producing or spending power', () => {
    const p1 = factory('pf1', 'plateFact', 1, 3, ['ore']);
    const rolled = applyAction(rollBoard([p1], 0), { type: 'ROLL_DICE', rolls: [3] });
    expect(rolled.ok).toBe(true);
    if (!rolled.ok) return;
    const skip = applyAction(rolled.state, { type: 'SKIP_FACTORY_ROLL', pieceId: 'pf1', ownerId: 1 });
    expect(skip.ok).toBe(true);
    if (!skip.ok) return;
    expect(skip.state.pendingFactoryOps.length).toBe(0);
    expect(skip.state.board.find(p => p.id === 'pf1')!.output?.slots[0]).toBeNull(); // no product
    expect(skip.state.board.find(p => p.id === 'pf1')!.input?.slots[0]).toBe('ore'); // input kept
  });
});
