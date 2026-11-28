# Smart Bot improvement log

Started 2026-11-27 on branch `wp/bots`. The Smart Bot is the bot with id `greedy` (`src/bots/greedyBot.ts`, procedure in `src/bots/smart/`). The bot as it was before this work is kept in the simulator as `greedy-classic` (`src/bots/classic/`); the lobby does not offer it.

## Where I am / what is next

(updated as I go)

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

## Attempts

| # | What was tried | Command (seeds) | Before → after | Kept? |
|---|---|---|---|---|
| 1 | Replace the one-move look-ahead (score every legal move with a 7-term state score, take the best) with the plan-following procedure of the play-style bots, copied into `src/bots/smart/` with the balanced weights. This is the B4–B6 step of the plan in one go, because that procedure already scores expected production (dice odds for each Control Module with the current and the next number of Mines), supply connectivity (what reaches each input: a Mine, my own building, my own belts, my Teleporter, through the engine's own predicates) and power balance (a Power Token is worth more when short) — attempt 2 checks each part separately. | `--mode gauntlet --bots greedy,greedy-classic --seeds 60 --start 100000 --jobs 6 --timing` (540 pairs) | classic 0.198 → 1.102 x share; 2p 5.8% → 58.3%, 3p 6.1% → 36.1%, 4p 6.3% → 27.1%; paired difference +0.904 (95% +0.758 to +1.049) | **kept** |
| 2a | Ablation: expected production without the dice odds (every reachable sum equally likely) | `--mode gauntlet --bots greedy,no-dice,no-supply,no-power --seeds 100 --start 300000` (900 pairs each) | with 0.974 → without 0.730 x share; the dice odds are worth +0.244 (95% +0.122 to +0.367) | the feature stays |
| 2b | Ablation: supply connectivity off (every building counted as half fed) | same run | with 0.974 → without 0.847; worth +0.128 (95% +0.007 to +0.249) | the feature stays |
| 2c | Ablation: power balance off (a flat Power Token value) | same run | with 0.974 → without 1.042; worth −0.068 (95% −0.184 to +0.049) | not shown to help, not shown to hurt; left as it is (removing it would itself be a change that must clear the rule) |
