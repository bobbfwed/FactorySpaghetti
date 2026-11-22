// What players are considering but have not done yet, shown to everyone: a planned belt route
// (drawn with the real belt model, solid / translucent / fading by what the player can afford) and
// one unconfirmed choice per player (a board piece or mine hovering over a space, or a meeple on a
// building or mine slot), each in its player's colour and animated when it changes.

import * as THREE from 'three';
import type { BoardPiece, GameState } from '../engine/state';
import type { Preview, RouteSegment, RouteTier } from './types';
import { partsOf, type ModelLib } from './models';
import { bendBeltItems, type BeltItem, type TableScene } from './scene';
import { softRing } from './overlay';
import {
  HEX_RADIUS, PENDING_MINE_LIFT, TILE_TOP, axialToWorld, buildingMeepleWorld, ghostPlacement,
  minePileAt, mineSlotWorld, modelFor, pieceCells, pointCount, type XZ,
} from './layout';

/** Height a previewed piece floats above the table: clearly not placed yet. */
export const PREVIEW_LIFT = 6;
const PIECE_OPACITY = 0.86;
const MEEPLE_OPACITY = 0.78;
const APPEAR_MS = 420;
const MOVE_MS = 320;
const LEAVE_MS = 340;
/** Route tiers other than the player's own belts (see PreviewLayer's routeMats). */
const ROUTE_BUY_COLOR = new THREE.Color(0xe8b730);
const ROUTE_CANT_COLOR = new THREE.Color(0x9a968e);
/** A route segment the player cannot afford yet fades in and out over this period. */
const CANT_PERIOD_MS = 1800;

interface Pose { x: number; y: number; z: number; yaw: number; fade: number }

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));
const easeInOut = (x: number): number => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

function turn(a: number, b: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

interface Entry {
  readonly playerId: number;
  readonly kind: 'piece' | 'meeple';
  readonly model: string;
  /** What is previewed now; null while it goes away. */
  target: Preview | null;
  /** Where the piece came from: the drawn piece above its pile, or a mine lying on its pile. */
  origin: 'pile' | { mineId: string } | null;
  readonly group: THREE.Group;
  readonly mats: THREE.MeshStandardMaterial[];
  readonly glow: THREE.Mesh;
  from: Pose;
  /** Fixed end pose while going away (else the target's pose, worked out each frame). */
  leaveTo: Pose | null;
  t0: number;
  dur: number;
  arc: number;
}

/** Depth-first translucency: a depth-only copy draws first, so only the front surface is blended. */
function translucentPair(geometry: THREE.BufferGeometry, mat: THREE.MeshStandardMaterial, order: number): [THREE.Mesh, THREE.Mesh] {
  const depth = new THREE.Mesh(geometry, DEPTH_ONLY);
  depth.renderOrder = order;
  const color = new THREE.Mesh(geometry, mat);
  color.renderOrder = order + 1;
  return [depth, color];
}

const DEPTH_ONLY = new THREE.MeshBasicMaterial({ colorWrite: false });

export class PreviewLayer {
  readonly root = new THREE.Group();
  private readonly entries = new Map<number, Entry>();
  private readonly hexGlowGeo: THREE.BufferGeometry;
  private readonly spotGlowGeo: THREE.BufferGeometry;

  // Route
  private route: readonly RouteSegment[] | null = null;
  private routeColor = new THREE.Color(0xffffff);
  private routeKey = '';
  private readonly routeMeshes: THREE.Mesh[] = [];
  private readonly routeMats: Record<RouteTier, THREE.MeshStandardMaterial>;
  private cantShown = false;

  constructor(private readonly lib: ModelLib, private readonly beltBase: THREE.BufferGeometry) {
    this.hexGlowGeo = softRing(6, [[0, 0.1], [0.78, 0.14], [0.9, 0.85], [0.97, 0.85], [1.1, 0]], HEX_RADIUS);
    this.spotGlowGeo = softRing(28, [[0, 0.3], [0.6, 0.4], [0.8, 0.85], [1, 0]], 12);
    const make = (opacity: number): THREE.MeshStandardMaterial => new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.55, metalness: 0, transparent: opacity < 1, opacity, depthWrite: opacity >= 1,
    });
    // Three tiers that must read apart at a glance: own belts solid in the seat colour, belts to buy
    // solid gold (the colour of prices and the buy button), belts for later grey and faint.
    this.routeMats = { own: make(1), buy: make(0.92), cant: make(0.35) };
  }

  // ── Route ────────────────────────────────────────────────────────────────────────────────────

  setRoute(segments: readonly RouteSegment[] | null, color: string): void {
    this.route = segments && segments.length > 0 ? [...segments] : null;
    this.routeColor = new THREE.Color(color);
    this.routeKey = '';
  }

  private buildRoute(game: GameState | null): void {
    const board = game?.board ?? [];
    const segs = (this.route ?? []).filter(s => {
      const p = board.find(b => b.id === s.pieceId);
      return !!p && s.from >= 0 && s.to >= 0 && s.from < pointCount(p) && s.to < pointCount(p) && s.from !== s.to;
    });
    const key = segs.map(s => `${s.pieceId}/${s.from}/${s.to}/${s.tier}`).join('|') + '#' + this.routeColor.getHexString()
      + '#' + segs.map(s => { const p = board.find(b => b.id === s.pieceId)!; return `${p.coord.q},${p.coord.r},${p.rotation ?? 0}`; }).join('|');
    if (key === this.routeKey) return;
    this.routeKey = key;
    for (const m of this.routeMeshes) { this.root.remove(m); m.geometry.dispose(); }
    this.routeMeshes.length = 0;
    this.cantShown = false;
    for (const tier of ['own', 'buy', 'cant'] as const) {
      const color = tier === 'own' ? this.routeColor : tier === 'buy' ? ROUTE_BUY_COLOR : ROUTE_CANT_COLOR;
      const items: BeltItem[] = segs.filter(s => s.tier === tier).map(s => ({
        piece: board.find(b => b.id === s.pieceId)!, from: s.from, to: s.to, color,
      }));
      if (items.length === 0) continue;
      const geo = bendBeltItems(this.beltBase, items);
      if (tier === 'own') {
        const m = new THREE.Mesh(geo, this.routeMats.own);
        m.castShadow = true;
        m.receiveShadow = true;
        this.routeMeshes.push(m);
      } else {
        this.routeMeshes.push(...translucentPair(geo, this.routeMats[tier], 8));
        if (tier === 'cant') this.cantShown = true;
      }
    }
    for (const m of this.routeMeshes) this.root.add(m);
  }

  // ── Previews ─────────────────────────────────────────────────────────────────────────────────

  setPreview(playerId: number, preview: Preview | null, now: number, scene: TableScene, colorOf: (id: number) => THREE.Color): void {
    const cur = this.entries.get(playerId);
    if (!preview) {
      if (!cur || !cur.target) return;
      const at = this.pose(cur, now, scene);
      cur.from = at;
      cur.t0 = now;
      cur.dur = LEAVE_MS;
      cur.leaveTo = this.leavePose(cur, at, scene, now);
      cur.arc = cur.kind === 'piece' && cur.origin ? 14 : 0;
      cur.target = null;
      return;
    }
    const kind = preview.k === 'piece' ? 'piece' : 'meeple';
    const model = preview.k === 'piece' ? this.pieceModel(preview, scene.game) : 'meeple';
    if (cur && cur.kind === kind && cur.model === model) {
      // Same thing, somewhere else: glide (a piece) or hop (a meeple) from where it is now.
      const at = this.pose(cur, now, scene);
      cur.target = preview;
      cur.from = at;
      cur.leaveTo = null;
      cur.t0 = now;
      cur.dur = MOVE_MS;
      cur.arc = kind === 'piece' ? 10 : 22;
      return;
    }
    if (cur) this.drop(cur);
    const e = this.create(playerId, kind, model, colorOf(playerId));
    e.target = preview;
    e.t0 = now;
    e.dur = APPEAR_MS;
    if (preview.k === 'piece') {
      const rev = scene.revealed();
      const pendingMine = scene.game?.pendingMineIds[0] ?? null;
      const target = this.targetPose(e, scene);
      if (preview.pieceType !== 'mine' && rev && rev.type === preview.pieceType && !this.pileClaimed(playerId)) {
        // Lifted off the drawn piece above its pile.
        const p = scene.revealedPoseNow(now);
        e.origin = 'pile';
        e.from = { x: p?.x ?? 0, y: (p?.y ?? 0) - TILE_TOP / 2, z: p?.z ?? 0, yaw: 0, fade: 1 };
        e.arc = 26;
      } else if (preview.pieceType === 'mine' && pendingMine && scene.game) {
        const m = minePileAt(scene.side, scene.game, pendingMine);
        e.origin = { mineId: pendingMine };
        e.from = { x: m.x, y: m.y + PENDING_MINE_LIFT, z: m.z, yaw: 0, fade: 1 };
        e.arc = 26;
      } else {
        e.from = target ? { ...target, y: target.y + 45, fade: 0 } : { x: 0, y: 45, z: 0, yaw: 0, fade: 0 };
        e.arc = 0;
      }
    } else {
      // A meeple drops in from above, as if leaving the player's supply.
      const target = this.targetPose(e, scene);
      e.from = target ? { ...target, y: target.y + 50, fade: 0.2 } : { x: 0, y: 50, z: 0, yaw: 0, fade: 0 };
      e.arc = 0;
    }
    this.entries.set(playerId, e);
  }

  /** Another player's preview already shows the drawn piece (only one can lift it off the pile). */
  private pileClaimed(except: number): boolean {
    for (const e of this.entries.values()) if (e.playerId !== except && e.origin === 'pile') return true;
    return false;
  }

  private pieceModel(p: Extract<Preview, { k: 'piece' }>, game: GameState | null): string {
    const mineId = game?.pendingMineIds[0] ?? game?.unplacedMines[0]?.id ?? 'mine-2';
    return modelFor({ type: p.pieceType, id: p.pieceType === 'mine' ? mineId : 'preview' });
  }

  private create(playerId: number, kind: 'piece' | 'meeple', model: string, color: THREE.Color): Entry {
    const group = new THREE.Group();
    const mats: THREE.MeshStandardMaterial[] = [];
    for (const part of partsOf(this.lib, model)) {
      const m = part.mat.clone();
      m.transparent = true;
      m.depthWrite = false;
      m.opacity = kind === 'piece' ? PIECE_OPACITY : MEEPLE_OPACITY;
      if (part.material === 'player') m.color.copy(color);
      mats.push(m);
      group.add(...translucentPair(part.geometry, m, 11));
    }
    const glowMat = new THREE.MeshBasicMaterial({
      color, vertexColors: true, transparent: true, depthWrite: false, toneMapped: false,
      polygonOffset: true, polygonOffsetFactor: -4, side: THREE.DoubleSide,
    });
    const glow = new THREE.Mesh(kind === 'piece' ? this.hexGlowGeo : this.spotGlowGeo, glowMat);
    glow.renderOrder = 6;
    // A mine covers two cells: a second ring.
    const glow2 = new THREE.Mesh(this.hexGlowGeo, glowMat);
    glow2.renderOrder = 6;
    glow2.visible = false;
    glow.add(glow2);
    group.visible = false;
    glow.visible = false;
    this.root.add(group, glow);
    return {
      playerId, kind, model, target: null, origin: null, group, mats, glow,
      from: { x: 0, y: 0, z: 0, yaw: 0, fade: 0 }, leaveTo: null, t0: 0, dur: 1, arc: 0,
    };
  }

  private drop(e: Entry): void {
    this.root.remove(e.group, e.glow);
    for (const m of e.mats) m.dispose();
    (e.glow.material as THREE.Material).dispose();
    this.entries.delete(e.playerId);
  }

  /** The cells a piece preview covers, and whether they are all still empty. */
  private pieceCellsOf(p: Extract<Preview, { k: 'piece' }>, game: GameState | null): { cells: XZ[]; free: boolean } {
    const fake = { type: p.pieceType, coord: { q: p.q, r: p.r }, rotation: p.rotation };
    const cells = pieceCells(fake);
    const board = game?.board ?? [];
    const free = cells.every(c => !board.some(b => pieceCells(b).some(d => d.q === c.q && d.r === c.r)));
    return { cells: cells.map(axialToWorld), free };
  }

  /** Where the preview should be (null: its space or piece no longer exists, so it is hidden). */
  private targetPose(e: Entry, scene: TableScene, az = 0): Pose | null {
    const t = e.target;
    if (!t) return null;
    const game = scene.game;
    if (t.k === 'piece') {
      if (!Number.isFinite(t.q) || !Number.isFinite(t.r)) return null;
      if (!this.pieceCellsOf(t, game).free) return null;
      const mineId = game?.pendingMineIds[0] ?? game?.unplacedMines[0]?.id ?? 'mine-2';
      const pl = ghostPlacement(t.pieceType, t.q, t.r, t.rotation, mineId);
      return { x: pl.x, y: PREVIEW_LIFT, z: pl.z, yaw: pl.yaw, fade: 1 };
    }
    const piece = game?.board.find(b => b.id === t.pieceId);
    if (!piece) return null;
    const at = meepleSpot(piece, t.slot);
    return { x: at.x, y: TILE_TOP + 0.6, z: at.z, yaw: az, fade: 1 };
  }

  private leavePose(e: Entry, at: Pose, scene: TableScene, now: number): Pose {
    if (e.kind === 'piece' && e.origin === 'pile') {
      // Back onto its pile, if that pile still holds it up.
      const p = scene.revealed() ? scene.revealedPoseNow(now) : null;
      if (p) return { x: p.x, y: p.y - TILE_TOP / 2, z: p.z, yaw: 0, fade: 1 };
    }
    if (e.kind === 'piece' && e.origin && e.origin !== 'pile' && scene.game?.pendingMineIds.includes(e.origin.mineId)) {
      const m = minePileAt(scene.side, scene.game, e.origin.mineId);
      return { x: m.x, y: m.y + PENDING_MINE_LIFT, z: m.z, yaw: 0, fade: 1 };
    }
    // Otherwise it lifts away and fades.
    return { ...at, y: at.y + 45, fade: 0 };
  }

  /** The pose of a preview at time `now`. */
  private pose(e: Entry, now: number, scene: TableScene, az = 0): Pose {
    const to = e.leaveTo ?? this.targetPose(e, scene, az) ?? e.from;
    const p = clamp01((now - e.t0) / e.dur);
    const k = easeInOut(p);
    // A meeple dropping in falls (accelerates) rather than easing.
    const ky = e.kind === 'meeple' && e.arc === 0 && !e.leaveTo ? 1 - Math.pow(1 - p, 2) * (1 - p) : k;
    return {
      x: e.from.x + (to.x - e.from.x) * k,
      y: e.from.y + (to.y - e.from.y) * ky + e.arc * Math.sin(Math.PI * k),
      z: e.from.z + (to.z - e.from.z) * k,
      yaw: e.kind === 'meeple' ? az : e.from.yaw + turn(e.from.yaw, to.yaw) * k,
      fade: e.from.fade + (to.fade - e.from.fade) * Math.min(1, p * 1.6),
    };
  }

  /** Lay everything out for time `now`; tells the scene what not to draw on the piles. */
  update(now: number, az: number, scene: TableScene): void {
    this.buildRoute(scene.game);
    if (this.cantShown) {
      this.routeMats.cant.opacity = 0.15 + 0.3 * (0.5 - 0.5 * Math.cos((2 * Math.PI * now) / CANT_PERIOD_MS));
    }
    let hidePile = false;
    let hideMine: string | null = null;
    for (const e of [...this.entries.values()]) {
      const done = now - e.t0 >= e.dur;
      if (!e.target && done) { this.drop(e); continue; }
      const valid = !e.target || this.targetPose(e, scene, az) !== null;
      e.group.visible = valid;
      e.glow.visible = valid && !!e.target;
      if (!valid) continue;
      const pose = this.pose(e, now, scene, az);
      // Fully faded: hidden altogether (its depth-only copy would still block what is behind).
      e.group.visible = pose.fade > 0.02;
      e.group.position.set(pose.x, pose.y, pose.z);
      e.group.rotation.set(0, pose.yaw, 0);
      const base = e.kind === 'piece' ? PIECE_OPACITY : MEEPLE_OPACITY;
      for (const m of e.mats) m.opacity = base * clamp01(pose.fade);
      if (e.origin === 'pile' && (e.target || !done)) hidePile = true;
      if (e.origin && e.origin !== 'pile' && (e.target || !done)) hideMine = e.origin.mineId;
      // The glow marks where the preview is (the target), on the table or the tile top.
      const t = e.target;
      const gm = e.glow.material as THREE.MeshBasicMaterial;
      gm.opacity = clamp01(pose.fade);
      if (t?.k === 'piece') {
        const { cells } = this.pieceCellsOf(t, scene.game);
        e.glow.position.set(cells[0]!.x, 0.4, cells[0]!.z);
        const second = e.glow.children[0]!;
        second.visible = cells.length > 1;
        if (cells[1]) second.position.set(cells[1].x - cells[0]!.x, 0, cells[1].z - cells[0]!.z);
      } else if (t?.k === 'meeple') {
        const tp = this.targetPose(e, scene, az);
        if (tp) e.glow.position.set(tp.x, TILE_TOP + 0.5, tp.z);
      }
    }
    scene.hidePileTop = hidePile;
    scene.hideMineId = hideMine;
  }

  /** True while something here moves (a preview animating, or a route segment fading in and out). */
  animating(now: number): boolean {
    if (this.cantShown) return true;
    for (const e of this.entries.values()) if (now - e.t0 < e.dur) return true;
    return false;
  }

  /** Where a previewed piece is drawn now, for each player whose preview shows exactly this piece placement. */
  /**
   * A move made what a preview showed: remove that preview at once (no leaving animation), so the
   * real piece or meeple takes its place. `kind` piece: the preview at this space and rotation;
   * meeple: the given player's meeple preview.
   */
  consume(match: { kind: 'piece'; type: string; q: number; r: number; rotation: number } | { kind: 'meeple'; playerId: number }): void {
    for (const e of [...this.entries.values()]) {
      const t = e.target;
      if (match.kind === 'meeple') { if (e.playerId === match.playerId && e.kind === 'meeple') this.drop(e); continue; }
      if (t?.k === 'piece' && t.pieceType === match.type && t.q === match.q && t.r === match.r
        && (((t.rotation % 6) + 6) % 6) === (((match.rotation % 6) + 6) % 6)) this.drop(e);
    }
  }

  piecePoseAt(type: string, q: number, r: number, rotation: number, now: number, scene: TableScene): Pose | null {
    for (const e of this.entries.values()) {
      const t = e.target;
      if (t?.k !== 'piece' || t.pieceType !== type || t.q !== q || t.r !== r || (((t.rotation % 6) + 6) % 6) !== (((rotation % 6) + 6) % 6)) continue;
      return this.pose(e, now, scene);
    }
    return null;
  }

  dispose(): void {
    for (const e of [...this.entries.values()]) this.drop(e);
    for (const m of this.routeMeshes) m.geometry.dispose();
    for (const m of Object.values(this.routeMats)) m.dispose();
    this.hexGlowGeo.dispose();
    this.spotGlowGeo.dispose();
    this.root.clear();
  }
}

function meepleSpot(piece: BoardPiece, slot: 0 | 1 | null): XZ {
  return piece.type === 'mine' ? mineSlotWorld(piece, slot ?? 0) : buildingMeepleWorld(piece);
}
