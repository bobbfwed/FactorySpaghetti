// Host-rolled dice from a seeded stream stored in the room, so a new host (or a resumed
// game) continues exactly the same dice sequence.

import type { RngState } from '../engine/rng';
import { createRng, nextIntBelow } from '../engine/rng';

// Mixed into the game seed so the dice stream differs from the engine's shuffle stream.
const DICE_SALT = 0x5eedd1ce;

export function diceRngFromSeed(seed: number): RngState {
  return createRng((seed ^ DICE_SALT) >>> 0);
}

/** Roll `count` six-sided dice; returns the values and the advanced stream. */
export function rollDice(rng: RngState, count: number): [dice: number[], next: RngState] {
  const dice: number[] = [];
  let s = rng;
  for (let i = 0; i < count; i++) {
    const [v, next] = nextIntBelow(s, 6);
    dice.push(v + 1);
    s = next;
  }
  return [dice, s];
}
