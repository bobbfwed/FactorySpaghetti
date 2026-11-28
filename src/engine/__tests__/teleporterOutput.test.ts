import { describe, it, expect } from 'vitest';
import { createGame } from '../rules/setup';
import { applyAction } from '../reducer';
import { drainOutputTeleporters } from '../rules/flow';
import { INVENTORY_CAP } from '../config';
import type { GameState, BoardPiece, Player, PlayerId } from '../state';

const ME: PlayerId = 0;

function plateFactory(overrides: Partial<BoardPiece> = {}): BoardPiece {
  return {
    id: 'pf', type: 'plateFact', coord: { q: 1, r: 0 },
    claims: [{ ownerId: ME, controlModule: 3 }],
    input: { slots: ['ore'], teleporters: [] },
    output: { slots: [null], teleporters: [ME] }, // output teleporter owned by me
    ...overrides,
  };
}

// Put `piece`'s owner as the active player in a roll-phase state with power.
function rollState(base: GameState, piece: BoardPiece, activeOwner = true): GameState {
  const ownerId = piece.claims[0]?.ownerId ?? 0;
  const players = base.players.map((p): Player => ({ ...p, powerTokens: 10 }));
  const active = activeOwner ? ownerId : base.turnOrder.find(id => id !== ownerId)!;
  const turnOrder = [active, ...base.turnOrder.filter(id => id !== active)];
  return { ...base, board: [...base.board, piece], players, turnOrder, activePlayerIndex: 0, phase: 'roll' };
}

describe('output teleporter → inventory', () => {
  const base = createGame(1, 2);

  it('diverts freshly produced material to inventory on operate (active player)', () => {
    const s = rollState(base, plateFactory());
    const rolled = applyAction(s, { type: 'ROLL_DICE', rolls: [3] });
    expect(rolled.ok).toBe(true);
    if (!rolled.ok) return;
    // Active player's factory is deferred; operate it.
    expect(rolled.state.pendingFactoryOps.map(e => e.pieceId)).toContain('pf');
    const op = applyAction(rolled.state, { type: 'OPERATE_BUILDING', pieceId: 'pf' });
    expect(op.ok).toBe(true);
    if (!op.ok) return;
    expect(op.state.players[ME]!.inventory.plate).toBe(1);
    expect(op.state.board.find(p => p.id === 'pf')!.output?.slots[0]).toBeNull();
  });

  it('drains material already stuck in the buffer (placed teleporter after production)', () => {
    // A plate is already in the buffer (e.g. produced before the teleporter, or overflow).
    const stuck = plateFactory({ output: { slots: ['plate'], teleporters: [ME] } });
    const s = rollState(base, stuck);
    const rolled = applyAction(s, { type: 'ROLL_DICE', rolls: [3] });
    expect(rolled.ok).toBe(true);
    if (!rolled.ok) return;
    // Flow resolution during the roll drains the stuck plate to inventory.
    expect(rolled.state.players[ME]!.inventory.plate).toBeGreaterThanOrEqual(1);
    expect(rolled.state.board.find(p => p.id === 'pf')!.output?.slots[0]).toBeNull();
  });

  it('collects when the owner operates on an opponent\'s roll', () => {
    // Factory owned by ME but it is the OPPONENT's turn; a matching roll ACTIVATES it and
    // defers to ME's decision. When ME operates (off-turn), the output teleporter diverts
    // the product straight to ME's inventory.
    const s = rollState(base, plateFactory(), /* activeOwner */ false);
    const rolled = applyAction(s, { type: 'ROLL_DICE', rolls: [3] });
    expect(rolled.ok).toBe(true);
    if (!rolled.ok) return;
    expect(rolled.state.pendingFactoryOps).toContainEqual({ pieceId: 'pf', ownerId: ME });
    const op = applyAction(rolled.state, { type: 'OPERATE_BUILDING', pieceId: 'pf', ownerId: ME });
    expect(op.ok).toBe(true);
    if (!op.ok) return;
    expect(op.state.players[ME]!.inventory.plate).toBe(1);
    expect(op.state.board.find(p => p.id === 'pf')!.output?.slots[0]).toBeNull();
  });

  it('respects the per-material cap — overflow stays in the buffer', () => {
    const atCap: GameState = {
      ...base,
      players: base.players.map((p, i) => (i === ME ? { ...p, inventory: { ...p.inventory, plate: INVENTORY_CAP } } : p)),
    };
    const stuck = plateFactory({ output: { slots: ['plate'], teleporters: [ME] } });
    const drained = drainOutputTeleporters({ ...atCap, board: [...atCap.board, stuck] });
    expect(drained.players[ME]!.inventory.plate).toBe(INVENTORY_CAP);          // unchanged
    expect(drained.board.find(p => p.id === 'pf')!.output?.slots[0]).toBe('plate'); // stays
  });

  it('leaves non-teleporter output buffers untouched', () => {
    const noTele = plateFactory({ output: { slots: ['plate'], teleporters: [] } });
    const drained = drainOutputTeleporters({ ...base, board: [...base.board, noTele] });
    expect(drained.board.find(p => p.id === 'pf')!.output?.slots[0]).toBe('plate'); // not drained
    expect(drained.players[ME]!.inventory.plate).toBe(0);
  });

  it('drainOutputTeleporters only credits the teleporter owner', () => {
    const owned = plateFactory({ output: { slots: ['plate'], teleporters: [1 as PlayerId] } });
    const drained = drainOutputTeleporters({ ...base, board: [...base.board, owned] });
    expect(drained.players[1]!.inventory.plate).toBe(1);
    expect(drained.players[ME]!.inventory.plate).toBe(0);
  });
});
