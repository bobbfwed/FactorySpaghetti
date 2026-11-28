// One owner per building (RULES_CHANGES.md #57): a save, link, room from a host, replay, report
// or journal holding a building shared by two players (possible only in games from before #46) is
// refused, with the old-saves statement the menu and the replay screen show. Games without one load as
// before, old room formats included.

import { describe, it, expect } from 'vitest';
import type { GameState, PlayerId } from '../../engine/state';
import { MAX_CLAIMS_PER_BUILDING } from '../../engine/config';
import { SaveError, acceptHostRoom, asGameState, packLink, serializeSaveFile, toSave, unpackLink, validateSave } from '../save';
import { parseJournal, partialJournal } from '../journal';
import { ReplayError, makeReplay, serializeReplay, validateReplay } from '../replay';
import { makeReport, openPlaytestText, serializeReport } from '../report';
import type { Room } from '../room';
import { findState, playingRoom } from './helpers';

const META = { savedAt: 1, app: 'test' };
const MESSAGE = 'Saves from 0.1.00 or older will not load in this version of the game.';

const game = findState(2, s => s.phase === 'actions' && s.pendingFactoryOps.length === 0 && s.round >= 2);
const owned = game.board.find(p => p.type !== 'mine' && p.claims.length > 0)!;
const owner = owned.claims[0]!.ownerId;
const other = (1 - owner) as PlayerId;

/** `game` with the other player's Control Module added to one of the owner's buildings. */
const shared: GameState = {
  ...game,
  board: game.board.map(p => (p.id === owned.id ? { ...p, claims: [...p.claims, { ownerId: other, controlModule: 9 }] } : p)),
  players: game.players.map(p => (p.id === other ? { ...p, controlModules: p.controlModules.filter(m => m !== 9) } : p)),
};
const room = (g: GameState): Room => playingRoom(g, [{ kind: 'human', name: 'Ann' }, { kind: 'human', name: 'Bea' }], 0);
const kindOf = (f: () => unknown): string | null => {
  try { f(); return null; } catch (e) { return e instanceof SaveError || e instanceof ReplayError ? e.kind : 'other'; }
};

describe('a building shared by two players is refused everywhere a game is loaded (#57)', () => {
  it('a save (from this device or a file): refused with its own kind and the old-saves statement', () => {
    expect(kindOf(() => validateSave(toSave(room(game), META)))).toBeNull();
    expect(kindOf(() => validateSave(toSave(room(shared), META)))).toBe('shared-building');
    try { validateSave(toSave(room(shared), META)); } catch (e) { expect((e as Error).message).toBe(MESSAGE); }
    // (The menu's words for it: app/__tests__/saveMessages.test.ts.)
  });

  it('a save link', async () => {
    const link = await packLink(toSave(room(shared), META, { forLink: true }));
    await expect(unpackLink(link)).rejects.toMatchObject({ kind: 'shared-building' });
    const fine = await unpackLink(await packLink(toSave(room(game), META, { forLink: true })));
    expect(fine.room.game).toEqual(game);
  });

  it('a room sent by a host is not accepted', () => {
    expect(acceptHostRoom(room(shared))).toBeNull();
    expect(acceptHostRoom(room(game))).not.toBeNull();
  });

  it('a replay or report that starts from such a position, and a save file opened as a replay', () => {
    const replay = makeReplay(room(shared), partialJournal(shared, 40), META);
    expect(kindOf(() => validateReplay(JSON.parse(serializeReplay(replay))))).toBe('shared-building');
    expect(kindOf(() => openPlaytestText(serializeReplay(replay)))).toBe('shared-building');
    expect(kindOf(() => openPlaytestText(serializeSaveFile(toSave(room(shared), META))))).toBe('shared-building');
    const report = makeReport({ room: room(shared), journal: null, seat: 0, note: '', lastRefused: null, now: 1, app: 'test' });
    expect(kindOf(() => openPlaytestText(serializeReport(report)))).toBe('shared-building');
    try { openPlaytestText(serializeReplay(replay)); } catch (e) { expect((e as Error).message).toBe('Replays from 0.1.00 or older will not load in this version of the game.'); }
    // The same position without the shared building opens.
    expect(kindOf(() => openPlaytestText(serializeReplay(makeReplay(room(game), partialJournal(game, 40), META))))).toBeNull();
  });

  it('a journal that starts from such a position is not used; the save itself still loads', () => {
    expect(asGameState(shared)).toBeNull();
    expect(parseJournal(partialJournal(shared, 40))).toBeNull();
    expect(parseJournal(partialJournal(game, 40))).not.toBeNull();
    const save = { ...toSave(room(game), META), journal: partialJournal(shared, room(game).seq) };
    const loaded = validateSave(JSON.parse(JSON.stringify(save)));
    expect(loaded.journal).toBeUndefined();
    expect(loaded.room.game).toEqual(game);
  });

  it('more Control Modules on one building than a player may place there is damage', () => {
    const many: GameState = {
      ...game,
      board: game.board.map(p => (p.id === owned.id
        ? { ...p, claims: Array.from({ length: MAX_CLAIMS_PER_BUILDING + 1 }, (_, i) => ({ ownerId: owner, controlModule: 10 + i })) }
        : p)),
    };
    expect(kindOf(() => validateSave(toSave(room(many), META)))).toBe('invalid');
  });
});
