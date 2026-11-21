// The offline file list for the service worker, built at build time (vite.config.ts) from every
// file in the build folder: the page, every script chunk (also the lazily loaded 3D table and
// Three.js), the stylesheets, the piece models, the icons and the manifest. With all of them
// stored, a solo game works offline after one visit to the menu.
//
// Each entry carries a short content revision, so a new version of the app downloads only the
// files that changed (the service worker copies unchanged files from the previous version's
// store). Pure: no file system or Node APIs, so it is tested in Vitest.

export interface BuiltFile {
  /** Path inside the build folder, with either slash. */
  path: string;
  bytes: Uint8Array;
}

export interface PrecacheEntry {
  /** URL relative to the site root (the service worker's scope), e.g. "models/belt.glb". */
  url: string;
  /** Content revision: size and a 32-bit hash. Equal revisions mean equal files. */
  rev: string;
  bytes: number;
}

/** Files never stored by the worker: the worker itself, source maps, and hidden files. */
export function isPrecached(path: string): boolean {
  const p = path.replace(/\\/g, '/').replace(/^\.?\//, '');
  const name = p.split('/').pop() ?? '';
  if (p === 'sw.js') return false;
  if (name.endsWith('.map')) return false;
  if (p.split('/').some(part => part.startsWith('.'))) return false;
  return p.length > 0;
}

/** FNV-1a over the bytes, with the size: enough to tell versions of one file apart. */
export function fileRev(bytes: Uint8Array): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i]!;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${bytes.length.toString(36)}-${h.toString(16).padStart(8, '0')}`;
}

/** The sorted precache list. "index.html" is listed as "./" (the page itself). */
export function precacheEntries(files: readonly BuiltFile[]): PrecacheEntry[] {
  const out: PrecacheEntry[] = [];
  for (const f of files) {
    if (!isPrecached(f.path)) continue;
    const p = f.path.replace(/\\/g, '/').replace(/^\.?\//, '');
    out.push({ url: p === 'index.html' ? './' : p, rev: fileRev(f.bytes), bytes: f.bytes.length });
  }
  return out.sort((a, b) => (a.url < b.url ? -1 : a.url > b.url ? 1 : 0));
}

export function totalBytes(entries: readonly PrecacheEntry[]): number {
  return entries.reduce((n, e) => n + e.bytes, 0);
}
