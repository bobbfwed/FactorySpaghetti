// The pure parts of `npm run release` (tools/release.mjs): version arithmetic and the edits to
// package.json, package-lock.json and README.md.
import { describe, expect, it } from 'vitest';
import {
  bumpVersion,
  compareVersions,
  githubPages,
  menuParts,
  parseVersion,
  setLockVersion,
  setPackageVersion,
  setReadmeVersion,
} from '../../../tools/release.mjs';

describe('version arithmetic', () => {
  it('raises the patch number, past 9 too', () => {
    expect(bumpVersion('0.1.3')).toBe('0.1.4');
    expect(bumpVersion('0.1.9')).toBe('0.1.10');
    expect(bumpVersion('0.1.99', 'patch')).toBe('0.1.100');
  });

  it('a minor bump raises the minor number and resets the patch', () => {
    expect(bumpVersion('0.1.9', 'minor')).toBe('0.2.0');
    expect(bumpVersion('1.9.12', 'minor')).toBe('1.10.0');
  });

  it('refuses something that is not X.Y.Z', () => {
    expect(() => bumpVersion('dev')).toThrow();
    expect(() => bumpVersion('0.1')).toThrow();
    expect(parseVersion('0.1.4+abc1234')).toEqual([0, 1, 4]);
  });

  it('compares by number, not by text', () => {
    expect(compareVersions('0.1.10', '0.1.9')).toBeGreaterThan(0);
    expect(compareVersions('0.2.0', '0.1.10')).toBeGreaterThan(0);
    expect(compareVersions('0.1.3', '0.1.3')).toBe(0);
    expect(compareVersions('0.1.3', '0.1.4')).toBeLessThan(0);
  });

  it('writes the menu parts as the start menu does', () => {
    expect(menuParts('0.1.4')).toEqual({ big: '0.1', small: '.04' });
    expect(menuParts('0.1.10')).toEqual({ big: '0.1', small: '.10' });
    expect(menuParts('0.2.0')).toEqual({ big: '0.2', small: '.00' });
  });
});

describe('package.json', () => {
  const pkg = '{\r\n  "name": "factory-spaghetti",\r\n  "version": "0.1.9",\r\n  "private": true,\r\n  "devDependencies": {\r\n    "x": "^1.0.0"\r\n  }\r\n}\r\n';

  it('changes only the version, keeping the formatting and line endings', () => {
    const out = setPackageVersion(pkg, '0.1.10');
    expect(out).toBe(pkg.replace('"0.1.9"', '"0.1.10"'));
    expect((JSON.parse(out) as { version: string }).version).toBe('0.1.10');
  });

  it('refuses when the first "version" is not the top-level one', () => {
    const odd = '{\n  "config": { "version": "9.9.9" },\n  "version": "0.1.9"\n}\n';
    expect(() => setPackageVersion(odd, '0.1.10')).toThrow();
  });
});

describe('package-lock.json', () => {
  const lock = [
    '{',
    '  "name": "factory-spaghetti",',
    '  "version": "0.1.9",',
    '  "lockfileVersion": 3,',
    '  "requires": true,',
    '  "packages": {',
    '    "": {',
    '      "name": "factory-spaghetti",',
    '      "version": "0.1.9",',
    '      "dependencies": {',
    '        "three": "^0.187.0"',
    '      }',
    '    },',
    '    "node_modules/three": {',
    '      "version": "0.187.0"',
    '    }',
    '  }',
    '}',
    '',
  ].join('\n');

  it('changes both version fields and nothing else', () => {
    const out = setLockVersion(lock, '0.1.10');
    const parsed = JSON.parse(out) as { version: string; packages: Record<string, { version: string }> };
    expect(parsed.version).toBe('0.1.10');
    expect(parsed.packages['']!.version).toBe('0.1.10');
    expect(parsed.packages['node_modules/three']!.version).toBe('0.187.0');
    expect(out).toBe(lock.replace(/"version": "0\.1\.9"/g, '"version": "0.1.10"'));
  });
});

describe('README.md', () => {
  const readme = [
    '# Factory Spaghetti Online',
    '',
    'The version there to play is **0.1.3**, an early playtest build, and it plays **rules v0.70**. The start menu shows the version under the title, a large "0.1" followed by a small ".03" for version 0.1.3 (the game menu shows it too).',
    '',
    'Versions 0.1.2 (24 Nov 2026) and 0.1.3 (27 Nov 2026) were deployed showing 0.1.01; from 0.1.4 on every push carries its own number.',
    '',
  ].join('\n');

  it('replaces the version to play and the start-menu description', () => {
    const out = setReadmeVersion(readme, '0.1.3', '0.1.4');
    expect(out).toContain('The version there to play is **0.1.4**, an early playtest build');
    expect(out).toContain('a large "0.1" followed by a small ".04" for version 0.1.4 (the game menu');
    // The note about earlier versions is left as it is.
    expect(out).toContain('Versions 0.1.2 (24 Nov 2026) and 0.1.3 (27 Nov 2026) were deployed showing 0.1.01; from 0.1.4 on');
    expect(out.split('\n').length).toBe(readme.split('\n').length);
  });

  it('handles 0.1.9 to 0.1.10 and a minor bump', () => {
    const nine = readme.replace(/0\.1\.3\*\*/, '0.1.9**').replace('".03" for version 0.1.3', '".09" for version 0.1.9');
    const ten = setReadmeVersion(nine, '0.1.9', '0.1.10');
    expect(ten).toContain('**0.1.10**');
    expect(ten).toContain('a large "0.1" followed by a small ".10" for version 0.1.10');
    const minor = setReadmeVersion(nine, '0.1.9', '0.2.0');
    expect(minor).toContain('a large "0.2" followed by a small ".00" for version 0.2.0');
  });

  it('brings a README that fell behind package.json up to the new version', () => {
    const behind = readme.replace('**0.1.3**', '**0.1.1**').replace('".03" for version 0.1.3', '".01" for version 0.1.1');
    const out = setReadmeVersion(behind, '0.1.3', '0.1.4');
    expect(out).toContain('The version there to play is **0.1.4**');
    expect(out).toContain('a small ".04" for version 0.1.4');
  });

  it('refuses a README without the sentence that names the version', () => {
    expect(() => setReadmeVersion('# No version here\n', '0.1.3', '0.1.4')).toThrow();
  });
});

describe('links printed after a release', () => {
  it('finds the site and the Actions page of a GitHub remote', () => {
    expect(githubPages('https://github.com/bobbfwed/FactorySpaghetti.git')).toEqual({
      site: 'https://bobbfwed.github.io/FactorySpaghetti/',
      actions: 'https://github.com/bobbfwed/FactorySpaghetti/actions',
    });
    expect(githubPages('git@github.com:bobbfwed/FactorySpaghetti.git')?.site).toBe('https://bobbfwed.github.io/FactorySpaghetti/');
    expect(githubPages('C:/temp/remote.git')).toBeNull();
  });
});
