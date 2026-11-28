// The round as players see it: during the round-end turns of round N the engine already counts
// N + 1, but everything shown or named says round N (the owner read "Round 7" during the
// round-end turns of round 6 as "the round is not over yet").

import { describe, it, expect } from 'vitest';
import type { GameState } from '../../engine/state';
import { applyAction, createGame, legalActions } from '../../engine';
import { roundFileTag, roundLabel, shownRound } from '../rounds';
import { roundLines } from '../describe';
import { replayFileName } from '../replay';
import type { ReplayFile } from '../replay';
import { saveSummary, toSave } from '../save';
import { activeSeat } from '../room';
import { findState, playingRoom } from './helpers';

const roundEnd = findState(2, s => s.phase === 'roundEnd' && s.round >= 3);
const ordinary = findState(2, s => s.phase === 'actions' && s.round >= 3);

describe('shownRound', () => {
  it('shows the engine round during an ordinary turn', () => {
    expect(shownRound(ordinary)).toEqual({ round: ordinary.round, roundEnd: false });
    expect(roundLabel(ordinary)).toBe(`Round ${ordinary.round}`);
    expect(roundFileTag(ordinary)).toBe(`round-${ordinary.round}`);
  });

  it('shows the round that has just ended during the round-end turns', () => {
    expect(shownRound(roundEnd)).toEqual({ round: roundEnd.round - 1, roundEnd: true });
    expect(roundLabel(roundEnd)).toBe(`End of round ${roundEnd.round - 1}`);
    expect(roundFileTag(roundEnd)).toBe(`round-${roundEnd.round - 1}-end`);
  });

  it('shows round 1 in the setup claims and the first turn', () => {
    const setup = createGame(3, 2);
    expect(setup.phase).toBe('setupClaimPF');
    expect(shownRound(setup)).toEqual({ round: 1, roundEnd: false });
    const first = findState(2, s => s.phase === 'placePiece' && s.round === 1);
    expect(roundLabel(first)).toBe('Round 1');
    // The first round-end turns close round 1, never "round 0".
    const firstEnd = findState(2, s => s.phase === 'roundEnd' && s.round === 2);
    expect(roundLabel(firstEnd)).toBe('End of round 1');
  });

  it('after the game is over: the last round played', () => {
    // The pieces ran out: decided as the last round-end turn ends, when the engine already counts a next round.
    const exhausted: GameState = { ...ordinary, phase: 'placePiece', round: 9, gameOver: true, gameOverReason: 'boardExhausted', winner: 0 };
    expect(shownRound(exhausted)).toEqual({ round: 8, roundEnd: false });
    // Four Tesseracts on a player's own turn: that round.
    const tesseracts: GameState = { ...ordinary, gameOver: true, gameOverReason: 'tesseracts', winner: 0 };
    expect(shownRound(tesseracts)).toEqual({ round: ordinary.round, roundEnd: false });
  });

  it('the log and the screen name the same round at a round end', () => {
    // The last ordinary turn of a round ends: the log line starts with what the turn bar shows.
    const last = findState(2, s => s.phase === 'placeMeeple' && s.activePlayerIndex === s.turnOrder.length - 1
      && legalActions(s, activeSeat(s)!).some(a => a.type === 'END_TURN') && s.players[activeSeat(s)!]!.meepleOnPieceId !== null);
    const res = applyAction(last, { type: 'END_TURN' });
    expect(res.ok).toBe(true);
    const after = (res as { ok: true; state: GameState }).state;
    expect(roundLines(last, after)).toEqual([`End of round ${last.round}: the round-end turns begin.`]);
    expect(roundLines(last, after)[0]!.startsWith(roundLabel(after))).toBe(true);
  });
});

describe('file names and the save list use the round players see', () => {
  const replay = { code: 'TDZHU' } as ReplayFile;

  it('a replay saved during the round-end turns of round N is named after round N', () => {
    expect(replayFileName(replay, roundEnd)).toBe(`factory-spaghetti-TDZHU-round-${roundEnd.round - 1}-end.fsreplay`);
    expect(replayFileName(replay, ordinary)).toBe(`factory-spaghetti-TDZHU-round-${ordinary.round}.fsreplay`);
    expect(replayFileName(replay, { ...ordinary, gameOver: true })).toBe('factory-spaghetti-TDZHU-final.fsreplay');
  });

  it('the save list shows the ended round during the round-end turns; the save itself is unchanged', () => {
    const room = playingRoom(roundEnd, [{ kind: 'human', name: 'Ann' }, { kind: 'human', name: 'Bea' }], 0);
    const save = toSave(room, { savedAt: 1, app: 'test' });
    expect(saveSummary(save)).toMatchObject({ round: roundEnd.round - 1, roundEnd: true });
    expect(save.room.game!.round).toBe(roundEnd.round);
    const mid = toSave(playingRoom(ordinary, [{ kind: 'human', name: 'Ann' }, { kind: 'human', name: 'Bea' }], 0), { savedAt: 1, app: 'test' });
    expect(saveSummary(mid)).toMatchObject({ round: ordinary.round, roundEnd: false });
  });
});
