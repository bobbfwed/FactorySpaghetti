# P8 progress (interface for RULES_CHANGES #44-#50)

Status: reading done, no code changed yet.

## Plan
- A supply chooser: Prompt/menu get a `supply` view (slots, materials, heading); one item per listed
  OPERATE_BUILDING. Ids: prompts `op:<piece>:run` (plain), `op:<piece>:run:<mat,mat>` (supplied),
  `op:<piece>:skip`; round-end menu `menu:run`, `menu:run:<mat,mat>`. Rendered by a new
  `src/ui/game/supply.ts` used by prompts.ts and popovers.ts. info.ts runPreview takes a supply.
  gameText.operatePrompts lists every listed option; labelFor names the supply.
- B cards in every step: card/drone/pi/menu/claim/upgrade modes handled in place/roll/meeple steps.
- C mine placement: check completeness covers lean-half placements.
- D final-round notice, cardsLeftToDraw, reshuffle announce.
- E texts, Rules tab, guide.
- F "You keep ..." visible after a purchase.

## Done
(nothing yet)

## Tests
Baseline `npx vitest run` on the untouched branch: running.
