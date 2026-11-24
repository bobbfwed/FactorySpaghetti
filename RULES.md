> Authored by Brandon Nimon. This reflects v0.61 **with all confirmed changes applied.** Where a value is "tunable," it lives in `config.ts`.

## Components (per player)
- 18 **Control Modules** (numbered 1–18) — *formerly "Number Tiles."*
- 1 meeple, 3 Power Tokens, 5 belts, **4 teleporters**.

## Board pieces & stacks
99 pieces: 3 Mines (double-size), 19 Plate factories, 13 Sphere factories, 9 Tesseract factories, 12 Power Plants, 43 blank/belt pieces. Split into three face-down stacks; stacks 2 and 3 sit under mines 2 and 3 and are unavailable until that mine is in play. **Stack composition is a tunable config table** (the v0.61 numbers are the starting point; see `RULES_CHANGES.md` #13).

## Materials & values
Ore 1 · Plate 3 · Sphere 7 · Tesseract 23. Inventory cap: 6 per material; Power Tokens cap 10.

## Turn structure
1. Draw and place a board piece. The stacks are face down. If more than one stack is open (unlocked and not empty), first choose one and draw from it — the choice is final — then place its top piece adjacent to the board, in any orientation. If only one stack is open, there is no choice: place its top piece directly. A dropped Mine waiting to be placed replaces this step (see Mines). *(Draw step: `RULES_CHANGES.md` #33.)*
2. Roll dice — **one die per mine on the board.**
3. Actions: buy/place belts, buy cards/mines, place teleporters, exchange with bank. If the roll activated a factory of yours, first decide whether to run or skip it (see Production) — nothing else can be done on your turn until you have.
4. Place meeple (on an owned building, or a mine point) — once, and before the turn may end (unless there is nowhere it may go).
Cards may be played anytime on your turn (max 2/turn, play-on-draw cards included — see Leverage cards); any number may be purchased.
At **round end**, each player takes a turn to claim buildings / upgrade Control Modules / operate their meeple building. This turn is time-limited (host-adjustable, default **20 s**, resets on each action) so an idle player can't stall the table; on timeout it auto-ends.

## Production
- A roll activates **all** buildings (any owner) whose Control Module equals the dice sum — on **anyone's** turn (this is what lets teleporters and cross-turn play work).
- **Operating an activated factory is the OWNER's choice, not automatic.** When your factory is activated (even on another player's turn), you are prompted to **operate** (pay the power + consume the inputs) or **skip** — so a roll can never spend your power/materials without consent. In multiplayer there is a host-adjustable timeout (default **8 s**); if you don't respond it defaults to **operate** when affordable, else skip. Power Plants are exempt — they auto-operate (there's no downside to gaining tokens). On your own turn this decision comes first: until every activated factory of yours is run or skipped, you can do nothing else (`RULES_CHANGES.md` #40).
- To operate a factory: required inputs present in input buffer + pay **1 Power Token per input consumed** (Plate=1, Sphere=2, Tesseract=3). All inputs consumed; product goes to **output buffer** (holds 1 at a time).
- Power Plants: no power cost; rolling their number yields ≥1 Power Token. If a material sits in input, it's consumed for more tokens per the 1/2/5/10 chart (Tesseracts may **not** be used in a Power Plant).
- Output buffer full + same number rolled again = no new production.
- Produced material **stays in the output buffer** — it is never automatically banked. It is inaccessible to the owner **unless** they have their meeple on that building this round **or** a teleporter on its output (see below).
- With a meeple on the building this round, collecting the output buffer into inventory is **optional**: the player may collect it (respecting caps), only load inputs from inventory, or do neither. Uncollected output remains in the buffer (and may flow to a connected building's input). Input buffers are never "collected" — only the output buffer is.

## Factories (recipes)
The exact valid input sets (the single source of truth is `config.FACTORY_RECIPES`; the
same table governs both what may be **loaded** into an input buffer and what allows a
factory to **operate**):
- **Plate:** Ore → 1 Plate.
- **Sphere:** (Ore + Plate) or (Plate + Plate) → 1 Sphere.
- **Tesseract:** (Ore + Plate + Sphere) or (Ore + Sphere + Sphere) or (Plate + Sphere + Sphere) or (Sphere + Sphere + Sphere) or (Plate + Plate + Sphere) → 1 Tesseract.
- Input slots are interchangeable (order doesn't matter; inputs are matched as a set).
- A material may only be **loaded** into an input if doing so keeps a valid recipe reachable
  (e.g. you cannot load a second Ore into a Sphere Factory — there is no Ore+Ore recipe).

## Material flow
- **Direct adjacency:** output of one piece touching the input of another moves material for free.
- **Belts:** a belt links two connection points (holes) *on one piece* — it never bridges pieces; belts chain across a shared edge, where a point on one piece lines up with the point on the next. Valid placement requires the two ends separated by **more than two** connection points, and each connection point holds one belt.
  - **Connection points follow the printed pieces** (`RULES_CHANGES.md` #30). A blank piece has all 12. On a building piece every hole that is not an input or output is a belt point, usable by **any** player whoever has claimed the building (a claim never closes the belt points on the building's own piece): Plate Factory and Power Plant #3–#6 and #9–#12; Sphere Factory #4–#6 and #10–#12; Tesseract Factory #4, #5, #10, #11 (#1 = left edge, lower point, counting clockwise). A Mine has no holes, so no belt lies on a Mine, but a belt end on a neighbouring piece may face a Mine's ore exit.
  - **Material flow:** material moves along a chain of one or more belts from a source (a Mine ore exit, or a building's output) to a **claimed** building's input. A belt that connects nothing is still a legal placement (`RULES_CHANGES.md` #34). Belts of different players never join, so every chain belongs to one player.
  - **An opponent's belt does not feed your building, and does not draw from it.** A belt end that faces, across a shared edge, the input or output of a building that has at least one claim and none of them the belt owner's is a **dead end**: no material enters or leaves the belt chain through that end. The belt works again as soon as its owner gains a claim on that building, or the building becomes unclaimed. An output touching an input directly (no belt) still moves material, whoever owns the two buildings (`RULES_CHANGES.md` #38).
  - **Placement limits:** a belt end may **not** face, across a shared edge, (a) the input or output of a building that has at least one claim and none of them yours — those points are **reserved for the building's owners** (a co-owner may use them; anyone may while the building is unclaimed; `RULES_CHANGES.md` #31), nor (b) **another player's belt**. A belt is never removed when the claims on a building change later (in either direction: when another player claims the building after the belt was laid, or when the belt's owner loses or moves their claim, for example with Changing Priorities); it stays where it is, as a dead end at that point while the rule above applies.
  - **One Mine belt per turn:** only one belt with an end facing a Mine **ore exit** may be placed per turn. A belt end facing a part of a Mine without an exit (such as the lean half of Mines 2 and 3) does not count (`RULES_CHANGES.md` #39).
  - Belts are purchasable (cost 1) and freely removable by their owner (returned to the supply).
- **Teleporters (NEW):** 4 per player, placed on a buffer of a building **you own**. A player can never remove one by choice. One teleporter per buffer (both buffers of a building = 2 teleporters).
  - **Teleporters come back when the claim is lost:** as soon as you no longer hold any claim on a building (for example, Changing Priorities moved your last Control Module off it), every teleporter of yours on that building returns to your supply and its buffer has no teleporter any more. Material in the buffers stays where it is. This is the only way a teleporter leaves the board (`RULES_CHANGES.md` #37).
  - On an **input** buffer: your inventory may feed that building's required inputs **when the building needs them to operate, at any point during anyone's turn.**
  - On an **output** buffer: material in that buffer goes to your inventory (bypasses the meeple-access rule), respecting the 6-per-material cap. This happens the instant it's produced **and** continuously drains the buffer whenever your inventory has room — so material never sits stuck under a teleporter (e.g. produced before you placed it, or overflow from when you were at cap). Only true overflow (inventory at cap) stays in the buffer, until room opens up.
  - **Cost = (teleporters currently on the board, all players) + 1.** So 1, 2, 3, … globally, and the price drops again when a teleporter returns to its owner.

## Buildings: claiming & upgrading
- **Control Module upgrades are a currency** earned only from meeple on mine upgrade points, the end-of-round free upgrades (**= #mines**, usable only to raise one in-play module), or cards (e.g. Production Increase). **Upgrades are never bought with materials** — there is no mechanism to exchange ore (or any material) for module upgrades.
- **Upgrade:** swap a building's module for a higher available one; cost = numeric difference, paid from upgrade-currency.
- **Claim:** place an available module on an unclaimed building; initial value = **#mines** (so "1" is unusable at 2 mines, etc.). Claiming and upgrading combine: placing module *M* costs **(M − #mines + 1)** upgrade-units, paid from the Mine upgrade point's credits (one free claim at round end) or from Production Increase (one claim on that turn) — a claim is never free of charge (`RULES_CHANGES.md` #43). A building may be claimed up to **3 times** by the same player.

## Mines (CHANGED)
- Mine count drives: dice count, card price, claim floor, end-of-round upgrades, and card scaling.
- A mine may still be **purchased** (2nd = 6, 3rd = 18 — *price tunable*) and placed immediately.
- **NEW:** the next mine **auto-drops when the current stack is exhausted**, which also unlocks that mine's stack. Either path (buy or auto-drop) advances mine count identically.
- A Mine is placed with its **rich hex** next to the board; its lean hex may point any way that is free (`RULES_CHANGES.md` #43).
- A mine is a double-hex piece (a rich hex + a lean hex sharing one internal edge). Ore exits at its **ore-output** points, where the printed rays and tracks reach the edge: **every** mine's rich hex has exits on both points of all 5 external edges. Only **Mine 1's lean hex** has exits — 3 of them, one on every-other external edge (#4, #8, #12 counting from the shared edge; `RULES_CHANGES.md` #17). **Mines 2 and 3 have no exits on their lean hex** (`RULES_CHANGES.md` #32). Belts never lie on a mine (it has no holes); ore flows from an exit to a directly adjacent input, or into a belt chain whose end faces the exit.

## Purchases & costs
- Belt: 1. Teleporter: teleporters on the board + 1. Mine: 6 / 18 (tunable). **Card: #mines + 1** (formula tunable — see `RULES_CHANGES.md` #14).
- **Paying:** you can buy anything whose price your materials are worth in total (Ore 1, Plate 3, Sphere 7, Tesseract 23). You pay the way a sensible player would at the table, keeping the highest materials you can: of all the ways to hand in materials worth at least the price, with the change given back in materials lower than the highest one handed in (largest first, up to the 6-per-material cap), the one that leaves you the most Tesseracts, then Spheres, then Plates, then Ore is used. Example: a Sphere and an Ore paying 3 leave a Plate and 2 Ore; 2 Spheres paying 3 leave a Sphere, a Plate and an Ore (`RULES_CHANGES.md` #42).
- Exchange materials *down* with the bank only. Trade Power Tokens player-to-player freely (no bank market). Material trades between players discouraged, not enforced.

## Leverage cards
Max 2 played per turn; buy any number. Some are **play-on-draw** (resolve immediately on purchase). A play-on-draw card **counts toward the 2 plays**: it uses up one of them if any are left, and if none are left it still resolves. Buying cards is never blocked by the limit (`RULES_CHANGES.md` #36; a config toggle). Counts are tunable in config.

| Card | Effect | Copies |
|---|---|---|
| Scouting Drone | Look through the draw pile, choose a piece, add it now. Any piece of any open stack may be chosen; pieces of one kind are alike, so you choose the kind and the topmost piece of that kind is taken (`RULES_CHANGES.md` #41). | 6 |
| Short Sale | Claim a building with your **lowest available** Control Module (not below the mine floor). | 4 |
| Embezzlement | Take a **Sphere** from the bank regardless of mine count. | 2 |
| Sink Hole | Discard any unclaimed board piece (not mines); its belts return to bank. | 6 |
| Overstock Supplies *(play-on-draw)* | Draw 3 pieces and place them per normal placement rules. | 6 |
| Net Surplus Sell Off | Each player gives you 3 Power Tokens (or all they have); clockwise; stop once you hit the 10 cap. | 4 |
| Changing Priorities | Move a Control Module from one of your claimed buildings to another (≤3/building). A tile-less building becomes claimable by anyone. If you no longer hold a claim on the building you left, your teleporters there return to you. | 6 |
| Production Increase | Play 4 upgrades per claim/upgrade rules; may claim, but only 1 building claimed per turn. | 6 |
| Mine Inspection *(play-on-draw)* | Take 1 Plate from the bank per mine in play. | 6 |
| **Personal Jet Pack** *(NEW)* | Collect material from **all your factories' output buffers** into inventory (respects caps). | 4 |
| **Asset Forfeiture** *(NEW)* | Remove **all Plates from every output buffer (yours and opponents')**; you keep up to your cap, the rest go to the bank. | 4 |
| **R&D Tax Write-Off** *(NEW)* | Place a teleporter on one of your buildings for free. It is one of your 4 teleporters, and like any teleporter on the board it raises the teleporter price for everyone. | 4 |
| **Solar Flare** *(NEW, play-on-draw)* | All players receive 2 Power Tokens (respects 10 cap). | 4 |

*Removed: Eminent Domain.*

## Bonus Tesseracts (behind `config.bonusesEnabled`)
Each grants 1 Tesseract **toward winning only** (not tradable/usable as a resource). Only one player holds each; it moves the instant someone surpasses the holder.
- **The Investor:** highest claiming Control Module, must be ≥10.
- **Belt Weaver:** longest continuous valid belt chain connecting ≥2 buildings (or a mine + building); passes through but doesn't include claimed factories; ≥8 belts.
- **Factory Empire:** most buildings claimed (multi-claims don't count); ≥6.
- **CLARIFIED (#7/#10):** a bonus counts **only while its card is face-up in front of you.** If you haven't claimed it, you don't have it — no retroactive "I had it the whole time." This is the punishment for not claiming at the right time.

## Winning (CLARIFIED #7/#10)
- **You may declare victory only on your own turn**, by showing **4 Tesseracts** (real + face-up bonuses). Turn order therefore makes "simultaneous" wins impossible — the first player to *prove* it during their turn wins.
- **Board-exhaustion ending:** if all pieces are played, finish the round; winner = **most resource points**. Tiebreak ladder: most Tesseracts → Spheres → Plates → Ore → earliest in turn order (else shared win). Reads correctly with bonuses on or off.

## Setup (runs once before Turn 1)

All randomness uses the seeded RNG so `createGame(seed, playerCount)` is fully deterministic.

**S1 — Components.** Each player receives: 18 Control Modules (1–18, all in tray), 1 meeple, 3 Power Tokens, 5 belts, 4 teleporters.

**S2 — Leverage deck.** Assemble per card-count config, shuffle (seeded), set as draw pile.

**S3 — Three stacks.** Build from `STACK_COMPOSITION[playerCount]` and shuffle each (seeded). Stacks 2 and 3 are **locked** until their mine enters play (purchase or auto-drop).

**S4 — Place Mine 1.** Board origin, rotation 0, fixed deterministically.

**S5 — Starting pieces.** Pull from stack 1 per player: 1 Power Plant + 1 Plate Factory + 2 blanks (= 4 × playerCount pieces total). Shuffle together (seeded), assign random rotations (seeded), then place them clockwise around the mine footprint. Remainder of stack 1 becomes the active draw pile.

**S6 — Starting player.** Determined by a seeded roll.

**S7 — Initial claims (two passes, no ore cost, fixed Control Modules).**
- **Phase A — Plate Factories, round-robin** (starting player first, forward turn order): each claims a Plate Factory with their **"3"** module.
- **Phase B — Power Plants, reverse round-robin** (last player first, reverse turn order): each claims a Power Plant with their **"2"** module.

*Flags still open: stack-count labels may be swapped for 2p/3p (FLAG-1); starting-player may be passed explicitly (FLAG-4); clockwise-ring geometry ties to the M1 hex system (FLAG-3).*