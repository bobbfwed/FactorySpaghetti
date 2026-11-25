// Config variant for this run only: a Mine's upgrade point pays 1 / 2 / 3 credits instead of 2 / 3 / 4.
import { MINE_UPGRADE_REWARDS } from 'C:/Apps/Factory Spaghetti/.claude/worktrees/p5-bots/src/engine/rules/mineRewards';
const r = MINE_UPGRADE_REWARDS as number[];
r[0] = 1; r[1] = 2; r[2] = 3;
export default [];
