// The live view of the guide's animated examples: the game's own TableScene, Overlay and Animator
// in a scene of their own, drawn by the guide's one offscreen renderer (three.ts) and copied into
// the example's picture (a plain 2D canvas). Time comes in from the caller (draw(now)), so the
// example can be paused; nothing here runs a frame loop or a timer of its own. Part of the
// guide's Three.js chunk, loaded with import().

import * as THREE from 'three';
import type { ModelLib } from '../../../table/models';
import { TableScene } from '../../../table/scene';
import { Overlay } from '../../../table/overlay';
import { Animator } from '../../../table/animator';
import { CameraRig } from '../../../table/camera';
import { woodTexture } from '../../../table/textures';
import { PORTAL_STILL_TIME } from '../../../table/portal';
import { targetAnchor, type SideHeights } from '../../../table/pick';
import {
  TILE_TOP, axialToWorld, bufferAnchorWorld, mineSlotWorld, piecePlacement, pointWorld, beltCurve, sampleCurve, curveFrameAt,
  teleporterPlacement, TELEPORTER_HEIGHT, TELEPORTER_SCALE, type Bounds,
} from '../../../table/layout';
import type { AnimStep } from '../../../table/transition';
import type { Target } from '../../../table/types';
import type { GameState } from '../../../engine/state';
import type { PlayLook, PlayOverlay, PlayView } from './jobs';
import type { CalloutAt } from './types';

/** Where a numbered marker sits on the table (world millimetres). */
export function markAt(game: GameState, at: CalloutAt): { x: number; y: number; z: number } {
  if ('q' in at) { const c = axialToWorld(at); return { x: c.x, y: 1, z: c.z }; }
  const piece = game.board.find(p => p.id === at.piece);
  if (!piece) return { x: 0, y: 0, z: 0 };
  const y = TILE_TOP + 1;
  // Moved in towards the middle of the piece, so the marker sits beside the material in the buffer, not over it.
  if ('buffer' in at) {
    const c = bufferAnchorWorld(piece, at.buffer), m = piecePlacement(piece);
    const d = Math.hypot(c.x - m.x, c.z - m.z) || 1, k = Math.min(13, d * 0.5) / d;
    return { x: c.x + (m.x - c.x) * k, y, z: c.z + (m.z - c.z) * k };
  }
  if ('teleporter' in at) {
    const t = teleporterPlacement(piece, at.teleporter, at.slot ?? 0);
    return { x: t.x, y: TILE_TOP + TELEPORTER_HEIGHT * TELEPORTER_SCALE + 9, z: t.z };
  }
  if ('point' in at) { const c = pointWorld(piece, at.point); return { x: c.x, y, z: c.z }; }
  // Above the spot, clear of a meeple standing on it.
  if ('slot' in at) { const c = mineSlotWorld(piece, at.slot); return { x: c.x, y: y + 24, z: c.z }; }
  if ('belt' in at) {
    const belt = game.belts.filter(b => b.pieceId === piece.id)[at.belt];
    if (!belt) return { x: 0, y: 0, z: 0 };
    const f = curveFrameAt(sampleCurve(beltCurve(piece, belt.fromPoint, belt.toPoint), 32), 0.5);
    return { x: f.p.x, y: y + 1.5, z: f.p.z };
  }
  const c = piecePlacement(piece);
  return { x: c.x + (at.dx ?? 0), y: y + 2, z: c.z + (at.dz ?? 0) };
}

export interface PlayViewHost {
  readonly renderer: THREE.WebGLRenderer;
  readonly canvas: HTMLCanvasElement;
  readonly ratio: number;
  lost(): boolean;
}

export function createPlayView(host: PlayViewHost, lib: ModelLib): PlayView & { dispose(): void } {
  const { renderer, canvas, ratio } = host;
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xfff1e0, 0x3a2a1e, 1.25));
  const sun = new THREE.DirectionalLight(0xfff8ee, 2.3);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.4;
  sun.shadow.radius = 3;
  scene.add(sun, sun.target);
  const fill = new THREE.DirectionalLight(0xdfe8ff, 0.45);
  scene.add(fill);
  const wood = woodTexture();
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(12000, 12000), new THREE.MeshStandardMaterial({ map: wood, roughness: 0.82, metalness: 0 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.05;
  ground.receiveShadow = true;
  scene.add(ground);

  const table = new TableScene(lib);
  const overlay = new Overlay(lib);
  scene.add(table.root, overlay.root);
  const animator = new Animator(table.root, id => table.colorOf(id));
  table.setPortalTime(PORTAL_STILL_TIME);
  const heights: SideHeights = { stackTop: i => table.stackTopY(i), pile: w => table.deckHeight(w) };

  let look: PlayLook | null = null;
  let rig = new CameraRig();
  let az = 0;
  let alive = true;
  /** Something changed since the last frame that the scene must rebuild for. */
  let dirty = true;

  function light(b: Bounds): void {
    const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
    const span = Math.max(b.maxX - b.minX, b.maxZ - b.minZ) * 0.6 + 60;
    sun.position.set(cx - span * 0.55, span * 1.6, cz + span * 0.7);
    sun.target.position.set(cx, 0, cz);
    const cam = sun.shadow.camera;
    cam.left = -span; cam.right = span; cam.top = span; cam.bottom = -span;
    cam.near = 1; cam.far = span * 5;
    cam.updateProjectionMatrix();
    sun.target.updateMatrixWorld();
    fill.position.set(cx + 400, 300, cz - 300);
  }

  function placeSide(): void {
    if (look) table.side = look.layout.side;
  }

  const view: PlayView = {
    get alive() { return alive && !host.lost(); },
    ratio,
    use(next) {
      look = next;
      table.setColors(next.colors);
      rig = new CameraRig();
      rig.setSize(next.w, next.h);
      az = -next.layout.turn * Math.PI / 3;
      rig.turnTo(az, false);
      rig.frame(next.layout.bounds, false, next.layout.top, 1.04);
      light(next.layout.bounds);
      animator.finish();
      table.fx = null;
      table.setGame(null, performance.now());
      dirty = true;
    },
    show(game, o: PlayOverlay, now, settle = false) {
      animator.finish();
      table.fx = null;
      // A fresh start (no drop-in, no turning over) unless the caller wants pieces to settle.
      if (!settle) table.setGame(null, now);
      table.setGame(game, now);
      placeSide();
      overlay.setTargets(game, table.side, heights, o.glow ?? [], o.glowColor ?? '#e8b730');
      overlay.setGhost(o.ghost ?? null, game);
      dirty = true;
    },
    animate(next, steps: readonly AnimStep[], scale, now) {
      const prev = table.game;
      overlay.setTargets(next, table.side, heights, [], '#e8b730');
      overlay.setGhost(null, next);
      const placed = steps.filter(s => s.kind === 'place').map(s => (s as { pieceId: string }).pieceId);
      table.setGame(next, now);
      placeSide();
      table.clearAppear(placed);
      animator.start(prev, next, steps, scale, now, table.side);
      table.fx = animator.active ? animator : null;
      dirty = true;
    },
    draw(now, out) {
      if (!view.alive || !look) return false;
      const wasAnimating = animator.active;
      animator.update(now);
      table.fx = animator.active ? animator : null;
      const moving = table.animating || wasAnimating;
      if (moving || dirty) { table.rebuild(now, az); dirty = false; }
      renderer.setSize(look.w, look.h, false);
      renderer.render(scene, rig.camera);
      try {
        out.clearRect(0, 0, out.canvas.width, out.canvas.height);
        out.drawImage(canvas, 0, 0, out.canvas.width, out.canvas.height);
      } catch { /* the picture keeps its last frame */ }
      return table.animating || animator.active;
    },
    where(at, game) {
      if (!look) return null;
      let p: { x: number; y: number; z: number } | null;
      if ('kind' in at) p = targetAnchor(game, table.side, heights, at as Target);
      else p = markAt(game, at);
      if (!p) return null;
      const s = rig.project(p.x, p.y, p.z);
      return { x: s.x / look.w, y: s.y / look.h };
    },
  };

  return Object.assign(view, {
    dispose(): void {
      alive = false;
      try {
        animator.dispose();
        table.dispose();
        overlay.dispose();
        wood.dispose();
        ground.geometry.dispose();
        (ground.material as THREE.Material).dispose();
      } catch { /* already gone */ }
    },
  });
}
