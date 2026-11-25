# Bot findings: play styles, a tournament, and exploits

For the designer. Written 2026-11-24 from 4,827 seeded tournament games (plus 580 games for the end-of-game analysis). Every figure says how many games it rests on; "95% CI" is the range the true win rate very likely lies in. An even share is 50% at 2 players, 33% at 3, 25% at 4.

## Summary

1. **The Bonus Tesseracts decide the game.** Of the bots' four-Tesseract wins, 76–99% used at least one bonus. The usual winning hand is **2 real Tesseracts + The Investor + Factory Empire**.
2. **Factory Empire goes to whoever aims for it.** When a player goes for it, someone holds it at the end of 93–100% of games. It is first taken around round 8–11, and once taken it almost never changes hands. Smart Bot ignores it and never once held it.
3. **The Investor is a module race to 18.** A tie keeps the bonus with its holder, so the first player to put a Control Module on 18 keeps it for good. Before that it changes hands 3–7 times a game.
4. **At 2 players the second seat wins about 60%.** In games between identical bots the second player wins 58–65%. Removing one piece from the 2-player stacks does not fix it.
5. **Not exploits:** buying every Leverage card loses every game (0 wins in 324). Rushing the next Mine is ordinary (no better than the Planner). No line stalls the game: in 4,827 games there were no unfinished games and no refused moves.

## The bots

| Bot (lobby label) | What it does |
|---|---|
| Smart Bot | The existing one-move look-ahead bot. Unchanged; it is the baseline. |
| Planner Bot | Feeds its buildings from the Mines with belts. Buys output teleporters early, chooses Control Modules for the dice in play and the next Mine's dice, keeps the materials for its next Tesseract recipe, and meeples where the round end pays most. |
| Mine Rusher Bot | Planner, but buys the next Mine whenever it can and sets its modules for the bigger dice sums early. |
| Card Shark Bot | Planner, but buys a card whenever the deck's average card is worth the price, and plays two a turn. |
| Bonus Hunter Bot | Planner that weighs each Bonus Tesseract at more than a real one. Uses the Mine upgrade point for claims, climbs one module towards 18, and tries long belt chains. |
| Hoarder Bot | Keeps materials for points. Takes Mine resource points, and when ahead empties the shortest stack to end the game. |
| Teleporter Bot | Buys teleporters eagerly, so its meeple is free for the Mines. |

All six share one decision procedure (`src/bots/styles/styleBot.ts`); a style is a short list of weights (`profiles.ts`). They read only what a player at the table knows: never the order of the face-down stacks or of the deck. A typical decision takes 0.3 ms; in six 4-player games the slowest was 53 ms.

## Who wins

### Each style alone against a table of Smart Bots
Run A: 864 games, seeds 10000–10015, every seat rotated.

| Style | 2 players (32 games) | 3 players (48) | 4 players (64) |
|---|---|---|---|
| Bonus Hunter | **96.9%** (84–99) | 77.1% (64–87) | 20.3% (12–32) |
| Planner | 93.8% (80–98) | **87.5%** (75–94) | 51.6% (40–63) |
| Mine Rusher | 90.6% (76–97) | 68.8% (55–80) | **56.3%** (44–68) |
| Teleporter | 90.6% (76–97) | 66.7% (53–78) | 40.6% (30–53) |
| Card Shark | 87.5% (72–95) | 70.8% (57–82) | 43.8% (32–56) |
| Hoarder | 75.0% (58–87) | 62.5% (48–75) | 43.8% (32–56) |

Every style beats Smart Bot by a wide margin. Smart Bot does not build supply chains and never goes for Factory Empire. At 4 players it wins almost only on points when the board runs out (218 of its 220 wins). It is a weak baseline, so "beats Smart Bot" proves little on its own. The tables below pit the styles against each other.

### Everyone against everyone (all six styles and Smart Bot)
Run B: 861 games, seeds 20000–20002, every table of distinct bots, every seat rotated.

| Bot | 2 players (36 games each) | 3 players (135) | 4 players (240) |
|---|---|---|---|
| Bonus Hunter | **72.2%** (56–84) | **50.4%** (42–59) | 24.6% (20–30) |
| Planner | 55.6% (40–71) | 40.7% (33–49) | **30.0%** (25–36) |
| Mine Rusher | 55.6% (40–71) | 37.0% (29–45) | 26.7% (22–33) |
| Teleporter | 63.9% (48–78) | 34.1% (27–42) | 20.4% (16–26) |
| Card Shark | 36.1% (23–52) | 31.1% (24–39) | 18.8% (14–24) |
| Hoarder | 44.4% (30–60) | 23.7% (17–32) | 28.3% (23–34) |
| Smart Bot | 22.2% (12–38) | 16.3% (11–23) | 26.3% (21–32) |

A second, independent run with the six styles only (run F: 600 games, seeds 60000–60003, 320 games per style) agrees: Bonus Hunter 85.0% (71–93) at 2 players and 55.0% (46–64) at 3, but 24.4% (18–32) at 4, where the Planner leads with 32.5% (26–40).

- **At 2 and 3 players the Bonus Hunter wins about 1.5 times its share**, and the confidence interval stays above the even share. At 4 players its edge disappears: with more rivals the bonuses change hands more, and the game more often ends on points (52% of 4-player games), where the Bonus Hunter is weakest because it spends its materials.
- At 4 players nothing stands out; every style is within a few points of 25%.

### The best styles against each other
Run E2: each bot alone at a table of Planners (the strongest all-round style). 648 games, seeds 50000–50011.

| Bot | 2 players (24 games) | 3 players (36) | 4 players (48) |
|---|---|---|---|
| Bonus Hunter | 75.0% (55–88) | 47.2% (32–63) | 33.3% (22–48) |
| Scripted "bonus rush" (below) | 75.0% (55–88) | 50.0% (35–66) | 37.5% (25–52) |
| Scripted Empire rush | 66.7% (47–82) | 36.1% (23–52) | 25.0% (15–39) |
| Scripted Investor lock | 62.5% (43–79) | 27.8% (16–44) | 20.8% (12–34) |
| Smart Bot | 4.2% (1–20) | 16.7% (8–32) | 31.3% (20–45) |
| Scripted "buy every card" | 0% (0–14) | 0% (0–10) | 0% (0–7) |

The bonus lines still win about 1.5 times their share against good opposition at 2 and 3 players. So this is not just a weakness of Smart Bot.

## Things that look like exploits

### 1. Factory Empire comes too easily (strong)
**The line.** Each round, put your meeple on a Mine's upgrade point. At the round end, use the credits to claim the cheapest unclaimed building with your lowest legal Control Module; one credit per claim at 1 Mine. You start with 2 buildings and need 4 more claims to reach 6. It does not matter whether those buildings ever produce anything.

**The numbers.**
- When style bots play, someone holds Factory Empire at the end of 93–100% of games.
- It changes hands less than once a game on average (0.2–0.8 times, run B): only a player with more buildings can take it away.
- Holding it at the end goes with winning 70% (2 players), 56% (3) and 31% (4) of the time (run B).
- The scripted Empire rush alone won 100% (2 players), 60% (3) and 38% (4) against Smart Bots (run E1; 20/30/40 games, seeds 10000–10009).

**Can a human do it?** Easily. It needs no board reading: an upgrade point is open most rounds, and the cheapest claim always fits the credits. It is a cheap "free Tesseract".

### 2. The Investor is a race to module 18 (strong at 2–3 players, contested)
**The line.** Pick your least useful building. Every round, put all free upgrades and all Mine-upgrade credits on it until it reaches 18. The building then never fires again, because no dice sum makes 13 or more with 2 Mines. A tie keeps the bonus with its holder, so the first to 18 owns it for the rest of the game.

**The numbers.**
- Someone held The Investor at the end of every game.
- It is first taken around round 6 and changes hands 2.8 / 4.0 / 5.1 times a game at 2 / 3 / 4 players (run B, as bots out-bid each other).
- The scripted Investor lock won 95% / 97% / 68% against Smart Bots (run E1).
- Against Planners it won only 63% / 28% / 21% (run E2), because Planners also climb.

**Can a human do it?** Yes. The cost is one building's production and the free upgrades. It is strongest when nobody else is racing.

### 3. Both bonuses plus two Tesseracts is the winning plan
**The numbers.**
- Of all four-Tesseract wins, the winner held **2 real + 2 bonus** in 58% (2 players), 49% (3) and 36% (4). Another 30% held 3 real + 1 bonus (run B).
- A win on 4 real Tesseracts and no bonus happened in 7%, 16% and 24% of those wins.
- The scripted "bonus rush" (both lines above, otherwise Planner) won 100% / 90% / 65% against Smart Bots, and 75% / 50% / 38% against Planners.

**What it means.** Making real Tesseracts is the hard part of the game (the first one arrives around round 14–17), and two of the four can be replaced by bonuses that need no production.

### 4. The second seat at 2 players (moderate, real)
Games between identical bots, so only the seat differs:

| Table | Games | 1st player wins | 2nd player wins |
|---|---|---|---|
| Planner × 2, seeds 30000–30149 | 150 | 35.3% (28–43) | **64.7%** (57–72) |
| Smart Bot × 2, seeds 30000–30119 | 120 | 42.5% (34–51) | 57.5% (49–66) |
| Planner × 3, 1st / 2nd / 3rd | 150 | 28.0% | 34.0% / 38.0% |
| Smart Bot × 3, 1st / 2nd / 3rd | 60 | 18.3% | 51.7% / 30.0% |
| Planner × 4 | 150 | 28.7% / 23.3% / 25.3% / 22.7% (no clear effect) | |

The starting player is at a disadvantage at 2 and 3 players.

I first suspected piece parity: 2-player stacks hold 63 pieces, which leaves 55 after setup, an odd number. Most 2-player Smart Bot games that run out of pieces end with the second player having had one more turn. But removing one blank from stack 3 (62 pieces) changed the Planner's figure only from 64.7% to 59.7% (300 games), within noise. So parity is not the main cause.

The likely cause is the turn order itself. The second player takes the first round-end turn of the game, which means the first claim with Mine credits and the first chance to declare a win. They also pick the first Power Plant in setup. Bots cannot separate these causes. A human who knows it cannot exploit it, but it makes 2-player games unfair.

### 5. Not exploits
- **Buying every Leverage card.** The Planner that buys a card whenever it can afford one won 0 of 324 games. It bought 16–26 cards a game and ended with about 5 points. Single cards are good value (Mine Inspection and Embezzlement always are), but money spent on cards is not spent on Tesseracts.
- **Rushing the next Mine.** Mine Rusher is about as strong as Planner. Bots bought Mine 2 in 0–50% of games depending on the table, and it arrived around rounds 4–7 either way.
- **Stalling.** No game hit the action limit. Every game ends: each turn takes a piece from the stacks, and nothing puts pieces back.
- **Belt Weaver** was rarely won (1–10% of games), even by the Bonus Hunter, which tries for it. An 8-belt chain needs a large board and several turns of belts. It looks hard enough as it is.

## Suggestions to try (numbers in `src/engine/config.ts`)

| Change | Measured effect |
|---|---|
| `BONUS_THRESHOLDS.factoryEmpire` 6 → 8 | Run D1 (324 games, same seeds as run E2). Empire is first taken about 4 rounds later (round 12–13 instead of 8–10). It is still held at the end of 76–94% of games. The Bonus Hunter's win rate did not change (83% / 47% / 31% vs 75% / 47% / 33%). **Not enough on its own.** |
| `STACK_COMPOSITION[2]` stack 3 blank 10 → 9 | Run D2 (300 Planner + 120 Smart Bot games). The second-seat edge stays (59.7% / 58.3%). **Does not fix the 2-player seat effect.** |

Not testable from `config.ts` today, but likely to matter:
- **What a Mine's upgrade point pays** (`UPGRADE_POINT_PER_MINE` and `UPGRADE_POINT_BONUS` in `src/engine/rules/mineRewards.ts`, outside `config.ts`). This point is the engine of both bonus lines. Moving these into `config.ts` would let the simulator test, for example, "claims cost one more credit".
- **The Investor tie rule.** It is a rule, not a number. Something like "the bonus moves to whoever matches the highest module most recently", or "a module of 13+ does not count", would end the race to 18.
- **`TESSERACTS_TO_WIN` 4 → 5,** so that two bonuses are not half the win. It is a plain number exported from config, so this simulator cannot change it at run time (see Method). It would need a code change to test.

## Engine problems found
No refused move and no unfinished game in 4,827 tournament games (every listed move was accepted; the bots only send listed moves, checked in tests). Three places where the engine and the documents disagree:

1. **Board exhaustion ends the game mid-round.** `RULES.md` says "if all pieces are played, finish the round". The engine instead ends the game at the end of the turn in which the last piece is placed (`src/engine/reducer.ts`, the END_TURN branch; its comment says this is on purpose, because the remaining players would have no piece to place). Players later in that round lose their last turn, and nobody gets that round's meeple payout. Measured (Planner tables, seeds 30000+): 55 of 76 board-exhaustion endings at 4 players ended mid-round, with 116 turns lost. At 3 players it was 20 of 32 with 30 turns lost. With Smart Bots at 2 players, all 45 of 80 games that ran out of pieces ended mid-round (seeds 30000–30079).
2. **Setup claim order.** `CLAUDE.md` says plate factories are claimed in reverse turn order and Power Plants in forward order. `RULES.md` and the engine do the opposite. Documentation only.
3. **Short Sale and Changing Priorities can put a module on a building another player has claimed.** That makes a co-owned building. A normal claim cannot do this ("only one player may own a building"). Bots did it 0.1–0.9 times a game. `RULES.md` does not say whether it is intended.

## Limits of the study
- All six styles share one decision procedure, so they differ in priorities, not in skill. A real human adapts to the table: blocks the opponent who is about to take Empire, or races The Investor only when needed. No bot does that. The exploit lines are probably weaker against alert humans than these numbers suggest, and stronger against beginners.
- Smart Bot, the baseline, is weak. Its look-ahead also sees the top card of the deck when it considers buying one (it applies the purchase to judge it), which a human cannot do. The style bots never read hidden order.
- Bots do not trade Power Tokens or talk, and they decide in fixed ways.
- Game counts per cell are 24–240. Differences under about 10 percentage points are mostly within noise.

## Method and how to repeat it
- `npm run sim -- …` (options at the top of `src/sim/cli.ts`):
  - `--mode field` puts each bot alone against a table of `--baseline` bots.
  - `--mode all` plays every table of distinct bots.
  - `--mode mirror` plays tables of one bot, to measure what each seat is worth.
  - `--jobs 4` splits a run over four processes.
  - `--out` writes every game as JSON.
- Each seating of a table replays the same seed: the same board, the same stacks and the same dice, which the runner rolls itself (a bot's own dice are ignored).
- Speed: 0.4 s per game for style-only tables and about 1–4 s with Smart Bots, on one process. The whole study took about 35 minutes of wall-clock time on four processes.
- Config variants and scripted lines are loaded with `--import file.ts`. A variant changes an object or array in `config.ts` in place, for that run only; plain numbers and functions exported from config cannot be changed this way. The scripted lines used here (Empire rush, Investor lock, bonus rush, buy every card) were throw-away files and are described above.
- Runs:

| Run | Games | Command |
|---|---|---|
| A | 864 | `--mode field --baseline greedy --seeds 16 --start 10000` |
| B | 861 | `--mode all --bots greedy,<six styles> --seeds 3 --start 20000` |
| C | 450 + 180 | `--mode mirror`, Planner 150 seeds and Smart Bot 60 seeds, from 30000 |
| D1 / D2 | variants | as described above |
| E1 / E2 | 360 / 648 | scripted lines against Smart Bots from 10000; against Planners from 50000 |
| F | 600 | `--mode all --bots <six styles> --seeds 4 --start 60000` |
