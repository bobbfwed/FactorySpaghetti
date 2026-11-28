# Bot findings: play styles, a tournament, and exploits

This is for the designer. It holds three studies, newest first:

1. **2026-11-28, the game under rules v0.70** (below): 10,974 seeded bot games on today's rules, with the rebuilt Smart Bot.
2. **2026-11-24**, on the rules as of `RULES_CHANGES.md` #50, before v0.70 (4,935 games). Its numbers are on the older rules.
3. **2026-11-28, the Smart Bot rebuilt** (at the end): how the new Smart Bot was made and measured.

Words used in every section:

- "95% CI" is the range the true rate very likely lies in (a 95% confidence interval, Wilson's method).
- An even share is 50% at 2 players, 33% at 3 and 25% at 4. "x share" is a win rate divided by the even share, so 1.0 is exactly fair.
- A **round** is every player's turn plus the round-end turns. A **turn** is one player's own turn (from the dice roll to the meeple); round-end turns are not counted.
- A **mirror game** has the same bot in every seat, so only the seat differs.

The reports behind every table are in [`docs/bot-study/`](bot-study/). The first study, run on the rules before #44–#50, is in this file's git history.

## 2026-11-28: the game under rules v0.70

Rules v0.70 (`RULES_CHANGES.md` #51–#58): a building's output feeds only its owner's buildings, a building has one owner, a building that loses its owner is emptied to the bank, Teleporters sit on one input each and cut belts off, and removed belts go back to the bank. The Smart Bot was rebuilt the night before and is now the strongest bot. Everything in this section was measured on 2026-11-28 on these rules; no rule, setting or bot was changed for it.

### Summary

1. **Game length has not changed.** A game takes a median of **22 rounds at 2 players, 21 at 3 and 20 at 4** (10th–90th percentile 16–26), that is about **42 / 60 / 76 turns** in all, or 19–22 turns per player. That holds whether Smart Bots, play-style bots or a mix sit at the table, and matches the old study (23 / 21 / 20 rounds). What the Smart Bot changes is *how* games end: among Smart Bots, **100% / 98% / 85%** of games end by four Tesseracts (2,400 games), against **94% / 80% / 57%** among play-style bots (2,700 games); the rest end on points when the stacks run out.
2. **Bonus Tesseracts make up 1.3–2.2 of the winner's 4 Tesseracts on average** (1.7–1.8 in the everyone-against-everyone run of 3,024 games; most with Smart Bots, fewest among play-style bots). The usual winning hand is **2 real Tesseracts + The Investor + Factory Empire** (44–61% of four-Tesseract wins). Among Smart Bots, **one game in four at 2 players (25%) and one in five at 3 players (19%) is won with a single real Tesseract plus all three bonuses.**
3. **No single Bonus Tesseract is far out of line in strength.** In Smart Bot mirror games (the fairest comparison: same bot everywhere), the winner holds The Investor in 70 / 61 / 46% of games, Factory Empire in 79 / 60 / 44% and Belt Weaver in 53 / 61 / 50% (2 / 3 / 4 players). Holding any one of them goes with a win rate 2.2–3.9 times that of players without it (correlation, not cause). The strongest is **Factory Empire at 2 players** (winner holds it 79%, 95% CI 76–82).
4. **Belt Weaver is the odd one out in how it is won.** Play-style bots, which do not plan for it, end with it in only 7–15% of games. Smart Bots, which plan for it, end with it in **67% / 89% / 91%** of games and take it early (round 10 / 7 / 6, earlier than Factory Empire at 3–4 players). Once taken it almost never changes hands (0.1–0.4 times a game, against 1.6–3.0 for The Investor and 1.1–2.2 for Factory Empire). It is the bonus that makes the one-real-Tesseract wins possible. Raising its chain from 8 to 10 belts (what-if, below) cuts how often it is held to 45 / 64 / 72% and makes games 0.3–0.7 rounds longer on average.
5. **The Investor and Factory Empire are taken in practically every game** (95–100%), The Investor by round 5–6 and Factory Empire by round 8–10. The Investor is a race: it changes hands 1.5–5.7 times a game.
6. **Seat order: no effect among play-style bots; a second-seat edge among Smart Bots.** In 900 mirror games per player count of the six styles the seats are within a few points of even. In 800 Smart Bot mirror games per player count the second player wins **55.3% at 2 players (95% CI 52–59), 40.5% at 3 (37–44) and 31.8% at 4 (29–35)**, and the fourth player at 4 only 18.9% (16–22). The edge runs through The Investor: identical bots reach Control Module 10 in the same round, and whoever has the first round-end turn in that round takes it (at 4 players the second seat is first to take it in 82% of games). A tie keeps it with its holder.
7. **The new Smart Bot is the strongest bot by far**: in the everyone-against-everyone run it wins 85.7% / 74.9% / 56.2% (1.7 / 2.2 / 2.2 times its share). Of the six styles only the Bonus Hunter keeps up (85.7% / 61.4% / 31.9%); among the styles alone it still wins 1.6–1.9 times its share, as in the old study. The classic Smart Bot wins 4–7%.
8. **The other levers.** Buying **Leverage cards** does not pay for any bot (the Smart Bot buys almost none; in mirror games card buyers win no more than the rest). **Buying a Mine** does not pay either: the buyer of Mine 2 or 3 wins at or below its share in every mirror set. Mine 2 enters play around round 4–7, Mine 3 around round 9–18, mostly dropped in when a stack runs out (bought in 17–50% of games). **Teleporters**: players who place none win more often; a Teleporter seems to be a repair for a poor layout, not a way to win. **Belts**: players who buy 4 or more belts win clearly more (they are the long-chain and Belt Weaver players). **The meeple** goes to a Mine's upgrade point (29–41%) or resource point (20–39%) in most turns; Sphere Factories get only 3–6%. **Power Tokens** are neither scarce nor piling up: a player starts a turn with about 5–6, 10–15% of turns start at the cap of 10, and at the end players hold 3–4 on average (a sixth to a third hold 0–1).
9. **Nothing broken.** 10,974 games (13,374 with the what-ifs): no unfinished game, no refused move, no bot error, no claim onto another player's building. No strategy wins far above its share by doing something degenerate; the strongest lines are the bonus lines, which are intended (OQ-10).

### The runs

All games use fresh seeds that no earlier study or tuning run used, every seat is rotated (or, in mirror games, every seat holds the same bot), and the dice come from a stream seeded by the game seed.

| Run | What | Seeds | Games (2p / 3p / 4p) | Report |
|---|---|---|---|---|
| R1 | Everyone against everyone: Smart Bot, the six styles, classic Smart Bot; every table of distinct bots, every seat | 1100000–1100503 | 336 / 1,008 / 1,680 | `R1-all-eight.txt` |
| R2 + R6 | Smart Bot mirror games | 1200000–1200399, 1210000–1210399 | 800 / 800 / 800 | `R2-mirror-smart.txt`, `R6-mirror-smart-more.txt` |
| R3 | Mirror games of each of the six styles (150 seeds each) | 1300000–1300149 | 900 / 900 / 900 | `R3-mirror-styles.txt` |
| R4 | One Smart Bot at a table of play styles, every seat | 1400000–1400149 | 300 / 450 / 600 | `R4-gauntlet-smart.txt` |
| R5 | The six styles only, everyone against everyone | 1500000–1500149 | 300 / 600 / 600 | `R5-styles-only.txt` |
| V1, V2 | What-ifs (Smart Bot mirror games, same seeds as R2) | 1200000–1200399 | 400 / 400 / 400 each | `V1-beltWeaver-10.txt`, `V2-factoryEmpire-7.txt` |

All tables below come from [`bot-study/2026-11-28/tables.md`](bot-study/2026-11-28/tables.md) and `tables-variants.md`, made by `analyze.ts` in the same folder.

### 1. Game length

Median rounds and turns per game, with the 10th–90th percentile in brackets.

| Table | 2 players | 3 players | 4 players |
|---|---|---|---|
| Smart Bots only (R2 + R6; 800 games each) | 22 (18–25) rounds; 42 (34–48) turns | 21 (18–24); 60 (51–69) | 20 (17–22); 76 (64–84) |
| One Smart Bot with play styles (R4; 300 / 450 / 600) | 20 (16–25); 38 (30–48) | 20 (16–23); 57 (45–66) | 20 (16–21); 76 (60–80) |
| Everyone against everyone (R1; 336 / 1,008 / 1,680) | 22 (18–26); 42 (34–50) | 21 (16–24); 60 (45–69) | 20 (16–22); 76 (60–84) |
| Play styles only, mixed (R5; 300 / 600 / 600) | 23 (18–26); 44 (34–50) | 21 (17–23); 60 (48–67) | 20 (17–21); 76 (64–80) |
| Play-style mirrors (R3; 900 each) | 22 (18–26); 43 (34–50) | 21 (18–24); 60 (51–69) | 20 (17–22); 76 (64–84) |
| Old study, run B, older rules (126 / 315 / 420) | 23 (18–27) rounds | 21 (17–24) | 20 (17–22) |

How games end (share ending by four Tesseracts, 95% CI; the rest end on points when the stacks run out):

| Table | 2 players | 3 players | 4 players |
|---|---|---|---|
| Smart Bots only | 99.9% (99–100) | 97.8% (96–99) | 84.6% (82–87) |
| One Smart Bot with play styles | 99.0% (97–100) | 92.0% (89–94) | 75.5% (72–79) |
| Everyone against everyone | 95.8% (93–98) | 87.3% (85–89) | 68.8% (66–71) |
| Play styles only, mixed | 94.7% (92–97) | 83.3% (80–86) | 62.2% (58–66) |
| Play-style mirrors | 94.0% (92–95) | 79.6% (77–82) | 56.9% (54–60) |
| Old study, run B | 91.3% (85–95) | 81.9% (77–86) | 55.0% (50–60) |

The length is set by the stacks: games that run to points end when the pieces run out (around round 20 at 4 players), and four-Tesseract wins arrive at about the same time. The first real Tesseract is made around round 13–17, as before.

### 2. How games are won

Of the four-Tesseract wins, how many of the winner's Tesseracts were real and which bonuses made up the rest:

| Table | Players | Wins | Real, mean | Bonus, mean | 4 real | 3 real + 1 bonus | 2 real + 2 bonus | 1 real + 3 bonus | Most common winning hands |
|---|---|---|---|---|---|---|---|---|---|
| Everyone against everyone (R1) | 2 | 322 | 2.24 | 1.76 | 4% | 25% | 62% | 9% | 2 real + Investor + Empire 61%; 3 real + Empire 14% |
| | 3 | 880 | 2.20 | 1.80 | 7% | 24% | 53% | 17% | 2 real + Investor + Empire 49%; 1 real + all three 17% |
| | 4 | 1,155 | 2.32 | 1.68 | 13% | 21% | 50% | 16% | 2 real + Investor + Empire 44%; 1 real + all three 16% |
| Smart Bots only (R2 + R6) | 2 | 799 | 1.97 | 2.03 | 0% | 21% | 54% | 25% | 2 real + Investor + Empire 27%; 1 real + all three 25% |
| | 3 | 782 | 2.16 | 1.84 | 3% | 29% | 49% | 19% | 1 real + all three 19%; 2 real + Empire + Belt Weaver 19% |
| | 4 | 677 | 2.38 | 1.62 | 6% | 39% | 42% | 13% | 2 real + Empire + Belt Weaver 16%; 3 real + Belt Weaver 15% |
| Play-style mirrors (R3) | 2 | 846 | 2.42 | 1.58 | 3% | 39% | 54% | 3% | 2 real + Investor + Empire 52%; 3 real + Empire 22% |
| | 3 | 716 | 2.63 | 1.37 | 10% | 47% | 38% | 5% | 2 real + Investor + Empire 35%; 3 real + Empire 26% |
| | 4 | 512 | 2.72 | 1.28 | 13% | 50% | 34% | 4% | 2 real + Investor + Empire 32%; 3 real + Empire 25% |

(Investor = The Investor, Empire = Factory Empire.) The old study found 2 real + 2 bonus in 36–60% of four-Tesseract wins and 4 real in 4–22%; that is about the same now.

Wins on points: the winner has a median of 62–78 resource points, the runner-up 54–60. No game ended in a shared win.

### 3. Each Bonus Tesseract

`src/engine/config.ts` lists three: **The Investor** (highest Control Module on a building, at least 10), **Belt Weaver** (longest belt chain, at least 8 belts) and **Factory Empire** (most buildings claimed, at least 6).

Measures, per Bonus Tesseract:
- **Held at end**: share of games in which someone holds it when the game ends.
- **Winner holds**: share of games in which the winner holds it.
- **First taken**: the round it was first taken (median, 10th–90th percentile), over the games in which it was taken.
- **Changes of hands**: how many times a game it moved from one player to another, on average.
- **Holder / non-holder win rate**: each player at the end of each game counts once; holders of the bonus are compared with everyone else. **This is correlation, not cause**: a player who is ahead tends to hold more of everything. "Lift" is the first rate divided by the second.

**Smart Bot mirror games** (R2 + R6, 800 games per player count). Every seat plays the same way, so this is the fairest comparison of the three:

| Players | Bonus | Held at end | Winner holds (95% CI) | First taken, round | Changes of hands | Holder wins (95% CI) | Non-holder wins | Lift |
|---|---|---|---|---|---|---|---|---|
| 2 | The Investor | 100% | 70.3% (67–73) | 5 (5–5) | 2.13 | 70.3% (67–73) | 29.8% | 2.4 |
| 2 | Factory Empire | 100% | **79.4%** (76–82) | 10 (9–11) | 1.14 | 79.4% (76–82) | 20.6% | **3.9** |
| 2 | Belt Weaver | 67.0% (64–70) | 53.0% (50–56) | 10 (7–14) | 0.10 | 79.1% (75–82) | 35.3% | 2.2 |
| 3 | The Investor | 100% | 60.6% (57–64) | 6 (5–7) | 1.62 | 60.6% (57–64) | 19.7% | 3.1 |
| 3 | Factory Empire | 100% | 59.8% (56–63) | 10 (9–11) | 1.87 | 59.8% (56–63) | 20.1% | 3.0 |
| 3 | Belt Weaver | 89.4% (87–91) | 60.5% (57–64) | 7 (5–12) | 0.33 | 67.7% (64–71) | 18.8% | 3.6 |
| 4 | The Investor | 100% | 45.5% (42–49) | 6 (6–6) | 3.01 | 45.5% (42–49) | 18.2% | 2.5 |
| 4 | Factory Empire | 100% | 43.8% (40–47) | 10 (9–10) | 2.15 | 43.8% (40–47) | 18.8% | 2.3 |
| 4 | Belt Weaver | 90.5% (88–92) | 50.2% (47–54) | 6 (4–9) | 0.43 | 55.5% (52–59) | 16.1% | 3.5 |

**Play-style mirror games** (R3, 900 games per player count):

| Players | Bonus | Held at end | Winner holds (95% CI) | First taken, round | Changes of hands | Holder wins (95% CI) | Non-holder wins | Lift |
|---|---|---|---|---|---|---|---|---|
| 2 | The Investor | 100% | 72.0% (69–75) | 6 (3–8) | 2.19 | 72.0% (69–75) | 28.0% | 2.6 |
| 2 | Factory Empire | 96.8% (95–98) | 75.1% (72–78) | 10 (8–14) | 0.46 | 77.6% (75–80) | 24.1% | 3.2 |
| 2 | Belt Weaver | 7.8% (6–10) | 5.1% (4–7) | 12 (7–15) | 0.01 | 65.7% (54–76) | 49.4% | 1.3 |
| 3 | The Investor | 100% | 51.0% (48–54) | 6 (4–8) | 4.54 | 51.0% (48–54) | 24.5% | 2.1 |
| 3 | Factory Empire | 99.4% (99–100) | 56.1% (53–59) | 8 (7–11) | 0.89 | 56.4% (53–60) | 21.9% | 2.6 |
| 3 | Belt Weaver | 13.7% (12–16) | 9.1% (7–11) | 9 (4–15) | 0.03 | 66.7% (58–74) | 31.7% | 2.1 |
| 4 | The Investor | 100% | 38.4% (35–42) | 6 (4–7) | 5.67 | 38.4% (35–42) | 20.5% | 1.9 |
| 4 | Factory Empire | 99.8% (99–100) | 38.3% (35–42) | 8 (7–10) | 0.95 | 38.4% (35–42) | 20.5% | 1.9 |
| 4 | Belt Weaver | 14.6% (12–17) | 6.6% (5–8) | 6 (3–12) | 0.04 | 45.0% (37–54) | 24.2% | 1.9 |

In the mixed tables (R1, R4, R5) the pattern is the same, with Belt Weaver held at the end of 12–21% (R1), 35–39% (R4, where one Smart Bot plays) and 7–14% (R5) of games. Holder win rates there are inflated by the stronger bots taking the bonuses (in R4 the holder of The Investor wins 95% of 2-player games), so the mirror tables above are the ones to compare.

**Ranking and judgement.**
- *Most decisive:* **Factory Empire**, mainly at 2 players (winner holds it 79%, lift 3.9 among Smart Bots; 75% and 3.2 among styles). At 3–4 players it is level with The Investor.
- *Most contested:* **The Investor**. It is taken in every game by round 5–6, changes hands 1.6–5.7 times, and its lift is among the lowest (1.9–3.1). It is a race, as before; it is not out of line.
- *Most uneven:* **Belt Weaver**. It is either ignored (7–15% with the style bots) or, by a player who plans for it, taken early and kept (Smart Bots: 67–91% held, 0.1–0.4 changes of hands, kept by its first holder in 58–86% of games). Per holder it is about as strong as the other two (lift 2.2–3.6). It is the one bonus that is close to "first come, kept", and the one that turns a single real Tesseract into a win.
- None is never taken, and none clearly dominates the other two. If one is to be watched in playtests, it is Belt Weaver: whether human players find the 8-belt chain as early as the Smart Bot does (round 6–10), and whether anybody ever takes it back.

### 4. Seat order (mirror games)

Win rate by turn position in the first round (1st = starting player), 95% CI:

| Table | Players | Games | 1st | 2nd | 3rd | 4th |
|---|---|---|---|---|---|---|
| Smart Bot × 2 | 2 | 800 | 44.8% (41–48) | **55.3%** (52–59) | | |
| Smart Bot × 3 | 3 | 800 | 29.0% (26–32) | **40.5%** (37–44) | 30.5% (27–34) | |
| Smart Bot × 4 | 4 | 800 | 26.9% (24–30) | **31.8%** (29–35) | 22.5% (20–26) | **18.9%** (16–22) |
| Six styles, pooled × 2 | 2 | 900 | 48.3% (45–52) | 51.7% (48–55) | | |
| Six styles, pooled × 3 | 3 | 900 | 31.9% (29–35) | 33.7% (31–37) | 34.4% (31–38) | |
| Six styles, pooled × 4 | 4 | 900 | 23.9% (21–27) | 25.7% (23–29) | 26.9% (24–30) | 23.6% (21–26) |
| Everyone against everyone (R1), all seats rotated | 2 / 3 / 4 | 336 / 1,008 / 1,680 | 46.1 / 31.5 / 25.2% | 53.9 / 32.7 / 26.0% | — / 35.7 / 24.8% | — / — / 24.1% |

Each style alone (150 games per player count) is listed in `tables.md`; the largest single gap is the Mine Rusher at 2 players (second seat 60.7%, 95% CI 53–68).

**Why the Smart Bot has a second-seat edge.** The turn order moves one seat each round, and the round-end turns are taken in the next round's order. Smart Bots all climb towards Control Module 10 at the same pace, so they reach it in the same round, and the player whose round-end turn comes first that round takes The Investor (a tie keeps it with its holder). At 4 players that round is usually round 6, where the second seat goes first: the second seat takes The Investor first in 82% of 4-player Smart Bot games, and Factory Empire first in 53%. Play-style bots climb at different paces and show no seat effect. With human players the same tie rule applies, so in a close race for The Investor the round-end order decides it; whether that adds up to a real seat edge depends on how evenly people climb.

Compared with the old study: the Planner's 2-player second-seat edge (58.7%) is gone among the styles (54.0%, 95% CI 46–62, on 150 games); the old Smart Bot's second-seat edge at 3–4 players (51.7% and 53.3% on 60 games) is smaller with the new bot but now clear on 800 games.

### 5. Who wins among the bots

Everyone against everyone (R1): every table of distinct bots among the new Smart Bot, the six styles and the classic Smart Bot, every seat; 84 / 378 / 840 games per bot at 2 / 3 / 4 players.

| Bot | 2 players | 3 players | 4 players | x share (2 / 3 / 4) |
|---|---|---|---|---|
| Smart Bot | **85.7%** (77–92) | **74.9%** (70–79) | **56.2%** (53–60) | 1.71 / 2.25 / 2.25 |
| Bonus Hunter | **85.7%** (77–92) | 61.4% (56–66) | 31.9% (29–35) | 1.71 / 1.84 / 1.28 |
| Mine Rusher | 57.1% (47–67) | 32.0% (28–37) | 24.3% (22–27) | 1.14 / 0.96 / 0.97 |
| Planner | 51.2% (41–62) | 30.7% (26–36) | 23.8% (21–27) | 1.02 / 0.92 / 0.95 |
| Card Shark | 50.0% (40–61) | 27.0% (23–32) | 24.6% (22–28) | 1.00 / 0.81 / 0.99 |
| Teleporter | 40.5% (31–51) | 18.3% (15–23) | 12.1% (10–15) | 0.81 / 0.55 / 0.49 |
| Hoarder | 26.2% (18–37) | 17.2% (14–21) | 20.4% (18–23) | 0.52 / 0.52 / 0.81 |
| Smart Bot (classic) | 3.6% (1–10) | 5.3% (4–8) | 6.7% (5–9) | 0.07 / 0.16 / 0.27 |

The six styles alone (R5; 100 / 300 / 400 games per style):

| Bot | 2 players | 3 players | 4 players |
|---|---|---|---|
| Bonus Hunter | **92.0%** (85–96) | **63.0%** (57–68) | **40.0%** (35–45) |
| Card Shark | 55.0% (45–64) | 29.0% (24–34) | 20.5% (17–25) |
| Planner | 46.0% (37–56) | 33.7% (29–39) | 25.0% (21–30) |
| Mine Rusher | 41.0% (32–51) | 29.7% (25–35) | 24.8% (21–29) |
| Teleporter | 40.0% (31–50) | 26.0% (21–31) | 14.8% (12–19) |
| Hoarder | 26.0% (18–35) | 18.7% (15–24) | 25.0% (21–30) |

One Smart Bot at a table of styles (R4) wins 90.0% (86–93) of 300 / 75.3% (71–79) of 450 / 54.2% (50–58) of 600 games, close to the 88.7 / 75.1 / 52.5% measured when it was built. Compared with the old study's run B, the Bonus Hunter is as strong as before (77.8 / 58.5 / 28.7% then); the Teleporter Bot has dropped (25.2% then, 18.3% now at 3 players), which fits the new per-input Teleporters cutting belts off.

### 6. The other levers

Per player, at the end of each game. All win-rate comparisons here are correlation, not cause.

**Leverage cards.** The Smart Bot buys almost none (0.02 per game; its tuning found that buying them freely made it weaker). The styles buy 1.7–3.5 a game. In the style mirror games (R3), players who bought none won 55% / 34% / 26% at 2 / 3 / 4 players, players who bought 3 or more 49% / 31% / 25%: buying cards neither wins nor loses games. The Card Shark wins about its share (0.8–1.1 times). No change from the old study.

**Mines 2 and 3.** When they enter play and whether buying one pays:

| Table | Players | Mine 2 enters, round | Bought (not dropped) | Buyer of Mine 2 wins | Mine 3 enters, round | Bought | Buyer of Mine 3 wins |
|---|---|---|---|---|---|---|---|
| Smart Bots only (800 each) | 2 | 7 (5–7) | 20% | 24.5% (19–32) | 18 (13–18), in 93% of games | 20% | 41.4% (34–49) |
| | 3 | 6 (4–6) | 17% | 32.8% (26–41) | 15 (11–15) | 22% | 19.8% (15–26) |
| | 4 | 5 (4–5) | 30% | 24.6% (20–30) | 12 (8–13) | 26% | 18.7% (14–24) |
| Play-style mirrors (900 each) | 2 | 6 (4–7) | 31% | 35.1% (30–41) | 15 (7–18), in 99% | 31% | 30.3% (25–36) |
| | 3 | 5 (3–6) | 47% | 28.4% (24–33) | 12 (6–14) | 28% | 18.0% (14–23) |
| | 4 | 4 (3–5) | 50% | 21.4% (18–25) | 10 (5–12) | 27% | 20.0% (15–26) |

The buyer wins at or below the even share almost everywhere (50 / 33 / 25%): the buyer pays, and every player gets the extra die and the new stack. Most Mines drop in when a stack runs out. Buying a Mine is not an exploit; if anything it is a slight handicap for the bots.

**Teleporters.** Players place 1.7–2.5 a game. In mirror games those who place none win more (Smart Bots: 76% / 57% / 37% with none, against 39% / 24% / 21% with two or more). A Teleporter looks like a repair for a building that belts and Mines cannot feed, so it marks a weaker layout rather than causing losses. The Teleporter Bot is the weakest style (0.5–0.8 times its share).

**Belts.** Smart Bots buy 3.5–4.7 belts a game beyond their 5 (removed belts now go to the bank) and end with 8–9 on the board; the styles buy about 1–1.5. Buying 4 or more goes with winning (Smart Bots: 64% / 44% / 30%; play-style mirrors: 60% / 40% / 29%), because those are the long-chain and Belt Weaver players.

**Where the meeple goes** (share of all placements; no player ever skipped the meeple):

| Table | Mine resource point | Mine upgrade point | Plate Factory | Sphere Factory | Tesseract Factory | Power Plant |
|---|---|---|---|---|---|---|
| Smart Bots only (2 / 3 / 4 players) | 21 / 24 / 24% | 41 / 37 / 33% | 6 / 7 / 7% | 6 / 4 / 4% | 11 / 12 / 14% | 16 / 15 / 17% |
| Play-style mirrors | 39 / 35 / 32% | 29 / 30 / 29% | 5 / 7 / 8% | 4 / 3 / 4% | 11 / 12 / 13% | 13 / 13 / 14% |

Every spot is used. The two Mine points take 57–68% of placements; the Sphere Factory is the least used (3–6%).

**Power Tokens** (cap 10):

| Table | Held at the start of a turn, mean | Turns begun at the cap | At the end, mean | Players ending at the cap | Players ending with 0–1 |
|---|---|---|---|---|---|
| Smart Bots only (2 / 3 / 4 players) | 5.7 / 6.1 / 6.1 | 12 / 15 / 14% | 3.1 / 3.9 / 4.2 | 1 / 4 / 5% | 30 / 20 / 17% |
| Play-style mirrors | 5.3 / 5.4 / 5.5 | 12 / 14 / 15% | 2.8 / 3.5 / 3.7 | 4 / 5 / 6% | 38 / 27 / 25% |

Power Tokens are spent, not hoarded: they are not scarce for most of the game, they run down towards the end (the last Tesseract runs cost power), and one turn in seven starts at the cap, where a Power Plant's output is partly lost.

### 7. Anything broken

- **No engine problem found.** In 10,974 games (13,374 with the what-ifs): no unfinished game (move limit 12,000), no refused move, no bot error.
- No claim onto another player's building (the one-owner rule, #57, holds).
- No degenerate strategy: the strongest lines are the bonus lines (the Smart Bot and the Bonus Hunter), which are intended. The extra statistics this study collects were checked not to change any game (see "How to repeat").

### 8. What-ifs (information only; no rule was changed)

Smart Bot mirror games on the same 400 seeds per player count as R2, with one bonus threshold changed for that run only (`docs/bot-study/2026-11-28/variant-*.ts`). The bots read the thresholds, so they adapt. Compare with R2 (the same seeds on today's rules).

| | Today (R2) | Belt Weaver needs 10 belts (V1) | Factory Empire needs 7 buildings (V2) |
|---|---|---|---|
| Belt Weaver held at the end, 2 / 3 / 4 players | 68 / 88 / 89% | **45 / 64 / 72%** | 68 / 87 / 90% |
| Winner holds Belt Weaver | 58 / 58 / 49% | 36 / 42 / 36% | 56 / 58 / 46% |
| Factory Empire first taken, round | 10 / 10 / 10 | 10 / 10 / 10 | 12 / 12 / 11 |
| Rounds, mean | 21.7 / 21.2 / 20.1 | 22.4 / 21.7 / 20.4 | 21.9 / 21.3 / 20.1 |
| Ended by four Tesseracts | 100 / 97 / 86% | 100 / 95 / 80% | 100 / 96 / 84% |
| Wins with 1 real + 3 bonuses (of four-Tesseract wins) | 27 / 17 / 12% | 18 / 15 / 8% | 28 / 16 / 12% |

- **Belt Weaver at 10 belts** takes it out of a fifth to a third of the games it is now held in and makes games 0.3–0.7 rounds longer on average, with slightly more games ending on points at 4 players. It does not change the other two bonuses.
- **Factory Empire at 7 buildings** only delays it by about two rounds; it is still held in every game, and nothing else moves. Like the old study's "8 buildings" variant, it changes little.
- The designer's aim is faster games; both variants make games slightly longer or leave them as they are.

### Limits of this study

- Bots are not people. All six styles and the Smart Bot share one decision procedure with different weights; they do not block a player about to take a bonus, trade, or talk.
- In mirror games the bots also move in step (the Smart Bot's second-seat edge comes from that), which real players will not.
- Holder-versus-non-holder win rates are correlation, not cause.
- Cells of 84–150 games (R1 at 2 players, single styles in R3) have intervals of about ±10 points.

### How to repeat

`npm run sim -- …` with the command at the top of each report in `docs/bot-study/2026-11-28/`, then `npx vite-node docs/bot-study/2026-11-28/analyze.ts -- Label=file.json …` on the saved games for the tables.

- New statistics collected for this study (`src/sim/tournament.ts`, `GameRecord.extra`): where each meeple went, Teleporters placed, belts bought, Power Tokens at each turn start and at the end, turns begun at the Power Token cap, Leverage cards played, belts on the board, buildings claimed and highest Control Module at the end. They only read the game. A before/after fingerprint of six seeded games (`fingerprint.ts`; `fingerprint-before.txt` and `fingerprint-after.txt`) is identical, so no game changed.
- `--import` now loads the file by its plain path; before, a path with a space (this repo's folder) could not be loaded.
- About 30 minutes of wall-clock time on 8 processes for all 13,374 games.

---

# The 2026-11-24 study, on the rules before v0.70

Everything from here to "2026-11-28: the Smart Bot rebuilt" is the 24 November study, on the rules as of `RULES_CHANGES.md` #50 (before #51–#58). Its Smart Bot is the one now called the classic Smart Bot.

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

# 2026-11-28: the Smart Bot rebuilt

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
