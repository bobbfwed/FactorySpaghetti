# P8 progress (interface for RULES_CHANGES #44-#50)

Status: A, B, C, D, F done; next E (texts in words.ts/gameText.ts, Rules tab rules.ts, Game guide).

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
- A: supply chooser (controller promptsFor/supplyView/supplyOptions, round-end menu, ui/game/supply.ts, prompts.ts, popovers.ts, CSS, gameText operatePrompts/runLabel, gameView prompts). Tests: src/play/__tests__/supply.test.ts. awaitingInterface no longer hides supplied runs.

## Tests
Baseline `npx vitest run` on the untouched branch: running.
- B: cards in every step. controller `isExtraMode` + `buildExtra` (card, drone, drone placement,
  pi, menu, claim, upgrade) used by place/roll/meeple/actions steps; outside actions the step's
  targets are cleared while a card waits and come back after. Production Increase outside the
  actions step: default mode `pi` while `piActive`; re-entry via bank item `bank:pi` ("Spend
  Production Increase", shown as a button under "Upgrades" in your area). Hand reasons:
  `cardOwnTurnOnly`, `droneBeforeDraw`. After the meeple is down, the turn no longer ends by itself
  while a card can still be played (`meepleDoneCards`). awaitingInterface filter removed from
  helpers.ts; completeness/soundness pass. Tests: src/play/__tests__/steps.test.ts.
- D (part): bank Leverage card uses cardsLeftToDraw; detail shows deck and discard counts; roll
  step says when pieces ran out (`rollNoPieces`).
- C: Mine placement: already reachable (lit cell = larger half, rotations); test src/play/__tests__/mines.test.ts covers every listed BUY_MINE / PLACE_MINE incl. smaller-half-only ones. Instruction W.mineDropped / W.minePick say either half may touch.
- F: right after a purchase paid with change the controller's hint (shown as the table toast) says "Paid 3. You keep 1 Plate and 2 Ore." (controller `purchaseHint`, route buys in `layPlan`). Chips keep the tooltip. Test: paidKeep.test.ts.
- D: final-round note (`finalRoundNote` in turnBar.ts, desktop turn bar + phone step line; text view header), step 1 shown struck through "(none left)" when piecesExhausted, roll instruction `rollNoPieces`, phaseWords for the roll; game-over words say how it ended (controller + gameOverWords); reshuffle announced on the table (`reshuffledBy` in info.ts + announce strip in tableGameView.ts; the log line already existed in session/describe.ts). Bank card detail shows deck + discard counts. Tests: lastRound.test.ts.
