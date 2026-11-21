# Trying Factory Spaghetti on your own devices

About 30 minutes. You need an Android phone with Chrome, and a second device (another phone, a tablet or a computer). Open the game at its web address (the one ending in `/FactorySpaghetti/`). Button names below are the ones on screen.

For every step: **do** it, check that the **expected** thing happens, and if it does not, **write down** the step number, which device, what you saw (a screenshot helps) and the version number shown at the bottom of the start menu.

## 1. Install and play offline (Android phone)

1. Open the game in Chrome. *Expected:* the start menu shows **Install app** near the bottom. Tap it. *Expected:* the app installs and opens full screen, without an address bar, and the install hint is gone.
2. Leave the app open on the start menu for about 10 seconds, while online.
3. Turn on airplane mode. Close the app completely, then open it from the home screen. *Expected:* the start menu appears.
4. Tap **Host a game**. *Expected:* at once, a message that hosting needs an internet connection.
5. Tap **Play solo vs bots**, then **Start**. *Expected:* the 3D table appears. Play for two minutes (or turn on **Autoplay my seat** in the game menu) without touching the screen. *Expected:* the screen does not dim or lock.
6. Use **Leave game** in the game menu. *Expected:* the screen dims on its usual timeout again.
7. On the start menu, tap **Resume** next to the game you just left, then **Host this game** and **Continue game**. *Expected:* the game continues, still in airplane mode.
8. Turn airplane mode off. Rotate the phone during a game. *Expected:* both upright and sideways work, and nothing hides under the camera notch or the bottom gesture bar.
9. Pull down on the lobby and on the game. *Expected:* the page does not reload.
10. Next time a new version is published, open the app while online. *Expected:* **Update ready** with **Reload** appears; tapping it switches to the new version.

Write down: which step failed, and for 5 whether the screen dimmed.

## 2. Two devices on different networks

Use the phone on mobile data (wifi off) and the second device on home wifi.

1. Device A: enter a name, tap **Host a game**. Note the five-letter room code. Tap **Copy invite link** and send it to device B (message or email).
2. Device B: open the link. *Expected:* the code is filled in; enter a name and tap **Join a game**. Both devices show both players in the lobby.
3. Both tap **Ready**; device A taps **Start**. Play a few turns. *Expected:* every move appears on the other device within a second or two.

Write down: how long joining took, and any error message word for word (it says whether the room was not found, the matchmaking service could not be reached, or the room was found but the devices could not connect).

## 3. Two devices on the same wifi

Repeat section 2 with both devices on the same wifi network.

**This is the case most likely to fail** until a relay server is set up: some home routers do not let two devices on the same network reach each other this way. The joining device then waits and shows *"Found the room, but could not connect to the host"*. If that happens, open **Network check** (link at the bottom of the start menu) on both devices and write down what it reports as reachable, plus the router make if you know it.

## 4. The host leaves and comes back

Use three devices if you can (two will also work).

1. Start a game. On another player's turn, close the host's tab or app completely. *Expected:* the others see *"Lost the connection to the host. Reconnecting…"*, then the game continues with another player as host, under the same room code, usually within half a minute.
2. When it is the absent player's turn, wait. *Expected:* after the away time chosen in the lobby (90 seconds unless changed), a bot plays that seat.
3. Reopen the game on the old host's device, enter the same name and the room code, tap **Join a game**. *Expected:* that player gets their seat back from the bot.

Write down: how long the takeover took, and whether any move made just before the host left was lost (if so, a message says so).

## 5. Continue a game on another device

1. During a game, open the game menu and tap **Copy save link**. Send the link to the other device and open it there. *Expected:* a "Resume a game" screen with the players' names. Choose who you are and tap **Host this game**; the game waits until **Continue game** is tapped. The others join with the new room code and the same names.
2. Do the same with **Download save file**: send the file and, on the other device, use **Load a save (link or file)** → **Choose a save file**.

Write down: whether the link arrived complete (some apps cut long links; the file always works).

## 6. Replays and reporting a rules problem

1. During a game, open the game menu → **Report a rules problem**. Write what you expected and what happened, then tap **Save the report file**. *Expected:* a file ending in `.fsreport` is saved. It holds the whole game, including every hand; send it to whoever checks the rules.
2. At the end of a game, tap **Save replay**. On any device, use **Watch a replay** on the start menu and choose the file. *Expected:* the game can be stepped through move by move, ending on the same final scores. A report file opens the same way, at the moment it was made, with the note shown.

Write down: anything shown in the replay that does not match what happened at the table.
