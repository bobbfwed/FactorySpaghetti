// Replay files and rules-problem reports: making them, checking them, verifying every move with
// the engine, stepping through them with checkpoints, and opening them for the viewer.

import { describe, it, expect } from 'vitest';
import type { Action } from '../../engine/actions';
import type { GameState, PlayerId } from '../../engine/state';
import { applyAction, createGame, legalActions } from '../../engine';
import { chooseAction as greedy } from '../../bots/greedyBot';
import { activeSeat } from '../room';
import type { Room } from '../room';
import { diceRngFromSeed, rollDice } from '../dice';
import type { JournalData } from '../journal';
import { fullJournal, partialJournal, replayTo } from '../journal';
import { rulesFingerprint, serializeSaveFile, toSave } from '../save';
import type { ReplayFile } from '../replay';
import {
  CHECKPOINT_EVERY, MAX_REPLAY_BYTES, ReplayError, makeReplay, serializeReplay, validateReplay, verifyReplay,
} from '../replay';
import { makeReport, openPlaytestText, serializeReport } from '../report';
import { playingRoom } from './helpers';

/** A greedy game straight through the engine, with host-style dice; stops after `limit` moves. */
function playGame(seed: number, playerCount: 2 | 3 | 4, limit = 100_000): { journal: JournalData; state: GameState } {
  const journal = fullJournal(seed, playerCount);
  let s = createGame(seed, playerCount);
  let dice = diceRngFromSeed(seed);
  for (let n = 0; n < limit && !s.gameOver; n++) {
    const actor = (s.pendingFactoryOps[0]?.ownerId ?? activeSeat(s)) as PlayerId;
    let a: Action = greedy(s, actor);
    if (a.type === 'ROLL_DICE') {
      const [rolls, next] = rollDice(dice, s.mineCount);
      dice = next;
      a = { type: 'ROLL_DICE', rolls };
    }
    const res = applyAction(s, a);
    if (!res.ok) throw new Error(res.error.code);
    s = res.state;
    journal.moves.push(a);
  }
  return { journal, state: s };
}

function roomFor(state: GameState, seq: number): Room {
  const names = ['Ann', 'Bea', 'Cy', 'Dee'].slice(0, state.playerCount);
  return { ...playingRoom(state, names.map((name, i) => ({ kind: i === 0 ? 'human' as const : 'bot' as const, name })), 0), seq };
}

const finished = playGame(2025, 3);
const finishedRoom = roomFor(finished.state, finished.journal.moves.length);
const replay = makeReplay(finishedRoom, finished.journal, { savedAt: 1_700_000_000_000, app: 'test' });

describe('a replay file', () => {
  it('round-trips through its text, and verifies to the same final state', async () => {
    const opened = openPlaytestText(serializeReplay(replay));
    expect(opened.kind).toBe('replay');
    expect(opened.replay).toEqual(replay);
    const cursor = await verifyReplay(opened.replay, { yieldEvery: 0 });
    expect(cursor.refused).toBeNull();
    expect(cursor.sameRules).toBe(true);
    expect(cursor.length).toBe(finished.journal.moves.length);
    expect(cursor.stateAt(cursor.length)).toEqual(finished.state);
    expect(cursor.stateAt(cursor.length).gameOver).toBe(true);
  });

  it('steps backward and forward to the same states as replaying from the start', async () => {
    const cursor = await verifyReplay(replay, { yieldEvery: 0 });
    for (const p of [cursor.length, 0, 17, CHECKPOINT_EVERY, CHECKPOINT_EVERY - 1, 200, 199, 201, 5, cursor.length - 1]) {
      expect(cursor.stateAt(p)).toEqual(replayTo(finished.journal, p));
    }
    // Stepping back one move at a time from the end goes through every position.
    for (let p = cursor.length; p > cursor.length - 40; p--) expect(cursor.stateAt(p - 1)).toEqual(replayTo(finished.journal, p - 1));
    expect(cursor.lineAt(0)).toBe('The game begins.');
    expect(cursor.lineAt(1)).toMatch(/^(Ann|Bea|Cy) claimed the Plate Factory .* of the first Mine with Control Module 3, a free starting claim$/);
    expect(cursor.lineAt(1)).not.toMatch(/-?\d+,-?\d+/);
  });

  it('jumps to the next roll and to the next turn', async () => {
    const cursor = await verifyReplay(replay, { yieldEvery: 0 });
    const roll = cursor.nextRoll(0)!;
    expect(cursor.moveAt(roll)?.type).toBe('ROLL_DICE');
    expect(cursor.lineAt(roll)).toMatch(/ rolled /);
    for (let p = 1; p < roll; p++) expect(cursor.moveAt(p)?.type).not.toBe('ROLL_DICE');
    expect(cursor.prevRoll(roll + 3)).toBe(roll);
    const turn = cursor.nextTurn(roll)!;
    const a = cursor.stateAt(roll), b = cursor.stateAt(turn);
    expect(a.round * 8 + a.activePlayerIndex).not.toBe(b.round * 8 + b.activePlayerIndex);
    const c = cursor.stateAt(turn - 1);
    expect(c.round * 8 + c.activePlayerIndex).toBe(a.round * 8 + a.activePlayerIndex);
    expect(cursor.prevTurn(turn + 1)).toBe(turn);
    expect(cursor.nextRoll(cursor.length)).toBeNull();
    expect(cursor.nextTurn(cursor.length)).toBeNull();
  });

  it('starts from a snapshot when only part of the game is known (a partial replay)', async () => {
    const at = 150;
    const mid = replayTo(finished.journal, at)!;
    const part: JournalData = { ...partialJournal(mid, at), moves: finished.journal.moves.slice(at) };
    const r = makeReplay(finishedRoom, part, { savedAt: 1, app: 'test' });
    const opened = openPlaytestText(serializeReplay(r));
    const cursor = await verifyReplay(opened.replay, { yieldEvery: 0 });
    expect(cursor.partial).toBe(true);
    expect(cursor.firstSeq).toBe(at);
    expect(cursor.seqAt(0)).toBe(at);
    expect(cursor.seqAt(cursor.length)).toBe(finished.journal.moves.length);
    expect(cursor.stateAt(cursor.length)).toEqual(finished.state);
    expect(cursor.lineAt(0)).toMatch(/^The replay starts at move 150, in round \d+\.$/);
  });

  it('stops at a refused move, with its move number and the engine\'s error', async () => {
    const moves = [...replay.moves];
    const k = moves.findIndex((m, i) => i > 100 && m.type === 'ROLL_DICE');
    moves[k] = { type: 'ROLL_DICE', rolls: [7] };
    const tampered: ReplayFile = { ...replay, moves };
    const cursor = await verifyReplay(validateReplay(JSON.parse(JSON.stringify(tampered))), { yieldEvery: 0 });
    expect(cursor.refused).toMatchObject({ index: k + 1, seq: k + 1, action: { type: 'ROLL_DICE', rolls: [7] } });
    expect(cursor.refused!.error.code).toBeTruthy();
    expect(cursor.refused!.error.message).toMatch(/die|dice/i);
    expect(cursor.length).toBe(k);
    expect(cursor.stateAt(cursor.length)).toEqual(replayTo(finished.journal, k));

    // A move that the engine cannot even read stops the replay the same way.
    const broken: ReplayFile = { ...replay, moves: [...replay.moves.slice(0, 3), { type: 'PLACE_PIECE' } as unknown as Action] };
    const c2 = await verifyReplay(broken, { yieldEvery: 0 });
    expect(c2.refused?.index).toBe(4);
  });

  it('warns, but still plays, when it was made with different rules', async () => {
    const other = validateReplay({ ...JSON.parse(serializeReplay(replay)), rules: 'deadbeef' });
    const cursor = await verifyReplay(other, { yieldEvery: 0 });
    expect(cursor.sameRules).toBe(false);
    expect(cursor.refused).toBeNull();
    expect(rulesFingerprint()).not.toBe('deadbeef');
  });

  it('refuses the wrong kind, a newer version, damaged text and oversized input', () => {
    const text = serializeReplay(replay);
    const kind = (t: string): string => { try { openPlaytestText(t); return 'ok'; } catch (e) { return e instanceof ReplayError ? e.kind : 'other'; } };
    expect(kind('')).toBe('empty');
    expect(kind('   ')).toBe('empty');
    expect(kind('hello')).toBe('not-replay');
    expect(kind('{"kind":"something-else"}')).toBe('not-replay');
    expect(kind(text.replace('"v":1', '"v":2'))).toBe('unsupported-version');
    expect(kind(text.slice(0, text.length / 2))).toBe('damaged');
    expect(kind(`{"kind":"factory-spaghetti-replay","pad":"${'x'.repeat(MAX_REPLAY_BYTES)}"}`)).toBe('too-large');
    expect(kind(text.replace('"seed":2025', '"seed":"2025"'))).toBe('damaged');
    expect(kind(text.replace('"type":"ROLL_DICE"', '"type":"DELETE_EVERYTHING"'))).toBe('damaged');
    // Names from a file are cleaned and clipped, never trusted.
    const named = JSON.parse(text) as ReplayFile;
    named.players[0]!.name = '<img src=x onerror=alert(1)>\u0007' + 'z'.repeat(80);
    const opened = openPlaytestText(JSON.stringify(named));
    expect(opened.replay.players[0]!.name.length).toBeLessThanOrEqual(20);
    expect(opened.replay.players[0]!.name).not.toMatch(/\u0007/);
  });

  it('opens a save file: with its moves as a replay, and without them as a single position', async () => {
    const mid = replayTo(finished.journal, 120)!;
    const room = roomFor(mid, 120);
    const journal: JournalData = { ...finished.journal, moves: finished.journal.moves.slice(0, 120) };
    const withJ = openPlaytestText(serializeSaveFile(toSave(room, { savedAt: 3, app: 'test' }, { journal })));
    expect(withJ.kind).toBe('save');
    const c1 = await verifyReplay(withJ.replay, { yieldEvery: 0 });
    expect(c1.length).toBe(120);
    expect(c1.stateAt(120)).toEqual(mid);
    const without = openPlaytestText(serializeSaveFile(toSave(room, { savedAt: 3, app: 'test' })));
    const c2 = await verifyReplay(without.replay, { yieldEvery: 0 });
    expect(c2.length).toBe(0);
    expect(c2.firstSeq).toBe(120);
    expect(c2.stateAt(0)).toEqual(mid);
  });
});

describe('a rules-problem report', () => {
  // A position in the actions step, so the report has legal moves to hold (the roll step lists
  // none unless a Leverage card can be played).
  const AT = 201;
  const mid = replayTo(finished.journal, AT)!;
  const room = roomFor(mid, AT);
  const journal: JournalData = { ...finished.journal, moves: finished.journal.moves.slice(0, AT) };
  const seat = activeSeat(mid)!;
  const refusedMove = { action: { type: 'BUY_MINE', coord: { q: 9, r: 9 } } as Action, error: { code: 'CANT_AFFORD', message: 'Not enough ore.' }, seq: 199 };

  it('holds the note, versions, the room, the journal, the refused move and the legal moves', () => {
    const report = makeReport({ room, journal, seat, note: '  Expected the mine to cost 6.\nIt cost 18.\u0007 ', lastRefused: refusedMove, now: 1_700_000_000_000, app: 'v-test' });
    expect(report.kind).toBe('factory-spaghetti-report');
    expect(report.note).toBe('Expected the mine to cost 6.\nIt cost 18.');
    expect(report.app).toBe('v-test');
    expect(report.rules).toBe(rulesFingerprint());
    expect(report.reporter).toEqual({ seat, name: room.seats[seat]!.name });
    expect(report.room.room).toEqual(room);
    expect(report.replay.start).toEqual(journal.start);
    expect(report.replay.moves).toEqual(journal.moves);
    expect(report.lastRefused).toEqual(refusedMove);
    expect(report.legalActions).toEqual(legalActions(mid, seat as PlayerId));
    expect(report.legalActions.length).toBeGreaterThan(0);
  });

  it('opens in the viewer logic, at the last move, and replays to the reported position', async () => {
    const report = makeReport({ room, journal, seat, note: 'Look at move 200.', lastRefused: null, now: 5, app: 'v-test' });
    const opened = openPlaytestText(serializeReport(report));
    expect(opened.kind).toBe('report');
    expect(opened.report!.note).toBe('Look at move 200.');
    expect(opened.report!.room.room.game).toEqual(mid);
    const cursor = await verifyReplay(opened.replay, { yieldEvery: 0 });
    expect(cursor.refused).toBeNull();
    expect(cursor.seqAt(cursor.length)).toBe(AT);
    expect(cursor.stateAt(cursor.length)).toEqual(mid);
  });

  it('without a usable journal, it still carries the position as a partial replay', async () => {
    const report = makeReport({ room, journal: null, seat, note: 'x', lastRefused: null, now: 5, app: 'v-test' });
    const cursor = await verifyReplay(openPlaytestText(serializeReport(report)).replay, { yieldEvery: 0 });
    expect(cursor.partial).toBe(true);
    expect(cursor.firstSeq).toBe(AT);
    expect(cursor.stateAt(0)).toEqual(mid);
  });

  it('refuses a damaged report', () => {
    const report = JSON.parse(serializeReport(makeReport({ room, journal, seat, note: 'x', lastRefused: null, now: 5, app: 't' }))) as Record<string, unknown>;
    expect(() => openPlaytestText(JSON.stringify({ ...report, room: { nope: 1 } }))).toThrow(ReplayError);
    expect(() => openPlaytestText(JSON.stringify({ ...report, legalActions: [{ type: 'NOPE' }] }))).toThrow(ReplayError);
    expect(() => openPlaytestText(JSON.stringify({ ...report, v: 9 }))).toThrow(/newer version/);
  });
});
