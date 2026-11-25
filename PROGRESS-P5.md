# P5 follow-up progress (re-run the bot study on the final rules, #44–#50)

## Done
- `git merge main` (fast-forward to ac4507b) and `npm ci` in this worktree.
- Style bots adapted (`src/bots/styles/styleBot.ts`):
  - Run-or-skip and round-end runs pick the best listed `OPERATE_BUILDING` (each supply weighed by what it hands over).
  - Power Plant decisions with no skip: the best run is taken.
  - Power Tokens are worth less the more the bot holds, so a Sphere is supplied to a Power Plant only when the bot is short of power and does not need the Sphere.
  - Card plays now listed in every step are filtered out of the place-piece and meeple choices.
  - The upgrade point's credits are taken per Mine (2/3/4).
  - Card buying also works from the refilled discard pile.
- `src/bots` and `src/sim` tests pass (58 tests); typecheck clean; lint 0 errors.

## Left
1. Re-run the study (same method). Results go to `docs/bot-study/*.txt|json` (summaries only).
2. Rewrite `docs/BOT_FINDINGS.md` from the new runs only.
3. Full checks (`npm test`, `npm run typecheck`, `npm run lint`, `npm run build`), then commit.

## Runs (planned; status below)
| Run | Command (`npm run sim -- …`) | Status |
|---|---|---|
| A field vs Smart Bot | `--mode field --baseline greedy --players 2,3,4 --seeds 16 --start 10000 --jobs 4` | pending |
| B all vs all | `--mode all --bots greedy,planner,mineRusher,cardShark,bonusHunter,hoarder,teleporter --seeds 3 --start 20000 --jobs 4` | pending |
| C mirror | `--mode mirror --bots planner --seeds 150 --start 30000` and `--bots greedy --seeds 60` | pending |
| E scripted lines | `--import` scratch files (Empire rush, Investor lock, bonus rush, buy every card) | pending |
| D variants | `MINE_UPGRADE_REWARDS` and `BONUS_THRESHOLDS` via `--import` | pending |
| F styles only | `--mode all --bots <six styles> --seeds 4 --start 60000 --jobs 4` | pending |
