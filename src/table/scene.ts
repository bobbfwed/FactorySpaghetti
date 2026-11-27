// Turns a GameState into Three.js objects: every model part is one InstancedMesh shared by all
// pieces of that type, so a full board stays well under the draw-call budget. Rebuilding the
// instance buffers is cheap (a few hundred matrices), so each update rewrites them from the state.

import * as THREE from 'three';
import type { BoardPiece, GameState, Material, PieceType, PlayerId } from '../engine/state';
import { partsOf, type ModelLib, type ModelPart } from './models';
import type { SceneFx } from './animator';
import { arrowEnds, beltHeadMap } from './beltArrows';
import {
  BELT_SPILL, BELT_TUCK, BUFFER_MATERIAL_SCALE, CARD, DIE_SIZE, HEX_RADIUS, PENDING_MINE_LIFT,
  POINT_INSET, REVEAL_LIFT, TELEPORTER_SCALE, TILE_MODEL, TILE_TOP,
  beltCurve, boardBounds, bufferSlotWorld, buildingMeepleWorld, claimLayout,
  curveFrameAt, mineModel, minePileAt, mineSlotWorld, modelToWorld, pieceCells, piecePlacement, pointNormal,
  pointWorld, revealedStack, sampleCurve, sideLayout, stackHeight, teleporterPlacement, axialToWorld, type ModelName,
  type Bounds, type SideLayout,
} from './layout';
import { sideAnchor } from './framing';
import { moduleColors } from './moduleLook';
import {
  cardBackTexture, cardFaceTexture, diceAtlas, diceCell, numeralAtlas, numeralCell,
  NUMERAL_COLS, NUMERAL_ROWS,
} from './textures';

const Y_AXIS = new THREE.Vector3(0, 1, 0);
const X_AXIS = new THREE.Vector3(1, 0, 0);
/** How long the drawn piece takes to flip face-up and rise off its pile. */
const FLIP_MS = 520;
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();

function mat4(x: number, y: number, z: number, yaw: number, s = 1): THREE.Matrix4 {
  _q.setFromAxisAngle(Y_AXIS, yaw);
  return _m.compose(_p.set(x, y, z), _q, _s.set(s, s, s));
}

/** One InstancedMesh that grows as needed; fill it with begin() / push() / end(). */
export class InstancedPart {
  mesh: THREE.InstancedMesh;
  private n = 0;
  private cap: number;

  constructor(
    private readonly parent: THREE.Object3D,
    private geometry: THREE.BufferGeometry,
    readonly material: THREE.Material,
    private readonly opts: { cast?: boolean; receive?: boolean; colors?: boolean; order?: number } = {},
    capacity = 16,
  ) {
    this.cap = capacity;
    this.mesh = this.make(capacity);
  }

  private make(cap: number): THREE.InstancedMesh {
    const m = new THREE.InstancedMesh(this.geometry, this.material, cap);
    m.castShadow = !!this.opts.cast;
    m.receiveShadow = !!this.opts.receive;
    m.frustumCulled = false;
    if (this.opts.order !== undefined) m.renderOrder = this.opts.order;
    if (this.opts.colors) m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3).fill(1), 3);
    m.count = 0;
    this.parent.add(m);
    return m;
  }

  begin(): void { this.n = 0; }

  /** Swap the shared geometry (level of detail); instances are kept. */
  setGeometry(g: THREE.BufferGeometry): void {
    this.geometry = g;
    this.mesh.geometry = g;
  }

  push(matrix: THREE.Matrix4, color?: THREE.Color): void {
    if (this.n >= this.cap) this.grow();
    this.mesh.setMatrixAt(this.n, matrix);
    if (color && this.mesh.instanceColor) this.mesh.setColorAt(this.n, color);
    this.n++;
  }

  end(): void {
    this.mesh.count = this.n;
    this.mesh.visible = this.n > 0;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  get count(): number { return this.n; }

  private grow(): void {
    const old = this.mesh;
    this.cap *= 2;
    this.mesh = this.make(this.cap);
    for (let i = 0; i < this.n; i++) {
      old.getMatrixAt(i, _m);
      this.mesh.setMatrixAt(i, _m);
      if (old.instanceColor && this.mesh.instanceColor) {
        const c = new THREE.Color();
        old.getColorAt(i, c);
        this.mesh.setColorAt(i, c);
      }
    }
    this.parent.remove(old);
    old.dispose();
  }

  dispose(): void {
    this.parent.remove(this.mesh);
    this.mesh.dispose();
  }
}

/**
 * Numeral decals on Control Modules: one instanced quad, each instance picks its atlas cell and
 * tints the white numeral with its own colour (near black, or dimmed for a module that cannot be rolled).
 */
class NumeralLayer {
  readonly part: InstancedPart;
  private cells: THREE.InstancedBufferAttribute;
  private readonly geometry: THREE.PlaneGeometry;

  constructor(parent: THREE.Object3D, texture: THREE.Texture) {
    this.geometry = new THREE.PlaneGeometry(13, 13);
    this.geometry.rotateX(-Math.PI / 2); // lie flat, numeral top towards -Z
    const material = new THREE.MeshStandardMaterial({ map: texture, alphaTest: 0.45, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -2 });
    material.onBeforeCompile = (shader): void => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec2 aCell;')
        .replace('#include <uv_vertex>', `#include <uv_vertex>\n#ifdef USE_MAP\nvMapUv = (vMapUv + aCell) * vec2(${(1 / NUMERAL_COLS).toFixed(6)}, ${(1 / NUMERAL_ROWS).toFixed(6)});\n#endif`);
    };
    this.cells = new THREE.InstancedBufferAttribute(new Float32Array(32), 2);
    this.geometry.setAttribute('aCell', this.cells);
    this.part = new InstancedPart(parent, this.geometry, material, { colors: true }, 16);
  }

  begin(): void { this.part.begin(); }

  push(matrix: THREE.Matrix4, numeral: number, color: THREE.Color): void {
    const i = this.part.count;
    if (i * 2 + 2 > this.cells.array.length) {
      const next = new THREE.InstancedBufferAttribute(new Float32Array(this.cells.array.length * 2), 2);
      (next.array as Float32Array).set(this.cells.array as Float32Array);
      this.cells = next;
      this.geometry.setAttribute('aCell', next);
    }
    const [cx, cy] = numeralCell(numeral);
    this.cells.setXY(i, cx, cy);
    this.part.push(matrix, color);
  }

  end(): void {
    this.cells.needsUpdate = true;
    this.part.end();
  }
}

export const MATERIALS: readonly Material[] = ['ore', 'plate', 'sphere', 'tesseract'];
const TILE_MODELS = Object.values(TILE_MODEL) as ModelName[];
const MINE_MODELS: readonly ModelName[] = ['mine-1', 'mine-2', 'mine-3'];
const DROP_MS = 320;
const DROP_HEIGHT = 22;

export class TableScene {
  readonly root = new THREE.Group();
  side: SideLayout = sideLayout(boardBounds([]), 1);
  game: GameState | null = null;

  private readonly tileParts = new Map<ModelName, InstancedPart[]>();
  private readonly mineGroups = new Map<ModelName, THREE.Group>();
  private readonly modules: InstancedPart;
  private readonly numerals: NumeralLayer;
  private readonly materialParts = new Map<Material, InstancedPart>();
  private readonly meeples: InstancedPart;
  private readonly teleporters: InstancedPart[];
  private readonly stackLayers: InstancedPart;
  private readonly stackTops: InstancedPart[] = [];
  private readonly shadowCasters: InstancedPart;
  private readonly beltBase: THREE.BufferGeometry;
  private readonly beltMaterial: THREE.MeshStandardMaterial;
  private beltMesh: THREE.Mesh | null = null;
  private beltKey = '';
  private readonly deck: { box: THREE.Mesh; top: THREE.Mesh };
  private readonly discard: { box: THREE.Mesh; top: THREE.Mesh };
  private discardCard: string | null | undefined = undefined;
  private readonly dice: THREE.Mesh[] = [];
  private readonly diceGeos = new Map<number, THREE.BoxGeometry>();
  private readonly diceMaterial: THREE.MeshStandardMaterial;
  private readonly appear = new Map<string, number>();
  private readonly known = new Set<string>();
  /** Which pile's piece is drawn face-up ("index:pieceId", '' for none), and when it began to flip. */
  private revealKey = '';
  private revealAt: number | null = null;
  private colors: THREE.Color[] = [];
  private readonly textures: THREE.Texture[] = [];

  private far = false;
  private readonly beltFar: THREE.BufferGeometry;
  /** A transition being played (N8): asked while drawing where things are in between two states. */
  fx: SceneFx | null = null;
  /** Belts dropping into place, drawn on their own until they lie (then merged with the rest). */
  private readonly dropBelts = new Map<string, THREE.Mesh>();

  /** `farLib`: the same models with lighter geometry, used when zoomed out (see models.ts farDetail). */
  constructor(private readonly lib: ModelLib, private readonly farLib: ModelLib = lib) {
    for (const name of TILE_MODELS) {
      this.tileParts.set(name, partsOf(lib, name).map(p => new InstancedPart(this.root, p.geometry, p.mat, { receive: true }, 32)));
    }
    for (const name of MINE_MODELS) {
      const g = new THREE.Group();
      g.name = name;
      for (const p of partsOf(lib, name)) {
        const m = new THREE.Mesh(p.geometry, p.mat);
        m.receiveShadow = true;
        g.add(m);
      }
      g.visible = false;
      this.root.add(g);
      this.mineGroups.set(name, g);
    }
    const cm = partsOf(lib, 'control-module')[0]!;
    this.modules = new InstancedPart(this.root, cm.geometry, cm.mat, { cast: true, receive: true, colors: true });
    const atlas = numeralAtlas();
    this.textures.push(atlas);
    this.numerals = new NumeralLayer(this.root, atlas);
    for (const m of MATERIALS) {
      const p = partsOf(lib, m)[0]!;
      this.materialParts.set(m, new InstancedPart(this.root, p.geometry, p.mat, { cast: true, receive: true }));
    }
    const meeple = partsOf(lib, 'meeple')[0]!;
    this.meeples = new InstancedPart(this.root, meeple.geometry, meeple.mat, { cast: true, receive: true, colors: true }, 4);

    // Teleporters: the designer's model, tinted with the owner's colour like the meeples (one
    // instanced mesh per colour part; the model has a single 'player' part).
    this.teleporters = partsOf(lib, 'teleporter').map(p => new InstancedPart(this.root, p.geometry, p.mat, { cast: true, receive: true, colors: p.material === 'player' }, 8));

    // Face-down stacks: plain hexagonal layers, with a real (flipped) blank tile on top so the
    // holes of the tile back show.
    const prism = new THREE.CylinderGeometry(HEX_RADIUS - 0.4, HEX_RADIUS - 0.4, TILE_TOP - 0.08, 6);
    prism.translate(0, (TILE_TOP - 0.08) / 2, 0);
    this.stackLayers = new InstancedPart(this.root, prism, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85 }), { cast: true, receive: true, colors: true }, 64);
    for (const p of partsOf(lib, 'tile-blank')) this.stackTops.push(new InstancedPart(this.root, p.geometry, p.mat, { cast: true, receive: true }, 4));

    // Invisible prisms under the board tiles: they cast the board's shadow cheaply (the detailed
    // tiles only receive shadows, which keeps the shadow pass small).
    const caster = new THREE.CylinderGeometry(HEX_RADIUS - 1, HEX_RADIUS - 1, TILE_TOP, 6);
    caster.translate(0, TILE_TOP / 2, 0);
    this.shadowCasters = new InstancedPart(this.root, caster, new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }), { cast: true }, 64);

    const belt = partsOf(lib, 'belt')[0]!;
    this.beltBase = belt.geometry;
    this.beltBase.computeBoundingBox();
    this.beltFar = partsOf(farLib, 'belt')[0]!.geometry;
    this.beltMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0 });

    const back = cardBackTexture();
    this.textures.push(back);
    this.deck = this.cardPile(back);
    this.discard = this.cardPile(null);
    const datlas = diceAtlas();
    this.textures.push(datlas);
    this.diceMaterial = new THREE.MeshStandardMaterial({ map: datlas, roughness: 0.45 });
  }

  private cardPile(top: THREE.Texture | null): { box: THREE.Mesh; top: THREE.Mesh } {
    const box = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0xe9e2cf, roughness: 0.9 }));
    box.castShadow = true;
    box.receiveShadow = true;
    const plane = new THREE.PlaneGeometry(CARD.w, CARD.d);
    plane.rotateX(-Math.PI / 2);
    const face = new THREE.Mesh(plane, new THREE.MeshStandardMaterial({ map: top, roughness: 0.6 }));
    face.receiveShadow = true;
    this.root.add(box, face);
    return { box, top: face };
  }

  /** Switch between full and light geometry. Returns true when something changed. */
  setFar(far: boolean): boolean {
    if (far === this.far) return false;
    this.far = far;
    const src = far ? this.farLib : this.lib;
    for (const [name, parts] of this.tileParts) {
      const geo = partsOf(src, name);
      parts.forEach((p, i) => p.setGeometry(geo[i]!.geometry));
    }
    for (const [name, g] of this.mineGroups) {
      const geo = partsOf(src, name);
      g.children.forEach((m, i) => { (m as THREE.Mesh).geometry = geo[i]!.geometry; });
    }
    this.beltKey = '';
    this.buildBelts(this.game);
    return true;
  }

  setColors(colors: readonly string[]): void {
    this.colors = colors.map(c => new THREE.Color(c));
    this.beltKey = '';
  }

  colorOf(id: PlayerId | number): THREE.Color {
    return this.colors[id] ?? new THREE.Color(0x888888);
  }

  setGame(game: GameState | null, now: number): void {
    const prevKnown = this.known.size > 0;
    if (game) {
      for (const p of game.board) {
        if (!this.known.has(p.id)) {
          this.known.add(p.id);
          if (prevKnown) this.appear.set(p.id, now);
        }
      }
    } else {
      this.known.clear();
      this.appear.clear();
    }
    // A board with fewer pieces than before is another game or a replay going back: the piles
    // are laid out afresh round it. During a game the board only grows.
    if (!game || game.board.length < (this.game?.board.length ?? 0)) this.anchor = null;
    this.game = game;
    this.updateSide();
    this.updateReveal(now, prevKnown && !!game);
  }

  /** Narrow screens put the card piles in front of the board instead of beside it. */
  portrait = false;
  /** The board area the piles are laid out around (framing.ts sideAnchor): only grows, in steps. */
  anchor: Bounds | null = null;

  updateSide(): void {
    const board = boardBounds(this.game?.board ?? []);
    this.anchor = this.game ? sideAnchor(this.anchor, board) : null;
    this.side = sideLayout(this.anchor ?? board, this.game?.mineCount ?? 1, this.portrait, this.game?.players.length ?? 4);
  }

  /** True while pieces are still settling. */
  get animating(): boolean { return this.appear.size > 0 || !!this.fx?.active || this.revealAt !== null; }

  /** Pieces an animated transition places itself: no plain drop-in for them. */
  clearAppear(ids: Iterable<string>): void {
    for (const id of ids) this.appear.delete(id);
  }

  private drop(id: string, now: number): number {
    const t0 = this.appear.get(id);
    if (t0 === undefined) return 0;
    const t = (now - t0) / DROP_MS;
    if (t >= 1) { this.appear.delete(id); return 0; }
    const k = 1 - Math.pow(1 - Math.max(0, t), 3);
    return DROP_HEIGHT * (1 - k);
  }

  /** Rewrite every instance buffer from the current state. `az` turns modules and meeples to face the viewer. */
  rebuild(now: number, az: number): void {
    const game = this.game;
    for (const parts of this.tileParts.values()) for (const p of parts) p.begin();
    this.modules.begin(); this.numerals.begin(); this.meeples.begin(); for (const p of this.teleporters) p.begin();
    for (const p of this.materialParts.values()) p.begin();
    this.shadowCasters.begin();
    for (const g of this.mineGroups.values()) g.visible = false;

    if (game) {
      for (const piece of game.board) this.addPiece(piece, now, az);
      this.addMeeples(game, az);
    }
    // Material that exists only in between two states (travelling, being used up).
    for (const e of this.fx?.extras() ?? []) {
      if (e.s > 0.01) this.materialParts.get(e.material)!.push(mat4(e.x, e.y, e.z, e.yaw, e.s));
    }
    // Piles (the drawn piece above its pile is one of the tile instances).
    this.buildStacks(game, now);
    for (const parts of this.tileParts.values()) for (const p of parts) p.end();
    this.modules.end(); this.numerals.end(); this.meeples.end(); for (const p of this.teleporters) p.end();
    for (const p of this.materialParts.values()) p.end();
    this.shadowCasters.end();

    this.buildCards(game);
    this.buildDice(game);
    this.buildBelts(game);
  }

  private addPiece(piece: BoardPiece, now: number, az: number): void {
    const fx = this.fx;
    const pose = fx ? fx.piece(piece.id) : null;
    if (pose === 'hide') return;
    if (pose) {
      // Travelling from its stack: only the tile itself (what sits on it shows once it lands).
      if (piece.type === 'mine') {
        const g = this.mineGroups.get(mineModel(piece.id));
        if (g) { g.visible = true; g.position.set(pose.x, pose.y, pose.z); g.rotation.set(0, pose.yaw, 0); }
      } else {
        const m = mat4(pose.x, pose.y, pose.z, pose.yaw);
        for (const part of this.tileParts.get(TILE_MODEL[piece.type])!) part.push(m);
      }
      return;
    }
    const pl = piecePlacement(piece);
    const y = this.drop(piece.id, now);
    for (const cell of pieceCells(piece)) {
      const c = axialToWorld(cell);
      this.shadowCasters.push(mat4(c.x, y, c.z, 0));
    }
    if (piece.type === 'mine') {
      const g = this.mineGroups.get(mineModel(piece.id));
      if (g) {
        g.visible = true;
        g.position.set(pl.x, y, pl.z);
        g.rotation.set(0, pl.yaw, 0);
      }
    } else {
      const m = mat4(pl.x, y, pl.z, pl.yaw);
      for (const part of this.tileParts.get(TILE_MODEL[piece.type])!) part.push(m);
    }
    // Control Modules, turned to face the viewer, inside the square outline.
    if (piece.claims.length > 0) {
      const lay = claimLayout(piece.claims.length);
      piece.claims.forEach((claim, i) => {
        const off = lay.offsets[i] ?? { x: 0, z: 0 };
        const w = modelToWorld({ x: pl.x, z: pl.z, yaw: az }, off.x, off.z);
        const a = fx ? fx.claim(piece.id, i) : null;
        if (a === 'hide') return;
        const dy = a ? a.y : 0, sc = lay.scale * (a ? a.s : 1);
        // A module below the number of Mines in play can never be rolled: greyed out.
        const look = moduleColors(this.colorOf(claim.ownerId), claim.controlModule, this.game?.mineCount ?? 1);
        this.modules.push(mat4(w.x, TILE_TOP + y + dy, w.z, az, sc), look.face);
        this.numerals.push(mat4(w.x, TILE_TOP + y + dy + 2 * sc + 0.04, w.z, az, sc), claim.controlModule, look.numeral);
      });
    }
    // Material in buffers, turned with the tile.
    for (const which of ['input', 'output'] as const) {
      const buf = which === 'input' ? piece.input : piece.output;
      if (!buf) continue;
      buf.slots.forEach((m, i) => {
        if (!m) return;
        const k = fx ? fx.slot(piece.id, which, i) : null;
        if (k !== null && k <= 0) return;
        const p = bufferSlotWorld(piece, which, i);
        this.materialParts.get(m)!.push(mat4(p.x, TILE_TOP + y + 0.05, p.z, pl.yaw, BUFFER_MATERIAL_SCALE * (k ?? 1)));
      });
      if (buf.teleporterOwner !== null) {
        const k = fx ? fx.teleporter(piece.id, which) : null;
        if (k !== null && k <= 0) continue;
        const t = teleporterPlacement(piece, which);
        const m = mat4(t.x, TILE_TOP + y, t.z, t.yaw, TELEPORTER_SCALE * (k ?? 1));
        const color = this.colorOf(buf.teleporterOwner);
        for (const part of this.teleporters) part.push(m, color);
      }
    }
  }

  private addMeeples(game: GameState, az: number): void {
    const used = new Map<string, number>();
    for (const pl of game.players) {
      if (!pl.meepleOnPieceId) continue;
      const piece = game.board.find(p => p.id === pl.meepleOnPieceId);
      if (!piece) continue;
      const key = `${piece.id}:${pl.meepleSlotIndex ?? -1}`;
      const k = used.get(key) ?? 0;
      used.set(key, k + 1);
      let p = piece.type === 'mine' ? mineSlotWorld(piece, pl.meepleSlotIndex ?? 0) : buildingMeepleWorld(piece);
      if (k > 0) p = { x: p.x + 9 * k, z: p.z };
      const a = this.fx ? this.fx.meeple(pl.id) : null;
      if (a === 'hide') continue;
      this.meeples.push(a ? mat4(a.x, a.y, a.z, az) : mat4(p.x, TILE_TOP + 0.05, p.z, az), this.colorOf(pl.id));
    }
  }

  /** The pile whose top piece is drawn face-up (see revealedStack), or null. */
  revealed(): { index: number; type: PieceType; id: string; n: number } | null {
    const game = this.game;
    const i = game ? revealedStack(game) : null;
    if (!game || i === null) return null;
    const top = game.stacks[i].pieces[0];
    if (!top || top.type === 'mine') return null;
    return { index: i, type: top.type, id: top.id, n: game.stacks[i].pieces.length };
  }

  /** Set by the table while a preview shows the drawn piece (or the waiting mine) elsewhere. */
  hidePileTop = false;
  hideMineId: string | null = null;

  private updateReveal(now: number, animate: boolean): void {
    const r = this.revealed();
    const key = r ? `${r.index}:${r.id}` : '';
    if (key === this.revealKey) return;
    this.revealKey = key;
    this.revealAt = r && animate ? now : null;
  }

  /** The drawn piece flipping face-up and rising off its pile: 0 face-down on the pile, 1 lifted. */
  private flip(now: number): number {
    if (this.revealAt === null) return 1;
    const t = (now - this.revealAt) / FLIP_MS;
    if (t >= 1) { this.revealAt = null; return 1; }
    return Math.max(0, t);
  }

  /** Where the drawn piece is drawn now (centre height, flip angle about X), or null. */
  revealedPoseNow(now: number): { x: number; y: number; z: number; angle: number } | null {
    const r = this.revealed();
    if (!r) return null;
    const at = this.side.stacks[r.index]!;
    const p = this.flip(now);
    const e = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
    const base = stackHeight(r.n - 1);
    return { x: at.x, y: base + TILE_TOP / 2 + REVEAL_LIFT * e + 10 * Math.sin(Math.PI * e), z: at.z, angle: Math.PI * (1 - e) };
  }

  private buildStacks(game: GameState | null, now: number): void {
    this.stackLayers.begin();
    for (const t of this.stackTops) t.begin();
    const shade = [new THREE.Color(0xd6d3d3), new THREE.Color(0xc9c5c4)];
    if (game) {
      const rev = this.revealed();
      game.stacks.forEach((stack, i) => {
        const at = this.side.stacks[i]!;
        // The drawn piece is not part of the face-down pile any more.
        const n = stack.pieces.length - (rev?.index === i ? 1 : 0);
        for (let k = 0; k < n - 1; k++) this.stackLayers.push(mat4(at.x, k * TILE_TOP, at.z, 0), shade[k % 2]);
        if (n > 0) {
          // Flipped about X: occupies (n-1)*3 .. n*3 with its back face up.
          _q.setFromAxisAngle(X_AXIS, Math.PI);
          const m = _m.compose(_p.set(at.x, n * TILE_TOP, at.z), _q, _s.set(1, 1, 1));
          for (const t of this.stackTops) t.push(m);
        }
      });
      // The drawn piece: face-up, held a little above its pile (flipping over as it is drawn).
      const pose = rev && !this.hidePileTop ? this.revealedPoseNow(now) : null;
      if (rev && pose) {
        _q.setFromAxisAngle(X_AXIS, pose.angle);
        const pivot = new THREE.Matrix4().makeTranslation(0, -TILE_TOP / 2, 0);
        const m = new THREE.Matrix4().compose(_p.set(pose.x, pose.y, pose.z), _q, _s.set(1, 1, 1)).multiply(pivot);
        for (const part of this.tileParts.get(TILE_MODEL[rev.type as Exclude<PieceType, 'mine'>])!) part.push(m);
        this.shadowCasters.push(mat4(pose.x, pose.y - TILE_TOP / 2, pose.z, 0));
      }
      // Mines 2 and 3 lie centred on the stacks they lock; a mine that has dropped but is not
      // placed yet hovers there too, slightly raised.
      const lying = [
        ...game.unplacedMines.map(m => ({ id: m.id, lift: 0 })),
        ...game.pendingMineIds.map(id => ({ id, lift: PENDING_MINE_LIFT })),
      ];
      for (const m of lying) {
        if (m.id === this.hideMineId) continue;
        const at = minePileAt(this.side, game, m.id);
        const g = this.mineGroups.get(mineModel(m.id));
        if (!g) continue;
        g.visible = true;
        g.position.set(at.x, at.y + m.lift, at.z);
        g.rotation.set(0, 0, 0);
      }
    }
    this.stackLayers.end();
    for (const t of this.stackTops) t.end();
  }

  /** Height of the top of pile i, including a mine lying on it or the drawn piece above it (for picking and glow). */
  stackTopY(i: number): number {
    const n = this.game?.stacks[i]?.pieces.length ?? 0;
    const rev = this.revealed();
    if (rev?.index === i) return stackHeight(n - 1) + REVEAL_LIFT + TILE_TOP;
    const lockedBy = this.game ? [...this.game.unplacedMines.map(m => m.id), ...this.game.pendingMineIds].some(id => id.endsWith(String(i + 1))) : false;
    return stackHeight(n) + (lockedBy && i > 0 ? TILE_TOP : 0);
  }

  deckHeight(which: 'deck' | 'discard'): number {
    const n = which === 'deck' ? (this.game?.cardDeck.length ?? 0) : (this.game?.cardDiscard.length ?? 0);
    return Math.max(0.4, n * CARD.thickness);
  }

  private buildCards(game: GameState | null): void {
    const place = (pile: { box: THREE.Mesh; top: THREE.Mesh }, at: { x: number; z: number }, h: number, show: boolean): void => {
      pile.box.visible = show;
      pile.top.visible = true;
      pile.box.scale.set(CARD.w, h, CARD.d);
      pile.box.position.set(at.x, h / 2, at.z);
      pile.top.position.set(at.x, h + 0.02, at.z);
    };
    place(this.deck, this.side.deck, this.deckHeight('deck'), (game?.cardDeck.length ?? 0) > 0);
    const top = game && game.cardDiscard.length > 0 ? game.cardDiscard[game.cardDiscard.length - 1]! : null;
    if (top !== this.discardCard) {
      this.discardCard = top;
      const mat = this.discard.top.material as THREE.MeshStandardMaterial;
      mat.map?.dispose();
      mat.map = cardFaceTexture(top);
      mat.needsUpdate = true;
    }
    place(this.discard, this.side.discard, this.deckHeight('discard'), top !== null);
    this.deck.top.visible = (game?.cardDeck.length ?? 0) > 0;
  }

  private dieGeometry(v: number): THREE.BoxGeometry {
    let g = this.diceGeos.get(v);
    if (g) return g;
    g = new THREE.BoxGeometry(DIE_SIZE, DIE_SIZE, DIE_SIZE);
    // Face order px, nx, py, ny, pz, nz; py shows the value.
    const rest = [1, 2, 3, 4, 5, 6].filter(x => x !== v && x !== 7 - v);
    const a = rest[0]!, b = rest.find(x => x !== a && x !== 7 - a)!;
    const faces = [a, 7 - a, v, 7 - v, b, 7 - b];
    const uv = g.getAttribute('uv') as THREE.BufferAttribute;
    for (let f = 0; f < 6; f++) {
      const [u0, v0, u1, v1] = diceCell(faces[f]!);
      for (let k = 0; k < 4; k++) {
        const i = f * 4 + k;
        uv.setXY(i, u0 + uv.getX(i) * (u1 - u0), v0 + uv.getY(i) * (v1 - v0));
      }
    }
    uv.needsUpdate = true;
    this.diceGeos.set(v, g);
    return g;
  }

  private buildDice(game: GameState | null): void {
    const n = game ? game.mineCount : 0;
    while (this.dice.length < n) {
      const d = new THREE.Mesh(this.dieGeometry(1), this.diceMaterial);
      d.castShadow = true;
      d.receiveShadow = true;
      this.root.add(d);
      this.dice.push(d);
    }
    this.dice.forEach((d, i) => {
      d.visible = i < n;
      if (i >= n) return;
      const v = game?.lastRoll?.[i] ?? 1;
      d.geometry = this.dieGeometry(Math.min(6, Math.max(1, v)));
      const at = this.side.dice[i] ?? { x: 0, z: 0 };
      const rest = { x: at.x, z: at.z, yaw: 0.35 + i * 0.6 };
      const pose = this.fx ? this.fx.die(i, rest) : null;
      if (pose) {
        d.position.set(pose.x, pose.y, pose.z);
        d.rotation.set(pose.rx, pose.ry, pose.rz);
        d.scale.setScalar(pose.s);
        return;
      }
      d.position.set(at.x, DIE_SIZE / 2, at.z);
      d.rotation.set(0, rest.yaw, 0);
      d.scale.setScalar(1);
    });
  }

  /** Bend the whole-belt model along each belt's curve and merge them all into one mesh. */
  private buildBelts(game: GameState | null): void {
    // During a transition, belts not laid yet are left out and belts dropping in are drawn alone.
    const fx = this.fx;
    const dropping = new Map<string, number>();
    const all = game?.belts ?? [];
    const belts = fx?.active ? all.filter(b => {
      const a = fx.belt(b.id);
      if (a === null) return true;
      if (a !== 'hide') dropping.set(b.id, a);
      return false;
    }) : all;
    this.updateDropBelts(game, dropping);
    // A belt turns round when a later piece decides which way its chain runs, so its head is in the key.
    const heads = game ? this.beltHeads(game) : null;
    const key = belts.map(b => `${b.id}/${b.ownerId}/${heads?.get(b.id) ?? ''}`).join('|') + '#' + this.colors.map(c => c.getHexString()).join(',');
    if (key === this.beltKey) return;
    this.beltKey = key;
    if (this.beltMesh) {
      this.root.remove(this.beltMesh);
      this.beltMesh.geometry.dispose();
      this.beltMesh = null;
    }
    if (!game || belts.length === 0) return;
    this.beltMesh = new THREE.Mesh(bendBelts(this.far ? this.beltFar : this.beltBase, game, b => this.colorOf(b), belts, heads ?? undefined), this.beltMaterial);
    this.beltMesh.castShadow = true;
    this.beltMesh.receiveShadow = true;
    this.root.add(this.beltMesh);
  }

  private updateDropBelts(game: GameState | null, dropping: ReadonlyMap<string, number>): void {
    for (const [id, mesh] of this.dropBelts) {
      if (dropping.has(id)) continue;
      this.root.remove(mesh);
      mesh.geometry.dispose();
      this.dropBelts.delete(id);
    }
    if (!game) return;
    for (const [id, y] of dropping) {
      let mesh = this.dropBelts.get(id);
      if (!mesh) {
        const belt = game.belts.find(b => b.id === id);
        if (!belt) continue;
        mesh = new THREE.Mesh(bendBelts(this.far ? this.beltFar : this.beltBase, game, b => this.colorOf(b), [belt], this.beltHeads(game)), this.beltMaterial);
        mesh.castShadow = true;
        this.root.add(mesh);
        this.dropBelts.set(id, mesh);
      }
      mesh.position.y = y;
    }
  }

  private headsFor: GameState | null = null;
  private heads: ReadonlyMap<string, number> = new Map();

  /** The head (the end material leaves by) of every belt in `game`, worked out once per state. */
  private beltHeads(game: GameState): ReadonlyMap<string, number> {
    if (game !== this.headsFor) {
      this.headsFor = game;
      this.heads = beltHeadMap(game);
    }
    return this.heads;
  }

  dispose(): void {
    for (const mesh of this.dropBelts.values()) mesh.geometry.dispose();
    this.dropBelts.clear();
    for (const parts of this.tileParts.values()) for (const p of parts) p.dispose();
    for (const t of this.textures) t.dispose();
    for (const g of this.diceGeos.values()) g.dispose();
    this.beltMesh?.geometry.dispose();
    this.root.clear();
  }
}

/**
 * What the belt model looks like along its length (model space: length along Z, +Y up as printed).
 * The chain is a flat strip (y 0 .. chainTop) with a D-shaped peg standing up from each end
 * (chainTop .. pegTop): the pegs that clip into the tile holes. Measured from the geometry itself.
 */
export interface BeltShape {
  readonly zMin: number;
  readonly zMax: number;
  readonly chainTop: number;
  readonly pegTop: number;
  /** Peg centre and half-length along Z, at the zMin end and at the zMax end. */
  readonly pegs: readonly [{ readonly c: number; readonly half: number }, { readonly c: number; readonly half: number }];
}

const shapeCache = new WeakMap<THREE.BufferGeometry, BeltShape>();

export function beltShape(g: THREE.BufferGeometry): BeltShape {
  const hit = shapeCache.get(g);
  if (hit) return hit;
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  let zMin = Infinity, zMax = -Infinity, yMax = -Infinity;
  for (let i = 0; i < pos.count; i++) { zMin = Math.min(zMin, pos.getZ(i)); zMax = Math.max(zMax, pos.getZ(i)); yMax = Math.max(yMax, pos.getY(i)); }
  const mid = (zMin + zMax) / 2, len = zMax - zMin;
  let chainTop = 0;
  for (let i = 0; i < pos.count; i++) if (Math.abs(pos.getZ(i) - mid) < len * 0.3) chainTop = Math.max(chainTop, pos.getY(i));
  const lo = [Infinity, Infinity], hi = [-Infinity, -Infinity];
  for (let i = 0; i < pos.count; i++) {
    if (pos.getY(i) < chainTop + 0.2) continue;
    const z = pos.getZ(i), e = z < mid ? 0 : 1;
    lo[e] = Math.min(lo[e]!, z); hi[e] = Math.max(hi[e]!, z);
  }
  const peg = (e: 0 | 1): { c: number; half: number } => Number.isFinite(lo[e]!)
    ? { c: (lo[e]! + hi[e]!) / 2, half: (hi[e]! - lo[e]!) / 2 }
    : { c: e === 0 ? zMin + 5.1 : zMax - 5.1, half: 2.3 }; // no pegs: where the print has them
  const shape: BeltShape = { zMin, zMax, chainTop: chainTop > 0 ? chainTop : yMax, pegTop: yMax, pegs: [peg(0), peg(1)] };
  shapeCache.set(g, shape);
  return shape;
}

/**
 * One belt to draw: on `piece`, between connection points `from` and `to`, in `color`.
 * The model's chain links are chevrons whose tips point at its zMin end (read from belt.glb, see
 * belts.test.ts), and bendBeltItems lays the zMin end at `from`: so `from` is where the arrow
 * points, the belt's head (use arrowEnds).
 */
export interface BeltItem {
  readonly piece: Pick<BoardPiece, 'type' | 'coord' | 'rotation'>;
  readonly from: number;
  readonly to: number;
  readonly color: THREE.Color;
}

/** Deform the belt model (length along Z) along every belt's curve; one merged geometry. */
export function bendBelts(
  base: THREE.BufferGeometry,
  game: Pick<GameState, 'belts' | 'board'>,
  colorOf: (owner: PlayerId) => THREE.Color,
  /** The belts to draw (default all); which way each points is decided by the whole of `game`. */
  draw: Pick<GameState, 'belts'>['belts'] = game.belts,
  heads: ReadonlyMap<string, number> = beltHeadMap(game),
): THREE.BufferGeometry {
  const items: BeltItem[] = [];
  for (const b of draw) {
    const piece = game.board.find(p => p.id === b.pieceId);
    if (piece) items.push({ piece, ...arrowEnds(b, heads.get(b.id)), color: colorOf(b.ownerId) });
  }
  return bendBeltItems(base, items);
}

/**
 * Lay the belt model on a tile as the printed belt lies: turned over so its pegs point down into
 * the two holes and the chain face is up. Each end (the peg and the tab past it) stays rigid, its
 * peg centred on the hole and pointing straight out across the edge; the tab reaches BELT_SPILL mm
 * past the edge and dips a little there, so two belts meeting at a shared edge overlap without
 * flicker. Only the chain between the pegs bends (and stretches) along the curve.
 */
export function bendBeltItems(base: THREE.BufferGeometry, items: readonly BeltItem[]): THREE.BufferGeometry {
  const pos = base.getAttribute('position') as THREE.BufferAttribute;
  const nor = base.getAttribute('normal') as THREE.BufferAttribute | undefined;
  const idx = base.getIndex();
  const vCount = pos.count;
  const indices = idx ? Array.from(idx.array as ArrayLike<number>) : Array.from({ length: vCount }, (_, i) => i);
  const shape = beltShape(base);
  const [pa, pb] = shape.pegs;
  // Rigid length on each side of a peg centre, towards the middle of the belt.
  const rigid = Math.max(pa.half, pb.half) + 0.6;
  // The outer tabs are stretched so their tips land BELT_SPILL past the edge.
  const reach = POINT_INSET + BELT_SPILL;
  const kA = (reach - pa.half) / Math.max(0.1, pa.c - pa.half - shape.zMin);
  const kB = (reach - pb.half) / Math.max(0.1, shape.zMax - (pb.c + pb.half));
  const pegScale = TILE_TOP / Math.max(0.1, shape.pegTop - shape.chainTop);
  const P = new Float32Array(items.length * vCount * 3);
  const N = new Float32Array(items.length * vCount * 3);
  const C = new Float32Array(items.length * vCount * 3);
  const I = new Uint32Array(items.length * indices.length);
  items.forEach((b, k) => {
    const h0 = pointWorld(b.piece, b.from), h1 = pointWorld(b.piece, b.to);
    const n0 = pointNormal(b.piece, b.from), n1 = pointNormal(b.piece, b.to);
    const h = Math.min(rigid, Math.hypot(h1.x - h0.x, h1.z - h0.z) * 0.3);
    const sample = sampleCurve(beltCurve(b.piece, b.from, b.to, h), 48);
    const zA = pa.c + h, zB = pb.c - h;
    const col = b.color;
    const o = k * vCount;
    for (let i = 0; i < vCount; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      // Centre line point (cx, cz) and unit direction of model +Z there (tx, tz).
      let cx: number, cz: number, tx: number, tz: number, past = 0;
      if (z <= zA || z >= zB) {
        const atA = z <= zA;
        const peg = atA ? pa : pb;
        // Outward distance from the peg centre (the hole centre), the outer tab stretched.
        let e = atA ? peg.c - z : z - peg.c;
        if (e > peg.half) e = peg.half + (e - peg.half) * (atA ? kA : kB);
        const hc = atA ? h0 : h1, n = atA ? n0 : n1;
        cx = hc.x + n.x * e; cz = hc.z + n.z * e;
        // Model +Z runs inwards at the zMin end and outwards at the zMax end.
        tx = atA ? -n.x : n.x; tz = atA ? -n.z : n.z;
        past = e - POINT_INSET;
      } else {
        const f = curveFrameAt(sample, (z - zA) / (zB - zA));
        cx = f.p.x; cz = f.p.z; tx = f.t.x; tz = f.t.z;
      }
      // Turned over about the length axis (a rotation, not a mirror): model X -> -lateral,
      // model Y -> down. Lateral is (t.z, -t.x).
      const lx = tz, lz = -tx;
      const j = (o + i) * 3;
      P[j] = cx - lx * x;
      P[j + 2] = cz - lz * x;
      // Chain on the tile top; pegs squeezed into the tile's thickness, down to the table.
      let wy = y <= shape.chainTop ? TILE_TOP + (shape.chainTop - y) : TILE_TOP - (y - shape.chainTop) * pegScale + 0.02;
      if (past > 0) wy -= BELT_TUCK * Math.min(1, past / BELT_SPILL);
      P[j + 1] = wy;
      if (nor) {
        const nx = -nor.getX(i), ny = -nor.getY(i), nz = nor.getZ(i);
        N[j] = lx * nx + tx * nz;
        N[j + 1] = ny;
        N[j + 2] = lz * nx + tz * nz;
      }
      C[j] = col.r; C[j + 1] = col.g; C[j + 2] = col.b;
    }
    for (let i = 0; i < indices.length; i++) I[k * indices.length + i] = indices[i]! + o;
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(N, 3));
  g.setAttribute('color', new THREE.BufferAttribute(C, 3));
  g.setIndex(new THREE.BufferAttribute(I, 1));
  if (!nor) g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

export type { ModelPart };
