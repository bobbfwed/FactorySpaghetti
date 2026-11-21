// Mesh helpers for the 3MF -> glTF converter: welding, connected components, simplification,
// crease-angle normals. All functions are pure and deterministic (no randomness, stable order).
import { MeshoptSimplifier } from 'meshoptimizer';

const Q = 1e4; // weld precision: 0.1 micrometre

/**
 * Weld a triangle soup. tris: Array<{ p: [x,y,z, x,y,z, x,y,z], role }>.
 * Vertices are shared only between triangles of the same role, so a colour border stays a seam.
 * Returns { positions: Float32Array, indices: Uint32Array, roles: string[] (per triangle), vertexRole }.
 */
export function weld(tris) {
  const map = new Map();
  const pos = [];
  const vertexRole = [];
  const idx = [];
  const roles = [];
  for (const t of tris) {
    const ids = [];
    for (let c = 0; c < 3; c++) {
      const x = t.p[c * 3];
      const y = t.p[c * 3 + 1];
      const z = t.p[c * 3 + 2];
      const key = `${t.role}|${Math.round(x * Q)}|${Math.round(y * Q)}|${Math.round(z * Q)}`;
      let id = map.get(key);
      if (id === undefined) {
        id = pos.length / 3;
        map.set(key, id);
        pos.push(x, y, z);
        vertexRole.push(t.role);
      }
      ids.push(id);
    }
    if (ids[0] === ids[1] || ids[1] === ids[2] || ids[0] === ids[2]) continue; // degenerate
    idx.push(ids[0], ids[1], ids[2]);
    roles.push(t.role);
  }
  return { positions: Float32Array.from(pos), indices: Uint32Array.from(idx), roles, vertexRole };
}

/** Connected components by shared position (ignores role). Returns array of triangle-index lists. */
export function components(positions, indices) {
  const n = positions.length / 3;
  const posKey = new Map();
  const canon = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    const k = `${Math.round(positions[i * 3] * Q)}|${Math.round(positions[i * 3 + 1] * Q)}|${Math.round(positions[i * 3 + 2] * Q)}`;
    let c = posKey.get(k);
    if (c === undefined) {
      c = i;
      posKey.set(k, c);
    }
    canon[i] = c;
  }
  const parent = new Int32Array(n).map((_, i) => i);
  const find = (a) => {
    while (parent[a] !== a) {
      parent[a] = parent[parent[a]];
      a = parent[a];
    }
    return a;
  };
  const unite = (a, b) => {
    a = find(a);
    b = find(b);
    if (a !== b) parent[Math.max(a, b)] = Math.min(a, b);
  };
  const triCount = indices.length / 3;
  for (let t = 0; t < triCount; t++) {
    unite(canon[indices[t * 3]], canon[indices[t * 3 + 1]]);
    unite(canon[indices[t * 3]], canon[indices[t * 3 + 2]]);
  }
  const groups = new Map();
  for (let t = 0; t < triCount; t++) {
    const r = find(canon[indices[t * 3]]);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(t);
  }
  return [...groups.values()];
}

/**
 * Simplify to at most targetTris, never exceeding maxError (absolute, mm). Colour seams are kept
 * by meshoptimizer (vertices with equal positions but different indices form a locked seam).
 * Returns { indices, error } — the triangle count may stay above target if the error cap binds.
 */
export async function simplify(positions, indices, targetTris, maxError) {
  await MeshoptSimplifier.ready;
  if (indices.length / 3 <= targetTris) return { indices, error: 0 };
  const [out, err] = MeshoptSimplifier.simplify(indices, positions, 3, targetTris * 3, maxError, ['ErrorAbsolute']);
  return { indices: out, error: err };
}

/**
 * Simplify each colour part on its own (budget shared in proportion to triangle count). Used when
 * an inlay is a separate solid sitting in a pocket of the body: simplified together, the shared rim
 * is treated as a seam and stays locked, which can keep the count far above the budget. Open
 * borders of a part (painted patches) stay locked so painted regions keep meeting without cracks.
 */
export async function simplifyPerPart(positions, indices, vertexRole, targetTris, maxError) {
  await MeshoptSimplifier.ready;
  const total = indices.length / 3;
  if (total <= targetTris) return { indices, error: 0 };
  const groups = new Map();
  for (let t = 0; t < indices.length; t += 3) {
    const r = vertexRole[indices[t]];
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(indices[t], indices[t + 1], indices[t + 2]);
  }
  const out = [];
  let error = 0;
  // Smallest parts first; whatever they cannot give up is taken from the larger parts after them.
  const order = [...groups.keys()].sort((a, b) => groups.get(a).length - groups.get(b).length || (a < b ? -1 : 1));
  let budgetLeft = targetTris;
  let trisLeft = total;
  for (const r of order) {
    const g = Uint32Array.from(groups.get(r));
    const n = g.length / 3;
    const target = Math.max(4, Math.floor((budgetLeft * n) / trisLeft));
    const [res, err] = MeshoptSimplifier.simplify(g, positions, 3, target * 3, maxError, ['ErrorAbsolute', 'LockBorder', 'Sparse']);
    error = Math.max(error, err);
    out.push(...res);
    budgetLeft -= res.length / 3;
    trisLeft -= n;
  }
  return { indices: Uint32Array.from(out), error };
}

/**
 * Build one flat-looking primitive: normals averaged only across faces within creaseDeg of each
 * other (so flat faces and hard edges stay crisp, curved bevels stay smooth). Returns compact
 * { positions: Float32Array, normals: Float32Array, indices: Uint16Array|Uint32Array }.
 */
export function buildPrimitive(positions, triIndices, creaseDeg) {
  const cosT = Math.cos((creaseDeg * Math.PI) / 180);
  const T = triIndices.length / 3;
  const fn = new Float64Array(T * 3); // area-weighted face normals
  const unit = new Float64Array(T * 3);
  for (let t = 0; t < T; t++) {
    const a = triIndices[t * 3] * 3;
    const b = triIndices[t * 3 + 1] * 3;
    const c = triIndices[t * 3 + 2] * 3;
    const ux = positions[b] - positions[a];
    const uy = positions[b + 1] - positions[a + 1];
    const uz = positions[b + 2] - positions[a + 2];
    const vx = positions[c] - positions[a];
    const vy = positions[c + 1] - positions[a + 1];
    const vz = positions[c + 2] - positions[a + 2];
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    fn[t * 3] = nx;
    fn[t * 3 + 1] = ny;
    fn[t * 3 + 2] = nz;
    unit[t * 3] = nx / l;
    unit[t * 3 + 1] = ny / l;
    unit[t * 3 + 2] = nz / l;
  }
  const facesOf = new Map();
  for (let t = 0; t < T; t++) {
    for (let k = 0; k < 3; k++) {
      const v = triIndices[t * 3 + k];
      if (!facesOf.has(v)) facesOf.set(v, []);
      facesOf.get(v).push(t);
    }
  }
  const outPos = [];
  const outNrm = [];
  const outIdx = [];
  const corner = new Map();
  for (let t = 0; t < T; t++) {
    for (let k = 0; k < 3; k++) {
      const v = triIndices[t * 3 + k];
      let nx = 0;
      let ny = 0;
      let nz = 0;
      for (const f of facesOf.get(v)) {
        const d = unit[f * 3] * unit[t * 3] + unit[f * 3 + 1] * unit[t * 3 + 1] + unit[f * 3 + 2] * unit[t * 3 + 2];
        if (d >= cosT) {
          nx += fn[f * 3];
          ny += fn[f * 3 + 1];
          nz += fn[f * 3 + 2];
        }
      }
      const l = Math.hypot(nx, ny, nz) || 1;
      nx /= l;
      ny /= l;
      nz /= l;
      const key = `${v}|${Math.round(nx * 1000)}|${Math.round(ny * 1000)}|${Math.round(nz * 1000)}`;
      let id = corner.get(key);
      if (id === undefined) {
        id = outPos.length / 3;
        corner.set(key, id);
        outPos.push(positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2]);
        outNrm.push(nx, ny, nz);
      }
      outIdx.push(id);
    }
  }
  const nV = outPos.length / 3;
  return {
    positions: Float32Array.from(outPos),
    normals: Float32Array.from(outNrm),
    indices: nV < 65536 ? Uint16Array.from(outIdx) : Uint32Array.from(outIdx),
  };
}

/** Signed volume of a closed mesh (positive when faces wind counter-clockwise seen from outside). */
export function signedVolume(positions, indices) {
  let v = 0;
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t] * 3;
    const b = indices[t + 1] * 3;
    const c = indices[t + 2] * 3;
    v +=
      positions[a] * (positions[b + 1] * positions[c + 2] - positions[b + 2] * positions[c + 1]) -
      positions[a + 1] * (positions[b] * positions[c + 2] - positions[b + 2] * positions[c]) +
      positions[a + 2] * (positions[b] * positions[c + 1] - positions[b + 1] * positions[c]);
  }
  return v / 6;
}
