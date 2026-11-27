// Draws the guide's 3D pictures with the table's own code: the same models (public/models), the
// same scene builder (src/table/scene.ts TableScene), glow and preview (overlay.ts), camera
// (camera.ts), lights and wood. One offscreen WebGL renderer draws every picture into an image,
// one at a time; it is not attached to the page and never touches the table's own renderer.
// Loaded with import() the first time the guide shows a 3D picture, so Three.js stays out of the
// first-load bundle.

import * as THREE from 'three';
import { loadModels, MODEL_NAMES, type ModelLib, type ModelPart } from '../../../table/models';
import { TableScene } from '../../../table/scene';
import { Overlay } from '../../../table/overlay';
import { CameraRig } from '../../../table/camera';
import { numeralAtlas, numeralCell, woodTexture, NUMERAL_COLS, NUMERAL_ROWS } from '../../../table/textures';
import { NUMERAL_LIVE } from '../../../table/moduleLook';
import {
  TILE_TOP, axialToWorld, boardBounds, bufferAnchorWorld, mineSlotWorld, piecePlacement, pointWorld,
  beltCurve, sampleCurve, curveFrameAt, teleporterPlacement, TELEPORTER_HEIGHT, TELEPORTER_SCALE, type Bounds,
} from '../../../table/layout';
import type { Target } from '../../../table/types';
import { PLAYER_COLOR_HEX } from '../../../table/types';
import type { GameState } from '../../../engine/state';
import type { FigureJob, FigureRenderer, Rendered } from './jobs';
import { modelPlan } from './jobs';
import { DEFAULT_COLORS, sceneState } from './scene';
import type { CalloutAt, GlowAt, SceneSpec } from './types';

interface ManifestModel { readonly name: string; readonly file: string }

const MODELS_BASE = './models';
const FAR = { x: 1e6, z: 1e6 };

function webgl2Canvas(): { canvas: HTMLCanvasElement; gl: WebGL2RenderingContext } | null {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2', { alpha: true, antialias: true, preserveDrawingBuffer: true, premultipliedAlpha: true });
    return gl ? { canvas, gl } : null;
  } catch {
    return null;
  }
}

async function readManifest(): Promise<Set<string>> {
  try {
    const res = await fetch(`${MODELS_BASE}/manifest.json`);
    if (!res.ok) return new Set();
    const m = (await res.json()) as { models?: ManifestModel[] };
    return new Set((m.models ?? []).map(x => x.name));
  } catch {
    return new Set();
  }
}

function toUrl(canvas: HTMLCanvasElement): Promise<string | null> {
  return new Promise(resolve => {
    try {
      if (typeof canvas.toBlob === 'function') {
        canvas.toBlob(b => resolve(b ? URL.createObjectURL(b) : null), 'image/png');
      } else {
        resolve(canvas.toDataURL('image/png'));
      }
    } catch {
      resolve(null);
    }
  });
}

/** Make the renderer, or null when this device cannot draw 3D (the pictures then fall back). */
export async function createFigureRenderer(): Promise<FigureRenderer | null> {
  const ctx = webgl2Canvas();
  if (!ctx) return null;
  const { canvas, gl } = ctx;
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, context: gl, antialias: true, alpha: true, preserveDrawingBuffer: true });
  } catch {
    return null;
  }
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.setClearColor(0x000000, 0);
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  renderer.setPixelRatio(ratio);
  let lost = false;
  canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); lost = true; });

  const available = await readManifest();
  const parts = new Map<string, Promise<readonly ModelPart[] | null>>();
  const model = (name: string): Promise<readonly ModelPart[] | null> => {
    let p = parts.get(name);
    if (!p) {
      p = available.has(name)
        ? loadModels(MODELS_BASE, [name]).then(lib => lib.get(name) ?? null).catch(() => null)
        : Promise.resolve(null);
      parts.set(name, p);
    }
    return p;
  };
  /** Every model the table's scene code needs, or null if one is missing. */
  let tableLib: Promise<ModelLib | null> | null = null;
  const sceneLib = (): Promise<ModelLib | null> => {
    tableLib ??= Promise.all(MODEL_NAMES.map(async n => [n, await model(n)] as const)).then(entries => {
      if (entries.some(([, p]) => !p)) return null;
      return new Map(entries.map(([n, p]) => [n, p!])) as ModelLib;
    });
    return tableLib;
  };

  // ── Lights and ground, as on the table ──
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
  const woodGround = new THREE.Mesh(new THREE.PlaneGeometry(12000, 12000), new THREE.MeshStandardMaterial({ map: wood, roughness: 0.82, metalness: 0 }));
  woodGround.rotation.x = -Math.PI / 2;
  woodGround.position.y = -0.05;
  woodGround.receiveShadow = true;
  const shadowGround = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000), new THREE.ShadowMaterial({ opacity: 0.35 }));
  shadowGround.rotation.x = -Math.PI / 2;
  shadowGround.position.y = -0.05;
  shadowGround.receiveShadow = true;
  scene.add(woodGround, shadowGround);

  let table: TableScene | null = null;
  let overlay: Overlay | null = null;
  let atlas: THREE.CanvasTexture | null = null;

  function light(b: Bounds, top: number): void {
    const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
    const span = Math.max(b.maxX - b.minX, b.maxZ - b.minZ, top) * 0.6 + 60;
    sun.position.set(cx - span * 0.55, span * 1.6, cz + span * 0.7);
    sun.target.position.set(cx, 0, cz);
    const cam = sun.shadow.camera;
    cam.left = -span; cam.right = span; cam.top = span; cam.bottom = -span;
    cam.near = 1; cam.far = span * 5;
    cam.updateProjectionMatrix();
    sun.target.updateMatrixWorld();
    fill.position.set(cx + 400, 300, cz - 300);
  }

  async function snap(rig: CameraRig, w: number, h: number, marks: readonly { x: number; y: number; z: number }[]): Promise<Rendered | null> {
    if (lost) return null;
    renderer.setSize(w, h, false);
    renderer.render(scene, rig.camera);
    const url = await toUrl(canvas);
    if (!url) return null;
    return { url, marks: marks.map(m => { const p = rig.project(m.x, m.y, m.z); return { x: p.x / w, y: p.y / h }; }) };
  }

  function camera(w: number, h: number, b: Bounds, top: number, turn: number, margin: number): CameraRig {
    const rig = new CameraRig();
    rig.setSize(w, h);
    rig.turnTo(-turn * Math.PI / 3, false);
    rig.frame(b, false, top, margin);
    return rig;
  }

  // ── One model on its own ──
  async function drawModel(job: Extract<FigureJob, { t: 'model' }>): Promise<Rendered | null> {
    const plan = modelPlan(job, available);
    const p = plan === 'model' ? await model(job.model) : null;
    if (!p) return job.orElse ? drawScene(job.orElse, [], job.w, job.h) : null;
    const group = new THREE.Group();
    const made: { dispose(): void }[] = [];
    for (const part of p) {
      let mat: THREE.Material = part.mat;
      if (part.material === 'player') {
        const m = part.mat.clone();
        m.color.set(PLAYER_COLOR_HEX[job.color ?? 'blue']);
        made.push(m);
        mat = m;
      }
      const mesh = new THREE.Mesh(part.geometry, mat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
    }
    if (job.numeral !== undefined && job.model === 'control-module') {
      atlas ??= numeralAtlas();
      const g = new THREE.PlaneGeometry(13, 13);
      g.rotateX(-Math.PI / 2);
      const [cx, cy] = numeralCell(job.numeral);
      const uv = g.getAttribute('uv') as THREE.BufferAttribute;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) + cx) / NUMERAL_COLS, (uv.getY(i) + cy) / NUMERAL_ROWS);
      // The numeral atlas is white (the table tints each numeral): tint it the live numeral colour.
      const m = new THREE.MeshStandardMaterial({ map: atlas, color: NUMERAL_LIVE, alphaTest: 0.45, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -2 });
      const box = new THREE.Box3().setFromObject(group);
      const n = new THREE.Mesh(g, m);
      n.position.y = box.max.y + 0.04;
      group.add(n);
      made.push(g, m);
    }
    woodGround.visible = false;
    shadowGround.visible = true;
    if (table) table.root.visible = false;
    if (overlay) overlay.root.visible = false;
    scene.add(group);
    try {
      const box = new THREE.Box3().setFromObject(group);
      const b: Bounds = { minX: box.min.x, maxX: box.max.x, minZ: box.min.z, maxZ: box.max.z };
      light(b, box.max.y);
      return await snap(camera(job.w, job.h, b, box.max.y, 0, 1.12), job.w, job.h, []);
    } finally {
      scene.remove(group);
      for (const m of made) m.dispose();
    }
  }

  // ── A staged scene, drawn by the table's scene code ──
  function glowTarget(g: GlowAt): Target {
    if ('q' in g) return { kind: 'cell', q: g.q, r: g.r };
    if ('point' in g) return { kind: 'point', pieceId: g.piece, point: g.point };
    if ('buffer' in g) return { kind: 'buffer', pieceId: g.piece, buffer: g.buffer };
    return { kind: 'mineSlot', pieceId: g.piece, slot: g.slot };
  }

  function markAt(game: GameState, at: CalloutAt): { x: number; y: number; z: number } {
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
      const t = teleporterPlacement(piece, at.teleporter);
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

  async function drawScene(spec: SceneSpec, marks: readonly CalloutAt[], w: number, h: number): Promise<Rendered | null> {
    const lib = await sceneLib();
    if (!lib) return null;
    table ??= new TableScene(lib);
    overlay ??= new Overlay(lib);
    if (!table.root.parent) scene.add(table.root, overlay.root);
    table.root.visible = true;
    overlay.root.visible = true;
    const game = sceneState(spec);
    // The table draws one die per Mine beside the board: none in a picture.
    const shown: GameState = { ...game, mineCount: 0 };
    const now = performance.now();
    table.setColors((spec.colors ?? DEFAULT_COLORS).map(c => PLAYER_COLOR_HEX[c]));
    table.setGame(null, now); // no drop-in animation for pieces "new" to this picture
    table.setGame(shown, now);
    table.side = { stacks: [FAR, FAR, FAR], deck: FAR, discard: FAR, dice: [] };
    const az = -(spec.turn ?? 0) * Math.PI / 3;
    table.rebuild(now, az);
    const side = table.side;
    overlay.setTargets(shown, side, { stackTop: () => 0, pile: () => 0 }, (spec.glow?.at ?? []).map(glowTarget), PLAYER_COLOR_HEX[spec.glow?.color ?? 'blue']);
    const ghost = spec.ghost;
    overlay.setGhost(ghost ? { pieceType: ghost.type, q: ghost.q, r: ghost.r, rotation: ghost.rot ?? 0, valid: true } : null, shown);
    woodGround.visible = true;
    shadowGround.visible = false;
    let b = boardBounds(game.board);
    for (const g of spec.glow?.at ?? []) if ('q' in g) b = unite(b, boardBounds([{ type: 'blank', coord: { q: g.q, r: g.r } }]));
    if (ghost) b = unite(b, boardBounds([{ type: ghost.type, coord: { q: ghost.q, r: ghost.r }, rotation: ghost.rot ?? 0 }]));
    light(b, 20);
    const points = marks.map(m => markAt(game, m));
    // Frame the markers too (they stand above the pieces), so none falls off the picture.
    const rig = camera(w, h, b, Math.max(10, ...points.map(p => p.y + 6)), spec.turn ?? 0, 1.04);
    return snap(rig, w, h, points);
  }

  return {
    async render(job): Promise<Rendered | null> {
      if (lost) return null;
      try {
        return job.t === 'model' ? await drawModel(job) : await drawScene(job.scene, job.marks ?? [], job.w, job.h);
      } catch {
        return null;
      }
    },
    dispose(): void {
      try {
        table?.dispose();
        overlay?.dispose();
        atlas?.dispose();
        wood.dispose();
        woodGround.geometry.dispose();
        (woodGround.material as THREE.Material).dispose();
        shadowGround.geometry.dispose();
        (shadowGround.material as THREE.Material).dispose();
        void Promise.all(parts.values()).then(all => {
          for (const p of all) for (const part of p ?? []) { part.geometry.dispose(); part.mat.dispose(); }
        });
        renderer.dispose();
        renderer.forceContextLoss();
      } catch {
        /* already gone */
      }
    },
  };
}

function unite(a: Bounds, b: Bounds): Bounds {
  return { minX: Math.min(a.minX, b.minX), maxX: Math.max(a.maxX, b.maxX), minZ: Math.min(a.minZ, b.minZ), maxZ: Math.max(a.maxZ, b.maxZ) };
}
