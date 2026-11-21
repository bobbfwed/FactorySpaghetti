## What we're building
**Factory Spaghetti Online**: an online, isometric 3D version of the physical board game **Factory Spaghetti** (2–4 players) that looks and plays like the printed game, runs from GitHub Pages with no server of our own, and installs on an Android phone. The full plan is in `docs/PLAN.md`; read it before starting any milestone.

Priorities, in order:
1. **Correct, rule-enforced gameplay** — players physically cannot make illegal moves. The existing engine and its tests are the source of truth.
2. **Online play with a room code** — one player hosts in their browser, others join with a 5-letter code or invite link. A game can be saved, sent to another device as a link or file, and resumed on a later day.
3. **Looks and feels like the physical game** — every printed component is a 3D piece on the table; the turn follows the rulebook's steps; only legal moves can be chosen.
4. **Phone-friendly and installable** (Android, from the browser).
5. **Still a playtest tool** — bots, headless balance simulation, config-driven tuning, replays.

The earlier 2D prototype (Canvas 2D client + LAN WebSocket server) lives on the `vite-prototype` branch. Milestone N0 removes those two folders (`src/client`, `src/server`) from the online version; to read the old code use `git show vite-prototype:<path>`.

## Tech stack (decided)
- **Language:** TypeScript everywhere. **Build:** Vite. **Tests:** Vitest.
- **Engine:** pure, deterministic, zero-IO module. No DOM, no sockets, no `Math.random` (seeded PRNG only).
- **3D:** Three.js, orthographic (isometric) camera. Piece models are converted from the designer's `.3mf` print files.
- **Interface:** plain HTML/CSS over the 3D canvas. No UI framework.
- **Online:** WebRTC through PeerJS. The **host's browser** runs the authoritative engine; clients send *move requests*, the host validates and broadcasts the full room state. Modelled on the reference game "No Receipt, No Mercy" (`github.com/bobbfwed/No-Receipt-No-Mercy`), without its real-time stream.
- **Hosting:** GitHub Pages, built and deployed by a GitHub Actions workflow on push to `main`.
- **Install:** web app manifest + service worker (offline solo play, always-fresh when online).

## Non-negotiable architecture
The entire ruleset lives behind one pure function:

```ts
applyAction(state: GameState, action: Action): { ok: true; state: GameState } | { ok: false; error: RulesError }
```

- **No randomness inside the engine.** Dice rolls, shuffles, and deals are inputs (the action carries the roll; setup takes a seed). This makes every game reproducible and replayable from `(seed, action[])`.
- Rendering, networking, sessions, and bots are all *consumers* of the engine. They never contain rules.
- All tunables live in `engine/config.ts` as data (stack composition, card counts, prices, feature toggles), never hardcoded in logic — this is how we tune balance without code changes and how we sim variants.
- **The room is one plain JSON object** (`Room` in `docs/PLAN.md` §4.1): seats, settings, the engine's `GameState`, a move counter, and the dice seed. Anything that must survive a host change or a save goes in it; nothing that must survive lives only in memory.
- **Online, the host rolls the dice.** A client's roll request carries no dice; the host fills them in from the seeded dice stream stored in the room.
- **The interface gets its options from `legalActions`.** It never decides on its own what is allowed.
- **A save is a snapshot of the room**, compressed into a link (`#save=…`) or a file. Keep the room small and versioned; a 4-player save link must stay under 6,000 characters.

## Layout (target for `main`)
```
factory-spaghetti/
  CLAUDE.md  README.md  RULES.md  RULES_CHANGES.md
  docs/
    PLAN.md            # the plan: architecture, look and feel, milestones, open decisions
    mockups/           # visual mock-ups of the table and interface
    screenshots/       # screenshots of the 2D prototype
  src/
    engine/            # UNCHANGED rules engine
      config.ts        # ALL tunables + feature toggles (data only)
      rng.ts           # seeded PRNG — determinism
      state.ts  actions.ts  reducer.ts  routing.ts  connectivity.ts
      rules/           # setup, pieces, production, flow, buildings, cards, scoring, recipes, ...
      index.ts         # public API: createGame, applyAction, legalActions
      __tests__/       # one spec file per rules/ module
    bots/              # randomBot (the fuzzer), greedyBot ("Smart Bot"), evaluateState
    sim/               # headless N-game runner -> stats
    session/           # NEW host + client sessions, lobby, protocol, dice, save format
    net/               # NEW transports (PeerJS, same-browser tabs, in-memory), chunking, room codes
    table/             # NEW Three.js scene: board, pieces, camera, picking, animation
    ui/                # NEW menu, lobby, player tray, turn bar, prompts, log, reference sheets
    app/main.ts        # NEW wiring
  public/              # manifest, service worker, icons, models (.glb), textures
  tools/               # 3MF-to-GLB converter, network check page
```

## Build order
The engine milestones M0–M7 and bot milestones B0–B3 of the prototype are complete (245 engine, bot and simulator tests; the prototype's 19 LAN-server tests left with the server). The new work follows milestones **N0–N11 in `docs/PLAN.md` §6**. Each milestone ends runnable and tested before the next starts. N1–N3 (online) and N4–N5 (3D) do not depend on each other and may be built in parallel; N6 needs both.

| # | Milestone |
|---|---|
| N0 | Restructure, GitHub Pages deploy pipeline, install shell |
| N1 | Session layer without network (room, host/client sessions, host-rolled dice, timers, save format) |
| N2 | Transports (in-memory, same-browser tabs, PeerJS), room codes, join errors |
| N3 | Menu and lobby, resume from device / link / file |
| N4 | Asset pipeline (3MF → GLB) and piece gallery |
| N5 | The 3D table, read-only |
| N6 | Making moves: picking, lit legal targets, one gesture per engine action |
| N7 | Player area, opponents, log, rules reference, bonus cheat sheet |
| N8 | Animation and feel |
| N9 | Phone and install hardening |
| N10 | Online hardening: away players, host hand-over, TURN relay |
| N11 | Playtest tools: replay export/load, rules-problem snapshot, config variants |

## Physical reference
The printed game is the visual reference. The designer's files are outside the repo at `G:\My Drive\Factory Speghetti` (note the spelling): `.3mf` print models in the root, photos of the printed pieces in `Factory Spaghetti\2025*.jpg`, rule PDFs, and card text spreadsheets. `docs/PLAN.md` §5.4 describes each printed piece. Do not commit the designer's source files; convert what is needed through `tools/`.

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
- `legalActions(state, playerId)` powers both the interface (only legal moves can be chosen) and the bots.
- Use the seeded RNG for *everything* random. A game is fully described by `(seed, action[])`.
- Session and network code is tested through the in-memory transport in Vitest; a feature that only works over real WebRTC is not done.
- Interface text uses the rulebook's words (Control Module, Power Token, Leverage card), never internal names such as `placePiece`.
- Design for a phone first: every touch target at least 44 px, no hover-only information.
- Branches: `main` is the online version and is what GitHub Pages serves. `vite-prototype` is the frozen 2D prototype. Do feature work on a branch and merge to `main`.
- Git: there is no GitHub CLI on this machine; use plain `git` over HTTPS.
