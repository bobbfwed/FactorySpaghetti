// The classic Smart Bot (up to 2026-11-27), kept unchanged as `greedy-classic` so the simulator
// can always compare the current Smart Bot with it. Not offered in the lobby. Its one change: the
// roll request's dice come from the state (stateDice) instead of Math.random, which keeps it
// deterministic; every runner (the host, the simulator) rolls the real dice itself anyway.
//
// Greedy ("smart") bot — one-ply lookahead over evaluateState.
//
// For each legal action: apply it, score the resulting state with evaluateState,
// and take the highest-scoring one. The action phase allows many actions per turn;
// the surrounding loop (sim / session) calls chooseAction repeatedly, so the greedy
// loop is realised across calls — each call takes the single best next action, and
// once nothing improves the score the bot ends the phase.
//
// Strategy lives entirely in evaluateState + config.BOT_WEIGHTS, never here. This
// file is just the search. Deterministic except for the dice roll, which is not a
// bot decision (rolls are generated like the other bots, recorded in the action).

import type { GameState, PlayerId } from '../../engine/state';
import type { Action } from '../../engine/actions';
import type { Material } from '../../engine/config';
import type { BotFn } from '../botInterface';
import { applyAction, legalActions } from '../../engine/reducer';
import { FACTORY_POWER_COST, MATERIAL_VALUES } from '../../engine/config';
import { factoryCanOperate, factoryExpectedProduct, findInputCompletion } from '../../engine/rules/production';
import { evaluateState } from './evaluateState';
import { stateDice } from '../styles/dice';

// Actions that end the current phase. On a score tie we prefer these so the bot
// advances instead of churning value-neutral moves (e.g. place-then-remove belt).
const PASS_ACTIONS: ReadonlySet<Action['type']> = new Set(['END_ACTIONS', 'END_TURN']);

// Mutually-reversible, usually score-neutral moves — filtered unless they strictly improve
// (see the anti-stall note in chooseAction).
const BELT_ACTIONS: ReadonlySet<Action['type']> = new Set(['PLACE_BELT', 'REMOVE_BELT']);

const MATS: readonly Material[] = ['ore', 'plate', 'sphere', 'tesseract'];

// Round-end production policy (an action-specific policy — see the spec). Greedy one-ply
// can't sequence load → operate → collect, because each LOAD is individually a loss
// (inventory → an uncounted input buffer) even though the whole sequence turns low-value
// material into a higher-value product. So when the meeple sits on an owned factory we
// drive that profitable conversion directly. Returns the next step, or null to defer to
// the normal scorer. (meepleHarvest is what steers the meeple onto the right factory.)
function roundEndConversion(state: GameState, me: PlayerId): Action | null {
  const player = state.players[me];
  if (!player || player.meepleOnPieceId === null) return null;
  const f = state.board.find(p => p.id === player.meepleOnPieceId);
  if (!f || !f.input || !f.output) return null;            // a factory with buffers
  if (!f.claims.some(c => c.ownerId === me)) return null;  // owned by me

  // 1. Bank any finished output first (also frees the buffer to operate again).
  if (f.output.slots.some(s => s !== null)) return { type: 'COLLECT_OUTPUT', pieceId: f.id };

  if (player.meepleOperatedThisRound) return null;         // one operation per round end

  // 2. A valid recipe is already loaded (e.g. free mine ore) and we can run it → operate.
  if (factoryCanOperate(f, player)) return { type: 'OPERATE_BUILDING', pieceId: f.id };

  // 3. Otherwise complete a PROFITABLE recipe from inventory, one load at a time.
  const completion = findInputCompletion(f.type, f.input.slots, player.inventory);
  if (!completion) return null;
  const product = factoryExpectedProduct({ ...f, input: { ...f.input, slots: completion.newSlots } });
  if (!product) return null;
  if (product !== 'ore' && player.powerTokens < (FACTORY_POWER_COST[product] ?? 0)) return null; // can't run it
  let consumed = 0;
  for (const m of MATS) consumed += (player.inventory[m] - completion.newInventory[m]) * MATERIAL_VALUES[m];
  if (MATERIAL_VALUES[product] <= consumed) return null;   // conversion isn't worth it
  for (let i = 0; i < f.input.slots.length; i++) {
    if (f.input.slots[i] === null && completion.newSlots[i] !== null) {
      return { type: 'LOAD_BUILDING_INPUT', pieceId: f.id, material: completion.newSlots[i]! };
    }
  }
  return null;
}

export const chooseAction: BotFn = (state: GameState, playerId: PlayerId): Action => {
  if (state.phase === 'roll') {
    return { type: 'ROLL_DICE', rolls: stateDice(state, playerId) };
  }

  // Round-end: drive any profitable produce-from-inventory conversion the one-ply
  // lookahead can't sequence. Guarded by applyAction so we never emit an illegal move.
  if (state.phase === 'roundEnd') {
    const conv = roundEndConversion(state, playerId);
    if (conv && applyAction(state, conv).ok) return conv;
  }

  const actions = legalActions(state, playerId);
  if (actions.length === 0) {
    throw new Error(
      `greedyBot: no legal actions for player ${playerId} in phase "${state.phase}"`,
    );
  }

  const baseline = evaluateState(state, playerId); // status quo — the value of doing nothing

  let best: Action = actions[0]!;
  let bestScore = -Infinity;
  let bestIsPass = false;

  for (const action of actions) {
    const res = applyAction(state, action);
    if (!res.ok) continue; // legalActions should never yield one, but stay defensive
    const s = evaluateState(res.state, playerId);
    // Anti-stall: belts are mutually reversible and usually score-neutral, so a
    // place↔remove pair can outscore a slightly-worse END_ACTIONS and loop forever (never
    // ending the turn, so the round-end board-exhaustion check never fires). Only consider
    // a belt move if it STRICTLY improves on the status quo.
    if (BELT_ACTIONS.has(action.type) && s <= baseline) continue;
    const isPass = PASS_ACTIONS.has(action.type);
    if (s > bestScore || (s === bestScore && isPass && !bestIsPass)) {
      bestScore = s;
      best = action;
      bestIsPass = isPass;
    }
  }

  return best;
};
