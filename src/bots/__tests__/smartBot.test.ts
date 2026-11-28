// The Smart Bot (id 'greedy'): finishes whole games at every table size, never proposes a move
// the engine refuses (also from random positions of other bots' games and as a stand-in that
// takes over a half-built position), and is deterministic. The tests for its individual
// features (hand-built positions where the right move is clear) are in smartFeatures.test.ts.

import { describe, expect, it } from 'vitest';
import type { Action } from '../../engine/actions';
import type { GameState, PlayerId } from '../../engine/state';
import { createGame } from '../../engine/rules/setup';
import { applyAction } from '../../engine/reducer';
import { isListedMove } from '../../engine/rules/legalActions';
import type { BotFn } from '../botInterface';
import { chooseAction as smart } from '../greedyBot';
import { chooseAction as randomBot } from '../randomBot';
import { makeSmartBot } from '../smart/smartBot';
import { SMART_STYLE } from '../smart/config';
import { STYLE_BOTS } from '../styles/profiles';
import { playGame } from '../../sim/tournament';
import type { PlayerCount } from '../../sim/tournament';

const entrants = new Map<string, BotFn>([['greedy', smart], ...STYLE_BOTS.map(b => [b.style.id, b.fn] as [string, BotFn])]);
const styleIds = STYLE_BOTS.map(b => b.style.id);

/** Plays a game, calling `check` before each bot move (dice from a fixed sequence). */
function play(seed: number, seats: readonly BotFn[], check: (s: GameState, me: PlayerId, a: Action) => void, maxMoves = 12_000): GameState {
  let s = createGame(seed, seats.length as PlayerCount);
  let n = 0;
  let d = seed;
  while (!s.gameOver && n < maxMoves) {
    const me = (s.pendingFactoryOps[0]?.ownerId ?? s.turnOrder[s.activePlayerIndex])!;
    let a: Action;
    if (s.phase === 'roll' && s.pendingFactoryOps.length === 0) {
      a = { type: 'ROLL_DICE', rolls: Array.from({ length: s.mineCount }, () => { d = (d * 1103515245 + 12345) >>> 0; return 1 + (d >>> 16) % 6; }) };
    } else {
      a = seats[me]!(s, me);
      check(s, me, a);
    }
    const r = applyAction(s, a);
    if (!r.ok) throw new Error(`refused ${r.error.code}: ${JSON.stringify(a)}`);
    s = r.state;
    n++;
  }
  return s;
}

describe('Smart Bot finishes whole games', () => {
  for (const pc of [2, 3, 4] as const) {
    it(`${pc} players against the play styles: every game ends with no refused move`, () => {
      for (let k = 0; k < 2; k++) {
        const others = Array.from({ length: pc - 1 }, (_, i) => styleIds[(k * 2 + i + pc) % styleIds.length]!);
        const seats = [...others];
        seats.splice(k % pc, 0, 'greedy');
        const r = playGame({ seed: 900 + pc * 10 + k, playerCount: pc, seats }, entrants);
        expect(r.error, `seed ${900 + pc * 10 + k} [${seats.join(', ')}]`).toBeUndefined();
        expect(['tesseracts', 'boardExhausted']).toContain(r.ending);
      }
    }, 120_000);
  }

  it('beats the random fuzzer in a clear majority of 2-player games', () => {
    let wins = 0;
    const n = 12;
    for (let i = 0; i < n; i++) {
      const seats = i % 2 === 0 ? [smart, randomBot] : [randomBot, smart];
      const end = play(1000 + i, seats, () => undefined);
      if (end.winner === (i % 2 === 0 ? 0 : 1)) wins++;
    }
    expect(wins / n).toBeGreaterThanOrEqual(0.8);
  }, 120_000);
});

describe('Smart Bot plays only listed moves, deterministically', () => {
  it('every move it chooses in a full game is one the move list offers', () => {
    for (const pc of [2, 3, 4] as const) {
      const seats = [smart, ...STYLE_BOTS.slice(0, pc - 1).map(b => b.fn)];
      let moves = 0;
      const end = play(41 + pc, seats, (s, me, a) => {
        if (me !== 0) return;
        moves++;
        expect(isListedMove(s, me, a), `${JSON.stringify(a)} in ${s.phase}`).toBe(true);
      });
      expect(end.gameOver).toBe(true);
      expect(moves).toBeGreaterThan(50);
    }
  }, 120_000);

  it('from many random positions (games of the random fuzzer), its move is listed and accepted', () => {
    let asked = 0;
    for (const pc of [2, 3, 4] as const) {
      for (let g = 0; g < 3; g++) {
        const seats = Array.from({ length: pc }, () => randomBot);
        play(500 + pc * 7 + g, seats, (s, me) => {
          if ((s.round * 31 + s.board.length * 7 + me) % 5 !== 0) return;
          const a = smart(s, me);
          asked++;
          expect(isListedMove(s, me, a), `${JSON.stringify(a)} in ${s.phase}`).toBe(true);
          expect(applyAction(s, a).ok).toBe(true);
        }, 1500);
      }
    }
    expect(asked).toBeGreaterThan(200);
  }, 120_000);

  it('takes over a half-built position of another bot as a stand-in and finishes the game', () => {
    for (const pc of [2, 3, 4] as const) {
      const seats = styleIds.slice(0, pc);
      for (let seat = 0; seat < pc; seat++) {
        const r = playGame({ seed: 300 + pc, playerCount: pc, seats, takeover: { atAction: 250, seat, bot: 'greedy' } }, entrants);
        expect(r.error).toBeUndefined();
        expect(['tesseracts', 'boardExhausted']).toContain(r.ending);
      }
    }
  }, 120_000);

  it('the same state gives the same move (also from a copied state), and a game replays exactly', () => {
    const fresh = makeSmartBot(SMART_STYLE);
    const seats = [smart, STYLE_BOTS[3]!.fn, smart];
    let i = 0;
    const log: string[] = [];
    const end = play(77, seats, (s, me, a) => {
      log.push(JSON.stringify(a));
      if (i++ % 3 !== 0 || me === 1) return;
      const copy = JSON.parse(JSON.stringify(s)) as GameState;
      expect(fresh(copy, me)).toEqual(a);
    });
    const again: string[] = [];
    const end2 = play(77, [fresh, STYLE_BOTS[3]!.fn, fresh], (_s, _me, a) => { again.push(JSON.stringify(a)); });
    expect(again).toEqual(log);
    expect(end2.winner).toBe(end.winner);
  }, 120_000);

  it('a roll request carries one die per Mine from the state, never Math.random', () => {
    const real = Math.random;
    Math.random = (): number => { throw new Error('Math.random used'); };
    try {
      let s = createGame(5, 2);
      while (s.phase !== 'roll') {
        const me = s.turnOrder[s.activePlayerIndex]!;
        const r = applyAction(s, smart(s, me));
        if (!r.ok) throw new Error(r.error.code);
        s = r.state;
      }
      const a = smart(s, s.turnOrder[s.activePlayerIndex]!);
      expect(a.type).toBe('ROLL_DICE');
      if (a.type === 'ROLL_DICE') expect(a.rolls).toHaveLength(s.mineCount);
    } finally {
      Math.random = real;
    }
  });
});
