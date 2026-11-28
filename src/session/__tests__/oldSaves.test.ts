// Saves from the newest broken app version or older are refused with one sentence (SAVES_BROKEN_THROUGH).

import { describe, it, expect } from 'vitest';
import type { GameState, PlayerId } from '../../engine/state';
import {
  SAVES_BROKEN_THROUGH, type SaveEnvelope, SaveError, isRefusedAppVersion, oldSavesText, packLink, parseSaveFile, serializeSaveFile, toSave, unpackLink, validateSave,
} from '../save';
import { listSaves, memoryStore, saveKey } from '../store';
import { ReplayError, makeReplay, serializeReplay, validateReplay } from '../replay';
import { makeReport, openPlaytestText, serializeReport } from '../report';
import { partialJournal } from '../journal';
import type { Room } from '../room';
import { findState, playingRoom } from './helpers';

const SENTENCE = 'Saves from 0.1.00 or older will not load in this version of the game.';
const game = findState(2, s => s.phase === 'actions' && s.pendingFactoryOps.length === 0 && s.round >= 2);
const room = (g: GameState = game, code?: string): Room => {
  const r = playingRoom(g, [{ kind: 'human', name: 'Ann' }, { kind: 'human', name: 'Bea' }], 0);
  return code ? { ...r, code } : r;
};
const saveBy = (app: string): SaveEnvelope => toSave(room(), { savedAt: 1, app });
const messageOf = (f: () => unknown): string | null => {
  try { f(); return null; } catch (e) { return (e as Error).message; }
};

describe('the cutoff and the sentence', () => {
  it('names 0.1.0 and builds the exact sentence', () => {
    expect(SAVES_BROKEN_THROUGH).toBe('0.1.0');
    expect(oldSavesText()).toBe(SENTENCE);
    expect(oldSavesText('Replays')).toBe('Replays from 0.1.00 or older will not load in this version of the game.');
  });

  it('compares major.minor.patch numerically and ignores +sha', () => {
    for (const v of ['0.1.0', '0.0.9', '0.1.0+abc1234', '0.0.12', '0.1.00']) expect(isRefusedAppVersion(v), v).toBe(true);
    for (const v of ['0.1.1', '0.1.1+abc1234', '0.2.0', '1.0.0', '0.1.10', 'dev', 'test', '', undefined, 5]) expect(isRefusedAppVersion(v), String(v)).toBe(false);
  });
});

describe('a save made by 0.1.0 or older is refused before anything else', () => {
  it('as a save file, a device save and a link', async () => {
    const old = saveBy('0.1.0+abc1234');
    expect(messageOf(() => parseSaveFile(serializeSaveFile(old)))).toBe(SENTENCE);
    expect(messageOf(() => validateSave(JSON.parse(JSON.stringify(old))))).toBe(SENTENCE);
    await expect(unpackLink(await packLink(toSave(room(), { savedAt: 1, app: '0.1.0' }, { forLink: true })))).rejects.toMatchObject({ kind: 'old-version', message: SENTENCE });
    // Before the other checks: a damaged room of an old save still gets the sentence.
    expect(messageOf(() => validateSave({ ...old, room: { v: 1 } }))).toBe(SENTENCE);
  });

  it('a 0.1.1 save (room format 1) and a dev build save still load', async () => {
    for (const app of ['0.1.1', '0.1.1+abc1234', 'dev']) {
      expect(validateSave(JSON.parse(JSON.stringify(saveBy(app)))).room.game).toEqual(game);
    }
    const fine = await unpackLink(await packLink(toSave(room(), { savedAt: 1, app: '0.1.1+abc1234' }, { forLink: true })));
    expect(fine.room.game).toEqual(game);
  });

  it('a shared building in a dev build save gets the same sentence', () => {
    const owned = game.board.find(p => p.type !== 'mine' && p.claims.length > 0)!;
    const other = (1 - owned.claims[0]!.ownerId) as PlayerId;
    const shared: GameState = { ...game, board: game.board.map(p => (p.id === owned.id ? { ...p, claims: [...p.claims, { ownerId: other, controlModule: 9 }] } : p)) };
    const err = ((): SaveError | null => { try { validateSave(toSave(room(shared), { savedAt: 1, app: 'dev' })); } catch (e) { return e as SaveError; } return null; })();
    expect(err?.kind).toBe('shared-building');
    expect(err?.message).toBe(SENTENCE);
  });

  it('a replay or report from 0.1.0 says "Replays"; a save file opened as a replay says "Saves"', () => {
    const replay = makeReplay(room(), partialJournal(game, 40), { savedAt: 1, app: '0.1.0' });
    const R = 'Replays from 0.1.00 or older will not load in this version of the game.';
    expect(messageOf(() => validateReplay(JSON.parse(serializeReplay(replay))))).toBe(R);
    expect(messageOf(() => openPlaytestText(serializeReplay(replay)))).toBe(R);
    const report = makeReport({ room: room(), journal: null, seat: 0, note: '', lastRefused: null, now: 1, app: '0.1.0' });
    expect(messageOf(() => openPlaytestText(serializeReport(report)))).toBe(R);
    const err = ((): ReplayError | null => { try { openPlaytestText(serializeSaveFile(saveBy('0.1.0'))); } catch (e) { return e as ReplayError; } return null; })();
    expect(err?.message).toBe(SENTENCE);
    expect(messageOf(() => openPlaytestText(serializeReplay(makeReplay(room(), partialJournal(game, 40), { savedAt: 1, app: '0.1.1' }))))).toBeNull();
  });
});

describe('the saved-games list', () => {
  it('skips a 0.1.0 save without deleting it', () => {
    const store = memoryStore();
    const fine = room(game, 'FINEA');
    const old = room(game, 'OLDAA');
    store.set(saveKey('FINEA'), serializeSaveFile(toSave(fine, { savedAt: 2, app: '0.1.1+abc' })));
    store.set(saveKey('OLDAA'), serializeSaveFile(toSave(old, { savedAt: 3, app: '0.1.0+abc' })));
    expect(listSaves(store).map(s => s.code)).toEqual(['FINEA']);
    expect(store.get(saveKey('OLDAA'))).not.toBeNull();
  });
});
