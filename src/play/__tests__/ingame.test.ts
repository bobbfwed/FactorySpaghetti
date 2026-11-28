// The owner's in-game round: buying a Leverage card after laying belts, the Teleporters well, the
// total value of the materials, what a Mine point earns, exchanging from the inventory, no stray
// Confirm in the meeple step, and the Scouting Drone's choices named by stack and piece type.

import { describe, expect, it } from 'vitest';
import type { Action, PlaceMeepleAction } from '../../engine/actions';
import type { GameState, Player, PlayerId } from '../../engine/state';
import { applyAction, legalActions } from '../../engine';
import { cardCost } from '../../engine/config';
import { planRoute, routeEnds } from '../route';
import { W } from '../words';
import { Rand, active, allItems, atActions, findState, harness, isLit } from './helpers';
import type { Target } from '../../table/types';

function patchPlayer(s: GameState, p: PlayerId, patch: Partial<Player>): GameState {
  return { ...s, players: s.players.map((x, i) => (i === p ? { ...x, ...patch } : x)) };
}

function apply(s: GameState, a: Action): GameState {
  const r = applyAction(s, a);
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
  return r.state;
}

const item = (c: ReturnType<typeof harness>['c'], id: string): ReturnType<typeof allItems>[number] | undefined => allItems(c.view).find(i => i.id === id);

const INV = (ore: number, plate: number, sphere: number, tesseract = 0): Player['inventory'] => ({ ore, plate, sphere, tesseract });

/** My actions step with two Mines in play and a belt route of at least two belts between two points. */
function twoMinesWithRoute(): { s: GameState; p: PlayerId; from: { pieceId: string; position: number }; to: { pieceId: string; position: number } } {
  let found: ReturnType<typeof twoMinesWithRoute> | null = null;
  findState((s, p) => {
    if (s.phase !== 'actions' || active(s) !== p || s.pendingFactoryOps.length || s.overstockPieces.length || s.mineCount !== 2) return false;
    if (s.cardDeck.length === 0) return false;
    const ends = routeEnds(s, p);
    for (const from of ends.slice(0, 10)) {
      for (const to of ends) {
        if (to.pieceId === from.pieceId) continue;
        const r = planRoute(s, p, from, to);
        if (r && r.length >= 2 && r.length <= 5) { found = { s, p, from, to }; return true; }
      }
    }
    return false;
  }, { maxSteps: 4000 });
  return found!;
}

// ── 1. Buying a Leverage card ─────────────────────────────────────────────────

describe('Buying a Leverage card', () => {
  const ctx = twoMinesWithRoute();

  it('after laying belts from a planned route, the deck still sells a card with one tap and the plan is kept', () => {
    const { p, from, to } = ctx;
    // One belt in the supply, one Ore and one Plate (worth 4; a card costs 3 with two Mines).
    let s = patchPlayer(ctx.s, p, { beltsRemaining: 1, inventory: INV(1, 1, 0) });
    expect(cardCost(s.mineCount)).toBe(3);
    const { c, sent } = harness(s, p);
    c.choose('bank:placeBelt');
    c.tap({ kind: 'point', pieceId: from.pieceId, point: from.position });
    c.tap({ kind: 'point', pieceId: to.pieceId, point: to.position });
    c.choose('route:own');
    expect(sent.map(a => a.type)).toEqual(['PLACE_BELT']);
    s = apply(s, sent[0]!);
    c.update(s, p);
    // Still laying belts (the rest of the route waits): the card can be bought from the bank and from the deck.
    expect(c.view.route).not.toBeNull();
    expect(legalActions(s, p).some(a => a.type === 'BUY_CARD')).toBe(true);
    expect(item(c, 'bank:buyCard')?.enabled).toBe(true);
    expect(isLit(c.view, { kind: 'deck' })).toBe(true);
    c.tap({ kind: 'deck' });
    expect(sent[1]).toEqual({ type: 'BUY_CARD' });
    s = apply(s, sent[1]!);
    c.update(s, p);
    // The tool stays in hand: the rest of the route is still shown.
    expect(c.view.route).not.toBeNull();
  });

  it('in Lay a belt (before or after a route) the deck is lit and the bank chip works', () => {
    const { s: s0, p } = ctx;
    const s = patchPlayer(s0, p, { inventory: INV(1, 1, 0) });
    for (const go of [(): void => undefined, (c: ReturnType<typeof harness>['c']): void => c.choose('bank:placeBelt'), (c: ReturnType<typeof harness>['c']): void => c.choose('bank:removeBelt')]) {
      const { c, sent } = harness(s, p);
      go(c);
      expect(isLit(c.view, { kind: 'deck' })).toBe(true);
      c.choose('bank:buyCard');
      expect(sent).toEqual([{ type: 'BUY_CARD' }]);
    }
  });

  for (const [what, inv] of [['one Ore and one Plate', INV(1, 1, 0)], ['one Sphere only', INV(0, 0, 1)], ['two Spheres', INV(0, 0, 2)]] as const) {
    it(`with two Mines in play and ${what}, the card is offered and the engine accepts it`, () => {
      const { s: s0, p } = ctx;
      const s = patchPlayer(s0, p, { inventory: inv });
      const { c, sent } = harness(s, p);
      expect(item(c, 'bank:buyCard')).toMatchObject({ enabled: true, price: 3 });
      expect(isLit(c.view, { kind: 'deck' })).toBe(true);
      c.tap({ kind: 'deck' });
      expect(sent).toEqual([{ type: 'BUY_CARD' }]);
      expect(applyAction(s, sent[0]!).ok).toBe(true);
    });
  }

  it('a tap on the deck when a card cannot be bought says why', () => {
    const { s: s0, p } = ctx;
    const poor = patchPlayer(s0, p, { inventory: INV(2, 0, 0) });
    const { c, sent } = harness(poor, p);
    expect(isLit(c.view, { kind: 'deck' })).toBe(false);
    c.tap({ kind: 'deck' });
    expect(c.view.hint).toBe(W.cantAfford(3, 2));
    // Only when the discard pile is empty too: otherwise it is shuffled into a new deck (#48).
    const { c: c2 } = harness({ ...s0, cardDeck: [], cardDiscard: [] }, p);
    c2.tap({ kind: 'deck' });
    expect(c2.view.hint).toBe(W.deckEmpty);
    const refill = patchPlayer({ ...s0, cardDeck: [], cardDiscard: ['embezzlement', 'sinkHole'] }, p, { inventory: INV(6, 0, 0) });
    const { c: c3, sent: sent3 } = harness(refill, p);
    expect(isLit(c3.view, { kind: 'deck' })).toBe(true);
    expect(c3.view.bank.find(i => i.id === 'bank:buyCard')?.detail).toContain('0 in the deck, 2 in the discard pile');
    c3.tap({ kind: 'deck' });
    expect(sent3).toEqual([{ type: 'BUY_CARD' }]);
    expect(sent).toEqual([]);
  });
});

// ── 2. The Teleporters well ───────────────────────────────────────────────────

describe('Teleporter reasons', () => {
  it('none left, too little value, no free buffer, not the actions step', () => {
    const { state, player } = atActions(5, 3);
    const tp = (s: GameState): ReturnType<typeof allItems>[number] | undefined => allItems(harness(s, player).c.view).find(i => i.id === 'bank:teleporter');
    expect(tp(patchPlayer(state, player, { teleportersRemaining: 0 }))).toMatchObject({ enabled: false, reason: W.noTeleporters });
    expect(tp(patchPlayer({ ...state, globalTeleporterCount: 2 }, player, { teleportersRemaining: 2, inventory: INV(1, 0, 0) })))
      .toMatchObject({ enabled: false, reason: W.cantAfford(3, 1) });
    // Every input (#55) and output of every building of mine already has a teleporter.
    const full: GameState = {
      ...patchPlayer(state, player, { teleportersRemaining: 2, inventory: INV(6, 0, 0) }),
      board: state.board.map(b => (b.claims.some(x => x.ownerId === player)
        ? {
          ...b,
          ...(b.input ? { input: { ...b.input, teleporters: b.input.slots.map(() => player) } } : {}),
          ...(b.output ? { output: { ...b.output, teleporters: [player] } } : {}),
        }
        : b)),
    };
    expect(tp(full)).toMatchObject({ enabled: false, reason: W.noFreeBuffer });
    const ok = patchPlayer(state, player, { teleportersRemaining: 2, inventory: INV(6, 0, 0) });
    const { c } = harness(ok, player);
    expect(item(c, 'bank:teleporter')?.enabled).toBe(true);
    c.choose('bank:teleporter');
    expect(c.view.instruction).toBe(W.teleporterPick);
    const rollState = findState((s, p) => s.phase === 'roll' && active(s) === p);
    expect(allItems(harness(rollState.state, rollState.player).c.view).find(i => i.id === 'bank:teleporter')?.reason).toBe(W.onlyActions);
  });
});

// ── 3. Total value ────────────────────────────────────────────────────────────

describe('Total value of the materials', () => {
  it('one Ore, one Plate and one Sphere are worth 11', () => {
    const { state, player } = atActions(5, 3);
    expect(harness(patchPlayer(state, player, { inventory: INV(1, 1, 1) }), player).c.view.totalValue).toBe(11);
    expect(harness(patchPlayer(state, player, { inventory: INV(0, 0, 0, 1) }), player).c.view.totalValue).toBe(23);
    // Also shown to a player whose turn it is not.
    const other = state.turnOrder.find(x => x !== player)!;
    expect(harness(patchPlayer(state, other, { inventory: INV(2, 0, 0) }), other).c.view.totalValue).toBe(2);
    expect(W.totalValue(11)).toBe('Total Value: 11');
  });
});

// ── 4. What a Mine point earns ────────────────────────────────────────────────

describe('Meeple on a Mine: the prompt says what it earns', () => {
  const found = findState((s, p) => s.phase === 'placeMeeple' && active(s) === p && s.players[p]!.meepleOnPieceId === null
    && legalActions(s, p).some(a => a.type === 'PLACE_MEEPLE' && a.slotIndex === 0 && a.pieceId === s.board.find(x => x.type === 'mine')!.id)
    && legalActions(s, p).some(a => a.type === 'PLACE_MEEPLE' && a.slotIndex === 1));
  const firstMine = found.state.board.find(x => x.type === 'mine')!.id;

  it('resource point of the first Mine: 2 Ore, and the limit is mentioned when it would cut it', () => {
    const { state, player } = found;
    const { c } = harness(patchPlayer(state, player, { inventory: INV(0, 0, 0) }), player);
    c.tap({ kind: 'mineSlot', pieceId: firstMine, slot: 0 });
    expect(c.view.instruction).toBe('Place your meeple on the Mine resource point to gain 2 Ore at the end of the round?');
    const { c: c5 } = harness(patchPlayer(state, player, { inventory: INV(5, 0, 0) }), player);
    c5.tap({ kind: 'mineSlot', pieceId: firstMine, slot: 0 });
    expect(c5.view.instruction).toContain('to gain 2 Ore at the end of the round?');
    expect(c5.view.instruction).toContain('You hold 5 Ore, so only 1 fits under your limit of 6.');
    const { c: c6 } = harness(patchPlayer(state, player, { inventory: INV(6, 0, 0) }), player);
    c6.tap({ kind: 'mineSlot', pieceId: firstMine, slot: 0 });
    expect(c6.view.instruction).toContain('You already hold 6 Ore, so it would be lost');
  });

  it('upgrade point: Mines in play + 1 Control Module upgrades', () => {
    const { state, player } = found;
    const mineId = legalActions(state, player).find((a): a is PlaceMeepleAction => a.type === 'PLACE_MEEPLE' && a.slotIndex === 1)!.pieceId;
    const { c } = harness(state, player);
    c.tap({ kind: 'mineSlot', pieceId: mineId, slot: 1 });
    expect(c.view.instruction).toBe(`Place your meeple on the Mine upgrade point to gain ${state.mineCount + 1} Control Module upgrades at the end of the round?`);
  });

  it('a building keeps the plain question', () => {
    const { state, player } = found;
    const b = legalActions(state, player).find((a): a is PlaceMeepleAction => a.type === 'PLACE_MEEPLE' && a.slotIndex === undefined);
    if (!b) return;
    const { c } = harness(state, player);
    c.tap({ kind: 'piece', pieceId: b.pieceId });
    expect(c.view.instruction).toMatch(/^Place your meeple on the .+\?$/);
    expect(c.view.instruction).not.toContain('gain');
  });
});

// ── 5. Exchanging from the inventory ──────────────────────────────────────────

describe('Exchange by pressing a material in the inventory', () => {
  it('a Sphere: "Exchange 1 Sphere for 2 Plates and 1 Ore?", then Confirm sends the exchange', () => {
    const { state, player } = atActions(5, 3);
    const s = patchPlayer(state, player, { inventory: INV(0, 0, 1) });
    const { c, sent } = harness(s, player);
    expect(item(c, 'inv:sphere')?.enabled).toBe(true);
    expect(item(c, 'inv:plate')).toMatchObject({ enabled: false, reason: W.exchangeNone('plate') });
    c.choose('inv:sphere');
    expect(c.view.instruction).toBe('Exchange 1 Sphere for 2 Plates and 1 Ore?');
    expect(c.view.confirmBar).toMatchObject({ confirm: true, cancel: true });
    expect(sent).toEqual([]);
    c.confirm();
    expect(sent).toEqual([{ type: 'EXCHANGE_MATERIALS', give: 'sphere' }]);
    // The bank's Exchange stays.
    expect(item(c, 'bank:exchange')).toBeDefined();
  });

  it('says before confirming when the limit of 6 would swallow part of what comes back', () => {
    const { state, player } = atActions(5, 3);
    const { c } = harness(patchPlayer(state, player, { inventory: INV(6, 5, 1) }), player);
    c.choose('inv:sphere');
    expect(c.view.instruction).toContain('Exchange 1 Sphere for 2 Plates and 1 Ore?');
    expect(c.view.instruction).toContain('Only 1 of the 2 Plates fits under your limit of 6');
    expect(c.view.instruction).toContain('You already hold 6 Ore, so the 1 Ore would be lost.');
    const { c: c2 } = harness(patchPlayer(state, player, { inventory: INV(0, 1, 0, 1) }), player);
    c2.choose('inv:tesseract');
    expect(c2.view.instruction).toBe('Exchange 1 Tesseract for 3 Spheres and 2 Ore?');
    c2.cancel();
    expect(c2.view.confirmBar).toBeNull();
  });

  it('pressed when it cannot be done now, it says why', () => {
    const { state, player } = atActions(5, 3);
    const other = state.turnOrder.find(x => x !== player)!;
    const s = patchPlayer(state, other, { inventory: INV(0, 1, 1) });
    const { c, sent } = harness(s, other);
    expect(item(c, 'inv:sphere')).toMatchObject({ enabled: false, reason: W.notYourTurn });
    c.choose('inv:sphere');
    expect(c.view.hint).toBe(W.notYourTurn);
    const rollState = findState((x, p) => x.phase === 'roll' && active(x) === p && x.players[p]!.inventory.plate > 0);
    const { c: c2 } = harness(rollState.state, rollState.player);
    c2.choose('inv:plate');
    expect(c2.view.hint).toBe(W.onlyActionsOrRoundEnd);
    expect(sent).toEqual([]);
  });

  it('follows the legal list: offered exactly when the engine lists the exchange, in any step', () => {
    let checked = 0;
    findState((s, p) => {
      const legal = new Set(legalActions(s, p).filter(a => a.type === 'EXCHANGE_MATERIALS').map(a => (a as { give: string }).give));
      const v = harness(s, p).c.view;
      for (const give of ['plate', 'sphere', 'tesseract']) {
        expect(v.inventory.find(i => i.id === `inv:${give}`)?.enabled).toBe(legal.has(give));
      }
      checked++;
      return checked > 400;
    }, { seeds: [3], players: [3] });
    expect(checked).toBeGreaterThan(400);
  });
});

// ── 6. No stray Confirm in the meeple step ────────────────────────────────────

describe('Meeple step: Confirm only for a spot the player pressed', () => {
  const found = findState((s, p) => s.phase === 'placeMeeple' && active(s) === p && s.players[p]!.meepleOnPieceId === null
    && legalActions(s, p).some(a => a.type === 'PLACE_MEEPLE' && a.slotIndex !== undefined));

  it('a tap off the board after choosing a Mine point puts the choice back (no Confirm left)', () => {
    const { state, player } = found;
    const a = legalActions(state, player).find((x): x is PlaceMeepleAction => x.type === 'PLACE_MEEPLE' && x.slotIndex !== undefined)!;
    const { c, sent } = harness(state, player);
    expect(c.view.confirmBar).toBeNull();
    c.tap({ kind: 'mineSlot', pieceId: a.pieceId, slot: a.slotIndex! });
    expect(c.view.confirmBar?.confirm).toBe(true);
    // A space far from the board, then the stacks, then the deck.
    for (const t of [{ kind: 'cell', q: 40, r: -40 }, { kind: 'stack', index: 0 }, { kind: 'deck' }] as Target[]) {
      c.tap({ kind: 'mineSlot', pieceId: a.pieceId, slot: a.slotIndex! });
      expect(c.view.confirmBar?.confirm).toBe(true);
      c.tap(t);
      expect(c.view.confirmBar?.confirm ?? false).toBe(false);
      expect(c.view.meeplePick).toBeNull();
      expect(c.view.hint).toBe(W.meepleOffTarget);
      c.confirm();
      expect(sent).toEqual([]);
    }
    // A tap past the table's edge (nothing hit) does the same.
    c.tap({ kind: 'mineSlot', pieceId: a.pieceId, slot: a.slotIndex! });
    c.tapNothing();
    expect(c.view.confirmBar?.confirm ?? false).toBe(false);
    c.confirm();
    expect(sent).toEqual([]);
  });

  it('a tap on empty table with nothing chosen shows no Confirm and says where the meeple can go', () => {
    const { state, player } = found;
    const { c, sent } = harness(state, player);
    c.tap({ kind: 'cell', q: 40, r: -40 });
    expect(c.view.confirmBar).toBeNull();
    expect(c.view.hint).toBe(W.meepleOffTarget);
    c.confirm();
    expect(sent).toEqual([]);
  });

  it('random taps anywhere: Confirm only ever sends the legal spot pressed last', () => {
    const r = new Rand(77);
    const { state, player } = found;
    const legal = legalActions(state, player).filter((x): x is PlaceMeepleAction => x.type === 'PLACE_MEEPLE');
    const piece = (): string => r.pick(state.board).id;
    for (let round = 0; round < 60; round++) {
      const { c, sent } = harness(state, player);
      let last: PlaceMeepleAction | null = null;
      for (let i = 0; i < 6; i++) {
        const targets: Target[] = [
          ...c.view.targets,
          { kind: 'cell', q: r.int(40) - 20, r: r.int(40) - 20 }, { kind: 'piece', pieceId: piece() },
          { kind: 'mineSlot', pieceId: piece(), slot: r.int(2) }, { kind: 'point', pieceId: piece(), point: r.int(12) },
          { kind: 'buffer', pieceId: piece(), buffer: 'input' }, { kind: 'stack', index: r.int(3) }, { kind: 'deck' },
        ];
        const t = r.pick(targets);
        c.tap(t);
        const pick = c.view.meeplePick;
        last = pick ? legal.find(a => a.pieceId === pick.pieceId && (a.slotIndex ?? null) === pick.slot) ?? null : null;
        if (c.view.confirmBar?.confirm) expect(last).not.toBeNull();
      }
      c.confirm();
      if (last) expect(sent).toEqual([last]);
      else expect(sent).toEqual([]);
    }
  });
});

// ── 7. Scouting Drone ─────────────────────────────────────────────────────────

describe('Scouting Drone choices', () => {
  it('each offered piece is named by stack and piece type; the position shows only to tell twins apart', () => {
    const { state, player } = atActions(5, 3);
    const s = patchPlayer({ ...state, cardsPlayedThisTurn: 0 }, player, { hand: ['scoutingDrone'] });
    const plays = legalActions(s, player).filter(a => a.type === 'PLAY_CARD' && a.cardType === 'scoutingDrone') as Extract<Action, { type: 'PLAY_CARD' }>[];
    const { c } = harness(s, player);
    c.choose('card:scoutingDrone');
    const items = c.view.choices!.items;
    const offered = [...new Set(plays.map(a => `${a.stackIndex}:${a.pieceIndex}`))];
    expect(items.map(i => i.id).sort()).toEqual(offered.map(k => `drone:${k}`).sort());
    for (const it of items) {
      const [si, pi] = it.id.split(':').slice(1).map(Number) as [number, number];
      const type = s.stacks[si as 0 | 1 | 2].pieces[pi]!.type;
      const twins = offered.filter(k => k.startsWith(`${si}:`) && s.stacks[si as 0 | 1 | 2].pieces[Number(k.split(':')[1])]!.type === type).length;
      expect(it.label.startsWith(`Stack ${si + 1}: `)).toBe(true);
      if (twins === 1) expect(it.label).not.toMatch(/piece \d/);
      else expect(it.label).toMatch(/\(piece \d+\)$/);
    }
  });
});
