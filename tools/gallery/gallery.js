// Piece gallery: loads every model listed in public/models/manifest.json and lays them out at true
// scale on a dark wood table under an orthographic isometric camera. Player-coloured parts are
// tinted blue. Views: ?view=all (default), ?view=tiles (factory, power plant and mine close-up),
// ?view=pieces (small pieces close-up), ?view=modules (tray), ?top=1 for a straight-down camera.
// Run: npx vite, then open /tools/gallery/index.html. Sets window.__ready when drawn.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const params = new URLSearchParams(location.search);
const view = params.get('view') ?? 'all';
const topDown = params.get('top') === '1';
const PLAYER_BLUE = 0x2f5fd0;

const VIEWS = {
  all: {
    title: 'All converted pieces (true scale, millimetres)',
    rows: [
      ['tile-blank', 'tile-plate-factory', 'tile-sphere-factory', 'tile-tesseract-factory', 'tile-power-plant', 'starting-player'],
      ['mine-1', 'mine-2', 'mine-3'],
      ['control-module-tray', 'belt', 'meeple', 'ore', 'plate', 'sphere', 'tesseract', 'power-token', 'control-module'],
    ],
    gap: 14,
  },
  tiles: {
    title: 'Board tiles close-up',
    rows: [
      ['tile-plate-factory', 'tile-sphere-factory', 'tile-tesseract-factory'],
      ['tile-power-plant', 'mine-1'],
      ['mine-2', 'mine-3'],
    ],
    gap: 8,
  },
  modules: { title: 'Control Module tray and tile, meeple', rows: [['control-module-tray', 'control-module', 'meeple']], gap: 10 },
  pieces: {
    title: 'Small pieces close-up (with a blank tile for scale)',
    rows: [
      ['tile-blank', 'starting-player'],
      ['meeple', 'ore', 'plate', 'sphere', 'tesseract', 'power-token', 'control-module', 'belt'],
    ],
    gap: 8,
  },
};

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x24180f);

function woodTexture() {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 1024;
  const g = c.getContext('2d');
  g.fillStyle = '#3b2719';
  g.fillRect(0, 0, 1024, 1024);
  // Deterministic grain: long streaks of slightly lighter and darker brown.
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 420; i++) {
    const y = rnd() * 1024;
    const shade = rnd() < 0.5 ? 'rgba(20,10,5,' : 'rgba(90,60,40,';
    g.strokeStyle = shade + (0.08 + rnd() * 0.18) + ')';
    g.lineWidth = 1 + rnd() * 3;
    g.beginPath();
    g.moveTo(0, y);
    for (let x = 0; x <= 1024; x += 64) g.lineTo(x, y + Math.sin(x / 180 + i) * 6 * rnd());
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(3, 3);
  t.anisotropy = 8;
  return t;
}

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(4000, 4000),
  new THREE.MeshStandardMaterial({ map: woodTexture(), roughness: 0.8, metalness: 0 }),
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

scene.add(new THREE.HemisphereLight(0xfff4e6, 0x3a2a1e, 1.3));
const sun = new THREE.DirectionalLight(0xffffff, 2.2);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
sun.shadow.radius = 4;
sun.shadow.bias = -0.0004;
scene.add(sun);
scene.add(sun.target);
const fill = new THREE.DirectionalLight(0xdfe8ff, 0.5);
fill.position.set(-300, 200, -100);
scene.add(fill);

const labels = document.getElementById('labels');
document.getElementById('title').textContent = VIEWS[view].title;

const manifest = await (await fetch('/models/manifest.json')).json();
const byName = new Map(manifest.models.map((m) => [m.name, m]));
const loader = new GLTFLoader();

// Lay the rows out in a 'layout' group. In the isometric view the group is turned 45 degrees so
// that rows run left-to-right on screen; in the top-down view it is not turned and print +Y
// (glTF -Z) points up the screen, so the pieces can be compared with the photos directly.
const layout = new THREE.Group();
layout.rotation.y = topDown ? 0 : Math.PI / 4;
scene.add(layout);
const placed = [];
let z = 0;
const gap = VIEWS[view].gap;
const rows = VIEWS[view].rows.map((r) => r.filter((n) => byName.has(n)));
const rowInfo = rows.map((names) => {
  const items = names.map((n) => byName.get(n));
  const width = items.reduce((s, m) => s + m.bbox.size[0], 0) + gap * (items.length - 1);
  const depth = Math.max(...items.map((m) => m.bbox.size[2]));
  return { items, width, depth };
});
const rowGap = gap + 16; // room for the labels
const totalDepth = rowInfo.reduce((s, r) => s + r.depth, 0) + rowGap * (rowInfo.length - 1);
z = -totalDepth / 2;
for (const row of rowInfo) {
  let x = -row.width / 2;
  for (const m of row.items) {
    const gltf = await loader.loadAsync(`/models/${m.file}`);
    const obj = gltf.scene;
    obj.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
        if (o.material.name === 'player') {
          o.material = o.material.clone();
          o.material.color.setHex(PLAYER_BLUE);
        }
      }
    });
    const cx = x + m.bbox.size[0] / 2 - (m.bbox.min[0] + m.bbox.max[0]) / 2;
    const cz = z + row.depth / 2 - (m.bbox.min[2] + m.bbox.max[2]) / 2;
    obj.position.set(cx, 0, cz);
    layout.add(obj);
    placed.push({ m, local: new THREE.Vector3(cx + (m.bbox.min[0] + m.bbox.max[0]) / 2, 0, z + row.depth + 2) });
    x += m.bbox.size[0] + gap;
  }
  z += row.depth + rowGap;
}
layout.updateMatrixWorld(true);

// Orthographic camera: true isometric (or straight down), framed on everything placed.
const aspect = innerWidth / innerHeight;
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 5000);
const dir = topDown ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 1, 1).normalize();
camera.position.copy(dir.clone().multiplyScalar(1500));
camera.up.set(0, topDown ? 0 : 1, topDown ? -1 : 0);
camera.lookAt(0, 0, 0);
camera.updateMatrixWorld();
const inv = camera.matrixWorldInverse;
let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
const grow = (v) => {
  v.applyMatrix4(inv);
  minX = Math.min(minX, v.x); maxX = Math.max(maxX, v.x); minY = Math.min(minY, v.y); maxY = Math.max(maxY, v.y);
};
for (const o of layout.children) {
  const b = new THREE.Box3().setFromObject(o);
  for (const x of [b.min.x, b.max.x]) for (const y of [b.min.y, b.max.y]) for (const zz of [b.min.z, b.max.z]) grow(new THREE.Vector3(x, y, zz));
}
for (const p of placed) grow(layout.localToWorld(p.local.clone()));
let halfW = ((maxX - minX) / 2) * 1.06;
let halfH = ((maxY - minY) / 2) * 1.06 + 14;
if (halfW / halfH > aspect) halfH = halfW / aspect; else halfW = halfH * aspect;
const midX = (minX + maxX) / 2;
const midY = (minY + maxY) / 2 - 6;
Object.assign(camera, { left: midX - halfW, right: midX + halfW, top: midY + halfH, bottom: midY - halfH });
camera.updateProjectionMatrix();

const span = Math.max(maxX - minX, maxY - minY);
sun.position.set(-span * 0.3, span * 0.9, span * 0.45);
sun.target.position.set(0, 0, 0);
const s = span * 0.8;
Object.assign(sun.shadow.camera, { left: -s, right: s, top: s, bottom: -s, near: 1, far: span * 4 });
sun.shadow.camera.updateProjectionMatrix();

renderer.render(scene, camera);

for (const p of placed) {
  const v = layout.localToWorld(p.local.clone()).project(camera);
  const el = document.createElement('div');
  el.className = 'label' + (p.m.withinBudget ? '' : ' over');
  el.style.left = `${((v.x + 1) / 2) * innerWidth}px`;
  el.style.top = `${((1 - v.y) / 2) * innerHeight}px`;
  el.innerHTML = `<b>${p.m.title}</b><br><span>${p.m.trianglesAfter.toLocaleString('en')} tris, ${(p.m.bytes / 1024).toFixed(0)} KB</span>`;
  labels.appendChild(el);
}
window.__ready = true;
