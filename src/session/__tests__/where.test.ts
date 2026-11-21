// Positions in words, relative to the first Mine, as seen from the table's starting view.

import { describe, it, expect } from 'vitest';
import type { GameState } from '../../engine/state';
import { createGame } from '../../engine';
import { mineSecondaryCoord } from '../../engine/rules/pieces';
import { whereLabel, whereWords } from '../where';

const game = createGame(3, 2);
const mine = game.board.find(p => p.id === 'mine-1')!;
const at = (dq: number, dr: number): string => whereWords(game, { q: mine.coord.q + dq, r: mine.coord.r + dr });

describe('whereWords', () => {
  it('names all six directions', () => {
    // The first Mine covers two spaces; its second one is next to it (to the right in this game).
    const second = mineSecondaryCoord(mine.coord, mine.rotation ?? 0);
    expect(second).toEqual({ q: mine.coord.q + 1, r: mine.coord.r });
    expect(at(2, 0)).toBe('2 spaces to the right of the first Mine');
    expect(at(1, -1)).toBe('1 space to the upper right of the first Mine');
    expect(at(0, -1)).toBe('1 space to the upper left of the first Mine');
    expect(at(-1, 0)).toBe('1 space to the left of the first Mine');
    expect(at(-1, 1)).toBe('1 space to the lower left of the first Mine');
    expect(at(0, 1)).toBe('1 space to the lower right of the first Mine');
    expect(at(0, -3)).toBe('3 spaces to the upper left of the first Mine');
  });

  it('describes a space off the six lines as two runs, the longer first', () => {
    expect(at(2, -1)).toBe('1 space right and 1 upper right of the first Mine');
    expect(at(3, -1)).toBe('2 spaces right and 1 upper right of the first Mine');
    expect(at(1, -3)).toBe('2 spaces upper left and 1 upper right of the first Mine');
    expect(at(-2, 3)).toBe('2 spaces lower left and 1 lower right of the first Mine');
  });

  it('says "on the first Mine" for both of its spaces', () => {
    expect(whereWords(game, mine.coord)).toBe('on the first Mine');
    expect(whereWords(game, mineSecondaryCoord(mine.coord, mine.rotation ?? 0))).toBe('on the first Mine');
  });

  it('works far away, and gives every space its own words', () => {
    expect(at(-12, 0)).toBe('12 spaces to the left of the first Mine');
    expect(at(9, -14)).toBe('9 spaces upper right and 5 upper left of the first Mine');
    const seen = new Set<string>();
    for (let dq = -6; dq <= 6; dq++) {
      for (let dr = -6; dr <= 6; dr++) {
        const w = at(dq, dr);
        if (w === 'on the first Mine') continue;
        expect(seen.has(w)).toBe(false);
        expect(w).not.toMatch(/-?\d+,-?\d+/);
        seen.add(w);
      }
    }
  });

  it('before a Mine is on the board, measures from the centre; a label starts with a capital', () => {
    const empty = { ...game, board: [] } as unknown as GameState;
    expect(whereWords(empty, { q: 2, r: 0 })).toBe('2 spaces to the right of the first Mine');
    expect(whereLabel(game, { q: mine.coord.q - 1, r: mine.coord.r })[0]).toBe('1');
    expect(whereLabel(game, mine.coord)).toBe('On the first Mine');
  });
});
