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
  Phase A — Plate Factories (forward order). Order = normal turn order, beginning with the starting player, clockwise. Each player in turn claims one of the placed Plate Factories by placing their "3" Control Module on it.
  Phase B — Power Plants (reverse order). Order = the normal turn order reversed, i.e. begins with the last player and proceeds counter-clockwise, ending on the starting player. Each player claims one placed Power Plant with their "2" Control Module.
  (Order confirmed by the owner on 2026-11-24: this is what the engine and `RULES.md` do; the printed rulebook has the two phases the other way round.)

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
- **Version number:** see the section "Version number" below, and "Release tags" after it. The owner usually pushes by hand, so before saying whether something has been pushed, run `git fetch origin` and compare `main` with `origin/main` instead of assuming.
- **Rules version:** the rules version is `RULES_VERSION` in `src/engine/config.ts` (today 0.70; the printed rulebook is 0.61). It is shown on the start menu and in the guide. Treat a rule the owner describes as a clarification of the current rules version unless the owner says it is a new rule, and raise `RULES_VERSION` only then (updating `RULES.md` line 1, the "Rule versions" section of `RULES_CHANGES.md` and `README.md` in the same commit). The app version in `package.json` tracks the digital game and follows its own bullet.
- **Guide change log:** the guide's "What changed" topic is a change log of the rules by rules version (newest first; the oldest section compares with the printed rulebook). It lists only differences in how the game is played; changes of the digital version and corrections that make the digital game follow the rules do not go there. When a rule changes, update the section of the current rules version in the same commit, or add a new section when the owner raises the rules version.
- **Old saves:** `SAVES_BROKEN_THROUGH` in `src/session/save.ts` is the newest app version whose saves no longer load (today 0.1.0); the start menu states it. Raise it in the same commit as any change that makes older saves unusable; refused saves are not listed, and no other explanation is shown.
- Branches: `main` is the online version and is what GitHub Pages serves. `vite-prototype` is the frozen 2D prototype. Work directly on `main` (one developer, no pull requests). Every push to `main` redeploys the live site. Commit locally after each round of changes; the owner pushes, with a plain push, when a round is finished and checked, or asks Claude to push (see "Pushing" below).
- Git: there is no GitHub CLI on this machine; use plain `git` over HTTPS.

## Version number

The game's version is `version` in `package.json` (the start menu shows 0.1.4 as "0.1.04"). The same
number must stand in `package-lock.json` (its two top `version` fields) and in the two places
`README.md` names the current version; change all of them together. It goes up by one patch number
at most once per push to `main`, and only when the product's code changed since the last push.
"Product code" means what ships to players: `src/` (without the `__tests__` folders and without
`src/sim/`), `public/`, `index.html`, `net-check.html` and `vite.config.ts`, plus a change to the
`dependencies` in `package.json`. Docs, `RULES.md`, `RULES_CHANGES.md`, tests, `tools/`, `dev/`,
`.github/` and `CLAUDE.md` are not product code.

Do not try to remember whether a push has happened. You cannot know that from the conversation, and
the owner pushes by hand. Ask git instead, before every commit:

1. Read the pushed number: `git show origin/main:package.json` (the `version` line).
2. Read the local number in the working copy.
3. Check whether product code differs from the pushed copy, counting the changes you are about to
   commit: `git diff --stat origin/main -- src public index.html net-check.html vite.config.ts ":(exclude)src/**/__tests__/**" ":(exclude)src/sim/**"`
4. Decide:
   - Product code differs and the local number equals the pushed number: add one, in this commit.
   - The local number is already the pushed number plus one: leave it alone, however many commits follow.
   - Product code does not differ: do not bump. The local number must equal the pushed number.
   - The local number is more than one above the pushed number: that is a mistake. Set it back to the
     pushed number plus one.

Rules that follow from this:
- Never bump twice between two pushes. Never bump because a new session, task or day started.
- Everything done between two pushes belongs to one release: the pushed number plus one. Comments,
  plans and commit messages name that number, not a number per commit.
- Every commit message ends with that number in brackets, written as the start menu shows it, for
  example `(0.1.04)`. This includes commits that change no product code and commits made before the
  one that bumps the number.
- If a push carries no product code, the number does not go up, and later commits keep the same number.
- Never run `git pull` yourself, and never push on your own initiative: see "Pushing" below.
- When work is handed to helper agents or done on other branches or worktrees, the helpers do not
  touch the version. The session that commits or merges onto `main` applies the steps above there.
- One exception, already applied: the pushes of 24 and 27 November 2026 went out without a bump and
  showed 0.1.01. They count as 0.1.02 and 0.1.03, so the release after the pushed 0.1.1 is 0.1.4.
  Once 0.1.4 is pushed, the steps above apply with no exception.

## Release tags

Each pushed release gets a git tag so any earlier version can be found later.
- Before the first commit of a piece of work, read the pushed version (step 1 above). If
  `git tag -l v<version as the start menu shows it>` (for example `v0.1.04`) prints nothing, tag the
  pushed commit: `git tag -a v0.1.04 origin/main -m "Release 0.1.04"`.
- Never move or delete a tag. A push with no product code keeps the existing tag where it is.
- Tags reach the remote only when they are pushed (`git push --follow-tags`), by the owner or by
  Claude when the owner asked for a push.

## Pushing

The owner decides when the game goes live (decided 2026-11-27; it is a preference, not a security
rule).
- Push only when the owner asks for it in the conversation, for example "push when this round is
  done". The request covers the push it names, not later ones. Without a request, commit locally and
  say that nothing was pushed.
- Before pushing: every change is committed; `npm run typecheck`, `npm run lint`, `npm test` and
  `npm run build` pass on `main`; the version follows the section "Version number"; `git fetch origin`
  shows `origin/main` is an ancestor of `main` (if it is not, stop and tell the owner; never pull,
  merge or rebase to make a push fit).
- Push with `git push --follow-tags origin main`. Never force-push and never push any other branch.
- Afterwards, tag the pushed commit as described under "Release tags" if its tag is missing, say
  which commit and version went out, and remember that every push redeploys the live site.
- If a check fails or anything looks risky, do not push; report it and leave the push to the owner.
