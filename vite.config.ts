import { defineConfig, type Plugin } from 'vite';
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { precacheEntries, totalBytes } from './src/app/precache';
import { fileURLToPath } from 'node:url';

// Version label shown in the app: "<package.json version>+<short git SHA>".
// Falls back to "dev" when git is unavailable (e.g. building from a source archive).
function appVersion(): string {
  const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };
  try {
    const sha = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    return sha ? `${pkg.version}+${sha}` : 'dev';
  } catch {
    return 'dev';
  }
}

const APP_VERSION = appVersion();

/**
 * Fills the placeholders in the copied public/sw.js: the app version (so every deploy changes the
 * worker and triggers the "Update ready" notice) and the list of every built file to store for
 * offline play, each with a content revision (see src/app/precache.ts).
 */
function listFiles(dir: string, root = dir): { path: string; bytes: Uint8Array }[] {
  const out: { path: string; bytes: Uint8Array }[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...listFiles(p, root));
    else out.push({ path: relative(root, p), bytes: readFileSync(p) });
  }
  return out;
}

function serviceWorkerManifest(): Plugin {
  let outDir = 'dist';
  return {
    name: 'fs-service-worker-manifest',
    apply: 'build',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    writeBundle() {
      const swPath = join(outDir, 'sw.js');
      if (!existsSync(swPath)) return;
      // Every file in the build folder (the public folder is copied there before this runs).
      const entries = precacheEntries(listFiles(outDir));
      const files = entries.map((e) => [e.url, e.rev]);
      // eslint-disable-next-line no-console
      console.log(`service worker: ${entries.length} files, ${(totalBytes(entries) / 1024 / 1024).toFixed(2)} MB stored for offline play`);
      const versionToken = "'__APP_VERSION__'";
      const listToken = '/* __PRECACHE_LIST__ */ []';
      const source = readFileSync(swPath, 'utf8');
      if (!source.includes(versionToken) || !source.includes(listToken)) {
        throw new Error('public/sw.js: build placeholders not found');
      }
      writeFileSync(swPath, source.replace(versionToken, JSON.stringify(APP_VERSION)).replace(listToken, JSON.stringify(files)));
    },
  };
}

export default defineConfig({
  // The site is served from a sub-path on GitHub Pages, so every URL must be relative.
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(APP_VERSION),
  },
  plugins: [serviceWorkerManifest()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      // net-check.html: the network check page, shipped so players can open it on their device.
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        netCheck: fileURLToPath(new URL('./net-check.html', import.meta.url)),
      },
    },
  },
});
