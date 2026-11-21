// The one-line roll outcome, built from the room's events.

import { describe, it, expect } from 'vitest';
import type { TableEvent } from '../../../session/room';
import { outcomeOf, outcomeText, update } from '../rollOutcome';

const names = ['Ann', 'Bea'];
const nameOf = (s: number): string => names[s] ?? `Player ${s + 1}`;

describe('roll outcome', () => {
  it('says plainly when nothing was activated', () => {
    const o = outcomeOf(12, [{ kind: 'roll', seat: 1, dice: [6], total: 6 }])!;
    expect(outcomeText(o, nameOf, 0)).toBe('Bea rolled 6: no Control Module 6 is on a building, so nothing was activated.');
  });

  it('names each activated building, its owner and what it did', () => {
    const events: TableEvent[] = [
      { kind: 'roll', seat: 0, dice: [2, 4], total: 6 },
      { kind: 'activated', seat: 1, pieceId: 'p1', building: 'plateFact', outcome: 'awaiting-choice', amount: 1 },
      { kind: 'activated', seat: 0, pieceId: 'p2', building: 'powerPlant', outcome: 'power', amount: 2 },
      { kind: 'activated', seat: 0, pieceId: 'p3', building: 'sphereFact', outcome: 'input-missing', amount: 0 },
    ];
    const o = outcomeOf(30, events, 2)!;
    expect(outcomeText(o, nameOf, 0)).toBe(
      "You rolled 6: Bea's Plate Factory is activated: Bea decides whether to run it; your Power Plant gave 2 Power Tokens; your Sphere Factory did nothing: its input is not complete. Ore flowed from the Mines into 2 inputs.");
  });

  it('follows a factory being run or skipped after the roll', () => {
    const o = outcomeOf(30, [
      { kind: 'roll', seat: 0, dice: [6], total: 6 },
      { kind: 'activated', seat: 1, pieceId: 'p1', building: 'plateFact', outcome: 'awaiting-choice', amount: 1 },
      { kind: 'activated', seat: 0, pieceId: 'p4', building: 'plateFact', outcome: 'awaiting-choice', amount: 1 },
    ])!;
    const later = update(o, [
      { kind: 'operated', seat: 1, pieceId: 'p1', building: 'plateFact', product: 'plate', powerChange: -1, teleported: false },
      { kind: 'skipped', seat: 0, pieceId: 'p4', building: 'plateFact' },
    ]);
    expect(outcomeText(later, nameOf, 0)).toBe("You rolled 6: Bea's Plate Factory made 1 Plate; your Plate Factory was not run.");
    // Unrelated events change nothing.
    expect(update(o, [{ kind: 'cardPlayed', seat: 0, card: 'scoutingDrone' }])).toBe(o);
  });

  it('uses the last roll of a burst, and none when there was no roll', () => {
    const o = outcomeOf(50, [
      { kind: 'roll', seat: 0, dice: [3], total: 3 },
      { kind: 'activated', seat: 0, pieceId: 'p2', building: 'powerPlant', outcome: 'power', amount: 1 },
      { kind: 'roll', seat: 1, dice: [5], total: 5 },
    ])!;
    expect(o.roller).toBe(1);
    expect(o.items).toHaveLength(0);
    expect(outcomeOf(1, [{ kind: 'cardPlayed', seat: 0, card: 'scoutingDrone' }])).toBeNull();
  });
});
