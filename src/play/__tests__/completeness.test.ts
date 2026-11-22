// Completeness: for every action legalActions offers (plus the roll), a player can make the
// controller send exactly that action with gestures on what the view offers.
//
// Two sizes:
//   default          a fixed, seeded subset that runs in seconds: 3 games (2, 3 and 4 players),
//                    each action kind sampled in a few states, and at most a seeded 20 actions
//                    of each kind checked per sampled state.
//   FS_FULL=1        the full sweep: 7 games, more states, and EVERY action of each sampled state.
// Both must cover every Action type, every card, every phase, every forced sub-state and
// 2, 3 and 4 players; if the planned games miss something, fixed extra seeds are played
// (sampling only states that offer what is missing) until it is covered.
//
// Budget, so a run can never hang: sampling stops once FS_BUDGET_S seconds have passed
// (default 90 s, or 600 s with FS_FULL=1; 0 = no limit) or FS_MAX_STATES states were sampled
// (default no limit). The report line says whether the budget stopped it, and how many states,
// offered actions and checked actions it covered. Coverage is still asserted, so a budget too
// small to cover every action kind fails rather than passing quietly.
// Measured on the development machine (November 2026): default about 11 s (96 states, 1,870 of
// 41,460 offered actions checked); the full, unbounded sweep (FS_FULL=1 FS_BUDGET_S=0) about
// 3 minutes (7 games, 302 states, all 147,495 offered actions checked), well inside its budget.
// If it gets much slower, look first at the view build: every checked action builds views.

import { describe, expect, it } from 'vitest';
import type { Action } from '../../engine/actions';
import type { GameState, PlayerId, TurnPhase } from '../../engine/state';
import { legalActions } from '../../engine';
import {
  ALL_ACTION_TYPES, GestureError, Rand, expectedSend, gesturesFor, harness, offered, playRandom,
} from './helpers';

const FULL = process.env.FS_FULL === '1';
const envNumber = (name: string, fallback: number): number => {
  const v = Number(process.env[name]);
  return process.env[name] !== undefined && Number.isFinite(v) && v >= 0 ? v : fallback;
};
const BUDGET_S = envNumber('FS_BUDGET_S', FULL ? 600 : 90);
const MAX_STATES = envNumber('FS_MAX_STATES', 0);
/** Thrown out of a game when the budget is spent. */
class BudgetSpent extends Error {}

interface Size {
  name: string;
  plan: { pc: 2 | 3 | 4; seeds: number[] }[];
  extraSeeds: number[];       // played (per player count) only while something is still missing
  steps: number;              // moves per game
  minStates: number;          // sample a state while it offers an action kind seen in fewer sampled states
  minSub: number;             // ... or a forced sub-state seen fewer times
  baseline: number;           // chance to sample any other state
  perKindCap: number;         // actions of one kind checked per sampled state (Infinity = all)
}

const SIZE: Size = FULL
  ? {
    name: 'full', steps: 1500, minStates: 8, minSub: 15, baseline: 0.01, perKindCap: Infinity,
    plan: [{ pc: 2, seeds: [101, 102, 103] }, { pc: 3, seeds: [201, 202] }, { pc: 4, seeds: [301, 302] }],
    extraSeeds: [104, 105, 106, 107, 108],
  }
  : {
    name: 'default', steps: 1500, minStates: 3, minSub: 4, baseline: 0.002, perKindCap: 20,
    plan: [{ pc: 2, seeds: [101] }, { pc: 3, seeds: [201] }, { pc: 4, seeds: [301] }],
    extraSeeds: [102, 103, 104, 105, 106],
  };

const ALL_PHASES: readonly TurnPhase[] = ['setupClaimPF', 'setupClaimPP', 'placePiece', 'roll', 'actions', 'placeMeeple', 'roundEnd'];
const ALL_CARDS = ['scoutingDrone', 'shortSale', 'embezzlement', 'sinkHole', 'netSurplusSellOff', 'changingPriorities',
  'productionIncrease', 'personalJetPack', 'assetForfeiture', 'rdTaxWriteOff'].map(c => `PLAY_CARD/${c}`);
const SUB_STATES = ['pendingMine', 'overstock', 'pendingOps', 'othersPending', 'productionIncrease', 'drawPile'] as const;
type Sub = typeof SUB_STATES[number];

interface Tally { states: number; actions: number; offered: number }

function check(state: GameState, player: PlayerId, a: Action): void {
  const { c, sent } = harness(state, player);
  try {
    gesturesFor(c, a);
  } catch (e) {
    if (e instanceof GestureError) {
      throw new Error(`${e.message}\n  action ${JSON.stringify(a)}\n  phase ${state.phase}, player ${player}, instruction "${c.view.instruction}"`);
    }
    throw e;
  }
  expect(sent, `sends for ${JSON.stringify(a)}`).toHaveLength(1);
  expect(sent[0]).toEqual(expectedSend(a));
}

const keyOf = (a: Action): string => (a.type === 'PLAY_CARD' ? `PLAY_CARD/${a.cardType}` : a.type);

function subStatesOf(s: GameState, p: PlayerId): Sub[] {
  const out: Sub[] = [];
  if (s.pendingMineIds.length > 0 && s.phase === 'placePiece') out.push('pendingMine');
  if (s.overstockPieces.length > 0) out.push('overstock');
  if (s.pendingFactoryOps.some(e => e.ownerId === p)) out.push('pendingOps');
  if (s.pendingFactoryOps.some(e => e.ownerId !== p) && s.turnOrder[s.activePlayerIndex] === p) out.push('othersPending');
  if (s.productionIncreaseBudget > 0) out.push('productionIncrease');
  if (s.phase === 'placePiece' && s.turnOrder[s.activePlayerIndex] === p && legalActions(s, p).some(a => a.type === 'DRAW_PIECE')) out.push('drawPile');
  return out;
}

describe(`completeness (${SIZE.name}): every legal action has a gesture`, () => {
  it('covers seeded states from random games with 2, 3 and 4 players', () => {
    const t0 = Date.now();
    const tally = new Map<string, Tally>();
    const phases = new Map<string, number>();
    const subs = new Map<Sub, number>(SUB_STATES.map(k => [k, 0]));
    const counts = new Map<number, number>();
    let states = 0, checked = 0, offeredTotal = 0, games = 0;
    let stoppedBy: string | null = null;
    const spent = (): boolean => {
      if (stoppedBy) return true;
      if (BUDGET_S > 0 && Date.now() - t0 > BUDGET_S * 1000) stoppedBy = `time budget (${BUDGET_S} s)`;
      else if (MAX_STATES > 0 && states >= MAX_STATES) stoppedBy = `state budget (${MAX_STATES})`;
      return stoppedBy !== null;
    };

    const missing = (): string[] => [
      ...ALL_ACTION_TYPES.filter(t => ![...tally.keys()].some(k => k.split('/')[0] === t)),
      ...ALL_CARDS.filter(c => !tally.has(c)),
      ...ALL_PHASES.filter(ph => !phases.has(ph)),
      ...SUB_STATES.filter(k => (subs.get(k) ?? 0) === 0),
    ];

    const play = (pc: 2 | 3 | 4, seed: number, topUp: boolean): void => {
      if (spent()) return;
      games++;
      const r = new Rand(seed * 7);
      let drawVariant = 0;
      try {
      playRandom(seed, pc, SIZE.steps, (s0, p) => {
        if (spent()) throw new BudgetSpent();
        // Random games rarely open a second pile; also check the same place-a-piece step with pile 2
        // open (a few times per game), so the draw step is always covered.
        let s = s0;
        if (drawVariant < 3 && s0.phase === 'placePiece' && s0.turnOrder[s0.activePlayerIndex] === p && s0.pendingMineIds.length === 0
          && (s0.drawnStackIndex ?? null) === null && s0.stacks[1].pieces.length > 0 && !s0.stacks[1].available && r.next() < 0.3) {
          drawVariant++;
          s = { ...s0, stacks: [s0.stacks[0], { ...s0.stacks[1], available: true }, s0.stacks[2]] };
        }
        const acts = offered(s, p);
        if (acts.length === 0) return;
        const mySubs = subStatesOf(s, p);
        const wanted = topUp
          ? acts.some(a => !tally.has(keyOf(a))) || !phases.has(s.phase)
            || mySubs.some(k => (subs.get(k) ?? 0) === 0)
          : acts.some(a => (tally.get(keyOf(a))?.states ?? 0) < SIZE.minStates)
            || mySubs.some(k => (subs.get(k) ?? 0) < SIZE.minSub)
            || r.next() < SIZE.baseline;
        if (!wanted) return;
        states++;
        counts.set(pc, (counts.get(pc) ?? 0) + 1);
        phases.set(s.phase, (phases.get(s.phase) ?? 0) + 1);
        for (const k of mySubs) subs.set(k, (subs.get(k) ?? 0) + 1);
        // Group by kind; check all of a kind, or a seeded subset of SIZE.perKindCap.
        const byKind = new Map<string, Action[]>();
        for (const a of acts) byKind.set(keyOf(a), [...(byKind.get(keyOf(a)) ?? []), a]);
        for (const [key, list] of byKind) {
          let pick = list;
          if (list.length > SIZE.perKindCap) {
            const idx = new Set<number>();
            while (idx.size < SIZE.perKindCap) idx.add(r.int(list.length));
            pick = [...idx].sort((x, y) => x - y).map(i => list[i]!);
          }
          for (const a of pick) check(s, p, a);
          const t = tally.get(key) ?? { states: 0, actions: 0, offered: 0 };
          t.states++; t.actions += pick.length; t.offered += list.length;
          tally.set(key, t);
          checked += pick.length;
          offeredTotal += list.length;
        }
      });
      } catch (e) {
        if (!(e instanceof BudgetSpent)) throw e;
      }
    };

    for (const { pc, seeds } of SIZE.plan) for (const seed of seeds) play(pc, seed, false);
    for (const seed of SIZE.extraSeeds) {
      if (missing().length === 0) break;
      for (const pc of [2, 3, 4] as const) if (missing().length > 0) play(pc, seed + pc * 1000, true);
    }

    const rows = [...tally].sort(([a], [b]) => a.localeCompare(b))
      .map(([k, t]) => `  ${k.padEnd(34)} states ${String(t.states).padStart(5)}  checked ${String(t.actions).padStart(7)} of ${String(t.offered).padStart(7)} offered`);
    // eslint-disable-next-line no-console -- the completeness table is part of the report
    console.log([
      `completeness (${SIZE.name}): ${games} games, ${states} (state, player) samples, ${checked} of ${offeredTotal} offered actions checked, ${((Date.now() - t0) / 1000).toFixed(1)} s`,
      stoppedBy ? `stopped early by the ${stoppedBy}; raise it, or set FS_BUDGET_S=0 and leave FS_MAX_STATES unset for no limit` : 'ran to the end (no budget reached)',
      `players: ${[...counts].map(([k, n]) => `${k}p ${n}`).join(', ')}`,
      `phases: ${[...phases].map(([k, n]) => `${k} ${n}`).join(', ')}`,
      `sub-states: ${[...subs].map(([k, n]) => `${k} ${n}`).join(', ')}`,
      ...rows,
    ].join('\n'));
    expect(missing(), 'never sampled').toEqual([]);
    for (const pc of [2, 3, 4]) expect(counts.get(pc) ?? 0, `${pc}-player states`).toBeGreaterThan(0);
    if (FULL) expect(checked).toBe(offeredTotal);
  }, BUDGET_S > 0 ? BUDGET_S * 1000 + 120_000 : 7_200_000);
});
