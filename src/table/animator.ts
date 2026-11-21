// Plays the table steps of a transition (see transition.ts) on the 3D scene. The scene already
// holds the new state; while a transition runs, the scene asks the animator, piece by piece,
// whether to draw something elsewhere (a tile still travelling from its stack), later (a belt not
// laid yet), smaller (a product popping out) or not at all, and draws the extra things that exist
// only in between (material travelling along a belt, inputs being used up, pulse rings, dice in
// the air). Time comes in through update(now); nothing here decides anything about the rules.

import * as THREE from 'three';
import type { BoardPiece, GameState, Material } from '../engine/state';
import {
  APOTHEM, DIE_SIZE, HEX_RADIUS, TILE_TOP, axialToWorld, bufferSlotWorld,
  buildingMeepleWorld, mineSlotWorld, piecePlacement, stackHeight, type SideLayout, type XZ,
} from './layout';
import { pointAlong } from './flowPath';
import { isTableStep, type AnimStep, type Buf } from './transition';

/** Where to draw a piece while it travels. */
export interface PiecePose { x: number; y: number; z: number; yaw: number }
export interface ExtraMaterial { material: Material; x: number; y: number; z: number; yaw: number; s: number }
export interface DiePose { x: number; y: number; z: number; rx: number; ry: number; rz: number; s: number }

/** What the scene asks while drawing (see TableScene). null = draw as the state says. */
export interface SceneFx {
  readonly active: boolean;
  piece(id: string): PiecePose | 'hide' | null;
  claim(pieceId: string, index: number): { y: number; s: number } | 'hide' | null;
  /** Scale of the material in a buffer slot (0 = not there yet). */
  slot(pieceId: string, buffer: Buf, index: number): number | null;
  teleporter(pieceId: string, buffer: Buf): number | null;
  meeple(player: number): { x: number; y: number; z: number } | 'hide' | null;
  /** 'hide' before the belt is laid, a height while it drops, null once it lies. */
  belt(id: string): number | 'hide' | null;
  die(index: number, rest: { x: number; z: number; yaw: number }): DiePose | null;
  extras(): readonly ExtraMaterial[];
}

type Timed = AnimStep & { t0: number; t1: number };

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));
const easeOut = (x: number): number => 1 - Math.pow(1 - x, 3);
const easeInOut = (x: number): number => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const easeBack = (x: number): number => { const c = 1.9; return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2); };

/** Shortest turn from a to b (radians). */
function turn(a: number, b: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/** A small deterministic hash so a transition always tumbles the same way. */
function hash(n: number): number {
  const x = Math.sin(n * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}

const RING_SEGMENTS = 48;

export class Animator implements SceneFx {
  private steps: Timed[] = [];
  private prev: GameState | null = null;
  private next: GameState | null = null;
  private side: SideLayout | null = null;
  private endAt = 0;
  private now = 0;
  private extraList: ExtraMaterial[] = [];
  private readonly rings: THREE.Mesh[] = [];
  private readonly ringGeo = new THREE.RingGeometry(0.78, 1, RING_SEGMENTS);
  private readonly glowGeo = new THREE.CircleGeometry(1, RING_SEGMENTS);

  constructor(private readonly root: THREE.Object3D, private readonly colorOf: (player: number) => THREE.Color) {
    this.ringGeo.rotateX(-Math.PI / 2);
    this.glowGeo.rotateX(-Math.PI / 2);
  }

  get active(): boolean { return this.steps.length > 0; }

  /** Start a transition from `prev` to `next` (the scene already shows `next`). */
  start(prev: GameState | null, next: GameState, steps: readonly AnimStep[], scale: number, now: number, side: SideLayout): void {
    this.prev = prev;
    this.next = next;
    this.side = side;
    const k = Math.max(0, scale);
    this.steps = steps.filter(isTableStep).map(s => ({ ...s, t0: now + s.at * k, t1: now + (s.at + Math.max(1, s.dur)) * k }));
    this.endAt = this.steps.reduce((m, s) => Math.max(m, s.t1), now);
    if (k === 0) this.steps = [];
    this.update(now);
  }

  /** Stop at once: everything is drawn as the state says. */
  finish(): void {
    this.steps = [];
    this.extraList = [];
    for (const r of this.rings) r.visible = false;
  }

  /** Move to time `now`. Returns true while something is still moving. */
  update(now: number): boolean {
    this.now = now;
    if (this.steps.length === 0) return false;
    if (now >= this.endAt) { this.finish(); return false; }
    this.extraList = [];
    let ring = 0;
    for (const s of this.steps) {
      const p = this.progress(s);
      if (s.kind === 'consume' && p < 1) {
        const piece = this.prev?.board.find(b => b.id === s.pieceId) ?? this.next?.board.find(b => b.id === s.pieceId);
        if (piece) {
          const at = bufferSlotWorld(piece, s.buffer, s.slot);
          const k = p <= 0 ? 1 : 1 - easeInOut(p);
          this.extraList.push({ material: s.material, x: at.x, y: TILE_TOP + 0.05 + 4 * Math.sin(Math.PI * clamp01(p)), z: at.z, yaw: piecePlacement(piece).yaw, s: 0.8 * k });
        }
      } else if (s.kind === 'flow' && p > 0 && p < 1) {
        const e = easeInOut(p);
        const at = pointAlong(s.path, e);
        // Drawn a little larger than a buffered piece, hopping along the belt, so it can be followed.
        this.extraList.push({ material: s.material, x: at.x, y: TILE_TOP + 1.5 + 4 * Math.abs(Math.sin(Math.PI * 4 * e)), z: at.z, yaw: e * 6, s: 1.1 });
      } else if (s.kind === 'pulse' && p > 0 && p < 1) {
        const piece = this.next?.board.find(b => b.id === s.pieceId);
        if (piece) ring = this.drawPulse(ring, piece, s.owner, p);
      }
    }
    for (let i = ring; i < this.rings.length; i++) this.rings[i]!.visible = false;
    return true;
  }

  private progress(s: Timed): number {
    if (this.now <= s.t0) return 0;
    if (this.now >= s.t1) return 1;
    return (this.now - s.t0) / (s.t1 - s.t0);
  }

  private drawPulse(i: number, piece: BoardPiece, owner: number | null, p: number): number {
    const c = piece.type === 'mine' ? piecePlacement(piece) : axialToWorld(piece.coord);
    const color = owner === null ? new THREE.Color(0xf2d16b) : this.colorOf(owner);
    // Two quick rings and a soft glow under them.
    for (const [k, phase] of [[0, 0], [1, 0.35]] as const) {
      const q = clamp01((p - phase) / 0.65);
      const mesh = this.ring(i++);
      mesh.visible = q > 0 && q < 1;
      const r = HEX_RADIUS * (0.55 + 0.75 * easeOut(q));
      mesh.scale.set(r, 1, r);
      mesh.position.set(c.x, TILE_TOP + 0.6 + k * 0.05, c.z);
      const mat = mesh.material as THREE.MeshBasicMaterial;
      mat.color.copy(color);
      mat.opacity = 0.95 * (1 - q);
    }
    const glow = this.ring(i++, true);
    glow.visible = true;
    const r = HEX_RADIUS * 0.95;
    glow.scale.set(r, 1, r);
    glow.position.set(c.x, TILE_TOP + 0.4, c.z);
    const gm = glow.material as THREE.MeshBasicMaterial;
    gm.color.copy(color);
    gm.opacity = 0.42 * Math.sin(Math.PI * p);
    return i;
  }

  private ring(i: number, glow = false): THREE.Mesh {
    let m = this.rings[i];
    const geo = glow ? this.glowGeo : this.ringGeo;
    if (!m) {
      m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, toneMapped: false }));
      m.renderOrder = 5;
      this.root.add(m);
      this.rings[i] = m;
    }
    if (m.geometry !== geo) m.geometry = geo;
    return m;
  }

  // ── Queries from the scene ─────────────────────────────────────────────────────────────────
  piece(id: string): PiecePose | 'hide' | null {
    for (const s of this.steps) {
      if (s.kind !== 'place' || s.pieceId !== id) continue;
      const p = this.progress(s);
      if (p >= 1) return null;
      const piece = this.next?.board.find(b => b.id === id);
      if (!piece) return null;
      const to = piecePlacement(piece);
      const from = this.placeFrom(s.stack, piece);
      if (p <= 0) return from ? { ...from } : 'hide';
      const e = easeInOut(p);
      if (!from) {
        // From above the board: drop with a little bounce.
        const y = 70 * Math.pow(1 - easeOut(p), 2);
        return { x: to.x, y, z: to.z, yaw: to.yaw };
      }
      const lift = 38 * Math.sin(Math.PI * e);
      return {
        x: from.x + (to.x - from.x) * e,
        y: from.y * (1 - e) + lift,
        z: from.z + (to.z - from.z) * e,
        yaw: from.yaw + turn(from.yaw, to.yaw) * easeInOut(clamp01((p - 0.15) / 0.75)),
      };
    }
    return null;
  }

  /** Where a placed piece starts: on top of its stack (a mine lies on its stack, rayed hex over it). */
  private placeFrom(stack: number | null, piece: BoardPiece): PiecePose | null {
    if (stack === null || !this.side || !this.prev) return null;
    const at = this.side.stacks[stack];
    if (!at) return null;
    const n = this.prev.stacks[stack]?.pieces.length ?? 0;
    if (piece.type === 'mine') return { x: at.x + APOTHEM, y: stackHeight(n) + 2, z: at.z, yaw: 0 };
    return { x: at.x, y: stackHeight(n), z: at.z, yaw: 0 };
  }

  private placing(pieceId: string): boolean {
    return this.steps.some(s => s.kind === 'place' && s.pieceId === pieceId && this.progress(s) < 1);
  }

  claim(pieceId: string, index: number): { y: number; s: number } | 'hide' | null {
    if (this.placing(pieceId)) return 'hide';
    let out: { y: number; s: number } | null = null;
    for (const s of this.steps) {
      if (s.kind === 'module' && s.pieceId === pieceId && s.index === index) {
        const p = this.progress(s);
        if (p >= 1) continue;
        if (!s.upgrade && p <= 0) return 'hide';
        if (s.upgrade) return { y: 16 * Math.sin(Math.PI * p), s: 1 + 0.3 * Math.sin(Math.PI * p) };
        const e = easeOut(p);
        return { y: 34 * (1 - e) + 3 * Math.sin(Math.PI * clamp01((p - 0.6) / 0.4)), s: 1.35 - 0.35 * e };
      }
      // Activated: the modules on the building hop.
      if (s.kind === 'pulse' && s.pieceId === pieceId) {
        const p = this.progress(s);
        if (p > 0 && p < 1) out = { y: 7 * Math.sin(Math.PI * p), s: 1 + 0.18 * Math.sin(Math.PI * p) };
      }
    }
    return out;
  }

  slot(pieceId: string, buffer: Buf, index: number): number | null {
    if (this.placing(pieceId)) return 0;
    for (const s of this.steps) {
      if ((s.kind === 'flow' && s.toPieceId === pieceId && buffer === 'input' && s.slot === index)
        || (s.kind === 'appear' && s.pieceId === pieceId && s.buffer === buffer && s.slot === index)) {
        const p = this.progress(s);
        if (p >= 1) continue;
        if (s.kind === 'flow') return 0;
        return p <= 0 ? 0 : Math.max(0.01, easeBack(p));
      }
    }
    return null;
  }

  teleporter(pieceId: string, buffer: Buf): number | null {
    if (this.placing(pieceId)) return 0;
    for (const s of this.steps) {
      if (s.kind !== 'teleporter' || s.pieceId !== pieceId || s.buffer !== buffer) continue;
      const p = this.progress(s);
      if (p >= 1) continue;
      return p <= 0 ? 0 : Math.max(0.01, easeBack(p));
    }
    return null;
  }

  meeple(player: number): { x: number; y: number; z: number } | 'hide' | null {
    for (const s of this.steps) {
      if (s.kind !== 'meeple' || s.player !== player) continue;
      const p = this.progress(s);
      if (p >= 1) continue;
      const pl = this.next?.players[player];
      const piece = pl?.meepleOnPieceId ? this.next?.board.find(b => b.id === pl.meepleOnPieceId) : undefined;
      if (!pl || !piece) return null;
      const to = meepleSpot(piece, pl.meepleSlotIndex);
      const fromPiece = s.fromPieceId ? this.prev?.board.find(b => b.id === s.fromPieceId) : undefined;
      const from = fromPiece ? meepleSpot(fromPiece, s.fromSlot) : null;
      if (!from) {
        if (p <= 0) return 'hide';
        return { x: to.x, y: TILE_TOP + 50 * Math.pow(1 - easeOut(p), 2), z: to.z };
      }
      const e = easeInOut(p);
      return { x: from.x + (to.x - from.x) * e, y: TILE_TOP + 0.05 + 26 * Math.sin(Math.PI * e), z: from.z + (to.z - from.z) * e };
    }
    return null;
  }

  belt(id: string): number | 'hide' | null {
    for (const s of this.steps) {
      if (s.kind !== 'belt' || s.beltId !== id) continue;
      const p = this.progress(s);
      if (p >= 1) return null;
      if (p <= 0) return 'hide';
      return 16 * Math.pow(1 - easeOut(p), 2);
    }
    // Belts on a tile still travelling are laid once it lands.
    const b = this.next?.belts.find(x => x.id === id);
    return b && this.placing(b.pieceId) ? 'hide' : null;
  }

  die(index: number, rest: { x: number; z: number; yaw: number }): DiePose | null {
    for (const s of this.steps) {
      if (s.kind !== 'dice') continue;
      const p = this.progress(s);
      if (p >= 1) return null;
      const seed = s.t0 * 0.001 + index * 7.31;
      // Thrown in from the board side, tumbling, bouncing twice and coming to rest.
      const dx = 150 + 50 * hash(seed), dz = -80 + 60 * hash(seed + 1);
      const e = easeOut(p);
      // Drawn larger while in the air so the throw reads at any zoom; full size once it lands.
      const sc = 1 + 0.9 * Math.pow(1 - e, 2);
      const h = (DIE_SIZE / 2) * sc + 95 * Math.pow(1 - p, 2) * Math.abs(Math.cos(2.6 * Math.PI * p));
      const spin = (1 - e) * (1 - e);
      return {
        x: rest.x + dx * (1 - e),
        y: h,
        z: rest.z + dz * (1 - e),
        rx: spin * (Math.PI * 4 + hash(seed + 2) * Math.PI) * 2,
        ry: rest.yaw + spin * Math.PI * 3 * (hash(seed + 3) - 0.5) * 2,
        rz: spin * (Math.PI * 3 + hash(seed + 4) * Math.PI) * 2,
        s: sc,
      };
    }
    return null;
  }

  extras(): readonly ExtraMaterial[] { return this.extraList; }

  dispose(): void {
    for (const r of this.rings) { this.root.remove(r); (r.material as THREE.Material).dispose(); }
    this.rings.length = 0;
    this.ringGeo.dispose();
    this.glowGeo.dispose();
  }
}

function meepleSpot(piece: BoardPiece, slot: number | null): XZ {
  return piece.type === 'mine' ? mineSlotWorld(piece, slot ?? 0) : buildingMeepleWorld(piece);
}

