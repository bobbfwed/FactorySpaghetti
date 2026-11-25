// A Mine may touch the board with either half (RULES_CHANGES.md #47): every listed Mine placement,
// bought or dropped, is reachable by tapping the space of its larger half and turning it, also the
// ones where only the smaller half touches the board.

import { describe, expect, it } from 'vitest';
import type { Action } from '../../engine/actions';
import type { GameState, HexCoord, Player, PlayerId } from '../../engine/state';
import { legalActions } from '../../engine';
import { hexNeighbours, isCoordsOccupied } from '../../engine/rules/pieces';
import { W } from '../words';
import { active, atActions, findState, gesturesFor, harness } from './helpers';

function patchPlayer(s: GameState, p: PlayerId, patch: Partial<Player>): GameState {
  return { ...s, players: s.players.map((x, i) => (i === p ? { ...x, ...patch } : x)) };
}

/** The larger (anchor) hex has no neighbour on the board: only the smaller half touches it. */
const leanOnly = (s: GameState, c: HexCoord): boolean => !hexNeighbours(c).some(n => isCoordsOccupied(n, s.board));

function checkAll(s: GameState, p: PlayerId, list: Action[]): number {
  let lean = 0;
  for (const a of list) {
    if ((a.type === 'BUY_MINE' || a.type === 'PLACE_MINE') && leanOnly(s, a.coord)) lean++;
    const { c, sent } = harness(s, p);
    gesturesFor(c, a);
    expect(sent).toEqual([a]);
  }
  return lean;
}

describe('Mine placement with either half touching the board', () => {
  it('buying a Mine: every listed placement is reachable, including smaller-half-only ones', () => {
    const { state, player } = atActions(5, 3);
    const s = patchPlayer(state, player, { inventory: { ore: 6, plate: 6, sphere: 6, tesseract: 0 } });
    const buys = legalActions(s, player).filter(a => a.type === 'BUY_MINE');
    expect(buys.length).toBeGreaterThan(0);
    const lean = checkAll(s, player, buys);
    // eslint-disable-next-line no-console -- how many were checked
    console.log(`Mine purchases checked: ${buys.length}, smaller half only: ${lean}`);
    expect(lean).toBeGreaterThan(0);
  });

  it('a dropped Mine: the same', () => {
    const { state, player } = findState((s, p) => s.phase === 'placePiece' && active(s) === p && legalActions(s, p).some(a => a.type === 'PLACE_MINE'));
    const places = legalActions(state, player).filter(a => a.type === 'PLACE_MINE');
    const lean = checkAll(state, player, places);
    expect(lean).toBeGreaterThan(0);
    expect(harness(state, player).c.view.instruction).toBe(W.mineDropped);
  });
});
