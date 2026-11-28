// Uniform-random bot: picks uniformly among legal actions. Used as the fuzzer — any crash while
// running this bot indicates an engine bug.
//
// No Math.random (CLAUDE.md: a game is fully described by (seed, action[])): the choice comes from
// a generator seeded by a hash of the state, so the same state always gives the same move and a
// game replays exactly from its seed. The dice of its roll request come from the state as well
// (stateDice); every runner — the online host, the simulator — rolls the real dice itself.

import type { GameState, PlayerId } from '../engine/state';
import type { Action } from '../engine/actions';
import type { BotFn } from './botInterface';
import { legalActions } from '../engine/reducer';
import { nextIntBelow } from '../engine/rng';
import { stateDice } from './styles/dice';

/** A cheap hash of what changes from one decision to the next (FNV-1a over a few numbers). */
function stateHash(state: GameState, me: PlayerId): number {
  let h = 2166136261 >>> 0;
  const mix = (x: number): void => { h = Math.imul(h ^ (x >>> 0), 16777619) >>> 0; };
  mix(state.seed); mix(state.round); mix(state.activePlayerIndex); mix(me);
  mix(state.board.length); mix(state.belts.length); mix(state.beltsPlacedThisTurn.length);
  mix(state.cardsPlayedThisTurn); mix(state.pendingFactoryOps.length); mix(state.cardDeck.length);
  for (let i = 0; i < state.phase.length; i++) mix(state.phase.charCodeAt(i));
  for (const p of state.players) {
    mix(p.inventory.ore); mix(p.inventory.plate); mix(p.inventory.sphere); mix(p.inventory.tesseract);
    mix(p.powerTokens); mix(p.freeActionCredits); mix(p.hand.length); mix(p.beltsRemaining);
    mix(p.teleportersRemaining); mix(p.controlModules.length); mix(p.meepleOnPieceId === null ? 0 : p.meepleOnPieceId.length + 1);
  }
  return h;
}

export const chooseAction: BotFn = (state: GameState, playerId: PlayerId): Action => {
  if (state.phase === 'roll' && !state.pendingFactoryOps.some(e => e.ownerId === playerId)) {
    return { type: 'ROLL_DICE', rolls: stateDice(state, playerId) };
  }

  const actions = legalActions(state, playerId);
  if (actions.length === 0) {
    throw new Error(
      `randomBot: no legal actions for player ${playerId} in phase "${state.phase}"`,
    );
  }
  // Taking back a belt laid this turn restores the state exactly, and a choice seeded by the state
  // would then lay the same belt again forever; so those take-backs are left out (when anything
  // else is listed).
  const forward = actions.filter(a => a.type !== 'UNDO_BELTS' &&
    !(a.type === 'REMOVE_BELT' && state.beltsPlacedThisTurn.includes(a.beltId)));
  const pool = forward.length > 0 ? forward : actions;
  const [i] = nextIntBelow(stateHash(state, playerId), pool.length);
  return pool[i]!;
};
