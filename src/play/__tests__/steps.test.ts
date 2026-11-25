// Leverage cards in every step of your own turn (RULES_CHANGES.md #50): a card the list offers is
// playable in the place-a-piece, roll and place-meeple steps with the same flow as in the actions
// step; the step's own task comes back afterwards; Production Increase is spent in any step;
// Scouting Drone only before the draw.

import { describe, expect, it } from 'vitest';
import type { Action } from '../../engine/actions';
import type { CardType } from '../../engine/config';
import type { GameState, Player, PlayerId, TurnPhase } from '../../engine/state';
import { applyAction, legalActions } from '../../engine';
import { W } from '../words';
import { active, allItems, findState, gesturesFor, harness, isLit } from './helpers';

function patchPlayer(s: GameState, p: PlayerId, patch: Partial<Player>): GameState {
  return { ...s, players: s.players.map((x, i) => (i === p ? { ...x, ...patch } : x)) };
}

function apply(s: GameState, a: Action): GameState {
  const r = applyAction(s, a);
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
  return r.state;
}

/** The active player's own turn in `phase`, nothing pending, holding `hand`. */
function at(phase: TurnPhase, hand: CardType[], extra: (s: GameState, p: PlayerId) => boolean = () => true): { s: GameState; p: PlayerId } {
  const { state, player } = findState((s, p) => s.phase === phase && active(s) === p && s.pendingFactoryOps.length === 0
    && s.pendingMineIds.length === 0 && s.overstockPieces.length === 0 && s.round >= 3 && extra(s, p), { players: [3] });
  return { s: patchPlayer({ ...state, cardsPlayedThisTurn: 0 }, player, { hand, teleportersRemaining: 2, inventory: { ore: 3, plate: 2, sphere: 1, tesseract: 0 } }), p: player };
}

const plays = (s: GameState, p: PlayerId, card: CardType): Action[] =>
  legalActions(s, p).filter(a => a.type === 'PLAY_CARD' && a.cardType === card);

const reached: string[] = [];

describe('Leverage cards outside the actions step', () => {
  const cases: { phase: TurnPhase; step: string; cards: CardType[] }[] = [
    { phase: 'placePiece', step: 'place', cards: ['embezzlement', 'sinkHole', 'changingPriorities', 'shortSale'] },
    { phase: 'roll', step: 'roll', cards: ['embezzlement', 'sinkHole', 'changingPriorities', 'rdTaxWriteOff', 'productionIncrease'] },
    { phase: 'placeMeeple', step: 'meeple', cards: ['embezzlement', 'sinkHole', 'changingPriorities', 'shortSale', 'personalJetPack'] },
  ];
  for (const { phase, step, cards } of cases) {
    for (const card of cards) {
      it(`${step} step: ${card} is offered in the hand and every listed play is reachable`, () => {
        const { s, p } = at(phase, [card], (st, pl) => phase !== 'placeMeeple' || legalActions(st, pl).some(a => a.type === 'PLACE_MEEPLE'));
        const listed = plays(s, p, card);
        if (listed.length === 0) return; // nothing to target in this state
        reached.push(`${step}/${card}`);
        const { c } = harness(s, p);
        expect(c.view.step).toBe(step);
        expect(c.view.hand[0]).toMatchObject({ enabled: true });
        for (const a of listed.slice(0, 25)) {
          const h = harness(s, p);
          gesturesFor(h.c, a);
          expect(h.sent).toEqual([a]);
        }
      });
    }
  }

  it('the step\'s own task comes back after a card is cancelled or played', () => {
    const { s, p } = at('placeMeeple', ['sinkHole', 'embezzlement'], (st, pl) => legalActions(st, pl).some(a => a.type === 'PLACE_MEEPLE'));
    const { c, sent } = harness(s, p);
    const meepleTargets = c.view.targets.length;
    expect(meepleTargets).toBeGreaterThan(0);
    expect(c.view.instruction).toBe(W.meeplePlace);
    c.choose('card:sinkHole');
    // While the card waits for its target, the meeple's targets are put away.
    expect(c.view.instruction).toBe(W.sinkHolePick);
    expect(c.view.targets.every(t => t.kind === 'piece')).toBe(true);
    c.cancel();
    expect(c.view.instruction).toBe(W.meeplePlace);
    expect(c.view.targets.length).toBe(meepleTargets);
    // Embezzlement: confirm plays it; the meeple step is back.
    c.choose('card:embezzlement');
    c.confirm();
    expect(sent).toEqual([{ type: 'PLAY_CARD', cardType: 'embezzlement' }]);
    expect(c.view.instruction).toBe(W.meeplePlace);
  });

  it('place step: the drawn piece\'s spaces stay lit after a card is played', () => {
    const { s, p } = at('placePiece', ['embezzlement'], (st, pl) => legalActions(st, pl).some(a => a.type === 'PLACE_PIECE'));
    const { c, sent } = harness(s, p);
    expect(c.view.targets.some(t => t.kind === 'cell')).toBe(true);
    c.choose('card:embezzlement');
    expect(c.view.targets.some(t => t.kind === 'cell')).toBe(false);
    c.confirm();
    expect(sent).toHaveLength(1);
    c.update(apply(s, sent[0]!), p);
    expect(c.view.step).toBe('place');
    expect(c.view.targets.some(t => t.kind === 'cell')).toBe(true);
  });

  it('roll step: the Roll button stays the step\'s task', () => {
    const { s, p } = at('roll', ['embezzlement']);
    const { c, sent } = harness(s, p);
    c.choose('card:embezzlement');
    c.confirm();
    c.update(apply(s, sent[0]!), p);
    expect(c.view.primary).toMatchObject({ label: W.rollLabel(s.mineCount), enabled: true });
    c.primary();
    expect(sent[1]).toEqual({ type: 'ROLL_DICE', rolls: [] });
  });

  it('meeple step: Production Increase played, then an upgrade, then the meeple', () => {
    const { s, p } = at('placeMeeple', ['productionIncrease'], (st, pl) => legalActions(st, pl).some(a => a.type === 'PLACE_MEEPLE')
      && st.board.some(b => b.claims.some(x => x.ownerId === pl && x.controlModule < 12)));
    const { c, sent } = harness(s, p);
    gesturesFor(c, { type: 'PLAY_CARD', cardType: 'productionIncrease' });
    expect(sent).toEqual([{ type: 'PLAY_CARD', cardType: 'productionIncrease' }]);
    const s1 = apply(s, sent[0]!);
    c.update(s1, p);
    // Production Increase first: its buildings glow, and Done returns to the meeple.
    expect(c.view.instruction).toBe(W.piInstruction(4));
    const ups = legalActions(s1, p).filter(a => a.type === 'UPGRADE_BUILDING' && a.fromProductionIncrease);
    expect(ups.length).toBeGreaterThan(0);
    for (const a of ups.slice(0, 10)) {
      // From a fresh controller (a reload): "Spend Production Increase", then the building.
      const h = harness(s1, p);
      expect(allItems(h.c.view).find(i => i.id === 'bank:pi')?.enabled).toBe(true);
      gesturesFor(h.c, a);
      expect(h.sent).toEqual([a]);
    }
    const up = ups[0]!;
    if (up.type !== 'UPGRADE_BUILDING') throw new Error('upgrade');
    c.tap({ kind: 'piece', pieceId: up.pieceId });
    c.choose('menu:upgrade:pi');
    if (allItems(c.view).some(i => i.id === `old:${up.oldModule}`)) c.choose(`old:${up.oldModule}`);
    c.choose(`module:${up.newModule}`);
    expect(sent[1]).toMatchObject({ type: 'UPGRADE_BUILDING', fromProductionIncrease: true });
    c.choose('pi:done');
    expect(c.view.instruction).toBe(W.meeplePlace);
    const meeple = legalActions(s1, p).find(a => a.type === 'PLACE_MEEPLE')!;
    const h2 = harness(s1, p);
    gesturesFor(h2.c, meeple);
    expect(h2.sent).toEqual([meeple]);
  });

  it('Scouting Drone: before the draw only', () => {
    const { s: s0, p } = at('placePiece', ['scoutingDrone'], st => st.stacks[1].pieces.length > 0 && (st.drawnStackIndex ?? null) === null);
    const s = { ...s0, stacks: [s0.stacks[0], { ...s0.stacks[1], available: true }, s0.stacks[2]] as GameState['stacks'] };
    expect(legalActions(s, p).some(a => a.type === 'DRAW_PIECE')).toBe(true);
    const listed = plays(s, p, 'scoutingDrone');
    expect(listed.length).toBeGreaterThan(0);
    for (const a of listed.filter((_, i) => i % 37 === 0)) {
      const h = harness(s, p);
      gesturesFor(h.c, a);
      expect(h.sent).toEqual([a]);
    }
    const drawn = apply(s, legalActions(s, p).find(a => a.type === 'DRAW_PIECE')!);
    expect(plays(drawn, p, 'scoutingDrone')).toEqual([]);
    const { c } = harness(drawn, p);
    expect(c.view.hand[0]).toMatchObject({ enabled: false, reason: W.droneBeforeDraw });
  });

  it('not in the round-end turns', () => {
    const { s, p } = at('roundEnd', ['embezzlement']);
    expect(harness(s, p).c.view.hand[0]).toMatchObject({ enabled: false, reason: W.cardOwnTurnOnly });
  });

  it('after the meeple is down the turn waits while a card can still be played', () => {
    const { s, p } = at('placeMeeple', ['embezzlement'], (st, pl) => legalActions(st, pl).some(a => a.type === 'PLACE_MEEPLE'));
    const meeple = legalActions(s, p).find(a => a.type === 'PLACE_MEEPLE')!;
    const { c, sent } = harness(s, p);
    gesturesFor(c, meeple);
    expect(sent).toEqual([meeple]);
    c.update(apply(s, meeple), p);
    // END_TURN is not the only move (the card can still be played): nothing more is sent.
    expect(sent).toHaveLength(1);
    expect(c.view.instruction).toBe(W.meepleDoneCards);
    expect(c.view.primary).toMatchObject({ label: W.endTurn, enabled: true });
    expect(isLit(c.view, { kind: 'deck' })).toBe(false);
  });
});

describe('coverage of the step cases above', () => {
  it('most cards had something to play on', () => {
    // eslint-disable-next-line no-console -- which (step, card) pairs were checked
    console.log(`cards played outside the actions step: ${reached.join(', ')}`);
    expect(reached.length).toBeGreaterThanOrEqual(10);
  });
});
