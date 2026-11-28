// The menu's words when a saved game cannot be opened because it holds a building shared by two
// players (RULES_CHANGES.md #57): the same message from this device's list, a link and a file.

import { describe, it, expect } from 'vitest';
import type { GameState, PlayerId } from '../../engine/state';
import { packLink, parseSaveFile, serializeSaveFile, toSave, unpackLink } from '../../session/save';
import { saveErrorMessage } from '../controller';
import { findState, playingRoom } from '../../session/__tests__/helpers';

const MESSAGE = 'This saved game has a building shared by two players. The rules no longer allow that, so it cannot be opened.';

describe('a saved game with a building shared by two players (#57)', () => {
  const game = findState(2, s => s.phase === 'actions' && s.round >= 2);
  const owned = game.board.find(p => p.type !== 'mine' && p.claims.length > 0)!;
  const other = (1 - owned.claims[0]!.ownerId) as PlayerId;
  const shared: GameState = {
    ...game,
    board: game.board.map(p => (p.id === owned.id ? { ...p, claims: [...p.claims, { ownerId: other, controlModule: 9 }] } : p)),
  };
  const save = toSave(playingRoom(shared, [{ kind: 'human', name: 'Ann' }, { kind: 'human', name: 'Bea' }], 0), { savedAt: 1, app: 'test' });

  it('the menu says so in plain words, on every loading route', async () => {
    const caught = async (f: () => unknown): Promise<unknown> => { try { await f(); return null; } catch (e) { return e; } };
    const fromText = await caught(() => parseSaveFile(serializeSaveFile(save)));
    expect(saveErrorMessage(fromText, 'device')).toBe(MESSAGE);
    expect(saveErrorMessage(fromText, 'file')).toBe(MESSAGE);
    const link = await packLink(save);
    expect(saveErrorMessage(await caught(() => unpackLink(link)), 'link')).toBe(MESSAGE);
  });
});
