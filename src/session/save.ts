// The portable save: a stripped copy of the room in a small envelope, carried as a
// link (`#save=v1.<text>`), a file, or an automatic save on each player's device.

import * as config from '../engine/config';
import type { GameState } from '../engine/state';
import type { Room, SeatColor } from './room';
import { LOG_TEXT_MAX, NAME_MAX, SEAT_COLORS, cleanName } from './room';
import { shownRound } from './rounds';
import type { JournalData } from './journal';
import { parseJournal } from './journal';

export const SAVE_FORMAT = 'factory-spaghetti-save';

export interface SaveEnvelope {
  format: 'factory-spaghetti-save';
  v: 1;
  savedAt: number;
  app: string;
  rules: string;
  room: Room;
  /**
   * The moves of this game so far (for the replay tool). Only in save files, never in save links;
   * older saves have none. A damaged journal is dropped on loading; the save itself still loads.
   */
  journal?: JournalData;
}

export type SaveErrorKind = 'truncated' | 'corrupt' | 'unsupported-version' | 'invalid';

export class SaveError extends Error {
  constructor(public readonly kind: SaveErrorKind, message: string) {
    super(message);
    this.name = 'SaveError';
  }
}

const SAVE_ERROR_TEXT: Record<SaveErrorKind, string> = {
  truncated: 'This save is incomplete. The link was probably cut off; try the save file instead.',
  corrupt: 'This is not a Factory Spaghetti save.',
  'unsupported-version': 'This save was made by a newer version of the game.',
  invalid: 'This save is damaged and cannot be resumed.',
};

function fail(kind: SaveErrorKind, detail?: string): never {
  throw new SaveError(kind, detail ? `${SAVE_ERROR_TEXT[kind]} (${detail})` : SAVE_ERROR_TEXT[kind]);
}

/** Longest save link text accepted (characters after any '#save=' part). */
export const MAX_LINK_CHARS = 64_000;
/** Largest save text accepted, from a file or after inflating a link. */
export const MAX_SAVE_BYTES = 2 * 1024 * 1024;

// --- Making a save -------------------------------------------------------------

/** Strip what must not travel (presence, timers, move ids) and wrap the room. */
export function toSave(
  room: Room, meta: { savedAt: number; app: string }, opts: { forLink?: boolean; journal?: JournalData | null } = {},
): SaveEnvelope {
  const clean: Room = {
    ...room,
    seats: room.seats.map(s => ({
      ...s, connected: false, ready: false, awaySince: null, autopilot: false,
      // The stand-in bot of an away human is presence, not a seat setting.
      botId: s.kind === 'human' ? null : s.botId,
    })),
    waiting: [],
    recent: [],
    lastEvents: [],
    opDeadline: null,
    roundEndDeadline: null,
    log: opts.forLink ? [] : room.log,
  };
  const save: SaveEnvelope = { format: SAVE_FORMAT, v: 1, savedAt: meta.savedAt, app: meta.app, rules: rulesFingerprint(), room: clean };
  // The journal grows with the game, so it never goes into a link (links must stay short).
  if (!opts.forLink && opts.journal) save.journal = opts.journal;
  return save;
}

// --- Rules fingerprint -----------------------------------------------------------

function stable(x: unknown): unknown {
  if (x instanceof Set) return [...x].map(stable).sort();
  if (Array.isArray(x)) return x.map(stable);
  if (x && typeof x === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(x).sort()) out[k] = stable((x as Record<string, unknown>)[k]);
    return out;
  }
  return x;
}

/**
 * The revision of the rules that live in code rather than in engine/config.ts. RAISE IT BY ONE
 * WHENEVER A RULE CHANGES IN CODE (a new step, a new legality check, a changed effect), so saves,
 * links and replays made before the change read as "different rules" instead of failing later.
 * Changes to config data are picked up by the fingerprint on their own.
 *   1: the rules before the revision existed (saves without it in their fingerprint).
 *   2: the draw step (DRAW_PIECE, one of several open stacks) and reserved belt points (POINT_RESERVED).
 *   3: the designer's answers to the open rules questions and paying with change (RULES_CHANGES.md
 *      #35–#43): teleporters return when the claim is lost, belt dead ends at reserved points, the
 *      Mine-belt limit counts ore exits only, a pending factory decision blocks other moves,
 *      Scouting Drone takes any piece by type, payment keeps the highest materials, and the
 *      engine refuses the moves the move list never offered (unfunded claims, re-placing the
 *      meeple, ending the turn without placing it, a Mine touching the board only by its lean hex);
 *      and, not yet released either, the designer's second set (#44–#50): the round is finished
 *      when the pieces run out, input teleporters supply only what their owner names (and Power
 *      Plants with one become a decision), Short Sale and Changing Priorities only onto unclaimed
 *      or own buildings, a Mine may touch the board with either hex, the discard pile is
 *      reshuffled, a Mine's upgrade point gives its printed number, and cards in every step.
 *   4: the designer's third set (#51–#54): a building's output touching an input moves material
 *      only between buildings of the same player, picking up this turn's Mine belt frees the
 *      one-Mine-belt limit, a teleporter cuts its buffer off from belts and direct contact, and a
 *      removed belt goes back to the bank unless it was laid this turn.
 */
export const RULES_REVISION = 4;

let fingerprint: string | null = null;

/** A short hash of every rules input: the config values that define the rules (not timers or bot weights) and RULES_REVISION. */
export function rulesFingerprint(): string {
  if (fingerprint) return fingerprint;
  const rules = {
    revision: RULES_REVISION,
    mines: config.MINE_COUNT,
    cardsPerTurn: config.MAX_CARDS_PLAYED_PER_TURN,
    claimsPerBuilding: config.MAX_CLAIMS_PER_BUILDING,
    tesseractsToWin: config.TESSERACTS_TO_WIN,
    teleporterCost: [0, 1, 2, 3].map(n => config.teleporterCost(n)),
    pieceCounts: config.PIECE_COUNTS,
    stacks: config.STACK_COMPOSITION,
    values: config.MATERIAL_VALUES,
    inventoryCap: config.INVENTORY_CAP,
    powerCap: config.POWER_TOKEN_CAP,
    startPower: config.STARTING_POWER_TOKENS,
    belts: config.BELT_COUNT,
    teleporters: config.TELEPORTER_COUNT,
    modules: config.CONTROL_MODULE_MAX,
    startPieces: config.STARTING_PIECES_PER_PLAYER,
    mineCosts: config.MINE_COSTS,
    beltCost: config.BELT_COST,
    cardCost: [1, 2, 3].map(n => config.cardCost(n)),
    piBudget: config.PRODUCTION_INCREASE_BUDGET,
    playOnDraw: config.PLAY_ON_DRAW_CARDS,
    playOnDrawCounts: config.PLAY_ON_DRAW_COUNTS_TOWARD_LIMIT,
    cards: config.CARD_COUNTS,
    ppBase: config.POWER_PLANT_BASE_YIELD,
    ppYield: config.POWER_PLANT_MATERIAL_YIELD,
    factoryPower: config.FACTORY_POWER_COST,
    recipes: config.FACTORY_RECIPES,
    ppInputs: config.POWER_PLANT_INPUTS,
    bonuses: config.bonusesEnabled,
    bonusThresholds: config.BONUS_THRESHOLDS,
    templates: config.PIECE_TEMPLATES,
    mineTemplates: config.MINE_TEMPLATES,
    mineLeanOre: config.MINE_LEAN_ORE_OUTPUTS,
  };
  const text = JSON.stringify(stable(rules));
  let h = 0x811c9dc5; // FNV-1a, 32 bit
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  fingerprint = h.toString(16).padStart(8, '0');
  return fingerprint;
}

/** True when the save was played with the same rules as this build. */
export function sameRules(save: SaveEnvelope): boolean {
  return save.rules === rulesFingerprint();
}

// --- Link form: 'v1.' + base64url(deflate-raw(JSON)) ---------------------------

const LINK_PREFIX = 'v1.';
const JSON_PREFIX = `{"format":"${SAVE_FORMAT}"`;

function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
  let b64 = text.replace(/-/g, '+').replace(/_/g, '/');
  if (b64.length % 4 === 1) b64 = b64.slice(0, -1); // a cut-off link can end mid-character
  b64 += '='.repeat((4 - (b64.length % 4)) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

interface PipeResult { bytes: Uint8Array; error: boolean; overflow: boolean }

/** Push `input` through a (de)compression stream, stopping once the output passes `limit` bytes. */
async function pipeAll(input: Uint8Array<ArrayBuffer>, stream: CompressionStream | DecompressionStream, limit = Infinity): Promise<PipeResult> {
  const writer = stream.writable.getWriter();
  const reader = stream.readable.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let overflow = false;
  const reading = (async (): Promise<boolean> => {
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return false;
        const chunk = value as Uint8Array;
        size += chunk.length;
        if (size > limit) {
          overflow = true;
          reader.cancel().catch(() => undefined);
          return false;
        }
        chunks.push(chunk);
      }
    } catch {
      return true;
    }
  })();
  writer.write(input).catch(() => undefined);
  writer.close().catch(() => undefined);
  const error = await reading;
  const bytes = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let at = 0;
  for (const c of chunks) { bytes.set(c, at); at += c.length; }
  return { bytes, error, overflow };
}

/** Pack a save into link text: 'v1.' + base64url(deflate-raw(JSON)). */
export async function packLink(save: SaveEnvelope): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify(save));
  const { bytes, error } = await pipeAll(json, new CompressionStream('deflate-raw'));
  if (error) throw new Error('Compression failed');
  return LINK_PREFIX + toBase64Url(bytes);
}

/** Text that could be the start of a save, or a save with more after it. */
function looksLikeSaveStart(text: string): boolean {
  return text.length > 0 && (JSON_PREFIX.startsWith(text) || text.startsWith(JSON_PREFIX));
}

/** Unpack link text (with or without the '#save=' part). Throws SaveError. */
export async function unpackLink(text: string): Promise<SaveEnvelope> {
  let body = text.trim();
  const fromHash = saveFromHash(body);
  if (fromHash !== null) body = fromHash;
  if (body.length > MAX_LINK_CHARS) fail('invalid', 'link too long');
  const version = /^v(\d+)\./.exec(body);
  if (!version) fail('corrupt', 'no version marker');
  if (body.slice(0, LINK_PREFIX.length) !== LINK_PREFIX) fail('unsupported-version', `link version ${version[1]}`);
  body = body.slice(LINK_PREFIX.length);
  if (!/^[A-Za-z0-9_-]*$/.test(body)) fail('corrupt', 'unexpected characters');
  if (body.length === 0) fail('truncated', 'empty link');

  let bytes: Uint8Array<ArrayBuffer>;
  try { bytes = fromBase64Url(body); } catch { fail('corrupt', 'bad encoding'); }
  const { bytes: out, error, overflow } = await pipeAll(bytes, new DecompressionStream('deflate-raw'), MAX_SAVE_BYTES);
  if (overflow) fail('invalid', 'save too large');
  const json = new TextDecoder().decode(out);
  if (error) {
    // A cut-off link still inflates to the start of a save before the stream ends early.
    // Too short to have produced anything at all also counts as cut off.
    if (looksLikeSaveStart(json) || (out.length === 0 && body.length < 200)) fail('truncated');
    fail('corrupt', 'cannot decompress');
  }
  return parseJsonSave(json);
}

function parseJsonSave(json: string): SaveEnvelope {
  if (json.length > MAX_SAVE_BYTES) fail('invalid', 'save too large');
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    if (looksLikeSaveStart(json.trimStart())) fail('truncated');
    fail('corrupt', 'not JSON');
  }
  return validateSave(parsed);
}

// --- File form -------------------------------------------------------------------

export function serializeSaveFile(save: SaveEnvelope): string {
  return JSON.stringify(save);
}

export function parseSaveFile(text: string): SaveEnvelope {
  if (typeof text !== 'string' || text.length > MAX_SAVE_BYTES) fail('invalid', 'save too large');
  return parseJsonSave(text);
}

/**
 * The save text in a location hash such as '#save=v1.abc' (also inside '#a=b&save=...'), in
 * 'save=v1.abc', or in a whole pasted address such as 'https://host/path?x=1#a=b&save=v1.abc'.
 * Surrounding whitespace (a trailing newline from a paste) is ignored. Bare 'v1.abc' text has
 * no 'save=' part, so this returns null and the caller uses the text as it is.
 */
export function saveFromHash(hash: string): string | null {
  const text = hash.trim();
  const at = text.indexOf('#');
  const h = at >= 0 ? text.slice(at + 1) : text;
  for (const part of h.split('&')) {
    if (part.startsWith('save=')) {
      const value = part.slice('save='.length);
      try { return decodeURIComponent(value).trim(); } catch { return value.trim(); }
    }
  }
  return null;
}

/**
 * What a save list shows about a save (worked out when listing, never stored). `round` is the round
 * as players see it (session/rounds.ts): during the round-end turns, the round that has just ended,
 * with `roundEnd` true.
 */
export function saveSummary(save: SaveEnvelope): { code: string; round: number; roundEnd: boolean; names: string[]; savedAt: number; phase: Room['phase'] } {
  const room = save.room;
  const shown = room.game ? shownRound(room.game) : { round: 0, roundEnd: false };
  return {
    code: room.code,
    round: shown.round,
    roundEnd: shown.roundEnd,
    names: room.seats.map(s => s.name),
    savedAt: save.savedAt,
    phase: room.phase,
  };
}

// --- Validation --------------------------------------------------------------------
// Saves arrive from links and files, so every value is checked before the room is used.
// Any malformed input ends as SaveError('invalid'), never as a TypeError.

type Obj = Record<string, unknown>;

function isObj(x: unknown): x is Obj {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}
const isInt = (x: unknown): x is number => typeof x === 'number' && Number.isInteger(x);
const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const isStr = (x: unknown, max: number): x is string => typeof x === 'string' && x.length <= max;

const PIECE_TYPES = new Set(Object.keys(config.PIECE_COUNTS));
const CARD_TYPES = new Set(Object.keys(config.CARD_COUNTS));
const MATERIALS = new Set(Object.keys(config.MATERIAL_VALUES));
const PHASES = new Set(['setupClaimPF', 'setupClaimPP', 'placePiece', 'roll', 'actions', 'placeMeeple', 'roundEnd']);

const MAX_NAME = 40;
const MAX_LOG_TEXT = LOG_TEXT_MAX;
const MAX_ID = 64;

function check(cond: boolean, what: string): asserts cond {
  if (!cond) fail('invalid', what);
}

/** An array of at most `max` elements, each passing `each`. */
function checkList(x: unknown, max: number, what: string, each: (el: unknown) => boolean): unknown[] {
  check(Array.isArray(x) && x.length <= max, what);
  for (const el of x) check(each(el), what);
  return x;
}

/** Check shape, versions, seat count against the game, and that the pieces add up. */
export function validateSave(x: unknown): SaveEnvelope {
  try {
    return validateUnsafe(x);
  } catch (e) {
    if (e instanceof SaveError) throw e;
    fail('invalid', 'unreadable');
  }
}

function validateUnsafe(x: unknown): SaveEnvelope {
  if (!isObj(x) || x.format !== SAVE_FORMAT) fail('corrupt', 'not a save');
  if (isInt(x.v) && x.v > 1) fail('unsupported-version', `save format ${x.v}`);
  check(x.v === 1, 'save format');
  check(isNum(x.savedAt) && isStr(x.app, 100) && isStr(x.rules, 100), 'envelope');
  const room = checkRoom(x.room);
  const save = { ...(x as unknown as SaveEnvelope), room }; // the checked room, cleaned where needed
  if (x.journal === undefined) return save;
  // A journal that is damaged, or does not belong to this game, is dropped: the save still loads.
  const { journal: rawJournal, ...rest } = save;
  const journal = room.game ? parseJournal(rawJournal) : null;
  return journal && room.game && journalFits(journal, room.game, room.seq) ? { ...rest, journal } : rest;
}

/** Check a room's shape, versions, seat count against the game, and that the pieces add up. */
function checkRoom(room: unknown): Room {
  check(isObj(room), 'room');
  if (isInt(room.v) && room.v > 1) fail('unsupported-version', `room format ${room.v}`);
  check(room.v === 1, 'room format');
  check(isStr(room.code, 16) && room.code.length > 0, 'room code');
  check(room.phase === 'lobby' || room.phase === 'playing' || room.phase === 'finished', 'room phase');
  check(typeof room.hold === 'boolean', 'hold flag');
  check(isInt(room.seq) && room.seq >= 0 && isNum(room.diceRng), 'move counter');
  check(room.opDeadline === null || isNum(room.opDeadline), 'deadline');
  check(room.roundEndDeadline === null || isNum(room.roundEndDeadline), 'deadline');
  checkList(room.waiting, LIST_LIMITS.waiting, 'waiting list', w => isObj(w) && isStr(w.id, MAX_ID) && isStr(w.name, MAX_NAME));
  checkList(room.recent, LIST_LIMITS.recent, 'recent moves', r => isObj(r) && isInt(r.seat) && isStr(r.id, MAX_ID));
  checkList(room.log, LIST_LIMITS.log, 'log', e => isObj(e) && isInt(e.seq) && (e.seat === null || isInt(e.seat)) && isStr(e.text, MAX_LOG_TEXT));
  checkList(room.lastEvents, LIST_LIMITS.events, 'events', e => isObj(e) && typeof e.kind === 'string');

  const settings = room.settings;
  check(isObj(settings), 'settings');
  const pc = settings.playerCount;
  check(pc === 2 || pc === 3 || pc === 4, 'player count');
  check(isNum(settings.factoryOpTimeoutMs) && isNum(settings.roundEndTimeoutMs)
    && isNum(settings.awayGraceMs) && isNum(settings.botDelayMs)
    && (settings.awayPolicy === 'bot' || settings.awayPolicy === 'wait'), 'settings values');

  const seats = checkList(room.seats, 4, 'seats', s => isObj(s));
  check(seats.length === pc, 'seat count');
  const colors = new Set<unknown>();
  seats.forEach((raw, i) => {
    const s = raw as Obj;
    check(s.index === i, `seat ${i}`);
    check(s.kind === 'human' || s.kind === 'bot' || s.kind === 'open', `seat ${i} kind`);
    check(isStr(s.name, MAX_NAME), `seat ${i} name`);
    check(SEAT_COLORS.includes(s.color as never) && !colors.has(s.color), `seat ${i} colour`);
    colors.add(s.color);
    check(s.botId === null || isStr(s.botId, MAX_ID), `seat ${i} bot`);
    check(typeof s.connected === 'boolean' && typeof s.ready === 'boolean' && typeof s.autopilot === 'boolean', `seat ${i} flags`);
    check(s.awaySince === null || isNum(s.awaySince), `seat ${i} away time`);
  });
  check(isInt(room.hostSeat) && room.hostSeat >= 0 && room.hostSeat < pc, 'host seat');

  if (room.phase === 'lobby') {
    check(room.game === null, 'lobby has no game');
  } else {
    check(isObj(room.game), 'game');
    check(!seats.some(s => (s as Obj).kind === 'open'), 'open seat in a game');
    checkGame(room.game, pc);
    const game = withUsableDraw(room.game);
    if (game !== room.game) return { ...room, game } as unknown as Room;
  }
  return room as unknown as Room;
}

/** A room from outside, checked the same way as a save's room. Throws SaveError('invalid'). */
export function validateRoom(x: unknown): Room {
  try {
    return checkRoom(x);
  } catch (e) {
    if (e instanceof SaveError) throw e;
    fail('invalid', 'unreadable');
  }
}

/**
 * A room as sent by the host, made safe to show, or null when its shape is wrong. A host is
 * another person's browser, so nothing in it is trusted: a seat colour that is not one of the
 * four printed colours (or repeats another seat's) becomes that seat's own default colour, and
 * names are cleaned and clipped to 1 to 20 characters, as `hello` names are. Then the whole
 * room gets the checks a save gets (seat count against the game, pieces adding up, ...).
 */
export function acceptHostRoom(x: unknown): Room | null {
  if (!isObj(x) || !Array.isArray(x.seats) || x.seats.length > 4) return null;
  const used = new Set<SeatColor>();
  const seats = x.seats.map((raw, i) => {
    if (!isObj(raw)) return raw;
    let color = SEAT_COLORS.includes(raw.color as SeatColor) && !used.has(raw.color as SeatColor) ? raw.color as SeatColor : null;
    if (!color) color = [SEAT_COLORS[i]!, ...SEAT_COLORS].find(c => !used.has(c))!;
    used.add(color);
    const name = clipReceivedName(raw.name);
    return { ...raw, color, name: name || (raw.kind === 'open' ? '' : `Seat ${i + 1}`) };
  });
  // Lists only shown to people are trimmed to their limits and cleaned of malformed entries, so an
  // overlong one never makes the whole room unusable; only a room that cannot be used is refused.
  const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
  const waiting = list(x.waiting)
    .filter(w => isObj(w) && isStr(w.id, MAX_ID))
    .slice(0, LIST_LIMITS.waiting)
    .map(w => ({ ...(w as Obj), name: clipReceivedName((w as Obj).name) || 'Guest' }));
  const log = list(x.log)
    .filter(e => isObj(e) && isInt(e.seq) && (e.seat === null || isInt(e.seat)) && typeof e.text === 'string')
    .map(e => ({ ...(e as Obj), text: ((e as Obj).text as string).slice(0, MAX_LOG_TEXT) }))
    .slice(-LIST_LIMITS.log);
  const pc = isObj(x.settings) ? x.settings.playerCount : 4;
  const lastEvents = list(x.lastEvents).filter(e => isTableEvent(e, typeof pc === 'number' ? pc : 4)).slice(-LIST_LIMITS.events);
  const recent = list(x.recent).filter(r => isObj(r) && isInt(r.seat) && isStr(r.id, MAX_ID)).slice(-LIST_LIMITS.recent);
  try {
    return validateRoom({ ...x, seats, waiting, log, lastEvents, recent });
  } catch {
    return null;
  }
}

/** The most entries a room's lists may hold (as checked in checkRoom). */
export const LIST_LIMITS = { waiting: 50, recent: 64, log: 500, events: 500 } as const;

const OUTCOMES = new Set(['awaiting-choice', 'power', 'power-capped', 'output-full', 'input-missing', 'no-power']);

/**
 * A table event with the fields the interface reads, each of the right type and range. Events
 * drive animations and notices, so a malformed one from a modified host is dropped, not shown.
 */
export function isTableEvent(e: unknown, playerCount: number): boolean {
  if (!isObj(e)) return false;
  const seat = (v: unknown): boolean => isInt(v) && v >= 0 && v < playerCount;
  const id = (v: unknown): boolean => isStr(v, MAX_ID) && v.length > 0;
  const building = (v: unknown): boolean => PIECE_TYPES.has(v as string);
  const smallInt = (v: unknown): boolean => isInt(v) && Math.abs(v) <= 1000;
  switch (e.kind) {
    case 'roll':
      return seat(e.seat) && Array.isArray(e.dice) && e.dice.length <= 3 && e.dice.every(d => isInt(d) && d >= 1 && d <= 6) && smallInt(e.total);
    case 'activated':
      return seat(e.seat) && id(e.pieceId) && building(e.building) && OUTCOMES.has(e.outcome as string) && smallInt(e.amount);
    case 'piecePlaced': case 'skipped':
      return seat(e.seat) && id(e.pieceId) && building(e.building);
    case 'pieceDrawn':
      return seat(e.seat) && (e.stack === 0 || e.stack === 1 || e.stack === 2) && id(e.pieceId) && building(e.building);
    case 'operated':
      return seat(e.seat) && id(e.pieceId) && building(e.building) && (e.product === null || MATERIALS.has(e.product as string))
        && smallInt(e.powerChange) && typeof e.teleported === 'boolean';
    case 'collected':
      return seat(e.seat) && id(e.pieceId) && Array.isArray(e.materials) && e.materials.length <= 12 && e.materials.every(m => MATERIALS.has(m as string));
    case 'cardBought':
      return seat(e.seat) && (e.card === null || CARD_TYPES.has(e.card as string)) && typeof e.playedOnDraw === 'boolean';
    case 'cardPlayed':
      return seat(e.seat) && CARD_TYPES.has(e.card as string);
    case 'timeout':
      return seat(e.seat) && (e.what === 'factory-op' || e.what === 'round-end');
    case 'gameOver':
      return (e.winner === null || seat(e.winner)) && Array.isArray(e.tied) && e.tied.length <= 4 && e.tied.every(seat)
        && (e.reason === null || e.reason === 'tesseracts' || e.reason === 'boardExhausted');
    default:
      return false;
  }
}

function clipReceivedName(raw: unknown): string {
  return cleanName(raw).slice(0, NAME_MAX).trim();
}

/** The journal is of this game and reaches exactly this move (a cheap check; see journalMatches for the full one). */
function journalFits(j: JournalData, game: GameState, seq: number): boolean {
  const from = 'seed' in j.start ? 0 : j.start.seq;
  const seed = 'seed' in j.start ? j.start.seed : j.start.state.seed;
  return seed === game.seed && from + j.moves.length === seq;
}

/** True when `x` has the shape of an engine state (as checked for saves). */
export function isGameState(x: unknown): x is GameState {
  try {
    if (!isObj(x)) return false;
    const pc = x.playerCount;
    if (pc !== 2 && pc !== 3 && pc !== 4) return false;
    checkGame(x, pc);
    return true;
  } catch {
    return false;
  }
}

const isPiece = (p: unknown): boolean => isObj(p) && isStr(p.id, MAX_ID) && PIECE_TYPES.has(p.type as string);
const isPlayerId = (pc: number) => (p: unknown): boolean => isInt(p) && p >= 0 && p < pc;

function isBuffer(b: unknown): boolean {
  return b === null || (isObj(b)
    && Array.isArray(b.slots) && b.slots.length <= 4
    && b.slots.every(s => s === null || MATERIALS.has(s as string))
    && (b.teleporterOwner === null || isInt(b.teleporterOwner)));
}

/**
 * The game with its drawn stack (DRAW_PIECE, `drawnStackIndex`) usable, or reset to null so the
 * player simply draws again. A drawn stack is usable only in the placePiece phase with no Mine
 * waiting to be placed, and only when it is a stack (0, 1 or 2) that is open and not empty;
 * anything else would leave the game with no legal move. Saves from before the draw step have
 * no field, which is kept as it is. Returns `g` itself when nothing changes.
 */
function withUsableDraw(g: Obj): Obj {
  const d = g.drawnStackIndex;
  if (d === undefined || d === null) return g;
  const stack = d === 0 || d === 1 || d === 2 ? (g.stacks as Obj[])[d] : undefined;
  const usable = !!stack && g.phase === 'placePiece' && (g.pendingMineIds as unknown[]).length === 0
    && stack.available === true && (stack.pieces as unknown[]).length > 0;
  return usable ? g : { ...g, drawnStackIndex: null };
}

function checkGame(g: Obj, pc: 2 | 3 | 4): void {
  const pid = isPlayerId(pc);
  check(g.playerCount === pc, 'game player count does not match the seats');
  check(PHASES.has(g.phase as string) && isInt(g.round) && g.round >= 1 && isNum(g.rng) && isNum(g.seed), 'game phase');
  check(isInt(g.activePlayerIndex) && g.activePlayerIndex >= 0 && g.activePlayerIndex < pc, 'active player');
  check(isInt(g.mineCount) && isInt(g.globalTeleporterCount) && isInt(g.cardsPlayedThisTurn), 'counters');
  check(typeof g.gameOver === 'boolean' && (g.winner === null || pid(g.winner)), 'game over');
  checkList(g.tiedWinners, pc, 'tied winners', pid);
  checkList(g.turnOrder, pc, 'turn order', pid);
  check((g.turnOrder as unknown[]).length === pc && new Set(g.turnOrder as unknown[]).size === pc, 'turn order');
  check(g.lastRoll === null || (Array.isArray(g.lastRoll) && g.lastRoll.length <= 3 && g.lastRoll.every(isInt)), 'last roll');

  checkList(g.players, pc, 'players', p => isObj(p)
    && isObj(p.inventory) && [...MATERIALS].every(m => isInt((p.inventory as Obj)[m]))
    && Array.isArray(p.controlModules) && p.controlModules.length <= 18 && p.controlModules.every(isInt)
    && Array.isArray(p.hand) && p.hand.length <= 100 && p.hand.every(c => CARD_TYPES.has(c as string))
    && isInt(p.powerTokens) && isInt(p.beltsRemaining) && isInt(p.teleportersRemaining)
    && isObj(p.bonusTesseracts) && isObj(p.stats));
  check((g.players as unknown[]).length === pc, 'players');

  const board = checkList(g.board, 200, 'board', p => isPiece(p)
    && isObj((p as Obj).coord) && isInt(((p as Obj).coord as Obj).q) && isInt(((p as Obj).coord as Obj).r)
    && Array.isArray((p as Obj).claims) && ((p as Obj).claims as unknown[]).length <= 12
    && ((p as Obj).claims as unknown[]).every(c => isObj(c) && pid(c.ownerId) && isInt(c.controlModule))
    && isBuffer((p as Obj).input) && isBuffer((p as Obj).output)) as Obj[];
  const stacks = checkList(g.stacks, 3, 'stacks', s => isObj(s) && isInt(s.index) && typeof s.available === 'boolean') as Obj[];
  check(stacks.length === 3, 'stacks');
  for (const s of stacks) checkList(s.pieces, 200, 'stack pieces', isPiece);
  checkList(g.unplacedMines, 3, 'unplaced mines', isPiece);
  checkList(g.pendingMineIds, 3, 'dropped mines', id => isStr(id, MAX_ID));
  checkList(g.overstockPieces, 10, 'overstock pieces', isPiece);
  checkList(g.cardDeck, 200, 'card deck', c => CARD_TYPES.has(c as string));
  checkList(g.cardDiscard, 200, 'discard pile', c => CARD_TYPES.has(c as string));
  checkList(g.belts, 500, 'belts', b => isObj(b) && isStr(b.id, MAX_ID) && pid(b.ownerId) && isStr(b.pieceId, MAX_ID)
    && isInt(b.fromPoint) && isInt(b.toPoint));
  checkList(g.beltsPlacedThisTurn, 500, 'belts this turn', id => isStr(id, MAX_ID));
  checkList(g.pendingFactoryOps, 200, 'pending operations', e => isObj(e) && isStr(e.pieceId, MAX_ID) && pid(e.ownerId));

  // The pieces add up: ids are unique, three mines exist, no more pieces than the game has.
  const ids = new Set<string>();
  const seen = (id: unknown): void => {
    check(typeof id === 'string' && !ids.has(id), 'piece ids repeat');
    ids.add(id);
  };
  let minesOnBoard = 0;
  let otherPieces = 0;
  for (const p of board) {
    seen(p.id);
    if (p.type === 'mine') minesOnBoard++; else otherPieces++;
  }
  for (const s of stacks) for (const p of s.pieces as Obj[]) { seen(p.id); otherPieces++; }
  for (const p of g.overstockPieces as Obj[]) { seen(p.id); otherPieces++; }
  for (const p of g.unplacedMines as Obj[]) seen(p.id);
  for (const id of g.pendingMineIds as unknown[]) seen(id);
  check(minesOnBoard + (g.unplacedMines as unknown[]).length + (g.pendingMineIds as unknown[]).length === config.MINE_COUNT, 'mine count');
  check(g.mineCount === minesOnBoard, 'mines in play');
  const pool = config.STACK_COMPOSITION[pc].reduce(
    (n, c) => n + c.plateFact + c.sphereFact + c.tesseractFact + c.powerPlant + c.blank, 0);
  check(otherPieces <= pool, 'more pieces than the game has');
}
