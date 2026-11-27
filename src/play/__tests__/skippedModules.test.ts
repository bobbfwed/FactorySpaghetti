// Control Modules below the number of Mines in play can never be rolled: the tray shows one that
// is still in the tray as 'skipped' (greyed out, never lit, a tap says why); one on a building
// stays 'onBoard' in the tray, and the building's menu, the menu's subtitle and a player's details
// mark it in words.

import { describe, expect, it } from 'vitest';
import type { GameState, Player, PlayerId } from '../../engine/state';
import { moduleBelowFloor } from '../../engine';
import { modulesInTrayWords, modulesOnBoardWords } from '../../app/gameText';
import { PlayController } from '../controller';
import { W } from '../words';
import { active, actors, atActions, harness, playRandom } from './helpers';

function patchPlayer(s: GameState, p: PlayerId, patch: Partial<Player>): GameState {
  return { ...s, players: s.players.map((x, i) => (i === p ? { ...x, ...patch } : x)) };
}

/** My actions step, my modules 1 and 2 back in the tray, with `mines` Mines in play. */
function withMines(mines: number): { s: GameState; p: PlayerId } {
  const { state, player } = atActions(3, 2);
  const tray = [...new Set([1, 2, ...state.players[player]!.controlModules])].sort((a, b) => a - b);
  const board = state.board.map(b => ({ ...b, claims: b.claims.filter(c => !(c.ownerId === player && (c.controlModule === 1 || c.controlModule === 2))) }));
  return { s: patchPlayer({ ...state, board, mineCount: mines }, player, { controlModules: tray }), p: player };
}

/** A building of mine (other than the meeple's) with Control Module `module` added on it, taken from my tray. */
function moduleOnMyBuilding(s: GameState, p: PlayerId, module: number): { s: GameState; pieceId: string } {
  const piece = s.board.find(b => b.claims.length > 0 && b.claims.every(c => c.ownerId === p) && b.claims.length < 3)!;
  const board = s.board.map(b => (b.id === piece.id ? { ...b, claims: [...b.claims, { ownerId: p, controlModule: module }] } : b));
  const tray = s.players[p]!.controlModules.filter(m => m !== module);
  return { s: patchPlayer({ ...s, board }, p, { controlModules: tray }), pieceId: piece.id };
}

const stateOf = (c: PlayController, n: number): string | undefined => c.view.tray.find(t => t.module === n)?.state;

describe('the tray: skipped Control Modules', () => {
  it('with 1 Mine nothing is skipped', () => {
    const { s, p } = withMines(1);
    const { c } = harness(s, p);
    expect(c.view.tray.some(t => t.state === 'skipped')).toBe(false);
    expect(stateOf(c, 1)).toBe('inTray');
    expect(stateOf(c, 2)).toBe('inTray');
  });

  it('with 2 Mines, #1 in the tray is skipped, with a label and an explanation on tap', () => {
    const { s, p } = withMines(2);
    const { c } = harness(s, p);
    expect(stateOf(c, 1)).toBe('skipped');
    expect(stateOf(c, 2)).toBe('inTray');
    const one = c.view.tray.find(t => t.module === 1)!;
    expect(one.label).toBe('Control Module 1: skipped, a 1 cannot be rolled with 2 Mines in play');
    c.choose('module:1');
    expect(c.view.hint).toBe(W.moduleSkipped(1, 2));
    expect(c.view.hint).toBe('Control Module 1 is skipped: a 1 cannot be rolled with 2 Mines in play, so it can no longer be placed or chosen as an upgrade.');
  });

  it('the explanation is given on another player\'s turn too', () => {
    const { s, p } = withMines(2);
    const other = ((p + 1) % s.players.length) as PlayerId;
    const s2 = patchPlayer(s, other, { controlModules: [1, ...s.players[other]!.controlModules.filter(m => m !== 1)] });
    const { c } = harness(s2, other);
    expect(stateOf(c, 1)).toBe('skipped');
    c.choose('module:1');
    expect(c.view.hint).toBe(W.moduleSkipped(1, 2));
  });

  it('with 2 Mines, #1 on a building is on the board, not skipped', () => {
    const { s: s0, p } = withMines(2);
    const { s } = moduleOnMyBuilding(s0, p, 1);
    const { c } = harness(s, p);
    expect(stateOf(c, 1)).toBe('onBoard');
    expect(c.view.tray.some(t => t.state === 'skipped')).toBe(false);
  });

  it('with 3 Mines, #1 and #2 are skipped', () => {
    const { s, p } = withMines(3);
    const { c } = harness(s, p);
    expect(stateOf(c, 1)).toBe('skipped');
    expect(stateOf(c, 2)).toBe('skipped');
    expect(stateOf(c, 3)).not.toBe('skipped');
    c.choose('module:2');
    expect(c.view.hint).toBe(W.moduleSkipped(2, 3));
  });

  it('a skipped module is never lit when claiming', () => {
    const { s: s0, p } = withMines(3);
    const s = { ...s0, productionIncreaseBudget: 20, productionIncreaseClaimedThisTurn: false };
    const { c, sent } = harness(s, p);
    const claim = c.view.targets.find(t => t.kind === 'piece' && s.board.find(b => b.id === t.pieceId)?.claims.length === 0);
    expect(claim).toBeDefined();
    c.tap(claim!);
    c.choose('menu:claim:pi');
    const lit = c.view.tray.filter(t => t.state === 'lit').map(t => t.module);
    expect(lit.length).toBeGreaterThan(0);
    expect(lit.every(m => m >= 3)).toBe(true);
    expect(stateOf(c, 1)).toBe('skipped');
    expect(stateOf(c, 2)).toBe('skipped');
    // Tapping it in the middle of a claim says why and sends nothing.
    c.choose('module:1');
    expect(sent).toEqual([]);
    expect(c.view.hint).toBe(W.moduleSkipped(1, 3));
  });

  it('in random games, every tray module below the floor is skipped and never lit', () => {
    let checked = 0;
    for (const [seed, pc] of [[5, 2], [6, 3]] as const) {
      const ctrls = Array.from({ length: pc }, () => new PlayController({ send: (): void => {} }));
      playRandom(seed, pc, 1200, (st, who) => {
        if (who !== active(st) && !actors(st).includes(who)) return;
        const c = ctrls[who]!;
        c.update(st, who);
        const tray = new Set(st.players[who]!.controlModules);
        for (const t of c.view.tray) {
          const skipped = tray.has(t.module) && moduleBelowFloor(t.module, st.mineCount);
          expect(t.state === 'skipped', `module ${t.module} with ${st.mineCount} Mines`).toBe(skipped);
          if (skipped) checked++;
        }
      });
    }
    expect(checked).toBeGreaterThan(0);
  });
});

describe('a skipped Control Module on a building, in words', () => {
  it('the building menu marks it and says to upgrade it', () => {
    const { s: s0, p } = withMines(2);
    const { s: s1, pieceId } = moduleOnMyBuilding(s0, p, 1);
    const s = { ...s1, productionIncreaseBudget: 5 };
    const { c } = harness(s, p);
    const others = s.board.find(b => b.id === pieceId)!.claims.filter(x => x.ownerId === p && x.controlModule !== 1).length;
    c.tap({ kind: 'piece', pieceId });
    expect(c.view.menu).not.toBeNull();
    expect(c.view.menu!.subtitle).toContain('1 (cannot be rolled)');
    expect(c.view.menu!.note).toBe(W.moduleSkippedOnBuilding([1], 2, others > 0));
    // Upgrade with the Production Increase: the old module is named as one that cannot be rolled.
    c.choose('menu:upgrade:pi');
    expect(c.view.choices?.items.map(i => i.label)).toContain('Control Module 1 (cannot be rolled)');
    // Choosing it lights only modules above the floor; #1 itself is now on the board, not skipped.
    c.choose('old:1');
    const lit = c.view.tray.filter(t => t.state === 'lit').map(t => t.module);
    expect(lit.length).toBeGreaterThan(0);
    expect(lit.every(m => m >= 2)).toBe(true);
    expect(stateOf(c, 1)).toBe('onBoard');
  });

  it('the note words', () => {
    expect(W.moduleSkippedOnBuilding([1], 2, false)).toBe('Control Module 1 cannot be rolled with 2 Mines in play. Upgrade it to make this building run again.');
    expect(W.moduleSkippedOnBuilding([1], 2, true)).toBe('Control Module 1 cannot be rolled with 2 Mines in play. Upgrade it to use it again.');
    expect(W.moduleSkippedOnBuilding([1, 2], 3, false)).toBe('Control Modules 1 and 2 cannot be rolled with 3 Mines in play. Upgrade them to make this building run again.');
  });

  it('a building of mine with nothing to do: a tap says so', () => {
    const { s: s0, p } = withMines(2);
    const { s, pieceId } = moduleOnMyBuilding(s0, p, 1);
    const { c } = harness(s, p);
    // Not lit (no Production Increase, not round end), so a tap explains instead of opening a menu.
    expect(c.view.targets.some(t => t.kind === 'piece' && t.pieceId === pieceId)).toBe(false);
    c.tap({ kind: 'piece', pieceId });
    expect(c.view.hint).toMatch(/^Control Module 1 cannot be rolled with 2 Mines in play\./);
  });

  it('a player\'s details mark it in both lists', () => {
    const { s: s0, p } = withMines(3);
    const { s } = moduleOnMyBuilding(s0, p, 1);
    expect(modulesInTrayWords(s, p)).toMatch(/^2 \(cannot be rolled\), 3/);
    const board = modulesOnBoardWords(s, p);
    expect(board.some(x => /\b1 \(cannot be rolled\)/.test(x))).toBe(true);
    expect(board.join(' ')).not.toMatch(/\b(\d{2}|[3-9]) \(cannot be rolled\)/);
    // With 1 Mine, nothing is marked.
    const one = { ...s, mineCount: 1 };
    expect(modulesInTrayWords(one, p)).toMatch(/^2, 3/);
    expect(modulesOnBoardWords(one, p).join(' ')).not.toContain('cannot be rolled');
  });
});
