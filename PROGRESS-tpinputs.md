# Progress: wp/tpinputs (teleporters per input; Sink Hole belts to the bank)

Decisions
- State: `Buffer.teleporterOwner` -> `Buffer.teleporters: (PlayerId|null)[]` (index = slot; output uses 0; trailing nulls trimmed; [] = none). Helpers in src/engine/rules/teleporters.ts.
- Action: `PLACE_TELEPORTER` / R&D Tax Write-Off get `inputIndex` (absent = 0; canonicalAction fills 0).
- Saves: room format 2 (ROOM_FORMAT), legacy `teleporterOwner` migrated by withTeleporterSlots; PROTOCOL 2.
- Table: per-input spots (TELEPORTER_SPOTS in layout.ts); Tesseract meeple moved to model (17,-13).

Done (commits on wp/tpinputs)
- Engine, session, bots, table, play, guide figure plumbing; all existing tests pass; new tests: teleporterFlow (per input), teleporterSlots (session), teleporterInputs (play), teleporter clearance, pick, flowPath, analysis.

Left
- Docs: RULES.md, RULES_CHANGES.md #55 (+OQ-11 closed), guide topics/scene, What changed, PLAN.md, RULES_REVISION comment
- Sim after; screenshots; final checks; squash/clean commit A
- Part B: Sink Hole belts to bank (#56), own commit
