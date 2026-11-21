import { defineConfig, type Plugin } from 'vite';
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

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
 * worker and triggers the "Update ready" notice) and the list of built files to precache.
 */
function serviceWorkerManifest(): Plugin {
  let outDir = 'dist';
  return {
    name: 'fs-service-worker-manifest',
    apply: 'build',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    writeBundle(_options, bundle) {
      const swPath = join(outDir, 'sw.js');
      if (!existsSync(swPath)) return;
      const files = Object.keys(bundle).filter((f) => !f.endsWith('.map')).sort();
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
  build: { outDir: 'dist', emptyOutDir: true },
});
