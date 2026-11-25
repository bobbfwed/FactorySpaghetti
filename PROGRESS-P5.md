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

## Runs
All ten runs are chained in one background job (script: scratchpad chain2.sh, 4 processes). Each finished run writes its report to `docs/bot-study/<run>.txt` and is committed on its own ("WIP: bot study run <run>"). Full per-game JSON is kept outside the repo (scratchpad runs2/). The throw-away scripted lines and config variants are in `docs/bot-study/scripts/` (loaded with `--import`).

Order: A-field, B-all, C-mirror-planner, C-mirror-greedy, E1-scripted-vs-smart, E2-vs-planners, D1-emp8, D3-up123 (upgrade point 1/2/3), D4-up123-emp8, F-styles. Status: check which `docs/bot-study/*.txt` exist (git log).

To redo any run: the command is at the top of its .txt file.
