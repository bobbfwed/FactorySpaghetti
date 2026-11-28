// The play-style bots' board reading (styles/analysis.ts) counts a feed only where the engine
// moves material: a building's output touching an input feeds it only between one player's
// buildings, or out of an unclaimed building (RULES_CHANGES.md #51).

import { describe, expect, it } from 'vitest';
import type { BoardPiece, GameState, PlayerId } from '../../engine/state';
import type { Material } from '../../engine/config';
import { createGame } from '../../engine/rules/setup';
import { resolveDirectAdjacency } from '../../engine/rules/flow';
import { feedAt, fedFraction, inputFeeds, outputFeedsMine } from '../styles/analysis';
import { withTeleporter } from '../../engine/rules/teleporters';
import { teleporterWorthFor } from '../styles/styleBot';
import { TELEPORTER } from '../styles/profiles';

type Claims = BoardPiece['claims'];

// Plate Factory F at (3,0): its output #8 touches input #1 (position 0) of the Sphere Factory G at (4,0).
const F = (claims: Claims, out: Material | null = 'plate'): BoardPiece => ({
  id: 'F', type: 'plateFact', coord: { q: 3, r: 0 }, rotation: 0, claims,
  input: { slots: [null], teleporters: [] }, output: { slots: [out], teleporters: [] },
});
const G = (claims: Claims): BoardPiece => ({
  id: 'G', type: 'sphereFact', coord: { q: 4, r: 0 }, rotation: 0, claims,
  input: { slots: [null, null], teleporters: [] }, output: { slots: [null], teleporters: [] },
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

  it('teleporters (#53): a teleported output feeds nothing, a teleported single input is fed by nothing', () => {
    const tOut = { ...F(of(0)), output: { slots: ['plate' as Material], teleporters: [0 as PlayerId] } };
    const s = state([tOut, G(of(0, 5))]);
    expect(feedAt(s, s.board[1]!, 0, 0)).toBeNull();
    // A Power Plant at (4,0) with a teleporter on its input: F's touching output does not count.
    const pp = (tele: PlayerId | null): BoardPiece => ({
      id: 'G', type: 'powerPlant', coord: { q: 4, r: 0 }, rotation: 0, claims: of(0, 5),
      input: { slots: [null], teleporters: [tele] }, output: null,
    });
    const t = state([F(of(0)), pp(0)]);
    expect(feedAt(t, t.board[1]!, 0, 0)).toBeNull();
    const u = state([F(of(0)), pp(null)]);
    expect(feedAt(u, u.board[1]!, 0, 0)).not.toBeNull();
  });

  it('teleporters per input (#55): only the teleported input of a Sphere Factory is fed by nothing, as the engine moves it', () => {
    // At rotation 0 F's output touches G's input 1 (point 0); at rotation 5 its input 2 (point 2).
    for (const rotation of [0, 5]) {
      for (const slot of [0, 1]) {
        const g: BoardPiece = { ...G(of(0, 5)), rotation, input: withTeleporter(G(of(0, 5)).input!, slot, 0) };
        const s = state([F(of(0)), g]);
        const moved = resolveDirectAdjacency(s).board[1]!.input!.slots;
        const feeds = inputFeeds(s, s.board[1]!, 0);
        moved.forEach((m, i) => expect(feeds[i] !== null, `rotation ${rotation}, teleporter on input ${slot + 1}: input ${i + 1}`).toBe(m !== null));
      }
    }
    // The bot values a teleporter on the input its supply chain does not reach, not on the fed one.
    const fedFirst = state([F(of(0)), G(of(0, 5))]);
    expect(teleporterWorthFor(fedFirst, 0, TELEPORTER, 'G', 'input', 0)).toBe(0);
    expect(teleporterWorthFor(fedFirst, 0, TELEPORTER, 'G', 'input', 1)).toBeGreaterThan(0);
    // An input with my teleporter counts as fed from my inventory, the other input by what feeds it.
    const both = { ...G(of(0, 5)), input: withTeleporter(G(of(0, 5)).input!, 1, 0) };
    expect(fedFraction(state([F(of(0)), both]), both, 0)).toBe(1);
    expect(fedFraction(state([both]), both, 0)).toBe(0.5);
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
