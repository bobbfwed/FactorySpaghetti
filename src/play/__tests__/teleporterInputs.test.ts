// Placing a teleporter on one input (RULES_CHANGES.md #55): each free input of a Sphere or
// Tesseract Factory is its own lit target, the words say which input, tapping the building lists
// the inputs, the building menu names them, and a teleporter already on an input picks that input.

import { describe, expect, it } from 'vitest';
import type { Action } from '../../engine/actions';
import type { BoardPiece, GameState, Player, PlayerId } from '../../engine/state';
import { legalActions } from '../../engine';
import { W } from '../words';
import { allItems, atActions, harness, isLit } from './helpers';
import type { Target } from '../../table/types';

function patchPlayer(s: GameState, p: PlayerId, patch: Partial<Player>): GameState {
  return { ...s, players: s.players.map(x => (x.id === p ? { ...x, ...patch } : x)) };
}

/** My actions step, with one of my Plate Factories turned into a Tesseract Factory, and the means to place teleporters. */
function setup(inputTeleporters: (me: PlayerId) => Array<PlayerId | null> = () => []): { s: GameState; me: PlayerId; id: string } {
  const { state, player } = atActions(5, 3);
  const piece = state.board.find(x => x.type === 'plateFact' && x.claims.some(c => c.ownerId === player))!;
  const tess: BoardPiece = { ...piece, type: 'tesseractFact', input: { slots: ['sphere', null, null], teleporters: inputTeleporters(player) } };
  let s: GameState = { ...state, board: state.board.map(p => (p.id === piece.id ? tess : p)), cardsPlayedThisTurn: 0 };
  s = patchPlayer(s, player, { teleportersRemaining: 4, inventory: { ore: 6, plate: 2, sphere: 0, tesseract: 0 } });
  return { s, me: player, id: piece.id };
}
const input = (pieceId: string, slot: number): Target => ({ kind: 'buffer', pieceId, buffer: 'input', slot });

describe('placing a teleporter on one input', () => {
  it('each free input is its own lit target; the confirm text names the input and what it does', () => {
    const { s, me, id } = setup();
    const { c, sent } = harness(s, me);
    c.choose('bank:teleporter');
    expect(c.view.instruction).toBe(W.teleporterPick);
    for (const slot of [0, 1, 2]) expect(isLit(c.view, input(id, slot)), `input ${slot + 1}`).toBe(true);
    expect(isLit(c.view, { kind: 'buffer', pieceId: id, buffer: 'output' })).toBe(true);
    c.tap(input(id, 1));
    expect(c.view.instruction).toBe(W.teleporterConfirm('input 2', 'Tesseract Factory', true));
    expect(c.view.instruction).toContain(W.teleporterOneInput);
    c.confirm();
    expect(sent).toEqual([{ type: 'PLACE_TELEPORTER', pieceId: id, bufferType: 'input', inputIndex: 1 }]);
  });

  it('an input that already has a teleporter is not lit; tapping its teleporter does not place one there', () => {
    const { s, me, id } = setup(m => [null, null, m]);
    const { c } = harness(s, me);
    c.choose('bank:teleporter');
    expect(isLit(c.view, input(id, 2))).toBe(false);
    expect(isLit(c.view, input(id, 0))).toBe(true);
    // The table resolves a tap on the teleporter of input 3 to input 3: it is not a spot any more.
    c.tap(input(id, 2));
    expect(c.view.confirmBar?.confirm).toBe(false);
  });

  it('tapping the building lists its free inputs (what each holds) and the output', () => {
    const { s, me, id } = setup();
    const { c, sent } = harness(s, me);
    c.choose('bank:teleporter');
    c.tap({ kind: 'piece', pieceId: id });
    expect(c.view.choices?.title).toBe(W.teleporterWhich);
    const items = c.view.choices!.items;
    expect(items.map(i => i.label)).toEqual([
      W.teleporterOn('input 1'), W.teleporterOn('input 2'), W.teleporterOn('input 3'), W.teleporterOn('the output'),
    ]);
    expect(items[0]!.detail).toBe(W.inputHolds('Sphere'));
    expect(items[1]!.detail).toBe(W.inputHolds(null));
    c.choose('buffer:input:2');
    expect(c.view.instruction).toBe(W.teleporterConfirm('input 3', 'Tesseract Factory', true));
    c.confirm();
    expect(sent).toEqual([{ type: 'PLACE_TELEPORTER', pieceId: id, bufferType: 'input', inputIndex: 2 }]);
  });

  it('the building menu names each input; on a building with several inputs the item lights that input and asks to confirm', () => {
    const { s, me, id } = setup(m => [m]);
    const { c, sent } = harness(s, me);
    c.tap({ kind: 'piece', pieceId: id });
    const ids = allItems(c.view).filter(i => i.id.startsWith('menu:teleporter')).map(i => i.id);
    expect(ids).toEqual(['menu:teleporter:input:1', 'menu:teleporter:input:2', 'menu:teleporter:output']);
    expect(c.view.menu?.subtitle).toContain(W.teleporterMarkInputs([0]));
    c.choose('menu:teleporter:input:2');
    expect(sent).toEqual([]);
    expect(isLit(c.view, input(id, 2))).toBe(true);
    expect(c.view.confirmBar?.confirm).toBe(true);
    c.confirm();
    expect(sent).toEqual([{ type: 'PLACE_TELEPORTER', pieceId: id, bufferType: 'input', inputIndex: 2 }]);
  });

  it('a building with one input: "the input", placed from the menu at once, as before', () => {
    const { state, player } = atActions(5, 3);
    const s = patchPlayer(state, player, { teleportersRemaining: 4, inventory: { ore: 6, plate: 0, sphere: 0, tesseract: 0 } });
    const pf = s.board.find(x => x.type === 'plateFact' && x.claims.some(c => c.ownerId === player))!;
    const { c, sent } = harness(s, player);
    c.tap({ kind: 'piece', pieceId: pf.id });
    const it = allItems(c.view).find(i => i.id === 'menu:teleporter:input:0')!;
    expect(it.label).toBe(W.teleporterOn('the input'));
    c.choose('menu:teleporter:input:0');
    expect(sent).toEqual([{ type: 'PLACE_TELEPORTER', pieceId: pf.id, bufferType: 'input', inputIndex: 0 }]);
  });

  it('every listed teleporter move can be made, each from its own lit input', () => {
    const { s, me, id } = setup();
    const listed = legalActions(s, me).filter((a): a is Extract<Action, { type: 'PLACE_TELEPORTER' }> => a.type === 'PLACE_TELEPORTER' && a.pieceId === id);
    expect(listed).toHaveLength(4);
    for (const a of listed) {
      const { c, sent } = harness(s, me);
      c.choose('bank:teleporter');
      c.tap(a.bufferType === 'input' ? input(id, a.inputIndex!) : { kind: 'buffer', pieceId: id, buffer: 'output' });
      c.confirm();
      expect(sent).toEqual([a]);
    }
  });
});
