#!/usr/bin/env node
// npm run release: publish main with its own version number.
//
// Checks that main is ready to push (on main, nothing uncommitted, nothing to pull, something to
// push), raises the patch number in package.json, package-lock.json and README.md, commits those
// three files as "Version X.Y.Z" and pushes main to origin. The pre-push hook in .githooks/ and the
// deploy workflow both refuse a push to main whose version did not go up, so this is the one way
// to publish.
//
//   npm run release                 bump the patch number, commit, push
//   npm run release -- --dry-run    print what it would do, change nothing
//   npm run release -- --no-push    bump and commit only
//   npm run release -- --minor      bump the minor number (0.1.9 -> 0.2.0) instead
//
// `node tools/release.mjs --install-hooks` is what `npm install` / `npm ci` run (the "prepare"
// script): it points git at .githooks/ when this folder is a git checkout and never fails.
//
// The pure parts (version arithmetic and the edits to the three files) are exported for the tests
// in src/app/__tests__/release.test.ts.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------------------------
// Pure parts
// ---------------------------------------------------------------------------------------------

/** [major, minor, patch] of "X.Y.Z" (a "-pre" or "+build" suffix is ignored), or null. */
export function parseVersion(v) {
  const m = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(String(v).trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** The next version: the patch number plus one, or with kind "minor" the minor plus one and patch 0. */
export function bumpVersion(v, kind = 'patch') {
  const p = parseVersion(v);
  if (!p) throw new Error(`"${v}" is not a version number of the form X.Y.Z.`);
  const [major, minor, patch] = p;
  if (kind === 'minor') return `${major}.${minor + 1}.0`;
  if (kind === 'patch') return `${major}.${minor}.${patch + 1}`;
  throw new Error(`Unknown kind of bump "${kind}".`);
}

/** Negative, zero or positive as a is lower than, equal to or higher than b. */
export function compareVersions(a, b) {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) throw new Error(`Cannot compare "${a}" with "${b}".`);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
  return 0;
}

/** How the start menu writes a version: a large "0.1" and a small ".04" (src/session/versionText.ts). */
export function menuParts(v) {
  const p = parseVersion(v);
  if (!p) throw new Error(`"${v}" is not a version number of the form X.Y.Z.`);
  return { big: `${p[0]}.${p[1]}`, small: `.${String(p[2]).padStart(2, '0')}` };
}

function swapOnce(text, re, next, what) {
  let count = 0;
  const out = text.replace(re, (_m, before, _old, after) => {
    count++;
    return `${before}${next}${after}`;
  });
  if (count !== 1) throw new Error(`${what}: expected one version field, found ${count}.`);
  return out;
}

/** package.json with its top-level "version" set to next; nothing else in the text changes. */
export function setPackageVersion(text, next) {
  const before = JSON.parse(text);
  // The first "version" key in the file, which must be the top-level one (checked below).
  const out = swapOnce(text, /^([\s\S]*?"version"\s*:\s*")([^"]*)(")/, next, 'package.json');
  const after = JSON.parse(out);
  if (after.version !== next || JSON.stringify({ ...after, version: before.version }) !== JSON.stringify(before)) {
    throw new Error('package.json: the first "version" field is not the top-level one; edit it by hand.');
  }
  return out;
}

/** package-lock.json with both the top-level "version" and the root package's ("packages" > "") set to next. */
export function setLockVersion(text, next) {
  const before = JSON.parse(text);
  let out = swapOnce(text, /^(\{\s*"name"\s*:\s*"[^"]*"\s*,\s*"version"\s*:\s*")([^"]*)(")/, next, 'package-lock.json (top level)');
  out = swapOnce(
    out,
    /("packages"\s*:\s*\{\s*""\s*:\s*\{\s*"name"\s*:\s*"[^"]*"\s*,\s*"version"\s*:\s*")([^"]*)(")/,
    next,
    'package-lock.json (root package)',
  );
  const after = JSON.parse(out);
  const expected = structuredClone(before);
  expected.version = next;
  expected.packages[''].version = next;
  if (JSON.stringify(after) !== JSON.stringify(expected)) {
    throw new Error('package-lock.json: the edit changed more than the two version fields; edit it by hand.');
  }
  return out;
}

/**
 * README.md with the current version replaced where the README states it: the sentence "The version
 * there to play is **X.Y.Z**" (required) and the description of what the start menu shows, 'a large
 * "0.1" followed by a small ".01" for version 0.1.1' (when present). Other version numbers in the
 * text, such as notes about earlier versions, are left alone.
 */
export function setReadmeVersion(text, current, next) {
  const playRe = /(The version there to play is \*\*)([^*]+)(\*\*)/g;
  const found = [...text.matchAll(playRe)];
  if (found.length !== 1) throw new Error(`README.md: expected one sentence "The version there to play is **X.Y.Z**", found ${found.length}.`);
  if (found[0][2] !== current) {
    throw new Error(`README.md names version ${found[0][2]} to play, but package.json says ${current}; make them agree first.`);
  }
  let out = text.replace(playRe, `$1${next}$3`);
  const cur = menuParts(current);
  const nxt = menuParts(next);
  const menuRe = new RegExp(
    `(a large ")${escapeRe(cur.big)}(" followed by a small ")${escapeRe(cur.small)}(" for version )${escapeRe(current)}(?![\\d.]*\\d)`,
    'g',
  );
  out = out.replace(menuRe, `$1${nxt.big}$2${nxt.small}$3${next}`);
  return out;
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** The site and the Actions page of a GitHub remote URL, or null when the remote is not on GitHub. */
export function githubPages(remoteUrl) {
  const m = /github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?\/?$/.exec(String(remoteUrl).trim());
  if (!m) return null;
  const [, owner, repo] = m;
  return {
    site: `https://${owner.toLowerCase()}.github.io/${repo}/`,
    actions: `https://github.com/${owner}/${repo}/actions`,
  };
}

// ---------------------------------------------------------------------------------------------
// The command
// ---------------------------------------------------------------------------------------------

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FILES = ['package.json', 'package-lock.json', 'README.md'];

class Refusal extends Error {}

function git(args, opts = {}) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts }).trim();
}

function gitOk(args) {
  try {
    git(args);
    return true;
  } catch {
    return false;
  }
}

function errText(e) {
  const stderr = e && e.stderr ? String(e.stderr).trim() : '';
  return stderr || (e && e.message) || String(e);
}

function versionAt(rev) {
  return JSON.parse(git(['show', `${rev}:package.json`])).version;
}

function parseArgs(argv) {
  const opts = { dryRun: false, push: true, kind: 'patch', help: false, installHooks: false };
  for (const a of argv) {
    if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--no-push') opts.push = false;
    else if (a === '--minor') opts.kind = 'minor';
    else if (a === '--help' || a === '-h') opts.help = true;
    else if (a === '--install-hooks') opts.installHooks = true;
    else throw new Refusal(`Unknown option "${a}". Options: --dry-run, --no-push, --minor.`);
  }
  return opts;
}

/** The "prepare" script: use .githooks/ when this folder is the top of a git checkout. Never fails. */
function installHooks() {
  try {
    if (!existsSync(join(ROOT, '.githooks', 'pre-push'))) return;
    const top = git(['rev-parse', '--show-toplevel']);
    // Only when this package is the checkout itself (not, say, a copy inside another repository).
    if (resolve(top).toLowerCase() !== ROOT.toLowerCase()) return;
    if (gitOk(['config', '--get', 'core.hooksPath']) && git(['config', '--get', 'core.hooksPath']) === '.githooks') return;
    git(['config', 'core.hooksPath', '.githooks']);
    console.log('git hooks: core.hooksPath set to .githooks (a push to main must carry a version bump)');
  } catch {
    // Not a git checkout (a tarball), git missing, or anything else: nothing to do.
  }
}

function release(opts) {
  const say = (s) => console.log(s);

  // 1. On main, nothing uncommitted.
  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']);
  if (branch !== 'main') throw new Refusal(`You are on "${branch}". Switch to main first (git switch main).`);
  const dirty = git(['status', '--porcelain', '--untracked-files=no']);
  if (dirty) {
    throw new Refusal(`There are uncommitted changes. Commit them (or set them aside) first:\n${dirty}`);
  }

  // 2. Nothing to pull, something to push.
  try {
    git(['fetch', 'origin']);
  } catch (e) {
    throw new Refusal(`"git fetch origin" failed, so it is not known whether there is anything to pull:\n${errText(e)}`);
  }
  const hasRemoteMain = gitOk(['rev-parse', '--verify', '--quiet', 'refs/remotes/origin/main']);
  if (hasRemoteMain && !gitOk(['merge-base', '--is-ancestor', 'origin/main', 'HEAD'])) {
    throw new Refusal('origin/main has commits that your main does not. Bring them in first (git pull), then run npm run release again.');
  }
  const ahead = hasRemoteMain ? Number(git(['rev-list', '--count', 'origin/main..HEAD'])) : Number(git(['rev-list', '--count', 'HEAD']));
  if (ahead === 0) throw new Refusal('Nothing to publish: main is the same as origin/main.');

  const remoteVersion = hasRemoteMain ? versionAt('origin/main') : null;
  const current = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;
  const links = githubPages(gitOk(['remote', 'get-url', 'origin']) ? git(['remote', 'get-url', 'origin']) : '');

  // A version commit made by an earlier run whose push failed: push it as it is, no second bump.
  const headSubject = git(['log', '-1', '--format=%s']);
  const headIsVersionCommit =
    /^Version \d+\.\d+\.\d+$/.test(headSubject) &&
    gitOk(['rev-parse', '--verify', '--quiet', 'HEAD~1']) &&
    versionAt('HEAD~1') !== current &&
    (remoteVersion === null || compareVersions(current, remoteVersion) > 0);

  let next = current;
  let changed = null;
  if (!headIsVersionCommit) {
    next = bumpVersion(current, opts.kind);
    const read = (f) => readFileSync(join(ROOT, f), 'utf8');
    changed = {
      'package.json': setPackageVersion(read('package.json'), next),
      'package-lock.json': setLockVersion(read('package-lock.json'), next),
      'README.md': setReadmeVersion(read('README.md'), current, next),
    };
  }

  const { big, small } = menuParts(next);
  say(`Live now (origin/main): ${remoteVersion ?? '(origin has no main yet)'}`);
  say(`Commits to publish: ${ahead}`);
  if (headIsVersionCommit) {
    say(`The newest commit is already "${headSubject}" (not pushed yet), so the version is not raised again.`);
  } else {
    say(`Version: ${current} -> ${next} (the start menu will show "${big}${small}")`);
  }

  if (opts.dryRun) {
    say('');
    say('Dry run, nothing changed. It would:');
    if (!headIsVersionCommit) {
      say(`  - set the version to ${next} in ${FILES.join(', ')}`);
      say(`  - commit those three files as "Version ${next}"`);
    }
    say(opts.push ? '  - push main to origin' : '  - not push (--no-push)');
    return;
  }

  if (changed) {
    for (const f of FILES) writeFileSync(join(ROOT, f), changed[f]);
    try {
      git(['add', '--', ...FILES]);
      git(['commit', '--quiet', '-m', `Version ${next}`, '--', ...FILES]);
    } catch (e) {
      // Put the three files back as they were so nothing is left half done.
      try {
        git(['reset', '--quiet', '--', ...FILES]);
        git(['checkout', '--', ...FILES]);
      } catch {
        /* reported below */
      }
      throw new Refusal(`The version commit could not be made, and the three files were put back as they were:\n${errText(e)}`);
    }
    say(`Committed "Version ${next}" (${git(['rev-parse', '--short', 'HEAD'])}).`);
  }

  if (!opts.push) {
    say('');
    say('Not pushed (--no-push). To publish it later run: npm run release');
    say('(It sees the waiting version commit and pushes it without raising the version again.)');
    return;
  }

  say('Pushing main to origin...');
  try {
    execFileSync('git', ['push', 'origin', 'main'], { cwd: ROOT, stdio: 'inherit' });
  } catch {
    console.error('');
    console.error(`The version commit "Version ${next}" is made, but the push failed (the reason is above).`);
    console.error('Nothing is lost. Fix the cause (for example the network or the GitHub sign-in), then run either:');
    console.error('  npm run release       (it pushes the waiting version commit without raising the version again)');
    console.error('  git push origin main');
    console.error('Do not make more commits before that push, or the version commit is no longer the last one and the push is refused.');
    process.exitCode = 1;
    return;
  }

  say('');
  say(`Published version ${next} (the start menu shows "${big}${small}").`);
  if (links) {
    say(`The site rebuilds in a few minutes: ${links.site}`);
    say(`Watch the build and deploy here: ${links.actions}`);
  }
}

function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
    if (opts.installHooks) return installHooks();
    if (opts.help) {
      console.log('npm run release [-- --dry-run] [-- --no-push] [-- --minor]');
      return;
    }
    release(opts);
  } catch (e) {
    if (e instanceof Refusal) {
      console.error(`npm run release: ${e.message}`);
    } else {
      console.error(`npm run release failed: ${errText(e)}`);
    }
    process.exitCode = 1;
  }
}

const invoked = process.argv[1] ? resolve(process.argv[1]) : '';
if (invoked && invoked.toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()) main();
