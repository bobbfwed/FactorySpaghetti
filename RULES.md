> Authored by Brandon Nimon. This reflects v0.61 **with all confirmed changes applied.** Where a value is "tunable," it lives in `config.ts`.

## Components (per player)
- 18 **Control Modules** (numbered 1–18) — *formerly "Number Tiles."*
- 1 meeple, 3 Power Tokens, 5 belts, **4 teleporters**.

## Board pieces & stacks
99 pieces: 3 Mines (double-size), 19 Plate factories, 13 Sphere factories, 9 Tesseract factories, 12 Power Plants, 43 blank/belt pieces. Split into three face-down stacks; stacks 2 and 3 sit under mines 2 and 3 and are unavailable until that mine is in play. **Stack composition is a tunable config table** (the v0.61 numbers are the starting point; see `RULES_CHANGES.md` #13).

## Materials & values
Ore 1 · Plate 3 · Sphere 7 · Tesseract 23. Inventory cap: 6 per material; Power Tokens cap 10.

## Turn structure
1. Draw and place a board piece. The stacks are face down. If more than one stack is open (unlocked and not empty), first choose one and draw from it — the choice is final — then place its top piece adjacent to the board, in any orientation. If only one stack is open, there is no choice: place its top piece directly. A dropped Mine waiting to be placed replaces this step (see Mines). When no board piece is left to draw and no Mine is waiting, this step is skipped and the turn goes straight on to the roll (`RULES_CHANGES.md` #44). *(Draw step: `RULES_CHANGES.md` #33.)*
2. Roll dice — **one die per mine on the board.**
3. Actions: buy/place belts, buy cards/mines, place teleporters, exchange with bank. If the roll activated a building of yours that waits for your decision (a factory, or a Power Plant with your teleporter on its empty input), first make it (see Production) — nothing else can be done on your turn until you have.
4. Place meeple (on an owned building, or a mine point) — once, and before the turn may end (unless there is nowhere it may go).
Leverage cards may be played in any of the four steps of your own turn — before or after placing your piece, before rolling, during your actions, before or after placing your meeple — never in another player's turn and not in the round-end turns (max 2/turn, play-on-draw cards included — see Leverage cards; `RULES_CHANGES.md` #50). Cards are **bought** only in the actions step; any number may be purchased.
At **round end**, each player takes a turn to claim buildings / upgrade Control Modules / operate their meeple building. This turn is time-limited (host-adjustable, default **20 s**, resets on each action) so an idle player can't stall the table; on timeout it auto-ends.

## Production
- A roll activates **all** buildings (any owner) whose Control Module equals the dice sum — on **anyone's** turn (this is what lets teleporters and cross-turn play work).
- **Operating an activated factory is the OWNER's choice, not automatic.** When your factory is activated (even on another player's turn), you are prompted to **operate** (pay the power + consume the inputs) or **skip** — so a roll can never spend your power/materials without consent. In multiplayer there is a host-adjustable timeout (default **8 s**); if you don't respond it **runs the building from what lies in its own input** when it can, else skips it — the default never takes anything from your inventory through a teleporter (`RULES_CHANGES.md` #45). Power Plants are exempt — they auto-operate (there's no downside to gaining tokens) — except a Power Plant with **your teleporter on its empty input**: then you choose what, if anything, to supply to it (see Teleporters); it always runs, so it has no skip (unless it can no longer run, at the Power Token cap), and on a timeout it runs with nothing supplied. On your own turn this decision comes first: until every activated factory of yours is run or skipped, you can do nothing else (`RULES_CHANGES.md` #40).
- To operate a factory: required inputs present in input buffer (or supplied by you through your teleporters on its inputs, each into its own input) + pay **1 Power Token per input consumed** (Plate=1, Sphere=2, Tesseract=3). All inputs consumed; product goes to **output buffer** (holds 1 at a time).
- Power Plants: no power cost; rolling their number yields ≥1 Power Token. If a material sits in input, it's consumed for more tokens per the 1/2/5/10 chart (Tesseracts may **not** be used in a Power Plant). With your teleporter on its empty input you may instead supply one Ore, Plate or Sphere from your inventory as it runs (`RULES_CHANGES.md` #45).
- Output buffer full + same number rolled again = no new production.
- Produced material **stays in the output buffer** — it is never automatically banked. It is inaccessible to the owner **unless** they have their meeple on that building this round **or** a teleporter on its output (see below).
- With a meeple on the building this round, collecting the output buffer into inventory is **optional**: the player may collect it (respecting caps), only load inputs from inventory, or do neither. Uncollected output remains in the buffer (and may flow on to the input of another of your buildings connected to it, directly or by your belts). Input buffers are never "collected" — only the output buffer is.

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

## Ownership: nothing crosses between players
The designer's rule for the whole game (2026-11-27): nothing passes from one player to another through buildings, belts or Teleporters. Leverage cards still do what their text says; Asset Forfeiture is the one card that takes other players' material (the Plates in every output buffer). Each part of the rule, and what guarantees it:
- **One owner per building.** All the Control Modules on a building belong to one player (up to 3 of theirs). Nothing puts your Control Module on a building another player has claimed: not a claim, not Short Sale, not Changing Priorities, not the setup claims. A saved game holding a building shared by two players (possible before `RULES_CHANGES.md` #46) cannot be opened (`RULES_CHANGES.md` #57).
- **Another player's belt never feeds your building, and never draws from it.** A belt end facing the input or output of a building its owner does not own is a dead end (`RULES_CHANGES.md` #38), and belts of different players never join.
- **Your building never feeds another player's building or belt.** An output touching an input moves material only between buildings of the same player (`RULES_CHANGES.md` #51), and your input or output is a dead end for another player's belt (#38).
- **Teleporters only on your own building.** You place a Teleporter only on a building you own, so another player's Teleporter is never on yours. A Teleporter supplies its input only from its owner's inventory, drains its output only into its owner's inventory, and cuts its input or output off from belts and touching buildings (`RULES_CHANGES.md` #53, #55): your building never feeds another player's Teleporter, and another player's Teleporter never feeds your building.
- **When the owner leaves, the Teleporters go home and the material is forfeit.** As soon as a building has no Control Module left (today only Changing Priorities can move your last one off it), every Teleporter on it goes back to the player who placed it, and every material in its inputs and its output goes to the bank. The building is empty before anyone else can claim it, so a new owner never gets the old owner's material (`RULES_CHANGES.md` #37, #58).
- **An unclaimed building holds nothing, receives nothing and feeds nothing.** Anyone may still lay a belt facing its input or output; the belt carries nothing there until someone owns the building.
- **Your meeple works only on your own building.** Loading, running and collecting with the meeple at round end need a claim on that building (#58).

## Material flow
- **Direct adjacency:** a building's output touching the input of another building moves material for free — **only between buildings of the same player** (both belong to one owner). Just as your belts never carry another player's material, your building never feeds another player's building: if your output touches the input of a building you do not own, nothing moves and the material stays in your output (blocked, as when the input is full). An **unclaimed** building feeds nothing and receives nothing (it holds nothing: see Ownership; `RULES_CHANGES.md` #58). A Mine belongs to nobody: an ore exit touching the input of any claimed building fills it (`RULES_CHANGES.md` #51).
- **Belts:** a belt links two connection points (holes) *on one piece* — it never bridges pieces; belts chain across a shared edge, where a point on one piece lines up with the point on the next. Valid placement requires the two ends separated by **more than two** connection points, and each connection point holds one belt.
  - **Connection points follow the printed pieces** (`RULES_CHANGES.md` #30). A blank piece has all 12. On a building piece every hole that is not an input or output is a belt point, usable by **any** player whoever has claimed the building (a claim never closes the belt points on the building's own piece): Plate Factory and Power Plant #3–#6 and #9–#12; Sphere Factory #4–#6 and #10–#12; Tesseract Factory #4, #5, #10, #11 (#1 = left edge, lower point, counting clockwise). A Mine has no holes, so no belt lies on a Mine, but a belt end on a neighbouring piece may face a Mine's ore exit.
  - **Material flow:** material moves along a chain of one or more belts from a source (a Mine ore exit, or a building's output) to a **claimed** building's input. A belt that connects nothing is still a legal placement (`RULES_CHANGES.md` #34). Belts of different players never join, so every chain belongs to one player.
  - **An opponent's belt does not feed your building, and does not draw from it.** A belt end that faces, across a shared edge, the input or output of a building that has at least one claim and none of them the belt owner's is a **dead end**: no material enters or leaves the belt chain through that end. The belt works again as soon as its owner owns that building (`RULES_CHANGES.md` #38). An output touching an input directly (no belt) follows the same principle: it moves material only between buildings of the same player (see Direct adjacency; `RULES_CHANGES.md` #51).
  - **Placement limits:** a belt end may **not** face, across a shared edge, (a) the input or output of a building that has at least one claim and none of them yours — those points are **reserved for the building's owner** (anyone may lay a belt there while the building is unclaimed, though an unclaimed building neither feeds nor receives; `RULES_CHANGES.md` #31), nor (b) **another player's belt**. A belt is never removed when the claims on a building change later (in either direction: when another player claims the building after the belt was laid, or when the belt's owner loses or moves their claim, for example with Changing Priorities); it stays where it is, as a dead end at that point while the rule above applies.
  - **One Mine belt per turn:** only one belt with an end facing a Mine **ore exit** may be placed per turn. A belt end facing a part of a Mine without an exit (such as the lean half of Mines 2 and 3) does not count (`RULES_CHANGES.md` #39). Picking up (or undoing) the Mine belt you placed this turn frees the limit again; picking up a Mine belt placed on an earlier turn gives no extra Mine belt (`RULES_CHANGES.md` #52).
  - Belts are purchasable (cost 1). During their actions step, players can freely remove their own belts. A belt laid on an **earlier turn** goes back to the **bank**: the player does not get it back and must buy a belt again before placing one (printed rule 6). A belt laid **this turn** comes back to the player's own belts, free to lay again, as the take-back of a move not yet finished (the Ore spent buying it is not refunded); "Take back this turn's belts" (`UNDO_BELTS`) does the same for all of this turn's belts (`RULES_CHANGES.md` #54).
- **Teleporters (NEW):** 4 per player, placed on **one input** or on the **output** of a building **you own**. A player can never remove one by choice. **One teleporter per input, and one on the output** (`RULES_CHANGES.md` #55): a Plate Factory or Power Plant has one input; a Sphere Factory has two inputs and a Tesseract Factory three, and each of those inputs can carry its own teleporter. Inputs are counted in hole order: input 1 = hole #1, input 2 = hole #3, input 3 = hole #12 (Tesseract Factory). Every teleporter placed is one of your 4 and pays the price below.
  - **Teleporters come back when the claim is lost:** as soon as you no longer hold any claim on a building (for example, Changing Priorities moved your last Control Module off it), every teleporter of yours on that building — on each input and on the output — returns to your supply, and that input or output has no teleporter any more. The building then has no owner, so the material in its inputs and output goes to the bank (see Ownership; `RULES_CHANGES.md` #58). This is the only way a teleporter leaves the board (`RULES_CHANGES.md` #37).
  - On an **input**: when the building runs (activated by a roll on anyone's turn, or by your meeple at round end), **you choose** which materials from your inventory go into the **empty inputs that carry your teleporter** — one material for each — among the choices that complete a valid recipe together with what already lies in the building's other inputs (for a Power Plant: one Ore, Plate or Sphere, or nothing). Whole units you hold only — nothing is broken down into smaller materials for it. A teleporter supplies **only its own input**: an input without your teleporter is never filled from your inventory this way, it fills only by belt, a touching building or a Mine. So a factory with a teleporter on every input can run entirely from your inventory, while a Sphere or Tesseract Factory with some inputs teleported runs only once its other inputs hold their material. **Nothing is ever taken from your inventory automatically**: the building does not pull materials at any other moment (`RULES_CHANGES.md` #45). Only the player whose teleporter it is can supply through it.
  - **On a roll** (`RULES_CHANGES.md` #55): the factory asks you to run or skip it only when it **can** run — every input holds material or is an empty input with your teleporter, the materials (with what you would supply) make a valid recipe, the output is empty and you have the Power Tokens. If an input without your teleporter is still empty, the factory cannot run: nothing is asked and nothing happens, as for any factory with an empty input. If its inputs are all full it can also run from them alone, without supplying anything.
  - On an **output**: material in that buffer goes to your inventory (bypasses the meeple-access rule), respecting the 6-per-material cap. This happens the instant it's produced **and** continuously drains the buffer whenever your inventory has room — so material never sits stuck under a teleporter (e.g. produced before you placed it, or overflow from when you were at cap). Only true overflow (inventory at cap) stays in the buffer, until room opens up.
  - **A teleporter cuts its input or output off from belts and direct contact** (`RULES_CHANGES.md` #53, per input since #55). On an **output**: material in that buffer never leaves by a belt or into a touching input — not even while it waits there because your inventory is at the cap; it only goes to your inventory. On an **input**: nothing arrives at **that input** from a Mine ore exit, a belt or a touching output; what already lay in it when the teleporter was placed stays and is used. The building's **other inputs** keep receiving normally. Belts facing a teleported input or output may still be placed and are never removed by it; they carry nothing through that point.
  - **Cost = (teleporters currently on the board, all players) + 1.** So 1, 2, 3, … globally, and the price drops again when a teleporter returns to its owner.

## Buildings: claiming & upgrading
- **Control Module upgrades are a currency** earned only from meeple on mine upgrade points (the number printed on that Mine: **2** on Mine 1, **3** on Mine 2, **4** on Mine 3; `RULES_CHANGES.md` #49), the end-of-round free upgrades (**= #mines**, usable only to raise one in-play module), or cards (e.g. Production Increase). **Upgrades are never bought with materials** — there is no mechanism to exchange ore (or any material) for module upgrades.
- **Upgrade:** swap a building's module for a higher available one; cost = numeric difference, paid from upgrade-currency.
- **Claim:** place an available module on an unclaimed building; initial value = **#mines** (so "1" is unusable at 2 mines, etc.). Claiming and upgrading combine: placing module *M* costs **(M − #mines + 1)** upgrade-units. An ordinary claim (in your actions step or round-end turn) must be paid: from the Mine upgrade point's credits (one free claim at round end) or from Production Increase (one claim on that turn, in any step of it); a claim paid by nothing is refused (`RULES_CHANGES.md` #43). Only two claims cost nothing: the setup claims (S7) and **Short Sale**, whose card is the payment. A building may be claimed up to **3 times** by the same player. A building has one owner: nothing puts a Control Module on another player's building (`RULES_CHANGES.md` #46, #57; see Ownership).

## Mines (CHANGED)
- Mine count drives: dice count, card price, claim floor, end-of-round upgrades, and card scaling.
- A mine may still be **purchased** (2nd = 6, 3rd = 18 — *price tunable*) and placed immediately.
- **NEW:** the next mine **auto-drops when the current stack is exhausted**, which also unlocks that mine's stack. Either path (buy or auto-drop) advances mine count identically.
- A new Mine (bought or dropped) may be placed wherever **at least one of its two hexes** is next to the board and neither hex overlaps a piece, in any orientation (`RULES_CHANGES.md` #47; #43 had required the rich hex).
- A meeple on a Mine's **resource point** earns 2 Ore (Mine 1), 1 Plate (Mine 2) or 1 Sphere (Mine 3); on its **upgrade point** the Control Module upgrade credits printed on that Mine: 2 (Mine 1), 3 (Mine 2), 4 (Mine 3), however many Mines are in play (`RULES_CHANGES.md` #49).
- A mine is a double-hex piece (a rich hex + a lean hex sharing one internal edge). Ore exits at its **ore-output** points, where the printed rays and tracks reach the edge: **every** mine's rich hex has exits on both points of all 5 external edges. Only **Mine 1's lean hex** has exits — 3 of them, one on every-other external edge (#4, #8, #12 counting from the shared edge; `RULES_CHANGES.md` #17). **Mines 2 and 3 have no exits on their lean hex** (`RULES_CHANGES.md` #32). Belts never lie on a mine (it has no holes); ore flows from an exit to a directly adjacent input, or into a belt chain whose end faces the exit.

## Purchases & costs
- Belt: 1. Teleporter: teleporters on the board + 1. Mine: 6 / 18 (tunable). **Card: #mines + 1** (formula tunable — see `RULES_CHANGES.md` #14).
- **Paying:** you can buy anything whose price your materials are worth in total (Ore 1, Plate 3, Sphere 7, Tesseract 23). You pay the way a sensible player would at the table, keeping the highest materials you can: of all the ways to hand in materials worth at least the price, with the change given back in materials lower than the highest one handed in (largest first, up to the 6-per-material cap), the one that leaves you the most Tesseracts, then Spheres, then Plates, then Ore is used. Example: a Sphere and an Ore paying 3 leave a Plate and 2 Ore; 2 Spheres paying 3 leave a Sphere, a Plate and an Ore (`RULES_CHANGES.md` #42).
- Exchange materials *down* with the bank only. Trade Power Tokens player-to-player freely (no bank market). Material trades between players discouraged, not enforced.

## Leverage cards
Max 2 played per turn, in any step of your own turn (place a piece, roll, actions, place the meeple; never in the round-end turns); buy any number, in the actions step. **When the deck is empty and a card is bought, the discard pile is shuffled into a new deck** (seeded); a card can be bought until the deck and the discard pile are both empty (`RULES_CHANGES.md` #48). Some are **play-on-draw** (resolve immediately on purchase). A play-on-draw card **counts toward the 2 plays**: it uses up one of them if any are left, and if none are left it still resolves. Buying cards is never blocked by the limit (`RULES_CHANGES.md` #36; a config toggle). Counts are tunable in config.

| Card | Effect | Copies |
|---|---|---|
| Scouting Drone | Look through the draw pile, choose a piece, add it now. Any piece of any open stack may be chosen; pieces of one kind are alike, so you choose the kind and the topmost piece of that kind is taken (`RULES_CHANGES.md` #41). In the place-a-piece step it is played before drawing, not after; if it empties a stack and drops the next Mine, that Mine replaces your piece placement (`RULES_CHANGES.md` #50). | 6 |
| Short Sale | Claim an **unclaimed building, or one you already hold a claim on**, with your **lowest available** Control Module (not below the mine floor) — never another player's building (`RULES_CHANGES.md` #46). | 4 |
| Embezzlement | Take a **Sphere** from the bank regardless of mine count. | 2 |
| Sink Hole | Discard any unclaimed board piece (not mines); its belts return to the bank: their owners do not get them back and must buy belts again, also for a belt laid this turn (`RULES_CHANGES.md` #56). | 6 |
| Overstock Supplies *(play-on-draw)* | Draw 3 pieces and place them per normal placement rules. | 6 |
| Net Surplus Sell Off | Each player gives you 3 Power Tokens (or all they have); clockwise; stop once you hit the 10 cap. | 4 |
| Changing Priorities | Move a Control Module from one of your claimed buildings to another that is **unclaimed or already yours** — never another player's (≤3/building; `RULES_CHANGES.md` #46). If it was your last Control Module there, the building you left has no owner: its material goes to the bank and your teleporters there return to you (`RULES_CHANGES.md` #58); anyone may claim it later. Once your meeple stands on a building this turn, your last Control Module there may not be moved (`RULES_CHANGES.md` #50). | 6 |
| Production Increase | Play 4 upgrades per claim/upgrade rules; may claim, but only 1 building claimed per turn. The upgrades may be spent in any step of the turn it is played in (`RULES_CHANGES.md` #50). | 6 |
| Mine Inspection *(play-on-draw)* | Take 1 Plate from the bank per mine in play. | 6 |
| **Personal Jet Pack** *(NEW)* | Collect material from **all your factories' output buffers** into inventory (respects caps). | 4 |
| **Asset Forfeiture** *(NEW)* | Remove **all Plates from every output buffer (yours and opponents')**; you keep up to your cap, the rest go to the bank. | 4 |
| **R&D Tax Write-Off** *(NEW)* | Place a teleporter on one of your buildings for free — on one input or the output, as any teleporter (`RULES_CHANGES.md` #55). It is one of your 4 teleporters, and like any teleporter on the board it raises the teleporter price for everyone. | 4 |
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
- **Board-exhaustion ending:** if all pieces are played (every stack empty, no Mine waiting to be placed), finish the round: every remaining player takes their turn (with nothing to draw, their place-a-piece step is skipped) and the round-end turns are played; then the game ends and the winner = **most resource points** (`RULES_CHANGES.md` #44). A player may still win by showing 4 Tesseracts on their own turn during those last turns. Tiebreak ladder: most Tesseracts → Spheres → Plates → Ore → earliest in turn order (else shared win). Reads correctly with bonuses on or off.

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