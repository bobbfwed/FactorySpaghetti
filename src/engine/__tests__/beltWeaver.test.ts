import { describe, it, expect } from 'vitest';
import { createGame } from '../rules/setup';
import { longestBeltChain } from '../rules/beltWeaver';
import { recomputeBonuses } from '../rules/scoring';
import type { GameState, BoardPiece, PieceType, PlayerId, Belt } from '../state';

// Same fixture style as routing.test.ts. A horizontal row of blanks at q=2,3,4,… each
// carrying a {0,7} belt forms a continuous chain: point 7 of blank q seams to point 0 of
// blank q+1. Point 0 of the first blank faces the mine's east ore output; point 7 of the
// last blank faces a factory input to its right.
function mk(
  id: string, type: PieceType, coord: { q: number; r: number },
  rotation = 0, claims: Array<{ ownerId: PlayerId; controlModule: number }> = [],
): BoardPiece {
  return { id, type, coord, rotation, claims, input: null, output: null };
}
function fixture(board: BoardPiece[], belts: Belt[] = []): GameState {
  return { ...createGame(1, 2), board, belts };
}
const claimMe = [{ ownerId: 0 as PlayerId, controlModule: 3 }];
function beltOn(pieceId: string, owner = 0): Belt {
  return { id: `belt-${pieceId}`, ownerId: owner as PlayerId, pieceId, fromPoint: 0, toPoint: 7 };
}
// A row of `n` blanks starting at q=2, plus their {0,7} belts.
function blankRow(n: number, startQ = 2): { blanks: BoardPiece[]; belts: Belt[] } {
  const blanks = Array.from({ length: n }, (_, i) => mk(`bk${i}`, 'blank', { q: startQ + i, r: 0 }));
  return { blanks, belts: blanks.map(b => beltOn(b.id)) };
}

describe('longestBeltChain (Belt Weaver metric)', () => {
  it('counts a straight chain from a mine to a building', () => {
    const { blanks, belts } = blankRow(8); // q=2..9
    const state = fixture(
      [mk('mine', 'mine', { q: 0, r: 0 }), ...blanks, mk('pf', 'plateFact', { q: 10, r: 0 }, 0, claimMe)],
      belts,
    );
    expect(longestBeltChain(state, 0)).toBe(8); // mine + building, 8 belts
  });

  it('counts belts through a claimed factory pass-through (input → factory → output)', () => {
    // mine, 4 blanks, plate factory (claimed), 4 blanks, tesseract factory (claimed).
    const left = blankRow(4, 2);                 // q=2..5  → plate input at q=6
    const right = blankRow(4, 7).blanks.map((b, i) => mk(`rk${i}`, 'blank', b.coord)); // q=7..10
    const rightBelts = right.map(b => beltOn(b.id));
    const state = fixture(
      [
        mk('mine', 'mine', { q: 0, r: 0 }),
        ...left.blanks,
        mk('pf', 'plateFact', { q: 6, r: 0 }, 0, claimMe),
        ...right,
        mk('tf', 'tesseractFact', { q: 11, r: 0 }, 0, claimMe),
      ],
      [...left.belts, ...rightBelts],
    );
    // 4 + 4 belts bridged through the plate factory = 8, connecting plate + tesseract.
    expect(longestBeltChain(state, 0)).toBe(8);
  });

  it('does not count a chain that reaches no building (mine only)', () => {
    const { blanks, belts } = blankRow(8);
    const state = fixture([mk('mine', 'mine', { q: 0, r: 0 }), ...blanks], belts); // no factory at the end
    expect(longestBeltChain(state, 0)).toBe(0);
  });

  it('ignores another player’s belts', () => {
    const { blanks, belts } = blankRow(8);
    const oppBelts = belts.map(b => ({ ...b, ownerId: 1 as PlayerId }));
    const state = fixture(
      [mk('mine', 'mine', { q: 0, r: 0 }), ...blanks, mk('pf', 'plateFact', { q: 10, r: 0 }, 0, claimMe)],
      oppBelts,
    );
    expect(longestBeltChain(state, 0)).toBe(0); // player 0 owns no belts
  });
});

describe('Belt Weaver bonus (recomputeBonuses)', () => {
  it('awards the bonus for a chain ≥ threshold and withholds it below', () => {
    const big = blankRow(8);
    const won = recomputeBonuses(fixture(
      [mk('mine', 'mine', { q: 0, r: 0 }), ...big.blanks, mk('pf', 'plateFact', { q: 10, r: 0 }, 0, claimMe)],
      big.belts,
    ));
    expect(won.players[0]!.bonusTesseracts.beltWeaver).toBe(true);

    const small = blankRow(3);
    const none = recomputeBonuses(fixture(
      [mk('mine', 'mine', { q: 0, r: 0 }), ...small.blanks, mk('pf', 'plateFact', { q: 5, r: 0 }, 0, claimMe)],
      small.belts,
    ));
    expect(none.players[0]!.bonusTesseracts.beltWeaver).toBe(false);
  });
});
