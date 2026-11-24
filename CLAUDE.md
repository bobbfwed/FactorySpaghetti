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
The printed game is the visual reference. The designer's files are outside the repo at `G:\My Drive\Factory Speghetti` (note the spelling). **`Factory Speghetti AMS.3mf` in that folder is the one up-to-date source for the current 3D models and colours.** Many of the other `.3mf` files and the photos in `Factory Spaghetti\2025*.jpg` are out of date (older tile symbols, gold and purple inlays, the old starting mine); use them only for pieces the AMS file does not contain. Renders of the current tiles and mines are in `docs/reference/`. `docs/PLAN.md` §5.4 describes each piece. Do not commit the designer's source files; convert what is needed through `tools/`.

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
- **Always commit after each round of code changes.** When a piece of work is finished and its checks pass, commit it before starting the next; do not leave finished work uncommitted in the working tree.
- **Version number:** the game's version is `version` in `package.json` (the start menu shows it, without the build's commit hash). Do not change it in ordinary commits. It goes up only when the owner asks, or once per push to `main` when every change is committed: bump the patch number in its own commit just before that push, and update the version named at the top of `README.md` in the same commit. Never bump it more than once between two pushes.
- Branches: `main` is the online version and is what GitHub Pages serves. `vite-prototype` is the frozen 2D prototype. Work directly on `main` (one developer, no pull requests). Every push to `main` redeploys the live site, so commit locally after each round of changes but push only when the round is finished and checked.
- Git: there is no GitHub CLI on this machine; use plain `git` over HTTPS.


## Things to take care of next round of changes (by request of owner -- remove each task as they are accomplished, remove this section once it's empty):
- Change the browser prompt for deleting old games, since built-in prompts may be blocked by popup blockers or just settings in the browser. Make it a modal in DOM.
- Prominantly display the current version. A large "0.1" and a small ".02" 
- Add optins to use bots other than Smart Bot.
- Come up with new methods for bots to try to play smartly, more like a human. Test other play styles to see if there are exploits a player could use to always (or much more likely) win.
- Fix: during game play, the screen constantly zooms in and out. The might be caused by drawing focus to event, and with bots, the speed is much more pronounced, making the zooming in and out very annoying. This should be removed when bots are playing.
- Belts are placed backwards in every case I cound find. They have a arrow-like shap that should point in the direction of material flow (from a mine to a build's input, from a building's output to a building's input). If belts are placed where the direction of material flow is not yet clear (not connected to a mine or a building's input or output), the direction of flow should be from where the player first clicked, to where they clicked second. If on a later round, the player places a building or belt that makes the material flow direction unambiguous, adjust the line of belt's direction to match the known direction of flow. The direction of flow for all belts in a line of belts must be maintained.
- The Starting page and while playing the game needs to have a button to pull up the game guide. There is already a "Rules" tab on the right, which is good to leave as-is. The game guide will have a lot more information. This should be written for how the player interacts with the game. Use the "G:\My Drive\Factory Speghetti\Factory Speghetti Instructions v1.1.pdf" as an idea on how a paper version of the guide would be written. But this version of the rules is missing all of the rules in RULES_CHANGES.md and probably missing some rule clarifications included in RULES.md. Write a new game guide that is mobile and desktop friendly that can be viewed by the players. Make a clear table of contents as the first page seen, then allow the user to click through to more detailed information (for how a player would interact with the game). Since the rules are explicitely spelled out in the games code, allow the users to click into the normal instructions to get an even more detailed explaination of how a specific mechanic works. Not all parts of the guide need this, if it's clear enough in the normal part of the instructions, further details do not need to be given. But if there is nuance to how a rule operates, or exceptions to the rule, there is where additional information would be valuable. In this game guide, if there are changes made over time (from one release to another) there should be a section of the game guide that spells out what used to be the rule, and how the rule works now.
- I haven't played as a player that isn't host yet, but I would like each player's default perspective of the board to be one of the four cardinal directions as viewing the board. This is the simulate how players sit around a table. Each player can still rotate the table freely (with the button at the top-right), but the default orientation will make a different on which parts of the board a player focuses on. The location of the leverage cards, board game piles, etc. should stay how they do now, the only thing that changes is the number of table rotations (as if clicking the top-right button) each player stays out looking at.
- Move the board game piles further from the active board, so that the view from 180-degrees of the board does not cause the active board game pieces to be blocked by the piles of unused board game pieces.
- Fix: I placed belts, but I was unable to buy a leverage card in the same turn. I had one ore and one plate. There were two active mines on the board. I had sufficient resources. Later in the game I saw the same thing, but I had a spehere and no plate, or ore, and was unable to purchase a leverage card. But the next round, when I had 2 speheres, I was able to puchase a card.
- The "teleporters" tile at the bottom of the screen should be highlighted (like the lay a belt tile) to make it clear this is an option (if the player has sufficient material and available teleporters). If the player doesn't have sufficient material and available teleporters, click the "teleporters" tile should indicate why it's not an option right now.
- Add a "total" material value to the inventory. If I have one ore, one plate, and one sphere, it should show "Total Value: 11".
- When placing your meeple on the mine positions, the game should say at the bottom (currently says "place your meeple on the mine resource point?"), "place your meeple on the mine resource point to gain X at the end of the round?" Where it says what you will get by placing the meeple there.
- Fix: I had a sphere and an ore. I purchased a leverage card (two mines were active on the board, so it cost 3 material). The game left me with 5 ore after the purchase. Instead, the exchange should be done inteligently so that the player left left with the highest possible denominations. If I were playing in real life, I would have exchanged my spere for 2 plates and an ore. Then spent a plate on the card. Leaving me with 2 ore and one plate. Being able to keep the higher value materials is important for most players.
- I do not see a way for players to exchange higher value materials for lower value materials.
- Fix: during the place meeple phase, a player can click outside of the board, and "confirm / cancel" buttons appear. I did not test to see what happens if I try to confirm a meeple placement outside of the board.
- Simplify and clear up end-round events:
  - Currently, each player gets free build upgrades, and one or more players get claims and upgrades. Players who only have upgrades can perform the upgrades as soon as the round ends. Other players' actions do not directly affect each other. If only one player has building claims available, that player can also start doing the process immediately. If more than one player is on an upgrade/claim position two different mines, then the player who is comes first in the clockwise player order (nearest to the first player in that order) must go first, so they have a chance to claim a building. As soon as they have used their claim, the other player can start claiming and upgrading. A notification should show saying "waiting on player X to claim a building". This should be done intelligently, as in, if it's impossible with the current available number of upgrades and/or the tiles the player has available to make a claim, then the second player doesn't need to wait. There could be 3 players (one player on each of the three mines) who are waiting on one or two other players to finish their claim session. So the notification should be clear what is happening and who is waiting on who.
  - All upgrade points can be combined in any way. Say a player is on the claim/upgrade locaion on a mine. He gets 3 upgrades (and an optional claim). There are two free upgrades because there are two active mines. This provides the player 5 possible upgrades and one claim. These can be combined and executed on in any order. The player could upgrade 5 buildings by one upgrade each, or claim 2 buildings using 2 upgrades each and use the final upgrade as a claim.
- When hosting a game, allow multiple players to play from the same device. Allow each to setup their own name and color.