# Smart Bot improvement log

Started 2026-11-27 on branch `wp/bots`. The Smart Bot is the bot with id `greedy` (`src/bots/greedyBot.ts`, procedure in `src/bots/smart/`). The bot as it was before this work is kept in the simulator as `greedy-classic` (`src/bots/classic/`); the lobby does not offer it.

## Where I am / what is next

2026-11-28 02:15. Kept: attempt 1 (plan-following procedure), 3e (Bonus Hunter weights), 4d (closer), 5a (stronger bonus weights), 5e (Belt Weaver search budget, speed), 6d (teleporter appetite 0.2). The bot scores about 1.75 x share in the gauntlet. Running: sweep batch 7 (power value, look-ahead dice, meeple upgrade bias, bonus and Belt Weaver weights; on 5a/5e, seeds 403000) and batch 8 (card appetite 0.1 and 0, teleporter appetite 0.05; on 6d, seeds 404000). Next: keep the best, one more round on top if something qualified, then the final tables (`final.sh` in the scratchpad: fresh seeds from 900000), a quiet timing run, the BOT_FINDINGS section, and the full checks. Scratch files (candidate definitions `cand/*.ts`, run outputs) are in the session scratchpad `bots/` folder; `run.sh NAME CANDFILE SEEDS START BOTS` runs one paired batch.

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
