// Focused flows: each Leverage card, buying and placing a mine, the multi-tile belt route
// helper, operate-or-skip prompts on another player's turn, disabled reasons, cancel, and
// what happens to a selection when a new state arrives.

import { describe, expect, it } from 'vitest';
import type { Action } from '../../engine/actions';
import type { CardType } from '../../engine/config';
import type { GameState, Player, PlayerId } from '../../engine/state';
import { applyAction, legalActions } from '../../engine';
import { findBeltPath } from '../../engine/routing';
import { routeReach } from '../info';
import { W } from '../words';
import { active, allItems, atActions, findState, gesturesFor, harness, isLit } from './helpers';

function patchPlayer(s: GameState, p: PlayerId, patch: Partial<Player>): GameState {
  return { ...s, players: s.players.map((x, i) => (i === p ? { ...x, ...patch } : x)) };
}

function apply(s: GameState, a: Action): GameState {
  const r = applyAction(s, a);
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
  return r.state;
}

const item = (v: ReturnType<typeof harness>['c']['view'], id: string): ReturnType<typeof allItems>[number] | undefined => allItems(v).find(i => i.id === id);

describe('Leverage cards', () => {
  const HAND_CARDS: CardType[] = [
    'scoutingDrone', 'shortSale', 'embezzlement', 'sinkHole', 'netSurplusSellOff', 'changingPriorities',
    'productionIncrease', 'personalJetPack', 'assetForfeiture', 'rdTaxWriteOff',
  ];

  for (const card of HAND_CARDS) {
    it(`${card}: every way to play it goes through its flow`, () => {
      const { state, player } = atActions(5, 3);
      const s = patchPlayer({ ...state, cardsPlayedThisTurn: 0 }, player, {
        hand: [card], teleportersRemaining: 2, inventory: { ore: 3, plate: 2, sphere: 1, tesseract: 0 },
      });
      const plays = legalActions(s, player).filter(a => a.type === 'PLAY_CARD');
      expect(plays.length).toBeGreaterThan(0);
      // The hand shows the card, enabled, with its rules text.
      const { c: c0 } = harness(s, player);
      const h = c0.view.hand.find(x => x.card === card)!;
      expect(h.enabled).toBe(true);
      expect(h.text.length).toBeGreaterThan(10);
      for (const a of plays) {
        const { c, sent } = harness(s, player);
        gesturesFor(c, a);
        expect(sent).toEqual([a]);
      }
    });
  }

  it('scoutingDrone: the pile is a list of choices, then the piece is placed with a ghost', () => {
    const { state, player } = atActions(5, 3);
    const s = patchPlayer({ ...state, cardsPlayedThisTurn: 0 }, player, { hand: ['scoutingDrone'] });
    const { c, sent } = harness(s, player);
    c.choose('card:scoutingDrone');
    expect(c.view.choices?.title).toBe(W.dronePile);
    const first = c.view.choices!.items[0]!;
    c.choose(first.id);
    expect(c.view.targets.every(t => t.kind === 'cell')).toBe(true);
    const cell = c.view.targets[0]!;
    c.tap(cell);
    expect(c.view.ghost).not.toBeNull();
    c.confirm();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ type: 'PLAY_CARD', cardType: 'scoutingDrone' });
  });

  it('scoutingDrone: the piece can go on any lit cell, not just the first, and be turned', () => {
    const { state, player } = atActions(5, 3);
    const s = patchPlayer({ ...state, cardsPlayedThisTurn: 0 }, player, { hand: ['scoutingDrone'] });
    const { c, sent } = harness(s, player);
    c.choose('card:scoutingDrone');
    c.choose(c.view.choices!.items[0]!.id);
    const cells = c.view.targets.filter(t => t.kind === 'cell');
    expect(cells.length).toBeGreaterThan(1);
    const cell = cells[cells.length - 1]!; // not the first cell
    if (cell.kind !== 'cell') throw new Error('expected a cell');
    c.tap(cell);
    expect(c.view.confirmBar?.rotate).toBe(true);
    c.rotate(2);
    const rotation = c.view.ghost!.rotation;
    expect(rotation).not.toBe(0);
    c.confirm();
    expect(sent).toHaveLength(1);
    const a = sent[0]!;
    expect(a).toMatchObject({ type: 'PLAY_CARD', cardType: 'scoutingDrone', coord: { q: cell.q, r: cell.r }, rotation });
    // The engine accepts it, and the piece lands where and how it was shown.
    const after = apply(s, a);
    const placed = after.board[after.board.length - 1]!;
    expect(placed.coord).toEqual({ q: cell.q, r: cell.r });
    expect(placed.rotation).toBe(rotation);
  });

  it('changingPriorities: from building, to building, then module, then confirm', () => {
    const { state, player } = atActions(5, 3);
    const s = patchPlayer({ ...state, cardsPlayedThisTurn: 0 }, player, { hand: ['changingPriorities'] });
    const a = legalActions(s, player).find(x => x.type === 'PLAY_CARD' && x.cardType === 'changingPriorities') as Extract<Action, { type: 'PLAY_CARD' }>;
    const { c, sent } = harness(s, player);
    c.choose('card:changingPriorities');
    expect(c.view.instruction).toBe(W.cpPickFrom);
    c.tap({ kind: 'piece', pieceId: a.pieceId! });
    expect(c.view.instruction).toBe(W.cpPickTo);
    c.tap({ kind: 'piece', pieceId: a.toPieceId! });
    if (c.view.choices) c.choose(`cpModule:${a.controlModule}`);
    expect(c.view.confirmBar?.confirm).toBe(true);
    c.confirm();
    expect(sent).toEqual([a]);
  });

  it('rdTaxWriteOff: tap a buffer, or tap a building and pick the buffer', () => {
    const { state, player } = atActions(5, 3);
    const s = patchPlayer({ ...state, cardsPlayedThisTurn: 0 }, player, { hand: ['rdTaxWriteOff'], teleportersRemaining: 3 });
    const plays = legalActions(s, player).filter((x): x is Extract<Action, { type: 'PLAY_CARD' }> => x.type === 'PLAY_CARD');
    const withTwo = plays.find(a => plays.filter(b => b.pieceId === a.pieceId).length === 2)!;
    const { c, sent } = harness(s, player);
    c.choose('card:rdTaxWriteOff');
    c.tap({ kind: 'piece', pieceId: withTwo.pieceId! });
    expect(c.view.choices?.title).toBe(W.teleporterWhich);
    c.choose(`buffer:${withTwo.bufferType}`);
    c.confirm();
    expect(sent).toEqual([withTwo]);
  });

  it('productionIncrease: a mode where claims and upgrades draw on the budget until it is spent', () => {
    const { state, player } = atActions(5, 3);
    let s = patchPlayer({ ...state, cardsPlayedThisTurn: 0 }, player, { hand: ['productionIncrease'] });
    const hc = harness(s, player);
    hc.c.choose('card:productionIncrease');
    hc.c.confirm();
    expect(hc.sent).toEqual([{ type: 'PLAY_CARD', cardType: 'productionIncrease' }]);
    s = apply(s, hc.sent[0]!);
    hc.c.update(s, player);
    expect(s.productionIncreaseBudget).toBe(4);
    expect(hc.c.view.selection?.label).toBe('Production Increase');
    expect(hc.c.view.instruction).toBe(W.piInstruction(4));
    expect(hc.c.view.targets.every(t => t.kind === 'piece')).toBe(true);
    // Spend it: open a lit building, upgrade or claim, until nothing is left.
    let guard = 0;
    while (s.productionIncreaseBudget > 0 && hc.c.view.choices?.items.some(i => i.id === 'pi:done') && guard++ < 10) {
      const t = hc.c.view.targets[0]!;
      hc.c.tap(t);
      const menu = hc.c.view.menu!;
      expect(menu.items.every(i => i.detail?.startsWith('Production Increase pays') || i.id.startsWith('menu:teleporter'))).toBe(true);
      const it2 = menu.items.find(i => i.id.startsWith('menu:upgrade:pi') || i.id.startsWith('menu:claim:pi'))!;
      hc.c.choose(it2.id);
      const old = hc.c.view.choices?.items.find(i => i.id.startsWith('old:'));
      if (old) hc.c.choose(old.id);
      const lit = hc.c.view.tray.find(t2 => t2.state === 'lit')!;
      const before = hc.sent.length;
      hc.c.choose(`module:${lit.module}`);
      expect(hc.sent.length).toBe(before + 1);
      s = apply(s, hc.sent[hc.sent.length - 1]!);
      hc.c.update(s, player);
    }
    expect(guard).toBeGreaterThan(0);
    // When the budget is spent (or nothing affordable remains) the mode ends by itself.
    if (s.productionIncreaseBudget === 0) expect(hc.c.view.choices).toBeNull();
  });

  it('play-on-draw cards are bought, never played from the hand', () => {
    const { state, player } = atActions(5, 3);
    for (const card of ['overstockSupplies', 'mineInspection', 'solarFlare'] as CardType[]) {
      const s = patchPlayer({ ...state, cardDeck: [card, ...state.cardDeck] }, player, { inventory: { ore: 6, plate: 0, sphere: 0, tesseract: 0 } });
      const { c, sent } = harness(s, player);
      c.choose('bank:buyCard');
      expect(sent).toEqual([{ type: 'BUY_CARD' }]);
    }
  });

  it('overstockSupplies: three pieces placed with a real rotation, while other actions stay open', () => {
    const { state, player } = atActions(5, 3);
    let s = patchPlayer({ ...state, cardDeck: ['overstockSupplies', ...state.cardDeck] }, player, { inventory: { ore: 6, plate: 0, sphere: 0, tesseract: 0 } });
    s = apply(s, { type: 'BUY_CARD' });
    expect(s.overstockPieces.length).toBe(3);
    const { c, sent } = harness(s, player);
    for (let i = 0; i < 3; i++) {
      expect(c.view.primary?.enabled).toBe(false);
      expect(c.view.primary?.hint).toBe(W.overstockFirst);
      expect(c.view.bank.find(b => b.id === 'bank:buyBelt')?.enabled).toBe(true);
      const cell = c.view.targets.find(t => t.kind === 'cell')!;
      c.tap(cell);
      expect(c.view.ghost?.pieceType).toBe(s.overstockPieces[0]!.type);
      c.rotate(3);
      expect(c.view.ghost?.rotation).toBe(3);
      c.confirm();
      const a = sent[sent.length - 1]!;
      expect(a).toMatchObject({ type: 'PLACE_OVERSTOCK_PIECE', rotation: 3 });
      s = apply(s, a);
      c.update(s, player);
    }
    expect(s.overstockPieces.length).toBe(0);
    expect(c.view.primary?.enabled).toBe(true);
  });
});

describe('Mines', () => {
  it('buy a mine: bank item → lit cells → ghost with only legal rotations → confirm', () => {
    const { state, player } = atActions(7, 2);
    const s = patchPlayer(state, player, { inventory: { ore: 6, plate: 0, sphere: 0, tesseract: 0 } });
    const { c, sent } = harness(s, player);
    const buy = item(c.view, 'bank:buyMine')!;
    expect(buy.enabled).toBe(true);
    expect(buy.detail).toContain('6');
    c.choose('bank:buyMine');
    expect(c.view.selection?.kind).toBe('mine');
    expect(c.view.targets.length).toBeGreaterThan(0);
    expect(c.view.targets.every(t => t.kind === 'cell')).toBe(true);
    const legal = legalActions(s, player).filter((a): a is Extract<Action, { type: 'BUY_MINE' }> => a.type === 'BUY_MINE');
    const cell = c.view.targets[0] as { kind: 'cell'; q: number; r: number };
    c.tap(cell);
    const legalRots = new Set(legal.filter(a => a.coord.q === cell.q && a.coord.r === cell.r).map(a => a.rotation));
    const seen = new Set<number>();
    for (let i = 0; i < 8; i++) { seen.add(c.view.ghost!.rotation); c.rotate(1); }
    expect(seen).toEqual(legalRots);
    expect(c.view.ghost?.pieceType).toBe('mine');
    c.confirm();
    expect(sent).toHaveLength(1);
    expect(sent[0]!.type).toBe('BUY_MINE');
    expect(applyAction(s, sent[0]!).ok).toBe(true);
  });

  it('cannot buy a mine without the materials: disabled, with the reason', () => {
    const { state, player } = atActions(7, 2);
    const s = patchPlayer(state, player, { inventory: { ore: 2, plate: 1, sphere: 0, tesseract: 0 } });
    const { c, sent } = harness(s, player);
    const buy = item(c.view, 'bank:buyMine')!;
    expect(buy.enabled).toBe(false);
    expect(buy.reason).toBe(W.cantAfford(6, 5));
    c.choose('bank:buyMine');
    expect(sent).toEqual([]);
    expect(c.view.hint).toBe(W.cantAfford(6, 5));
  });

  it('a dropped mine takes over step 1', () => {
    const { state, player } = findState((s, p) => s.phase === 'placePiece' && s.pendingMineIds.length > 0 && active(s) === p);
    const { c, sent } = harness(state, player);
    expect(c.view.instruction).toBe(W.mineDropped);
    expect(c.view.targets.every(t => t.kind === 'cell')).toBe(true);
    c.tap(c.view.targets[0]!);
    c.confirm();
    expect(sent[0]!.type).toBe('PLACE_MINE');
  });
});

describe('Belts', () => {
  function routeState(): { s: GameState; p: PlayerId; from: { pieceId: string; position: number }; to: { pieceId: string; position: number } } {
    let found: ReturnType<typeof routeState> | null = null;
    findState((s, p) => {
      if (s.phase !== 'actions' || active(s) !== p || s.pendingFactoryOps.length || s.overstockPieces.length) return false;
      if ((s.players[p]?.beltsRemaining ?? 0) < 3) return false;
      for (const a of legalActions(s, p)) {
        if (a.type !== 'PLACE_BELT') continue;
        const from = { pieceId: a.pieceId, position: a.fromPoint };
        for (const k of routeReach(s, from, p)) {
          const cut = k.lastIndexOf(':');
          const to = { pieceId: k.slice(0, cut), position: Number(k.slice(cut + 1)) };
          if (to.pieceId === from.pieceId) continue;
          const r = findBeltPath(s, from, to, p);
          if (r && r.cost >= 2 && r.cost <= 3) { found = { s, p, from, to }; return true; }
        }
      }
      return false;
    });
    return found!;
  }

  it('one belt: start point, then a lit end point on the same tile (sent at once)', () => {
    const { state, player } = atActions(5, 3);
    const a = legalActions(state, player).find(x => x.type === 'PLACE_BELT') as Extract<Action, { type: 'PLACE_BELT' }>;
    const { c, sent } = harness(state, player);
    c.choose('bank:placeBelt');
    expect(c.view.instruction).toBe(W.beltPickStart);
    c.tap({ kind: 'point', pieceId: a.pieceId, point: a.toPoint });
    expect(c.view.instruction).toBe(W.beltPickEnd);
    c.tap({ kind: 'point', pieceId: a.pieceId, point: a.fromPoint });
    expect(sent).toEqual([a]); // the legal action itself, whichever end was tapped first
    expect(c.view.selection?.kind).toBe('belt'); // ready for the next belt
  });

  it('route helper: tapping a point on another tile lays the router\'s chain, one validated belt at a time', () => {
    const { s: s0, p, from, to } = routeState();
    const route = findBeltPath(s0, from, to, p)!;
    let s = s0;
    const { c, sent } = harness(s, p);
    c.choose('bank:placeBelt');
    c.tap({ kind: 'point', pieceId: from.pieceId, point: from.position });
    expect(isLit(c.view, { kind: 'point', pieceId: to.pieceId, point: to.position })).toBe(true);
    c.tap({ kind: 'point', pieceId: to.pieceId, point: to.position });
    expect(sent).toHaveLength(1); // only the first belt; the rest wait for the host
    for (let i = 0; i < route.cost; i++) {
      expect(sent).toHaveLength(i + 1);
      const a = sent[i]!;
      expect(legalActions(s, p).some(x => JSON.stringify(x) === JSON.stringify(a))).toBe(true);
      s = apply(s, a);
      c.update(s, p);
    }
    expect(sent).toHaveLength(route.cost);
    for (const b of route.belts) {
      expect(s.belts.some(x => x.pieceId === b.pieceId && new Set([x.fromPoint, x.toPoint]).has(b.fromPoint) && new Set([x.fromPoint, x.toPoint]).has(b.toPoint))).toBe(true);
    }
  });

  it('route helper offers to buy the missing belts first', () => {
    const { s: s0, p, from, to } = routeState();
    const route = findBeltPath(s0, from, to, p)!;
    let s = patchPlayer(s0, p, { beltsRemaining: 1, inventory: { ore: 5, plate: 0, sphere: 0, tesseract: 0 } });
    const { c, sent } = harness(s, p);
    c.choose('bank:placeBelt');
    c.tap({ kind: 'point', pieceId: from.pieceId, point: from.position });
    c.tap({ kind: 'point', pieceId: to.pieceId, point: to.position });
    expect(sent).toEqual([]);
    expect(c.view.choices?.items[0]?.label).toBe(W.routeBuy(route.cost - 1));
    c.choose('route:buy');
    for (let guard = 0; guard < 10 && sent.length > 0 && s.belts.length < s0.belts.length + route.cost; guard++) {
      s = apply(s, sent[sent.length - 1]!);
      c.update(s, p);
    }
    expect(sent.filter(a => a.type === 'BUY_BELT')).toHaveLength(route.cost - 1);
    expect(sent.filter(a => a.type === 'PLACE_BELT')).toHaveLength(route.cost);
  });

  it('remove one of my belts from its menu, and undo this turn\'s belts from the bank', () => {
    const { state, player } = atActions(5, 3);
    const a = legalActions(state, player).find(x => x.type === 'PLACE_BELT')!;
    const s = apply(state, a);
    const belt = s.belts[s.belts.length - 1]!;
    const { c, sent } = harness(s, player);
    c.tap({ kind: 'belt', beltId: belt.id });
    expect(c.view.menu?.items.map(i => i.id)).toEqual(['menu:removeBelt']);
    c.choose('menu:removeBelt');
    c.choose('bank:undoBelts');
    expect(sent).toEqual([{ type: 'REMOVE_BELT', beltId: belt.id }, { type: 'UNDO_BELTS' }]);
  });
});

describe('Prompts on other players\' turns', () => {
  it('a factory activated on someone else\'s roll asks its owner to run or skip', () => {
    const { state, player } = findState((s, p) => s.pendingFactoryOps.some(e => e.ownerId === p) && active(s) !== p);
    const { c, sent } = harness(state, player);
    expect(c.view.step).toBe('waiting');
    expect(c.view.myTurn).toBe(false);
    expect(c.view.prompts.length).toBeGreaterThan(0);
    // Only the prompts' buildings glow.
    expect(c.view.targets.map(t => t.kind)).toEqual(c.view.prompts.map(() => 'piece'));
    const pr = c.view.prompts[0]!;
    expect(pr.title).toContain('was activated by a roll of');
    expect(pr.options.map(o => o.label)).toEqual([W.promptRun, W.promptSkip]);
    // The bank and hand say why they are closed.
    expect(c.view.bank.every(b => !b.enabled && b.reason === W.decideFirst)).toBe(true);
    // Tapping the building opens the same choice as a menu.
    c.tap(pr.anchor);
    expect(c.view.menu?.items.map(i => i.id)).toEqual(pr.options.map(o => o.id));
    c.choose(pr.options[0]!.id);
    expect(sent[0]).toMatchObject({ type: 'OPERATE_BUILDING', ownerId: player });
  });

  it('the active player waits on others with a reason on the primary button', () => {
    const { state, player } = findState((s, p) => s.phase === 'actions' && active(s) === p
      && s.pendingFactoryOps.length > 0 && !s.pendingFactoryOps.some(e => e.ownerId === p));
    const { c } = harness(state, player);
    expect(c.view.primary?.enabled).toBe(false);
    expect(c.view.primary?.hint).toMatch(/^Waiting for /);
    c.primary();
    expect(c.view.hint).toBe(c.view.primary?.hint);
  });
});

describe('Disabled reasons', () => {
  it('outside my actions step, the bank is closed with a reason', () => {
    const { state, player } = findState((s, p) => s.phase === 'roll' && active(s) === p);
    const { c } = harness(state, player);
    expect(c.view.primary?.label).toBe(W.rollLabel(state.mineCount));
    for (const b of c.view.bank) {
      expect(b.enabled).toBe(false);
      expect(b.reason).toBe(b.id === 'bank:exchange' ? W.onlyActionsOrRoundEnd : W.onlyActions);
    }
    const other = state.turnOrder.find(x => x !== player)!;
    const { c: c2 } = harness(state, other);
    expect(c2.view.step).toBe('waiting');
    expect(c2.view.instruction).toBe(W.waitingRoll('Player ' + (player + 1)));
    expect(c2.view.bank.every(b => b.reason === W.notYourTurn)).toBe(true);
  });

  it('cards: two played this turn, no teleporters left', () => {
    const { state, player } = atActions(5, 3);
    const s = patchPlayer({ ...state, cardsPlayedThisTurn: 2 }, player, { hand: ['embezzlement'] });
    expect(harness(s, player).c.view.hand[0]).toMatchObject({ enabled: false, reason: W.cardsMaxed });
    const s2 = patchPlayer({ ...state, cardsPlayedThisTurn: 0 }, player, { hand: ['rdTaxWriteOff'], teleportersRemaining: 0 });
    expect(harness(s2, player).c.view.hand[0]).toMatchObject({ enabled: false, reason: W.cardNoTeleporters });
  });

  it('bank: no belts in supply, empty deck, no teleporters, nothing to exchange, nothing to undo', () => {
    const { state, player } = atActions(5, 3);
    const s = patchPlayer({ ...state, cardDeck: [] }, player, {
      beltsRemaining: 0, teleportersRemaining: 0, inventory: { ore: 1, plate: 0, sphere: 0, tesseract: 0 },
    });
    const v = harness({ ...s, beltsPlacedThisTurn: [] }, player).c.view;
    expect(item(v, 'bank:placeBelt')).toMatchObject({ enabled: false, reason: W.noBelts });
    expect(item(v, 'bank:buyCard')).toMatchObject({ enabled: false, reason: W.deckEmpty });
    expect(item(v, 'bank:teleporter')).toMatchObject({ enabled: false, reason: W.noTeleporters });
    expect(item(v, 'bank:exchange')).toMatchObject({ enabled: false, reason: W.nothingToExchange });
    expect(item(v, 'bank:undoBelts')).toMatchObject({ enabled: false, reason: W.noBeltsThisTurn });
    expect(item(v, 'bank:buyBelt')?.enabled).toBe(true);
  });

  it('teleporter needs exact payment', () => {
    const { state, player } = atActions(5, 3);
    const s = patchPlayer({ ...state, globalTeleporterCount: 1 }, player, { teleportersRemaining: 2, inventory: { ore: 0, plate: 1, sphere: 0, tesseract: 0 } });
    expect(item(harness(s, player).c.view, 'bank:teleporter')).toMatchObject({ enabled: false, reason: W.cantPayExact(2) });
  });

  it('step 4: End turn waits for the meeple', () => {
    const { state, player } = findState((s, p) => s.phase === 'placeMeeple' && active(s) === p && s.players[p]!.meepleOnPieceId === null);
    const { c } = harness(state, player);
    expect(c.view.primary).toMatchObject({ label: W.endTurn, enabled: false, hint: W.meepleFirst });
  });

  it('round end: the meeple building explains why it cannot run', () => {
    const { state, player } = findState((s, p) => {
      if (s.phase !== 'roundEnd' || active(s) !== p) return false;
      const pl = s.players[p]!;
      const piece = s.board.find(x => x.id === pl.meepleOnPieceId);
      return !!piece && piece.type !== 'mine' && piece.type !== 'powerPlant' && pl.meepleSlotIndex === null
        && !legalActions(s, p).some(a => a.type === 'OPERATE_BUILDING');
    });
    const { c } = harness(state, player);
    const id = state.players[player]!.meepleOnPieceId!;
    c.tap({ kind: 'piece', pieceId: id });
    const run = c.view.menu?.items.find(i => i.id === 'menu:run');
    expect(run?.enabled).toBe(false);
    expect([W.alreadyRan, W.outputFull, W.loadFirst, W.badRecipe].includes(run!.reason as never) || /^Needs /.test(run!.reason!)).toBe(true);
  });

  it('touching something unlit says why', () => {
    const { state, player } = atActions(5, 3);
    const { c, sent } = harness(state, player);
    const theirs = state.board.find(p => p.claims.length > 0 && !p.claims.some(x => x.ownerId === player))!;
    c.tap({ kind: 'piece', pieceId: theirs.id });
    expect(c.view.hint).toBe(W.notYourBuilding);
    c.tap({ kind: 'stack', index: 2 });
    expect(c.view.hint).not.toBeNull();
    expect(sent).toEqual([]);
  });
});

describe('cancel and update', () => {
  it('cancel returns to the idle state of the step', () => {
    const { state, player } = findState((s, p) => s.phase === 'placePiece' && active(s) === p && s.pendingMineIds.length === 0);
    const { c, sent } = harness(state, player);
    const stack = c.view.targets.find(t => t.kind === 'stack');
    if (stack) c.tap(stack);
    const cell = c.view.targets.find(t => t.kind === 'cell')!;
    c.tap(cell);
    expect(c.view.ghost).not.toBeNull();
    c.cancel();
    expect(c.view.ghost).toBeNull();
    expect(sent).toEqual([]);

    const a = atActions(5, 3);
    const h = harness(a.state, a.player);
    h.c.choose('bank:exchange');
    h.c.cancel();
    expect(h.c.view.choices).toBeNull();
    expect(h.c.view.confirmBar).toBeNull();
    expect(h.c.view.instruction).toBe(W.actionsIdle);
  });

  it('a selection that is still possible survives a new state; one that is not is reset with a hint', () => {
    const { state, player } = atActions(5, 3);
    const s = patchPlayer(state, player, { inventory: { ore: 6, plate: 1, sphere: 0, tesseract: 0 } });
    const { c } = harness(s, player);
    c.choose('bank:buyMine');
    c.tap(c.view.targets[0]!);
    const ghost = c.view.ghost;
    expect(ghost).not.toBeNull();
    // Buying a belt changes the state but the mine can still be bought: the ghost stays.
    const s2 = apply(s, { type: 'BUY_BELT' });
    c.update(s2, player);
    expect(c.view.ghost).toEqual(ghost);
    expect(c.view.hint).toBeNull();
    // Now the materials are gone: the selection is put back and the player is told.
    const s3 = patchPlayer(s2, player, { inventory: { ore: 0, plate: 0, sphere: 0, tesseract: 0 } });
    c.update(s3, player);
    expect(c.view.ghost).toBeNull();
    expect(c.view.hint).toBe(W.selectionGone);
  });

  it('not seated or no game: an inert view', () => {
    const { state } = atActions(5, 3);
    for (const [g, me] of [[state, null], [null, 0]] as const) {
      const { c, sent } = harness(g, me as PlayerId | null);
      expect(c.view.targets).toEqual([]);
      expect(c.view.bank).toEqual([]);
      expect(c.view.primary).toBeNull();
      c.primary(); c.confirm(); c.tap({ kind: 'deck' }); c.choose('bank:buyCard');
      expect(sent).toEqual([]);
    }
  });

  it('subscribers hear every change', () => {
    const { state, player } = atActions(5, 3);
    const { c } = harness(state, player);
    let n = 0;
    const off = c.subscribe(() => { n++; });
    c.choose('bank:exchange');
    c.cancel();
    off();
    c.choose('bank:exchange');
    expect(n).toBe(2);
  });
});
