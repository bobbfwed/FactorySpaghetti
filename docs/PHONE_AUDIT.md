# Phone audit (Android, from the browser)

**Where I am / what is next (work in progress, 28 Nov 2026):** every screen has been photographed
before the fixes; the fixes below marked "fixed" are committed on `wp/phone`. A full "after" run of
all browser scripts is going (screenshots `*-after.png`). Next: read the after measurements, fill
the 44 px list, write `INDEX.md` beside the screenshots, run the four checks, report.

How it was checked: headless Chrome (Playwright) with touch emulation and an Android user agent, at
360 x 640, 390 x 844 and 412 x 915 (device pixel ratio 2 to 3), landscape 844 x 390, and desktop
1440 x 900. Every tappable thing was measured with `getBoundingClientRect`, checked for being
covered with `elementFromPoint` at its centre, the page for horizontal scroll, and visible text for
sizes under 12 px. Deep game states were built by playing with bots and then editing the room and
loading it as a save (scripts kept outside the repo). Safe-area insets were emulated with Chrome's
`Emulation.setSafeAreaInsetsOverride`; the on-screen keyboard by shrinking the window while the code
field had focus.

Severity: **High** = a phone player cannot do or read something important; **Medium** = hard,
hidden, cut off or misleading; **Low** = small, cosmetic, or desktop-only. Screenshot names are
`<name>-<viewport>-before.png` / `-after.png` in `.claude/reports/screenshots/phone/`.

| # | Screen / state | Viewport | What was wrong | Severity | Status | Screenshots |
|---|---|---|---|---|---|---|
| F1 | Game, opponents' chips at the top | 360, 390, 412, landscape | With three opponents the names were cut to one or two letters ("S…"); opponents could only be told apart by colour. The rule meant to hide the Tesseract stars on crowded chips never applied (its selector looked for chips as siblings, but each chip sits in its own list item). | High | fixed: rule repaired, the Tesseract count moves under the name | `game-setup`, `turn-actions` (360, 390) |
| F2 | Game, toast | phones | The toast (fixed at 122 px from the top) covered the "Rolled" chip for 4.5 s. | Medium | fixed: placed below the top-left stack | `toast-roll` |
| F3 | Game, taking back belts | all | The button said "Undo belts"; the bank entry and the guide say "Take back this turn's belts". | Medium | fixed: one name (the bank entry's) | `undo-belts-sheet` |
| F4 | Game, a route that cannot be laid now | all | The route's key still said "N from your supply" and the route was drawn in the player's colour. | Medium | fixed: all of it is "for a later turn"; test | (view test `routeCancel.test.ts`) |
| F5 | Game, phone sheet, actions step | phones | "Lay a belt", Teleporters and the bank lived only in the pulled-up sheet; the collapsed sheet gave no hint. Pulled up, the bank was the last thing in the Tray tab, below the fold. | Medium | fixed: "Lay a belt" and "Tray & bank" buttons in the collapsed sheet during my actions step; bank moved right under the components | `turn-actions`, `sheet-tray`, `sheet-tray-bank` |
| F6 | Game, Remove a belt | all | With two of my belts crossing on one tile, both kept glowing after one was chosen, so it was not clear which one would go. | Medium | fixed: only the chosen belt glows; the other still answers a tap; test | `remove-belt-chosen-390` |
| F7 | Game, opponent's details | landscape | The panel ran off the bottom and could not be scrolled. | Medium | fixed: scrolls inside the screen | `seat-details-land` |
| F8 | Game, sheet Tray tab | 360 | "Lay a belt 5": the count spilled over the Remove button; "Place a telepor…" cut. | Low | fixed: the labels wrap | `sheet-tray-360` |
| F9 | Game, desktop | 1440 | Under 44 px with a mouse: bank buttons 137 x 36, edge tabs 40 px wide, Belts/Teleporters/Remove 40 px tall, close crosses 34 x 34 (route panel, building menu, player details). | Low | fixed: all 44 px | `turn-actions-desk`, `belt-route-desk` |
| F10 | Game, off-turn decision | phones | The decision appeared twice, each with Run it / Skip and a timer: anchored on the table and at the top of the sheet. At 360 x 640 the two covered the whole table and the top row (menu button, opponents). | Medium | fixed: on a phone the table shows only a short tag at the building ("Run it or skip it in the panel below") | `prompt-offturn` (360, 390) |
| F11 | Game, camera buttons | phones | The four camera buttons were not cut out of the area the board is framed into, so a lit target could sit under one. | Low | fixed: cut out (the board can still be panned under them) | `turn-actions-360` |
| F12 | Game menu | phones | No close control inside the menu; the menu button kept its three-line icon while open. | Low | fixed: the button shows a cross and says "Close the game menu" | `game-menu-390` |
| F13 | Guide, "See also" | 360 | Short links narrower than 44 px ("Belts" 37 x 49). | Low | fixed | `guide-topic-end-360` |
| F14 | Several | phones | Text under 12 px: turn-order row labels (10 px), chip status (11 px), section labels (11 px), lobby subtitle (10.5 px), text-view header labels (10 px), guide pager labels (11 px). | Low | fixed: raised to 11–12 px (the turn-order row to 11 px, more would cut "Round end" at 360) | various |
| F15 | Game, planned route | all | Buttons said "Place 5 from inventory" while the key and the guide say "from your supply". | Low | fixed (game and guide) | `belt-route` |
| F16 | Guide, moving between topics | phones | Checked: every topic page has a "Contents" button in the header (one tap to the list), plus Previous / Next and "All topics" at the end. The side list is hidden below 900 px by design. The earlier report predates the Contents button. | Info | no change needed | `guide-topic-360`, `guide-topic-end-360` |
| F17 | Lobby | 360 x 640 | Start / Ready / Continue game were below the fold. | Low | fixed: kept at the bottom of the screen (sticky) on phones | `lobby-solo`, `lobby-resume` |
| F18 | Lobby of a solo game (new or resumed) | all | Showed a room code nobody can use (and it took the top of the screen). | Low | fixed: not shown for solo games | `lobby-resume-360` |
| F19 | Green player vs materials | all | Plate (#4CA945) is close to the green player's Control Modules on the table; shape and the printed number tell them apart. Report only. | Info | reported (colours not changed) | `green-zoom-390`, `green-table-*` |
| F20 | Game, away countdown | phones | Reported: the top row grows and pushes the top-left panels down. Not reproduced: the chip keeps its height (48 px) and the countdown is cut with an ellipsis. | Info | not reproduced | `away-countdown` (390, landscape) |
| F21 | Desktop, seat plates | 1440 | The third opponent's plate ran under the camera buttons (its Tesseract stars hidden). | Medium | fixed: plates end before the camera buttons | `turn-actions-desk` |
| F22 | Game over | 360 | "Watch this game again" wrapped onto four lines; the card could not scroll on a short screen. | Low | fixed: smaller button text, icons hidden under 400 px, card scrolls | `game-over-360` |
| F23 | Text view header | 360 | Whose turn and the step were squeezed into a narrow column, one word per line. | Low | fixed: own line under room and round | `textview` (360) |
| F24 | Replay viewer | 360, landscape | The table (or the move text in a text replay) had no height left; the players' list ran over the note below it. | Medium | fixed: players' list limited, jump buttons on one row, right-hand column held sideways; text replay scrolls with controls at the bottom | `replay-table-*`, `replay-360` |
| F25 | Game, "Your turn" banner | landscape | Centred on the whole screen, half over the side panel. | Low | fixed: centred over the table | `safe-game-land` |
| F26 | Game, chip status "next" | phones | With three opponents the "next" tag on a chip is cut ("NE…"). | Low | open (room is short; the turn order row shows it) | `turn-actions-360` |
| F27 | Game, camera buttons | phones | Icon-only (rotate, re-centre, top-down, guide); their names are only in tooltips and screen-reader labels. | Low | open: design question | — |
| F28 | Material icons on dark wells | phones | Sphere (#237228) and Tesseract (#114218) icons are dim on the black wells, worse when greyed at 0. | Low | open: colours not to be changed; report | `sheet-tray-390` |

## Installed-app checks

- Manifest (`public/manifest.webmanifest`): name, short name, `display: standalone`, `orientation: any`,
  theme and background `#141416`, icons 192, 512 and a 512 maskable icon. Nothing wrong found.
- Viewport meta: `width=device-width, initial-scale=1, viewport-fit=cover`; page zoom is not blocked
  (good for reading the menu), and the game screen stops browser zoom and pull-to-refresh by itself
  (`touch-action: none`, `overscroll-behavior: none`); the lobby and replay screens also stop
  pull-to-refresh.
- Safe areas: with a 47 px notch and 34 px gesture bar emulated (portrait) and 47 px side insets
  (landscape), the menu, lobby and game keep every control inside the safe area.
- Text selection: the game screen is not selectable except the log and rules text, which can be copied.
- Keyboard: the room-code field moves focus to "Join a game" after the fifth letter, so the keyboard
  closes by itself; the menu page scrolls, so the browser can bring the field into view.
- Long names: names are cut at 20 characters by the session; in the lobby and the game they wrap or end
  in an ellipsis without breaking the layout.
