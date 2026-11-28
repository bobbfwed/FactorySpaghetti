# Smart Bot improvement log

Started 2026-11-27 on branch `wp/bots`. The Smart Bot is the bot with id `greedy` (`src/bots/greedyBot.ts`, procedure in `src/bots/smart/`). The bot as it was before this work is kept in the simulator as `greedy-classic` (`src/bots/classic/`); the lobby does not offer it.

## Where I am / what is next

Finished 2026-11-28. Kept: attempts 1, 3e, 4d, 5a, 5e, 6d, 7b, 8f, 9c, 10c, 11e. The final tables on fresh seeds are at the end of this file and in `docs/BOT_FINDINGS.md` (dated section). Improvements had levelled off (the last two rounds gained +0.04 and +0.03 x share), so I stopped. Open ideas not tried: a real search over the round-end combination of claims and upgrades (the simple version, 3g, was worse), opponent modelling for The Investor race, and a separate "easy" bot.

## What the Smart Bot does now

- **Draw and placement.** It draws from the stack whose remaining kinds it wants most (a Tesseract Factory while it has none, a Sphere Factory, a Power Plant when short of power), and puts the piece where its inputs face a Mine ore exit or a fitting output of its own buildings and its output faces one of its own inputs. A touching building of another player counts as neutral, since nothing crosses between players.
- **Claims and Control Modules.** At the round end it claims and upgrades by the change in what its modules are worth: expected runs over the remaining rounds (dice odds for each module with the current and, as the next Mine nears, the next number of Mines; numbers below the number of Mines never fire) × what a run is worth × how much of the recipe actually reaches the building (a Mine, its own building or belts, its own teleporter) × whether the output is carried away; plus the Bonus Tesseracts: The Investor (highest module, 10+; it climbs one module towards 18), Factory Empire (six or more buildings; one more building is worth extra), and its first Tesseract Factory.
- **Belts.** It lays a planned shortest route (from any Mine ore exit, any output of its own without a teleporter, or the open end of its own chain) to the most valuable input nothing feeds yet, at most 4 belts, continuing the same chain over several turns; and, for Belt Weaver, a deliberately long chain when it has the belts for one (search capped at 1,500 steps).
- **Meeple.** It goes where the round end pays most: collecting and running one of its own buildings (it completes a recipe from the inventory when the product is worth more than what goes in), a Mine's resource point, or a Mine's upgrade point (valued by the best claim or upgrade the credits buy).
- **Teleporters** (one per input): only where they add something — an input its belts and Mines do not reach, or the output of a building whose output nothing carries away — and reluctantly (appetite 0.2).
- **Leverage cards.** It rarely buys them (only when the cards left are worth well over the price on average); a card in hand is played when its exact effect is worth it (a claim by Short Sale, an upgrade with Production Increase, a teleporter by R&D Tax Write-Off, a Sphere, and so on).
- **Mines.** It buys the next Mine when the change of dice favours its modules over its opponents', it wants the stacks the Mine opens, and it can pay while keeping the materials for its next recipe.
- **Activated factories.** On a roll it runs a factory only when the product is worth more than the inputs and Power Tokens it uses, and chooses what a teleporter supplies.
- **One Tesseract from the win** it values Power Tokens and the last run's inputs much more.

## How every attempt is measured

**The yardstick.** The six play-style bots (Planner, Mine Rusher, Card Shark, Bonus Hunter, Hoarder, Teleporter), unchanged during this work apart from the Teleporter fix in their belt routes, which was made first, before any measurement.

**The test (`--mode gauntlet`).** The bot under test sits alone at a table of play-style bots: at 2 players against one style, at 3 against two, at 4 against three. Each seed uses one table of distinct styles (the tables are cycled in order, so every combination comes up equally often) and the bot under test sits in every seat of it. So one seed is 2 + 3 + 4 = 9 games.

**Paired.** The candidate and the current Smart Bot play exactly the same games: same seed (board, stacks and dice), same opponents in the same seats, same seat for the bot under test. The difference is measured game by game.

**The score.** A win counts as "times the even share": a win at 2 players is worth 2, at 3 players 3, at 4 players 4 (a shared win is split), so a bot exactly as good as its table scores 1.0 at every player count and every game weighs alike. The pooled score over all three player counts is the main number; the per-player-count rates are reported too.

**Noise** (measured before the decision rule was fixed): see the table below.

**Decision rule** (fixed after the noise measurement below, before any attempt after attempt 2 was judged):

1. Stage 1: the candidate and the current bot play the paired gauntlet on 120 seeds (1,080 pairs: 240 at 2 players, 360 at 3, 480 at 4). Tuning seeds start at 400000 and every stage uses a block not used before.
2. If the pooled paired difference is at or below 0, the candidate is **dropped**.
3. If the 95% interval of the pooled paired difference lies wholly above 0, the candidate is **kept**.
4. Otherwise (positive but the interval includes 0) it gets a stage 2 on 120 fresh seeds, and is kept only if the interval over both stages together (2,160 pairs) lies wholly above 0. No third stage.
5. A kept change must also not make any single player count clearly worse (its own 95% interval wholly below 0), must not cause a single unfinished game or refused move, and must keep the decision time within the limits (median under 25 ms, worst under 200 ms on this machine).
6. Several candidates may be measured in one run against the same current bot. Only the best qualifying one is kept; the others are measured again on top of the new bot, since changes interact.

The two-stage rule raises the chance of keeping a useless change somewhat above 2.5%; that is accepted for speed and stated here. The final tables are played on fresh seeds (from 900000) that no attempt used.

## Noise

The unchanged bot (attempt 1's version, which plays like the Planner) in the gauntlet on disjoint blocks of 100 seeds (900 games each: 200 at 2 players, 300 at 3, 400 at 4). `npm run sim -- --mode gauntlet --bots greedy --players 2,3,4 --seeds 100 --start S --jobs 4`, S = 200000, 201000, 202000, 203000; plus the same bot's games in two other runs.

| Seeds | 2 players | 3 players | 4 players | Pooled (x share, ± 95%) |
|---|---|---|---|---|
| 200000–200099 | 48.5% | 28.7% | 26.0% | 0.964 ± 0.097 |
| 201000–201099 | 51.5% | 32.7% | 26.8% | 1.031 ± 0.099 |
| 202000–202099 | 53.5% | 36.0% | 25.3% | 1.047 ± 0.098 |
| 203000–203099 | 54.0% | 35.0% | 27.5% | 1.079 ± 0.100 |
| 300000–300099 (attempt 2 run) | 51.5% | 32.3% | 23.8% | 0.974 ± 0.096 |

The same bot moves by 5.5 points at 2 players, 7.3 points at 3 players and 3.7 points at 4 players between seed blocks of this size (pooled 0.964 to 1.079), purely on the seeds. One block of 100 seeds cannot tell apart changes smaller than about 0.1 x share.

The paired test removes part of that: in attempt 2 (900 pairs) the 95% interval of the paired pooled difference was about ± 0.12 x share; the unpaired intervals of the two bots were each ± 0.10, so an unpaired comparison would have had about ± 0.14. The gain from pairing is modest because a changed decision soon makes the two games different; most of the noise is in the play itself, not in the seed.

## Randomness in the bots (checked 2026-11-28, on a note from the conductor)

What I found, by searching `src/` for `Math.random`:
- **The classic Smart Bot** (`greedyBot.ts` before this work) put `Math.random` dice into its roll request. Fixed at the start of this work (commit 99d27e8): its dice now come from the state (`styles/dice.ts` `stateDice`), as the style bots' already did.
- **Random Bot** (`randomBot.ts`) used `Math.random` both for its roll request and to pick its move. Now the move is picked by a generator seeded with a hash of the state, and the dice come from `stateDice`. Because the choice is a function of the state, taking back a belt laid this turn (which restores the state exactly) would make it lay the same belt again forever, so this-turn take-backs (`REMOVE_BELT` of a belt laid this turn, `UNDO_BELTS`) are left out of its choices when anything else is listed.
- `styles/dice.ts` and `styles/styleBot.ts` only *mention* `Math.random` in comments (saying it is not used). `src/table/botGame.ts` (the dev harness, left alone) already rolls seeded dice. `src/ui/game/sound.ts` uses it for a sound offset, which is not game state.

Where a bot's dice really come from:
- **Live game**: the host fills in the dice from the seeded stream in the room; a bot's roll request carries dice that are ignored (`hostSession.botStep` even sends `rolls: []` as its fallback).
- **Tournament runner** (`sim/tournament.ts` `playGame`): rolls from `diceStream(seed)` itself and never asks the bot.
- **Headless runner** (`sim/runGames.ts`, used by older engine tests): used the bot's own dice, so games of the classic Smart Bot and of Random Bot differed from run to run. Now it rolls from `diceStream(seed)` like the tournament.

Guards: `src/bots/__tests__/determinism.test.ts` plays the same seed twice for every bot kind (lobby and simulator-only) and checks the two games are identical, checks the same for `runGames`, and scans every source file in `src/bots` and `src/sim` (comments removed) for a call to `Math.random`.

**Does anything have to be re-measured?** No. Every measurement in this log was made with the tournament runner, which rolls the dice itself from the seed, and none of the bots measured (the play styles, the new Smart Bot, the classic Smart Bot) used `Math.random` for anything but the ignored roll request; Random Bot was never measured. The paired runs are reproducible: the determinism test confirms it for each bot.

Also from the note: the classic bot's `!claims.some(c => c.ownerId !== me)` (its `bestUnlockableClaimValue`) counts an unclaimed Tesseract Factory as one it could claim. That is what the function means ("a Tesseract Factory I may claim": unclaimed or already mine), so it is intended; the classic bot is kept frozen for comparison either way.

## Attempts

| # | What was tried | Command (seeds) | Before → after | Kept? |
|---|---|---|---|---|
| 1 | Replace the one-move look-ahead (score every legal move with a 7-term state score, take the best) with the plan-following procedure of the play-style bots, copied into `src/bots/smart/` with the balanced weights. This is the B4–B6 step of the plan in one go, because that procedure already scores expected production (dice odds for each Control Module with the current and the next number of Mines), supply connectivity (what reaches each input: a Mine, my own building, my own belts, my Teleporter, through the engine's own predicates) and power balance (a Power Token is worth more when short) — attempt 2 checks each part separately. | `--mode gauntlet --bots greedy,greedy-classic --seeds 60 --start 100000 --jobs 6 --timing` (540 pairs) | classic 0.198 → 1.102 x share; 2p 5.8% → 58.3%, 3p 6.1% → 36.1%, 4p 6.3% → 27.1%; paired difference +0.904 (95% +0.758 to +1.049) | **kept** |
| 2a | Ablation: expected production without the dice odds (every reachable sum equally likely) | `--mode gauntlet --bots greedy,no-dice,no-supply,no-power --seeds 100 --start 300000` (900 pairs each) | with 0.974 → without 0.730 x share; the dice odds are worth +0.244 (95% +0.122 to +0.367) | the feature stays |
| 2b | Ablation: supply connectivity off (every building counted as half fed) | same run | with 0.974 → without 0.847; worth +0.128 (95% +0.007 to +0.249) | the feature stays |
| 2c | Ablation: power balance off (a flat Power Token value) | same run | with 0.974 → without 1.042; worth −0.068 (95% −0.184 to +0.049) | not shown to help, not shown to hurt; left as it is (removing it would itself be a change that must clear the rule) |
| 3a | End-game thrift: in the last 1.5 rounds buy no belts, teleporters, cards or Mines | batch 1: `--mode gauntlet --bots greedy,thrift,epower,bonus,bonusfull,deny --import cand/batch1.ts --seeds 120 --start 400000 --jobs 6` (1,080 pairs each) | 0.988 → 0.975; candidate − current −0.013 (95% −0.037 to +0.011) | dropped (not better) |
| 3b | End-game power value: Power Tokens worth less as the board runs out (they score no points) | batch 1 | 0.988 → 1.019; +0.031 (95% +0.001 to +0.062) | qualified, but a smaller gain than 3e; measured again on top of 3e (attempt 4) |
| 3c | Bonus weights of the Bonus Hunter without Belt Weaver (Investor 1.5, Factory Empire 1.3, one more building worth 4, meeple upgrade point +3) | batch 1 | 0.988 → 1.331; +0.344 (95% +0.222 to +0.465) | superseded by 3e |
| 3d | Take a Bonus Tesseract away from another player: extra worth 0.5 × a Tesseract × (0.5 + 0.25 × their count) | batch 1 | 0.988 → 1.010; +0.022 (95% −0.035 to +0.079) | inconclusive; measured again on top of 3e |
| **3e** | **The Bonus Hunter's weights in full** (3c plus Belt Weaver 1.2: long chains, routes up to 6 belts) | batch 1 | 0.988 → **1.450**; **+0.462 (95% +0.341 to +0.583)**; 2p 49.6% → 82.1%, 3p 33.1% → 51.1%, 4p 24.6% → 32.3% | **kept** (commit 77aa802). Worst decision 175 ms in a 4-player game with the machine fully loaded; median 0.35 ms |
| 3f | Hurry when ahead: empty the shortest stack when 4+ points ahead | batch 2 (same seeds, paired with batch 1's games: `--merge b1.json,b2.json`) | 0.988 → 0.974; −0.014 (95% −0.073 to +0.046) | dropped |
| 3g | Plan the Mine credits: judge a claim together with the upgrade its leftover credits buy, against upgrades only | batch 2 | 0.988 → 0.867; **−0.121 (95% −0.218 to −0.024)**, 2p −10.8 points | dropped (worse) |
| 3h | End-game points: in the last round value materials at their points only | batch 2 | 0.988 → 0.965; −0.023 (95% −0.050 to +0.004) | dropped |
| 3i | Placement denial: keep a drawn building away from where it fits another player (weight 0.5) | batch 2 | 0.988 → 0.995; +0.007 (95% −0.072 to +0.087) | inconclusive; measured again on top of 3e |
| 4a | End-game power value (3b) again, on top of 3e | batch 3: `--mode gauntlet --bots greedy,epower,deny,placedeny,closer,bonusplus --import cand/batch3.ts --seeds 120 --start 401000 --jobs 7` | 1.440 → 1.422; −0.018 (95% −0.048 to +0.012) | dropped (its earlier small gain did not survive 3e) |
| 4b | Bonus denial (3d) again | batch 3 | 1.440 → 1.459; +0.019 (95% −0.001 to +0.040) | inconclusive; again on top of 4d |
| 4c | Placement denial (3i) again | batch 3 | 1.440 → 1.470; +0.031 (95% −0.051 to +0.112); at 4 players 27.9% → 31.9% (+4.0, 95% +0.3 to +7.7) | inconclusive; again on top of 4d |
| **4d** | **Closer**: holding 3 Tesseracts (real + bonus) and a Tesseract Factory, a Power Token is worth twice as much when short of the 3 the last run needs, and a missing Sphere / Plate for it is worth more | batch 3 | 1.440 → **1.501**; **+0.061 (95% +0.010 to +0.112)** | **kept** (commit 3703693) |
| 4e | Stronger bonus weights (Investor 2.0, Factory Empire 1.7, a building 5) | batch 3 | 1.440 → 1.519; +0.080 (95% −0.007 to +0.167) | inconclusive; again on top of 4d |
| 4f | Investor lock: extra 0.4 × the Investor's worth for reaching 18 while leading | batch 4 (same seeds, `--merge b3.json,b4.json`) | 1.440 → 1.488; +0.048 (95% −0.019 to +0.115) | inconclusive; again on top of 4d |
| 4g | End-game thrift (3a) again | batch 4 | 1.440 → 1.424; −0.016 (95% −0.030 to −0.002) | dropped (worse) |
| 4h | End-game points (3h) again | batch 4 | 1.440 → 1.348; **−0.092 (95% −0.127 to −0.056)** | dropped (worse: the bot needs its plan premium to the very end) |
| **5a** | **Stronger bonus weights** (4e) on top of 4d | batch 5: `--mode gauntlet --bots greedy,bonusplus,lock,placedeny,deny,weave1500 --import cand/batch5.ts --seeds 120 --start 402000 --jobs 8` | 1.468 → **1.580**; **+0.112 (95% +0.025 to +0.199)**; 3p +4.7, 4p +3.5 points | **kept** (commit 6b788f3) |
| 5b | Investor lock (4f) on top of 4d | batch 5 | 1.468 → 1.563; +0.095 (95% +0.026 to +0.165), but 2p −2.9 points (95% −5.6 to −0.2) | not kept: makes 2 players clearly worse (rule 5); again on top of 5a |
| 5c | Placement denial (3i, 4c) on top of 4d | batch 5 | 1.468 → 1.499; +0.031 (95% −0.048 to +0.111) | dropped: third inconclusive measurement |
| 5d | Bonus denial (3d, 4b) on top of 4d | batch 5 | 1.468 → 1.494; +0.026 (95% −0.000 to +0.052) | inconclusive (small but always positive); again on top of 5a |
| **5e** | **Belt Weaver search budget 1500 steps instead of 6000** (speed) | batch 5 | 1.468 → 1.465; −0.003 (95% −0.014 to +0.008) | **kept for speed** (commit 07d5c34): no measurable loss, and failed Belt Weaver searches were the slowest decisions |

### Weight sweep (each tunable one step up and one step down from the current bot)

| # | What was tried | Command (seeds) | Before → after | Kept? |
|---|---|---|---|---|
| 6a | Mine appetite 0.4 → 0.7 | batch 6: `--mode gauntlet --bots greedy,mine+,mine-,tele+,tele-,card+,card-,deny,lock --import cand/sweep1.ts --seeds 120 --start 403000 --jobs 8` | 1.610 → 1.601; −0.009 (95% −0.032 to +0.014) | dropped |
| 6b | Mine appetite 0.4 → 0.1 | batch 6 | 1.610 → 1.604; −0.006 (95% −0.016 to +0.003) | dropped |
| 6c | Teleporter appetite 0.5 → 0.8 | batch 6 | 1.610 → 1.569; −0.042 (95% −0.107 to +0.024) | dropped |
| **6d** | **Teleporter appetite 0.5 → 0.2** | batch 6 | 1.610 → **1.756**; **+0.146 (95% +0.084 to +0.208)**; 3p +6.1, 4p +4.8 points | **kept** (commit 2fd2f69) |
| 6e | Card appetite 0.35 → 0.6 | batch 6 | 1.610 → 1.466; **−0.144 (95% −0.216 to −0.073)** | dropped (worse) |
| 6f | Card appetite 0.35 → 0.1 | batch 6 | 1.610 → 1.747; +0.137 (95% +0.044 to +0.230); 4p +6.3 points | qualified, smaller than 6d; measured again on top of 6d |
| 6g | Bonus denial, fourth time | batch 6 | 1.610 → 1.617; +0.006 (95% −0.007 to +0.020) | dropped: never shown to help in four measurements |
| 6h | Investor lock, third time | batch 6 | 1.610 → 1.637; +0.027 (95% −0.041 to +0.094) | dropped: inconclusive again |
| 7a | Card appetite 0.35 → 0.1, on top of 6d | batch 8: `--mode gauntlet --bots greedy,card-,card0,tele0 --import cand/batch8.ts --seeds 120 --start 404000 --jobs 6` | 1.677 → 1.801; +0.124 (95% +0.034 to +0.214) | qualified; 7b slightly better |
| **7b** | **Card appetite 0.35 → 0** (a card is bought only when the cards left are worth more than 1.7 times the price on average) | batch 8 | 1.677 → **1.809**; **+0.132 (95% +0.041 to +0.224)**; 3p +6.4 points | **kept** (commit below) |
| 7c | Teleporter appetite 0.2 → 0.05 | batch 8 | 1.677 → 1.715; +0.038 (95% −0.012 to +0.088) | inconclusive; measured again on top of 7b |
| 8a | Power Token value 1.2 → 1.6 | batch 9: `--mode gauntlet --bots greedy,power+,power-,look+,look-,upg+,upg-,bonus++,weaver+,weaver-,tele0 --import cand/sweep2.ts --seeds 120 --start 405000 --jobs 8` | 1.821 → 1.955; +0.133 (95% +0.025 to +0.242) | qualified, smaller than 8f; again on top of 8f |
| 8b | Power Token value 1.2 → 0.9 | batch 9 | 1.821 → 1.773; −0.048 (95% −0.154 to +0.058) | dropped |
| 8c | Next-Mine dice look-ahead 0.5 → 0.9 | batch 9 | 1.821 → 1.844; +0.022 (95% −0.028 to +0.072) | dropped (inconclusive) |
| 8d | Next-Mine dice look-ahead 0.5 → 0.2 | batch 9 | 1.821 → 1.805; −0.017 (95% −0.057 to +0.024) | dropped |
| 8e | Meeple upgrade-point bias 3 → 5 | batch 9 | 1.821 → 1.648; **−0.173 (95% −0.262 to −0.084)** | dropped (worse) |
| **8f** | **Meeple upgrade-point bias 3 → 1** | batch 9 | 1.821 → **2.074**; **+0.253 (95% +0.161 to +0.345)**; 3p +5.3, 4p +10.4 points | **kept** (commit below) |
| 8g | Bonus weights up again (Investor 2.5, Factory Empire 2.1, a building 6) | batch 9 | 1.821 → 1.867; +0.045 (95% −0.032 to +0.122) | dropped (inconclusive) |
| 8h | Belt Weaver weight 1.2 → 1.6 | batch 9 | identical games (the weight above 1 changes no decision) | dropped |
| 8i | Belt Weaver weight 1.2 → 0.6 (no deliberate long chains) | batch 9 | 1.821 → 1.779; −0.043 (95% −0.146 to +0.061) | dropped |
| 8j | Teleporter appetite 0.2 → 0.05 (7c again) | batch 9 | 1.821 → 1.935; +0.114 (95% +0.060 to +0.168) | qualified, smaller than 8f; again on top of 8f |
| 9a | Meeple upgrade-point bias 1 → 0 | batch 10: `--mode gauntlet --bots greedy,upg0,upgneg,power+,tele0 --import cand/batch10.ts --seeds 120 --start 406000 --jobs 8` | 1.936 → 1.894; −0.042 (95% −0.112 to +0.029) | dropped |
| 9b | Meeple upgrade-point bias 1 → −1 | batch 10 | 1.936 → 1.840; −0.096 (95% −0.190 to −0.003) | dropped (worse) |
| **9c** | **Power Token value 1.2 → 1.6** (8a again) | batch 10 | 1.936 → **2.092**; **+0.156 (95% +0.060 to +0.251)**; 4p +5.6 points | **kept** (commit below) |
| 9d | Teleporter appetite 0.2 → 0.05 (third time) | batch 10 | 1.936 → 2.053; +0.117 (95% +0.069 to +0.165) | qualified, smaller than 9c; again on top of 9c |
| 10a | Teleporter appetite 0.2 → 0.05 (fourth time) | batch 11: `--mode gauntlet --bots greedy,tele0,power++,route4,route8 --import cand/batch11.ts --seeds 120 --start 407000 --jobs 8` | 2.087 → 2.106; +0.019 (95% −0.029 to +0.066) | dropped (its gain was taken by 9c) |
| 10b | Power Token value 1.6 → 2.0 | batch 11 | 2.087 → 2.117; +0.030 (95% −0.077 to +0.136) | dropped (inconclusive) |
| **10c** | **Belt routes of at most 4 belts instead of 6** | batch 11 | 2.087 → **2.130**; **+0.043 (95% +0.005 to +0.080)** | **kept** (commit below) |
| 10d | Belt routes of at most 8 belts | batch 11 | identical but for one game: +0.000 (95% −0.018 to +0.018) | dropped |
| 11a | Belt routes of at most 3 belts | batch 12: `--mode gauntlet --bots greedy,route3,breadth6,breadth4,inv1.6,emp1.4,nocloser --import cand/batch12.ts --seeds 120 --start 408000 --jobs 8` | 2.159 → 2.208; +0.049 (95% −0.000 to +0.098) | not kept: the interval touches 0 (stopped before a stage 2, see below) |
| 11b | One more building worth 5 → 6 | batch 12 | 2.159 → 2.074; −0.085 (95% −0.161 to −0.010) | dropped (worse) |
| 11c | One more building worth 5 → 4 | batch 12 | 2.159 → 2.122; −0.037 (95% −0.093 to +0.019) | dropped |
| 11d | The Investor weight 2.0 → 1.6 | batch 12 | 2.159 → 2.053; −0.106 (95% −0.194 to −0.019) | dropped (worse) |
| **11e** | **Factory Empire weight 1.7 → 1.4** | batch 12 | 2.159 → **2.192**; **+0.032 (95% +0.005 to +0.060)** | **kept** (commit 04eb859) |
| 11f | Check: closer (4d) switched off again, after all the weight changes | batch 12 | 2.159 → 2.156; −0.004 (95% −0.042 to +0.035) | closer stays: switching it off is not better (its effect is now too small to see) |

**Stopping.** The last two rounds gained +0.043 and +0.032 x share, against +0.13 to +0.25 for the sweep steps before them, and most candidates in them were dropped; the sweep has reached a plateau around these weights. The final tables below are played on fresh seeds (from 900000) that no attempt used.

## Final tables (fresh seeds, the bot as committed in 4407bf5)

Commands (all with `--jobs 8`):
- Gauntlet: `npm run sim -- --mode gauntlet --bots greedy,greedy-classic --players 2,3,4 --seeds 150 --start 900000` (2,700 games)
- Head-to-head: `npm run sim -- --mode h2h --bots greedy,greedy-classic --players 2,3,4 --seeds 60 --start 910000` (960 games)
- Mixed field: `npm run sim -- --mode all --bots planner,mineRusher,cardShark,bonusHunter,hoarder,teleporter,greedy --players 2,3,4 --seeds 3 --start 920000` and the same with `greedy-classic` (861 games each, the same seeds and tables)
- Stand-in: `npm run sim -- --mode takeover --bots greedy,greedy-classic --players 2,3,4 --seeds 40 --start 930000` (720 games)

Cells: win rate (95% Wilson interval), games. Every one of the 6,102 games finished (2,206 + 880 + 678 + 632 + 549 by four Tesseracts, the rest by the board running out); none hit the move limit and no bot sent a move the engine refused.

Paired, in the gauntlet: new minus classic +82.7 points at 2 players (95% +78.4 to +87.0), +70.2 at 3 (+65.9 to +74.6), +46.8 at 4 (+42.4 to +51.3); pooled 2.079 against 0.176 x share, +1.902 (95% +1.809 to +1.995), 1,350 pairs.

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

Stand-in, paired (the same game, the same seat, the same move to take over): new minus classic +25.0 points at 2 players (95% +15.5 to +34.5), +35.8 at 3 (+26.3 to +45.3), +21.3 at 4 (+12.8 to +29.7); 360 pairs. No stand-in game was left unfinished or had a refused move.

### Speed

One process on an otherwise idle machine, the gauntlet on seeds 940000–940005 with `--timing` (milliseconds per decision; decisions per own turn include the round-end turns' decisions):

| Bot | Players | Decisions | Median | 95th percentile | Worst | Decisions per turn |
|---|---|---|---|---|---|---|
| new | 2 | 1,929 | 0.13 | 1.30 | 11.3 | 8.3 |
| classic | 2 | 1,735 | 0.10 | 10.16 | 83.6 | 6.4 |
| new | 3 | 2,657 | 0.11 | 1.64 | 16.5 | 8.5 |
| classic | 3 | 2,342 | 0.08 | 12.34 | 116.2 | 6.6 |
| new | 4 | 3,751 | 0.18 | 3.14 | 29.4 | 8.9 |
| classic | 4 | 2,818 | 0.09 | 16.95 | 133.7 | 6.7 |

Twenty more 4-player games (the new bot against three styles) gave a median of 0.20 ms, a 95th percentile of 3.1 ms and a worst decision of 22.6 ms. On a machine running 12 simulator processes at once the worst decisions were several times slower (before attempt 5e and the memoised long-route search, failed Belt Weaver searches took up to about 560 ms there; after them the worst seen under that load was about 75 ms). The bot makes about 2 more decisions per turn than the classic bot: it takes more of the round-end steps (claims, Mine-credit upgrades, free upgrades, collect, run) one by one; it never repeats a move pair (no game stalled).

## After the review (2026-11-28): card purchases judged on public knowledge only

An independent review of the merge found one thing: the Smart Bot and the play-style bots valued a Leverage card purchase by averaging over the cards left in the deck. The deck's order was never read, but its contents are not public either, because the other players' hands are hidden. The bots now average over the deck and the other players' hands together (`cardsABuyMayBring` in `src/bots/styles/analysis.ts`), which is exactly what a player who watched the discard pile can know. Test: `src/bots/__tests__/hiddenCards.test.ts`.

The final gauntlet replayed on the same seeds (`npm run sim -- --mode gauntlet --bots greedy --players 2,3,4 --seeds 150 --start 900000`, 1,350 games, none unfinished, no refused move):

| | 2 players | 3 players | 4 players |
|---|---|---|---|
| Before the change | 88.7% | 75.1% | 52.5% |
| After the change | 88.7% (85–92) | 74.9% (71–79) | 51.8% (48–56) |

No measurable change. The other tables above were not rerun.
