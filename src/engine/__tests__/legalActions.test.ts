// legalActions must list exactly what applyAction accepts. These tests pin the two places
// where the list used to disagree with the engine (RULES_CHANGES #28, #29):
//   - Scouting Drone plays were listed at one cell with rotation 0 only (under-listed).
//   - A pending factory operation stayed listed after it could no longer run (over-listed),
//     and a round-end meeple operation completed by an input teleporter was not listed.

import { describe, it, expect } from 'vitest';
import { createGame } from '../rules/setup';
import { applyAction, legalActions } from '../reducer';
import { makeBuffers } from '../rules/pieces';
import type { Action } from '../actions';
import type { GameState, BoardPiece, Player, PlayerId, Material } from '../state';
import { activePlayer, reachActionsPhase } from './helpers';

type PlayCard = Extract<Action, { type: 'PLAY_CARD' }>;

function patchPlayer(s: GameState, p: PlayerId, patch: Partial<Player>): GameState {
  return { ...s, players: s.players.map((x, i) => (i === p ? { ...x, ...patch } : x)) };
}

function mustApply(s: GameState, a: Action): GameState {
  const r = applyAction(s, a);
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
  return r.state;
}

const key = (a: Action): string => JSON.stringify(a);

// ── Defect 1: Scouting Drone ──────────────────────────────────────────────────

describe('Scouting Drone: legalActions lists every placement applyAction accepts', () => {
  const base = reachActionsPhase(5, 3);
  const me = activePlayer(base);
  const s = patchPlayer({ ...base, cardsPlayedThisTurn: 0 }, me, { hand: ['scoutingDrone'] });
  const drones = legalActions(s, me).filter((a): a is PlayCard => a.type === 'PLAY_CARD' && a.cardType === 'scoutingDrone');

  it('covers more than one cell and more than one rotation', () => {
    const cells = new Set(drones.map(a => `${a.coord!.q},${a.coord!.r}`));
    const rotations = new Set(drones.map(a => a.rotation));
    expect(cells.size).toBeGreaterThan(1);
    expect([...rotations].sort()).toEqual([0, 1, 2, 3, 4, 5]);
    // Each selectable piece gets every cell × rotation.
    const pieces = new Set(drones.map(a => `${a.stackIndex}:${a.pieceIndex}`));
    expect(drones.length).toBe(pieces.size * cells.size * 6);
  });

  it('every listed drone play is accepted, and lands at the chosen cell and rotation', () => {
    for (const a of drones) {
      const r = applyAction(s, a);
      expect(r.ok, key(a)).toBe(true);
      if (!r.ok) continue;
      const placed = r.state.board[r.state.board.length - 1]!;
      expect(placed.coord).toEqual(a.coord);
      expect(placed.rotation).toBe(a.rotation);
    }
  });

  it('every placement applyAction accepts (for the listed pieces) is in the list', () => {
    const listed = new Set(drones.map(key));
    const pieces = [...new Set(drones.map(a => `${a.stackIndex}:${a.pieceIndex}`))].map(k => k.split(':').map(Number));
    let accepted = 0;
    for (const [si, pi] of pieces) {
      for (let q = -6; q <= 6; q++) {
        for (let r = -6; r <= 6; r++) {
          for (let rotation = 0; rotation < 6; rotation++) {
            const a: PlayCard = {
              type: 'PLAY_CARD', cardType: 'scoutingDrone',
              stackIndex: si as 0 | 1 | 2, pieceIndex: pi!, coord: { q, r }, rotation,
            };
            if (!applyAction(s, a).ok) continue;
            accepted++;
            expect(listed.has(key(a)), key(a)).toBe(true);
          }
        }
      }
    }
    expect(accepted).toBe(drones.length);
  });

  it('matches the cells and rotations offered for a normal piece placement', () => {
    // The same board in the placePiece phase: the drone's cells × rotations equal PLACE_PIECE's.
    const placeState: GameState = { ...s, phase: 'placePiece' };
    const place = legalActions(placeState, me).filter(a => a.type === 'PLACE_PIECE' && a.stackIndex === 0);
    const placeKeys = new Set(place.map(a => (a.type === 'PLACE_PIECE' ? `${a.coord.q},${a.coord.r}/${a.rotation}` : '')));
    const droneKeys = new Set(drones.filter(a => a.stackIndex === 0 && a.pieceIndex === 0)
      .map(a => `${a.coord!.q},${a.coord!.r}/${a.rotation}`));
    expect(droneKeys).toEqual(placeKeys);
  });
});

// ── Defect 2: a building claimed by two players, both matching the roll ───────

function factory(id: string, claims: BoardPiece['claims'], slots: (Material | null)[], teleporterOwner: PlayerId | null = null): BoardPiece {
  const buf = makeBuffers('plateFact');
  return {
    id, type: 'plateFact', coord: { q: 50, r: 0 }, rotation: 0, // far from the mine (no auto-feed)
    claims,
    input: buf.input ? { slots, teleporterOwner } : null,
    output: buf.output ? { slots: [null], teleporterOwner: null } : null,
  };
}

function rollBoard(extra: BoardPiece[]): GameState {
  const base = createGame(1, 2);
  return {
    ...base,
    board: [...base.board, ...extra],
    players: base.players.map((p): Player => ({ ...p, powerTokens: 10 })) as ReadonlyArray<Player>,
    turnOrder: [0, 1],
    activePlayerIndex: 0,
    phase: 'roll',
  };
}

describe('pending factory operation: listed only while the engine accepts it', () => {
  const shared = factory('pf', [{ ownerId: 0, controlModule: 3 }, { ownerId: 1, controlModule: 3 }], ['ore']);
  const rolled = mustApply(rollBoard([shared]), { type: 'ROLL_DICE', rolls: [3] });
  const operate0: Action = { type: 'OPERATE_BUILDING', pieceId: 'pf', ownerId: 0 };
  const operate1: Action = { type: 'OPERATE_BUILDING', pieceId: 'pf', ownerId: 1 };
  const skip1: Action = { type: 'SKIP_FACTORY_ROLL', pieceId: 'pf', ownerId: 1 };

  it('both owners are offered operate and skip right after the roll', () => {
    expect(rolled.pendingFactoryOps).toEqual([{ pieceId: 'pf', ownerId: 0 }, { pieceId: 'pf', ownerId: 1 }]);
    expect(legalActions(rolled, 0).map(key)).toContain(key(operate0));
    expect(legalActions(rolled, 1).map(key)).toContain(key(operate1));
    expect(legalActions(rolled, 1).map(key)).toContain(key(skip1));
  });

  it('after the first owner operates, the second owner is offered the skip but not the operate — and the engine agrees', () => {
    const after = mustApply(rolled, operate0);
    expect(after.board.find(p => p.id === 'pf')!.output!.slots[0]).toBe('plate'); // output now full
    expect(after.pendingFactoryOps).toEqual([{ pieceId: 'pf', ownerId: 1 }]);

    const legal1 = legalActions(after, 1).map(key);
    expect(legal1).toEqual([key(skip1)]);

    const refused = applyAction(after, operate1);
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error.code).toBe('CANNOT_OPERATE');
    expect(applyAction(after, skip1).ok).toBe(true);
  });
});

describe('round-end meeple operation: listed exactly when the engine accepts it', () => {
  // Player 0's meeple sits on their plate factory; its input is empty but has player 0's
  // input teleporter, and player 0 holds ore, so the engine completes the recipe from inventory.
  function roundEnd(inventoryOre: number, powerTokens: number, operated = false): GameState {
    const pf = factory('pf', [{ ownerId: 0, controlModule: 3 }], [null], 0);
    const base = createGame(1, 2);
    const s: GameState = {
      ...base, board: [...base.board, pf], turnOrder: [0, 1], activePlayerIndex: 0, phase: 'roundEnd',
    };
    return patchPlayer(s, 0, {
      meepleOnPieceId: 'pf', meepleSlotIndex: null, meepleOperatedThisRound: operated, powerTokens,
      inventory: { ore: inventoryOre, plate: 0, sphere: 0, tesseract: 0 },
    });
  }
  // The ore goes in only when player 0 names it as the supply (RULES_CHANGES.md #45).
  const operate: Action = { type: 'OPERATE_BUILDING', pieceId: 'pf', supply: ['ore'] };
  const plain: Action = { type: 'OPERATE_BUILDING', pieceId: 'pf' };
  const listed = (s: GameState, a: Action = operate): boolean => legalActions(s, 0).some(l => key(l) === key(a));

  it('an input teleporter with ore supplied from inventory makes it operable; without, it is not', () => {
    const s = roundEnd(2, 5);
    expect(applyAction(s, operate).ok).toBe(true);
    expect(listed(s)).toBe(true);
    expect(applyAction(s, plain).ok).toBe(false);
    expect(listed(s, plain)).toBe(false);
  });

  it('not listed when the engine refuses it (no material, no power, or already operated)', () => {
    for (const s of [roundEnd(0, 5), roundEnd(2, 0), roundEnd(2, 5, true)]) {
      expect(applyAction(s, operate).ok).toBe(false);
      expect(listed(s)).toBe(false);
    }
  });
});
