// The portable save: a stripped copy of the room in a small envelope, carried as a
// link (`#save=v1.<text>`), a file, or an automatic save on each player's device.

import * as config from '../engine/config';
import type { GameState } from '../engine/state';
import type { Room } from './room';
import { SEAT_COLORS } from './room';

export const SAVE_FORMAT = 'factory-spaghetti-save';

export interface SaveEnvelope {
  format: 'factory-spaghetti-save';
  v: 1;
  savedAt: number;
  app: string;
  rules: string;
  room: Room;
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

// â”€â”€ Making a save â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/** Strip what must not travel (presence, timers, move ids) and wrap the room. */
export function toSave(room: Room, meta: { savedAt: number; app: string }, opts: { forLink?: boolean } = {}): SaveEnvelope {
  const clean: Room = {
    ...room,
    seats: room.seats.map(s => ({ ...s, connected: false, ready: false, awaySince: null, autopilot: false })),
    waiting: [],
    recent: [],
    lastEvents: [],
    opDeadline: null,
    roundEndDeadline: null,
    log: opts.forLink ? [] : room.log,
  };
  // The stand-in bot of an away human is presence, not a seat setting.
  clean.seats = clean.seats.map(s => (s.kind === 'human' ? { ...s, botId: null } : s));
  return { format: SAVE_FORMAT, v: 1, savedAt: meta.savedAt, app: meta.app, rules: rulesFingerprint(), room: clean };
}

// â”€â”€ Rules fingerprint â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

let fingerprint: string | null = null;

/** A short hash of the engine config values that define the rules (not timers or bot weights). */
export function rulesFingerprint(): string {
  if (fingerprint) return fingerprint;
  const rules = {
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
    cards: config.CARD_COUNTS,
    ppBase: config.POWER_PLANT_BASE_YIELD,
    ppYield: config.POWER_PLANT_MATERIAL_YIELD,
    factoryPower: config.FACTORY_POWER_COST,
    recipes: config.FACTORY_RECIPES,
    ppInputs: config.POWER_PLANT_INPUTS,
    bonuses: config.bonusesEnabled,
    bonusThresholds: config.BONUS_THRESHOLDS,
    templates: config.PIECE_TEMPLATES,
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

// â”€â”€ Link form: 'v1.' + base64url(deflate-raw(JSON)) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

async function pipeAll(input: Uint8Array<ArrayBuffer>, stream: CompressionStream | DecompressionStream): Promise<{ bytes: Uint8Array; error: boolean }> {
  const writer = stream.writable.getWriter();
  const reader = stream.readable.getReader();
  const chunks: Uint8Array[] = [];
  const reading = (async (): Promise<boolean> => {
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return false;
        chunks.push(value as Uint8Array);
      }
    } catch {
      return true;
    }
  })();
  writer.write(input).catch(() => undefined);
  writer.close().catch(() => undefined);
  const error = await reading;
  let size = 0;
  for (const c of chunks) size += c.length;
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) { bytes.set(c, at); at += c.length; }
  return { bytes, error };
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
  const version = /^v(\d+)\./.exec(body);
  if (!version) fail('corrupt', 'no version marker');
  if (body.slice(0, LINK_PREFIX.length) !== LINK_PREFIX) fail('unsupported-version', `link version ${version[1]}`);
  body = body.slice(LINK_PREFIX.length);
  if (!/^[A-Za-z0-9_-]*$/.test(body)) fail('corrupt', 'unexpected characters');
  if (body.length === 0) fail('truncated', 'empty link');

  let bytes: Uint8Array<ArrayBuffer>;
  try { bytes = fromBase64Url(body); } catch { fail('corrupt', 'bad encoding'); }
  const { bytes: out, error } = await pipeAll(bytes, new DecompressionStream('deflate-raw'));
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
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    if (looksLikeSaveStart(json.trimStart())) fail('truncated');
    fail('corrupt', 'not JSON');
  }
  return validateSave(parsed);
}

// â”€â”€ File form â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export function serializeSaveFile(save: SaveEnvelope): string {
  return JSON.stringify(save);
}

export function parseSaveFile(text: string): SaveEnvelope {
  return parseJsonSave(text);
}

/** The save text in a location hash such as '#save=v1.abc' (also inside '#a=b&save=...'). */
export function saveFromHash(hash: string): string | null {
  const h = hash.startsWith('#') ? hash.slice(1) : hash;
  for (const part of h.split('&')) {
    if (part.startsWith('save=')) {
      const value = part.slice('save='.length);
      try { return decodeURIComponent(value); } catch { return value; }
    }
  }
  return null;
}

export function saveSummary(save: SaveEnvelope): { code: string; round: number; names: string[]; savedAt: number; phase: Room['phase'] } {
  const room = save.room;
  return {
    code: room.code,
    round: room.game?.round ?? 0,
    names: room.seats.map(s => s.name),
    savedAt: save.savedAt,
    phase: room.phase,
  };
}

// â”€â”€ Validation â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function isObj(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}
const isInt = (x: unknown): x is number => typeof x === 'number' && Number.isInteger(x);
const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

const PIECE_TYPES = new Set(Object.keys(config.PIECE_COUNTS));
const PHASES = new Set(['setupClaimPF', 'setupClaimPP', 'placePiece', 'roll', 'actions', 'placeMeeple', 'roundEnd']);

function check(cond: boolean, what: string): asserts cond {
  if (!cond) fail('invalid', what);
}

/** Check shape, versions, seat count against the game, and that the pieces add up. */
export function validateSave(x: unknown): SaveEnvelope {
  if (!isObj(x) || x.format !== SAVE_FORMAT) fail('corrupt', 'not a save');
  if (isInt(x.v) && x.v > 1) fail('unsupported-version', `save format ${x.v}`);
  check(x.v === 1, 'save format');
  check(isNum(x.savedAt) && typeof x.app === 'string' && typeof x.rules === 'string', 'envelope');
  const room = x.room;
  check(isObj(room), 'room');
  if (isInt(room.v) && room.v > 1) fail('unsupported-version', `room format ${room.v}`);
  check(room.v === 1, 'room format');
  check(typeof room.code === 'string' && room.code.length > 0, 'room code');
  check(room.phase === 'lobby' || room.phase === 'playing' || room.phase === 'finished', 'room phase');
  check(typeof room.hold === 'boolean', 'hold flag');
  check(isInt(room.seq) && room.seq >= 0 && isNum(room.diceRng), 'move counter');
  check(Array.isArray(room.waiting) && Array.isArray(room.recent) && Array.isArray(room.log) && Array.isArray(room.lastEvents), 'lists');

  const settings = room.settings;
  check(isObj(settings), 'settings');
  const pc = settings.playerCount;
  check(pc === 2 || pc === 3 || pc === 4, 'player count');
  check(isNum(settings.factoryOpTimeoutMs) && isNum(settings.roundEndTimeoutMs)
    && isNum(settings.awayGraceMs) && isNum(settings.botDelayMs)
    && (settings.awayPolicy === 'bot' || settings.awayPolicy === 'wait'), 'settings values');

  const seats = room.seats;
  check(Array.isArray(seats) && seats.length === pc, 'seat count');
  const colors = new Set<string>();
  seats.forEach((s: unknown, i: number) => {
    check(isObj(s) && s.index === i, `seat ${i}`);
    check(s.kind === 'human' || s.kind === 'bot' || s.kind === 'open', `seat ${i} kind`);
    check(typeof s.name === 'string' && SEAT_COLORS.includes(s.color as never), `seat ${i} name or colour`);
    check(!colors.has(s.color as string), 'seat colours repeat');
    colors.add(s.color as string);
    check(s.botId === null || typeof s.botId === 'string', `seat ${i} bot`);
  });
  check(isInt(room.hostSeat) && room.hostSeat >= 0 && room.hostSeat < pc, 'host seat');

  if (room.phase === 'lobby') {
    check(room.game === null, 'lobby has no game');
  } else {
    check(isObj(room.game), 'game');
    check(!seats.some((s: { kind: string }) => s.kind === 'open'), 'open seat in a game');
    checkGame(room.game as unknown as GameState, pc);
  }
  return x as unknown as SaveEnvelope;
}

function checkGame(g: GameState, pc: 2 | 3 | 4): void {
  check(g.playerCount === pc, 'game player count does not match the seats');
  check(Array.isArray(g.players) && g.players.length === pc, 'players');
  check(Array.isArray(g.turnOrder) && g.turnOrder.length === pc, 'turn order');
  check(isInt(g.activePlayerIndex) && g.activePlayerIndex >= 0 && g.activePlayerIndex < pc, 'active player');
  check(PHASES.has(g.phase) && isInt(g.round) && isNum(g.rng) && isNum(g.seed), 'game phase');
  check(Array.isArray(g.board) && Array.isArray(g.stacks) && g.stacks.length === 3, 'board and stacks');
  check(Array.isArray(g.unplacedMines) && Array.isArray(g.pendingMineIds) && Array.isArray(g.overstockPieces), 'piece lists');
  check(Array.isArray(g.cardDeck) && Array.isArray(g.cardDiscard) && Array.isArray(g.belts), 'cards and belts');
  check(Array.isArray(g.pendingFactoryOps), 'pending operations');

  const ids = new Set<string>();
  const seen = (id: unknown): void => {
    check(typeof id === 'string' && !ids.has(id), 'piece ids repeat');
    ids.add(id);
  };
  let minesOnBoard = 0;
  let otherPieces = 0;
  for (const p of g.board) {
    check(isObj(p) && PIECE_TYPES.has(p.type as string) && isObj(p.coord) && isInt(p.coord.q) && isInt(p.coord.r), 'board piece');
    check(Array.isArray(p.claims), 'board piece claims');
    seen(p.id);
    if (p.type === 'mine') minesOnBoard++; else otherPieces++;
  }
  for (const stack of g.stacks) {
    check(isObj(stack) && Array.isArray(stack.pieces), 'stack');
    for (const p of stack.pieces) { check(PIECE_TYPES.has(p.type), 'stack piece'); seen(p.id); otherPieces++; }
  }
  for (const p of g.overstockPieces) { check(PIECE_TYPES.has(p.type), 'overstock piece'); seen(p.id); otherPieces++; }
  for (const p of g.unplacedMines) seen(p.id);
  for (const id of g.pendingMineIds) seen(id);
  check(minesOnBoard + g.unplacedMines.length + g.pendingMineIds.length === config.MINE_COUNT, 'mine count');
  check(g.mineCount === minesOnBoard, 'mines in play');
  const pool = config.STACK_COMPOSITION[pc].reduce(
    (n, c) => n + c.plateFact + c.sphereFact + c.tesseractFact + c.powerPlant + c.blank, 0);
  check(otherPieces <= pool, 'more pieces than the game has');
  for (const pl of g.players) {
    check(isObj(pl) && isObj(pl.inventory) && Array.isArray(pl.controlModules) && Array.isArray(pl.hand), 'player');
  }
}
