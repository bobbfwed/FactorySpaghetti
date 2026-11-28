// The second batch of animated examples: each replays through the engine (plays.test.ts checks
// that every move is a listed one), and what its captions say is what the engine did.

import { describe, it, expect } from 'vitest';
import {
  BELT_COST, FACTORY_POWER_COST, MINE_COSTS, POWER_PLANT_BASE_YIELD, POWER_PLANT_MATERIAL_YIELD, cardCost, teleporterCost,
} from '../../../engine/config';
import { tesseractCount } from '../../../engine/rules/scoring';
import type { GameState, PlayerId } from '../../../engine/state';
import * as P from '../content/morePlays';
import { activeSeat, buildTimeline, type StepRun } from '../figures/play';

const tl = (ex: Parameters<typeof buildTimeline>[0]): readonly StepRun[] => buildTimeline(ex).steps;
const piece = (s: GameState, id: string): GameState['board'][number] | undefined => s.board.find(p => p.id === id);
const inv = (s: GameState, p: number): GameState['players'][number]['inventory'] => s.players[p]!.inventory;
const ofKind = (s: StepRun, kind: string): string[] => s.moves.flatMap(m => m.plan.steps.filter(x => x.kind === kind).map(x => JSON.stringify(x)));

describe('Production', () => {
  const [roll, run, again] = tl(P.PRODUCTION_PLAY);
  it('activates exactly the buildings with the rolled number; each does what the caption says', () => {
    const out = Object.fromEntries(roll!.events.filter(e => e.kind === 'activated').map(e => [(e as { pieceId: string }).pieceId, (e as { outcome: string }).outcome]));
    expect(out).toEqual({ pf: 'awaiting-choice', sf: 'input-missing', opf: 'output-full' });
    expect(roll!.caption).toContain('**4**');
    const op = run!.events.find(e => e.kind === 'operated') as { powerChange: number; product: string };
    expect(-op.powerChange).toBe(FACTORY_POWER_COST.plate);
    expect(piece(run!.after, 'pf')!.output!.slots).toEqual(['plate']);
    expect(piece(run!.after, 'pf')!.input!.slots).toEqual(['ore']);
    expect(again!.events.find(e => e.kind === 'activated' && (e as { pieceId: string }).pieceId === 'pf')).toMatchObject({ outcome: 'output-full' });
  });
  it('Power Plants give what the config says for each material', () => {
    const [s] = tl(P.POWER_PLANTS_PLAY);
    const gain = (p: number): number => s!.after.players[p]!.powerTokens - s!.from.players[p]!.powerTokens;
    expect([gain(0), gain(1), gain(2), gain(3)]).toEqual([POWER_PLANT_BASE_YIELD, POWER_PLANT_MATERIAL_YIELD.ore, POWER_PLANT_MATERIAL_YIELD.plate, POWER_PLANT_MATERIAL_YIELD.sphere]);
    expect(s!.caption).toContain(`gives ${POWER_PLANT_BASE_YIELD}; Red's uses its Ore for ${POWER_PLANT_MATERIAL_YIELD.ore}; Orange's its Plate for ${POWER_PLANT_MATERIAL_YIELD.plate}; Green's its Sphere for ${POWER_PLANT_MATERIAL_YIELD.sphere}`);
  });
});

describe('Moving material', () => {
  const [own, other] = tl(P.MOVING_PLAY);
  it('passes by direct contact into the same player\'s building, Ore from the touching ore exit', () => {
    expect(piece(own!.after, 'sf')!.input!.slots).toContain('plate');
    expect(piece(own!.after, 'pf')!.output!.slots).toEqual([null]);
    expect(piece(own!.after, 'pf')!.input!.slots).toEqual(['ore']);
  });
  it('passes nothing into another player\'s building: the output stays full', () => {
    expect(piece(other!.from, 'sf')!.claims[0]!.ownerId).toBe(1);
    expect(piece(other!.after, 'sf')!.input!.slots).toEqual([null, null]);
    expect(piece(other!.after, 'pf')!.output!.slots).toEqual(['plate']);
  });
});

describe('Belts', () => {
  it('a chain from a Mine carries Ore to its owner\'s factory, and nothing to another player\'s', () => {
    const s = tl(P.BELT_CHAIN_PLAY);
    expect(s[1]!.after.players[0]!.beltsRemaining).toBe(s[0]!.from.players[0]!.beltsRemaining - 2);
    expect(piece(s[2]!.from, 'pf')!.input!.slots).toEqual([null]);
    expect(piece(s[2]!.after, 'pf')!.input!.slots).toEqual(['ore']);
    expect(ofKind(s[2]!, 'flow')).toHaveLength(1);
    expect(piece(s[3]!.after, 'pf')!.input!.slots).toEqual([null]);
    expect(ofKind(s[3]!, 'flow')).toHaveLength(0);
  });
  it('lights where a belt may end, then nothing at a second ore exit; a belt taken back returns, an older one goes to the bank', () => {
    const s = tl(P.BELT_RULES_PLAY);
    const ends = s[0]!.glow.map(t => (t as { point: number }).point).sort((a, b) => a - b);
    expect(ends).toHaveLength(7);
    for (const near of [5, 6, 8, 9]) expect(ends).not.toContain(near);
    expect(s[2]!.glow).toEqual([]);
    const belts = (x: GameState): number => x.players[0]!.beltsRemaining;
    expect(belts(s[3]!.after)).toBe(belts(s[3]!.from) + 1);
    expect(belts(s[4]!.after)).toBe(belts(s[4]!.from));
    expect(s[4]!.after.belts).toHaveLength(0);
  });
});

describe('Teleporters', () => {
  it('input: the price, the cut-off input, and an Ore supplied through the portal', () => {
    const [place, done, , run] = tl(P.TELEPORTER_IN_PLAY);
    expect(inv(place!.after, 0).ore).toBe(inv(place!.from, 0).ore - teleporterCost(0));
    expect(place!.caption).toContain(`= ${teleporterCost(0)}`);
    expect(piece(done!.after, 'sf')!.input!.slots).toEqual([null, 'plate']);
    expect(ofKind(run!, 'portalIn')).toHaveLength(1);
    const op = run!.events.find(e => e.kind === 'operated') as { powerChange: number; product: string };
    expect(op.product).toBe('sphere');
    expect(-op.powerChange).toBe(FACTORY_POWER_COST.sphere);
    expect(inv(run!.after, 0).ore).toBe(inv(run!.from, 0).ore - 1);
  });
  it('output: the Plate goes through the portal into Blue\'s materials', () => {
    const s = tl(P.TELEPORTER_OUT_PLAY);
    expect(s[0]!.caption).toContain(`for ${teleporterCost(0)}`);
    expect(inv(s[2]!.after, 0).plate).toBe(inv(s[2]!.from, 0).plate + 1);
    expect(piece(s[2]!.after, 'pf')!.output!.slots).toEqual([null]);
    expect(ofKind(s[2]!, 'portalOut')).toHaveLength(1);
  });
});

describe('Actions and the bank', () => {
  it('pays with change, buys a card at Mines + 1, and moves material along new belts when done', () => {
    const s = tl(P.ACTIONS_PLAY);
    expect(BELT_COST).toBe(1);
    expect(inv(s[0]!.after, 0)).toMatchObject({ plate: 0, ore: 2 });
    expect(s[2]!.after.players[0]!.hand).toHaveLength(1);
    expect(inv(s[2]!.after, 0).ore).toBe(2 - cardCost(1));
    expect(piece(s[3]!.after, 'pf')!.input!.slots).toEqual(['ore']);
  });
  it('the bank: change, a card, an exchange, and the second Mine for its price', () => {
    const s = tl(P.BANK_PLAY);
    expect(inv(s[0]!.after, 0)).toMatchObject({ ore: 2, plate: 0, sphere: 1 });
    expect(inv(s[1]!.after, 0).ore).toBe(0);
    expect(cardCost(1)).toBe(2);
    expect(inv(s[2]!.after, 0)).toMatchObject({ ore: 1, plate: 2, sphere: 0 });
    expect(s[3]!.caption).toContain(`costs ${MINE_COSTS[0]}`);
    expect(s[3]!.after.mineCount).toBe(2);
    expect(inv(s[3]!.after, 0)).toMatchObject({ ore: 1, plate: 0 });
  });
});

describe('The meeple and the end of a round', () => {
  it('rewards each meeple spot when the round ends', () => {
    const s = tl(P.MEEPLE_PLAY);
    const end = s[2]!.after;
    expect(end.phase).toBe('roundEnd');
    expect(inv(end, 0).ore).toBe(2);
    expect(end.players[1]!.freeActionCredits).toBe(2);
    expect(end.players.map(p => p.freeUpgradesRemaining)).toEqual([1, 1, 1]);
  });
  it('a round-end turn: load, run, collect, upgrade', () => {
    const s = tl(P.ROUND_END_PLAY);
    expect(inv(s[0]!.after, 2).ore).toBe(0);
    expect(s[1]!.after.players[2]!.powerTokens).toBe(s[1]!.from.players[2]!.powerTokens - FACTORY_POWER_COST.plate);
    expect(inv(s[2]!.after, 2).plate).toBe(1);
    expect(piece(s[3]!.after, 'gpf')!.claims).toEqual([{ ownerId: 2, controlModule: 4 }]);
    expect(s[3]!.after.players[2]!.controlModules).toContain(3);
  });
});

describe('Mines', () => {
  it('the last piece of a stack brings the next Mine; two dice after; Control Module 1 below the floor', () => {
    const s = tl(P.MINE_DROP_PLAY);
    expect(s[0]!.after.pendingMineIds).toEqual(['mine-2']);
    expect(s[0]!.after.stacks[1].available).toBe(true);
    expect(s[1]!.after.mineCount).toBe(2);
    const roll = s[2]!.events.find(e => e.kind === 'roll') as { dice: number[]; total: number };
    expect(roll.dice).toHaveLength(2);
    expect(s[2]!.caption).toContain(`${roll.dice[0]} and ${roll.dice[1]}, a total of ${roll.total}`);
    expect(s[3]!.after.players[1]!.controlModules).toContain(1);
  });
});

describe('Leverage cards', () => {
  it('Sink Hole: the piece and its belt leave; the belt goes to the bank, not to its owner', () => {
    const [s] = tl(P.SINK_HOLE_PLAY);
    expect(piece(s!.after, 'bl')).toBeUndefined();
    expect(s!.after.belts).toHaveLength(0);
    expect(s!.after.players[1]!.beltsRemaining).toBe(s!.from.players[1]!.beltsRemaining);
    expect(ofKind(s!, 'remove')).toHaveLength(1);
  });
  it('Changing Priorities: the module moves; the building left without an owner gives up its material and Teleporter', () => {
    const [s] = tl(P.CHANGING_PRIORITIES_PLAY);
    expect(piece(s!.after, 'a')!.claims).toEqual([]);
    expect(piece(s!.after, 'c')!.claims).toEqual([{ ownerId: 0, controlModule: 5 }]);
    expect(piece(s!.after, 'a')!.input!.slots).toEqual([null]);
    expect(piece(s!.after, 'a')!.output!.slots).toEqual([null]);
    expect(s!.after.players[0]!.teleportersRemaining).toBe(s!.from.players[0]!.teleportersRemaining + 1);
  });
  it('Asset Forfeiture: every Plate in every output goes to the player; the Sphere stays', () => {
    const [s] = tl(P.ASSET_FORFEITURE_PLAY);
    expect(inv(s!.after, 0).plate).toBe(2);
    expect(piece(s!.after, 'rsf')!.output!.slots).toEqual(['sphere']);
  });
  it('Short Sale: a free claim with the lowest usable module', () => {
    const [s] = tl(P.SHORT_SALE_PLAY);
    expect(piece(s!.after, 'sf')!.claims).toEqual([{ ownerId: 0, controlModule: 1 }]);
  });
});

describe('Bonuses and winning', () => {
  it('The Investor is gained at 10 and lost when someone goes higher', () => {
    const s = tl(P.BONUS_PLAY);
    expect(tesseractCount(s[0]!.after, 0)).toBe(1);
    expect(tesseractCount(s[1]!.after, 0)).toBe(0);
    expect(tesseractCount(s[1]!.after, 1)).toBe(1);
  });
  it('the fourth Tesseract in your own turn wins', () => {
    const s = tl(P.WIN_PLAY);
    expect(tesseractCount(s[0]!.after, 0)).toBe(3);
    expect(activeSeat(s[1]!.from)).toBe(0);
    expect(s[1]!.after.gameOver).toBe(true);
    expect(s[1]!.after.winner).toBe(0 as PlayerId);
    expect(tesseractCount(s[1]!.after, 0)).toBe(4);
  });
});

describe('One whole turn', () => {
  it('goes through the four steps in order, and then it is the next player\'s turn', () => {
    const s = tl(P.TURN_PLAY);
    expect(s.map(x => x.from.phase)).toEqual(['placePiece', 'roll', 'actions', 'placeMeeple']);
    expect(activeSeat(s[3]!.after)).toBe(1);
    expect(s[2]!.caption).toContain(`for ${cardCost(1)}`);
  });
});
