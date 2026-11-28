# Ownership work package (in progress; delete when done)

Done:
- Engine: `rules/ownership.ts` (mayAddClaim, settleLostClaims, lossIfModuleLeaves); claim routes use mayAddClaim;
  settleLostClaims replaces returnOrphanedTeleporters in the reducer; unclaimed buildings feed nothing (directFlowAllowed,
  chain sources, output-teleporter drain); round-end meeple actions and runs need a claim.

Left:
- Engine tests (designerDecisions, beltPoints, designerDecisions2, legalActions, sim.test invariants, new ownership tests)
- Saves: checkGame refuses shared buildings ('shared-building'), replay/report/menu messages, session tests
- RULES.md section + consistency, RULES_CHANGES #57 #58, OQ-10 answer, BOT_FINDINGS note
- Interface: Changing Priorities warning + log line, card text, guide texts, What changed count
- Bots: forfeit cost in Changing Priorities weighing; co-owner remnants
- Sim before/after (before running/done in scratchpad/ownership)
