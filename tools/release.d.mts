// Types for the pure parts of tools/release.mjs, so the Vitest test (src/app/__tests__/release.test.ts) typechecks.
export function parseVersion(v: string): [number, number, number] | null;
export function bumpVersion(v: string, kind?: 'patch' | 'minor'): string;
export function compareVersions(a: string, b: string): number;
export function menuParts(v: string): { big: string; small: string };
export function setPackageVersion(text: string, next: string): string;
export function setLockVersion(text: string, next: string): string;
export function setReadmeVersion(text: string, current: string, next: string): string;
export function githubPages(remoteUrl: string): { site: string; actions: string } | null;
