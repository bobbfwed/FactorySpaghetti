// The 3D table: draws any engine GameState as the physical game, read-only for now.
// Renders on demand: a frame is drawn only when something changed, while an animation runs, or
// while the user drags / zooms.

import * as THREE from 'three';
import type { GameState } from '../engine/state';
import { farDetail, loadModels, partsOf } from './models';
import { CameraRig } from './camera';
import { TableScene } from './scene';
import { Animator, type PiecePose } from './animator';
import { Overlay } from './overlay';
import { PreviewLayer } from './preview';
import { woodTexture } from './textures';
import { ACROSS_FLATS, TILE_TOP, boardBounds, tableBounds } from './layout';
import { BELT_PICK_Y, boardCandidates, choose, rayBox, sideBoxes, targetAnchor, targetKey, type SideHeights } from './pick';
import { PLAYER_COLOR_HEX, type Ghost, type PlayerColor, type Table, type TableOptions, type TableStats, type Target } from './types';

const DEFAULT_COLORS: readonly PlayerColor[] = ['blue', 'red', 'orange', 'green'];
const TAP_SLOP_PX = 7;
/** Share of vertices kept in the far level of detail, per material (or model/material). */
const FAR_KEEP: Readonly<Record<string, number>> = { 'body': 0.3, 'mine-1/body': 0.35, 'belt/player': 0.35 };
/** Zoomed out past this many millimetres per CSS pixel (a tile under ~115 px wide), use far detail. */
const FAR_SCALE = 0.6;

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
  renderer.shadowMap.autoUpdate = true;

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

  function invalidate(): void {
    if (frameRequested || disposed || contextLost) return;
    frameRequested = true;
    requestAnimationFrame(frame);
  }

  function draw(now: number): boolean {
    const camMoving = rig.update(now);
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
    if (draw(now)) invalidate();
  }

  function fitShadow(): void {
    const b = game ? tableBounds(game, table.portrait) : boardBounds([]);
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
      if (dragged) { rig.panPixels(cur.x, cur.y, p.x, p.y); invalidate(); }
      cur.x = p.x; cur.y = p.y;
      return;
    }
    cur.x = p.x; cur.y = p.y;
    if (pointers.size === 2 && pinch) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a!.x - b!.x, a!.y - b!.y);
      const mx = (a!.x + b!.x) / 2, my = (a!.y + b!.y) / 2;
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
    return choose(boardCandidates(game ?? { board: [], belts: [] }, g.x, g.z, { x: b.x, z: b.z }), targetKeys);
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

  function recenter(animate = true): void {
    const b = game ? tableBounds(game, table.portrait) : boardBounds([]);
    // Include the tallest stack (plus a mine lying on it) so it is not cut off at the top.
    const top = Math.max(20, ...[0, 1, 2].map(i => table.stackTopY(i) + TILE_TOP));
    rig.frame(b, animate, top);
    invalidate();
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
    // Frame the board the first time it appears; afterwards leave the camera where the user put it.
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
      }
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
      rig.rotateBy(steps);
      invalidate();
    },
    recenter() { recenter(true); },
    setTopDown(on) {
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
    renderNow() {
      if (contextLost) return;
      frameRequested = false;
      draw(performance.now());
      // Same frame again without redrawing the shadow map: the visible pass on its own.
      renderer.shadowMap.autoUpdate = false;
      renderer.render(scene, rig.camera);
      renderer.shadowMap.autoUpdate = true;
      stats = { ...stats, mainCalls: renderer.info.render.calls, mainTriangles: renderer.info.render.triangles };
    },
  };
  return api;
}
