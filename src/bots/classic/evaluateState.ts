// Smart-bot state evaluation (B2 skeleton).
//
// Strategy is encoded as a weighted sum of state FEATURES, not a tree of if/then
// rules: `evaluateState(state, me)` returns a number where higher = better for
// `me`. The bot (later, B3+) chooses moves by one-ply lookahead — apply each legal
// action, score the result, take the best. This file only scores; it picks nothing.
//
// Pure & deterministic: features read only `state` (no RNG, no clock), so lookahead
// is reproducible and `evaluateState` can run thousands of times per simulated game.
//
// Features are added one milestone at a time. B2 ships just `winProgress` and
// `inventoryValue`; their weights live in `config.BOT_WEIGHTS`.

import type { GameState, PlayerId, PieceType } from '../../engine/state';
import { BOT_WEIGHTS, MATERIAL_VALUES, MINE_COUNT, POWER_PLANT_BASE_YIELD } from '../../engine/config';
import { tesseractCount, resourcePoints } from '../../engine/rules/scoring';
import { factoryExpectedProduct, findInputCompletion } from '../../engine/rules/production';
import type { Material } from '../../engine/config';

// The 4-Tesseract victory target (see scoring.checkTesseractVictory).
const WIN_TARGET = 4;

// Value of one operation of each producing building. Factories produce their named
// material; a power plant produces power tokens — valued modestly here as a proxy for
// the production they enable (powerBalance refines this in a later milestone). Mines
// and blanks produce nothing for the owner. Tunable along with BOT_WEIGHTS.
const PRODUCTION_OUTPUT_VALUE: Partial<Record<PieceType, number>> = {
  plateFact: MATERIAL_VALUES.plate,
  sphereFact: MATERIAL_VALUES.sphere,
  tesseractFact: MATERIAL_VALUES.tesseract,
  powerPlant: 2,
};

// Probability distribution of the sum of `numDice` six-sided dice, indexed by sum.
// A building triggers when the dice sum equals one of its claim modules (see
// production.resolveProduction), so this gives P(a given module fires this roll).
function diceSumDistribution(numDice: number): number[] {
  let dist = [1]; // sum 0 has probability 1 with zero dice
  for (let d = 0; d < numDice; d++) {
    const next = new Array<number>(dist.length + 6).fill(0);
    for (let s = 0; s < dist.length; s++) {
      const p = dist[s]!;
      if (p === 0) continue;
      for (let face = 1; face <= 6; face++) next[s + face]! += p / 6;
    }
    dist = next;
  }
  return dist;
}

// winProgress — Tesseracts owned toward the win (inventory + face-up bonuses, via
// the engine's tesseractCount). Deliberately CONVEX so being at 3 is worth far more
// than at 1: t² gives 0,1,4,9,16 for 0..4 Tesseracts, capped at the target (extra
// Tesseracts past a win add nothing). This is the dominant term.
export function winProgress(state: GameState, me: PlayerId): number {
  const t = Math.min(tesseractCount(state, me), WIN_TARGET);
  return t * t;
}

// expectedProduction — expected per-roll output value across `me`'s buildings:
// Σ over each owned claim of P(its module is rolled | current dice count) × the
// value the building produces. Captures placement/module-vs-dice fit (a module the
// dice can't reach contributes 0 — e.g. modules > 6 with a single mine). Supply and
// power gating are added as their own features in later milestones.
export function expectedProduction(state: GameState, me: PlayerId): number {
  const dist = diceSumDistribution(state.mineCount);
  let total = 0;
  for (const piece of state.board) {
    const value = PRODUCTION_OUTPUT_VALUE[piece.type];
    if (value === undefined) continue; // mine / blank — nothing to produce
    for (const claim of piece.claims) {
      if (claim.ownerId !== me) continue;
      total += (dist[claim.controlModule] ?? 0) * value;
    }
  }
  return total;
}

// inventoryValue — Σ material × point value for `me`. Materials are fuel, not the
// goal, so this is discounted by a small weight; it matters mainly for the
// board-exhaustion ending, whose primary tiebreak is exactly this resource value.
export function inventoryValue(state: GameState, me: PlayerId): number {
  const player = state.players[me];
  return player ? resourcePoints(player) : 0;
}

// bufferedOutput — value of collectable material sitting in `me`'s output buffers.
// It's not inventory yet (needs a meeple + a roundEnd COLLECT), so it carries a smaller
// weight than inventoryValue — which makes OPERATE_BUILDING worthwhile (it converts
// free/mine-fed inputs into output value) while keeping COLLECT a net gain.
export function bufferedOutput(state: GameState, me: PlayerId): number {
  let v = 0;
  for (const piece of state.board) {
    if (!piece.output || !piece.claims.some(c => c.ownerId === me)) continue;
    for (const slot of piece.output.slots) if (slot !== null) v += MATERIAL_VALUES[slot];
  }
  return v;
}

// Value of the best building `me` could claim with the credits a mine UPGRADE slot would
// grant this round, that it can't already afford. Claims cost (module − floor + 1)
// upgrade-credits; a module alone isn't enough, so banking credits is what finally lets
// the bot afford a high-value claim (a Tesseract factory). Returns 0 unless the grant
// actually crosses the affordability threshold for the cheapest claim — so the meeple
// only banks credits when it unlocks something it couldn't otherwise get.
function bestUnlockableClaimValue(state: GameState, me: PlayerId): number {
  const player = state.players[me];
  if (!player) return 0;
  // Goal-directed and capped: bank credits only to claim a FIRST Tesseract factory — the
  // expensive, strategically vital claim the bot is otherwise locked out of. Once it owns
  // one, stop (else it over-banks dead-weight claims and abandons resource collection).
  if (state.board.some(p => p.type === 'tesseractFact' && p.claims.some(c => c.ownerId === me))) return 0;
  const floor = state.mineCount;
  let cheapestCost = Infinity;
  for (const m of player.controlModules) if (m >= floor) cheapestCost = Math.min(cheapestCost, m - floor + 1);
  if (cheapestCost === Infinity) return 0; // no usable module — credits would be wasted
  const future = player.freeActionCredits + state.mineCount + 1; // credits after the upgrade-slot grant
  if (cheapestCost <= player.freeActionCredits || cheapestCost > future) return 0; // doesn't unlock anything new
  const tessClaimable = state.board.some(p =>
    p.type === 'tesseractFact' && !p.claims.some(c => c.ownerId !== me));
  return tessClaimable ? (PRODUCTION_OUTPUT_VALUE.tesseractFact ?? 0) : 0;
}

// meepleHarvest — value `me`'s meeple is positioned to pull into inventory this round:
// material already in its building's output (collect) plus what the building would
// produce if operated (operate-then-collect), a mine resource slot's yield, or — on a
// mine UPGRADE slot — the claim its banked credits would unlock. This is the meeple-
// placement policy expressed as a feature — among PLACE_MEEPLE candidates it is the only
// term that differs, so it steers the meeple onto the richest harvest.
export function meepleHarvest(state: GameState, me: PlayerId): number {
  const player = state.players[me];
  if (!player || player.meepleOnPieceId === null) return 0;
  const piece = state.board.find(b => b.id === player.meepleOnPieceId);
  if (!piece) return 0;

  if (piece.type === 'mine') {
    if (player.meepleSlotIndex === 1) return bestUnlockableClaimValue(state, me); // upgrade slot → bank claim credits
    const idx = state.board.filter(b => b.type === 'mine').findIndex(m => m.id === piece.id);
    if (idx === 0) return 2 * MATERIAL_VALUES.ore; // 1st mine → 2 ore
    if (idx === 1) return MATERIAL_VALUES.plate;    // 2nd mine → 1 plate
    return MATERIAL_VALUES.sphere;                  // 3rd mine → 1 sphere
  }

  let v = 0;
  if (piece.output) for (const slot of piece.output.slots) if (slot !== null) v += MATERIAL_VALUES[slot]; // collect
  const loaded = factoryExpectedProduct(piece); // a valid recipe is already loaded
  if (loaded) {
    v += MATERIAL_VALUES[loaded];
  } else if (piece.input) {
    // Could I complete a recipe from inventory and operate it? Value the NET gain
    // (product − materials consumed) — turning low-value inventory into a higher-value
    // product within the round is a positive, not the loss the raw LOAD step looks like.
    const gain = inventoryConversionGain(piece, player.inventory);
    if (gain > 0) v += gain;
  }
  return v;
}

// Net value of completing `piece`'s recipe from `inventory` and producing: the product's
// value minus the value of the inventory materials consumed. 0 if no valid completion.
function inventoryConversionGain(
  piece: GameState['board'][number],
  inventory: Readonly<Record<Material, number>>,
): number {
  if (!piece.input) return 0;
  const completion = findInputCompletion(piece.type, piece.input.slots, inventory);
  if (!completion) return 0;
  const product = factoryExpectedProduct({ ...piece, input: { ...piece.input, slots: completion.newSlots } });
  if (!product) return 0;
  let consumed = 0;
  for (const m of ['ore', 'plate', 'sphere', 'tesseract'] as Material[]) {
    consumed += (inventory[m] - completion.newInventory[m]) * MATERIAL_VALUES[m];
  }
  return Math.max(0, MATERIAL_VALUES[product] - consumed);
}

// How cheap (in upgrade-credits) a late-game claim must be for the module to still count
// as reserve-worthy capital. claim cost = module − floor + 1, so this keeps modules up to
// (eventual floor + RESERVE_CHEAP_RANGE − 1).
const RESERVE_CHEAP_RANGE = 4;

// claimReserve — value of retained CHEAP-claim capacity. Control modules are the bot's
// scarce claiming capital: claiming a building costs (module − floor + 1) upgrade-credits,
// so a LOW module is what makes a claim affordable — including the strategically vital
// late Tesseract-factory claim (the diagnostics showed the bot is locked out precisely
// because it has burned its cheap modules early). Each retained module is valued by how
// cheaply it could claim at the EVENTUAL floor (MINE_COUNT); spending a cheap module on a
// marginal building costs reserve, so the bot only claims when production/chain value
// exceeds it — i.e. fewer, stronger claims, with cheap modules saved for late.
export function claimReserve(state: GameState, me: PlayerId): number {
  const player = state.players[me];
  if (!player) return 0;
  let v = 0;
  for (const m of player.controlModules) {
    if (m < MINE_COUNT) continue; // below the eventual floor — no late-claim value
    const lateClaimCost = m - MINE_COUNT + 1;
    v += Math.max(0, RESERVE_CHEAP_RANGE - lateClaimCost + 1);
  }
  return v;
}

// powerBalance — the bot is chronically power-starved (it sits on Tesseract factories it
// can't run, blocked only by power). Reward the expected per-roll power income of `me`'s
// SINGLE best power plant: P(its module is rolled | dice count) × base yield. This makes
// the bot UPGRADE its power plant onto a number the dice actually hit (the setup plant is
// module 2, which 2–3 dice almost never sum to), lifting power income without claiming
// extra plants — counting only the best plant means a 2nd one adds nothing, sidestepping
// the breadth-over-focus over-claim trap (a sweep of a sum-over-plants version cratered to
// 0% once it was strong enough to hoard power plants). A buffer term was tried and had
// zero effect, so it's omitted.
export function powerBalance(state: GameState, me: PlayerId): number {
  const dist = diceSumDistribution(state.mineCount);
  let best = 0;
  for (const piece of state.board) {
    if (piece.type !== 'powerPlant') continue;
    for (const claim of piece.claims) {
      if (claim.ownerId === me) best = Math.max(best, (dist[claim.controlModule] ?? 0) * POWER_PLANT_BASE_YIELD);
    }
  }
  return best * 10; // per-roll income is small; scale so a well-placed power plant matters
}

// Weighted evaluation from `me`'s perspective. Positive = good for `me`.
export function evaluateState(state: GameState, me: PlayerId): number {
  const w = BOT_WEIGHTS;
  return (
    w.winProgress * winProgress(state, me) +
    w.production * expectedProduction(state, me) +
    w.bufferedOutput * bufferedOutput(state, me) +
    w.meepleHarvest * meepleHarvest(state, me) +
    w.claimReserve * claimReserve(state, me) +
    w.power * powerBalance(state, me) +
    w.inventoryValue * inventoryValue(state, me)
  );
}
