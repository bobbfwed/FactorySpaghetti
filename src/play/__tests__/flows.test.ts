// Focused flows: each Leverage card, buying and placing a mine, the multi-tile belt route
// helper, operate-or-skip prompts on another player's turn, disabled reasons, cancel, and
// what happens to a selection when a new state arrives.

import { describe, expect, it } from 'vitest';
import type { Action } from '../../engine/actions';
import type { CardType } from '../../engine/config';
import type { GameState, Player, PlayerId } from '../../engine/state';
import { applyAction, legalActions } from '../../engine';
import { placeAction, placement, planRoute, planningState, routeEnds, stillPossible, type Seg } from '../route';
import { W } from '../words';
import { PlayController } from '../controller';
import { pieceTemplate } from '../../engine/config';
import { adjAt } from '../../engine/rules/flow';
import { refusalText } from '../../app/gameText';
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

  it('changingPriorities: moving the last Control Module off a building says what is lost, with exact counts (#58)', () => {
    const { state, player } = atActions(5, 3);
    const from = state.board.find(p => p.type === 'plateFact' && p.claims.length === 1 && p.claims[0]!.ownerId === player)!;
    const module = from.claims[0]!.controlModule;
    // Ore in its input, a Plate in its output, and the player's teleporter on the output.
    const loaded = (extraClaim: boolean): GameState => patchPlayer({
      ...state, cardsPlayedThisTurn: 0, globalTeleporterCount: state.globalTeleporterCount + 1,
      board: state.board.map(p => (p.id === from.id ? {
        ...p, claims: extraClaim ? [...p.claims, { ownerId: player, controlModule: 17 }] : p.claims,
        input: { slots: ['ore'], teleporters: [] }, output: { slots: ['plate'], teleporters: [player] },
      } : p)),
    }, player, { hand: ['changingPriorities'], teleportersRemaining: state.players[player]!.teleportersRemaining - 1 });
    const confirmText = (s: GameState): string => {
      const a = legalActions(s, player).find(x => x.type === 'PLAY_CARD' && x.cardType === 'changingPriorities' && x.pieceId === from.id && x.controlModule === module) as Extract<Action, { type: 'PLAY_CARD' }>;
      const { c } = harness(s, player);
      c.choose('card:changingPriorities');
      c.tap({ kind: 'piece', pieceId: from.id });
      c.tap({ kind: 'piece', pieceId: a.toPieceId! });
      if (c.view.choices) c.choose(`cpModule:${module}`);
      expect(c.view.confirmBar?.confirm).toBe(true);
      return c.view.instruction;
    };
    const last = confirmText(loaded(false));
    expect(last).toMatch(new RegExp(`^Move Control Module ${module} from the Plate Factory to the `));
    expect(last).toContain('? The Plate Factory will have no owner: the 2 materials in it go to the bank and your teleporter there comes back to you.');
    // With a second module of theirs left on it, nothing is lost and nothing more is said.
    const kept = confirmText(loaded(true));
    expect(kept).not.toContain('no owner');
    expect(kept.endsWith('?')).toBe(true);
    // The words for the other counts.
    expect(W.cpLoss('Sphere Factory', { materials: 1, teleporters: 0 })).toBe(' The Sphere Factory will have no owner: the material in it goes to the bank.');
    expect(W.cpLoss('Sphere Factory', { materials: 0, teleporters: 2 })).toBe(' The Sphere Factory will have no owner: your 2 teleporters there come back to you.');
    expect(W.cpLoss('Sphere Factory', { materials: 0, teleporters: 0 })).toBe('');
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
    c.choose(withTwo.bufferType === 'input' ? `buffer:input:${withTwo.inputIndex}` : 'buffer:output');
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
  /** A state in my actions step with a route of `min`..`max` belts between two points on different pieces. */
  function routeState(min = 2, max = 3): { s: GameState; p: PlayerId; from: { pieceId: string; position: number }; to: { pieceId: string; position: number }; cost: number } {
    let found: ReturnType<typeof routeState> | null = null;
    findState((s, p) => {
      if (s.phase !== 'actions' || active(s) !== p || s.pendingFactoryOps.length || s.overstockPieces.length) return false;
      const ends = routeEnds(s, p);
      for (const from of ends.slice(0, 12)) {
        for (const to of ends) {
          if (to.pieceId === from.pieceId) continue;
          const r = planRoute(s, p, from, to);
          if (r && r.length >= min && r.length <= max) { found = { s, p, from, to, cost: r.length }; return true; }
        }
      }
      return false;
    });
    return found!;
  }

  /** Apply what the controller sent, one move at a time, as the host would. */
  function play(s: GameState, p: PlayerId, c: ReturnType<typeof harness>['c'], sent: Action[]): GameState {
    let done = 0;
    for (let guard = 0; guard < 30 && done < sent.length; guard++) {
      s = apply(s, sent[done]!);
      done++;
      c.update(s, p);
    }
    return s;
  }

  it('one belt: start point, end point on the same tile, then "Place 1 belt"', () => {
    const { state, player } = atActions(5, 3);
    const a = legalActions(state, player).find(x => x.type === 'PLACE_BELT') as Extract<Action, { type: 'PLACE_BELT' }>;
    const { c, sent } = harness(state, player);
    c.choose('bank:placeBelt');
    expect(c.view.instruction).toBe(W.beltPickStart);
    c.tap({ kind: 'point', pieceId: a.pieceId, point: a.fromPoint });
    expect(c.view.instruction).toBe(W.beltPickEnd);
    c.tap({ kind: 'point', pieceId: a.pieceId, point: a.toPoint });
    expect(sent).toEqual([]);
    expect(c.view.route).toEqual([{ pieceId: a.pieceId, from: a.fromPoint, to: a.toPoint, tier: 'own' }]);
    expect(c.view.primary).toMatchObject({ label: W.routePlaceAll(1), enabled: true });
    c.primary();
    expect(sent).toEqual([a]);
  });

  it('a route is planned whatever it costs, split into own, buy and cant, with the totals', () => {
    const { s: s0, p, from, to, cost } = routeState(3, 6);
    // One belt in the supply, materials for exactly one more.
    const s = patchPlayer(s0, p, { beltsRemaining: 1, inventory: { ore: 1, plate: 0, sphere: 0, tesseract: 0 } });
    const { c, sent } = harness(s, p);
    c.choose('bank:placeBelt');
    c.tap({ kind: 'point', pieceId: from.pieceId, point: from.position });
    c.tap({ kind: 'point', pieceId: to.pieceId, point: to.position });
    const tiers = c.view.route!.map(x => x.tier);
    expect(tiers).toEqual(['own', 'buy', ...Array(cost - 2).fill('cant')]);
    expect(c.view.instruction).toBe(W.routeTotals(cost, 1, 1, cost - 2));
    expect(c.view.choices?.items.map(i => i.id)).toEqual(['route:own', 'route:buy', 'route:cancel']);
    expect(c.view.primary?.label).toBe(W.routePlaceOwn(1));
    expect(sent).toEqual([]);
  });

  it('with no belts at all a route can still be planned', () => {
    const { s: s0, p, from, to, cost } = routeState(2, 4);
    const s = patchPlayer(s0, p, { beltsRemaining: 0, inventory: { ore: 0, plate: 0, sphere: 0, tesseract: 0 } });
    const { c, sent } = harness(s, p);
    expect(item(c.view, 'bank:placeBelt')?.enabled).toBe(true);
    c.choose('bank:placeBelt');
    c.tap({ kind: 'point', pieceId: from.pieceId, point: from.position });
    c.tap({ kind: 'point', pieceId: to.pieceId, point: to.position });
    expect(c.view.route?.every(x => x.tier === 'cant')).toBe(true);
    expect(c.view.route).toHaveLength(cost);
    // No button with a zero count: the supply is said to be empty and the plan waits.
    expect(allItems(c.view).some(i => /^Place 0\b/.test(i.label))).toBe(false);
    expect(c.view.primary?.label).not.toMatch(/\b0\b/);
    expect(c.view.instruction).toContain('No belts in your supply');
    expect(c.view.primary).toMatchObject({ label: W.routeLater, enabled: true });
    c.primary();
    expect(sent).toEqual([]);
    expect(c.view.route ?? null).toBeNull();
    // The plan is kept: Lay a belt offers it again.
    c.choose('bank:placeBelt');
    expect(allItems(c.view).some(i => i.id === 'route:continue')).toBe(true);
  });

  it('with no belts in the supply but belts to buy, the buy button is offered (no zero-count button)', () => {
    const { s: s0, p, from, to } = routeState(2, 3);
    const s = patchPlayer(s0, p, { beltsRemaining: 0, inventory: { ore: 6, plate: 0, sphere: 0, tesseract: 0 } });
    const { c } = harness(s, p);
    c.choose('bank:placeBelt');
    c.tap({ kind: 'point', pieceId: from.pieceId, point: from.position });
    c.tap({ kind: 'point', pieceId: to.pieceId, point: to.position });
    expect(c.view.instruction).toContain('No belts in your supply');
    expect(allItems(c.view).map(i => i.id)).not.toContain('route:own');
    expect(c.view.primary?.label).toMatch(/^Buy \d+ and place \d+$/);
  });

  it('in the idle Actions step no belt point glows; a tap on one says to press Lay a belt', () => {
    const { s, p, from } = routeState(2, 3);
    const { c } = harness(s, p);
    expect(c.view.targets.some(t => t.kind === 'point')).toBe(false);
    c.tap({ kind: 'point', pieceId: from.pieceId, point: from.position });
    expect(c.view.hint).toBe(W.layBeltFirst);
    c.choose('bank:placeBelt');
    expect(c.view.targets.some(t => t.kind === 'point')).toBe(true);
  });

  it('"Place from inventory" lays the own part; the rest stays as the plan, re-tiered', () => {
    const { s: s0, p, from, to, cost } = routeState(3, 6);
    let s = patchPlayer(s0, p, { beltsRemaining: 1, inventory: { ore: 0, plate: 0, sphere: 0, tesseract: 0 } });
    const { c, sent } = harness(s, p);
    c.choose('bank:placeBelt');
    c.tap({ kind: 'point', pieceId: from.pieceId, point: from.position });
    c.tap({ kind: 'point', pieceId: to.pieceId, point: to.position });
    c.choose('route:own');
    s = play(s, p, c, sent);
    expect(sent.map(a => a.type)).toEqual(['PLACE_BELT']);
    expect(c.view.route).toHaveLength(cost - 1);
    expect(c.view.route?.every(x => x.tier === 'cant')).toBe(true);
  });

  it('"Buy M and place" buys first, then lays the own and bought belts in route order', () => {
    const { s: s0, p, from, to, cost } = routeState(2, 3);
    let s = patchPlayer(s0, p, { beltsRemaining: 1, inventory: { ore: 6, plate: 0, sphere: 0, tesseract: 0 } });
    const route = planRoute(s, p, from, to)!;
    const { c, sent } = harness(s, p);
    c.choose('bank:placeBelt');
    c.tap({ kind: 'point', pieceId: from.pieceId, point: from.position });
    c.tap({ kind: 'point', pieceId: to.pieceId, point: to.position });
    expect(c.view.choices?.items.find(i => i.id === 'route:buy')?.label).toBe(W.routeBuyPlace(cost - 1, cost));
    c.choose('route:buy');
    s = play(s, p, c, sent);
    expect(sent.filter(a => a.type === 'BUY_BELT')).toHaveLength(cost - 1);
    expect(sent.filter(a => a.type === 'PLACE_BELT').map(a => (a as Extract<Action, { type: 'PLACE_BELT' }>).pieceId)).toEqual(route.map(x => x.pieceId));
    for (const b of route) expect(s.belts.some(x => x.pieceId === b.pieceId && new Set([x.fromPoint, x.toPoint]).has(b.from))).toBe(true);
    // All laid: back to choosing where the next belts go.
    expect(c.view.instruction).toBe(W.beltPickStart);
    expect(c.view.route).toBeNull();
  });

  it('a belt the engine refuses part-way stops the placement there, with the reason', () => {
    const { s: s0, p, from, to } = routeState(2, 4);
    const s = patchPlayer(s0, p, { beltsRemaining: 9 });
    const route = planRoute(s, p, from, to)!;
    // Use the second belt's point first, so the plan's second belt is refused.
    const second = route[1]!;
    const blocker = legalActions(s, p).find((a): a is Extract<Action, { type: 'PLACE_BELT' }> => a.type === 'PLACE_BELT'
      && a.pieceId === second.pieceId && (a.fromPoint === second.from || a.toPoint === second.from)
      && !(new Set([a.fromPoint, a.toPoint]).has(second.to)));
    if (!blocker) return; // no such belt in this state
    const r = placement(apply(s, blocker), p, route, false);
    expect(r.placed).toBe(1);
    expect(r.refusal).not.toBeNull();
    expect(r.actions).toEqual([{ type: 'PLACE_BELT', pieceId: route[0]!.pieceId, fromPoint: route[0]!.from, toPoint: route[0]!.to }]);
  });

  it('the plan is remembered on this device and offered again on a later visit to "Lay a belt"', () => {
    const { s: s0, p, from, to, cost } = routeState(3, 6);
    let s = patchPlayer(s0, p, { beltsRemaining: 1, inventory: { ore: 0, plate: 0, sphere: 0, tesseract: 0 } });
    const { c, sent } = harness(s, p);
    c.choose('bank:placeBelt');
    c.tap({ kind: 'point', pieceId: from.pieceId, point: from.position });
    c.tap({ kind: 'point', pieceId: to.pieceId, point: to.position });
    c.choose('route:own');
    s = play(s, p, c, sent);
    c.choose('route:later'); // put the plan aside without cancelling it
    c.choose('bank:placeBelt');
    const cont = c.view.choices?.items.find(i => i.id === 'route:continue');
    expect(cont?.label).toBe(W.routeContinue(cost - 1));
    c.choose('route:continue');
    expect(c.view.route).toHaveLength(cost - 1);
    // "Drop the rest of the route" forgets it (the belt laid on the earlier visit stays).
    c.choose('route:cancel');
    expect(c.view.choices?.items.some(i => i.id === 'route:continue') ?? false).toBe(false);
  });

  it('placed belts are not lit in the actions step or in Lay a belt; Remove a belt is its own mode', () => {
    const { state, player } = atActions(5, 3);
    const a = legalActions(state, player).find(x => x.type === 'PLACE_BELT')!;
    const s = apply(state, a);
    const belt = s.belts[s.belts.length - 1]!;
    const { c, sent } = harness(s, player);
    expect(c.view.targets.some(t => t.kind === 'belt')).toBe(false);
    c.choose('bank:placeBelt');
    expect(c.view.targets.some(t => t.kind === 'belt')).toBe(false);
    c.cancel();
    c.choose('bank:removeBelt');
    expect(c.view.instruction).toBe(W.removePick);
    expect(isLit(c.view, { kind: 'belt', beltId: belt.id })).toBe(true);
    expect(c.view.targets.every(t => t.kind === 'belt')).toBe(true);
    c.tap({ kind: 'belt', beltId: belt.id });
    expect(c.view.confirmBar).toMatchObject({ confirm: true, label: W.removeBelt });
    c.confirm();
    expect(sent).toEqual([{ type: 'REMOVE_BELT', beltId: belt.id }]);
    c.update(apply(s, sent[0]!), player);
    c.choose('bank:undoBelts');
  });

  it('a tap on a point that is not lit is explained by the engine, never as "not your building"', () => {
    const { state, player } = atActions(5, 3);
    const { c } = harness(state, player);
    c.choose('bank:placeBelt');
    const lit = new Set(c.view.targets.map(t => (t.kind === 'point' ? `${t.pieceId}:${t.point}` : '')));
    let checked = 0;
    for (const piece of state.board) {
      for (let pt = 0; pt < (piece.type === 'mine' ? 24 : 12) && checked < 40; pt++) {
        if (lit.has(`${piece.id}:${pt}`)) continue;
        c.tap({ kind: 'point', pieceId: piece.id, point: pt });
        expect(c.view.hint).not.toBe(W.notYourBuilding);
        expect(c.view.hint).toBeTruthy();
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(0);
    c.tap({ kind: 'buffer', pieceId: state.board.find(x => x.input)!.id, buffer: 'input' });
    expect(c.view.hint).toBe(W.bufferNoBelt);
  });
});

describe('The meeple ends the turn', () => {
  it('confirming the meeple places it and then ends the turn by itself', () => {
    const { state, player } = findState((s, p) => s.phase === 'placeMeeple' && active(s) === p && s.players[p]!.meepleOnPieceId === null
      && legalActions(s, p).some(a => a.type === 'PLACE_MEEPLE'));
    const { c, sent } = harness(state, player);
    expect(c.view.primary).toMatchObject({ label: W.meepleChoose, enabled: false, hint: W.meepleChooseWhy });
    const a = legalActions(state, player).find((x): x is Extract<Action, { type: 'PLACE_MEEPLE' }> => x.type === 'PLACE_MEEPLE')!;
    gesturesFor(c, a);
    expect(sent).toEqual([a]);
    const s1 = apply(state, a);
    c.update(s1, player);
    expect(sent).toEqual([a, { type: 'END_TURN' }]);
  });

  it('with nowhere to place the meeple, one explicit button ends the turn', () => {
    const { state, player } = findState((s, p) => s.phase === 'placeMeeple' && active(s) === p && s.players[p]!.meepleOnPieceId === null);
    // No building of mine and no free Mine point: the engine offers only END_TURN.
    const s2 = {
      ...state,
      board: state.board.filter(x => x.type !== 'mine').map(x => ({ ...x, claims: x.claims.filter(cl => cl.ownerId !== player) })),
    };
    expect(legalActions(s2, player)).toEqual([{ type: 'END_TURN' }]);
    const { c, sent } = harness(s2, player);
    expect(c.view.primary).toMatchObject({ label: W.noMeepleSpotEnd, enabled: true });
    c.primary();
    expect(sent).toEqual([{ type: 'END_TURN' }]);
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
    // A route can be planned with no belts in the supply.
    expect(item(v, 'bank:placeBelt')?.enabled).toBe(true);
    expect(item(v, 'bank:buyCard')).toMatchObject({ enabled: false, reason: W.deckEmpty });
    expect(item(v, 'bank:teleporter')).toMatchObject({ enabled: false, reason: W.noTeleporters });
    expect(item(v, 'bank:exchange')).toMatchObject({ enabled: false, reason: W.nothingToExchange });
    expect(item(v, 'bank:undoBelts')).toMatchObject({ enabled: false, reason: W.noBeltsThisTurn });
    expect(item(v, 'bank:buyBelt')?.enabled).toBe(true);
  });

  it('teleporter needs enough material', () => {
    // Since RULES_CHANGES #42 a teleporter is paid with change like any purchase: only a total
    // value short of the price disables it (1 Ore for a price of 2).
    const { state, player } = atActions(5, 3);
    const s = patchPlayer({ ...state, globalTeleporterCount: 1 }, player, { teleportersRemaining: 2, inventory: { ore: 1, plate: 0, sphere: 0, tesseract: 0 } });
    expect(item(harness(s, player).c.view, 'bank:teleporter')).toMatchObject({ enabled: false, reason: W.cantAfford(2, 1) });
  });

  it('step 4: the big button says to place the meeple first', () => {
    const { state, player } = findState((s, p) => s.phase === 'placeMeeple' && active(s) === p && s.players[p]!.meepleOnPieceId === null
      && legalActions(s, p).some(a => a.type === 'PLACE_MEEPLE'));
    const { c } = harness(state, player);
    expect(c.view.primary).toMatchObject({ label: W.meepleChoose, enabled: false, hint: W.meepleChooseWhy });
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
    // Lit (something else can be done there): its menu has "Run" greyed out with the reason.
    // Not lit (nothing can be done there): the tap says the same reason.
    const run = c.view.menu?.items.find(i => i.id === 'menu:run');
    if (c.view.menu) expect(run?.enabled).toBe(false);
    const reason = c.view.menu ? run!.reason! : c.view.hint!;
    expect([W.alreadyRan, W.outputFull, W.loadFirst, W.badRecipe].includes(reason as never) || /^Needs /.test(reason)).toBe(true);
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

describe('Belt plans across turns', () => {
  it('a plan with two belts touching Mines is not dropped (the one-per-turn limit applies when laying)', () => {
    // Find a plan whose belts include two that touch a Mine.
    let found: { s: GameState; p: PlayerId; segs: Seg[] } | null = null;
    findState((s, p) => {
      if (s.phase !== 'actions' || active(s) !== p || s.pendingFactoryOps.length) return false;
      const ends = routeEnds(s, p);
      for (const from of ends.slice(0, 20)) {
        for (const to of ends.slice(0, 40)) {
          if (to.pieceId === from.pieceId) continue;
          const segs = planRoute(s, p, from, to);
          if (!segs) continue;
          const touching = segs.filter(x => {
            const ok = applyAction(planningState(s, p), placeAction(x));
            return ok.ok && ok.state.mineBeltPlacedThisTurn;
          });
          if (touching.length >= 2) { found = { s, p, segs }; return true; }
        }
      }
      return false;
    });
    if (!found) return; // no such route in the sampled games
    const f = found as { s: GameState; p: PlayerId; segs: Seg[] };
    expect(stillPossible(f.s, f.p, f.segs)).toBe(true);
  });
});

describe('One open pile', () => {
  it('the spaces glow at once, the pile does not, and one tap on a space starts the placement', () => {
    const { state: s, player: p } = findState((g, q) => g.phase === 'placePiece' && active(g) === q && g.pendingMineIds.length === 0
      && [0, 1, 2].filter(i => g.stacks[i as 0 | 1 | 2].available && g.stacks[i as 0 | 1 | 2].pieces.length > 0).length === 1);
    const { c, sent } = harness(s, p);
    const cells = c.view.targets.filter(t => t.kind === 'cell');
    expect(cells.length).toBeGreaterThan(0);
    expect(c.view.targets.some(t => t.kind === 'stack')).toBe(false);
    c.tap(cells[0]!);
    expect(c.view.ghost).not.toBeNull();
    expect(c.view.confirmBar?.confirm).toBe(true);
    // A tap on the pile itself says what is on top and where it goes; nothing is sent.
    const harness2 = harness(s, p);
    const open = [0, 1, 2].find(i => s.stacks[i as 0 | 1 | 2].available && s.stacks[i as 0 | 1 | 2].pieces.length > 0)!;
    harness2.c.tap({ kind: 'stack', index: open });
    expect(harness2.c.view.hint).toMatch(/is yours to place/);
    expect([...sent, ...harness2.sent]).toEqual([]);
  });
});

describe('Drawing from a pile', () => {
  /** My place-a-piece step with piles 1 and 2 open (gestures only from here on, no fallback). */
  function twoPiles(): { s: GameState; p: PlayerId } {
    const { state, player } = findState((s, p) => s.phase === 'placePiece' && active(s) === p && s.pendingMineIds.length === 0
      && (s.drawnStackIndex ?? null) === null && s.stacks[1].pieces.length > 0);
    return { s: { ...state, stacks: [state.stacks[0], { ...state.stacks[1], available: true }, state.stacks[2]] }, p: player };
  }

  it('lights the open piles; a tap draws at once; the drawn piece is then placed with gestures only', () => {
    const { s, p } = twoPiles();
    expect(legalActions(s, p).every(a => a.type === 'DRAW_PIECE')).toBe(true);
    const { c, sent } = harness(s, p);
    expect(c.view.instruction).toBe(W.drawPick);
    expect(c.view.targets).toEqual([{ kind: 'stack', index: 0 }, { kind: 'stack', index: 1 }]);
    c.tap({ kind: 'stack', index: 1 });
    expect(sent).toEqual([{ type: 'DRAW_PIECE', stackIndex: 1 }]);
    const s1 = apply(s, sent[0]!);
    c.update(s1, p);
    // Only the drawn pile's piece may be placed now: pick a lit cell, confirm.
    const cell = c.view.targets.find(t => t.kind === 'cell');
    expect(cell).toBeDefined();
    c.tap(cell!);
    expect(c.view.confirmBar?.confirm).toBe(true);
    c.confirm();
    expect(sent).toHaveLength(2);
    expect(sent[1]).toMatchObject({ type: 'PLACE_PIECE', stackIndex: 1 });
    expect(() => apply(s1, sent[1]!)).not.toThrow();
  });

  it('explains taps on piles and cells: choose first, locked, empty, not the pile you drew from', () => {
    const { s, p } = twoPiles();
    const { c } = harness(s, p);
    c.tap({ kind: 'stack', index: 2 });
    expect(c.view.hint).toBe(W.stackLocked);
    c.tap({ kind: 'cell', q: 40, r: 40 });
    expect(c.view.hint).toBe(W.drawFirst);
    const empty = { ...s, stacks: [s.stacks[0], s.stacks[1], { ...s.stacks[2], available: true, pieces: [] }] } as GameState;
    const { c: c2 } = harness(empty, p);
    c2.tap({ kind: 'stack', index: 2 });
    expect(c2.view.hint).toBe(W.stackEmpty);
    const drawn = apply(s, { type: 'DRAW_PIECE', stackIndex: 1 });
    const { c: c3 } = harness(drawn, p);
    c3.tap({ kind: 'stack', index: 0 });
    expect(c3.view.hint).toBe(W.notDrawnPile(2));
  });

  it('others see who is choosing a pile, then what they drew', () => {
    const { s, p } = twoPiles();
    const other = s.turnOrder.find(x => x !== p)!;
    const names = (id: PlayerId): string => `P${id}`;
    const watch = (g: GameState): string => {
      const sent: Action[] = [];
      const c = new PlayController({ send: (a): void => { sent.push(a); }, names });
      c.update(g, other);
      return c.view.instruction;
    };
    expect(watch(s)).toBe(W.waitingDraw(`P${p}`));
    const drawn = apply(s, { type: 'DRAW_PIECE', stackIndex: 0 });
    expect(watch(drawn)).toMatch(new RegExp(`^P${p} drew a `));
  });
});

describe("Designer's item 6: belts beside another player's building", () => {
  /** A point that faces (across the seam) one of `building`'s input or output points, on the neighbouring piece. */
  function facing(s: GameState, building: GameState['board'][number], role: 'input_buffer' | 'output_buffer'): { pieceId: string; position: number } | null {
    for (const d of pieceTemplate(building).points) {
      if (!d.enabled || d.role !== role) continue;
      const n = adjAt(building.coord, building.rotation ?? 0, d.position, s.board);
      if (!n || n.piece.type === 'mine') continue;
      const nd = pieceTemplate(n.piece).points.find(x => x.position === n.pos);
      if (nd?.enabled && nd.role === 'belt' && !s.belts.some(b => b.pieceId === n.piece.id && (b.fromPoint === n.pos || b.toPoint === n.pos))) {
        return { pieceId: n.piece.id, position: n.pos };
      }
    }
    return null;
  }
  const has = (pts: readonly { pieceId: string; position: number }[], q: { pieceId: string; position: number }): boolean =>
    pts.some(x => x.pieceId === q.pieceId && x.position === q.position);

  it("reserved points, the owner's points, and belts on another player's piece", () => {
    let found: { s: GameState; me: PlayerId; theirs: GameState['board'][number]; q: { pieceId: string; position: number } } | null = null;
    findState((s, p) => {
      if (s.phase !== 'actions' || active(s) !== p || s.pendingFactoryOps.length || s.overstockPieces.length) return false;
      for (const b of s.board) {
        if (b.type === 'mine' || b.type === 'blank' || b.claims.length === 0 || b.claims.some(c => c.ownerId === p)) continue;
        const q = facing(s, b, 'output_buffer');
        if (q) { found = { s, me: p, theirs: b, q }; return true; }
      }
      return false;
    });
    const f = found as unknown as { s: GameState; me: PlayerId; theirs: GameState['board'][number]; q: { pieceId: string; position: number } };
    expect(f).toBeTruthy();
    const { s, me, theirs, q } = f;
    const mine = routeEnds(s, me);
    // (c) The point facing the other player's output is not lit for me, and a tap on it says why.
    expect(has(mine, q)).toBe(false);
    const { c } = harness(s, me);
    c.choose('bank:placeBelt');
    expect(isLit(c.view, { kind: 'point', pieceId: q.pieceId, point: q.position })).toBe(false);
    c.tap({ kind: 'point', pieceId: q.pieceId, point: q.position });
    expect(c.view.hint).toBe(refusalText({ code: 'POINT_RESERVED' }));
    expect(c.view.hint).not.toBe(W.notYourBuilding);
    // (d) From the owner's side the same point is lit (it is their turn in this copy of the state).
    const owner = theirs.claims[0]!.ownerId;
    const asOwner = { ...s, activePlayerIndex: s.turnOrder.indexOf(owner) };
    expect(has(routeEnds(asOwner, owner), q)).toBe(true);
    // (a) A belt may go between two belt points on the other player's building piece, if it has any.
    const onTheirs = legalActions(planningState(s, me), me).some(a => a.type === 'PLACE_BELT' && a.pieceId === theirs.id);
    const theirBeltPoints = pieceTemplate(theirs).points.filter(d => d.enabled && d.role === 'belt').length;
    if (theirBeltPoints >= 2) expect(onTheirs).toBe(true);
    // (b) A point facing my own building's input is lit for me (when one is free).
    for (const b of s.board) {
      if (!b.claims.some(cl => cl.ownerId === me) || b.claims.some(cl => cl.ownerId !== me)) continue;
      const qi = facing(s, b, 'input_buffer');
      if (qi && !s.board.some(x => x.id !== b.id && x.claims.some(cl => cl.ownerId !== me) && facing(s, x, 'input_buffer')?.pieceId === qi.pieceId)) {
        expect(has(mine, qi)).toBe(true);
        break;
      }
    }
  });
});

describe('Leverage cards played as soon as they are drawn', () => {
  it('are announced in the rulebook\'s words, for the buyer and for the other players', () => {
    expect(W.playOnDraw('overstockSupplies', 'Bea', 3, true))
      .toBe('Overstock Supplies is played as soon as it is drawn: place 3 board pieces.');
    expect(W.playOnDraw('overstockSupplies', 'Bea', 3, false))
      .toBe('Bea bought a Leverage card. Overstock Supplies is played as soon as it is drawn: Bea places 3 board pieces.');
    expect(W.playOnDraw('solarFlare', 'Bea', 0, false)).toContain('every player gets 2 Power Tokens');
  });
});
