# Guide pictures: progress (delete in the last commit)

Plan: a `figure` block in the guide content (line-ups, staged 3D scenes, flat HTML items, callouts),
3D drawn once per figure by one shared offscreen WebGL renderer loaded with `import()`.

- [ ] figure types + render.ts block + CSS
- [ ] sceneState (scene description -> GameState) + engine legality tests
- [ ] figure cache (fake renderer in tests), mount (lazy, fallback icons)
- [ ] three renderer (src/ui/guide/figures/three.ts) using src/table scene code
- [ ] content: pictures in every topic, 6-10 scenes
- [ ] tests, typecheck, lint, build (bundle sizes before: main 505.00 kB, viewer 100.12 kB, three/table 696.48 kB)
- [ ] look at it in a browser, screenshots
