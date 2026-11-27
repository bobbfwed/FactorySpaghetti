// The play-style bots' board reading (styles/analysis.ts) counts a feed only where the engine
// moves material: a building's output touching an input feeds it only between one player's
// buildings, or out of an unclaimed building (RULES_CHANGES.md #51).

import { describe, expect, it } from 'vitest';
import type { BoardPiece, GameState, PlayerId } from '../../engine/state';
import type { Material } from '../../engine/config';
import { createGame } from '../../engine/rules/setup';
import { resolveDirectAdjacency } from '../../engine/rules/flow';
import { feedAt, inputFeeds, outputFeedsMine } from '../styles/analysis';

type Claims = BoardPiece['claims'];

// Plate Factory F at (3,0): its output #8 touches input #1 (position 0) of the Sphere Factory G at (4,0).
const F = (claims: Claims, out: Material | null = 'plate'): BoardPiece => ({
  id: 'F', type: 'plateFact', coord: { q: 3, r: 0 }, rotation: 0, claims,
  input: { slots: [null], teleporterOwner: null }, output: { slots: [out], teleporterOwner: null },
});
const G = (claims: Claims): BoardPiece => ({
  id: 'G', type: 'sphereFact', coord: { q: 4, r: 0 }, rotation: 0, claims,
  input: { slots: [null, null], teleporterOwner: null }, output: { slots: [null], teleporterOwner: null },
});
const of = (p: PlayerId, m = 4): Claims => [{ ownerId: p, controlModule: m }];

function state(board: BoardPiece[]): GameState {
  return { ...createGame(1, 2), board, belts: [] };
}

describe('feedAt follows the engine on direct contact (#51)', () => {
  it("another player's touching output does not feed my building", () => {
    const s = state([F(of(1)), G(of(0, 5))]);
    expect(feedAt(s, s.board[1]!, 0, 0)).toBeNull();
    expect(inputFeeds(s, s.board[1]!, 0)).toEqual([null, null]);
    // And my output next to their input is not counted as carried away (it is blocked).
    const t = state([F(of(0)), G(of(1, 5))]);
    expect(outputFeedsMine(t, t.board[0]!, 0)).toBe(false);
  });

  it('my own touching output, an unclaimed one, or a co-owner\'s feeds it', () => {
    for (const fc of [of(0), [] as Claims, [...of(1), ...of(0, 6)]]) {
      const s = state([F(fc), G(of(0, 5))]);
      expect(feedAt(s, s.board[1]!, 0, 0), JSON.stringify(fc)).toEqual({ material: 'plate', fromPieceId: 'F', viaBelts: 0 });
    }
    // A building I share with the owner of the touching output: the engine moves it, so it counts.
    const shared = state([F(of(1)), G([...of(1, 5), ...of(0, 6)])]);
    expect(feedAt(shared, shared.board[1]!, 0, 0)).not.toBeNull();
  });

  it('a building I may claim is judged as if I held it', () => {
    const mine = state([F(of(0)), G([])]);
    expect(feedAt(mine, mine.board[1]!, 0, 0)).not.toBeNull();
    const theirs = state([F(of(1)), G([])]);
    expect(feedAt(theirs, theirs.board[1]!, 0, 0)).toBeNull();
  });

  it('counts a direct feed exactly when the engine moves the material', () => {
    for (const fc of [of(0), of(1), [] as Claims, [...of(1), ...of(0, 6)]]) {
      for (const gc of [of(0, 5), of(1, 5), [...of(1, 5), ...of(0, 6)]]) {
        const s = state([F(fc), G(gc)]);
        const moved = resolveDirectAdjacency(s).board[1]!.input!.slots.includes('plate');
        const label = `F ${JSON.stringify(fc)}, G ${JSON.stringify(gc)}`;
        // Judged by a player who holds a claim on G.
        const me = gc[gc.length - 1]!.ownerId;
        expect(feedAt(s, s.board[1]!, 0, me) !== null, label).toBe(moved);
      }
    }
  });
});
