// "Report a rules problem": one file (`.fsreport`, JSON) holding everything the designer needs
// to see exactly what happened: the player's note, the app version and rules fingerprint, the
// whole room as it is now, the moves of the game (the journal), the last move of this player
// the host refused (with the engine's error), and the moves the engine lists for the reporter.
// Nothing is sent anywhere: the player sends the file to the designer themselves.
//
// This module also opens any playtest file for the replay viewer: a replay, a report, or a
// save file that carries a journal.

import type { Action } from '../engine/actions';
import type { PlayerId } from '../engine/state';
import { legalActions } from '../engine';
import type { Room } from './room';
import type { JournalData } from './journal';
import { MAX_JOURNAL_MOVES, isActionLike, journalEnd, partialJournal } from './journal';
import type { SaveEnvelope } from './save';
import { SAVE_FORMAT, SaveError, rulesFingerprint, toSave, validateSave } from './save';
import type { ReplayFile } from './replay';
import { REPLAY_KIND, makeReplay, parseJsonText, parsePlayers, replayFail, replayPlayers, validateReplay } from './replay';
import type { RefusedMove } from './clientSession';

export const REPORT_KIND = 'factory-spaghetti-report';
export const REPORT_EXT = '.fsreport';
/** Longest note kept. */
export const NOTE_MAX = 2000;

export interface ReportFile {
  kind: typeof REPORT_KIND;
  v: 1;
  app: string;
  rules: string;
  createdAt: number;
  /** What the player expected and what happened, in their words. */
  note: string;
  reporter: { seat: number | null; name: string };
  /** The whole room as this device holds it now (with presence), in the save format. */
  room: SaveEnvelope;
  /** The game's moves: from the start when this device has them all, otherwise partial. */
  replay: ReplayFile;
  /** The last move of the reporter that was refused in this session, with the error. */
  lastRefused: RefusedMove | null;
  /** The moves the engine lists for the reporter now. */
  legalActions: Action[];
}

/** Keep line breaks, drop other control characters, clip. */
export function cleanNote(raw: unknown): string {
  return typeof raw === 'string' ? raw.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').slice(0, NOTE_MAX).trim() : '';
}

export function makeReport(opts: {
  room: Room; journal: JournalData | null; seat: number | null; note: string; lastRefused: RefusedMove | null;
  now: number; app: string;
}): ReportFile {
  const { room } = opts;
  const game = room.game;
  if (!game) throw new Error('makeReport: no game');
  // A journal that does not reach the room's move would not replay to it: use the position itself.
  const journal = opts.journal && journalEnd(opts.journal) === room.seq ? opts.journal : partialJournal(game, room.seq);
  const save = toSave(room, { savedAt: opts.now, app: opts.app });
  const seat = opts.seat;
  return {
    kind: REPORT_KIND, v: 1, app: opts.app, rules: rulesFingerprint(), createdAt: opts.now,
    note: cleanNote(opts.note),
    reporter: { seat, name: seat === null ? '' : room.seats[seat]?.name ?? '' },
    // The snapshot keeps who was connected, away or played by a bot: often part of the story.
    room: { ...save, room },
    replay: makeReplay(room, journal, { savedAt: opts.now, app: opts.app }),
    lastRefused: opts.lastRefused,
    legalActions: seat === null || game.gameOver ? [] : legalActions(game, seat as PlayerId),
  };
}

export function serializeReport(r: ReportFile): string {
  return JSON.stringify(r);
}

export function reportFileName(r: ReportFile): string {
  const d = new Date(r.createdAt);
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
    + `-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
  return `factory-spaghetti-${r.replay.code}-report-${stamp}${REPORT_EXT}`;
}

// ── Opening a playtest file ───────────────────────────────────────────────────────

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => typeof x === 'object' && x !== null && !Array.isArray(x);

function check(cond: boolean, what: string): asserts cond {
  if (!cond) replayFail('damaged', what);
}

function validateReport(x: Obj): ReportFile {
  if (typeof x.v === 'number' && Number.isInteger(x.v) && x.v > 1) replayFail('unsupported-version', `report format ${x.v}`);
  check(x.v === 1, 'report format');
  check(typeof x.app === 'string' && x.app.length <= 100 && typeof x.rules === 'string' && x.rules.length <= 100, 'version');
  check(typeof x.createdAt === 'number' && Number.isFinite(x.createdAt), 'date');
  check(typeof x.note === 'string' && x.note.length <= NOTE_MAX * 2, 'note');
  const rep = x.reporter;
  check(isObj(rep) && (rep.seat === null || (typeof rep.seat === 'number' && Number.isInteger(rep.seat))), 'reporter');
  let room: SaveEnvelope;
  try {
    room = validateSave(x.room);
  } catch (e) {
    if (e instanceof SaveError && e.kind === 'shared-building') replayFail('shared-building');
    replayFail('damaged', 'room');
  }
  const replay = validateReplay(x.replay);
  const lr = x.lastRefused;
  check(lr === null || (isObj(lr) && isActionLike(lr.action) && isObj(lr.error)
    && typeof lr.error.code === 'string' && lr.error.code.length <= 64
    && typeof lr.error.message === 'string' && lr.error.message.length <= 500
    && typeof lr.seq === 'number' && Number.isInteger(lr.seq)), 'refused move');
  check(Array.isArray(x.legalActions) && x.legalActions.length <= 20_000 && x.legalActions.every(isActionLike), 'legal moves');
  const seat = rep.seat as number | null;
  return {
    kind: REPORT_KIND, v: 1, app: x.app, rules: x.rules, createdAt: x.createdAt,
    note: cleanNote(x.note),
    reporter: { seat: seat !== null && replay.players[seat] ? seat : null, name: seat !== null ? replay.players[seat]?.name ?? '' : '' },
    room, replay,
    lastRefused: lr === null ? null : (lr as unknown as RefusedMove),
    legalActions: x.legalActions as Action[],
  };
}

export interface OpenedFile {
  kind: 'replay' | 'report' | 'save';
  replay: ReplayFile;
  report: ReportFile | null;
}

/**
 * Open the text of a replay (`.fsreplay`), a report (`.fsreport`), or a save file (`.fsgame`)
 * that carries the moves. Throws ReplayError with words for the player.
 */
export function openPlaytestText(text: string): OpenedFile {
  const x = parseJsonText(text);
  if (!isObj(x)) replayFail('not-replay');
  if (x.kind === REPLAY_KIND) return { kind: 'replay', replay: validateReplay(x), report: null };
  if (x.kind === REPORT_KIND) {
    const report = validateReport(x);
    return { kind: 'report', replay: report.replay, report };
  }
  if (x.format === SAVE_FORMAT) {
    let save: SaveEnvelope;
    try {
      save = validateSave(x);
    } catch (e) {
      if (e instanceof SaveError && e.kind === 'shared-building') replayFail('shared-building'); // #57
      replayFail(e instanceof SaveError && e.kind === 'unsupported-version' ? 'unsupported-version' : 'damaged', 'save file');
    }
    const room = save.room;
    if (!room.game) replayFail('damaged', 'this save has no game yet');
    // A save without a journal (an older file) still opens, as a one-position replay.
    const journal = save.journal ?? partialJournal(room.game, room.seq);
    if (journal.moves.length > MAX_JOURNAL_MOVES) replayFail('too-large');
    const replay: ReplayFile = {
      kind: REPLAY_KIND, v: 1, rules: save.rules, app: save.app, savedAt: save.savedAt, code: room.code,
      start: journal.start, players: parsePlayers(replayPlayers(room), room.seats.length), moves: journal.moves,
    };
    return { kind: 'save', replay, report: null };
  }
  replayFail('not-replay');
}
