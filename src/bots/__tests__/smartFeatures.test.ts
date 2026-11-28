// The Smart Bot's kept features, each on a small hand-built position where the right answer is
// clear (docs/SMART_BOT_LOG.md lists the measurements behind each one).

import { describe, expect, it } from 'vitest';
import type { BoardPiece, GameState, Material, PieceType, PlayerId } from '../../engine/state';
import { createGame } from '../../engine/rules/setup';
import { applyAction, legalActions } from '../../engine/reducer';
import { fedFraction } from '../styles/analysis';
import { claimWorthFor, makeSmartBot } from '../smart/smartBot';
import { SMART_STYLE } from '../smart/config';
import type { SmartConfig } from '../smart/config';

const NO_BONUS: SmartConfig = { ...SMART_STYLE, bonusWeight: { investor: 0, beltWeaver: 0, factoryEmpire: 0 }, breadth: 0 };

const building = (id: string, type: PieceType, q: number, r: number, owner: PlayerId | null, modules: number[], out: Material | null = null): BoardPiece => ({
  id, type, coord: { q, r }, rotation: 0,
  claims: owner === null ? [] : modules.map(m => ({ ownerId: owner, controlModule: m })),
  input: { slots: type === 'sphereFact' ? [null, null] : type === 'tesseractFact' ? [null, null, null] : [null], teleporters: [] },
  output: { slots: [out], teleporters: [] },
});

function position(board: BoardPiece[], mineCount = 1): GameState {
  const g = createGame(1, 2);
  return { ...g, board: [...g.board.filter(p => p.type === 'mine'), ...board], belts: [], mineCount, phase: 'actions', turnOrder: [0, 1], activePlayerIndex: 0 };
}

describe('expected production: Control Modules for the dice in play', () => {
  const s1 = position([building('F', 'plateFact', 6, 0, 0, [3])], 1);
  const s2 = { ...s1, mineCount: 2 };
  it('with one Mine (one die) a module of 1–6 fires; 7 never does', () => {
    expect(claimWorthFor(s1, 0, NO_BONUS, new Map([['F', [4]]]))).toBeGreaterThan(claimWorthFor(s1, 0, NO_BONUS, new Map([['F', [7]]])));
  });
  it('with two Mines a module on 7 (the most likely sum) is worth more than one on 12 or 3', () => {
    const w = (m: number): number => claimWorthFor(s2, 0, NO_BONUS, new Map([['F', [m]]]));
    expect(w(7)).toBeGreaterThan(w(12));
    expect(w(7)).toBeGreaterThan(w(3));
    expect(w(6)).toBeGreaterThan(w(2));
  });
});

describe('supply connectivity: the setup claim goes to a building that is fed', () => {
  it('claims a Plate Factory whose input a Mine already fills, whenever there is one', () => {
    const bot = makeSmartBot(SMART_STYLE);
    let checked = 0;
    for (let seed = 1; seed <= 25; seed++) {
      const g = createGame(seed, 3);
      const me = g.turnOrder[g.activePlayerIndex]!;
      const options = legalActions(g, me).filter(a => a.type === 'SETUP_CLAIM');
      const fed = (id: string): number => fedFraction(g, g.board.find(p => p.id === id)!, me);
      const best = Math.max(...options.map(a => (a.type === 'SETUP_CLAIM' ? fed(a.pieceId) : 0)));
      const a = bot(g, me);
      expect(a.type).toBe('SETUP_CLAIM');
      if (a.type === 'SETUP_CLAIM') expect(fed(a.pieceId)).toBe(best);
      if (best > 0) checked++;
    }
    expect(checked).toBeGreaterThan(3);
  });
});

describe('Bonus Tesseracts', () => {
  it('The Investor: leading with a module of 10+ is worth about a Tesseract or more; reaching 18 first locks it', () => {
    const s = position([building('F', 'plateFact', 6, 0, 0, [9]), building('G', 'plateFact', 8, 0, 1, [11])], 2);
    const w = (m: number): number => claimWorthFor(s, 0, SMART_STYLE, new Map([['F', [m]]]));
    expect(w(12) - w(10)).toBeGreaterThan(15); // 10 does not beat their 11; 12 does
    expect(w(18)).toBeGreaterThan(w(17));       // locked: nobody can pass 18
    expect(w(9)).toBeGreaterThan(w(5));         // climbing towards it is worth something on the way
  });

  it('Factory Empire: the sixth building is worth much more than the fifth', () => {
    const mine = [0, 1, 2, 3, 4, 5].map(i => building(`B${i}`, 'plateFact', 6 + 2 * i, 0, i < 5 ? 0 : null, [3]));
    const s = position([...mine, building('O', 'plateFact', 6, 4, 1, [3])], 1);
    const five = claimWorthFor(s, 0, SMART_STYLE, new Map());
    const six = claimWorthFor(s, 0, SMART_STYLE, new Map([['B5', [3]]]));
    const four = claimWorthFor(s, 0, SMART_STYLE, new Map([['B4', []]]));
    expect(six - five).toBeGreaterThan(2 * (five - four));
    expect(six - five).toBeGreaterThan(20);
  });
});

describe('the meeple goes where the round end pays most', () => {
  it('to my factory whose output holds a Tesseract', () => {
    const g = createGame(2, 2);
    const me = 0 as PlayerId;
    const t = building('T', 'tesseractFact', 7, -3, me, [5], 'tesseract');
    const p = building('P', 'plateFact', 9, -3, me, [4]);
    let s: GameState = {
      ...g, board: [...g.board.filter(x => x.type === 'mine'), t, p], belts: [],
      phase: 'placeMeeple', turnOrder: [0, 1], activePlayerIndex: 0, pendingFactoryOps: [],
    };
    s = { ...s, players: s.players.map(pl => ({ ...pl, meepleOnPieceId: null, meepleSlotIndex: null })) };
    const targets = legalActions(s, me).filter(a => a.type === 'PLACE_MEEPLE');
    expect(targets.some(a => a.type === 'PLACE_MEEPLE' && a.pieceId === 'T')).toBe(true);
    const a = makeSmartBot(SMART_STYLE)(s, me);
    expect(a).toMatchObject({ type: 'PLACE_MEEPLE', pieceId: 'T' });
    expect(applyAction(s, a).ok).toBe(true);
  });
});
