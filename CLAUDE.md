## What we're building
A digital version of the physical board game **Factory Spaghetti** (2–4 players), used primarily as a **rules-enforcing playtest tool**. Priorities, in order:
1. **Correct, rule-enforced gameplay** — players physically cannot make illegal moves.
2. **Headless balance simulation** — run thousands of bot games to tune the economy.
3. **Local hot-seat / vs-bot play** on PC and Steam Deck (desktop mode).
4. **LAN multiplayer** for in-person game nights.
Visual polish is explicitly *lower* priority than rule fidelity. This is a lab bench, not a shipped product (yet).

## Tech stack (decided)
- **Language:** TypeScript everywhere.
- **Engine:** pure, deterministic, zero-IO module. No DOM, no sockets, no `Math.random` (seeded PRNG only).
- **Tests:** Vitest.
- **Client:** browser, Canvas 2D to start (the board is geometric hexes — no engine needed). Reach for PixiJS only if perf demands it.
- **LAN:** Node + `ws`. The host runs the authoritative engine; clients send *action requests*, host validates and broadcasts full state.
- **Native (optional, later):** wrap the client with **Tauri** for small Linux/Windows binaries; add as a non-Steam game so it launches from Steam Deck Game Mode.
- Steam Deck desktop mode is KDE/Firefox — the web build runs there as-is; Tauri is only for a native feel.

## Non-negotiable architecture
The entire ruleset lives behind one pure function:

```ts
applyAction(state: GameState, action: Action): { ok: true; state: GameState } | { ok: false; error: RulesError }
```

- **No randomness inside the engine.** Dice rolls, shuffles, and deals are inputs (the action carries the roll; setup takes a seed). This makes every game reproducible and replayable from `(seed, action[])`.
- Rendering, networking, and bots are all *consumers* of the engine. They never contain rules.
- All tunables live in `engine/config.ts` as data (stack composition, card counts, prices, feature toggles), never hardcoded in logic — this is how we tune balance without code changes and how we sim variants.

## Suggested layout
```
factory-spaghetti/
  CLAUDE.md
  RULES.md
  RULES_CHANGES.md
  package.json  tsconfig.json  vitest.config.ts
  src/
    engine/
      config.ts        # ALL tunables + feature toggles (data only)
      rng.ts           # seeded PRNG (e.g. mulberry32) — determinism
      state.ts         # GameState, Player, Building, Board, Buffer, Teleporter types
      actions.ts       # Action union + RulesError type
      reducer.ts       # applyAction()  — dispatch only; logic in rules/
      rules/
        setup.ts       # stacks, starting board, first-building claim order
        pieces.ts      # placing board pieces, adjacency, stack exhaustion -> mine auto-drop
        production.ts  # roll resolution, factory/power-plant operation, buffers
        flow.ts        # direct adjacency, belts, teleporters (material movement)
        buildings.ts   # claim/upgrade, Control Modules, mines (buy + auto-drop)
        cards.ts        # leverage cards (incl. play-on-draw), 2/turn limit
        scoring.ts      # points, bonus Tesseracts (behind toggle), victory + tiebreaks
      index.ts         # public API: createGame, applyAction, legalActions, score
      __tests__/       # one spec file per rules/ module
    bots/
      botInterface.ts  # chooseAction(state, playerId): Action
      randomBot.ts     # uniform over legalActions() — the FUZZER
      greedyBot.ts     # weighted heuristics — the sparring partner
    sim/
      runGames.ts      # headless N-game runner -> stats (CSV/JSON)
    server/
      protocol.ts      # client<->server message types
      server.ts        # authoritative host (ws)
    client/
      net.ts           # ws client (full-state sync)
      render/          # board, hexes, pieces, buffers, belts, teleporters, meeples
      ui/              # action panel, log, bonus cheat-sheet panel
      main.ts
```

## Build order (each milestone is runnable + tested before moving on)
- **M0 — Tooling.** TS + Vitest + lint + npm scripts. Seed `CLAUDE.md`, `RULES.md`, `RULES_CHANGES.md`. `npm test` green on an empty suite.
- **M1 — Engine skeleton.** `state.ts`, `actions.ts`, seeded `rng.ts`, `config.ts`. `createGame(seed, playerCount)` builds stacks + starting board + first-building claim order. Tests: setup is deterministic for a given seed; piece counts match config.
- **M2 — Turn loop.** Place piece → roll (N dice = N mines) → production → meeple placement → round completion (end-of-round operate, free upgrades = #mines, rotate start player). Tests: buffer rules, power payment, "same number rolled twice with full output buffer = nothing."
- **M3 — Material flow.** Direct adjacency, belts (placement validity rules, chaining, the >2-connection-point rule, one-belt-per-mine-per-turn), teleporters (permanent, input + output behavior, cost counter). Tests: teleporter on opponent's-turn activation, output-cap overflow.
- **M4 — Buildings & mines.** Claim/upgrade with Control Modules, multi-claim (≤3), mine **purchase** and **auto-drop on stack exhaustion**, mine-driven recompute (dice count, card price, claim floor). Tests: claim-cost-plus-upgrade math; "1" retired at 2 mines.
- **M5 — Cards.** All cards incl. the 4 new ones, play-on-draw flag, 2-cards-per-turn limit, purchase-any-number. One test per card.
- **M6 — Scoring & victory.** Points; victory check **only on active player's turn** (4 Tesseracts incl. face-up bonuses); board-exhaustion ending → most points + tiebreak ladder. Bonus Tesseracts behind `config.bonusesEnabled`. Tests: simultaneous-win impossibility; tiebreaks.
- **M7 — Bots + sim.** randomBot (run it for 10k+ turns as a fuzzer to crash-test the engine), greedyBot, `runGames.ts` emitting game length, win-condition frequency, resource distributions, bonus-claim rates.
- **M8 — Client.** Read-only board render of a live `GameState` first; then wire action input. Local single-player vs bots.
- **M9 — LAN.** Authoritative ws host + browser clients, join-by-IP lobby, full-state broadcast (so reconnect just re-syncs).
- **M10 — (optional) Tauri** native build + Steam Deck.

## Setup Algorthm (ordered)
- **S1 — Hand out components.** Give each player the PLAYER_COMPONENTS set. All 18 Control Modules start in the tray (none on a building). Belts and teleporters start unplaced. Reference/assistant cards (cost & points summaries) are physical aids only — the engine doesn't model them.
- **S2 — Prepare the Leverage deck.** Build the deck from the (post-change) card-count config, shuffle with the seeded RNG, place as the draw pile.
- **S3 — Build the three stacks.** Using STACK_COMPOSITION[playerCount], assemble stacks 1/2/3 from the piece pool and shuffle each with the seeded RNG.
  Mine 2 covers stack 2; mine 3 covers stack 3. In engine terms: mines 2 and 3 are not on the board, and stacks 2 and 3 are locked until their mine enters play (by purchase or stack-exhaustion auto-drop — see the mines change).
  The starting draw pile is the remainder of stack 1 after S5.
- **S4 — Place the first mine.** Put mine 1 at the board origin in a canonical orientation. Location/orientation is arbitrary by the rules; fix it deterministically (e.g., origin, rotation 0) so games are reproducible. Mine count is now 1 ⇒ 1 die.
- **S5 — Pull and place the starting pieces.**
  Remove STARTING_PIECES_PER_PLAYER × playerCount pieces from stack 1: per player, 1 Power Plant + 1 Plate Factory + 2 blanks (= 4 each).
  Shuffle these starting pieces together (seeded) and randomize each one's rotation (seeded).
  Place them clockwise around the first mine, filling adjacent cells in a clockwise ring/spiral until all are placed. Implementation: maintain an ordered list of open cells adjacent to the placed cluster, sorted clockwise starting from a canonical edge of the mine; pop and fill in that order. (Depends on the hex coordinate system chosen in M1 — reference that; the mine is a 2-hex footprint with 10 external edges, so a ring of single-hex neighbors wraps around it.)
  Whatever remains in stack 1 after this removal is the active draw pile for turn 1.
- **S6 — Determine the starting player.** Derive deterministically from the seed (model the "roll dice to see who starts" as a seeded roll). Set startingPlayerIndex and the starting-player marker.
- **S7 — Initial building claims (two phases, opposite directions).** This is a special setup-only claim: it uses fixed Control Modules, not the normal "initial = mine count" rule. No power/material cost.
  Phase A — Plate Factories (reverse order). Order = the normal turn order reversed, i.e. begins with the player immediately counter-clockwise of the starting player and proceeds counter-clockwise, ending on the starting player. Each player in turn claims one of the placed Plate Factories by placing their "3" Control Module on it.
  Phase B — Power Plants (forward order). Order = normal turn order, beginning with the starting player, clockwise. Each player claims one placed Power Plant with their "2" Control Module.

## Smart Bot Creation (ordered)
- **B0 — Bot scaffolding.** The chooseAction interface, a randomBot that picks uniformly from legalActions, and a way to run bot-vs-bot in the simulator. Tests: a full game completes start to finish with no engine errors. This is also your fuzzer — let it run thousands of games and shake out engine bugs before the smart bot exists.
- **B1 — Belt router, standalone.** findRoute on hand-constructed board fixtures. Tests: routes correctly across blank pieces, respects the >2-apart rule, returns the cheapest path, returns null when blocked by another player's buffers or locked points, honors one-belt-per-mine. No bot involved yet.
- **B2 — evaluateState skeleton + first features.** Just winProgress and inventoryValue. Tests: a state with 3 Tesseracts scores higher than one with 1; the function is deterministic. Nothing chooses moves yet — you're testing the scorer in isolation.
- **B3 — Minimal greedy bot.** Wire chooseAction to one-ply lookahead over evaluateState with just those two features. Test: it reliably beats randomBot over N games. Now you have a playable, improving opponent.
- **B4 onward — one feature per milestone.** Add expectedProduction, then supplyConnectivity (now it consumes the router), then powerBalance, etc. The rule for each: it only stays if it raises self-play win rate. That's your regression test for strategy.
- **Later milestones** for the action-specific policies (meeple, cards, claim/upgrade, mine) and finally the weight-tuning sweep.

## Conventions
- Pure functions in `engine/`; never mutate `state` — return new state.
- Every rule change updates **both** `RULES.md` and `RULES_CHANGES.md` in the same commit.
- Prefer many small `rules/` functions with focused tests over one mega-reducer.
- `legalActions(state, playerId)` must exist early — it powers both the UI (gray out illegal moves) and the bots.
- Use the seeded RNG for *everything* random. A game is fully described by `(seed, action[])`; add a replay loader as soon as it's convenient — it's the best debugging tool you'll have.