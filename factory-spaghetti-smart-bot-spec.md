# Factory Spaghetti — Smart Bot: Architecture & Strategy Spec (for Claude Code)

Target: `bots/greedyBot.ts` (a.k.a. the "smart" bot), plus a routing module shared with the engine/UI. Builds on the existing pure engine (`legalActions`, `applyAction`, deterministic, seeded RNG).

## Core idea — evaluation, not procedure

Do **not** encode strategy as a tree of "if situation then move" rules. Encode it as a **weighted state-evaluation function**, and let the bot pick moves by search:

```
chooseAction(state, me):
  candidates = legalActions(state, me)
  best = argmax over candidates of  evaluateState(applyAction(state, action), me)
  return best
```

- `evaluateState(state, me) → number` is a weighted sum of **features** (below). Positive = good for `me`.
- The action phase allows many actions per turn, so run this **greedily in a loop**: repeatedly take the single best-scoring action until no action has positive marginal value or resources run out, then pass.
- All weights live in `config.ts` (e.g., `BOT_WEIGHTS`). Tuning = changing numbers + re-running the simulator, never rewriting logic.
- The engine is pure and deterministic, so one-ply lookahead (apply each candidate, score the result) is cheap. The dice roll is **not** a bot decision (it happens between piece-placement and the action phase), so every choice the bot actually makes is deterministic given the current state — no expectimax needed for v1.

```ts
function evaluateState(s: GameState, me: PlayerId): number {
  const w = config.BOT_WEIGHTS;
  return (
    w.winProgress      * f_winProgress(s, me) +
    w.production        * f_expectedProduction(s, me) +
    w.supply           * f_supplyConnectivity(s, me) +
    w.power            * f_powerBalance(s, me) +
    w.moduleFit        * f_moduleOptimality(s, me) +
    w.chain            * f_chainSynergy(s, me) +
    w.tesseractAccess  * f_tesseractAccess(s, me) +
    w.teleporters      * f_teleporterLeverage(s, me) +
    w.bonus            * f_bonusProximity(s, me) +
    w.inventoryValue   * f_inventoryValue(s, me) +
    w.capWaste         * f_capWastePenalty(s, me) +   // negative weight
    w.threat           * f_opponentThreat(s, me)      // negative weight
  );
}
```

## Feature catalog

Each is a function `(state, me) → number`. Right column maps to your strategy ideas.

| Feature | What it rewards / penalizes | Your idea |
|---|---|---|
| **winProgress** | Tesseracts owned (real + face-up bonuses). Make it **non-linear** — being at 3 is worth far more than 1 (distance-to-4 closing). Dominant weight. | win condition |
| **expectedProduction** | For each owned building: `P(its module(s) rolled \| current dice count) × value produced × (suppliable? × powerable?)`. This single term captures most of your intuition — placement, module-vs-dice, supply, power all feed it. | #2, #6, #7 |
| **supplyConnectivity** | Each factory's inputs reliably reachable (belt from mine/upstream via the router, or teleporter, or direct adjacency). Unsupplied factory ≈ dead weight. | #1, #2 |
| **powerBalance** | Expected power income/round − expected power consumption/round. Negative = factories will stall. Plus current buffer vs. the 10 cap. | #5 |
| **moduleOptimality** | How close each building's module(s) sit to the current peak of the dice distribution, weighted by building value. 1 mine → favor ≤6; 2 mines → favor 7; 3 mines → favor 10–11. | #6, #7 |
| **chainSynergy** | Detect connected production chains (plate→sphere→tesseract, by belt/adjacency/teleporter). Reward chains beyond the sum of their parts; reward reinforcing them (extra modules, better numbers). | #7 |
| **tesseractAccess** | Do I have access to a Tesseract factory at all? **Critical:** Tesseract factories appear only in stacks 2 & 3 — you literally cannot win without acquiring mine 2. Reward owning one and reward progress toward mine 2. | (new) |
| **teleporterLeverage** | Value of placed teleporters: output-teleporter on a high-yield building = passive collection (incl. on opponents' rolls, under the all-players-produce rule); input-teleporter relieving a supply bottleneck. Reward buying them **early while globally cheap**. | (new) |
| **bonusProximity** | If bonuses enabled: per bonus, closeness to holding/securing it (Investor: highest module ≥10; Belt Weaver: longest chain ≥8; Factory Empire: most buildings ≥6). Each ≈ 1 Tesseract — a real alt-path. | (new) |
| **inventoryValue** | Σ material × point value, **discounted** (materials are fuel, not the goal) — matters mainly for the board-exhaustion ending. | (new) |
| **capWastePenalty** | *(negative)* Penalize states that overflow caps (6/material, 10 power): production lost, output buffers jammed, materials stranded in unreachable buffers. | (new) |
| **opponentThreat** | *(negative)* Subtract for opponents' progress (their Tesseracts, production capacity, bonus holdings). Makes the bot race/disrupt rather than play solitaire. Tune low enough to avoid paranoia. | (new) |

## Action-specific policies

Some choices need their own evaluation rather than pure state-scoring:

- **Meeple placement** (#3, #5): enumerate legal spots, take the max marginal value. Typical ranking: collect a stranded high-value output (e.g., a stuck Tesseract) > operate a power plant when power-starved > mine resource point for a needed input > upgrade point if a useful upgrade is available. Remember the end-of-round "operate once for free" — value the meeple as a guaranteed extra activation.
- **Power recovery** (#5): when `powerBalance` is negative, prefer (a) meeple on a power plant that already has input in its buffer (free power), else (b) meeple on an empty power plant + feed a Plate/Sphere from inventory for a big burst per the 1/2/5/10 chart. Chronic deficit → raise the weight on claiming/supplying power plants.
- **Missing-input recovery** (#4): if a factory lacks an input, the bot's normal action search already surfaces the options (grab ore at a mine resource point; convert up via another owned factory; route a belt; feed via teleporter) — it picks whichever yields the best resulting state. No special-casing needed beyond making sure those are all in `legalActions`.
- **Claim / upgrade allocation** (#1, #6, #7): spend earned upgrades (end-of-round = #mines, plus mine upgrade points) to maximize `moduleOptimality × buildingValue`, or to claim a new **routable** high-value building (check via the router first — don't claim what you can't supply). Favor multi-claiming a key building (up to 3 modules = 3 trigger numbers) when chain reliability matters more than breadth.
- **Card buy/play policy**: score each card's expected value in the current state, buy if EV > cost, and (max 2/turn) play the top two above a threshold. Sketch values: *Scouting Drone* = fetch a needed Tesseract factory / power plant; *Sink Hole* = deny a key opponent piece; *Personal Jet Pack* = sum of material sitting in my output buffers; *Mine Inspection* = free plates × mines; *Embezzlement* = free sphere; *Asset Forfeiture* = my plate gain minus what it hands rivals; *Short Sale / Production Increase* = a cheap high claim; *Changing Priorities* = re-point modules to better numbers. *(Cards are absent from your original list — this is a whole strategic axis to add.)*
- **Mine purchase timing**: buy mine 2/3 when (a) you need Tesseract access, (b) the dice-distribution shift improves your module layout, and (c) you can afford it without starving production. This is often the single highest-leverage strategic move — make sure the bot considers it, not just incremental building.

## Belt routing module (the one real algorithm) — #1, #2

Separate, reusable (engine or shared module; the human UI wants it too):

```ts
findRoute(state, source, dest, playerId, maxBelts?): Route | null
// Route = ordered belt placements + total belt cost, or null if unroutable.
```

- **Graph:** nodes = belt connection points across all placed pieces; plus mine-output and factory-buffer positions as **endpoints** (these are not belt points — a belt terminates on the *adjacent* piece at the aligned point facing the buffer/output).
- **Edges:** within a piece, two belt points connect iff they satisfy the >2-apart circular-distance rule and the piece allows belts there; across pieces, the two aligned points on a shared edge are connected (material flows through).
- **Constraints (from the rules):** skip points adjacent to another player's claimed building buffers; skip points already locked by another player; respect one-new-belt-to-a-mine-per-turn; belts are within-piece only (cross-piece is via alignment, not a belt).
- **Cost** = number of belts (within-piece links). Minimize via Dijkstra/BFS.
- **Used by the bot for two things:** (1) scoring — "is this factory suppliable, and at what belt cost?" feeds `supplyConnectivity` and the claim policy; (2) execution — emit the actual belt-placement actions. The heuristics choose *what* to connect; the router decides *whether and how cheaply*.

Performance: cache routes / update incrementally as pieces and belts change — `evaluateState` runs thousands of times per simulated game.

## Tunability, tiers, and self-tuning

- Keep **randomBot** (uniform over `legalActions`) as the fuzzer — it crash-tests the engine and is the baseline the smart bot must beat handily.
- Ship the smart bot as **greedy one-ply** first; it'll already play coherently. Optional later: shallow expectimax over the next roll for stronger play — almost certainly overkill for playtesting.
- Put all weights in `config.BOT_WEIGHTS`. To find good weights, **let the simulator do it**: random-search or hill-climb the weight vector with self-play win-rate (or speed-to-4-Tesseracts) as the fitness function. This turns "is this strategy good?" into a measured number instead of an argument — and it's the natural extension of the balance simulator you already planned.

## Build order for the bot
1. `findRoute` + tests (it gates the supply features).
2. `evaluateState` with `winProgress`, `expectedProduction`, `supplyConnectivity`, `powerBalance` only — enough to beat randomBot.
3. Add the remaining features; verify each *raises* self-play win rate before keeping it.
4. Add action-specific policies (meeple, cards, claim/upgrade, mine).
5. Weight-tuning sweep via the simulator.
