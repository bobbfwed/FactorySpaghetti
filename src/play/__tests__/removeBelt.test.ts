// Removing a belt says, before the player confirms, where the belt goes (RULES_CHANGES.md #54):
// one laid this turn comes back to the player's own belts; one laid on an earlier turn goes back
// to the bank and must be bought again. The text view's move list says the same.

import { describe, expect, it } from 'vitest';
import type { Action } from '../../engine/actions';
import type { GameState } from '../../engine/state';
import { applyAction, legalActions } from '../../engine';
import { W } from '../words';
import { optionGroups } from '../../app/gameText';
import type { Room } from '../../session/room';
import { newLobbyRoom } from '../../session/room';
import { atActions, harness } from './helpers';
import { beltCurve, bezierAt, distanceToCurve } from '../../table/layout';
import { boardCandidates, choose, targetKey } from '../../table/pick';
import type { Target } from '../../table/types';

function apply(s: GameState, a: Action): GameState {
  const r = applyAction(s, a);
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
  return r.state;
}

describe('Remove a belt tells where the belt goes (#54)', () => {
  const { state, player } = atActions(5, 3);
  const lay = legalActions(state, player).find(x => x.type === 'PLACE_BELT')!;
  const laid = apply(state, lay);
  const belt = laid.belts[laid.belts.length - 1]!;
  // The same belt as if laid on an earlier turn (no longer listed as placed this turn).
  const older: GameState = { ...laid, beltsPlacedThisTurn: [] };

  it('the instruction before choosing names both cases', () => {
    const { c } = harness(laid, player);
    c.choose('bank:removeBelt');
    expect(c.view.instruction).toBe(W.removePick);
    expect(W.removePick).toContain('comes back to your belts');
    expect(W.removePick).toContain('goes back to the bank');
  });

  it('a belt laid this turn: it comes back to your belts', () => {
    const { c, sent } = harness(laid, player);
    c.choose('bank:removeBelt');
    c.tap({ kind: 'belt', beltId: belt.id });
    expect(c.view.instruction).toBe(W.removeConfirm);
    expect(c.view.confirmBar).toMatchObject({ confirm: true, label: W.removeBelt });
    c.confirm();
    expect(sent).toEqual([{ type: 'REMOVE_BELT', beltId: belt.id }]);
    expect(apply(laid, sent[0]!).players[player]!.beltsRemaining).toBe(state.players[player]!.beltsRemaining);
  });

  it('a belt laid on an earlier turn: it goes back to the bank, and placing one again means buying one', () => {
    const { c, sent } = harness(older, player);
    c.choose('bank:removeBelt');
    c.tap({ kind: 'belt', beltId: belt.id });
    expect(c.view.instruction).toBe(W.removeConfirmBank);
    expect(W.removeConfirmBank).toContain('goes back to the bank; placing a belt there again means buying one');
    expect(c.view.confirmBar).toMatchObject({ confirm: true, label: W.removeBeltToBank });
    c.confirm();
    expect(sent).toEqual([{ type: 'REMOVE_BELT', beltId: belt.id }]);
    expect(apply(older, sent[0]!).players[player]!.beltsRemaining).toBe(older.players[player]!.beltsRemaining);
  });

  it('once a belt is chosen only that belt glows; another of mine still answers a tap', () => {
    const second = legalActions(laid, player).find(x => x.type === 'PLACE_BELT');
    expect(second).toBeDefined();
    const two = apply(laid, second!);
    const other = two.belts[two.belts.length - 1]!;
    const { c } = harness(two, player);
    c.choose('bank:removeBelt');
    const beltTargets = (): string[] => c.view.targets.flatMap(t => (t.kind === 'belt' ? [t.beltId] : []));
    expect(beltTargets()).toEqual(expect.arrayContaining([belt.id, other.id]));
    c.tap({ kind: 'belt', beltId: belt.id });
    expect(beltTargets()).toEqual([belt.id]);
    // A tap on the other belt chooses it instead.
    c.tap({ kind: 'belt', beltId: other.id });
    expect(beltTargets()).toEqual([other.id]);
    expect(c.view.confirmBar).toMatchObject({ confirm: true });
    // A second tap on the chosen belt lets it go: both glow again.
    c.tap({ kind: 'belt', beltId: other.id });
    expect(beltTargets()).toEqual(expect.arrayContaining([belt.id, other.id]));
  });

  it('one tap on my other belt on the same tile selects it, even where the tap is also near the chosen one', () => {
    // Two of my belts on one tile, and a spot nearer the second that is still within the first's reach.
    const R = 3.5; // the table's belt pick radius (pick.ts R_BELT)
    let found: { two: GameState; other: string; at: { x: number; z: number } } | null = null;
    for (const second of legalActions(laid, player).filter((x): x is Extract<Action, { type: 'PLACE_BELT' }> => x.type === 'PLACE_BELT' && x.pieceId === belt.pieceId)) {
      const two = apply(laid, second);
      const other = two.belts[two.belts.length - 1]!;
      const piece = two.board.find(p => p.id === belt.pieceId)!;
      const ca = beltCurve(piece, belt.fromPoint, belt.toPoint), cb = beltCurve(piece, other.fromPoint, other.toPoint);
      for (let i = 0; i <= 40 && !found; i++) {
        const m = bezierAt(cb, i / 40);
        const da = distanceToCurve(ca, m.x, m.z), db = distanceToCurve(cb, m.x, m.z);
        if (da < R && db < da) found = { two, other: other.id, at: { x: m.x, z: m.z } };
      }
      if (found) break;
    }
    expect(found).not.toBeNull();
    const { two, other, at } = found!;
    const { c } = harness(two, player);
    c.choose('bank:removeBelt');
    c.tap({ kind: 'belt', beltId: belt.id });
    const keys = (ts: readonly Target[] | undefined): Set<string> => new Set((ts ?? []).map(targetKey));
    // Only the chosen belt glows; the other answers a tap without glowing.
    expect(c.view.targets.filter(t => t.kind === 'belt')).toEqual([{ kind: 'belt', beltId: belt.id }]);
    expect(c.view.quietTargets).toEqual(expect.arrayContaining([{ kind: 'belt', beltId: other }]));
    // The table's picker, given both, resolves the tap to the other belt; one tap selects it.
    const hit = choose(boardCandidates(two, at.x, at.z), keys(c.view.targets), keys(c.view.quietTargets));
    expect(hit).toEqual({ kind: 'belt', beltId: other });
    c.tap(hit!);
    expect(c.view.targets.filter(t => t.kind === 'belt')).toEqual([{ kind: 'belt', beltId: other }]);
    expect(c.view.confirmBar).toMatchObject({ confirm: true });
  });

  it('the text view\'s move list says the same', () => {
    const room = (game: GameState): Room => {
      const base = newLobbyRoom('ABCDE', 'Ann');
      return {
        ...base, phase: 'playing', game,
        seats: base.seats.slice(0, game.playerCount).map((s, i) => ({ ...s, kind: 'human', name: `P${i}`, connected: true })),
        settings: { ...base.settings, playerCount: game.playerCount },
      };
    };
    const label = (s: GameState): string =>
      optionGroups(room(s), player).flatMap(g => g.options)
        .find(o => o.action.type === 'REMOVE_BELT' && o.action.beltId === belt.id)!.label;
    expect(label(laid)).toContain('laid this turn: it comes back to your belts');
    expect(label(older)).toContain('it goes back to the bank; placing a belt there again means buying one');
  });
});
