// Config variant for one simulator run only (what-if, information only): Factory Empire needs 7 buildings instead of 6.
// Usage: npm run sim -- ... --import docs/bot-study/2026-11-28/variant-factoryEmpire-7.ts
import { BONUS_THRESHOLDS } from '../../../src/engine/config';
(BONUS_THRESHOLDS as { factoryEmpire: number }).factoryEmpire = 7;
export default [];
