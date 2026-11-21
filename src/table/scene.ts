// Turns a GameState into Three.js objects: every model part is one InstancedMesh shared by all
// pieces of that type, so a full board stays well under the draw-call budget. Rebuilding the
// instance buffers is cheap (a few hundred matrices), so each update rewrites them from the state.

import * as THREE from 'three';
import type { BoardPiece, GameState, Material, PlayerId } from '../engine/state';
import { partsOf, type ModelLib, type ModelPart } from './models';
import {
  APOTHEM, BUFFER_MATERIAL_SCALE, CARD, DIE_SIZE, HEX_RADIUS, TILE_MODEL, TILE_TOP,
  beltCurve, boardBounds, bufferAnchorWorld, bufferSlotWorld, buildingMeepleWorld, claimLayout,
  curveFrameAt, mineModel, mineSlotWorld, modelToWorld, pieceCells, piecePlacement, sampleCurve,
  sideLayout, stackHeight, axialToWorld, type ModelName, type SideLayout,
} from './layout';
import {
  cardBackTexture, cardFaceTexture, diceAtlas, diceCell, numeralAtlas, numeralCell,
  NUMERAL_COLS, NUMERAL_ROWS,
} from './textures';

const Y_AXIS = new THREE.Vector3(0, 1, 0);
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

/** Numeral decals on Control Modules: one instanced quad, each instance picks its atlas cell. */
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
    this.part = new InstancedPart(parent, this.geometry, material, {}, 16);
  }

  begin(): void { this.part.begin(); }

  push(matrix: THREE.Matrix4, numeral: number): void {
    const i = this.part.count;
    if (i * 2 + 2 > this.cells.array.length) {
      const next = new THREE.InstancedBufferAttribute(new Float32Array(this.cells.array.length * 2), 2);
      (next.array as Float32Array).set(this.cells.array as Float32Array);
      this.cells = next;
      this.geometry.setAttribute('aCell', next);
    }
    const [cx, cy] = numeralCell(numeral);
    this.cells.setXY(i, cx, cy);
    this.part.push(matrix);
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
  private readonly teleporters: InstancedPart;
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
  private colors: THREE.Color[] = [];
  private readonly textures: THREE.Texture[] = [];

  private far = false;
  private readonly beltFar: THREE.BufferGeometry;

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

    const torus = new THREE.TorusGeometry(7.5, 1.1, 10, 40);
    torus.rotateX(Math.PI / 2);
    this.teleporters = new InstancedPart(this.root, torus, new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }), { colors: true }, 4);

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
    this.game = game;
    this.updateSide();
  }

  /** Narrow screens put the card piles in front of the board instead of beside it. */
  portrait = false;

  updateSide(): void {
    this.side = sideLayout(boardBounds(this.game?.board ?? []), this.game?.mineCount ?? 1, this.portrait);
  }

  /** True while pieces are still settling. */
  get animating(): boolean { return this.appear.size > 0; }

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
    this.modules.begin(); this.numerals.begin(); this.meeples.begin(); this.teleporters.begin();
    for (const p of this.materialParts.values()) p.begin();
    this.shadowCasters.begin();
    for (const g of this.mineGroups.values()) g.visible = false;

    if (game) {
      for (const piece of game.board) this.addPiece(piece, now, az);
      this.addMeeples(game, az);
    }
    for (const parts of this.tileParts.values()) for (const p of parts) p.end();
    this.modules.end(); this.numerals.end(); this.meeples.end(); this.teleporters.end();
    for (const p of this.materialParts.values()) p.end();
    this.shadowCasters.end();

    this.buildStacks(game);
    this.buildCards(game);
    this.buildDice(game);
    this.buildBelts(game);
  }

  private addPiece(piece: BoardPiece, now: number, az: number): void {
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
        this.modules.push(mat4(w.x, TILE_TOP + y, w.z, az, lay.scale), this.colorOf(claim.ownerId));
        this.numerals.push(mat4(w.x, TILE_TOP + y + 2 * lay.scale + 0.04, w.z, az, lay.scale), claim.controlModule);
      });
    }
    // Material in buffers, turned with the tile.
    for (const which of ['input', 'output'] as const) {
      const buf = which === 'input' ? piece.input : piece.output;
      if (!buf) continue;
      buf.slots.forEach((m, i) => {
        if (!m) return;
        const p = bufferSlotWorld(piece, which, i);
        this.materialParts.get(m)!.push(mat4(p.x, TILE_TOP + y + 0.05, p.z, pl.yaw, BUFFER_MATERIAL_SCALE));
      });
      if (buf.teleporterOwner !== null) {
        const a = bufferAnchorWorld(piece, which);
        this.teleporters.push(mat4(a.x, TILE_TOP + y + 0.6, a.z, 0), this.colorOf(buf.teleporterOwner));
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
      this.meeples.push(mat4(p.x, TILE_TOP + 0.05, p.z, az), this.colorOf(pl.id));
    }
  }

  private buildStacks(game: GameState | null): void {
    this.stackLayers.begin();
    for (const t of this.stackTops) t.begin();
    const shade = [new THREE.Color(0xd6d3d3), new THREE.Color(0xc9c5c4)];
    if (game) {
      game.stacks.forEach((stack, i) => {
        const at = this.side.stacks[i]!;
        const n = stack.pieces.length;
        for (let k = 0; k < n - 1; k++) this.stackLayers.push(mat4(at.x, k * TILE_TOP, at.z, 0), shade[k % 2]);
        if (n > 0) {
          // Flipped about X: occupies (n-1)*3 .. n*3 with its back face up.
          _q.setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI);
          const m = _m.compose(_p.set(at.x, n * TILE_TOP, at.z), _q, _s.set(1, 1, 1));
          for (const t of this.stackTops) t.push(m);
        }
      });
      // Mines 2 and 3 lie on the stacks they lock (rayed hex over the stack); a mine that has
      // dropped but is not placed yet hovers there too, slightly raised.
      const lying = [
        ...game.unplacedMines.map(m => ({ id: m.id, lift: 0 })),
        ...game.pendingMineIds.map(id => ({ id, lift: 8 })),
      ];
      for (const m of lying) {
        const idx = Number(/(\d+)$/.exec(m.id)?.[1] ?? '2') - 1;
        const at = this.side.stacks[Math.min(2, Math.max(0, idx))]!;
        const h = stackHeight(game.stacks[Math.min(2, Math.max(0, idx))]!.pieces.length);
        const g = this.mineGroups.get(mineModel(m.id));
        if (!g) continue;
        g.visible = true;
        g.position.set(at.x + APOTHEM, h + m.lift, at.z);
        g.rotation.set(0, 0, 0);
      }
    }
    this.stackLayers.end();
    for (const t of this.stackTops) t.end();
  }

  /** Height of the face-down stack i (for picking and glow). */
  stackTopY(i: number): number {
    const n = this.game?.stacks[i]?.pieces.length ?? 0;
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
      d.position.set(at.x, DIE_SIZE / 2, at.z);
      d.rotation.set(0, 0.35 + i * 0.6, 0);
    });
  }

  /** Bend the whole-belt model along each belt's curve and merge them all into one mesh. */
  private buildBelts(game: GameState | null): void {
    const belts = game?.belts ?? [];
    const key = belts.map(b => `${b.id}/${b.ownerId}`).join('|') + '#' + this.colors.map(c => c.getHexString()).join(',');
    if (key === this.beltKey) return;
    this.beltKey = key;
    if (this.beltMesh) {
      this.root.remove(this.beltMesh);
      this.beltMesh.geometry.dispose();
      this.beltMesh = null;
    }
    if (!game || belts.length === 0) return;
    this.beltMesh = new THREE.Mesh(bendBelts(this.far ? this.beltFar : this.beltBase, game, b => this.colorOf(b)), this.beltMaterial);
    this.beltMesh.castShadow = true;
    this.beltMesh.receiveShadow = true;
    this.root.add(this.beltMesh);
  }

  dispose(): void {
    for (const parts of this.tileParts.values()) for (const p of parts) p.dispose();
    for (const t of this.textures) t.dispose();
    for (const g of this.diceGeos.values()) g.dispose();
    this.beltMesh?.geometry.dispose();
    this.root.clear();
  }
}

/** Deform the belt model (length along Z) along every belt's curve; one merged geometry. */
export function bendBelts(
  base: THREE.BufferGeometry,
  game: Pick<GameState, 'belts' | 'board'>,
  colorOf: (owner: PlayerId) => THREE.Color,
): THREE.BufferGeometry {
  const pos = base.getAttribute('position') as THREE.BufferAttribute;
  const nor = base.getAttribute('normal') as THREE.BufferAttribute | undefined;
  const idx = base.getIndex();
  const vCount = pos.count;
  const indices = idx ? Array.from(idx.array as ArrayLike<number>) : Array.from({ length: vCount }, (_, i) => i);
  let zMin = Infinity, zMax = -Infinity;
  for (let i = 0; i < vCount; i++) { zMin = Math.min(zMin, pos.getZ(i)); zMax = Math.max(zMax, pos.getZ(i)); }
  const belts = game.belts.filter(b => game.board.some(p => p.id === b.pieceId));
  const P = new Float32Array(belts.length * vCount * 3);
  const N = new Float32Array(belts.length * vCount * 3);
  const C = new Float32Array(belts.length * vCount * 3);
  const I = new Uint32Array(belts.length * indices.length);
  belts.forEach((b, k) => {
    const piece = game.board.find(p => p.id === b.pieceId)!;
    const sample = sampleCurve(beltCurve(piece, b.fromPoint, b.toPoint), 48);
    const col = colorOf(b.ownerId);
    const o = k * vCount;
    for (let i = 0; i < vCount; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      const f = curveFrameAt(sample, (z - zMin) / (zMax - zMin));
      // Model X -> lateral (t.z, -t.x), Y -> up, Z -> tangent: a proper rotation, no mirroring.
      const lx = f.t.z, lz = -f.t.x;
      const j = (o + i) * 3;
      P[j] = f.p.x + lx * x;
      P[j + 1] = TILE_TOP + y;
      P[j + 2] = f.p.z + lz * x;
      if (nor) {
        const nx = nor.getX(i), ny = nor.getY(i), nz = nor.getZ(i);
        N[j] = lx * nx + f.t.x * nz;
        N[j + 1] = ny;
        N[j + 2] = lz * nx + f.t.z * nz;
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
