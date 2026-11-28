// The 3D table: draws any engine GameState as the physical game, read-only for now.
// Renders on demand: a frame is drawn only when something changed, while an animation runs, or
// while the user drags / zooms. The one exception is the Teleporters' glowing portals (portal.ts):
// while at least one is on the board and the page is visible, they are redrawn a few times a second
// (PORTAL_FPS), without redrawing the shadow map; never when the player turned "Moving Teleporter
// portals" off (setPortalMotion) or, by default, with prefers-reduced-motion.

import * as THREE from 'three';
import type { GameState } from '../engine/state';
import { farDetail, loadModels, partsOf } from './models';
import { CameraRig } from './camera';
import { TableScene } from './scene';
import { Animator, type PiecePose } from './animator';
import { Overlay } from './overlay';
import { PreviewLayer } from './preview';
import { woodTexture } from './textures';
import { ACROSS_FLATS, TILE_TOP, boardBounds, tableBounds, type Bounds } from './layout';
import { frameAll, frameArea, keepInView as keepAreaInView, turnPivot, turnRefitArea, type FramingTable } from './framing';
import { seatAzimuth } from './seat';
import { BELT_PICK_Y, TELEPORTER_PICK_Y, boardCandidates, choose, rayBox, sideBoxes, targetAnchor, targetKey, type SideHeights } from './pick';
import { PORTAL_STILL_TIME } from './portal';
import { PLAYER_COLOR_HEX, type Ghost, type PlayerColor, type Table, type TableOptions, type TableStats, type Target } from './types';

const DEFAULT_COLORS: readonly PlayerColor[] = ['blue', 'red', 'orange', 'green'];
const TAP_SLOP_PX = 7;
/** Share of vertices kept in the far level of detail, per material (or model/material). */
const FAR_KEEP: Readonly<Record<string, number>> = { 'body': 0.3, 'mine-1/body': 0.35, 'belt/player': 0.35 };
/** Zoomed out past this many millimetres per CSS pixel (a tile under ~115 px wide), use far detail. */
const FAR_SCALE = 0.6;
/** How often the portals' swirl is redrawn while nothing else moves (frames a second). */
export const PORTAL_FPS = 15;

export async function createTable(canvas: HTMLCanvasElement, opts?: TableOptions): Promise<Table> {
  const lib = await loadModels(opts?.modelsBase ?? './models');
  // Zoomed out, a finished board (~97 tiles x 2,500 triangles + ~55 belts x 1,500) would exceed the
  // 300,000-triangle budget, so tile/mine bodies and belts switch to lighter copies.
  const farLib = await farDetail(lib, FAR_KEEP);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  // The shadow map is redrawn with every frame except the portal-only ones (see draw).
  renderer.shadowMap.autoUpdate = false;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1d130c);

  const wood = woodTexture();
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(12000, 12000),
    new THREE.MeshStandardMaterial({ map: wood, roughness: 0.82, metalness: 0 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.05;
  ground.receiveShadow = true;
  scene.add(ground);

  scene.add(new THREE.HemisphereLight(0xfff1e0, 0x3a2a1e, 1.25));
  const sun = new THREE.DirectionalLight(0xfff8ee, 2.3);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.4;
  sun.shadow.radius = 3;
  scene.add(sun, sun.target);
  const fill = new THREE.DirectionalLight(0xdfe8ff, 0.45);
  fill.position.set(400, 300, -300);
  scene.add(fill);

  const rig = new CameraRig();
  const table = new TableScene(lib, farLib);
  scene.add(table.root);
  const overlay = new Overlay(lib);
  scene.add(overlay.root);
  const previews = new PreviewLayer(lib, partsOf(lib, 'belt')[0]!.geometry);
  scene.add(previews.root);
  /** Set when the piles must be redrawn on the next frame (a preview picked up or put back a piece). */
  let pilesDirty = false;
  const animator = new Animator(table.root, (id) => table.colorOf(id));
  const animEndListeners = new Set<() => void>();

  let colors: readonly PlayerColor[] = DEFAULT_COLORS;
  table.setColors(colors.map(c => PLAYER_COLOR_HEX[c]));
  let game: GameState | null = null;
  let targets: readonly Target[] = [];
  let targetColor: PlayerColor = 'blue';
  let targetKeys = new Set<string>();
  let ghost: Ghost | null = null;
  let framedOnce = false;
  let lastBoardSize = 0;
  /** The table area the camera was last framed to (framing.ts). */
  let framedArea: Bounds | null = null;
  /** The player has dragged, pinched, scrolled, turned or tilted the view. */
  let touched = false;
  /** The player has panned or zoomed since the camera was last framed (turning by the button does not count). */
  let userMoved = false;
  /** A turn by the round button is under way: check the board is still in view when it ends. */
  let turnPending = false;
  /** The default view's azimuth (the player's side of the table). */
  let homeAz = 0;
  const pickers = new Set<(hit: Target | null, ev: { x: number; y: number }) => void>();
  const frameListeners = new Set<() => void>();
  let disposed = false;

  const heights: SideHeights = {
    stackTop: (i) => table.stackTopY(i),
    pile: (w) => table.deckHeight(w),
  };

  // ── Rendering on demand ──────────────────────────────────────────────────────────────────────
  let frameRequested = false;
  let lastAz = NaN;
  let stats: TableStats = { calls: 0, triangles: 0, frameMs: 0, frames: 0 };

  /** The WebGL context is gone (Android may take it when the app goes to the background). */
  let contextLost = false;

  /** Something besides the portals changed since the last frame: redraw the shadow map too. */
  let shadowDirty = true;

  function invalidate(): void {
    shadowDirty = true;
    requestFrame();
  }

  function requestFrame(): void {
    if (frameRequested || disposed || contextLost) return;
    frameRequested = true;
    requestAnimationFrame(frame);
  }

  // ── The portals' swirl: a slow redraw while a Teleporter is on the board ──
  const reducedMotion = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  /** The player's "Moving Teleporter portals" setting (setPortalMotion); null: follow the device (still with reduced motion). */
  let portalMotion: boolean | null = null;
  const portalsSwirl = (): boolean => portalMotion ?? !reducedMotion?.matches;
  let portalTimer: number | undefined;
  /** When the last frame was drawn (performance.now() ms). */
  let lastFrameAt = 0;
  const portalsMove = (): boolean =>
    table.portalCount > 0 && document.visibilityState === 'visible' && portalsSwirl() && !disposed && !contextLost;
  /**
   * Ask for the next portal frame 1/PORTAL_FPS s after the last frame, if the portals are to move
   * at all (the frame itself then waits for the screen's next refresh, about half a refresh on average).
   */
  function schedulePortals(): void {
    if (portalTimer !== undefined || !portalsMove()) return;
    const wait = Math.max(0, 1000 / PORTAL_FPS - (performance.now() - lastFrameAt) - 8);
    portalTimer = window.setTimeout(() => {
      portalTimer = undefined;
      if (portalsMove()) requestFrame();
    }, wait);
  }
  function stopPortals(): void {
    if (portalTimer !== undefined) window.clearTimeout(portalTimer);
    portalTimer = undefined;
  }
  const onVisibility = (): void => { if (document.visibilityState === 'visible') invalidate(); else stopPortals(); };
  const onMotionPref = (): void => { invalidate(); };
  document.addEventListener('visibilitychange', onVisibility);
  reducedMotion?.addEventListener?.('change', onMotionPref);

  function draw(now: number): boolean {
    let camMoving = rig.update(now);
    if (!camMoving && turnPending) {
      turnPending = false;
      afterTurn();
      camMoving = rig.animating;
    }
    table.setFar(rig.scale > FAR_SCALE);
    const wasAnimating = animator.active;
    animator.update(now);
    table.fx = animator.active ? animator : null;
    // Previews first: they tell the piles whether the drawn piece (or a waiting mine) is elsewhere.
    const hid = `${table.hidePileTop}|${table.hideMineId}`;
    previews.update(now, rig.azimuth, table);
    if (hid !== `${table.hidePileTop}|${table.hideMineId}`) pilesDirty = true;
    // The frame after a transition ends draws everything where the state says, once more.
    const settling = table.animating || wasAnimating;
    // Pieces only need rebuilding while they settle or while the view turns (modules face the viewer).
    if (settling || pilesDirty || rig.azimuth !== lastAz) {
      table.rebuild(now, rig.azimuth);
      lastAz = rig.azimuth;
      pilesDirty = false;
    }
    // A still swirl when portals are not to move (the setting, or reduced motion); otherwise it turns with the clock.
    table.setPortalTime(portalsSwirl() ? (now / 1000) % 3600 : PORTAL_STILL_TIME);
    renderer.shadowMap.needsUpdate = shadowDirty;
    shadowDirty = false;
    const t0 = performance.now();
    renderer.render(scene, rig.camera);
    stats = {
      calls: renderer.info.render.calls,
      triangles: renderer.info.render.triangles,
      frameMs: performance.now() - t0,
      frames: stats.frames + 1,
    };
    for (const fn of [...frameListeners]) fn();
    if (wasAnimating && !animator.active) for (const fn of [...animEndListeners]) fn();
    return camMoving || table.animating || previews.animating(now);
  }

  function frame(now: number): void {
    frameRequested = false;
    if (disposed || contextLost) return;
    lastFrameAt = performance.now();
    if (draw(now)) invalidate();
    else schedulePortals();
  }

  /** The board and everything beside it (piles laid out round the scene's growing pile area). */
  function neededArea(): Bounds {
    return game ? tableBounds(game, table.portrait, table.anchor ?? undefined) : boardBounds([]);
  }

  /** Height framing includes: the tallest stack plus a mine lying on it, so it is not cut off. */
  function stackTop(): number {
    return Math.max(20, ...[0, 1, 2].map(i => table.stackTopY(i) + TILE_TOP));
  }

  function fitShadow(): void {
    const b = neededArea();
    const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
    const span = Math.max(b.maxX - b.minX, b.maxZ - b.minZ) * 0.6 + 120;
    sun.position.set(cx - span * 0.55, span * 1.6, cz + span * 0.7);
    sun.target.position.set(cx, 0, cz);
    const cam = sun.shadow.camera;
    cam.left = -span; cam.right = span; cam.top = span; cam.bottom = -span;
    cam.near = 1; cam.far = span * 5;
    cam.updateProjectionMatrix();
    sun.target.updateMatrixWorld();
  }

  // ── Input: drag to pan, wheel / pinch to zoom, tap to pick ───────────────────────────────────
  canvas.style.touchAction = 'none';
  const pointers = new Map<number, { x: number; y: number; sx: number; sy: number }>();
  let dragged = false;
  let pinch: { d: number; mx: number; my: number } | null = null;

  const local = (e: PointerEvent | WheelEvent): { x: number; y: number } => {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  function onDown(e: PointerEvent): void {
    canvas.setPointerCapture(e.pointerId);
    const p = local(e);
    pointers.set(e.pointerId, { x: p.x, y: p.y, sx: p.x, sy: p.y });
    if (pointers.size === 1) dragged = false;
    if (pointers.size === 2) {
      dragged = true;
      const [a, b] = [...pointers.values()];
      pinch = { d: Math.hypot(a!.x - b!.x, a!.y - b!.y), mx: (a!.x + b!.x) / 2, my: (a!.y + b!.y) / 2 };
    }
  }

  function onMove(e: PointerEvent): void {
    const cur = pointers.get(e.pointerId);
    if (!cur) return;
    const p = local(e);
    if (pointers.size === 1) {
      if (!dragged && Math.hypot(p.x - cur.sx, p.y - cur.sy) > TAP_SLOP_PX) dragged = true;
      if (dragged) { touched = true; userMoved = true; rig.panPixels(cur.x, cur.y, p.x, p.y); invalidate(); }
      cur.x = p.x; cur.y = p.y;
      return;
    }
    cur.x = p.x; cur.y = p.y;
    if (pointers.size === 2 && pinch) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a!.x - b!.x, a!.y - b!.y);
      const mx = (a!.x + b!.x) / 2, my = (a!.y + b!.y) / 2;
      touched = true;
      userMoved = true;
      rig.panPixels(pinch.mx, pinch.my, mx, my);
      if (pinch.d > 0 && d > 0) rig.zoomAt(mx, my, d / pinch.d);
      pinch = { d, mx, my };
      invalidate();
    }
  }

  function onUp(e: PointerEvent): void {
    const cur = pointers.get(e.pointerId);
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    if (!cur || e.type === 'pointercancel') return;
    if (pointers.size === 0 && !dragged) {
      const p = local(e);
      const hit = pickAt(p.x, p.y);
      for (const fn of [...pickers]) fn(hit, p);
    }
  }

  function onWheel(e: WheelEvent): void {
    e.preventDefault();
    const p = local(e);
    const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    touched = true;
    userMoved = true;
    rig.zoomAt(p.x, p.y, Math.exp(-dy * 0.0015));
    invalidate();
  }

  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
  canvas.addEventListener('wheel', onWheel, { passive: false });

  // Context loss: keep the page (prevent the default), stop drawing; once the browser gives the
  // context back, Three.js uploads everything again on the next draw, so rebuild and draw the
  // current state (the table only draws on demand and would otherwise stay blank).
  function onContextLost(e: Event): void {
    e.preventDefault();
    contextLost = true;
    frameRequested = false;
  }
  function onContextRestored(): void {
    contextLost = false;
    lastAz = NaN;
    table.rebuild(performance.now(), rig.azimuth);
    fitShadow();
    invalidate();
  }
  canvas.addEventListener('webglcontextlost', onContextLost);
  canvas.addEventListener('webglcontextrestored', onContextRestored);

  function pickAt(px: number, py: number): Target | null {
    // Things standing beside the board first (they stand up off the table), then the board.
    const ray = rig.ray(px, py);
    let best: { t: number; target: Target } | null = null;
    for (const box of sideBoxes(table.side, heights, game ?? { stacks: [] as unknown as GameState['stacks'] })) {
      const t = rayBox(ray.origin, ray.direction, box.min, box.max);
      if (t !== null && (!best || t < best.t)) best = { t, target: box.target };
    }
    if (best) return best.target;
    const g = rig.groundAt(px, py, TILE_TOP);
    if (!g) return null;
    const b = rig.groundAt(px, py, BELT_PICK_Y) ?? g;
    const t = rig.groundAt(px, py, TELEPORTER_PICK_Y) ?? g;
    return choose(boardCandidates(game ?? { board: [], belts: [] }, g.x, g.z, { x: b.x, z: b.z }, { x: t.x, z: t.z }), targetKeys);
  }

  // ── Public interface ─────────────────────────────────────────────────────────────────────────
  function resize(): void {
    const w = canvas.clientWidth || canvas.width || 1;
    const h = canvas.clientHeight || canvas.height || 1;
    renderer.setSize(w, h, false);
    rig.setSize(w, h);
    const portrait = h > w * 1.15;
    if (portrait !== table.portrait) {
      table.portrait = portrait;
      table.updateSide();
      table.rebuild(performance.now(), rig.azimuth);
      refreshTargets();
      fitShadow();
    }
    invalidate();
  }

  function framingTable(): FramingTable {
    return { board: boardBounds(game?.board ?? []), needed: neededArea(), stackTop: stackTop() };
  }

  function recenter(animate = true): void {
    framedArea = frameAll(rig, framingTable(), animate);
    userMoved = false;
    invalidate();
  }

  /** Re-frame only when something that must be seen would be out of view (framing.ts). */
  function keepInView(): void {
    if (!game) return;
    const area = keepAreaInView(rig, framingTable(), framedArea);
    if (!area) return;
    framedArea = area;
    userMoved = false;
    invalidate();
  }

  /** A turn by the round button has ended: frame again if the board left the free area (framing.ts). */
  function afterTurn(): void {
    if (!game) return;
    const t = framingTable();
    const area = turnRefitArea({ framed: framedArea, needed: t.needed, userMoved, boardVisible: rig.boxVisible(t.board, TILE_TOP) });
    if (!area) return;
    frameArea(rig, t, area, true, true);
    framedArea = area;
  }

  function refreshTargets(): void {
    overlay.setTargets(game, table.side, heights, targets, PLAYER_COLOR_HEX[targetColor]);
  }

  resize();
  table.rebuild(performance.now(), rig.azimuth);
  recenter(false);

  function showGame(next: GameState | null): void {
    game = next;
    table.setGame(next, performance.now());
    table.rebuild(performance.now(), rig.azimuth);
    overlay.updateDebug(game);
    refreshTargets();
    overlay.setGhost(ghost, game);
    fitShadow();
    const size = next?.board.length ?? 0;
    // Frame the table the first time a game appears, and again for a board with fewer pieces
    // (another game, or a replay going back); otherwise the camera moves only when asked
    // (recenter, keepInView).
    if (next && (!framedOnce || (size < lastBoardSize))) { recenter(framedOnce); framedOnce = true; }
    lastBoardSize = size;
    invalidate();
  }

  function stopAnimation(): void {
    if (!animator.active) return;
    animator.finish();
    table.fx = null;
    for (const fn of [...animEndListeners]) fn();
  }

  const api: Table = {
    setGame(next) {
      stopAnimation();
      showGame(next);
    },
    animateTo(next, steps, scale = 1) {
      stopAnimation();
      const prev = game;
      const now = performance.now();
      const placed = steps.filter(s => s.kind === 'place').map(s => (s as { pieceId: string }).pieceId);
      // A piece placed where a player was previewing it starts from the preview, not its pile.
      const from = new Map<string, PiecePose>();
      for (const id of placed) {
        const piece = next.board.find(p => p.id === id);
        const pose = piece ? previews.piecePoseAt(piece.type, piece.coord.q, piece.coord.r, piece.rotation ?? 0, now, table) : null;
        if (pose) from.set(id, { x: pose.x, y: pose.y, z: pose.z, yaw: pose.yaw });
        // The placed piece replaces its preview (no preview flying back to the pile).
        if (pose && piece) previews.consume({ kind: 'piece', type: piece.type, q: piece.coord.q, r: piece.coord.r, rotation: piece.rotation ?? 0 });
      }
      for (const s of steps) if (s.kind === 'meeple') previews.consume({ kind: 'meeple', playerId: s.player });
      showGame(next);
      table.clearAppear(placed);
      animator.start(prev, next, steps, scale, now, table.side, from);
      table.fx = animator.active ? animator : null;
      if (animator.active) table.rebuild(now, rig.azimuth);
      invalidate();
    },
    finishAnimation() {
      if (!animator.active) return;
      stopAnimation();
      table.rebuild(performance.now(), rig.azimuth);
      invalidate();
    },
    isAnimating() { return animator.active; },
    onAnimationEnd(fn) {
      animEndListeners.add(fn);
      return () => { animEndListeners.delete(fn); };
    },
    setPlayerColors(next) {
      colors = next.length > 0 ? next : DEFAULT_COLORS;
      table.setColors(colors.map(c => PLAYER_COLOR_HEX[c]));
      table.rebuild(performance.now(), rig.azimuth);
      invalidate();
    },
    setTargets(next, color) {
      targets = [...next];
      targetColor = color;
      targetKeys = new Set(targets.map(targetKey));
      refreshTargets();
      invalidate();
    },
    setGhost(next) {
      ghost = next ? { ...next } : null;
      overlay.setGhost(ghost, game);
      invalidate();
    },
    setRoute(segments, color) {
      previews.setRoute(segments, PLAYER_COLOR_HEX[color] ?? PLAYER_COLOR_HEX.blue);
      invalidate();
    },
    setPreview(playerId, preview) {
      previews.setPreview(playerId, preview ? { ...preview } : null, performance.now(), table, (id) => table.colorOf(id));
      pilesDirty = true;
      invalidate();
    },
    onPick(fn) {
      pickers.add(fn);
      return () => { pickers.delete(fn); };
    },
    screenPosition(of) {
      const a = targetAnchor(game, table.side, heights, of);
      if (!a) return null;
      return rig.project(a.x, a.y, a.z);
    },
    rotateBy(steps) {
      if (steps === 0) return;
      touched = true;
      // Turn about the framed content (or, after a pan or zoom, the middle of the free area), so
      // it stays where it is on the screen; when the turn ends, the board is checked (afterTurn).
      rig.rotateBy(steps, turnPivot(framedArea, userMoved));
      turnPending = true;
      invalidate();
    },
    recenter() { recenter(true); },
    keepInView,
    setHomeView(seat, seatCount) {
      const az = seat === null ? 0 : seatAzimuth(seat, seatCount);
      if (Math.abs(az - homeAz) < 1e-9) return;
      homeAz = az;
      // Never turn the view away from where the player has put it.
      if (touched) return;
      rig.turnTo(az, framedOnce);
      if (framedOnce) recenter(true);
      invalidate();
    },
    setTopDown(on) {
      touched = true;
      rig.setTopDown(on);
      invalidate();
    },
    resize,
    setViewport(insets, opts) {
      const minTile = opts?.minTilePx;
      // ACROSS_FLATS millimetres must span at least minTile CSS pixels.
      rig.setInsets(insets, minTile && minTile > 0 ? ACROSS_FLATS / minTile : undefined);
    },
    onFrame(fn) {
      frameListeners.add(fn);
      return () => { frameListeners.delete(fn); };
    },
    dispose() {
      disposed = true;
      stopPortals();
      document.removeEventListener('visibilitychange', onVisibility);
      reducedMotion?.removeEventListener?.('change', onMotionPref);
      frameListeners.clear();
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('webglcontextlost', onContextLost);
      canvas.removeEventListener('webglcontextrestored', onContextRestored);
      pickers.clear();
      animEndListeners.clear();
      animator.dispose();
      previews.dispose();
      table.dispose();
      overlay.dispose();
      wood.dispose();
      for (const parts of farLib.values()) for (const p of parts) p.geometry.dispose();
      for (const parts of lib.values()) for (const p of parts) { p.geometry.dispose(); p.mat.dispose(); }
      renderer.dispose();
      // Give the WebGL context back now: browsers allow only a few at once, and a player may leave
      // and open games many times in one visit.
      renderer.forceContextLoss();
    },
    setDebugPoints(on) {
      overlay.debug = on;
      overlay.updateDebug(game);
      invalidate();
    },
    stats() { return stats; },
    setPortalMotion(on) {
      portalMotion = on;
      if (!portalsSwirl()) stopPortals();
      invalidate();
    },
    renderNow() {
      if (contextLost) return;
      frameRequested = false;
      shadowDirty = true;
      draw(performance.now());
      // Same frame again without redrawing the shadow map: the visible pass on its own.
      renderer.shadowMap.needsUpdate = false;
      renderer.render(scene, rig.camera);
      stats = { ...stats, mainCalls: renderer.info.render.calls, mainTriangles: renderer.info.render.triangles };
    },
  };
  return api;
}
