# Ownership work package (in progress; delete when done)

Done (committed):
- Engine #57/#58 + tests + RULES.md/RULES_CHANGES.md + OQ-10 + BOT_FINDINGS note (233b0d5)
- Saves refuse shared buildings; replay/report/menu messages; tests (9660872)
- Interface: Changing Priorities warning + log line, card text, guide texts, What changed (+2, count 30)

Left:
- Bots: forfeit cost in Changing Priorities weighing; co-owner remnants (styleBot, tournament co-cl column)
- Sim after-run (before: scratchpad/ownership/before.log)
- Full checks: typecheck, lint, test, build
- Known conflict: src/table/__tests__/flowPath.test.ts (forbidden to me) pins unclaimed-source feeding (lines 63, 90)
