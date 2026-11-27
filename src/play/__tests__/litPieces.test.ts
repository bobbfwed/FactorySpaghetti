// A piece glows only when tapping it offers at least one move that can be made now. The
// meeple's building at the end of the round used to glow even after it had run, with nothing in
// its menu but a greyed-out "Run" ("You have already run this building this round.").

import { describe, expect, it } from 'vitest';
import type { Action } from '../../engine/actions';
import type { GameState, Player, PlayerId } from '../../engine/state';
import { legalActions } from '../../engine';
import { W } from '../words';
import { active, findState, harness, isLit, playRandom } from './helpers';

function patchPlayer(s: GameState, p: PlayerId, patch: Partial<Player>): GameState {
  return { ...s, players: s.players.map((x, i) => (i === p ? { ...x, ...patch } : x)) };
}

const onPiece = (a: Action, id: string): boolean => 'pieceId' in a && a.pieceId === id;

/**
 * My round-end turn, my meeple on a building (not on a Mine slot) that has already run this
 * round, and a free upgrade that could go on that building.
 */
function ranAtRoundEnd(): { s: GameState; p: PlayerId; id: string } {
  let found: { s: GameState; p: PlayerId; id: string } | null = null;
  findState((s0, p) => {
    if (s0.phase !== 'roundEnd' || active(s0) !== p || s0.pendingFactoryOps.length) return false;
    const pl = s0.players[p]!;
    const id = pl.meepleOnPieceId;
    const piece = s0.board.find(x => x.id === id);
    if (!id || !piece || piece.type === 'mine' || piece.type === 'blank' || pl.meepleSlotIndex !== null) return false;
    const s = patchPlayer(s0, p, { meepleOperatedThisRound: true, freeUpgradesRemaining: Math.max(1, pl.freeUpgradesRemaining) });
    if (!legalActions(s, p).some(a => a.type === 'UPGRADE_BUILDING' && a.pieceId === id && a.freeCredits !== undefined)) return false;
    found = { s, p, id };
    return true;
  });
  return found!;
}

describe('lit pieces', () => {
  const f = ranAtRoundEnd();

  it('round end: the meeple building that already ran, with nothing else to do, is not lit; a tap says why', () => {
    // Nothing else to do there: no free upgrade or Mine credit, nothing to load, its output empty.
    const piece = f.s.board.find(x => x.id === f.id)!;
    const s: GameState = {
      ...patchPlayer(f.s, f.p, {
        freeUpgradesRemaining: 0, freeActionCredits: 0, inventory: { ore: 0, plate: 0, sphere: 0, tesseract: 0 },
      }),
      board: f.s.board.map(x => (x.id === f.id && piece.output ? { ...x, output: { ...piece.output, slots: piece.output.slots.map(() => null) } } : x)),
    };
    expect(legalActions(s, f.p).some(a => onPiece(a, f.id))).toBe(false);
    const { c, sent } = harness(s, f.p);
    expect(isLit(c.view, { kind: 'piece', pieceId: f.id })).toBe(false);
    c.tap({ kind: 'piece', pieceId: f.id });
    expect(c.view.menu).toBeNull();
    expect(c.view.hint).toBe(W.alreadyRan);
    expect(sent).toEqual([]);
  });

  it('round end: the same building is lit when a free upgrade can go on it; its menu still says why it cannot run', () => {
    const { c } = harness(f.s, f.p);
    expect(isLit(c.view, { kind: 'piece', pieceId: f.id })).toBe(true);
    c.tap({ kind: 'piece', pieceId: f.id });
    const items = c.view.menu?.items ?? [];
    expect(items.some(i => i.id === 'menu:upgrade:endOfRound' && i.enabled)).toBe(true);
    expect(items.find(i => i.id === 'menu:run')).toMatchObject({ enabled: false, reason: W.alreadyRan });
  });

  it('every lit piece opens a menu with something to do, and every piece with a move on it is lit', () => {
    let checked = 0;
    for (const [seed, pc] of [[7, 2], [8, 3], [9, 4]] as const) {
      playRandom(seed, pc, 900, (s, p) => {
        if ((s.phase !== 'actions' && s.phase !== 'roundEnd') || active(s) !== p || s.pendingFactoryOps.length || s.overstockPieces.length) return;
        const legal = legalActions(s, p);
        const kinds: readonly Action['type'][] = s.phase === 'actions'
          ? ['PLACE_TELEPORTER', 'CLAIM_BUILDING', 'UPGRADE_BUILDING']
          : ['LOAD_BUILDING_INPUT', 'OPERATE_BUILDING', 'COLLECT_OUTPUT', 'CLAIM_BUILDING', 'UPGRADE_BUILDING'];
        const withMoves = new Set(legal.filter(a => kinds.includes(a.type)).map(a => (a as { pieceId: string }).pieceId));
        const { c } = harness(s, p);
        const lit = new Set(c.view.targets.filter(t => t.kind === 'piece').map(t => (t as { pieceId: string }).pieceId));
        expect([...lit].sort()).toEqual([...withMoves].sort());
        for (const id of lit) {
          const h = harness(s, p).c;
          h.tap({ kind: 'piece', pieceId: id });
          expect(h.view.menu?.items.some(i => i.enabled)).toBe(true);
        }
        checked++;
      });
    }
    expect(checked).toBeGreaterThan(20);
  }, 120_000);
});
