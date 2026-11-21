import { describe, it, expect } from 'vitest';
import { createGame } from '../rules/setup';
import { applyAction } from '../reducer';
import { playerStats } from '../rules/stats';
import { reachActionsPhase, expectOk, activePlayer } from './helpers';
import type { GameState, BoardPiece, Player, Belt } from '../state';

function patchPlayer(state: GameState, id: number, o: Partial<Player>): GameState {
  return { ...state, players: state.players.map((p, i) => (i === id ? { ...p, ...o } : p)) };
}

describe('player stats', () => {
  it('starts every player with zeroed cumulative counters', () => {
    const s = createGame(1, 2);
    for (const p of s.players) {
      expect(p.stats).toEqual({ cardsPurchased: 0, cardsPlayed: 0, modulesUpgraded: 0 });
    }
  });

  it('derives per-player rows from state', () => {
    let s = createGame(1, 2);
    // Player 0: resources, three modules placed (18 → 15 left), cumulative counters set.
    s = patchPlayer(s, 0, {
      inventory: { ore: 1, plate: 2, sphere: 3, tesseract: 4 },
      controlModules: Array.from({ length: 15 }, (_, i) => i + 4), // modules 1-3 "used"
      stats: { cardsPurchased: 6, cardsPlayed: 2, modulesUpgraded: 5 },
    });
    // A plate factory claimed by player 0, plus two of player 0's belts on the board.
    const pf: BoardPiece = {
      id: 'pf', type: 'plateFact', coord: { q: 40, r: 0 }, rotation: 0,
      claims: [{ ownerId: 0, controlModule: 3 }], input: null, output: null,
    };
    const belts: Belt[] = [
      { id: 'b1', ownerId: 0, pieceId: 'pf', fromPoint: 4, toPoint: 10 },
      { id: 'b2', ownerId: 1, pieceId: 'pf', fromPoint: 5, toPoint: 11 }, // opponent's — not counted
    ];
    s = { ...s, board: [...s.board, pf], belts };

    const row = playerStats(s)[0]!;
    expect(row.tesseracts).toBe(4);
    expect(row.ore).toBe(1);
    expect(row.plate).toBe(2);
    expect(row.sphere).toBe(3);
    expect(row.buildingsClaimed).toBe(1);
    expect(row.modulesUsed).toBe(3);          // 18 − 15 in tray
    expect(row.beltsUsed).toBe(1);            // only player 0's belt
    expect(row.cardsPurchased).toBe(6);
    expect(row.cardsPlayed).toBe(2);
    expect(row.modulesUpgraded).toBe(5);
    expect(typeof row.longestBelt).toBe('number');
    expect(typeof row.totalTesseracts).toBe('number');
  });

  it('counts a bought card as purchased', () => {
    let s = reachActionsPhase(42, 2);
    const pid = activePlayer(s);
    s = patchPlayer(s, pid, { inventory: { ore: 5, plate: 0, sphere: 0, tesseract: 0 } });
    s = { ...s, cardDeck: ['sinkHole', ...s.cardDeck] }; // a normal (hand) card
    const before = s.players[pid]!.stats.cardsPurchased;
    const ns = expectOk(applyAction(s, { type: 'BUY_CARD' }));
    expect(ns.players[pid]!.stats.cardsPurchased).toBe(before + 1);
    expect(ns.players[pid]!.stats.cardsPlayed).toBe(0); // in hand, not played yet
  });

  it('counts a play-on-draw card as both purchased and played', () => {
    let s = reachActionsPhase(42, 2);
    const pid = activePlayer(s);
    s = patchPlayer(s, pid, { inventory: { ore: 5, plate: 0, sphere: 0, tesseract: 0 } });
    s = { ...s, cardDeck: ['solarFlare', ...s.cardDeck] }; // resolves immediately on draw
    const ns = expectOk(applyAction(s, { type: 'BUY_CARD' }));
    expect(ns.players[pid]!.stats.cardsPurchased).toBe(1);
    expect(ns.players[pid]!.stats.cardsPlayed).toBe(1);
  });
});
