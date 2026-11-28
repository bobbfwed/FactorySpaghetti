# Guide animated examples (wp/guideanim) - progress

Done
- Data format (figures/types.ts PlayExample), timeline builder (figures/play.ts), player state machine
  (figures/player.ts), Three.js live view sharing the guide's one renderer (figures/playView.ts, three.ts stage()),
  DOM stage + side panel + flights (figures/playMount.ts), render of the 'play' block, four examples (content/plays.ts)
  placed in Starting a game, Step 1, Step 2, Claiming. Tray model and TRAY_FIGURE removed (D1).

Left
- CSS for the example; browser check and tuning of frames/captions; screenshots.
- Tests: player state machine (fake clock), example replay + caption numbers, content checks.
- D2: recipes sorted by total value everywhere (one helper).
- Bundle sizes, idle frame rate.
