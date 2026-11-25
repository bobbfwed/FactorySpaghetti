// Config variant for this run only: upgrade point 1 / 2 / 3 and Factory Empire at 8 buildings.
import { MINE_UPGRADE_REWARDS } from 'C:/Apps/Factory Spaghetti/.claude/worktrees/p5-bots/src/engine/rules/mineRewards';
import { BONUS_THRESHOLDS } from 'C:/Apps/Factory Spaghetti/.claude/worktrees/p5-bots/src/engine/config';
const r = MINE_UPGRADE_REWARDS as number[];
r[0] = 1; r[1] = 2; r[2] = 3;
(BONUS_THRESHOLDS as { factoryEmpire: number }).factoryEmpire = 8;
export default [];
