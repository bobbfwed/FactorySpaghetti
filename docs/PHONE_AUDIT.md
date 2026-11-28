# Phone audit (Android, from the browser)

**Where I am / what is next (work in progress, 28 Nov 2026):** the menu, solo lobby, a full normal turn,
the sheet tabs, the game menu, seat details, building menu, belt route, cards, an off-turn prompt, the
round-end turn, game over and the guide have been photographed at 360, 390, 412, landscape 844 x 390
and desktop 1440 x 900 (screenshots `*-before.png` in `.claude/reports/screenshots/phone/`). Still to
photograph: online lobby and joining (two tabs with `?t=local`), join errors with the keyboard, the
away countdown and the removed-player panel, the text view, the replay viewer. Fixes have not started.
The browser scripts live outside the repo (`scratchpad/phone/*.cjs`).

How it was checked: headless Chrome (Playwright), touch emulation, device pixel ratio 2 to 3.
Every tappable thing was measured with `getBoundingClientRect`, checked for being covered with
`elementFromPoint` at its centre, the page for horizontal scroll, and text for sizes under 12 px.
Deep game states were built by playing with bots, then editing the room and loading it as a save.

Severity: **High** = a phone player cannot do or read something important; **Medium** = hard,
hidden, cut off or misleading; **Low** = small, cosmetic, or desktop-only.

| # | Screen / state | Viewport | What is wrong | Severity | Status | Screenshots |
|---|---|---|---|---|---|---|
| F1 | Game, opponents' chips at the top | 360, 390, 412, landscape | With three opponents the names are cut to one or two letters ("S…"), so opponents can only be told apart by colour. The rule that hides the Tesseract stars on crowded chips never applies (its selector looks for chips as direct siblings, but each chip sits in its own list item). | High | open | `game-setup-360`, `turn-actions-390` |
| F2 | Game, toast after a refused tap | 390 (all phones) | The toast (top 122 px) covers the "Rolled" chip (top 108 px) for 4.5 s. | Medium | open | `toast-roll-390` |
| F3 | Game, taking back belts | all | The turn bar / sheet button says "Undo belts"; the bank entry and the guide say "Take back this turn's belts". | Medium | open | `undo-belts-*` |
| F4 | Game, a route that cannot be laid now | all | The route panel's key still says "1 from your supply" (and the route is drawn in the player's colour) although nothing can be laid now. | Medium | open | `route-refused-*` |
| F5 | Game, phone sheet, actions step | 360, 390, 412 | "Lay a belt", the Teleporter button and the bank are only in the pulled-up sheet; the collapsed sheet gives no hint that actions live there (only a thin grab bar). Pulled up, the bank is the last thing in the Tray tab, below the fold (390: 91 px to scroll; 360: about 300 px). | Medium | open | `turn-actions-390`, `sheet-tray-390`, `sheet-tray-360` |
| F6 | Game, Remove a belt | all | Two belts on one tile: the selected one is hard to tell from the other. | Medium | to verify | `remove-belt-*` |
| F7 | Game, opponent's details | landscape | The details panel runs off the bottom of the screen and cannot be scrolled: the last rows (Control Modules on the board, Bonus cards) cannot be read. | Medium | open | `seat-details-land` |
| F8 | Game, sheet Tray tab | 360 | "Lay a belt 5": the count spills out of its button over the Remove button; "Place a telepor…" is cut. | Low | open | `sheet-tray-360` |
| F9 | Game, desktop | 1440 | Under 44 px with a mouse: bank buttons 137 x 36, Log/Rules/Bonuses edge tabs 40 px wide, Belts/Teleporters/Remove buttons 40 px tall, close crosses 34 x 34 (route panel, building menu, player details). On touch screens these are already 44 px. | Low | open | `turn-actions-desk`, `belt-route-desk` |
| F10 | Game, off-turn decision | phones | The decision appears twice: anchored on the table and again at the top of the sheet, each with Run it / Skip and a timer; on a small phone they cover most of the table. | Low | to verify at 360 | `prompt-offturn-390` |
| F11 | Game, camera buttons | phones | The four round camera buttons on the right cover the board's right edge; the board is not framed clear of them, so a lit target can sit under one. | Low | open | `turn-actions-360` |
| F12 | Game menu | phones | No close control inside the menu; the menu button keeps its three-line icon while open (it closes with a tap on it or on the table). | Low | open | `game-menu-390` |
| F13 | Guide, "See also" | 360 | Short links are narrower than 44 px ("Belts" 37 x 49). | Low | open | `guide-topic-end-360` |
| F14 | Several | phones | Text under 12 px: the turn-order row labels ("Round 4", "Round end", 10 px), chip status line (11 px), section heads in the sheet (11 px), "Solo game" in the lobby header (10.5 px), guide pager labels (11 px). | Low | open | various |
| F15 | Game, planned route | all | Buttons say "Place 5 from inventory" while the key above says "from your supply" and the guide says "from your supply". | Low | open | `belt-route-390` |
| F16 | Guide, moving between topics | phones | Works today: a "Contents" button in the header on every topic page, Previous / Next and "All topics" at the end of each page. The side list is hidden below 900 px. Nothing to fix beyond F13/F14. | Info | checked | `guide-topic-360`, `guide-topic-end-360` |
| F17 | Lobby | 360 x 640 | Start (and Continue game for a resumed game) is below the fold; the player must scroll to find it. | Low | open | `lobby-solo-full-360`, `dbg-resume` |
| F18 | Lobby of a resumed solo game | all | Shows a room code although nobody can join; "back" appears twice for the host. | Low | open | `dbg-resume` |
| F19 | Green player vs materials | all | Report only (colours are not to be changed). | Info | to report | `colors-*` |
| F20 | Game, away countdown | phones | Reported: the top row grows and pushes the top-left panels down while an away countdown shows. | Medium | to verify | `away-*` |
