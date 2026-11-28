# Bot findings: play styles, a tournament, and exploits (final rules)

This is for the designer. It was written 2026-11-24 on the rules as of `RULES_CHANGES.md` #50, from 4,935 seeded bot games. Every number below comes from those games, and each figure says how many games it rests on.

- "95% CI" is the range the true win rate very likely lies in.
- An even share is 50% at 2 players, 33% at 3 and 25% at 4.

The reports behind every table are in [`docs/bot-study/`](bot-study/). The first study, run on the rules before #44–#50, is in this file's git history; what changed since is at the end.

## Summary

1. **The Bonus Tesseracts still decide the game.** 78–96% of the four-Tesseract wins in run B used at least one bonus. The usual winning hand is **2 real Tesseracts + The Investor + Factory Empire**. The style that goes for the bonuses, the Bonus Hunter, wins 1.6–1.8 times its share at 2 and 3 players, also against good opposition.
2. **The upgrade point is the lever.** It now pays 2 / 3 / 4 on Mines 1 / 2 / 3. Tried at 1 / 2 / 3 instead, the bonus lines lost most of their edge against a table of Planners: the bonus rush fell from 71% / 56% / 35% to 54% / 25% / 6% at 2 / 3 / 4 players. Raising the Factory Empire threshold from 6 to 8 instead did little.
3. **Factory Empire still comes easily.** When a style that wants it plays, someone holds it at the end of 92–100% of games. It is taken by round 8–12 and almost never changes hands.
4. **The Investor is still a race to module 18.** It changes hands 3–7 times a game until somebody reaches 18. A tie keeps it with its holder.
5. **The 2-player second-seat edge is smaller and only clear for one bot.** In Planner mirror games the second player wins 58.7% (150 games; 95% CI 51–66). In Smart Bot mirror games it is 50.0% (60 games).
6. **Not exploits:** buying every Leverage card (2 wins in 198 games); rushing the next Mine (no better than the Planner); stalling (no unfinished game, no refused move, in 4,935 games).

> **Designer's answer, 2026-11-27** (`RULES_CHANGES.md`, OQ-10): the weight of the Bonus Tesseracts (points 1–4 above, and the variants below) is by design. They exist to make the game faster, as easier ways to reach the Tesseract goal. The upgrade point amounts and the bonus thresholds stay as they are; an individual bonus may be tuned later if playtests show it is out of line.

## The bots

| Bot (lobby label) | What it does |
|---|---|
| Smart Bot | The existing one-move look-ahead bot, unchanged; the baseline. |
| Planner Bot | Plans ahead. It feeds its buildings from the Mines with belts, buys output teleporters early, picks Control Modules for the dice in play and the next Mine's, keeps the materials for its next Tesseract recipe, and meeples where the round end pays most. |
| Mine Rusher Bot | Planner that buys the next Mine whenever it can and plans for the bigger dice sums early. |
| Card Shark Bot | Planner that buys a card whenever the cards left are worth the price on average, and plays two a turn. |
| Bonus Hunter Bot | Planner that values each Bonus Tesseract above a real one. It uses Mine upgrade points to claim buildings, climbs one module towards 18, and tries long belt chains. |
| Hoarder Bot | Keeps materials for points, takes Mine resource points, and when ahead empties the shortest stack. |
| Teleporter Bot | Buys teleporters eagerly, so its meeple is free for the Mines. |

All six share one decision procedure (`src/bots/styles/styleBot.ts`). A style is a short list of weights (`profiles.ts`). They see only what a player at the table sees: never the order of the face-down stacks or of the deck.

On the final rules, every listed run of a building names what it takes from the inventory. The style bots weigh each option against what it hands over; Power Tokens are worth less the more a bot already holds.

- In 30 three-player style games, Tesseract Factories were fed from the inventory 80 times (for example Plate + Sphere).
- Power Plants were run 220 times and never given a material.

A decision typically takes well under a millisecond (the first study measured a median of 0.3 ms and a worst case of 53 ms in a 4-player game).

## Who wins

### Each style alone against a table of Smart Bots
Run A: 864 games, seeds 10000–10015, every seat rotated.

| Style | 2 players (32 games) | 3 players (48) | 4 players (64) |
|---|---|---|---|
| Bonus Hunter | **100%** (89–100) | 85.4% (73–93) | 42.2% (31–54) |
| Teleporter | 96.9% (84–99) | 83.3% (70–91) | 56.3% (44–68) |
| Mine Rusher | 93.8% (80–98) | 85.4% (73–93) | **68.8%** (57–79) |
| Planner | 87.5% (72–95) | **87.5%** (75–94) | 67.2% (55–77) |
| Card Shark | 81.3% (65–91) | 79.2% (66–88) | 64.1% (52–75) |
| Hoarder | 75.0% (58–87) | 68.8% (55–80) | 53.1% (41–65) |

Smart Bot won 10.9% / 9.2% / 13.8% of its games here. It does not build supply chains and never goes for Factory Empire, so "beats Smart Bot" proves little. The next tables pit the styles against each other.

### Everyone against everyone (six styles and Smart Bot)
Run B: 861 games, seeds 20000–20002, every table of distinct bots, every seat rotated.

| Bot | 2 players (36 games each) | 3 players (135) | 4 players (240) |
|---|---|---|---|
| Bonus Hunter | **77.8%** (62–88) | **58.5%** (50–67) | 28.7% (23–35) |
| Planner | 44.4% (30–60) | 40.7% (33–49) | 30.8% (25–37) |
| Mine Rusher | 55.6% (40–71) | 40.0% (32–48) | 26.3% (21–32) |
| Card Shark | 55.6% (40–71) | 39.3% (31–48) | 24.6% (20–30) |
| Teleporter | 58.3% (42–73) | 25.2% (19–33) | 23.8% (19–30) |
| Hoarder | 41.7% (27–58) | 25.2% (19–33) | **31.7%** (26–38) |
| Smart Bot | 16.7% (8–32) | 4.4% (2–9) | 9.2% (6–14) |

Run F, with the six styles only (600 games, seeds 60000–60003, 320 games per style), agrees:

| Bot | 2 players | 3 players | 4 players |
|---|---|---|---|
| Bonus Hunter | 80.0% (65–90) | 49.2% (40–58) | 31.3% (25–39) |
| Planner | 50.0% | 32.5% | 32.5% (26–40) |

At 4 players no style stands clearly above 25%. With more rivals the bonuses change hands more, and 45% of 4-player games end on points (run B), where the Bonus Hunter, which spends its materials, is weakest.

### The best lines against good opposition
Run E2: each bot alone at a table of Planners. 648 games, seeds 50000–50011.

| Bot | 2 players (24 games) | 3 players (36) | 4 players (48) |
|---|---|---|---|
| Bonus Hunter | 75.0% (55–88) | **63.9%** (48–78) | 35.4% (23–50) |
| Scripted bonus rush (below) | 70.8% (51–85) | 55.6% (40–71) | 35.4% (23–50) |
| Scripted Empire rush | 75.0% (55–88) | 47.2% (32–63) | 25.0% (15–39) |
| Scripted Investor lock | 62.5% (43–79) | 44.4% (30–60) | 25.0% (15–39) |
| Smart Bot | 8.3% (2–26) | 5.6% (2–18) | 12.5% (6–25) |
| Scripted "buy every card" | 0% (0–14) | 0% (0–10) | 0% (0–7) |

The bonus lines win 1.4–1.9 times their share against Planners at 2 and 3 players, so this is not only a weakness of Smart Bot.

## Things that look like exploits

### 1. Factory Empire comes too easily (strong)
**The line.** Each round, put your meeple on a Mine's upgrade point, which pays 2 credits at Mine 1. At the round end, claim the cheapest unclaimed building with your lowest legal Control Module. You start with 2 buildings and need 4 more claims to reach 6. It does not matter whether those buildings ever produce anything.

**The numbers.**
- When style bots play, someone holds Factory Empire at the end of 92–100% of games (runs A, B).
- It is first taken around round 8–12.
- It changes hands 0–0.6 times a game on average.
- Holding it at the end goes with winning 76% / 63% / 36% of the time at 2 / 3 / 4 players (run B).
- The scripted Empire rush alone won 100% / 93% / 63% against Smart Bots (run E1: 20 / 30 / 40 games, seeds 10000–10009).
- It won 75% / 47% / 25% against Planners (run E2).

**Can a human do it?** Easily. It needs no board reading.

### 2. The Investor is a race to module 18 (strong against players who ignore it)
**The line.** Pick your least useful building. Put every free upgrade and every upgrade-point credit on it until its module reaches 18. A tie keeps the bonus with its holder, so the first to reach 18 keeps it for the rest of the game.

**The numbers.**
- Someone held The Investor at the end of every game.
- It is first taken around round 6.
- It changes hands 2.8 / 4.5 / 5.0 times a game at 2 / 3 / 4 players (run B).
- The scripted Investor lock won 100% / 97% / 85% against Smart Bots (run E1), but 63% / 44% / 25% against Planners (run E2), who also climb.

### 3. Both bonuses plus two Tesseracts is the winning plan
**The numbers.**
- Of all four-Tesseract wins in run B, the winner held:

  | Hand | 2 players | 3 players | 4 players |
  |---|---|---|---|
  | 2 real + 2 bonus | 60% | 51% | 36% |
  | 3 real + 1 bonus | 30% | 28% | 32% |
  | 4 real, no bonus | 4% | 14% | 22% |

- The first real Tesseract arrives around round 14–17.
- The scripted bonus rush (both lines above, otherwise Planner) won 100% / 100% / 80% against Smart Bots (run E1) and 71% / 56% / 35% against Planners (run E2).

**What it means.** Two of the four Tesseracts can be bought with the meeple and the free upgrades instead of production. The upgrade point pays for both bonus lines.

### 4. Seat order
Games between identical bots, so only the seat differs:

| Table | Games | Win rate by turn position (1st = starting player) |
|---|---|---|
| Planner × 2, seeds 30000–30149 | 150 | 41.3% / **58.7%** (51–66) |
| Smart Bot × 2, seeds 30000–30059 | 60 | 50.0% / 50.0% |
| Planner × 3 | 150 | 34.7% / 33.3% / 32.0% |
| Smart Bot × 3 | 60 | 20.0% / **51.7%** (39–64) / 28.3% |
| Planner × 4 | 150 | 20.0% / 28.7% / 26.0% / 25.3% |
| Smart Bot × 4 | 60 | 23.3% / **53.3%** (41–65) / 10.0% / 13.3% |

In mixed tables (runs A, B, E2, F) the 2-player second seat won 50.8–56.9%.

The effect is small and depends on the bot. With Smart Bots at 3 and 4 players, the second seat stands out on only 60 games each, so it needs more games before acting on it. The starting player is never ahead.

### 5. Not exploits
- **Buying every Leverage card.** The Planner that buys a card whenever it can afford one won 2 of 198 games (runs E1, E2), ending with about 7 points.
- **Rushing the next Mine.** The Mine Rusher is about as strong as the Planner (runs B, F).
- **Stalling.** No game hit the action limit in 4,935 games. When the pieces run out, the round is now finished and every game ended.
- **Belt Weaver** was won in 0–18% of games, mostly by the Bonus Hunter, which tries for it. An 8-belt chain is hard enough.

## Variants tried (same seeds as run E2, against a table of Planners)

| Variant | Bonus Hunter (2p / 3p / 4p) | Scripted bonus rush (2p / 3p / 4p) | Planner (2p / 3p / 4p) |
|---|---|---|---|
| Final rules (run E2) | 75.0% / 63.9% / 35.4% | 70.8% / 55.6% / 35.4% | 51.4% / 31.9% / 25.9% |
| `BONUS_THRESHOLDS.factoryEmpire` 6 → 8 (run D1) | 75.0% / 52.8% / 37.5% | 87.5% / 63.9% / 31.3% | 41.7% / 30.1% / 24.8% |
| Upgrade point 2 / 3 / 4 → 1 / 2 / 3 (`MINE_UPGRADE_REWARDS`, run D3) | 62.5% / 33.3% / 20.8% | 54.2% / 25.0% / 6.3% | **58.3% / 39.4% / 29.9%** |
| Both changes (run D4) | 62.5% / 25.0% / 22.9% | 45.8% / 13.9% / 8.3% | **59.7% / 42.6% / 28.9%** |

Games per cell: 24 / 36 / 48 for the challengers, 72 / 216 / 432 for the Planners. The scripted bonus rush is written for 7 buildings, so it does not fully adapt to the threshold of 8.

- **Lowering the upgrade point by one** takes away most of the bonus lines' edge. At 3 players the Bonus Hunter drops from 1.9 to 1.0 times its share. The plain Planner, which builds production, gains.
- **Factory Empire at 8 alone** changes little.
- Both changes together are slightly stronger than the upgrade point alone.

## Engine problems found
- None. 4,935 games had no refused move and no unfinished game.
- The bots send only listed moves, which the tests check.
- The three points from the first study are settled: the game-end round is now finished (#44); Short Sale and Changing Priorities can no longer claim another player's building (#46; the bots made 0 such claims); and the setup claim order was confirmed.

## Limits of the study
- All six styles share one decision procedure, so they differ in priorities, not skill. Real players react to the table: they block the player about to take Factory Empire, and race The Investor only when needed.
- **Smart Bot**, the baseline, is unchanged and weak. It got weaker on these rules: 4.4% at 3 players in run B, against 16.3% in the first study.
  - It does not weigh what a run takes from its inventory.
  - Its look-ahead also sees the top card of the deck when it considers buying one, which a human cannot do.
- Bots do not trade Power Tokens or talk.
- The style bots never supply a Power Plant from the inventory. That is safe, but a human who is short of power might sometimes do better.
- Cells rest on 24–432 games. Differences under about 10 percentage points are mostly noise.

## Method and how to repeat it
`npm run sim -- …`; the options are listed at the top of `src/sim/cli.ts`.

| Option | What it does |
|---|---|
| `--mode field` | Each bot alone against a table of `--baseline` bots. |
| `--mode all` | Every table of distinct bots. |
| `--mode mirror` | Tables of one bot, to measure what each seat is worth. |
| `--jobs 4` | Four processes. |
| `--import file.ts` | Loads scripted lines or a variant. A variant changes an object or array tunable in place, for that run only. |

- Each seating of a table replays the same seed: the same board, stacks and dice, which the runner rolls itself.
- The whole study took about 25 minutes of wall-clock time on four processes.
- The scripted lines and variants are in `docs/bot-study/scripts/`. Each report in `docs/bot-study/` starts with its exact command.

| Run | Games | Report |
|---|---|---|
| A: styles against Smart Bots | 864 | `A-field.txt` |
| B: everyone against everyone | 861 | `B-all.txt` |
| C: mirror games, Planner 150 seeds and Smart Bot 60 seeds per player count | 450 + 180 | `C-mirror-*.txt` |
| E1: scripted lines against Smart Bots | 360 | `E1-scripted-vs-smart.txt` |
| E2: against Planners | 648 | `E2-vs-planners.txt` |
| D1 / D3 / D4: variants | 324 each | `D1-emp8.txt`, `D3-up123.txt`, `D4-up123-emp8.txt` |
| F: styles only | 600 | `F-styles.txt` |

## What changed since the first study (rules before #44–#50)

| Topic | First study | Final rules |
|---|---|---|
| Bonus lines | Bonus Hunter at 1.5 times its share at 2–3 players | Still the strongest, slightly more so: 1.6–1.8 times |
| Factory Empire | Easy | Still easy; the new upgrade point (2 / 3 / 4) keeps it cheap |
| The Investor race | A race to 18 | Unchanged |
| 2-player second seat | 64.7% (Planner) and 57.5% (Smart Bot) | 58.7% and 50.0% |
| Board exhaustion | Ended the game mid-round; up to 116 lost turns in 76 games | Fixed (#44): the round is finished |
| Smart Bot | Weak | Weaker |
| Upgrade-point variant | Could not be tested | Now testable; at 1 / 2 / 3 it is the change that most reduces the bonus lines |

## 2026-11-28: the Smart Bot rebuilt

The Smart Bot (lobby label "Smart Bot", id `greedy`, also the stand-in for a player who drops out) was rebuilt overnight. The full record of every attempt, with its command, numbers and decision, is in [`SMART_BOT_LOG.md`](SMART_BOT_LOG.md). The bot as it was is kept in the simulator only, as `greedy-classic`.

**How it was measured.** The bot under test sits alone at tables of the six play styles (one table per seed, cycled through every combination, every seat), and a candidate and the current bot play exactly the same games, so their difference is measured game by game. A change was kept only if the 95% interval of that paired difference lay wholly above zero over 1,080 game pairs. Four disjoint blocks of 100 seeds showed how noisy a single run is: the unchanged bot's 3-player win rate moved between 28.7% and 36.0% on seeds alone.

**What changed, in the order the changes were kept** (each measured on top of the ones before; "x share" counts a win as 2 / 3 / 4 at 2 / 3 / 4 players, so an even share is 1.0):

| Step | Change | Gain (x share, 95% interval) |
|---|---|---|
| 1 | Plan like a player instead of scoring every move one step ahead: the play styles' procedure, which values production from the dice odds, what actually reaches each input, and power | +0.90 (+0.76 to +1.05) |
| 2 | Go for the Bonus Tesseracts the way the Bonus Hunter does | +0.46 (+0.34 to +0.58) |
| 3 | One Tesseract from the win, the power and inputs for the last run are worth much more | +0.06 (+0.01 to +0.11) |
| 4 | Weigh The Investor (2.0) and Factory Empire above a real Tesseract, a building more | +0.11 (+0.03 to +0.20) |
| 5 | Weight sweep: teleporters bought more reluctantly | +0.15 (+0.08 to +0.21) |
| 6 | Weight sweep: Leverage cards bought only when clearly worth it | +0.13 (+0.04 to +0.22) |
| 7 | Weight sweep: less bias for the Mine upgrade point | +0.25 (+0.16 to +0.35) |
| 8 | Weight sweep: a Power Token worth 1.6, not 1.2 | +0.16 (+0.06 to +0.25) |
| 9–10 | Weight sweep: belt routes of at most 4 belts; Factory Empire back to 1.4 | +0.04 and +0.03 |

Tried and dropped (no gain, or worse): end-game thrift, valuing Power Tokens or materials at points only near the end, hurrying the end when ahead, planning the Mine credits as one combination (clearly worse), taking bonuses away from the leader, keeping drawn buildings away from opponents, an extra reward for locking The Investor at 18, more or fewer Mines, and several other weight steps.

**Results on fresh seeds** (seeds from 900000, which no attempt used):

### Against the play styles (gauntlet)

| Bot | 2 players | 3 players | 4 players |
|---|---|---|---|
| Smart Bot (new) | 88.7% (85–92), 300 | 75.1% (71–79), 450 | 52.5% (49–56), 600 |
| Smart Bot (classic) | 6.0% (4–9), 300 | 4.9% (3–7), 450 | 5.7% (4–8), 600 |

### By opponent style (games in which that style sat at the table)

| Style | new 2p | classic 2p | new 3p | classic 3p | new 4p | classic 4p |
|---|---|---|---|---|---|---|
| planner | 98.0% (90–100), 50 | 8.0% (3–19), 50 | 74.7% (67–81), 150 | 6.0% (3–11), 150 | 55.9% (50–61), 320 | 5.3% (3–8), 320 |
| mineRusher | 98.0% (90–100), 50 | 2.0% (0–10), 50 | 82.0% (75–87), 150 | 2.7% (1–7), 150 | 53.4% (48–59), 296 | 5.1% (3–8), 296 |
| cardShark | 90.0% (79–96), 50 | 0.0% (0–7), 50 | 76.0% (69–82), 150 | 6.0% (3–11), 150 | 53.7% (48–59), 296 | 5.7% (4–9), 296 |
| bonusHunter | 46.0% (33–60), 50 | 0.0% (0–7), 50 | 58.0% (50–66), 150 | 4.7% (2–9), 150 | 37.5% (32–43), 296 | 6.4% (4–10), 296 |
| hoarder | 100.0% (93–100), 50 | 22.0% (13–35), 50 | 80.0% (73–86), 150 | 4.0% (2–8), 150 | 55.4% (50–61), 296 | 6.4% (4–10), 296 |
| teleporter | 100.0% (93–100), 50 | 4.0% (1–13), 50 | 80.0% (73–86), 150 | 6.0% (3–11), 150 | 58.8% (53–64), 296 | 5.1% (3–8), 296 |

### Head-to-head, new against classic (share of games won by the new bot's seats; each fills half the seats)

| Players | Games | New wins | 95% CI | 2p seat order / 3–4p tables |
|---|---|---|---|---|
| 2 | 120 | 120.0 (100.0%) | 96.9–100.0% | new starting: 100.0% of 60; new second: 100.0% of 60 |
| 3 | 360 | 353.0 (98.1%) | 96.0–99.1% | new alone vs classics: 99.4% of 180; classic alone vs news: 3.3% of 180 |
| 4 | 480 | 439.0 (91.5%) | 88.6–93.6% | new alone vs classics: 91.7% of 240; classic alone vs news: 8.8% of 240 |

### Mixed field (new): every table of distinct bots among the six styles and the Smart Bot (new), every seat

| Bot | 2 players | 3 players | 4 players |
|---|---|---|---|
| greedy | 86.1% (71–94), 36 | 83.0% (76–88), 135 | 49.6% (43–56), 240 |
| bonusHunter | 80.6% (65–90), 36 | 52.6% (44–61), 135 | 31.3% (26–37), 240 |
| planner | 41.7% (27–58), 36 | 24.4% (18–32), 135 | 22.5% (18–28), 240 |
| mineRusher | 36.1% (22–52), 36 | 24.4% (18–32), 135 | 21.3% (17–27), 240 |
| cardShark | 44.4% (30–60), 36 | 18.5% (13–26), 135 | 17.5% (13–23), 240 |
| hoarder | 27.8% (16–44), 36 | 18.5% (13–26), 135 | 20.8% (16–26), 240 |
| teleporter | 33.3% (20–50), 36 | 11.9% (7–18), 135 | 12.1% (9–17), 240 |

### Mixed field (classic): every table of distinct bots among the six styles and the Smart Bot (classic), every seat

| Bot | 2 players | 3 players | 4 players |
|---|---|---|---|
| bonusHunter | 86.1% (71–94), 36 | 68.1% (60–75), 135 | 39.6% (34–46), 240 |
| planner | 55.6% (40–70), 36 | 37.8% (30–46), 135 | 30.4% (25–37), 240 |
| cardShark | 61.1% (45–75), 36 | 34.8% (27–43), 135 | 26.7% (21–33), 240 |
| mineRusher | 52.8% (37–68), 36 | 39.3% (31–48), 135 | 27.1% (22–33), 240 |
| hoarder | 44.4% (30–60), 36 | 23.0% (17–31), 135 | 27.5% (22–33), 240 |
| teleporter | 50.0% (34–66), 36 | 23.0% (17–31), 135 | 18.8% (14–24), 240 |
| greedy-classic | 0.0% (0–10), 36 | 7.4% (4–13), 135 | 5.0% (3–9), 240 |

### Stand-in: taking over a seat of a play-style table at a seeded move 150–450

| Bot | 2 players | 3 players | 4 players | unfinished | refused moves |
|---|---|---|---|---|---|
| greedy | 58.8% (48–69), 80 | 53.3% (44–62), 120 | 34.4% (27–42), 160 | 0 | 0 |
| greedy-classic | 33.8% (24–45), 80 | 17.5% (12–25), 120 | 13.1% (9–19), 160 | 0 | 0 |

**Against the target.** Against the play styles the new Smart Bot wins 88.7% / 75.1% / 52.5% of its 2 / 3 / 4-player games, about 1.8 / 2.3 / 2.1 times its fair share (50 / 33 / 25%), and in the mixed field it is first at every player count. It beats the classic bot in 100% / 98% / 92% of head-to-head games. The Bonus Hunter remains its hardest opponent (46% at 2 players, 58% at 3, 38% at 4 when the Bonus Hunter is at the table). As a stand-in taking over another bot's half-built position it wins 59% / 53% / 34% of those games, against 34% / 18% / 13% for the classic bot.

**What this says about the game.** The strongest bot found is a bonus chaser: it holds The Investor at the end of 67–88% of its games and Factory Empire in 58–86%, and wins almost every game by four Tesseracts, two of them usually bonuses. Buying Leverage cards and teleporters freely made it weaker. This agrees with the earlier study (the bonuses decide most games; buying every card is not an exploit), which the designer confirmed is intended.

**Speed.** On this machine, one process: median decision 0.1–0.2 ms, 95th percentile 1.3–3.1 ms, worst 29 ms (the classic bot: worst 134 ms).

**Engine problems found:** none. Over all runs of the night no game hit the move limit and no bot sent a move the engine refused.
