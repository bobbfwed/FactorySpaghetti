# Portal work package (wp/portal) - progress

- [x] Teleporter on its stub near the edge, portal facing in (layout.ts teleporterPlacement), scale 0.65.
- [x] Material of a teleported stub lies beside the teleporter (teleportedMaterialWorld); tests rewritten.
- [x] Tesseract meeple stays at the top right (still needed: input 3's moved material is where it stood).
- [ ] Portal shader (src/table/portal.ts), one instanced draw call, low-rate animation, reduced motion.
- [ ] Guide pictures and gallery share the portal; Teleporters scene camera.
- [ ] Screenshots, measurements, docs (PLAN.md Teleporter rows, docs/models/README.md).

Why the material moves: the stub between the tile edge and the module square is ~19 mm; a teleporter
plus a Plate behind it need ~25 mm, and with one Control Module turned to face the viewer only ~16 mm
are free. So the teleporter takes the material's place and the material lies beside it.
