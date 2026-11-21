// Minimal .3mf reader (Node, no DOM). A .3mf is a zip holding one or more model XML files.
// Handles the 3MF core spec plus the production extension (components that point at objects in
// other model files via p:path), which Bambu Studio / Orca use for multi-part (AMS) prints.
import { unzipSync, strFromU8 } from 'fflate';

const ATTR_RE = /([\w:]+)\s*=\s*"([^"]*)"/g;

function attrs(tag) {
  const out = {};
  ATTR_RE.lastIndex = 0;
  let m;
  while ((m = ATTR_RE.exec(tag))) out[m[1]] = m[2];
  return out;
}

/** 3MF transform "m00 m01 m02 m10 m11 m12 m20 m21 m22 m30 m31 m32" -> 12-number affine (row vectors). */
export function parseTransform(s) {
  if (!s) return identity();
  const n = s.trim().split(/\s+/).map(Number);
  if (n.length !== 12 || n.some((x) => !Number.isFinite(x))) throw new Error(`bad transform "${s}"`);
  return n;
}

export function identity() {
  return [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];
}

/** Compose: apply a first, then b (3MF row-vector convention: p' = p * M). */
export function compose(a, b) {
  const A = (r, c) => a[r * 3 + c];
  const B = (r, c) => b[r * 3 + c];
  const out = new Array(12);
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 3; c++) {
      let v = 0;
      for (let k = 0; k < 3; k++) v += A(r, k) * B(k, c);
      if (r === 3) v += B(3, c);
      out[r * 3 + c] = v;
    }
  }
  return out;
}

export function applyTransform(m, x, y, z) {
  return [
    x * m[0] + y * m[3] + z * m[6] + m[9],
    x * m[1] + y * m[4] + z * m[7] + m[10],
    x * m[2] + y * m[5] + z * m[8] + m[11],
  ];
}

export function determinant(m) {
  return (
    m[0] * (m[4] * m[8] - m[5] * m[7]) -
    m[1] * (m[3] * m[8] - m[5] * m[6]) +
    m[2] * (m[3] * m[7] - m[4] * m[6])
  );
}

/** Parse one model XML string into { objects: Map<id, obj>, build: item[] }. */
export function parseModelXml(xml) {
  const objects = new Map();
  const build = [];
  // Split into <object ...> ... </object> blocks; build items live in <build>.
  const objRe = /<object\b([^>]*?)(\/>|>([\s\S]*?)<\/object>)/g;
  let m;
  while ((m = objRe.exec(xml))) {
    const a = attrs(m[1]);
    const body = m[3] ?? '';
    const obj = { id: a.id, name: a.name ?? '', type: a.type ?? 'model', pid: a.pid, mesh: null, components: [] };
    const meshStart = body.indexOf('<mesh');
    if (meshStart >= 0) {
      const vs = [];
      const vRe = /<vertex\s+([^>]*?)\/>/g;
      const vSec = body.slice(meshStart, body.indexOf('</vertices>', meshStart));
      let v;
      while ((v = vRe.exec(vSec))) {
        const va = attrs(v[1]);
        vs.push(+va.x, +va.y, +va.z);
      }
      const tStart = body.indexOf('<triangles', meshStart);
      const tSec = body.slice(tStart, body.indexOf('</triangles>', tStart));
      const tris = [];
      const triAttrs = [];
      const tRe = /<triangle\s+([^>]*?)\/>/g;
      let t;
      while ((t = tRe.exec(tSec))) {
        const ta = attrs(t[1]);
        tris.push(+ta.v1, +ta.v2, +ta.v3);
        // Keep any colour hints (paint_color = Bambu per-triangle painting; pid/p1 = 3MF materials).
        const extra = ta.paint_color ?? ta['slic3rpe:mmu_segmentation'] ?? (ta.pid !== undefined || ta.p1 !== undefined ? `${ta.pid ?? ''}:${ta.p1 ?? ''}` : null);
        triAttrs.push(extra);
      }
      obj.mesh = { positions: Float64Array.from(vs), indices: Uint32Array.from(tris), triAttrs };
    }
    const cRe = /<component\s+([^>]*?)\/>/g;
    let c;
    while ((c = cRe.exec(body))) {
      const ca = attrs(c[1]);
      obj.components.push({ objectid: ca.objectid, path: ca['p:path'] ?? null, transform: parseTransform(ca.transform) });
    }
    objects.set(a.id, obj);
  }
  const bStart = xml.indexOf('<build');
  if (bStart >= 0) {
    const bSec = xml.slice(bStart, xml.indexOf('</build>', bStart) + 8);
    const iRe = /<item\s+([^>]*?)\/>/g;
    let it;
    while ((it = iRe.exec(bSec))) {
      const ia = attrs(it[1]);
      build.push({ objectid: ia.objectid, transform: parseTransform(ia.transform), printable: ia.printable !== '0' });
    }
  }
  return { objects, build };
}

/**
 * Bambu/Orca put per-object and per-part names and filament (extruder) numbers in
 * Metadata/model_settings.config. Returns Map<objectId, { name, extruder, parts: Map<partId, {name, extruder}> }>.
 */
export function parseModelSettings(xml) {
  const out = new Map();
  if (!xml) return out;
  const oRe = /<object\s+id="([^"]+)"\s*>([\s\S]*?)<\/object>/g;
  let o;
  while ((o = oRe.exec(xml))) {
    const body = o[2];
    const head = body.split('<part')[0];
    const meta = (sec) => {
      const r = {};
      const mRe = /<metadata\s+key="([^"]+)"\s+value="([^"]*)"\s*\/>/g;
      let mm;
      while ((mm = mRe.exec(sec))) r[mm[1]] = mm[2];
      return r;
    };
    const hm = meta(head);
    const parts = new Map();
    const pRe = /<part\s+id="([^"]+)"[^>]*>([\s\S]*?)<\/part>/g;
    let p;
    while ((p = pRe.exec(body))) {
      const pm = meta(p[2]);
      parts.set(p[1], { name: pm.name ?? '', extruder: pm.extruder ? +pm.extruder : null });
    }
    out.set(o[1], { name: hm.name ?? '', extruder: hm.extruder ? +hm.extruder : null, parts });
  }
  return out;
}

/** Open a .3mf buffer: returns { files: {path: Uint8Array}, models: Map<path, parsed>, root, settings }. */
export function open3mf(buf) {
  const files = unzipSync(buf instanceof Uint8Array ? buf : new Uint8Array(buf));
  const models = new Map();
  for (const [p, data] of Object.entries(files)) {
    if (p.toLowerCase().endsWith('.model')) models.set('/' + p.replace(/^\//, ''), parseModelXml(strFromU8(data)));
  }
  const rootPath = models.has('/3D/3dmodel.model') ? '/3D/3dmodel.model' : [...models.keys()][0];
  const settingsFile = files['Metadata/model_settings.config'];
  const settings = parseModelSettings(settingsFile ? strFromU8(settingsFile) : '');
  let colors = [];
  const proj = files['Metadata/project_settings.config'];
  if (proj) {
    try {
      const j = JSON.parse(strFromU8(proj));
      colors = j.filament_colour ?? [];
    } catch {
      /* not JSON in older versions */
    }
  }
  return { files, models, rootPath, root: models.get(rootPath), settings, filamentColours: colors };
}

/**
 * Flatten an object (following components across model files) into a list of mesh parts with
 * world transforms. Each part: { path, objectId, partObjectId, name, transform, mesh }.
 */
export function flattenObject(doc, modelPath, objectId, transform = identity(), out = [], chain = []) {
  const model = doc.models.get(modelPath);
  if (!model) throw new Error(`model file ${modelPath} missing`);
  const obj = model.objects.get(String(objectId));
  if (!obj) throw new Error(`object ${objectId} missing in ${modelPath}`);
  if (obj.mesh && obj.mesh.indices.length) {
    out.push({ path: modelPath, objectId: chain[0] ?? obj.id, partObjectId: obj.id, name: obj.name, transform, mesh: obj.mesh });
  }
  for (const c of obj.components) {
    const p = c.path ? c.path : modelPath;
    flattenObject(doc, p, c.objectid, compose(c.transform, transform), out, chain.length ? chain : [obj.id]);
  }
  return out;
}
