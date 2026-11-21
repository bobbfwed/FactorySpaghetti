// Lists what is inside .3mf files: build items, objects, parts, triangle counts, sizes, names,
// filament (colour) assignments. Usage: node tools/inspect-3mf.mjs <file.3mf> [more...]
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { open3mf, flattenObject, applyTransform } from './lib/threemf.mjs';

for (const file of process.argv.slice(2)) {
  const doc = open3mf(readFileSync(file));
  console.log(`\n=== ${basename(file)}  (models: ${[...doc.models.keys()].join(', ')})`);
  if (doc.filamentColours.length) console.log(`  filament colours: ${doc.filamentColours.join(' ')}`);
  doc.root.build.forEach((item, i) => {
    const parts = flattenObject(doc, doc.rootPath, item.objectid, item.transform);
    const st = doc.settings.get(String(item.objectid));
    let tris = 0;
    const lo = [Infinity, Infinity, Infinity];
    const hi = [-Infinity, -Infinity, -Infinity];
    const lines = [];
    for (const p of parts) {
      const pos = p.mesh.positions;
      const plo = [Infinity, Infinity, Infinity];
      const phi = [-Infinity, -Infinity, -Infinity];
      for (let k = 0; k < pos.length; k += 3) {
        const w = applyTransform(p.transform, pos[k], pos[k + 1], pos[k + 2]);
        for (let a = 0; a < 3; a++) {
          plo[a] = Math.min(plo[a], w[a]);
          phi[a] = Math.max(phi[a], w[a]);
        }
      }
      for (let a = 0; a < 3; a++) {
        lo[a] = Math.min(lo[a], plo[a]);
        hi[a] = Math.max(hi[a], phi[a]);
      }
      const nt = p.mesh.indices.length / 3;
      tris += nt;
      const ps = st?.parts.get(String(p.partObjectId));
      const painted = p.mesh.triAttrs.filter((x) => x).length;
      const paintSet = new Set(p.mesh.triAttrs.filter((x) => x));
      lines.push(
        `    part obj ${p.partObjectId} "${ps?.name ?? p.name}" ext=${ps?.extruder ?? '-'} tris=${nt} ` +
          `size=${(phi[0] - plo[0]).toFixed(1)}x${(phi[1] - plo[1]).toFixed(1)}x${(phi[2] - plo[2]).toFixed(2)} ` +
          `min=(${plo.map((x) => x.toFixed(1)).join(',')})` +
          (painted ? ` painted=${painted} codes=${[...paintSet].slice(0, 6).join('|')}` : ''),
      );
    }
    console.log(
      `  item ${i} obj ${item.objectid} "${st?.name ?? ''}" ext=${st?.extruder ?? '-'} parts=${parts.length} tris=${tris} ` +
        `size=${(hi[0] - lo[0]).toFixed(1)}x${(hi[1] - lo[1]).toFixed(1)}x${(hi[2] - lo[2]).toFixed(2)} ` +
        `centre=(${((hi[0] + lo[0]) / 2).toFixed(1)},${((hi[1] + lo[1]) / 2).toFixed(1)})`,
    );
    if (parts.length > 1 || process.env.VERBOSE) lines.forEach((l) => console.log(l));
  });
}
