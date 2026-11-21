import { describe, it, expect, afterEach } from 'vitest';
import type { GameState } from '../../engine/state';
import {
  SaveError, packLink, parseSaveFile, rulesFingerprint, sameRules, saveFromHash, saveSummary,
  serializeSaveFile, toSave, unpackLink, validateSave,
} from '../save';
import type { SaveEnvelope } from '../save';
import { listSaves, localStorageStore, memoryStore, saveKey, writeSave } from '../store';
import type { Room } from '../room';
import { findState, join, newLobby, playingRoom, settle } from './helpers';
import { activeSeat } from '../room';

function midGameRoom(code = 'ROOMA'): Room {
  const game: GameState = findState(3, s => s.round >= 4 && s.phase === 'actions');
  const room = playingRoom(game, [
    { kind: 'human', name: 'Ann' }, { kind: 'human', name: 'Bea' }, { kind: 'bot', name: 'Smart Bot' },
  ], 0);
  return {
    ...room,
    code,
    seq: 120,
    seats: room.seats.map(s => (s.kind === 'human' ? { ...s, connected: true, ready: true, awaySince: 5, autopilot: s.index === 1, botId: s.index === 1 ? 'greedy' : null } : s)),
    waiting: [{ id: 'w1', name: 'Sam' }],
    recent: [{ seat: 0, id: 'abc' }],
    log: [{ seq: 120, seat: 0, text: 'Ann ended their turn' }],
    lastEvents: [{ kind: 'roll', seat: 0, dice: [3, 4], total: 7 }],
    opDeadline: 123,
    roundEndDeadline: 456,
  };
}

async function expectSaveError(p: Promise<unknown> | (() => unknown), kind: SaveError['kind']): Promise<void> {
  try {
    await (typeof p === 'function' ? p() : p);
  } catch (e) {
    expect(e).toBeInstanceOf(SaveError);
    expect((e as SaveError).kind).toBe(kind);
    return;
  }
  throw new Error(`expected a SaveError (${kind})`);
}

describe('save envelope', () => {
  it('strips presence, timers and move ids; a link save also drops the log', () => {
    const save = toSave(midGameRoom(), { savedAt: 1000, app: 'v-test' });
    expect(save).toMatchObject({ format: 'factory-spaghetti-save', v: 1, savedAt: 1000, app: 'v-test', rules: rulesFingerprint() });
    for (const s of save.room.seats) {
      expect(s).toMatchObject({ connected: false, ready: false, awaySince: null, autopilot: false });
    }
    expect(save.room.seats[1]!.botId).toBeNull(); // the stand-in bot is not part of the seat
    expect(save.room.seats[2]!.botId).toBe('greedy');
    expect(save.room).toMatchObject({ waiting: [], recent: [], lastEvents: [], opDeadline: null, roundEndDeadline: null });
    expect(save.room.log).toHaveLength(1);
    expect(toSave(midGameRoom(), { savedAt: 1, app: 'x' }, { forLink: true }).room.log).toEqual([]);
    expect(sameRules(save)).toBe(true);
    expect(rulesFingerprint()).toMatch(/^[0-9a-f]{8}$/);
  });

  it('round-trips exactly through a link and through a file', async () => {
    const save = toSave(midGameRoom(), { savedAt: 1000, app: 'v-test' }, { forLink: true });
    const link = await packLink(save);
    expect(link).toMatch(/^v1\.[A-Za-z0-9_-]+$/);
    expect(await unpackLink(link)).toEqual(save);
    expect(await unpackLink(`#save=${link}`)).toEqual(save);
    expect(parseSaveFile(serializeSaveFile(save))).toEqual(save);
  });

  it('says a cut-off link is incomplete, and garbage is not a save', async () => {
    const save = toSave(midGameRoom(), { savedAt: 1000, app: 'v-test' }, { forLink: true });
    const link = await packLink(save);
    for (const keep of [0.3, 0.5, 0.9, 0.99]) {
      await expectSaveError(unpackLink(link.slice(0, Math.floor(link.length * keep))), 'truncated');
    }
    await expectSaveError(unpackLink('v1.'), 'truncated');
    await expectSaveError(unpackLink('hello there'), 'corrupt');
    await expectSaveError(unpackLink('v1.this is not base64!'), 'corrupt');
    // Valid characters, but not a compressed save.
    let x = 12345;
    const junk = Array.from({ length: 600 }, () => {
      x = (x * 1103515245 + 12345) >>> 0;
      return 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'[x % 64];
    }).join('');
    await expectSaveError(unpackLink(`v1.${junk}`), 'corrupt');
    await expectSaveError(unpackLink(`v2.${junk}`), 'unsupported-version');

    const file = serializeSaveFile(save);
    await expectSaveError(() => parseSaveFile(file.slice(0, file.length - 40)), 'truncated');
    await expectSaveError(() => parseSaveFile('{"hello": 1}'), 'corrupt');
    await expectSaveError(() => parseSaveFile('not json'), 'corrupt');
  });

  it('validates versions, seat counts and pieces', async () => {
    const save = toSave(midGameRoom(), { savedAt: 1000, app: 'v-test' });
    const clone = (): SaveEnvelope => JSON.parse(JSON.stringify(save)) as SaveEnvelope;
    expect(validateSave(clone())).toEqual(save);

    const newer = clone() as unknown as { v: number };
    newer.v = 2;
    await expectSaveError(() => validateSave(newer), 'unsupported-version');

    const extraSeat = clone();
    extraSeat.room.seats.push({ ...extraSeat.room.seats[0]!, index: 3, color: 'green' });
    await expectSaveError(() => validateSave(extraSeat), 'invalid');

    const wrongCount = clone();
    wrongCount.room.settings.playerCount = 4;
    await expectSaveError(() => validateSave(wrongCount), 'invalid');

    const dupPiece = clone();
    const g = dupPiece.room.game as unknown as { board: { id: string }[] };
    g.board[1]!.id = g.board[2]!.id;
    await expectSaveError(() => validateSave(dupPiece), 'invalid');

    const lostMine = clone();
    (lostMine.room.game as unknown as { unplacedMines: unknown[] }).unplacedMines = [];
    await expectSaveError(() => validateSave(lostMine), 'invalid');

    await expectSaveError(() => validateSave(null), 'corrupt');
  });

  it('turns every malformed save into a SaveError, never a TypeError', async () => {
    const save = toSave(midGameRoom(), { savedAt: 1000, app: 'v-test' });
    const mutations: Array<(s: Record<string, any>) => void> = [ // eslint-disable-line @typescript-eslint/no-explicit-any
      (s): void => { s.room.game.stacks[0].pieces.push(null); },
      (s): void => { s.room.game.unplacedMines = [null, null]; },
      (s): void => { s.room.game.board.push(null); },
      (s): void => { s.room.game.board[0].coord = null; },
      (s): void => { s.room.game.players[0] = null; },
      (s): void => { s.room.game.players[0].inventory = 'lots'; },
      (s): void => { s.room.game.round = 'four'; },
      (s): void => { s.room.game.turnOrder = [0, 0, 0]; },
      (s): void => { s.room.game.pendingFactoryOps = [null]; },
      (s): void => { s.room.game.belts = [{ id: 1 }]; },
      (s): void => { s.room.seats[0] = null; },
      (s): void => { s.room.seats[0].name = 42; },
      (s): void => { s.room.seats[0].name = 'x'.repeat(41); },
      (s): void => { s.room.log = [{ seq: 1, seat: null, text: 'y'.repeat(201) }]; },
      (s): void => { s.room.log = Array.from({ length: 501 }, () => ({ seq: 1, seat: null, text: 'hi' })); },
      (s): void => { s.room.waiting = [null]; },
      (s): void => { s.room.settings = null; },
      (s): void => { s.room.code = 7; },
      (s): void => { s.room.game.stacks = null; },
      (s): void => { s.room = []; },
    ];
    for (const mutate of mutations) {
      const bad = JSON.parse(JSON.stringify(save)) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
      mutate(bad);
      await expectSaveError(() => validateSave(bad), 'invalid');
    }
  });

  it('refuses oversized links and files, and stops inflating a link that expands too far', async () => {
    await expectSaveError(unpackLink(`v1.${'A'.repeat(64_001)}`), 'invalid');
    await expectSaveError(() => parseSaveFile(' '.repeat(2 * 1024 * 1024 + 1)), 'invalid');

    // 3 MB of spaces compresses to a few kilobytes: a small link that would inflate past the 2 MB cap.
    const big = new TextEncoder().encode(' '.repeat(3 * 1024 * 1024));
    const deflated = new Uint8Array(await new Response(new Blob([big]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer());
    let bin = '';
    for (const b of deflated) bin += String.fromCharCode(b);
    const bomb = `v1.${btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`;
    expect(bomb.length).toBeLessThan(64_000);
    await expectSaveError(unpackLink(bomb), 'invalid');
  });

  it('pulls the save out of a location hash', () => {
    expect(saveFromHash('#save=v1.abc_-')).toBe('v1.abc_-');
    expect(saveFromHash('save=v1.abc')).toBe('v1.abc');
    expect(saveFromHash('#join=ABCDE&save=v1.xyz')).toBe('v1.xyz');
    expect(saveFromHash('#join=ABCDE')).toBeNull();
    expect(saveFromHash('')).toBeNull();
  });
});

describe('save store', () => {
  it('lists saves newest first and skips damaged ones', () => {
    const store = memoryStore();
    writeSave(store, midGameRoom('OLDER'), { savedAt: 1000, app: 'a' });
    writeSave(store, midGameRoom('NEWER'), { savedAt: 5000, app: 'a' });
    store.set(saveKey('BROKE'), 'garbage');
    store.set('something.else', 'x');
    const list = listSaves(store);
    expect(list.map(s => s.code)).toEqual(['NEWER', 'OLDER']);
    expect(list[0]).toMatchObject({ key: 'fs.save.NEWER', names: ['Ann', 'Bea', 'Smart Bot'], phase: 'playing', savedAt: 5000 });
    expect(list[0]!.round).toBeGreaterThanOrEqual(4);
    expect(saveSummary(parseSaveFile(store.get('fs.save.OLDER')!)).code).toBe('OLDER');
  });

  describe('localStorageStore', () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    afterEach(() => {
      if (original) Object.defineProperty(globalThis, 'localStorage', original);
      else delete (globalThis as { localStorage?: unknown }).localStorage;
    });

    it('works when localStorage is missing or throws', () => {
      Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('blocked'); } });
      const store = localStorageStore();
      store.set('fs.save.A', '1');
      expect(store.get('fs.save.A')).toBe('1');
      expect(store.keys()).toEqual(['fs.save.A']);
      store.remove('fs.save.A');
      expect(store.get('fs.save.A')).toBeNull();

      Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: undefined });
      const store2 = localStorageStore();
      store2.set('k', 'v');
      expect(store2.get('k')).toBe('v');
    });

    it('uses localStorage when it is there', () => {
      const data = new Map<string, string>();
      const fake = {
        getItem: (k: string): string | null => data.get(k) ?? null,
        setItem: (k: string, v: string): void => { data.set(k, v); },
        removeItem: (k: string): void => { data.delete(k); },
        key: (i: number): string | null => [...data.keys()][i] ?? null,
        get length(): number { return data.size; },
      };
      Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: fake });
      const store = localStorageStore();
      store.set('fs.save.B', '2');
      expect(data.get('fs.save.B')).toBe('2');
      expect(store.keys()).toEqual(['fs.save.B']);
    });
  });

  it('every client keeps the latest room of a game as its own save', async () => {
    const { host, me } = await newLobby({ settings: { playerCount: 2, botDelayMs: 0, factoryOpTimeoutMs: 0, roundEndTimeoutMs: 0 } });
    const beaStore = memoryStore();
    const bea = join(host, 'Bea', 'tok-bea-0123456789', beaStore).client;
    await settle();
    expect(beaStore.keys()).toEqual([]); // nothing saved from the lobby
    await me.setReady(true);
    await bea.setReady(true);
    await me.start();
    await settle();
    const saved = parseSaveFile(beaStore.get(saveKey('KQMTV'))!);
    expect(saved.room.seq).toBe(host.room.seq);
    expect(saved.room.game).toEqual(host.room.game);
    expect(activeSeat(saved.room.game)).toBe(activeSeat(host.room.game));
  });
});
