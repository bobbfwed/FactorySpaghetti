// Pure helpers: option grouping and labels, step words, lobby steppers and colour choices.

import { describe, expect, it } from 'vitest';
import { applyAction, createGame, legalActions } from '../../engine';
import type { GameState, PlayerId } from '../../engine/state';
import type { Room } from '../../session/room';
import { newLobbyRoom } from '../../session/room';
import { COLLAPSE_OVER, finalStandings, gameOverWords, operatePrompts, optionGroups, phaseWords } from '../gameText';
import { colorChoices, durationWords, listNames, stepValue, OPERATE_STEPS } from '../lobby';

function playingRoom(game: GameState): Room {
  const base = newLobbyRoom('ABCDE', 'Ann');
  const names = ['Ann', 'Bea', 'Cy', 'Dee'];
  return {
    ...base, phase: 'playing', game,
    seats: base.seats.slice(0, game.playerCount).map((s, i) => ({ ...s, kind: 'human', name: names[i]!, connected: true })),
    settings: { ...base.settings, playerCount: game.playerCount },
  };
}

/** Play the first legal move of whoever must act until `stop` holds. */
function advance(g: GameState, stop: (g: GameState) => boolean): GameState {
  for (let i = 0; i < 500 && !stop(g); i++) {
    const who = (g.pendingFactoryOps[0]?.ownerId ?? g.turnOrder[g.activePlayerIndex]) as PlayerId;
    const a = g.phase === 'roll' && g.pendingFactoryOps.length === 0 ? { type: 'ROLL_DICE' as const, rolls: Array(g.mineCount).fill(3) as number[] } : legalActions(g, who)[0]!;
    const r = applyAction(g, a);
    if (!r.ok) throw new Error(r.error.message);
    g = r.state;
  }
  return g;
}

describe('game text', () => {
  it('names every step in rulebook words', () => {
    const g = createGame(5, 2);
    expect(phaseWords(g)).toBe('Setup: claim a Plate Factory');
    expect(phaseWords({ ...g, phase: 'roll' })).toBe('Step 2: roll the dice');
    expect(phaseWords({ ...g, phase: 'roundEnd' })).toBe('Round end: operate and upgrade');
  });

  it('groups legal moves; only the active seat gets options; long groups start collapsed', () => {
    const g0 = createGame(5, 2);
    const room0 = playingRoom(g0);
    const active = g0.turnOrder[g0.activePlayerIndex]!;
    const setup = optionGroups(room0, active);
    expect(setup.map(x => x.id)).toEqual(['setup']);
    expect(setup[0]!.options[0]!.label).toMatch(/^Claim the Plate Factory .* of the first Mine \(unclaimed\) with Control Module 3$/);
    // No board coordinates in anything a player reads.
    for (const g of setup) for (const o of g.options) expect(o.label).not.toMatch(/-?\d+,-?\d+/);
    expect(optionGroups(room0, 1 - active)).toEqual([]);

    const g1 = advance(g0, g => g.phase === 'placePiece');
    const room1 = playingRoom(g1);
    const me = g1.turnOrder[g1.activePlayerIndex]!;
    const place = optionGroups(room1, me);
    expect(place[0]!.id).toBe('place');
    expect(place[0]!.options.length).toBeGreaterThan(COLLAPSE_OVER);
    expect(place[0]!.collapsed).toBe(true);
    expect(place[0]!.options[0]!.sub).toBe('From stack 1');
    expect(place[0]!.options[0]!.label).toMatch(/of the first Mine/);
    for (const o of place[0]!.options) expect(o.label).not.toMatch(/-?\d+,-?\d+/);

    const g2 = advance(g1, g => g.phase === 'roll');
    const roll = optionGroups(playingRoom(g2), g2.turnOrder[g2.activePlayerIndex]!);
    expect(roll.map(x => x.id)).toEqual(['roll']);
    expect(roll[0]!.options[0]!.label).toBe('Roll 1 die');
    expect(roll[0]!.collapsed).toBe(false);
  });

  it('lists operate-or-skip prompts for whoever owes them, with the cost', () => {
    const g0 = advance(createGame(5, 2), g => g.phase === 'actions');
    const plate = g0.board.find(p => p.type === 'plateFact' && p.claims.length > 0)!;
    const g: GameState = { ...g0, pendingFactoryOps: [{ pieceId: plate.id, ownerId: plate.claims[0]!.ownerId }] };
    const room = playingRoom(g);
    const prompts = operatePrompts(room);
    expect(prompts[0]!.cost).toMatch(/^−\d power, .+ → /);
    // The owner's option list is empty: the prompt is shown instead.
    expect(optionGroups(room, prompts[0]!.seat)).toEqual([]);
  });

  it('words the end of the game', () => {
    const g = createGame(5, 2);
    const room = playingRoom({ ...g, gameOver: true, winner: 1, gameOverReason: 'tesseracts' });
    expect(gameOverWords(room)).toBe('Bea wins with 4 Tesseracts.');
    const tie = playingRoom({ ...g, gameOver: true, winner: null, tiedWinners: [0, 1], gameOverReason: 'boardExhausted' });
    expect(gameOverWords(tie)).toBe('Ann and Bea share the win on points (the pieces ran out, the last round was finished and material value was counted).');
  });

  it('orders the final standings: winners first, then by the measure the game was won on', () => {
    const g = createGame(5, 3);
    const inv = (ore: number, tesseract: number): GameState['players'][number]['inventory'] => ({ ore, plate: 0, sphere: 0, tesseract });
    const players = g.players.map((p, i) => ({ ...p, inventory: [inv(9, 0), inv(0, 2), inv(30, 1)][i]! }));
    const byPoints = finalStandings(playingRoom({ ...g, players, gameOver: true, winner: 0, gameOverReason: 'boardExhausted' }));
    expect(byPoints.map(s => s.seat)).toEqual([0, 2, 1]);
    expect(byPoints[0]!.won).toBe(true);
    const byTess = finalStandings(playingRoom({ ...g, players, gameOver: true, winner: 0, gameOverReason: 'tesseracts' }));
    expect(byTess.map(s => s.seat)).toEqual([0, 1, 2]);
    expect(byTess[1]!.tesseracts).toBe(2);
  });
});

describe('lobby helpers', () => {
  it('steps timers within the list and words durations', () => {
    expect(stepValue(OPERATE_STEPS, 8000, 1)).toBe(10_000);
    expect(stepValue(OPERATE_STEPS, 8000, -1)).toBe(6000);
    expect(stepValue(OPERATE_STEPS, 7000, 1)).toBe(8000);
    expect(stepValue(OPERATE_STEPS, 0, -1)).toBe(0);
    expect(stepValue(OPERATE_STEPS, 120_000, 1)).toBe(120_000);
    expect(durationWords(0)).toBe('Off');
    expect(durationWords(8000)).toBe('8 s');
    expect(durationWords(120_000)).toBe('2 min');
    expect(durationWords(90_000)).toBe('1 min 30 s');
    expect(listNames(['A', 'B', 'C'])).toBe('A, B and C');
  });

  it('offers free colours and colours held by bots or open seats, not other players\'', () => {
    const r = newLobbyRoom('ABCDE', 'Ann');
    const room: Room = { ...r, seats: r.seats.map((s, i) => (i === 1 ? { ...s, kind: 'human', name: 'Bea', connected: true } : i === 2 ? { ...s, kind: 'bot', name: 'Bot' } : s)) };
    const c = colorChoices(room, 0);
    expect(c.map(x => [x.color, x.free, x.mine])).toEqual([['blue', true, true], ['red', false, false], ['orange', true, false], ['green', true, false]]);
  });
});
