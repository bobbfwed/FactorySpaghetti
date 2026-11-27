// moduleBelowFloor: a Control Module numbered below the number of Mines in play can never be
// rolled, so the interface greys it out. The helper must agree with what legalActions offers: a
// module it calls below the floor is never offered for a claim, as an upgrade, or for Changing
// Priorities; every other module in the tray is offered for a claim when the budget allows.

import { describe, expect, it } from 'vitest';
import { createGame } from '../rules/setup';
import { applyAction, legalActions } from '../reducer';
import { moduleBelowFloor } from '../rules/modules';
import { moduleBelowFloor as exported } from '../index';
import { createRng, nextIntBelow } from '../rng';
import { CARD_COUNTS, CONTROL_MODULE_MAX } from '../config';
import type { CardType } from '../config';
import type { Action } from '../actions';
import type { GameState, PlayerId } from '../state';

describe('moduleBelowFloor', () => {
  it('is below the number of Mines in play', () => {
    expect(exported).toBe(moduleBelowFloor);
    for (let m = 1; m <= CONTROL_MODULE_MAX; m++) expect(moduleBelowFloor(m, 1)).toBe(false);
    expect(moduleBelowFloor(1, 2)).toBe(true);
    expect(moduleBelowFloor(2, 2)).toBe(false);
    expect(moduleBelowFloor(1, 3)).toBe(true);
    expect(moduleBelowFloor(2, 3)).toBe(true);
    expect(moduleBelowFloor(3, 3)).toBe(false);
  });
});

/** The modules the moves in `list` would place on a building (claims, upgrades, moves). */
function modulesOffered(list: readonly Action[]): number[] {
  const out: number[] = [];
  for (const a of list) {
    if (a.type === 'CLAIM_BUILDING') out.push(a.controlModule);
    else if (a.type === 'UPGRADE_BUILDING') out.push(a.newModule);
    else if (a.type === 'PLAY_CARD' && a.cardType === 'changingPriorities' && a.controlModule !== undefined) out.push(a.controlModule);
  }
  return out;
}

describe('moduleBelowFloor agrees with legalActions', () => {
  it('no module below the floor is ever offered; every other tray module can be claimed', { timeout: 120_000 }, () => {
    let rng = createRng(2026);
    const below = (n: number): number => { const [v, next] = nextIntBelow(rng, n); rng = next; return v; };
    const pick = <T>(xs: readonly T[]): T => xs[below(xs.length)]!;
    const allCards = Object.keys(CARD_COUNTS) as CardType[];
    const seen = { byMines: new Map<number, number>(), skippedOnBoardUpgraded: 0, fullClaimSets: 0 };

    for (const [pc, seed] of [[2, 21], [3, 22], [4, 23], [2, 24]] as const) {
      let s = createGame(seed, pc);
      for (let step = 0; step < 500 && !s.gameOver; step++) {
        const active = s.turnOrder[s.activePlayerIndex]!;
        const who = (s.pendingFactoryOps[0]?.ownerId ?? active) as PlayerId;

        // Every player's own listed moves, and the active player's in a state where a Production
        // Increase is running and every Leverage card is in hand, so claims, upgrades and moves are listed.
        const probes: Array<[GameState, PlayerId]> = [[s, who]];
        if (s.phase === 'actions' && s.pendingFactoryOps.length === 0) {
          probes.push([{
            ...s, productionIncreaseBudget: 40, productionIncreaseClaimedThisTurn: false, cardsPlayedThisTurn: 0,
            players: s.players.map(p => (p.id === active ? { ...p, hand: allCards } : p)),
          }, active]);
        }
        for (const [st, p] of probes) {
          const list = legalActions(st, p);
          const offered = modulesOffered(list);
          for (const m of offered) expect(moduleBelowFloor(m, st.mineCount), `seed ${seed} step ${step}: module ${m} with ${st.mineCount} Mines`).toBe(false);
          if (offered.length) seen.byMines.set(st.mineCount, (seen.byMines.get(st.mineCount) ?? 0) + 1);
          // An upgrade away from a module below the floor that already sits on a building.
          if (list.some(a => a.type === 'UPGRADE_BUILDING' && moduleBelowFloor(a.oldModule, st.mineCount))) seen.skippedOnBoardUpgraded++;
          // With a large Production Increase budget, the claims offered on a building use exactly
          // the tray modules that are not below the floor.
          const claims = list.filter((a): a is Extract<Action, { type: 'CLAIM_BUILDING' }> => a.type === 'CLAIM_BUILDING' && !!a.fromProductionIncrease);
          if (st.productionIncreaseBudget >= CONTROL_MODULE_MAX && claims.length) {
            const piece = claims[0]!.pieceId;
            const on = claims.filter(a => a.pieceId === piece).map(a => a.controlModule).sort((x, y) => x - y);
            const tray = [...st.players[p]!.controlModules].filter(m => !moduleBelowFloor(m, st.mineCount)).sort((x, y) => x - y);
            expect(on).toEqual(tray);
            seen.fullClaimSets++;
          }
        }

        // Advance: a roll, or a random move of whoever may act; buy a Mine whenever one is listed
        // and affordable, so games reach two and three Mines.
        let action: Action;
        if (s.phase === 'roll' && s.pendingFactoryOps.length === 0) {
          action = { type: 'ROLL_DICE', rolls: Array.from({ length: s.mineCount }, () => 1 + below(6)) };
        } else {
          let st = s;
          if (s.phase === 'actions' && s.pendingFactoryOps.length === 0 && s.round >= 2 && s.mineCount < 3) {
            st = { ...s, players: s.players.map(p => (p.id === active ? { ...p, inventory: { ore: 10, plate: 10, sphere: 10, tesseract: p.inventory.tesseract } } : p)) };
          }
          const legal = legalActions(st, who);
          if (legal.length === 0) break;
          const buy = legal.filter(a => a.type === 'BUY_MINE');
          if (buy.length && below(6) === 0) { s = st; action = pick(buy); } else {
            const types = [...new Set(legalActions(s, who).map(a => a.type))].filter(t => t !== 'REMOVE_BELT' || below(5) === 0);
            if (types.length === 0) break;
            const t = pick(types);
            action = pick(legalActions(s, who).filter(a => a.type === t));
          }
        }
        const r = applyAction(s, action);
        expect(r.ok, JSON.stringify(action)).toBe(true);
        if (!r.ok) break;
        s = r.state;
      }
    }
    // eslint-disable-next-line no-console -- coverage figures for the report
    console.log(`moduleBelowFloor sweep: ${JSON.stringify({ byMines: [...seen.byMines].sort(), skippedOnBoardUpgraded: seen.skippedOnBoardUpgraded, fullClaimSets: seen.fullClaimSets })}`);
    expect(seen.byMines.get(1) ?? 0).toBeGreaterThan(0);
    expect(seen.byMines.get(2) ?? 0).toBeGreaterThan(0);
    expect(seen.byMines.get(3) ?? 0).toBeGreaterThan(0);
    expect(seen.skippedOnBoardUpgraded).toBeGreaterThan(0);
    expect(seen.fullClaimSets).toBeGreaterThan(0);
  });
});
