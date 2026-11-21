// Things drawn over the table that are not pieces: the soft glow on legal targets, the translucent
// ghost of a tile about to be placed, and the debug markers on every connection point.

import * as THREE from 'three';
import type { GameState } from '../engine/state';
import type { PointRole } from '../engine/config';
import type { Ghost, Target } from './types';
import { InstancedPart } from './scene';
import { partsOf, type ModelLib } from './models';
import {
  CARD, HEX_RADIUS, TILE_TOP, beltCurve, bufferSlotWorld, ghostPlacement, mineSlotWorld, modelFor,
  pieceCells, pointCount, pointRole, pointWorld, sampleCurve, curveFrameAt, axialToWorld,
  type SideLayout,
} from './layout';
import type { SideHeights } from './pick';

/** Flat ring geometry with soft alpha: rings[i] = [radius factor, alpha]; `sides` 6 = pointy-top hex. */
function softRing(sides: number, rings: ReadonlyArray<readonly [number, number]>, radius: number): THREE.BufferGeometry {
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const offset = sides === 6 ? -Math.PI / 6 : 0;
  for (const [f, a] of rings) {
    for (let i = 0; i < sides; i++) {
      const ang = offset + (i / sides) * Math.PI * 2;
      pos.push(Math.cos(ang) * radius * f, 0, Math.sin(ang) * radius * f);
      col.push(1, 1, 1, a);
    }
  }
  for (let r = 0; r < rings.length - 1; r++) {
    for (let i = 0; i < sides; i++) {
      const a = r * sides + i, b = r * sides + ((i + 1) % sides);
      const c = (r + 1) * sides + i, d = (r + 1) * sides + ((i + 1) % sides);
      idx.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
  g.setIndex(idx);
  return g;
}

/** Rounded-rectangle-ish soft frame for the deck (unit square, scaled per instance). */
function softRect(): THREE.BufferGeometry {
  // [half-width factor, half-depth factor, alpha]: fill, bright edge just outside the card, fade.
  const rings: ReadonlyArray<readonly [number, number, number]> = [[0, 0, 0.22], [0.5, 0.5, 0.22], [0.53, 0.53, 1], [0.58, 0.56, 0]];
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  for (const [fx, fz, a] of rings) for (const [cx, cz] of corners) { pos.push(cx! * fx, 0, cz! * fz); col.push(1, 1, 1, a); }
  for (let r = 0; r < rings.length - 1; r++) for (let i = 0; i < 4; i++) {
    const a = r * 4 + i, b = r * 4 + ((i + 1) % 4), c = (r + 1) * 4 + i, d = (r + 1) * 4 + ((i + 1) % 4);
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
  g.setIndex(idx);
  return g;
}

const ROLE_COLOR: Readonly<Record<PointRole, number>> = {
  input_buffer: 0x2196f3,
  output_buffer: 0x22c55e,
  belt: 0xf5f5f5,
  ore_output: 0xff9800,
  disabled: 0x8b1d1d,
};

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();
const Y = new THREE.Vector3(0, 1, 0);
function m4(x: number, y: number, z: number, sx = 1, sz = sx, yaw = 0): THREE.Matrix4 {
  return _m.compose(_v.set(x, y, z), _q.setFromAxisAngle(Y, yaw), _s.set(sx, 1, sz));
}

export class Overlay {
  readonly root = new THREE.Group();
  private readonly glowMaterial: THREE.MeshBasicMaterial;
  private readonly hexGlow: InstancedPart;
  private readonly spotGlow: InstancedPart;
  private readonly rectGlow: InstancedPart;
  private readonly markers: InstancedPart;
  private ghostGroup: THREE.Group | null = null;
  private ghostKey = '';
  private readonly ghostMaterials = new Map<string, THREE.MeshStandardMaterial>();
  debug = false;

  constructor(private readonly lib: ModelLib) {
    this.glowMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff, vertexColors: true, transparent: true, depthWrite: false, toneMapped: false,
      polygonOffset: true, polygonOffsetFactor: -4, side: THREE.DoubleSide,
    });
    // Hex: faint fill, bright band at the edge, soft fade outside.
    const hex = softRing(6, [[0, 0.07], [0.8, 0.1], [0.91, 0.5], [0.97, 0.5], [1.08, 0]], HEX_RADIUS);
    this.hexGlow = new InstancedPart(this.root, hex, this.glowMaterial, { order: 5 }, 32);
    const spot = softRing(28, [[0, 0.35], [0.55, 0.45], [0.75, 0.75], [1, 0]], 1);
    this.spotGlow = new InstancedPart(this.root, spot, this.glowMaterial, { order: 6 }, 32);
    this.rectGlow = new InstancedPart(this.root, softRect(), this.glowMaterial, { order: 5 }, 4);
    const disc = new THREE.CylinderGeometry(1, 1, 0.6, 16);
    this.markers = new InstancedPart(this.root, disc, new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false, toneMapped: false }), { colors: true, order: 20 }, 256);
  }

  setTargets(game: GameState | null, side: SideLayout, h: SideHeights, targets: readonly Target[], color: string): void {
    this.glowMaterial.color.set(color);
    this.hexGlow.begin(); this.spotGlow.begin(); this.rectGlow.begin();
    for (const t of targets) this.addGlow(game, side, h, t);
    this.hexGlow.end(); this.spotGlow.end(); this.rectGlow.end();
  }

  private addGlow(game: GameState | null, side: SideLayout, h: SideHeights, t: Target): void {
    const spot = (x: number, y: number, z: number, r: number): void => this.spotGlow.push(m4(x, y, z, r));
    if (t.kind === 'cell') { const c = axialToWorld(t); this.hexGlow.push(m4(c.x, 0.35, c.z)); return; }
    if (t.kind === 'stack') {
      const s = side.stacks[t.index];
      if (s) this.hexGlow.push(m4(s.x, h.stackTop(t.index) + 0.3, s.z, 1.04));
      return;
    }
    if (t.kind === 'deck') { this.rectGlow.push(m4(side.deck.x, h.pile('deck') + 0.3, side.deck.z, CARD.w, CARD.d)); return; }
    if (!game) return;
    if (t.kind === 'belt') {
      const b = game.belts.find(x => x.id === t.beltId);
      const piece = b && game.board.find(p => p.id === b.pieceId);
      if (!b || !piece) return;
      const s = sampleCurve(beltCurve(piece, b.fromPoint, b.toPoint), 32);
      const len = s.len[s.len.length - 1]!;
      const n = Math.max(2, Math.round(len / 3));
      for (let i = 0; i <= n; i++) { const f = curveFrameAt(s, i / n); spot(f.p.x, TILE_TOP + 5.6, f.p.z, 4.5); }
      return;
    }
    const piece = game.board.find(p => p.id === t.pieceId);
    if (!piece) return;
    switch (t.kind) {
      case 'piece':
        for (const c of pieceCells(piece)) { const w = axialToWorld(c); this.hexGlow.push(m4(w.x, TILE_TOP + 0.2, w.z)); }
        return;
      case 'point': {
        if (t.point < 0 || t.point >= pointCount(piece.type)) return;
        const p = pointWorld(piece, t.point);
        spot(p.x, TILE_TOP + 0.5, p.z, 5);
        return;
      }
      case 'buffer': {
        const buf = t.buffer === 'input' ? piece.input : piece.output;
        if (!buf) return;
        for (let i = 0; i < buf.slots.length; i++) { const p = bufferSlotWorld(piece, t.buffer, i); spot(p.x, TILE_TOP + 0.5, p.z, 8); }
        return;
      }
      case 'mineSlot': {
        if (piece.type !== 'mine') return;
        const p = mineSlotWorld(piece, t.slot);
        spot(p.x, TILE_TOP + 0.5, p.z, 13);
        return;
      }
    }
  }

  /** Markers on every connection point: blue input, green output, white belt, orange ore, small dark red disabled. */
  updateDebug(game: GameState | null): void {
    this.markers.begin();
    if (this.debug && game) {
      const c = new THREE.Color();
      for (const piece of game.board) {
        for (let pos = 0; pos < pointCount(piece.type); pos++) {
          const role = pointRole(piece.type, pos);
          const p = pointWorld(piece, pos);
          const r = role === 'disabled' ? 1.1 : 2.3;
          this.markers.push(m4(p.x, TILE_TOP + 0.6, p.z, r), c.setHex(ROLE_COLOR[role]));
        }
      }
    }
    this.markers.end();
  }

  setGhost(ghost: Ghost | null, game: GameState | null): void {
    const key = ghost ? `${ghost.pieceType}|${ghost.valid}|${game?.pendingMineIds[0] ?? game?.unplacedMines[0]?.id ?? ''}` : '';
    if (key !== this.ghostKey) {
      if (this.ghostGroup) { this.root.remove(this.ghostGroup); this.ghostGroup = null; }
      this.ghostKey = key;
      if (ghost) {
        const mineId = game?.pendingMineIds[0] ?? game?.unplacedMines[0]?.id ?? 'mine-2';
        const model = modelFor({ type: ghost.pieceType, id: ghost.pieceType === 'mine' ? mineId : 'ghost' });
        const g = new THREE.Group();
        // Translucent copy of the model, red-tinted when the placement is not legal.
        for (const part of partsOf(this.lib, model)) {
          const mesh = new THREE.Mesh(part.geometry, this.ghostMaterial(part.mat, ghost.valid));
          mesh.renderOrder = 10; // after the target glow, which lies underneath
          g.add(mesh);
        }
        this.ghostGroup = g;
        this.root.add(g);
      }
    }
    if (ghost && this.ghostGroup) {
      const mineId = game?.pendingMineIds[0] ?? game?.unplacedMines[0]?.id ?? 'mine-2';
      const pl = ghostPlacement(ghost.pieceType, ghost.q, ghost.r, ghost.rotation, mineId);
      this.ghostGroup.position.set(pl.x, 7, pl.z);
      this.ghostGroup.rotation.set(0, pl.yaw, 0);
    }
  }

  private ghostMaterial(src: THREE.MeshStandardMaterial, valid: boolean): THREE.MeshStandardMaterial {
    const k = `${src.uuid}|${valid}`;
    let m = this.ghostMaterials.get(k);
    if (!m) {
      m = src.clone();
      m.transparent = true;
      m.opacity = valid ? 0.88 : 0.75;
      m.depthWrite = false;
      if (!valid) { m.color.lerp(new THREE.Color(0xff2d2d), 0.65); m.emissive = new THREE.Color(0x550000); }
      else { m.emissive = new THREE.Color(0x2a3a2a); }
      this.ghostMaterials.set(k, m);
    }
    return m;
  }

  dispose(): void {
    for (const m of this.ghostMaterials.values()) m.dispose();
    this.root.clear();
  }
}
