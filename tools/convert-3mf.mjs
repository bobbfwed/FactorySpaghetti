#!/usr/bin/env node
// Converts the designer's 3D-print files (.3mf) into small web-ready models (.glb) for the game.
//
//   npm run models                       # source folder from FS_MODELS_SRC or the default G: path
//   node tools/convert-3mf.mjs <srcDir>  # explicit source folder
//   node tools/convert-3mf.mjs <srcDir> --only mine-1,belt-link
//
// Reads tools/pieces.config.json (what to export) and tools/piece-theme.json (colours), writes
// public/models/<name>.glb and public/models/manifest.json. Output is deterministic: the same
// sources give byte-identical files.
//
// Conventions of the output (see docs/models/README.md):
//   * glTF axes: +Y up. The print's Z-up frame is rotated (not mirrored) by -90 deg about X:
//     (x, y, z)_print -> (x, z, -y)_gltf. A tile lies in the XZ plane.
//   * 1 unit = 1 mm. Origin at the centre of the footprint, bottom face at Y = 0.
//   * One primitive per colour part, each with a named material (body, inlay-black, player, ...).
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, unlinkSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Document, NodeIO } from '@gltf-transform/core';
import { open3mf, flattenObject, applyTransform, determinant } from './lib/threemf.mjs';
import { dominantState } from './lib/paint.mjs';
import { weld, components, simplify, simplifyPerPart, buildPrimitive, signedVolume } from './lib/mesh.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..');
const DEFAULT_SRC = 'G:\\My Drive\\Factory Speghetti';

const args = process.argv.slice(2);
const onlyIdx = args.indexOf('--only');
const only = onlyIdx >= 0 ? new Set(args[onlyIdx + 1].split(',')) : null;
const positional = args.filter((a, i) => !a.startsWith('--') && (onlyIdx < 0 || i !== onlyIdx + 1));
const srcDir = positional[0] ?? process.env.FS_MODELS_SRC ?? DEFAULT_SRC;
const outDir = join(repo, 'public', 'models');

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8').replace(/^﻿/, ''));
const config = readJson(join(here, 'pieces.config.json'));
const theme = readJson(join(here, 'piece-theme.json'));

const docs = new Map();
function loadDoc(file) {
  if (!docs.has(file)) {
    const p = join(srcDir, file);
    if (!existsSync(p)) throw new Error(`source file not found: ${p}`);
    const doc = open3mf(readFileSync(p));
    docs.set(file, doc);
    // Keep piece-theme.json in step with the filament colours saved in the print file.
    for (const [name, m] of Object.entries(theme.materials)) {
      const fileColour = m.filament ? doc.filamentColours[m.filament - 1] : undefined;
      if (fileColour && fileColour.toUpperCase() !== m.color.toUpperCase()) {
        console.warn(`warning: ${file} has ${fileColour} for filament ${m.filament}; piece-theme.json "${name}" says ${m.color}`);
      }
    }
  }
  return docs.get(file);
}

function selectItem(doc, sel, file) {
  const items = doc.root.build;
  if (sel.index !== undefined) {
    if (!items[sel.index]) throw new Error(`${file}: no build item ${sel.index}`);
    return items[sel.index];
  }
  for (const item of items) {
    const st = doc.settings.get(String(item.objectid));
    if (sel.name !== undefined && st?.name === sel.name) return item;
    if (sel.triangles !== undefined) {
      const parts = flattenObject(doc, doc.rootPath, item.objectid, item.transform);
      const n = parts.reduce((s, p) => s + p.mesh.indices.length / 3, 0);
      if (n === sel.triangles) return item;
    }
  }
  throw new Error(`${file}: no build item matches ${JSON.stringify(sel)}`);
}

/** Colour role of a part: explicit per-part override, else its filament number, else the piece default. */
function roleFor(piece, filament) {
  const roles = { ...config.filamentRoles, ...(piece.filamentRoles ?? {}) };
  if (filament != null && roles[String(filament)]) return roles[String(filament)];
  return piece.role ?? 'body';
}

/** Collect world-space triangles (print frame, Z up) with their colour role. */
function gatherTriangles(piece) {
  const doc = loadDoc(piece.source);
  // Either one build item (piece.item) or several (piece.items, each with an optional role) —
  // some AMS files keep each colour as a separate build item instead of parts of one object.
  const selectors = piece.items ?? [piece.item ?? { index: 0 }];
  const tris = [];
  let before = 0;
  let painted = false;
  let partCount = 0;
  for (const sel of selectors) {
    const item = selectItem(doc, sel, piece.source);
    const st = doc.settings.get(String(item.objectid));
    const parts = flattenObject(doc, doc.rootPath, item.objectid, item.transform);
    partCount += parts.length;
    const r = gatherItem(piece, sel, st, parts, tris);
    before += r.before;
    painted ||= r.painted;
  }
  return { tris, before, painted, partCount };
}

function gatherItem(piece, sel, st, parts, tris) {
  let before = 0;
  let painted = false;
  const usesFilaments = st != null && piece.ignoreFilaments !== true;
  let seen = -1;
  for (const part of parts) {
    const ps = st?.parts.get(String(part.partObjectId));
    const partName = ps?.name ?? part.name;
    if (piece.parts && !piece.parts.includes(partName)) continue;
    // A print plate often holds many copies of a piece as one assembly: take just one copy.
    seen++;
    if (sel.partIndex !== undefined && seen !== sel.partIndex) continue;
    const filament = usesFilaments ? (ps?.extruder ?? st.extruder) : null;
    const baseRole = sel.role ?? piece.partRoles?.[partName] ?? (usesFilaments ? roleFor(piece, filament) : piece.role ?? 'body');
    const { positions, indices, triAttrs } = part.mesh;
    const flip = determinant(part.transform) < 0; // a mirrored placement reverses the winding
    const world = new Float64Array(positions.length);
    for (let k = 0; k < positions.length; k += 3) {
      const w = applyTransform(part.transform, positions[k], positions[k + 1], positions[k + 2]);
      world[k] = w[0];
      world[k + 1] = w[1];
      world[k + 2] = w[2];
    }
    for (let t = 0; t < indices.length; t += 3) {
      const state = piece.ignorePaint ? null : dominantState(triAttrs[t / 3]);
      if (state != null) painted = true;
      const role = state != null ? roleFor(piece, state) : baseRole;
      const order = flip ? [0, 2, 1] : [0, 1, 2];
      const p = [];
      for (const k of order) {
        const v = indices[t + k] * 3;
        p.push(world[v], world[v + 1], world[v + 2]);
      }
      tris.push({ p, role });
    }
    before += indices.length / 3;
  }
  return { before, painted };
}

/** Rotate 180 deg about the print X axis (for pieces printed face-down). A rotation, not a mirror. */
function flipOver(tris) {
  for (const t of tris) for (let c = 0; c < 3; c++) {
    t.p[c * 3 + 1] = -t.p[c * 3 + 1];
    t.p[c * 3 + 2] = -t.p[c * 3 + 2];
  }
}

/**
 * Fill a shallow engraving in the top face (e.g. the numeral on a Control Module tile): every
 * vertex less than `depth` below the top and within `inset` mm of the centre is lifted to the top
 * plane. Pocket walls become zero-area and are dropped when welding; the pocket floor closes the
 * hole, so the face becomes plain and simplifies to a few triangles.
 */
function fillEngraving(tris, { depth, inset }) {
  let top = -Infinity;
  const lo = [Infinity, Infinity];
  const hi = [-Infinity, -Infinity];
  for (const t of tris) for (let k = 0; k < 3; k++) {
    top = Math.max(top, t.p[k * 3 + 2]);
    for (let a = 0; a < 2; a++) {
      lo[a] = Math.min(lo[a], t.p[k * 3 + a]);
      hi[a] = Math.max(hi[a], t.p[k * 3 + a]);
    }
  }
  const cx = (lo[0] + hi[0]) / 2;
  const cy = (lo[1] + hi[1]) / 2;
  for (const t of tris) for (let k = 0; k < 3; k++) {
    const below = top - t.p[k * 3 + 2];
    if (below > 0 && below < depth && Math.abs(t.p[k * 3] - cx) < inset && Math.abs(t.p[k * 3 + 1] - cy) < inset) t.p[k * 3 + 2] = top;
  }
}

function rotateZ(tris, deg) {
  const a = (deg * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  for (const t of tris) for (let k = 0; k < 3; k++) {
    const x = t.p[k * 3];
    const y = t.p[k * 3 + 1];
    t.p[k * 3] = x * c - y * s;
    t.p[k * 3 + 1] = x * s + y * c;
  }
}

/** Keep only one connected component (e.g. one link of the belt chain). */
function pickComponent(tris, spec) {
  const w = weld(tris);
  const comps = components(w.positions, w.indices);
  const axis = { x: 0, y: 1, z: 2 }[spec.axis ?? 'y'];
  const info = comps.map((c) => {
    let s = 0;
    let n = 0;
    for (const t of c) for (let k = 0; k < 3; k++) {
      s += w.positions[w.indices[t * 3 + k] * 3 + axis];
      n++;
    }
    return { c, centre: s / n };
  });
  info.sort((a, b) => a.centre - b.centre);
  const i = spec.pick === 'first' ? 0 : spec.pick === 'last' ? info.length - 1 : Math.floor(info.length / 2);
  const out = [];
  for (const t of info[i].c) {
    const p = [];
    for (let k = 0; k < 3; k++) {
      const v = w.indices[t * 3 + k] * 3;
      p.push(w.positions[v], w.positions[v + 1], w.positions[v + 2]);
    }
    out.push({ p, role: w.roles[t] });
  }
  return { tris: out, count: info.length };
}

/** Centre the footprint on the origin with the bottom at 0, then convert Z-up to Y-up. */
function normalise(tris) {
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (const t of tris) for (let k = 0; k < 9; k++) {
    const a = k % 3;
    lo[a] = Math.min(lo[a], t.p[k]);
    hi[a] = Math.max(hi[a], t.p[k]);
  }
  const cx = (lo[0] + hi[0]) / 2;
  const cy = (lo[1] + hi[1]) / 2;
  const z0 = lo[2];
  for (const t of tris) for (let k = 0; k < 3; k++) {
    const x = t.p[k * 3] - cx;
    const y = t.p[k * 3 + 1] - cy;
    const z = t.p[k * 3 + 2] - z0;
    // (x, y, z) -> (x, z, -y): rotation of -90 deg about X; determinant +1, so winding is kept.
    t.p[k * 3] = x;
    t.p[k * 3 + 1] = z;
    t.p[k * 3 + 2] = -y === 0 ? 0 : -y;
  }
}

function srgbToLinear(c) {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function hexToLinear(hex) {
  const n = parseInt(hex.replace('#', ''), 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  return [srgbToLinear(r), srgbToLinear(g), srgbToLinear(b)].map((x) => Math.round(x * 1e6) / 1e6);
}

const r3 = (x) => Math.round(x * 1000) / 1000;

async function convert(piece) {
  const gathered = gatherTriangles(piece);
  let { tris } = gathered;
  const notes = [...(piece.notes ? [piece.notes] : [])];
  if (piece.flip) flipOver(tris);
  if (piece.fillEngraving) fillEngraving(tris, piece.fillEngraving);
  if (piece.rotateZ) rotateZ(tris, piece.rotateZ);
  let before = gathered.before;
  if (piece.component) {
    const picked = pickComponent(tris, piece.component);
    tris = picked.tris;
    before = tris.length;
    notes.push(`one of ${picked.count} separate links in the source (${piece.component.pick ?? 'middle'} along ${piece.component.axis ?? 'y'})`);
  }
  normalise(tris);

  const roleOrder = Object.keys(theme.materials);
  const welded = weld(tris);
  const maxError = piece.maxError ?? config.defaults.maxError;
  const { indices, error } = piece.simplifyPerPart
    ? await simplifyPerPart(welded.positions, welded.indices, welded.vertexRole, piece.budget, maxError)
    : await simplify(welded.positions, welded.indices, piece.budget, maxError);

  // Group triangles by role (every vertex of a triangle has the same role after welding).
  const byRole = new Map();
  let mixed = 0;
  for (let t = 0; t < indices.length; t += 3) {
    const r = welded.vertexRole[indices[t]];
    if (r !== welded.vertexRole[indices[t + 1]] || r !== welded.vertexRole[indices[t + 2]]) mixed++;
    if (!byRole.has(r)) byRole.set(r, []);
    byRole.get(r).push(indices[t], indices[t + 1], indices[t + 2]);
  }
  if (mixed) throw new Error(`${piece.name}: ${mixed} triangles mix colour parts after simplification`);
  const roles = [...byRole.keys()].sort((a, b) => roleOrder.indexOf(a) - roleOrder.indexOf(b));
  for (const r of roles) if (!theme.materials[r]) throw new Error(`${piece.name}: no theme colour for role "${r}"`);

  const volume = signedVolume(welded.positions, indices);
  if (volume <= 0) throw new Error(`${piece.name}: inside-out after conversion (signed volume ${volume.toFixed(1)})`);

  const doc = new Document();
  doc.getRoot().getAsset().generator = 'factory-spaghetti tools/convert-3mf.mjs';
  const buffer = doc.createBuffer();
  const mesh = doc.createMesh(piece.name);
  const parts = [];
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (const r of roles) {
    const prim = buildPrimitive(welded.positions, Uint32Array.from(byRole.get(r)), piece.crease ?? config.defaults.crease);
    for (let k = 0; k < prim.positions.length; k++) {
      lo[k % 3] = Math.min(lo[k % 3], prim.positions[k]);
      hi[k % 3] = Math.max(hi[k % 3], prim.positions[k]);
    }
    const m = theme.materials[r];
    const mat = doc
      .createMaterial(r)
      .setBaseColorFactor([...hexToLinear(m.color), 1])
      .setRoughnessFactor(m.roughness ?? 0.8)
      .setMetallicFactor(m.metalness ?? 0);
    const p = doc
      .createPrimitive()
      .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(prim.positions).setBuffer(buffer))
      .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(prim.normals).setBuffer(buffer))
      .setIndices(doc.createAccessor().setType('SCALAR').setArray(prim.indices).setBuffer(buffer))
      .setMaterial(mat);
    mesh.addPrimitive(p);
    parts.push({ material: r, triangles: prim.indices.length / 3, vertices: prim.positions.length / 3 });
  }
  const node = doc.createNode(piece.name).setMesh(mesh);
  doc.getRoot().setDefaultScene(doc.createScene(piece.name).addChild(node));
  const glb = await new NodeIO().writeBinary(doc);
  writeFileSync(join(outDir, `${piece.name}.glb`), glb);

  const after = indices.length / 3;
  return {
    name: piece.name,
    file: `${piece.name}.glb`,
    title: piece.title ?? piece.name,
    source: { file: piece.source, items: piece.items ?? [piece.item ?? { index: 0 }], ...(piece.parts ? { parts: piece.parts } : {}) },
    colourParts: roles.length > 1,
    parts,
    trianglesBefore: before,
    trianglesAfter: after,
    budget: piece.budget,
    withinBudget: after <= piece.budget,
    simplifyError: r3(error),
    bbox: { min: lo.map(r3), max: hi.map(r3), size: hi.map((h, i) => r3(h - lo[i])) },
    bytes: glb.byteLength,
    ...(notes.length ? { notes } : {}),
  };
}

async function main() {
  mkdirSync(outDir, { recursive: true });
  console.log(`source: ${srcDir}`);
  const manifestPath = join(outDir, 'manifest.json');
  const previous = only && existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')).models : [];
  const results = new Map(previous.map((m) => [m.name, m]));
  let failed = 0;
  for (const piece of config.pieces) {
    if (only && !only.has(piece.name)) continue;
    try {
      const m = await convert(piece);
      results.set(m.name, m);
      const flag = m.withinBudget ? '' : `  OVER BUDGET (${m.budget})`;
      console.log(
        `${m.name.padEnd(26)} ${String(m.trianglesBefore).padStart(6)} -> ${String(m.trianglesAfter).padStart(5)} tris  ` +
          `${(m.bytes / 1024).toFixed(1).padStart(6)} KB  ${m.parts.map((p) => p.material).join(', ')}${flag}`,
      );
    } catch (e) {
      failed++;
      console.error(`${piece.name}: FAILED: ${e.message}`);
    }
  }
  const order = config.pieces.map((p) => p.name);
  const models = [...results.values()].filter((m) => order.includes(m.name)).sort((a, b) => order.indexOf(a.name) - order.indexOf(b.name));
  // Remove .glb files that are no longer in the config.
  for (const f of readdirSync(outDir)) {
    if (f.endsWith('.glb') && !order.includes(f.slice(0, -4))) unlinkSync(join(outDir, f));
  }
  const totalBytes = models.reduce((s, m) => s + m.bytes, 0);
  const manifest = {
    generatedBy: 'tools/convert-3mf.mjs',
    units: 'millimetres',
    up: '+Y',
    origin: 'centre of the footprint, bottom face at Y = 0',
    hexTiles: 'pointy-top in the XZ plane: flat sides face +X and -X (68.8 mm across flats), corners at +Z and -Z',
    materials: theme.materials,
    totalBytes,
    models,
  };
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`\n${models.length} models, ${(totalBytes / 1024).toFixed(1)} KB of .glb (+ manifest)`);
  if (failed) {
    console.error(`${failed} piece(s) failed`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
