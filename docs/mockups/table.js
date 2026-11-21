// Factory Spaghetti — static mock-up table scene (Three.js, orthographic isometric view).
// Hand-authored scene data only. No rules, no engine. Units are millimetres from the print files.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

export const PLAYER_COLORS = { blue: '#2f6fd6', red: '#e0454f', orange: '#f08a24', green: '#2e9e5b' };

const TILE_AP = 34.4;   // tile apothem (68.8 across flats)
const CELL_AP = 34.6;   // grid apothem: leaves a 0.4 mm hairline between tiles
const TILE_T = 3;       // tile thickness
const HOLE_R = 3.5;     // half-round hole radius (7 wide)
const HOLE_SPREAD = 8.5;// the two holes on an edge are 17 apart
const HOLE_IN = 2.4;    // flat side of the hole sits this far in from the edge
const SQ3 = Math.sqrt(3);
const DEG = Math.PI / 180;

// ---------------------------------------------------------------- small 2D helpers (plan coords: x right, z toward viewer)
const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const mul = (a, s) => [a[0] * s, a[1] * s];
const len = (a) => Math.hypot(a[0], a[1]);
const norm = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l]; };
const rot = (p, deg) => { const c = Math.cos(deg * DEG), s = Math.sin(deg * DEG); return [p[0] * c - p[1] * s, p[0] * s + p[1] * c]; };
const edgeN = (e) => [Math.cos(e * 60 * DEG), Math.sin(e * 60 * DEG)];
const edgeT = (e) => [-Math.sin(e * 60 * DEG), Math.cos(e * 60 * DEG)];
const v2 = ([x, z]) => new THREE.Vector2(x, -z);

function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hexPts(ap, c = [0, 0]) {
  const R = ap / Math.cos(30 * DEG);
  const out = [];
  for (let k = 0; k < 6; k++) { const a = (30 + 60 * k) * DEG; out.push([c[0] + R * Math.cos(a), c[1] + R * Math.sin(a)]); }
  return out;
}
function roundPts(pts, r, seg = 5) {
  const out = [], n = pts.length;
  for (let i = 0; i < n; i++) {
    const P = pts[i], A = pts[(i - 1 + n) % n], B = pts[(i + 1) % n];
    const rr = Math.min(r, len(sub(A, P)) / 2.05, len(sub(B, P)) / 2.05);
    const p1 = add(P, mul(norm(sub(A, P)), rr)), p2 = add(P, mul(norm(sub(B, P)), rr));
    for (let s = 0; s <= seg; s++) {
      const t = s / seg, u = 1 - t;
      out.push([u * u * p1[0] + 2 * u * t * P[0] + t * t * p2[0], u * u * p1[1] + 2 * u * t * P[1] + t * t * p2[1]]);
    }
  }
  return out;
}
function rectPts(w, h, c = [0, 0], deg = 0) {
  return [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]].map((p) => add(rot(p, deg), c));
}
function circlePts(r, c = [0, 0], seg = 40) {
  const o = []; for (let i = 0; i < seg; i++) { const a = (i / seg) * Math.PI * 2; o.push([c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)]); } return o;
}
// hole on edge e, slot j (0/1), in a tile's local frame
function holeChord(e, j, ap = TILE_AP) { return add(mul(edgeN(e), ap - HOLE_IN), mul(edgeT(e), (j ? 1 : -1) * HOLE_SPREAD)); }
function holeCentroid(e, j, ap = TILE_AP) { return add(holeChord(e, j, ap), mul(edgeN(e), -1.5)); }
function dShape(e, j, grow = 0, ap = TILE_AP, seg = 16) {
  const c = add(holeChord(e, j, ap), mul(edgeN(e), grow * 0.7));
  const n = edgeN(e), t = edgeT(e), R = HOLE_R + grow, pts = [];
  for (let i = 0; i <= seg; i++) { const f = (Math.PI * i) / seg; pts.push(add(c, add(mul(t, R * Math.cos(f)), mul(n, -R * Math.sin(f))))); }
  return pts;
}

// ---------------------------------------------------------------- geometry
function extrudePlan(outline, holes, thickness, bevel = 0.5, curveSegments = 4) {
  const shape = new THREE.Shape(outline.map(v2));
  for (const h of holes) shape.holes.push(new THREE.Path(h.map(v2)));
  const b = Math.min(bevel, thickness / 2.2);
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(0.01, thickness - 2 * b), bevelEnabled: b > 0, bevelThickness: b, bevelSize: b, bevelOffset: -b, bevelSegments: 2, curveSegments,
  });
  g.rotateX(-Math.PI / 2);
  g.translate(0, b, 0);
  return g;
}

// ---------------------------------------------------------------- canvas painting (colour + roughness/metalness maps)
const orm = (m) => `rgb(255,${Math.round(m.rough * 255)},${Math.round(m.metal * 255)})`;
function path(pts) { const p = new Path2D(); pts.forEach((q, i) => (i ? p.lineTo(q[0], q[1]) : p.moveTo(q[0], q[1]))); p.closePath(); return p; }
function painter(px, Sx, Sz) {
  const W = px, H = Math.round((px * Sz) / Sx);
  const mk = () => { const c = document.createElement('canvas'); c.width = W; c.height = H; const x = c.getContext('2d'); x.translate(W / 2, H / 2); x.scale(W / Sx, H / Sz); return [c, x]; };
  const [cc, cx] = mk(); const [oc, ox] = mk();
  return {
    cc, oc, cx, ox, Sx, Sz,
    fill(p, m) { cx.fillStyle = typeof m.color === 'function' ? m.color(cx) : m.color; cx.fill(p); ox.fillStyle = orm(m); ox.fill(p); },
    stroke(p, m, w) { cx.lineWidth = w; ox.lineWidth = w; cx.lineJoin = ox.lineJoin = 'round'; cx.strokeStyle = typeof m.color === 'function' ? m.color(cx) : m.color; cx.stroke(p); ox.strokeStyle = orm(m); ox.stroke(p); },
    base(m) { const p = new Path2D(); p.rect(-Sx / 2, -Sz / 2, Sx, Sz); this.fill(p, m); },
    printLines(alpha = 0.035, spacing = 0.5) {
      cx.save(); cx.strokeStyle = `rgba(0,0,0,${alpha})`; cx.lineWidth = spacing * 0.35; cx.beginPath();
      const span = Sx + Sz;
      for (let d = -span; d < span; d += spacing) { cx.moveTo(d - Sz, -Sz / 2 - Sz / 2); cx.lineTo(d + Sz, Sz / 2 + Sz / 2); }
      cx.stroke(); cx.restore();
    },
    textures(renderer) {
      const map = new THREE.CanvasTexture(cc); map.colorSpace = THREE.SRGBColorSpace;
      const ormT = new THREE.CanvasTexture(oc);
      for (const t of [map, ormT]) { t.anisotropy = renderer.capabilities.getMaxAnisotropy(); t.repeat.set(1 / Sx, 1 / Sz); t.offset.set(0.5, 0.5); }
      return { map, orm: ormT };
    },
  };
}

const MAT = {
  white: { color: '#e9e6de', rough: 0.74, metal: 0 },
  gold: { color: '#dcaa38', rough: 0.36, metal: 0.8 },
  black: { color: '#151515', rough: 0.55, metal: 0 },
  groove: { color: '#c9c5bc', rough: 0.85, metal: 0 },
  rayGap: { color: '#4a4846', rough: 0.7, metal: 0 },
};
function irid(c, s = 6) {
  return {
    color: (ctx) => {
      const g = ctx.createLinearGradient(c[0] - s, c[1] - s, c[0] + s, c[1] + s);
      g.addColorStop(0, '#8d4fc4'); g.addColorStop(0.35, '#5b5fc9'); g.addColorStop(0.6, '#7a55b0'); g.addColorStop(0.85, '#a8508f'); g.addColorStop(1, '#5e8a8a');
      return g;
    }, rough: 0.3, metal: 0.55,
  };
}

const ICON_SHAPES = {
  ore: (c, s = 1) => roundPts([[0, -4.6], [5.2, 4.2], [-5.2, 4.2]].map((p) => add(mul(p, s), c)), 1.1 * s),
  plate: (c, s = 1) => roundPts([[-2.2, -3.6], [5.6, -3.6], [2.2, 3.6], [-5.6, 3.6]].map((p) => add(mul(p, s), c)), 0.8 * s),
  sphere: (c, s = 1) => circlePts(4.4 * s, c),
  tess: (c, s = 1) => { const o = []; for (let i = 0; i < 8; i++) { const r = (i % 2 ? 1.5 : 5.8) * s, a = (45 + i * 45) * DEG; o.push([c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)]); } return o; },
};

// Building definitions in the tile's local frame (rotation 0). [edge, slot]
const FACTORY = {
  plate: { ins: [[4, 1]], out: [1, 1], icons: [['ore', [7, -22]], ['plate', [-7, 22]]] },
  sphere: { ins: [[4, 1], [5, 0]], out: [1, 1], icons: [['ore', [-19, -18]], ['plate', [19, -18]], ['sphere', [-7, 22]]] },
  tess: { ins: [[3, 1], [4, 1], [0, 0]], out: [1, 1], icons: [['ore', [-19, -20]], ['plate', [5, -24]], ['sphere', [20, -19]], ['tess', [-7, 22]]] },
  power: { ins: [[3, 0]], out: null, pocket: [-14, 10] },
  blank: { ins: [], out: null },
};
const buffersOf = (type) => { const f = FACTORY[type]; return [...f.ins, ...(f.out ? [f.out] : [])]; };

function paintStub(p, from, e, j) {
  const end = holeCentroid(e, j);
  const u = norm(sub(end, from)), n = [-u[1], u[0]], L = len(sub(end, from)), w = 3.5;
  const at = (s, o) => add(add(from, mul(u, s)), mul(n, o));
  p.fill(path([at(0, -w), at(L, -w), at(L, w), at(0, w)]), MAT.gold);
  for (const sgn of [-1, 1]) {
    p.fill(path([at(L - 9.5, sgn * w * 0.9), at(L - 5.5, sgn * w * 0.9), at(L - 3.8, sgn * (w + 3.2)), at(L - 6.6, sgn * (w + 2.6))]), MAT.gold);
  }
  p.fill(path(dShape(e, j, 0.9)), MAT.black);
}

function paintTile(p, type) {
  p.base(MAT.white);
  const f = FACTORY[type];
  if (type === 'plate' || type === 'sphere' || type === 'tess') {
    for (const [e, j] of buffersOf(type)) paintStub(p, [0, 0], e, j);
    const sq = rectPts(22, 22);
    p.fill(path(sq), MAT.white);
    p.stroke(path(rectPts(21, 21)), MAT.black, 1.1);
    for (const [kind, c] of f.icons) p.fill(path(ICON_SHAPES[kind](c, 1.05)), irid(c));
  } else if (type === 'power') {
    for (const [e, j] of f.ins) paintStub(p, f.pocket, e, j);
    p.fill(path(rectPts(22, 22, f.pocket)), MAT.white);
    p.stroke(path(rectPts(21, 21, f.pocket)), MAT.black, 1.1);
    // six solar-panel outlines, two staggered rows of three, tilted
    const c0 = [9, -9], ang = -28;
    for (let row = 0; row < 2; row++) for (let col = 0; col < 3; col++) {
      const local = [(col - 1) * 8.6 + (row ? 4.3 : -4.3), (row - 0.5) * 14.4];
      p.stroke(path(rectPts(7.4, 13.2, add(rot(local, ang), c0), ang)), MAT.black, 0.9);
    }
  }
  p.printLines();
}

function paintMine(p) {
  p.base(MAT.white);
  const rc = [-CELL_AP, 0], lc = [CELL_AP, 0];
  const cx = p.cx, ox = p.ox;
  // engraved rings, clipped to the rich half
  const richClip = path(hexPts(TILE_AP, rc));
  for (const ctx of [cx, ox]) { ctx.save(); ctx.clip(richClip); }
  for (let r = 16; r <= 44; r += 3.1) p.stroke(path(circlePts(r, rc, 90)), MAT.groove, 0.35);
  // twelve tapered rays to the twelve holes
  for (let e = 0; e < 6; e++) for (let j = 0; j < 2; j++) {
    const end = add(rc, holeCentroid(e, j));
    const u = norm(sub(end, rc)), n = [-u[1], u[0]], L = len(sub(end, rc));
    const at = (s, o) => add(add(rc, mul(u, s)), mul(n, o));
    p.fill(path([at(12, -1.4), at(L, -3.4), at(L, 3.4), at(12, 1.4)]), MAT.black);
    p.fill(path(dShape(e, j, 0.4).map((q) => add(q, rc))), MAT.black);
  }
  for (let r = 16; r <= 44; r += 3.1) p.stroke(path(circlePts(r, rc, 90)), MAT.rayGap, 0.3);
  for (const ctx of [cx, ox]) ctx.restore();
  p.fill(path(circlePts(14, rc, 64)), MAT.black);
  // lean half: two meeple slots — orange parallelogram, red stacked squares, each with a black plus
  const par = [22, 0];
  p.fill(path(roundPts([[-3.5, -7], [7.5, -7], [3.5, 7], [-7.5, 7]].map((q) => add(q, par)), 0.6)), { color: '#e0922c', rough: 0.4, metal: 0.35 });
  const red = [47, 0];
  p.fill(path(roundPts(rectPts(11, 11, add(red, [-1.6, -1.6])), 1.6)), { color: '#de3f48', rough: 0.5, metal: 0 });
  p.fill(path(roundPts(rectPts(11, 11, add(red, [1.2, 1.2])), 1.6)), { color: '#e6464f', rough: 0.5, metal: 0 });
  p.stroke(path(roundPts(rectPts(11, 11, add(red, [1.2, 1.2])), 1.6)), { color: '#c4343e', rough: 0.5, metal: 0 }, 0.3);
  for (const c of [par, add(red, [0, 0])]) {
    p.fill(path(rectPts(6.4, 1.3, c)), MAT.black);
    p.fill(path(rectPts(1.3, 6.4, c)), MAT.black);
  }
  p.printLines();
}

function minePts() {
  const rich = hexPts(TILE_AP, [-CELL_AP, 0]), lean = hexPts(TILE_AP, [CELL_AP, 0]);
  // hexPts order: angles 30,90,150,210,270,330
  const R = TILE_AP / Math.cos(30 * DEG);
  const wb = [0, R / 2], wt = [0, -R / 2];
  return [wb, rich[1], rich[2], rich[3], rich[4], wt, lean[4], lean[5], lean[0], lean[1]];
}

// ---------------------------------------------------------------- other canvas textures
function woodTexture(renderer) {
  const S = 1024, c = document.createElement('canvas'); c.width = c.height = S;
  const x = c.getContext('2d'), R = mulberry32(7);
  x.fillStyle = '#2b1a11'; x.fillRect(0, 0, S, S);
  const wave = (y0, amp, f, ph, w, col) => {
    x.strokeStyle = col; x.lineWidth = w;
    for (const off of [-S, 0, S]) {
      x.beginPath();
      for (let px = 0; px <= S; px += 8) { const y = y0 + off + amp * Math.sin((px / S) * Math.PI * 2 * f + ph) + amp * 0.4 * Math.sin((px / S) * Math.PI * 2 * (f + 2) + ph * 1.7); px ? x.lineTo(px, y) : x.moveTo(px, y); }
      x.stroke();
    }
  };
  for (let i = 0; i < 26; i++) wave(R() * S, 4 + R() * 10, 1 + Math.floor(R() * 2), R() * 6, 18 + R() * 60, R() < 0.5 ? 'rgba(70,42,25,0.22)' : 'rgba(12,6,3,0.28)');
  for (let i = 0; i < 900; i++) {
    const dark = R() < 0.62;
    wave(R() * S, R() * 3.5, 1 + Math.floor(R() * 3), R() * 6, 0.5 + R() * 1.8, dark ? `rgba(14,7,3,${0.18 + R() * 0.42})` : `rgba(96,60,36,${0.06 + R() * 0.16})`);
  }
  for (let i = 0; i < 2500; i++) { x.fillStyle = `rgba(8,4,2,${0.25 + R() * 0.4})`; x.fillRect(R() * S, R() * S, 2 + R() * 7, 0.8); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return t;
}

function moduleTexture(color, n) {
  const S = 256, c = document.createElement('canvas'); c.width = c.height = S;
  const x = c.getContext('2d'), R = mulberry32(n * 31 + color.length);
  x.fillStyle = color; x.fillRect(0, 0, S, S);
  for (let i = 0; i < 900; i++) { x.fillStyle = R() < 0.5 ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.08)'; x.fillRect(R() * S, R() * S, 3, 3); }
  x.fillStyle = '#0d0d0d'; x.textAlign = 'center'; x.textBaseline = 'middle';
  const two = String(n).length > 1;
  x.font = `900 ${two ? 150 : 178}px "Arial Black", "Segoe UI Black", Arial, sans-serif`;
  x.fillText(String(n), S / 2, S / 2 + 10, S * 0.86);
  if (n === 6 || n === 9) x.fillRect(S * 0.3, S * 0.86, S * 0.4, 14);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.repeat.set(1 / 15, 1 / 15); t.offset.set(0.5, 0.5); t.anisotropy = 8;
  return t;
}

function glitterTexture(base, speck, seed) {
  const S = 256, c = document.createElement('canvas'); c.width = c.height = S;
  const x = c.getContext('2d'), R = mulberry32(seed);
  x.fillStyle = base; x.fillRect(0, 0, S, S);
  for (let i = 0; i < 1400; i++) { x.fillStyle = speck[Math.floor(R() * speck.length)]; const s = 1 + R() * 2; x.fillRect(R() * S, R() * S, s, s); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(1.5, 1.5);
  return t;
}

function diceFace(v) {
  const S = 128, c = document.createElement('canvas'); c.width = c.height = S;
  const x = c.getContext('2d');
  x.fillStyle = '#f4f1ea'; x.fillRect(0, 0, S, S);
  const P = { 1: [[0, 0]], 2: [[-1, -1], [1, 1]], 3: [[-1, -1], [0, 0], [1, 1]], 4: [[-1, -1], [1, -1], [-1, 1], [1, 1]], 5: [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]], 6: [[-1, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [1, 1]] }[v];
  x.fillStyle = '#111';
  for (const [a, b] of P) { x.beginPath(); x.arc(S / 2 + a * 32, S / 2 + b * 32, v === 1 ? 15 : 11.5, 0, Math.PI * 2); x.fill(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

function wrapText(x, text, X, Y, maxW, lh) {
  const words = text.split(' '); let line = '';
  for (const w of words) { const test = line ? line + ' ' + w : w; if (x.measureText(test).width > maxW && line) { x.fillText(line, X, Y); line = w; Y += lh; } else line = test; }
  if (line) x.fillText(line, X, Y);
}
function cardBackCanvas() {
  const W = 630, H = 880, c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d');
  x.fillStyle = '#121214'; x.fillRect(0, 0, W, H);
  x.strokeStyle = '#d9ab3c'; x.lineWidth = 6; x.beginPath(); x.roundRect(26, 26, W - 52, H - 52, 26); x.stroke();
  x.lineWidth = 2; x.beginPath(); x.roundRect(42, 42, W - 84, H - 84, 18); x.stroke();
  // gold spaghetti: chains of chevrons along curves
  const curves = [
    [[60, 210], [330, 60], [380, 420], [570, 300]], [[60, 520], [250, 300], [420, 760], [570, 610]],
    [[120, 820], [140, 560], [480, 600], [520, 90]], [[60, 380], [300, 460], [200, 720], [470, 820]],
  ];
  x.save(); x.beginPath(); x.roundRect(46, 46, W - 92, H - 92, 16); x.clip();
  for (const [a, b, cc, d] of curves) {
    const N = 34;
    for (let i = 0; i <= N; i++) {
      const t = i / N, u = 1 - t;
      const px = u * u * u * a[0] + 3 * u * u * t * b[0] + 3 * u * t * t * cc[0] + t * t * t * d[0];
      const py = u * u * u * a[1] + 3 * u * u * t * b[1] + 3 * u * t * t * cc[1] + t * t * t * d[1];
      const dx = 3 * u * u * (b[0] - a[0]) + 6 * u * t * (cc[0] - b[0]) + 3 * t * t * (d[0] - cc[0]);
      const dy = 3 * u * u * (b[1] - a[1]) + 6 * u * t * (cc[1] - b[1]) + 3 * t * t * (d[1] - cc[1]);
      x.save(); x.translate(px, py); x.rotate(Math.atan2(dy, dx)); x.fillStyle = '#d9ab3c';
      x.beginPath(); x.moveTo(-9, -11); x.lineTo(2, -11); x.lineTo(10, 0); x.lineTo(2, 11); x.lineTo(-9, 11); x.lineTo(-1, 0); x.closePath(); x.fill();
      x.restore();
    }
  }
  x.restore();
  x.fillStyle = '#121214'; x.beginPath(); x.roundRect(165, 380, 300, 120, 16); x.fill();
  x.strokeStyle = '#d9ab3c'; x.lineWidth = 3; x.stroke();
  x.fillStyle = '#e8b730'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.font = '900 46px "Segoe UI", Arial, sans-serif'; x.fillText('LEVERAGE', W / 2, 440);
  return c;
}
export const CARD_TEXT = {
  'Scouting Drone': 'Look through the draw pile, choose a piece, add it now.',
  'Production Increase': 'Play 4 upgrades. You may claim with them, but only 1 building per turn.',
  'Short Sale': 'Claim a building with your lowest available Control Module (not below the mine floor).',
  'Sink Hole': 'Discard any unclaimed board piece (not mines). Its belts return to the bank.',
};
function cardFaceCanvas(title) {
  const W = 630, H = 880, c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d');
  x.fillStyle = '#f6f3ec'; x.fillRect(0, 0, W, H);
  x.fillStyle = '#e8b730'; x.fillRect(0, 70, W, 130);
  x.fillStyle = '#121214'; x.fillRect(0, 0, W, 70);
  x.fillStyle = '#e8b730'; x.font = '700 30px "Segoe UI", Arial'; x.textAlign = 'left'; x.textBaseline = 'middle'; x.fillText('LEVERAGE', 40, 36);
  x.fillStyle = '#121214'; x.font = '900 54px "Segoe UI", Arial'; x.fillText(title, 40, 136, W - 80);
  x.fillStyle = '#2a2723'; x.font = '500 40px "Segoe UI", Arial'; x.textBaseline = 'alphabetic';
  wrapText(x, CARD_TEXT[title] || '', 40, 290, W - 80, 54);
  x.strokeStyle = '#d9ab3c'; x.lineWidth = 6; x.strokeRect(14, 14, W - 28, H - 28);
  x.fillStyle = '#121214'; x.fillRect(0, H - 90, W, 90);
  x.fillStyle = '#e8b730'; x.font = '700 28px "Segoe UI", Arial'; x.textBaseline = 'middle'; x.fillText('Play in step 3 · max 2 per turn', 40, H - 45);
  return c;
}
function glowTexture(kind) {
  const S = 256, c = document.createElement('canvas'); c.width = c.height = S;
  const x = c.getContext('2d');
  if (kind === 'radial') {
    const g = x.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.35, 'rgba(255,255,255,0.55)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.fillRect(0, 0, S, S);
  } else { // hexagon outline glow; plane spans 130 mm
    const sc = S / 130; x.translate(S / 2, S / 2); x.scale(sc, sc);
    const hp = path(hexPts(CELL_AP + 0.6));
    x.strokeStyle = 'rgba(255,255,255,0.9)'; x.shadowColor = 'rgba(255,255,255,1)';
    for (const [w, b] of [[6, 14], [3, 8], [1.6, 3]]) { x.lineWidth = w; x.shadowBlur = b * sc * 2.2; x.stroke(hp); }
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---------------------------------------------------------------- piece factory (one per renderer)
function makeKit(renderer) {
  const cache = new Map();
  const memo = (k, f) => { if (!cache.has(k)) cache.set(k, f()); return cache.get(k); };
  const std = (o) => new THREE.MeshStandardMaterial({ envMapIntensity: 0.55, ...o });
  const sideWhite = memo('sideWhite', () => std({ color: '#e7e4dc', roughness: 0.72 }));
  const plastic = (col) => memo('pl' + col, () => std({ color: col, roughness: 0.55 }));

  const tileGeo = (type) => memo('tg' + type, () => {
    const filled = new Set(buffersOf(type).map(([e, j]) => e * 2 + j));
    const holes = [];
    for (let e = 0; e < 6; e++) for (let j = 0; j < 2; j++) if (!filled.has(e * 2 + j)) holes.push(dShape(e, j));
    return extrudePlan(roundPts(hexPts(TILE_AP), 2.4), holes, TILE_T, 0.55);
  });
  const tileMat = (type) => memo('tm' + type, () => {
    const p = painter(1280, 80, 80); paintTile(p, type);
    const { map, orm: o } = p.textures(renderer);
    return [std({ map, roughnessMap: o, metalnessMap: o, metalness: 1, roughness: 1 }), sideWhite];
  });
  const tile = (type, opts = {}) => {
    const m = new THREE.Mesh(tileGeo(type), opts.plain ? [sideWhite, sideWhite] : tileMat(type));
    m.castShadow = true; m.receiveShadow = true; return m;
  };
  const mine = () => {
    const g = memo('mineG', () => extrudePlan(roundPts(minePts(), 2.4), [], TILE_T, 0.55));
    const mat = memo('mineM', () => {
      const p = painter(2560, 160, 80); paintMine(p);
      const { map, orm: o } = p.textures(renderer);
      return [std({ map, roughnessMap: o, metalnessMap: o, metalness: 1, roughness: 1 }), sideWhite];
    });
    const m = new THREE.Mesh(g, mat); m.castShadow = m.receiveShadow = true; return m;
  };
  const module = (color, n, flash = false) => {
    const g = memo('modG', () => extrudePlan(roundPts(rectPts(15, 15), 2.2), [], 2, 0.45));
    const tex = memo('modT' + color + n, () => moduleTexture(color, n));
    const top = std({ map: tex, roughness: 0.62 });
    if (flash) { top.emissive = new THREE.Color('#ffffff'); top.emissiveMap = tex; top.emissiveIntensity = 0.85; }
    const side = flash ? std({ color, roughness: 0.6, emissive: new THREE.Color(color), emissiveIntensity: 0.6 }) : plastic(color);
    const m = new THREE.Mesh(g, [top, side]); m.castShadow = m.receiveShadow = true; return m;
  };
  const meeple = (color) => {
    const g = memo('meepleG', () => {
      const s = new THREE.Shape();
      s.moveTo(-8.2, 0); s.lineTo(-2.7, 0); s.quadraticCurveTo(0, 7.2, 2.7, 0); s.lineTo(8.2, 0);
      s.quadraticCurveTo(5.6, 5.6, 4.6, 8.6); s.lineTo(8.6, 9.3); s.quadraticCurveTo(10.6, 10.6, 8.9, 12.5);
      s.lineTo(3.7, 12.9); s.absarc(0, 15.6, 3.4, -38 * DEG, 218 * DEG, false);
      s.lineTo(-8.9, 12.5); s.quadraticCurveTo(-10.6, 10.6, -8.6, 9.3); s.lineTo(-4.6, 8.6); s.quadraticCurveTo(-5.6, 5.6, -8.2, 0);
      const g2 = new THREE.ExtrudeGeometry(s, { depth: 4.8, bevelEnabled: true, bevelThickness: 0.6, bevelSize: 0.6, bevelOffset: -0.6, bevelSegments: 2, curveSegments: 10 });
      g2.translate(0, 0, -2.4 - 0.6 + 0.6); g2.translate(0, 0, -0.0);
      g2.computeBoundingBox(); const bb = g2.boundingBox; g2.translate(0, -bb.min.y, -(bb.min.z + bb.max.z) / 2);
      return g2;
    });
    const m = new THREE.Mesh(g, plastic(color)); m.castShadow = m.receiveShadow = true; return m;
  };
  const oreMat = memo('oreM', () => new THREE.MeshPhysicalMaterial({ color: '#7d47b8', roughness: 0.28, metalness: 0.35, iridescence: 1, iridescenceIOR: 1.6, iridescenceThicknessRange: [250, 700], envMapIntensity: 1.1 }));
  const ore = () => {
    const g = memo('oreG', () => extrudePlan(roundPts([[0, -5.6], [6, 4.4], [-6, 4.4]], 1.8), [], 3.5, 0.7, 6));
    const m = new THREE.Mesh(g, oreMat); m.castShadow = true; return m;
  };
  const plate = () => {
    const g = memo('plateG', () => extrudePlan(roundPts([[-3.25, -6], [8.25, -6], [3.25, 6], [-8.25, 6]], 1.6), [], 4, 0.7, 6));
    const mat = memo('plateM', () => new THREE.MeshPhysicalMaterial({ color: '#ff9a12', roughness: 0.18, transmission: 0.55, thickness: 4, ior: 1.45, attenuationColor: '#ff7a00', attenuationDistance: 6, emissive: '#8a3c00', emissiveIntensity: 0.35, envMapIntensity: 1.0 }));
    const m = new THREE.Mesh(g, mat); m.castShadow = true; return m;
  };
  const sphere = () => {
    const g = memo('sphG', () => new THREE.LatheGeometry([[0, 0], [5.6, 0], [7, 1.3], [7, 3.1], [5.8, 4.5], [0, 4.5]].map(([a, b]) => new THREE.Vector2(a, b)), 48));
    const mat = memo('sphM', () => std({ map: glitterTexture('#183c22', ['#5fbf7a', '#2c7a44', '#9fe8b0', '#0f2a17'], 3), roughness: 0.35, metalness: 0.25, envMapIntensity: 1.0 }));
    const m = new THREE.Mesh(g, mat); m.castShadow = true; return m;
  };
  const tesseract = () => {
    const grp = new THREE.Group();
    const mat = memo('tesM', () => std({ map: glitterTexture('#151517', ['#4f7a58', '#8a8a8a', '#3a5a40', '#2a2a2a'], 5), roughness: 0.3, metalness: 0.35, envMapIntensity: 1.2 }));
    const S = 10.5, b = 1.7;
    const bar = (w, h, d, x, y, z) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); m.castShadow = true; grp.add(m); };
    // frame in XY plane, frame in ZY plane, frame in XZ plane
    for (const s of [-1, 1]) {
      bar(S, b, b, 0, S / 2 + s * (S / 2 - b / 2), 0); bar(b, S, b, s * (S / 2 - b / 2), S / 2, 0);
      bar(b, b, S, 0, S / 2 + s * (S / 2 - b / 2), 0); bar(b, S, b, 0, S / 2, s * (S / 2 - b / 2));
      bar(S, b, b, 0, S / 2, s * (S / 2 - b / 2)); bar(b, b, S, s * (S / 2 - b / 2), S / 2, 0);
    }
    return grp;
  };
  const goldMat = memo('goldM', () => std({ color: '#d8a537', metalness: 0.9, roughness: 0.32, envMapIntensity: 1.2 }));
  const blackMat = memo('blackM', () => std({ color: '#141414', roughness: 0.5 }));
  const powerToken = () => {
    const grp = new THREE.Group();
    const d = new THREE.Mesh(memo('tokG', () => { const g = new THREE.CylinderGeometry(11, 11, 2.4, 56); g.translate(0, 1.2, 0); return g; }), goldMat);
    d.castShadow = true; d.receiveShadow = true; grp.add(d);
    const bolt = new THREE.Mesh(memo('boltG', () => extrudePlan([[2.6, -8.4], [-5.2, 1.4], [-0.6, 1.4], [-2.8, 8.4], [5.2, -1.6], [0.6, -1.6], [3.6, -8.4]], [], 0.3, 0)), blackMat);
    bolt.position.y = 2.42; grp.add(bolt);
    return grp;
  };
  const teleporter = (color) => {
    const grp = new THREE.Group();
    const g = memo('telG', () => new THREE.LatheGeometry([[5.2, 0], [6.6, 0], [6.6, 5], [5.2, 5]].map(([a, b]) => new THREE.Vector2(a, b)), 48));
    const ring = new THREE.Mesh(g, std({ color, emissive: color, emissiveIntensity: 0.9, roughness: 0.3, side: THREE.DoubleSide }));
    ring.castShadow = true; grp.add(ring);
    const band = new THREE.Mesh(new THREE.TorusGeometry(5.9, 0.45, 8, 48), new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false }));
    band.rotation.x = Math.PI / 2; band.position.y = 5; grp.add(band);
    const halo = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), new THREE.MeshBasicMaterial({ map: memo('radial', () => glowTexture('radial')), color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.9, toneMapped: false }));
    halo.rotation.x = -Math.PI / 2; halo.position.y = 0.4; grp.add(halo);
    return grp;
  };
  const die = (v) => {
    const g = memo('dieG', () => new RoundedBoxGeometry(16, 16, 16, 4, 2.6));
    const opp = 7 - v, rest = [1, 2, 3, 4, 5, 6].filter((n) => n !== v && n !== opp);
    const faces = [rest[0], 7 - rest[0], v, opp, rest[1], 7 - rest[1]]; // +x -x +y -y +z -z
    const mats = faces.map((n) => memo('dieM' + n, () => std({ map: diceFace(n), roughness: 0.4 })));
    const m = new THREE.Mesh(g, mats); m.castShadow = true; m.receiveShadow = true; m.position.y = 8; return m;
  };
  const card = (face) => {
    const edge = memo('cardEdge', () => std({ color: '#2a2a2c', roughness: 0.6 }));
    const back = memo('cardBack', () => { const t = new THREE.CanvasTexture(cardBackCanvas()); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return std({ map: t, roughness: 0.45, metalness: 0.1 }); });
    const top = face ? memo('cardF' + face, () => { const t = new THREE.CanvasTexture(cardFaceCanvas(face)); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return std({ map: t, roughness: 0.5 }); }) : back;
    const m = new THREE.Mesh(memo('cardG', () => new THREE.BoxGeometry(63, 0.4, 88)), [edge, edge, top, back, edge, edge]);
    m.castShadow = true; m.receiveShadow = true; return m;
  };
  const startMarker = () => {
    const grp = new THREE.Group();
    const S = 22, b = 3;
    const box = (w, h, d, x, y, z, mat) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; grp.add(m); };
    const y0 = 2.4;
    box(30, y0, 16, 0, y0 / 2, 0, goldMat);
    box(S, b, b + 2, 0, y0 + b / 2, 0, blackMat); box(S, b, b + 2, 0, y0 + S - b / 2, 0, blackMat);
    box(b, S, b + 2, -S / 2 + b / 2, y0 + S / 2, 0, blackMat); box(b, S, b + 2, S / 2 - b / 2, y0 + S / 2, 0, blackMat);
    box(3, 28, 3, 0, y0 + 14, 0, goldMat); box(3, 3, 14, 0, y0 + S / 2, 0, goldMat);
    return grp;
  };
  const tray = (color, missing = []) => {
    const grp = new THREE.Group();
    const W = 64, D = 124, pitch = 20, pk = 16.6;
    const trayMat = memo('trayM', () => std({ color: '#19191b', roughness: 0.7 }));
    const base = new THREE.Mesh(extrudePlan(roundPts(rectPts(W, D), 3), [], 1.4, 0.4), trayMat);
    base.receiveShadow = base.castShadow = true; grp.add(base);
    const pockets = [];
    for (let r = 0; r < 6; r++) for (let c = 0; c < 3; c++) pockets.push({ n: 18 - (3 * r + c), p: [(c - 1) * pitch, (r - 2.5) * pitch] });
    const rim = new THREE.Mesh(extrudePlan(roundPts(rectPts(W, D), 3), pockets.map(({ p }) => roundPts(rectPts(pk, pk, p), 2)), 1.9, 0.35), trayMat);
    rim.position.y = 1.4; rim.castShadow = rim.receiveShadow = true; grp.add(rim);
    const grooveMat = memo('grooveM', () => std({ color: '#3a3a3e', roughness: 0.6 }));
    for (const { n, p } of pockets) {
      if (missing.includes(n)) {
        for (const s of [-1, 1]) {
          const gm = new THREE.Mesh(new THREE.BoxGeometry(8, 0.12, 0.7), grooveMat);
          gm.rotation.y = -45 * DEG; gm.position.set(p[0] + s * 4, 1.45, p[1] - s * 4 * -1); gm.position.set(p[0] + s * 3.6, 1.46, p[1] + s * 3.6 * -1);
          grp.add(gm);
        }
      } else {
        const m = module(color, n); m.position.set(p[0], 1.5, p[1]); grp.add(m);
      }
    }
    return grp;
  };
  const beltLink = (kind) => memo('link' + kind, () => {
    const w = 3.35;
    const shapes = {
      chev: [[-2.3, -w], [0.4, -w], [2.6, 0], [0.4, w], [-2.3, w], [-0.1, 0]],
      head: [[-3.2, -w], [0.8, -w], [0.8, -w - 0.8], [4.8, 0], [0.8, w + 0.8], [0.8, w], [-3.2, w], [-1.4, 0]],
      tail: [[-4, -w], [3.2, -w], [1.2, 0], [3.2, w], [-4, w], [-2.2, 0]],
    };
    return extrudePlan(shapes[kind], [], 1.5, 0.3);
  });
  return { tile, mine, module, meeple, ore, plate, sphere, tesseract, powerToken, teleporter, die, card, startMarker, tray, beltLink, plastic, memo };
}

// ---------------------------------------------------------------- board placement helpers
export function cellXZ(q, r) { return [2 * CELL_AP * (q + r / 2) - CELL_AP, SQ3 * CELL_AP * r]; }
const neighbor = (q, r, d) => { const D = [[1, 0], [0, 1], [-1, 1], [-1, 0], [0, -1], [1, -1]][d]; return [q + D[0], r + D[1]]; };

function addBelt(kit, parent, cell, a, b, color) {
  const c = cellXZ(...cell);
  const P0 = add(c, holeCentroid(a[0], a[1])), P2 = add(c, holeCentroid(b[0], b[1]));
  const mid = mul(add(P0, P2), 0.5), C = add(mid, mul(sub(c, mid), 0.75));
  const N = 200, pts = [], cum = [0];
  for (let i = 0; i <= N; i++) { const t = i / N, u = 1 - t; pts.push([u * u * P0[0] + 2 * u * t * C[0] + t * t * P2[0], u * u * P0[1] + 2 * u * t * C[1] + t * t * P2[1]]); if (i) cum.push(cum[i - 1] + len(sub(pts[i], pts[i - 1]))); }
  const L = cum[N];
  const at = (s) => { let i = cum.findIndex((v) => v >= s); if (i < 1) i = 1; const f = (s - cum[i - 1]) / (cum[i] - cum[i - 1] || 1); const p = add(pts[i - 1], mul(sub(pts[i], pts[i - 1]), f)); const d = norm(sub(pts[i], pts[i - 1])); return [p, d]; };
  const mat = kit.plastic(color);
  const place = (kind, s) => {
    const [p, d] = at(s);
    const m = new THREE.Mesh(kit.beltLink(kind), mat);
    m.position.set(p[0], TILE_T, p[1]); m.rotation.y = -Math.atan2(d[1], d[0]); m.castShadow = true; m.receiveShadow = true;
    parent.add(m);
  };
  place('tail', 2.2);
  const s0 = 7.6, s1 = L - 8.2, n = Math.max(2, Math.round((s1 - s0) / 4.3));
  for (let i = 0; i <= n; i++) place('chev', s0 + ((s1 - s0) * i) / n);
  place('head', L - 3.2);
}

function hexRing(color, y, opts = {}) {
  const grp = new THREE.Group();
  const shape = new THREE.Shape(hexPts(opts.outer ?? CELL_AP + 1.6).map(v2));
  shape.holes.push(new THREE.Path(hexPts(opts.inner ?? CELL_AP - 0.6).map(v2)));
  const ring = new THREE.Mesh(new THREE.ShapeGeometry(shape), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: opts.ringOpacity ?? 0.95, toneMapped: false, depthWrite: false }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = y + 0.05; grp.add(ring);
  if (opts.fill) {
    const f = new THREE.Mesh(new THREE.ShapeGeometry(new THREE.Shape(hexPts(CELL_AP - 0.6).map(v2))), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: opts.fill, toneMapped: false, depthWrite: false }));
    f.rotation.x = -Math.PI / 2; f.position.y = y + 0.03; grp.add(f);
  }
  return grp;
}

// ---------------------------------------------------------------- the hand-authored mid-game board
// cell, type, rotation k (60° steps), owner/module, and what sits on it
const BOARD = [
  { id: 'redSphere', cell: [1, -1], type: 'sphere', k: 2, owner: 'red', module: 4, outMat: 'sphere' },
  { id: 'blank1', cell: [0, -1], type: 'blank' },
  { id: 'blank2', cell: [-1, 0], type: 'blank' },
  { id: 'bp1', cell: [-1, 1], type: 'plate', k: 0, owner: 'blue', module: 3, outMat: 'plate' },
  { id: 'bluePower', cell: [0, 1], type: 'power', k: 5, owner: 'blue', module: 2 },
  { id: 'blank3', cell: [2, 0], type: 'blank' },
  { id: 'redPlate', cell: [2, -1], type: 'plate', k: 0, owner: 'red', module: 3 },
  { id: 'tess', cell: [1, 1], type: 'tess', k: 1 },
  { id: 'orangePlate', cell: [-2, 0], type: 'plate', k: 1, owner: 'orange', module: 3 },
  { id: 'bp2', cell: [1, 2], type: 'plate', k: 0, owner: 'blue', module: 5, inMat: 'ore', teleOut: 'blue', meeple: 'blue' },
  { id: 'blank4', cell: [-1, 2], type: 'blank' },
  { id: 'sphere2', cell: [0, 2], type: 'sphere', k: 5 },
  { id: 'blank5', cell: [-2, 1], type: 'blank' },
  { id: 'blank6', cell: [2, 1], type: 'blank' },
  { id: 'redPower', cell: [3, 0], type: 'power', k: 4, owner: 'red', module: 2 },
  { id: 'blank7', cell: [3, -1], type: 'blank' },
  { id: 'blank8', cell: [2, -2], type: 'blank' },
  { id: 'blank9', cell: [1, -2], type: 'blank' },
  { id: 'blank10', cell: [0, -2], type: 'blank' },
  { id: 'orangePower', cell: [-1, -1], type: 'power', k: 1, owner: 'orange', module: 2, meeple: 'orange' },
];
// belts in world edge terms: [edge, slot] on the given cell, material flows a -> b
const BELTS = [
  { cell: [0, -1], a: [1, 0], b: [2, 1], color: 'blue' },  // from the mine ray-hole
  { cell: [-1, 0], a: [5, 0], b: [1, 0], color: 'blue' },  // into bp1's input
  { cell: [-1, 2], a: [4, 0], b: [0, 0], color: 'blue' },  // bp1 output toward the sphere factory
  { cell: [2, 0], a: [4, 0], b: [2, 0], color: 'red' },
];
const MEEPLE_SPOT = { plate: [21, -3], sphere: [21, 3], tess: [22, 6], power: [16, 17] };

function buildGame(kit, scene, anchors, opts) {
  const board = new THREE.Group(); scene.add(board);
  const R = mulberry32(42);
  // mine 1 at the centre
  const mine = kit.mine(); board.add(mine);
  anchors.mine = new THREE.Vector3(0, TILE_T, 0);
  // red meeple on the lean-half parallelogram slot
  const rm = kit.meeple(PLAYER_COLORS.red); rm.position.set(22, TILE_T, 0); rm.rotation.y = 8 * DEG; board.add(rm);

  const flash = new Set(opts.flashModules || []);
  for (const t of BOARD) {
    const c = cellXZ(...t.cell);
    const k = t.k || 0;
    const m = kit.tile(t.type); m.position.set(c[0], 0, c[1]); m.rotation.y = -k * 60 * DEG; board.add(m);
    anchors[t.id] = new THREE.Vector3(c[0], TILE_T, c[1]);
    anchors['cell:' + t.cell.join(',')] = anchors[t.id];
    const toWorld = (p) => add(c, rot(p, k * 60));
    if (t.owner) {
      const pocket = toWorld(FACTORY[t.type].pocket || [0, 0]);
      let a = (k * 60) % 90; if (a > 45) a -= 90;
      const mod = kit.module(PLAYER_COLORS[t.owner], t.module, flash.has(t.id));
      mod.position.set(pocket[0], TILE_T, pocket[1]); mod.rotation.y = -a * DEG; board.add(mod);
      anchors[t.id + '.module'] = new THREE.Vector3(pocket[0], TILE_T + 2, pocket[1]);
      if (flash.has(t.id)) {
        const halo = new THREE.Mesh(new THREE.PlaneGeometry(44, 44), new THREE.MeshBasicMaterial({ map: kit.memo('radial', () => glowTexture('radial')), color: '#ffcf3a', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, opacity: 0.95 }));
        halo.rotation.x = -Math.PI / 2; halo.position.set(pocket[0], TILE_T + 0.2, pocket[1]); board.add(halo);
      }
    }
    const f = FACTORY[t.type];
    const bufPos = (eb, inset = 4.5) => toWorld(mul(holeCentroid(eb[0], eb[1]), (len(holeCentroid(eb[0], eb[1])) - inset) / len(holeCentroid(eb[0], eb[1]))));
    anchors[t.id + '.in'] = f.ins[0] ? (() => { const p = bufPos(f.ins[0], 0); return new THREE.Vector3(p[0], TILE_T, p[1]); })() : null;
    anchors[t.id + '.out'] = f.out ? (() => { const p = bufPos(f.out, 0); return new THREE.Vector3(p[0], TILE_T, p[1]); })() : null;
    const placeMat = (kind, eb) => {
      const p = bufPos(eb);
      const piece = { ore: kit.ore, plate: kit.plate, sphere: kit.sphere, tess: kit.tesseract }[kind]();
      piece.position.set(p[0], TILE_T, p[1]); piece.rotation.y = R() * Math.PI; board.add(piece);
    };
    const inMat = t.inMat || (opts.bp1Ore && t.id === 'bp1' ? 'ore' : null);
    if (inMat) placeMat(inMat, f.ins[0]);
    if (t.outMat && !(opts.bp1OutEmpty && t.id === 'bp1')) placeMat(t.outMat, f.out);
    if (t.teleOut) { const p = bufPos(f.out, 1.5); const tp = kit.teleporter(PLAYER_COLORS[t.teleOut]); tp.position.set(p[0], TILE_T, p[1]); board.add(tp); }
    if (t.meeple) {
      const p = toWorld(MEEPLE_SPOT[t.type]);
      const mp = kit.meeple(PLAYER_COLORS[t.meeple]); mp.position.set(p[0], TILE_T, p[1]); mp.rotation.y = (R() - 0.5) * 30 * DEG; board.add(mp);
      anchors[t.id + '.meeple'] = new THREE.Vector3(p[0], TILE_T + 19, p[1]);
    }
  }
  for (const b of BELTS) addBelt(kit, board, b.cell, b.a, b.b, PLAYER_COLORS[b.color]);

  // ---- beside the board: three face-down stacks (2 and 3 covered by their mine), deck, discard, dice
  const stackAt = (pos, n, withMine, id) => {
    for (let i = 0; i < n; i++) {
      const t = kit.tile('blank', { plain: true });
      t.position.set(pos[0] + (R() - 0.5) * 1.2, i * (TILE_T + 0.04), pos[1] + (R() - 0.5) * 1.2);
      t.rotation.y = (R() - 0.5) * 3 * DEG; board.add(t);
    }
    let top = n * (TILE_T + 0.04);
    if (withMine) { const m = kit.mine(); m.position.set(pos[0], top, pos[1]); m.rotation.y = ((R() - 0.5) * 4) * DEG; board.add(m); top += TILE_T; }
    anchors[id] = new THREE.Vector3(pos[0], top, pos[1]);
    anchors[id + '.base'] = new THREE.Vector3(pos[0], 0, pos[1] + 40);
  };
  const SX = opts.stacksX ?? 292;
  stackAt([SX, -94], 10, false, 'stack1');
  stackAt([SX, 4], 7, true, 'stack2');
  stackAt([SX, 102], 6, true, 'stack3');

  const DX = opts.deckX ?? -300;
  for (let i = 0; i < 18; i++) { const c = kit.card(null); c.position.set(DX + (R() - 0.5) * 0.8, 0.2 + i * 0.42, (opts.deckZ ?? 0) + (R() - 0.5) * 0.8); c.rotation.y = (R() - 0.5) * 2 * DEG; board.add(c); }
  anchors.deck = new THREE.Vector3(DX, 8, opts.deckZ ?? 0);
  for (let i = 0; i < 4; i++) { const c = kit.card(i === 3 ? 'Sink Hole' : null); c.position.set(DX + 2 + (R() - 0.5) * 4, 0.2 + i * 0.42, (opts.discardZ ?? 96) + (R() - 0.5) * 3); c.rotation.y = (R() - 0.5) * 10 * DEG + 4 * DEG; board.add(c); }
  anchors.discard = new THREE.Vector3(DX, 2, opts.discardZ ?? 96);

  const dice = opts.dice || [4];
  const dpos = opts.diceAt || [[190, 156]];
  dice.forEach((v, i) => { const d = kit.die(v); d.position.x = dpos[i][0]; d.position.z = dpos[i][1]; d.rotation.y = (i ? 24 : -12) * DEG; board.add(d); });
  anchors.dice = new THREE.Vector3(dpos[0][0], 16, dpos[0][1]);

  const sm = kit.startMarker(); sm.position.set(opts.startAt?.[0] ?? 200, 0, opts.startAt?.[1] ?? -166); sm.rotation.y = -15 * DEG; board.add(sm);
  anchors.startMarker = new THREE.Vector3(sm.position.x, 30, sm.position.z);

  // ---- interaction overlays
  for (const h of opts.highlights || []) {
    const c = cellXZ(...h.cell);
    const onTile = BOARD.some((t) => t.cell[0] === h.cell[0] && t.cell[1] === h.cell[1]);
    const y = onTile ? TILE_T : 0.2;
    const col = PLAYER_COLORS[h.color] || h.color;
    const ring = hexRing(col, y, { fill: h.fill ?? (onTile ? 0 : 0.16), ringOpacity: h.ringOpacity ?? 0.9, outer: h.outer, inner: h.inner });
    ring.position.set(c[0], 0, c[1]); board.add(ring);
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(130, 130), new THREE.MeshBasicMaterial({ map: kit.memo('hexglow', () => glowTexture('hex')), color: col, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, opacity: h.glow ?? 0.5 }));
    glow.rotation.x = -Math.PI / 2; glow.position.set(c[0], y + 0.1, c[1]); board.add(glow);
    anchors['hl:' + h.cell.join(',')] = new THREE.Vector3(c[0], y, c[1]);
  }
  if (opts.ghost) {
    const g = opts.ghost, c = cellXZ(...g.cell);
    const m = kit.tile(g.type);
    m.material = m.material.map((mm) => { const x = mm.clone(); x.transparent = true; x.opacity = 0.62; x.depthWrite = false; return x; });
    m.castShadow = false; m.position.set(c[0], g.lift ?? 7, c[1]); m.rotation.y = -(g.k || 0) * 60 * DEG; board.add(m);
    anchors.ghost = new THREE.Vector3(c[0], (g.lift ?? 7) + TILE_T, c[1]);
  }
  return board;
}

// ---------------------------------------------------------------- gallery scenes
function buildGallery(kit, scene, anchors, labels, which) {
  const g = new THREE.Group(); scene.add(g);
  const L = (text, x, z, sub) => labels.push({ text, sub, pos: new THREE.Vector3(x, 0, z) });
  if (which === 'large') {
    const row1 = -172, row2 = 2, row3 = 176;
    const types = [['blank', 'Blank tile', '12 half-round belt holes'], ['plate', 'Plate Factory', 'ore in → plate out'], ['sphere', 'Sphere Factory', 'ore + plate in → sphere out'], ['tess', 'Tesseract Factory', 'ore + plate + sphere → tesseract'], ['power', 'Power Plant', 'solar panels · input · module pocket']];
    types.forEach(([t, name, sub], i) => {
      const x = -240 + i * 120;
      const m = kit.tile(t); m.position.set(x, 0, row1); g.add(m);
      if (t !== 'blank') { const mod = kit.module(PLAYER_COLORS[['blue', 'red', 'orange', 'green'][i - 1]], [3, 4, 9, 2][i - 1]); const pk = FACTORY[t].pocket || [0, 0]; mod.position.set(x + pk[0], TILE_T, row1 + pk[1]); g.add(mod); }
      L(name, x, row1 + 42, sub);
    });
    const mine = kit.mine(); mine.position.set(-196, 0, row2); g.add(mine);
    L('Mine (double hex)', -196, row2 + 42, 'rays = outputs · two meeple slots');
    for (let i = 0; i < 7; i++) { const t = kit.tile('blank', { plain: true }); t.position.set(-22 + (i % 2) * 0.8, i * 3.04, row2 - 2 - (i % 3) * 0.5); t.rotation.y = (i % 3 - 1) * 1.5 * DEG; g.add(t); }
    const m2 = kit.mine(); m2.position.set(-22, 7 * 3.04, row2 - 2); m2.rotation.y = 2 * DEG; g.add(m2);
    L('Locked stack + its mine', -22, row2 + 42, 'face-down tiles, mine lies on top');
    const tr = kit.tray(PLAYER_COLORS.blue, [2, 3, 5]); tr.position.set(110, 0, row2); g.add(tr);
    L('Control Module tray', 110, row2 + 64, 'Blue · 2, 3, 5 are on buildings');
    ['blue', 'red', 'orange', 'green'].forEach((c, i) => { const m = kit.module(PLAYER_COLORS[c], [6, 12, 3, 17][i]); m.position.set(168 + (i % 2) * 21, 0, row2 - 22 + Math.floor(i / 2) * 21); m.rotation.y = ((i * 7) % 5 - 2) * 3 * DEG; g.add(m); });
    L('Loose modules', 178, row2 + 22, 'all four colours');
    const bt = kit.tile('blank'); bt.position.set(262, 0, row2); g.add(bt);
    addBeltAt(kit, g, [262, row2], [3, 0], [1, 1], PLAYER_COLORS.blue);
    addBeltAt(kit, g, [262, row2], [4, 1], [0, 0], PLAYER_COLORS.red);
    L('Belts', 262, row2 + 42, 'chain links, hole to hole');
    const cb = kit.card(null); cb.position.set(-70, 0.2, row3); cb.rotation.y = 3 * DEG; g.add(cb);
    L('Leverage card · back', -70, row3 + 46, null);
    const cf = kit.card('Scouting Drone'); cf.position.set(30, 0.2, row3); cf.rotation.y = -3 * DEG; g.add(cf);
    L('Leverage card · face', 30, row3 + 46, null);
    const dk = (x, n) => { for (let i = 0; i < n; i++) { const c = kit.card(null); c.position.set(x + (i % 2) * 0.6, 0.2 + i * 0.42, row3 + (i % 3) * 0.4); g.add(c); } };
    dk(-170, 14); L('Deck', -170, row3 + 46, 'face down on the table');
    const pm = kit.tile('plate'); pm.position.set(160, 0, row3); g.add(pm);
    const mm = kit.module(PLAYER_COLORS.blue, 3); mm.position.set(160, TILE_T, row3); g.add(mm);
    const bp = (e, j, inset) => { const h = holeCentroid(e, j); const s = (len(h) - inset) / len(h); return [160 + h[0] * s, row3 + h[1] * s]; };
    const o = kit.ore(); const op = bp(4, 1, 4.5); o.position.set(op[0], TILE_T, op[1]); g.add(o);
    const tp = kit.teleporter(PLAYER_COLORS.blue); const tpp = bp(1, 1, 1.5); tp.position.set(tpp[0], TILE_T, tpp[1]); g.add(tp);
    const mp = kit.meeple(PLAYER_COLORS.blue); mp.position.set(181, TILE_T, row3 - 3); g.add(mp);
    L('Pieces in play', 160, row3 + 42, 'ore on input · teleporter on output · meeple');
  } else {
    const rowA = -36, rowB = 50;
    ['blue', 'red', 'orange', 'green'].forEach((c, i) => { const m = kit.meeple(PLAYER_COLORS[c]); m.position.set(-150 + i * 17, 0, rowA - 4 + (i % 2) * 3); m.rotation.y = (i - 1.5) * 9 * DEG; g.add(m); });
    L('Meeples', -124.5, rowA + 10, 'blue · red · orange · green');
    const place = (obj, x, z, name, sub, lz = 12) => { obj.position.x = x; obj.position.z = z; g.add(obj); L(name, x, z + lz, sub); };
    const o = kit.ore(); o.rotation.y = 0.3; place(o, -62, rowA, 'Ore', 'iridescent triangle');
    const p = kit.plate(); p.rotation.y = -0.2; place(p, -20, rowA, 'Plate', 'translucent parallelogram');
    place(kit.sphere(), 22, rowA, 'Sphere', 'green glitter disc');
    const ts = kit.tesseract(); ts.rotation.y = 0.5; place(ts, 62, rowA, 'Tesseract', 'three square frames');
    const tk = kit.powerToken(); tk.rotation.y = 0.2; place(tk, 106, rowA, 'Power token', 'gold · lightning bolt', 16);
    place(kit.teleporter(PLAYER_COLORS.blue), -110, rowB, 'Teleporter', 'placeholder · glowing collar', 14);
    const d1 = kit.die(5); d1.position.set(-36, 8, rowB - 2); d1.rotation.y = 15 * DEG; g.add(d1);
    L('Dice', -36, rowB + 14, 'placeholder · one per mine in play');
    const sm = kit.startMarker(); sm.position.set(40, 0, rowB); sm.rotation.y = -20 * DEG; g.add(sm);
    L('Starting player', 40, rowB + 14, 'placeholder');
    const mods = [['blue', 1], ['red', 9], ['orange', 15], ['green', 6]];
    mods.forEach(([c, n], i) => { const m = kit.module(PLAYER_COLORS[c], n); m.position.set(90 + i * 19, 0, rowB); g.add(m); });
    L('Control Modules', 118.5, rowB + 12, '6 and 9 carry a bar');
  }  return g;
}
function addBeltAt(kit, parent, centre, a, b, color) {
  // same as addBelt but at an arbitrary centre (gallery)
  const P0 = add(centre, holeCentroid(a[0], a[1])), P2 = add(centre, holeCentroid(b[0], b[1]));
  const mid = mul(add(P0, P2), 0.5), C = add(mid, mul(sub(centre, mid), 0.75));
  const N = 200, pts = [], cum = [0];
  for (let i = 0; i <= N; i++) { const t = i / N, u = 1 - t; pts.push([u * u * P0[0] + 2 * u * t * C[0] + t * t * P2[0], u * u * P0[1] + 2 * u * t * C[1] + t * t * P2[1]]); if (i) cum.push(cum[i - 1] + len(sub(pts[i], pts[i - 1]))); }
  const Lh = cum[N];
  const at = (s) => { let i = cum.findIndex((v) => v >= s); if (i < 1) i = 1; const f = (s - cum[i - 1]) / (cum[i] - cum[i - 1] || 1); return [add(pts[i - 1], mul(sub(pts[i], pts[i - 1]), f)), norm(sub(pts[i], pts[i - 1]))]; };
  const mat = kit.plastic(color);
  const place = (kind, s, lift = 0) => { const [p, d] = at(s); const m = new THREE.Mesh(kit.beltLink(kind), mat); m.position.set(p[0], TILE_T + lift, p[1]); m.rotation.y = -Math.atan2(d[1], d[0]); m.castShadow = true; parent.add(m); };
  place('tail', 2.2);
  const s0 = 7.6, s1 = Lh - 8.2, n = Math.max(2, Math.round((s1 - s0) / 4.3));
  for (let i = 0; i <= n; i++) place('chev', s0 + ((s1 - s0) * i) / n);
  place('head', Lh - 3.2);
}

// ---------------------------------------------------------------- public: mount the table on a canvas
export function mountTable(canvas, opts = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(opts.pixelRatio ?? Math.min(window.devicePixelRatio || 1, 3));
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = opts.exposure ?? 1.05;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#140d09');
  const pm = new THREE.PMREMGenerator(renderer);
  scene.environment = pm.fromScene(new RoomEnvironment(renderer), 0.04).texture;

  const kit = makeKit(renderer);
  const anchors = {}, labels = [];

  // table
  const wood = woodTexture(renderer); wood.repeat.set(9, 9);
  const table = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000), new THREE.MeshStandardMaterial({ map: wood, roughness: 0.62, metalness: 0, envMapIntensity: 0.35, color: '#c9b6a6' }));
  table.rotation.x = -Math.PI / 2; table.position.y = -0.02; table.receiveShadow = true; scene.add(table);

  const variant = opts.variant || 'game';
  if (variant === 'game') buildGame(kit, scene, anchors, opts);
  else if (variant === 'gallery-large') buildGallery(kit, scene, anchors, labels, 'large');
  else if (variant === 'gallery-small') buildGallery(kit, scene, anchors, labels, 'small');

  // lights
  const cam = opts.camera || {};
  const target = new THREE.Vector3(cam.target?.[0] ?? 0, 0, cam.target?.[1] ?? 0);
  scene.add(new THREE.HemisphereLight('#fff4e6', '#3a271a', 1.15));
  const sun = new THREE.DirectionalLight('#fff2dc', 2.7);
  sun.position.set(target.x - 260, 620, target.z + 140); sun.target.position.copy(target);
  sun.castShadow = true; sun.shadow.mapSize.set(4096, 4096);
  const sc = sun.shadow.camera; sc.left = -560; sc.right = 560; sc.top = 560; sc.bottom = -560; sc.near = 10; sc.far = 2000;
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.25;
  scene.add(sun, sun.target);
  const rim = new THREE.DirectionalLight('#d6e2ff', 0.55); rim.position.set(target.x + 400, 300, target.z - 300); scene.add(rim);

  // orthographic isometric-style camera
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 6000);
  const el = (cam.elevation ?? 45) * DEG, az = (cam.azimuth ?? 0) * DEG, dist = 2500;
  camera.position.set(target.x + Math.sin(az) * Math.cos(el) * dist, Math.sin(el) * dist, target.z + Math.cos(az) * Math.cos(el) * dist);
  camera.up.set(0, 1, 0); camera.lookAt(target);

  function frame() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    renderer.setSize(w, h, false);
    const hh = (cam.viewHeight ?? 560) / 2, hw = hh * (w / h);
    const sx = cam.shift?.[0] ?? 0, sy = cam.shift?.[1] ?? 0;
    camera.left = -hw - sx * 2 * hw; camera.right = hw - sx * 2 * hw;
    camera.top = hh + sy * 2 * hh; camera.bottom = -hh + sy * 2 * hh;
    camera.updateProjectionMatrix();
    renderer.render(scene, camera);
  }
  frame();

  const project = (p) => {
    const v = (typeof p === 'string' ? anchors[p] : p).clone().project(camera);
    const r = canvas.getBoundingClientRect();
    return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
  };
  return {
    renderer, scene, camera, anchors,
    render: frame,
    project,
    anchor: (name) => project(name),
    labels: () => labels.map((l) => ({ ...l, ...project(l.pos) })),
  };
}
