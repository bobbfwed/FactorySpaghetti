// When the host's "Remove player" is offered during a game, and where (on the seat, or only in
// the player's details), and what it asks. The views draw exactly what these functions say.

import { describe, it, expect } from 'vitest';
import { createGame } from '../../engine';
import type { Room, Seat } from '../../session/room';
import { playingRoom } from '../../session/__tests__/helpers';
import { REMOVE_PLAYER_LABEL, canRemovePlayer, removeOnSeat, removePlayerQuestion } from '../lobby';
import { kickedText } from '../controller';

/** Ann (host, seat 0), Bea (seat 1), Smart Bot (seat 2), Cy (seat 3); everyone connected. */
function room(patch: Record<number, Partial<Seat>> = {}, extra: Partial<Room> = {}): Room {
  const r = playingRoom(createGame(7, 4), [
    { kind: 'human', name: 'Ann' }, { kind: 'human', name: 'Bea' }, { kind: 'bot', name: 'Smart Bot' }, { kind: 'human', name: 'Cy' },
  ], 0);
  const seats = r.seats.map(s => ({ ...s, connected: s.kind === 'human', ...patch[s.index] }));
  return { ...r, seats, ...extra };
}

describe('the host\'s "Remove player" during a game', () => {
  it('is offered to the host for every other player, connected or away, but never for bots or the host', () => {
    const r = room({ 3: { connected: false, awaySince: 5 } });
    expect([0, 1, 2, 3].map(i => canRemovePlayer(r, 0, i))).toEqual([false, true, false, true]);
  });

  it('is not offered to anyone but the host', () => {
    const r = room({ 3: { connected: false, awaySince: 5 } });
    expect([0, 1, 2, 3].map(i => canRemovePlayer(r, 1, i))).toEqual([false, false, false, false]);
    expect(canRemovePlayer(r, null, 3)).toBe(false);
  });

  it('stands directly on an away seat (on the countdown, or when the game waits), not on a connected one', () => {
    const r = room({ 3: { connected: false, awaySince: 5 } });
    expect(removeOnSeat(r, 0, 3)).toBe(true);
    expect(removeOnSeat(r, 0, 1)).toBe(false); // connected: in the player's details instead
    const waiting = room({ 3: { connected: false, awaySince: 5 } }, { settings: { ...r.settings, awayPolicy: 'wait' } });
    expect(removeOnSeat(waiting, 0, 3)).toBe(true);
  });

  it('is gone once a bot plays the away seat (nothing left to skip), but stays for a connected seat on autopilot', () => {
    const r = room({ 1: { autopilot: true, botId: 'greedy' }, 3: { connected: false, awaySince: 5, autopilot: true, botId: 'greedy' } });
    expect(canRemovePlayer(r, 0, 3)).toBe(false);
    expect(removeOnSeat(r, 0, 3)).toBe(false);
    expect(canRemovePlayer(r, 0, 1)).toBe(true);
  });

  it('is only for a game in progress (also on hold), not the lobby or a finished game', () => {
    expect(canRemovePlayer(room({}, { hold: true }), 0, 1)).toBe(true);
    expect(canRemovePlayer(room({}, { phase: 'lobby' }), 0, 1)).toBe(false);
    expect(canRemovePlayer(room({}, { phase: 'finished' }), 0, 1)).toBe(false);
  });

  it('says what happens before it is done', () => {
    expect(REMOVE_PLAYER_LABEL).toBe('Remove player');
    expect(removePlayerQuestion('Bea')).toBe('Remove Bea? A bot will play their seat. They can rejoin later with the room code.');
  });
});

describe('what a removed player is told', () => {
  it('during a game, that a bot plays their seat; in the lobby, only that they can join again', () => {
    expect(kickedText(room())).toBe('The host removed you from this game; a bot plays your seat. You can join again with the room code ROOMA.');
    expect(kickedText(room({}, { phase: 'lobby' }))).toBe('The host removed you from this game. You can join again with the room code ROOMA.');
    expect(kickedText(null)).toBe('The host removed you from this game. You can join again with the room code.');
  });
});
