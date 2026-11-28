# Factory Spaghetti Online — plan

This is the plan for turning the existing playtest prototype into an online, isometric 3D version of Factory Spaghetti that looks and plays like the physical game, runs from GitHub Pages, and installs on an Android phone.

Status: plan only. Nothing below is built yet except the parts marked "exists today".

## 1. Goals, in priority order

1. **Rules stay correct.** The existing rules engine and its tests carry over unchanged (245 tests for engine, bots and simulator; the prototype's other 19 tested its LAN server). Players still cannot make an illegal move.
2. **Online play with a room code.** One player hosts, the others join with a 5-letter code or an invite link. No server of our own. A game can be saved, sent to another device as a link or a file, and resumed on a later day.
3. **It feels like the physical game.** Someone who knows the printed game recognises every piece and every step, and someone who learns here can sit down at the real table.
4. **Phone-friendly and installable.** Works in portrait on an Android phone and can be added to the home screen.
5. **Still a playtest tool.** Bots, the headless simulator, config-driven tuning and replays keep working.

Not goals for now: accounts, matchmaking with strangers, cheat-proofing against a determined player, iOS-specific polish.

## 2. What exists today and what happens to it

| Part | Where | Size | Decision |
|---|---|---|---|
| Rules engine (`createGame`, `applyAction`, `legalActions`) | `src/engine` | 5,666 lines + 4,047 lines of tests | **Keep as is.** It is pure, deterministic, and its state is plain JSON. |
| Bots (random and "smart" greedy) | `src/bots` | 407 lines | **Keep.** They already run in the browser. |
| Headless simulator | `src/sim` | 134 lines | **Keep.** |
| Local session (timers, bot turns, log) | `src/client/GameSession.ts` | 531 lines | **Port** into the new host session (section 4). |
| Canvas 2D board and action panel | `src/client` | ~3,800 lines | **Replace** with the 3D table and new interface. The geometry tables and the "filter `legalActions` to find valid targets" approach are reused. |
| LAN WebSocket server | `src/server` | 728 lines | **Retire on `main`.** Its seat, token and reconnect ideas are reused in the new session layer. |

The whole prototype stays available on the `vite-prototype` branch, so the 2D client and the LAN server can be picked up again at any time.

Two facts about the current code shape the plan:

- **Dice are rolled by whoever sends the move.** The `ROLL_DICE` action carries the dice, and today the browser fills them in with `Math.random`. Online, the host must roll, or any player could choose their own dice.
- **The full state, including every hand and the deck order, is sent to every player.** The LAN server already works this way.

## 3. Technology choices

| Area | Choice | Why |
|---|---|---|
| Language and build | TypeScript + Vite (as today) | The engine and tests are TypeScript. A build step also gives hashed file names, which makes caching safe. |
| Hosting | GitHub Pages, deployed by a GitHub Actions workflow on every push to `main` | The reference game serves raw files with no build. We need a build, so the workflow runs tests, builds, and publishes. A push to `main` still updates the live site in a couple of minutes. |
| 3D | Three.js with an orthographic (isometric) camera | Real 3D lets us use the actual printed-piece models, rotate the table, and pick pieces by touch. One hundred tiles and a few hundred small pieces is a light scene. |
| Piece models | Converted from the designer's own `.3mf` print files | The digital pieces are then the same shapes as the printed ones. |
| Interface | Plain HTML and CSS drawn over the 3D canvas | Menus, the player tray and prompts need text, accessibility and phone layouts, which the browser does better than WebGL. No UI framework. |
| Networking | WebRTC through PeerJS, host-authoritative | Same approach as the reference game, minus its real-time stream. |
| Install | Web app manifest + service worker | Makes the site installable on Android and lets solo play work offline. |

Rejected: pre-rendered isometric sprites on Canvas 2D. They are lighter, but every piece would need six rotations times several camera angles, belts bend freely between holes, and the table could not rotate. Three.js is the simpler route to "looks like the real thing".

## 4. Architecture

```
src/
  engine/      unchanged rules engine + tests
  bots/        unchanged
  sim/         unchanged
  session/     NEW  host and client game sessions, lobby, protocol, dice, save
  net/         NEW  transports (PeerJS, same-browser tabs, in-memory), chunking, room codes
  table/       NEW  Three.js scene: board, pieces, camera, picking, animation
  ui/          NEW  menu, lobby, player tray, turn bar, prompts, log, reference sheets
  app/main.ts  NEW  wiring
public/        manifest, service worker, icons, models (.glb), textures
tools/         3MF-to-GLB converter, network check page
docs/          this plan, mock-ups, screenshots
```

The existing rule still holds and is the reason this port is cheap: **all rules live behind `applyAction`. Rendering, networking and bots are consumers and never contain rules.**

### 4.1 The room: one JSON object the host owns

```ts
interface Room {
  v: 1;
  code: string;                 // 5 letters, no I or O
  phase: 'lobby' | 'playing' | 'finished';
  hostSeat: number;
  seats: Seat[];                // name, colour, human or bot, connected, ready, awaySince
  settings: RoomSettings;       // player count, bonuses on/off, timeouts, away policy
  game: GameState | null;       // the engine's state, untouched
  seq: number;                  // goes up by one for every accepted move
  diceRng: number;              // seeded dice stream, so a new host continues the same stream
  recent: { seat: number; id: string }[];  // last ~32 accepted move ids
  log: LogEntry[];              // capped
  lastEvents: TableEvent[];     // what just happened, for animation (roll, card drawn, production)
}
```

Everything is plain JSON with the random seeds inside, so any browser holding a copy can continue the game. That is what makes host hand-over and resume possible.

### 4.2 Moves

1. A player's browser sends an **intent**: `{ t: 'act', id, action }`. For a dice roll the intent carries no dice.
2. The host checks the sender owns that seat, fills in the dice from `diceRng` if it is a roll, and calls `applyAction`.
3. If the engine accepts it, the host adds one to `seq`, records the id in `recent`, saves, and sends the new room to everyone. If not, it replies `{ t: 'nope', id, error }` to the sender only.

After every accepted move the host sends the **whole room** (cut into parts, since PeerJS refuses messages near 16 KB). Turn-based states are small and moves are rare, so there is no stream, no checksum and no replay to keep in step.

**A move sent just as the host drops.** The client keeps its last unanswered intent. After it reconnects (to the old host or a new one) it looks for the intent's id in `room.recent`. If the id is there, the move was applied; if not, the client sends it again. The host validates every move anyway, so a duplicate can only be refused, never applied twice.

**Decisions that are not the active player's.** When a roll activates another player's factory, that owner must choose operate or skip. These arrive in any order, so the host does not demand a strict sequence number; the engine's own legality check is the gate.

**Timers** stay outside the engine, on the host's clock, as today: 8 seconds to answer an operate-or-skip prompt off-turn (defaults to operate when affordable), 20 seconds idle on a round-end turn. Both are host-adjustable. Broadcasts carry "time remaining" so clients count down without clock differences.

### 4.3 Hidden information

Default: every client receives the full state, and the interface simply does not show other players' hands or the deck order. This keeps hand-over trivial (any client can become host) and matches the current LAN server. The cost is that a player who opens the browser developer tools can see hidden cards. For a playtest tool among friends this is the right trade. See open decision D1.

### 4.4 Lobby and joining

- **Menu:** Host a game, Join a game, Play solo against bots, Resume (saved games on this device), Load a save (link or file). A version label built from the commit is shown, so players can tell whether they have the newest build.
- **Host:** gets a room code and a "Copy invite link" button (`?join=ABCDE`). Picks player count (2–4), fills empty seats with bots or leaves them open, sets bonuses on or off and the timers.
- **Join:** enter name and code. Messages go `hello {name, token}` → `welcome {seat, room}`.
- **Seats and colours:** each player picks a seat colour from the colours of the printed set (blue, red, orange, green).
- **Ready:** each human marks ready; the game starts when every connected human is ready. Changing a setting clears the ready flags.
- **Identity:** a name plus a random token kept in the browser's storage. The token gets a player's seat back automatically after a reload. A matching name can claim a seat that is currently away, which covers switching devices. The token closes the reference game's weakness where anyone could take a seat by typing the same name while its owner is still connected.
- **Errors say which kind of failure it was:** no room with that code, matchmaking service unreachable, or "found the room but could not connect" (usually a router or firewall problem).
- **Full room:** a fifth joiner is told the game is full. Spectators are a later option.

### 4.5 When someone leaves

**A client leaves.** The host marks the seat away and tells everyone.

- If the away player owes an off-turn operate-or-skip decision, the normal 8-second default applies.
- If it is their turn, the game waits for a grace period (default 90 seconds, host-adjustable) with a visible banner. After that a bot plays the seat until the player returns. The host can also skip the wait with **Remove player** beside the countdown, or keep waiting. See open decision D2.
- A returning player takes the seat back at the next move boundary.

**The host removes a player.** At any time during a game (also while a resumed game is on hold) the host can press **Remove player** for any other player: beside an away player's countdown, or in a player's details for one still connected. The seat then looks exactly like an away seat whose grace period has run out (a bot plays it at once, whatever the away rule), and a connected player's device is closed with a "removed" message and does not reconnect by itself. It is not a ban: the player may join again with the room code, from the same device or under the same name, and gets the seat back like any returning player. In the lobby, removing a player opens their seat instead. Nothing about it is stored in the room or in saves.

**The host leaves.** Every client sees its connection close and applies the same rule to the same seat list: the successor is the first connected human seat that is not the old host. No vote is needed. The successor turns its copy of the room into a host session and registers the same room code again, retrying every 2 seconds for up to a minute because the matchmaking service frees the old id slowly. The others wait briefly and then rejoin the same code, getting their seats back by token. This is easier than in the reference game because every client already holds the exact state after the last move.

### 4.6 Saving a game and resuming it later, on any device

A game with several people can run for hours, so stopping and continuing another day, possibly from a different device, is a requirement and not an extra. Because the whole room is one plain JSON object with its random seeds inside, a save is simply a copy of that object. There are three ways to carry it, from least to most effort for the players:

1. **Automatic, on every player's device.** The host saves after every accepted move, and every client also stores the latest room it received. Anyone who was in the game can open the menu later and see it listed ("Room KQMTV · round 12 · Brandon, Alex, Sam · saved Tuesday") and press Resume to host it. The usual case — the same people continuing next week — needs no link and no file.
2. **Save link.** "Copy save link" packs the room into the part of the address after `#` (`…/#save=v1.<text>`). Opening the link on any device offers to resume that game. The part after `#` is never sent to GitHub or any other server; it stays in the browser.
3. **Save file.** "Download save" writes a small `.fsgame` file, and on Android "Share" hands it to the share sheet (Drive, email, messages). "Load a save" on the menu reads it back. This is the fallback that always works.

**Measured sizes** (bot games on the current engine, state compressed with the browser's built-in deflate and written as URL-safe text):

| Game | Moment | Save link length |
|---|---|---|
| 4 players, smart bots | round 5 / round 20 / end | 2,232 / 2,668 / 2,719 characters |
| 4 players, random bots (41 belts, cards in play) | round 5 / round 20 / end | 2,670 / 3,636 / 3,719 characters |
| 2 players, mixed bots | round 5 / end | 1,959 / 2,423 characters |

So a save link stays under about 4,000 characters, plus a little for seat names and settings. Browsers handle that easily, and so do email, WhatsApp and most messengers. Two limits to design around: Discord's 2,000-character message limit, and SMS, which may split a long link. The interface therefore offers the link first and the file beside it, and says which to use if a link gets cut off.

The save is a snapshot of the state, not a list of moves. A list of moves grows with the game (up to about 15,000 characters in the measured games) and stops working if a rule changes between saving and resuming; a snapshot does neither. The move list is still kept for the replay tool (milestone N11).

**Resuming** opens a lobby showing the saved seats. The game stays paused until each human seat is taken again: players join with the new room code and get their seat back by name, and the host can assign a joiner to a seat, hand an empty seat to a bot, or start anyway. Timers restart from full.

**Details that keep saves safe to use:**

- Every save carries a format version and the rules-config values it was played with. Loading a save from an older build runs a migration step; loading one made with different rule settings shows a warning before resuming.
- A save is validated before use (shape, piece counts, seat count), so a truncated link gives a clear "this save link is incomplete" message instead of a broken game.
- A save holds the full state, including every hand (see D1), and nothing stops two groups from resuming the same save separately. Both are acceptable for a playtest tool.
- Any player can copy a save link at any time, not only the host, because every client holds the full state.

### 4.7 Connecting browsers

- PeerJS's free public service introduces the browsers; the host registers as `factory-spaghetti-v1-<CODE>`. After the introduction, traffic goes directly between browsers.
- Public STUN servers (Google, Cloudflare) handle most home connections.
- A TURN relay passes traffic when a direct link fails. **This matters more for this game than for the reference game**, whose notes record that a phone on the same wifi as the host could not join. In-person game nights, with everyone on one wifi, are a main use here. The plan keeps a slot for a relay of our own and treats choosing one as required before in-person play is relied on. See open decision D5.
- A second transport links tabs of one browser (BroadcastChannel), and a third links two sessions in memory. Both hand the session the same connection object as PeerJS, so multiplayer can be tested without the internet and inside Vitest.
- A network check page reports which servers can be reached from a given device.

### 4.8 Install and offline

- Manifest with name, icons (192, 512, maskable), `display: standalone`, relative start URL.
- Service worker: cache the hashed build files, fetch the page itself from the network first. Reloading online always gets the newest version; solo play against bots works offline.
- When a newer version is available, a small "Update ready — reload" notice appears.
- The screen is kept awake during a game (Wake Lock) where the browser allows it.

## 5. Look and feel

### 5.1 The rule: if it is a piece on the real table, it is a piece on this table

Every physical component is a 3D object, either on the board or in front of a player. Nothing exists only as a number in a panel. Counts are shown as small badges beside the pieces for legibility, not instead of them.

| Physical component | On screen |
|---|---|
| Hex board tiles (blank, factories, power plants) | 3D tiles from the print models, with the same holes at the edges where belts clip in |
| Mines (double-hex) | 3D double tile; mines 2 and 3 lie on top of stacks 2 and 3 until they enter play, as on the table |
| Three face-down stacks | Three stacks beside the board; locked stacks are visibly covered by their mine |
| Belts | Chain-link belts in the owner's colour, bending between two holes of one tile |
| Control Modules (1–18) | Numbered square tiles in the owner's colour; unused ones sit in a 3×6 tray, used ones sit on buildings and leave an empty slot in the tray |
| Meeple | 3D meeple in the owner's colour, standing on a building or a mine slot |
| Ore, Plate, Sphere, Tesseract | 3D pieces in the print shapes (triangle, parallelogram, disc, cube) on buffers and in the player's area |
| Power Tokens | Round lightning-bolt tokens |
| Teleporters | The designer's teleporter piece in the owner's colour, standing beside the input it is on (each input of a Sphere or Tesseract Factory has its own, RULES_CHANGES.md #55) or beside the output (see D4) |
| Leverage cards | A deck and discard pile on the table; your hand fanned at the bottom of the screen |
| Bonus Tesseract cards | Face-up cards in front of the holder |
| Dice | One die per mine, rolled on the table |
| Starting-player piece | Sits in front of the starting player |

The table surface is dark wood, like the desk in the designer's photos.

### 5.2 Screen layout

**Desktop and landscape tablet**

- Centre: the table in isometric view.
- Top edge: one compact "seat plate" per opponent — colour, name, connection state, Tesseract progress (4 pips), and a count beside an icon of each component. Click one to see that player's full tray.
- Bottom edge: your area — module tray, meeple, power tokens, belts, teleporters, materials, and your hand of cards.
- Above your area: the **turn bar**. It shows the rulebook's steps as a row: ① Place a piece → ② Roll → ③ Actions → ④ Place meeple, plus the round-end step when it applies. The current step is highlighted and worded as an instruction ("Place a board piece next to the board").
- Bottom right: one **primary button** whose label is always the next thing to do ("Roll 2 dice", "Done with actions", "End turn").
- Right edge, collapsible: game log, rules reference, bonus cheat sheet, card list.

**Phone, portrait**

- Top 60%: the table. Opponents shrink to coloured chips along the top edge.
- Bottom: a sheet. Collapsed, it shows the turn bar, the primary button, and a one-line strip of your materials and power. Dragged up, it shows the module tray, your hand, and tabs for log and reference.
- Every touch target is at least 44 px. The primary button sits in the thumb zone.

**Camera:** drag to pan, pinch or wheel to zoom, a button rotates the table in 60° steps, another re-centres. A "top-down" toggle gives a flat view for precise belt work.

### 5.3 How a move is made

One pattern for every move: **pick up → see where it can go → put down → confirm.**

1. When it is your step, everything you may legally touch glows softly in your colour. Everything else does not react.
2. Touch a piece (a tile on a stack, a belt in your area, a module in your tray, a card in your hand). The places it can legally go light up on the board. These come straight from `legalActions`, so the interface can never offer an illegal move.
3. Touch a target. A translucent preview appears with ✓ confirm, ✕ cancel, and ⟳ rotate where rotation applies.
4. Confirm. The piece animates into place.

Touching a building you own opens a small menu on the building listing only what is possible right now, each with its cost: Claim or Upgrade (opens the module tray with only legal modules lit), Load input (only materials that keep a valid recipe), Collect output, Place teleporter (input or output), Operate.

Every engine action has exactly one gesture:

| Engine action | Gesture |
|---|---|
| `SETUP_CLAIM` | Touch a lit Plate Factory, then Power Plant; your "3" then "2" module flies from the tray |
| `PLACE_PIECE` | Touch an available stack → the top tile flips face-up in your hand → touch a lit cell → rotate → confirm |
| `ROLL_DICE` | Primary button "Roll N dice" (or touch the dice) |
| `OPERATE_BUILDING` / `SKIP_FACTORY_ROLL` | A prompt attached to the activated factory: "Operate: −1 power, ore → plate" or "Skip", with a countdown ring off-turn |
| `PLACE_BELT` | Touch a belt in your area → touch a lit hole → touch a second lit hole on the same tile. A route helper can lay a multi-tile chain from A to B using the existing router |
| `REMOVE_BELT`, `UNDO_BELTS` | Touch one of your belts → Remove; "Undo belts" button until the turn ends |
| `BUY_BELT`, `BUY_CARD`, `BUY_MINE`, `EXCHANGE_MATERIALS` | The bank area: touch the item; the price and what you will pay with are shown before confirming |
| `PLACE_MINE` | The mine lifts off its stack → touch a lit pair of cells → rotate → confirm |
| `PLACE_TELEPORTER` | Building menu → Teleporter → an input (each input of a Sphere or Tesseract Factory is its own lit target) or the output, with the current global price |
| `CLAIM_BUILDING`, `UPGRADE_BUILDING` | Building menu → tray opens → touch a lit module; cost shown in upgrade units |
| `LOAD_BUILDING_INPUT`, `COLLECT_OUTPUT` | Building menu, or drag a material from your area onto the input buffer |
| `PLAY_CARD` | Touch a card in your hand → it enlarges with its text → Play → follow the lit targets for that card |
| `PLACE_OVERSTOCK_PIECE` | Same as placing a piece, three times |
| `PLACE_MEEPLE` | Touch your meeple → touch a lit building or mine slot |
| `END_ACTIONS`, `END_TURN` | Primary button |

Feedback that makes the game readable:

- **Dice** tumble on the table. Buildings whose module matches the total flash, and the matching modules pulse.
- **Material moves visibly**: ore slides from the mine along belts into input buffers, products drop into output buffers, teleported material flies to its owner's area.
- **Why not?** Touching something that is not lit shows a one-line reason where the engine provides one ("Needs 2 power, you have 1").
- **Speed:** normal, fast, or no animation; bots can be instant.
- Haptic tick on confirm on phones that support it.

### 5.4 What the printed game looks like (the reference for every visual)

**The authoritative source is `G:\My Drive\Factory Speghetti\Factory Speghetti AMS.3mf`**, the designer's current multi-colour print file. Renders of the current tiles and mines are in `docs/reference/`. The photos of earlier prints (`Factory Spaghetti\2025*.jpg`) and many of the other `.3mf` files are out of date: they show gold buffer stubs, purple icons and the old starting mine. Sizes are from the print files.

| Piece | Current look | Size |
|---|---|---|
| Board tile | Light grey-white hexagon, 3 mm thick, with 12 half-round holes: two near each edge. The holes are the belt connection points. | 68.8 mm across flats |
| Blank tile | Plain, holes only | |
| Factory tile | A black square outline in the centre where the Control Module sits. **Black** belt stubs with arrow barbs run to the tile edges: inputs on one side pointing in (one for a Plate Factory, two for a Sphere Factory, three for a Tesseract Factory) and one output on the other side pointing out. **Light-green** icons show the materials: triangle = ore, parallelogram = plate, circle = sphere, four-point star = tesseract; the inputs are drawn as one combined shape. **Yellow lightning bolts** inside the square show the power cost (1, 2 or 3). | |
| Power Plant tile | Six black-outlined rectangles (solar panels), one black input stub, and a yellow bolt with a black "+" | |
| Mine 1 (starting mine) | Double hexagon. The first half has a black disc with tapered black rays running to the edges and fine engraved rings. The second half carries two black curved belt tracks running from the rays out to the far edges, a light-green double-triangle "+" (meeple slot: take ore) and a blue double-square "+" (meeple slot: Control Module upgrade). | 137.7 mm long |
| Mines 2 and 3 | Same rayed first half. The second half is plain apart from the two meeple slots: mine 2 has a green parallelogram "+" (plate) and a blue triple-square "+"; mine 3 has a green circle "+" (sphere) and a blue quadruple-square "+". | |
| Control Module | Matte square tile in the player's colour with a black numeral; 6 and 9 carry a bar. Eighteen sit in a black 3×6 tray; taking one out leaves an empty pocket. | ~15 mm |
| Belt | A flexible chain of arrow-shaped links in the player's colour, with an arrowhead at each end | 74 × 6.7 mm |
| Meeple | Flat silhouette in the player's colour | 19 mm |
| Ore | Light-green rounded triangle | 12 mm |
| Plate | Green parallelogram | 16 mm |
| Sphere | Lime-green disc with a bevelled edge | 14 mm |
| Tesseract | Yellow-green open cross made of intersecting square frames | 10 mm |
| Power Token | Yellow disc with an inlaid black lightning bolt | 22 mm |
| Starting-player piece | Tall yellow-green piece in the tesseract's shape | 46 mm |
| Teleporter | A small arched block in the player's colour, like a tunnel, with a round swirl-shaped portal on one end and a shallow foot under it. It has its own print file, `Teleporter.3mf`, in one colour. On the table it is drawn at three quarters of its printed size, lying beside the material of the input (or output) it is on and parallel to that stub, with the portal facing out towards the tile edge; each input of a Sphere or Tesseract Factory has its own spot (RULES_CHANGES.md #55). | 15 × 10.4 × 11.9 mm |

The material pieces are the same greens as the symbols on the tiles, so a symbol and the piece it stands for match by sight.

Player colours in the printed set: **blue, red, orange, green**.

No model exists yet for the leverage cards. The mock-ups use placeholders for these.

Milestone N4 converts these pieces from the AMS file into `public/models/`, with a gallery image in `docs/models/`.

The grey lunar-crater artwork in the rulebook diagrams does not appear on the printed tiles. See open decision D3.

### 5.5 Asset pipeline

- **Models.** A script (`tools/convert-3mf`) reads the `.3mf` print files, simplifies each mesh, and writes compact `.glb` files into `public/models`. The print files have 2,000–8,000 triangles per tile; engraved detail that is too fine for a phone is moved into a texture.
- **Colour.** `Factory Speghetti AMS.3mf` holds each colour as a separate part together with the filament colours, so models and colours both come from that one file. The single-piece print files carry no colour and are used only for pieces the AMS file lacks. Colour values are collected in one theme file.
- **Tile faces.** Plain printed look by default; see open decision D3.
- **Control Modules** are drawn as a rounded tile with a number texture rather than the 70,000-triangle engraved set.
- **Budget for a mid-range Android phone:** under 150 draw calls (instanced meshes per piece type), under 300,000 triangles on screen, pixel ratio capped at 2, and the scene redraws only while something moves or is touched, to save battery.

## 6. Milestones

Each milestone ends runnable and tested, as in the original build order.

| # | Milestone | Done when |
|---|---|---|
| N0 | **Restructure and deploy pipeline.** New folder layout on `main`, retire the 2D client and LAN server there, relative base path, version label, Pages workflow, install shell. | A placeholder page is live on GitHub Pages and installable; all engine, bot and simulator tests still pass in CI. |
| N1 | **Session layer, no network.** Room object, host session, client session, protocol, host-rolled seeded dice, seat checks, timers, bot seats, and the save format (pack, unpack, validate, version). | Vitest plays full bot games through a host and clients over the in-memory transport; tests cover refused moves, the re-send rule, both timeouts, and saving a game mid-way then resuming it to the same end result. A test fails if a 4-player save link exceeds 6,000 characters. |
| N2 | **Transports.** In-memory, same-browser tabs, PeerJS; message splitting; room codes; the three join errors; relay slot; network check page. | Two tabs play a game; two devices on different networks play a game. |
| N3 | **Menu and lobby.** Host, join, solo, invite link, seats, colours, bots, ready flags, settings; resume from this device, from a save link, and from a save file; the resume lobby. Uses a plain text view of the game so it can be tested before the 3D table exists. | A full online game can be started, left, rejoined and handed over to a new host using only the lobby and the text view; a game saved on a computer is resumed on a phone from a pasted link. |
| N4 | **Asset pipeline and piece gallery.** Convert the print files, build the theme, and show every piece on a gallery page. | The gallery page shows each piece type in each player colour and is approved against the photos. |
| N5 | **The table, read-only.** Render any game state in 3D with camera controls. | Bot-versus-bot games can be watched on a phone at a steady frame rate within the budget. |
| N6 | **Making moves.** Picking, lit legal targets, one gesture per engine action, previews, confirm and undo, prompts, timers. | A human can play a complete game against bots making every kind of move, and a scripted test confirms every action type is reachable from the interface. |
| N7 | **Player area and information.** Tray, hand, opponents, log, rules reference, bonus cheat sheet, game-over screen. | A new player can tell what they own, what others own, and whose turn it is without opening the log. |
| N8 | **Animation and feel.** Dice, material flow, placement, sound, haptics, speed settings. | Each roll's consequences can be followed by eye. |
| N9 | **Phone and install hardening.** Portrait sheet, install prompt, offline solo, wake lock, performance pass on a real Android phone. | Installed from Chrome on Android, a full solo game is comfortable one-handed. |
| N10 | **Online hardening.** Away policy and bot stand-in, hand-over tested with three browsers, relay decision implemented. | A 4-player game survives the host closing their tab mid-turn, and same-wifi players can join. |
| N11 | **Playtest tools.** Export and load a replay `(seed, moves)`, "report a rules problem" snapshot, config variants selectable in the lobby. | A disputed game can be replayed move by move from a pasted file. |

Order notes: N1–N3 (online) and N4–N5 (3D) do not depend on each other and can be built in parallel. N6 needs both.

## 7. Open decisions

Each has a default the work will follow unless changed.

| # | Decision | Default | Alternative |
|---|---|---|---|
| D1 | Hidden cards: send the full state to every player? | Yes. Simple, and any client can take over as host. A player using developer tools could peek. | Send each player a redacted copy; hand-over then needs an escrow scheme and is noticeably more work. |
| D2 | A disconnected player's turn | Wait 90 seconds, then a bot plays until they return. Host can override either way. | Always pause until they return; or skip their turn. |
| D3 | Tile faces | Printed-plastic tiles with colour inlays, exactly as in the designer's current print file. | Lunar crater artwork from the rulebook diagrams, as a second selectable skin. |
| D4 | Teleporter piece | Closed: the designer provided `Teleporter.3mf` (2026-11-27). The table draws that model in the owner's colour beside the buffer, in place of the stand-in ring used until then. | — |
| D5 | TURN relay for same-wifi and strict networks | Ship with the free PeerJS relays and an empty slot; pick a relay account before relying on in-person play. | Keep the LAN WebSocket server from `vite-prototype` as the in-person option. |
| D6 | GitHub Pages on a private repository | Assumed available on the account's plan. | Make the repository public, or publish from a separate public repository. |
| D7 | Rules values that differ between `RULES.md` and the card-text spreadsheet | Follow `RULES.md` and the engine: mines cost 6 and 18, Investor ≥10, Factory Empire ≥6, no "draw a card" step. | The spreadsheet lists 5 and 15, Investor 14+, Factory Empire 8+, and a card-draw step each turn. |
| D8 | Rules questions in `RULES_CHANGES.md` (OQ-1 to OQ-9) | Closed: the designer answered all of them on 2026-11-24; the engine follows the answers (`RULES_CHANGES.md` #35–#43). | — |
| D9 | Spectators | Not in the first version. | Read-only joiners beyond four. |
| D10 | How a save travels between devices | Save link first (about 2,000–4,000 characters), save file beside it, and automatic saves on every player's device. | Link only; or a short code backed by a small paid storage service, which would make links short but adds a server. |
