// Config variant for one simulator run only (what-if, information only): Belt Weaver needs a chain of 12 belts instead of 8.
// Usage: npm run sim -- ... --import docs/bot-study/2026-11-28/variant-beltWeaver-12.ts
import { BONUS_THRESHOLDS } from '../../../src/engine/config';
(BONUS_THRESHOLDS as { beltWeaver: number }).beltWeaver = 12;
export default [];
