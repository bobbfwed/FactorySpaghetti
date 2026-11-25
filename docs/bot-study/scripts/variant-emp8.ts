// Config variant for this run only: Factory Empire needs 8 buildings instead of 6.
import { BONUS_THRESHOLDS } from 'C:/Apps/Factory Spaghetti/.claude/worktrees/p5-bots/src/engine/config';
(BONUS_THRESHOLDS as { factoryEmpire: number }).factoryEmpire = 8;
export default [];
