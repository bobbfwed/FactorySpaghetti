// Config variant for one simulator run only (what-if, information only): The Investor needs Control Module 12 or higher instead of 10.
// Usage: npm run sim -- ... --import docs/bot-study/2026-11-28/variant-investor-12.ts
import { BONUS_THRESHOLDS } from '../../../src/engine/config';
(BONUS_THRESHOLDS as { investor: number }).investor = 12;
export default [];
