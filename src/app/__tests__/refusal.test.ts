// Every refusal code the engine or the session can produce has rulebook words, and the engine's
// raw messages (which name internal things) are never shown.
//
// The engine's codes are free strings, so they are collected by scanning its source: every
// `err('CODE', …)` (also split over lines) and every `code: 'CODE'` outside the tests. The session's
// codes are the members of the SessionErrorCode type in protocol.ts plus the same two patterns
// in src/session and src/online.

import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { REFUSAL_FALLBACK, REFUSAL_TEXT, refusalText } from '../gameText';

const SRC = fileURLToPath(new URL('../../', import.meta.url));

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { if (name !== '__tests__') out.push(...sources(p)); }
    else if (name.endsWith('.ts')) out.push(p);
  }
  return out;
}

function codesIn(dirs: string[]): Set<string> {
  const codes = new Set<string>();
  for (const dir of dirs) {
    for (const file of sources(join(SRC, dir))) {
      const text = readFileSync(file, 'utf8');
      for (const m of text.matchAll(/\berr\(\s*'([A-Z][A-Z_]+)'/g)) codes.add(m[1]!);
      for (const m of text.matchAll(/\bcode:\s*'([A-Z][A-Z_]+)'/g)) codes.add(m[1]!);
    }
  }
  return codes;
}

function sessionErrorCodes(): Set<string> {
  const text = readFileSync(join(SRC, 'session/protocol.ts'), 'utf8');
  const block = /export type SessionErrorCode =([\s\S]*?);/.exec(text)?.[1] ?? '';
  return new Set([...block.matchAll(/'([A-Z_]+)'/g)].map(m => m[1]!));
}

describe('refusalText', () => {
  const engine = codesIn(['engine']);
  const session = new Set([...sessionErrorCodes(), ...codesIn(['session', 'online'])]);

  it('found the codes it checks (the scan works)', () => {
    expect(engine.size).toBeGreaterThan(60);
    expect(engine).toContain('WRONG_PHASE');
    expect(engine).toContain('POINTS_TOO_CLOSE'); // written over two lines
    expect(engine).toContain('GAME_OVER');
    expect(session).toContain('NOT_YOUR_TURN');
    expect(session).toContain('BUSY');
    expect(session).toContain('SEAT_REQUIRED');
  });

  it('has words for every engine and session refusal code', () => {
    const missing = [...engine, ...session].filter(c => !(c in REFUSAL_TEXT));
    expect(missing).toEqual([]);
  });

  it('never shows the raw message, and falls back for unknown codes', () => {
    const raw = 'Expected placePiece phase, got roll';
    expect(refusalText({ code: 'WRONG_PHASE', message: raw })).toBe('That is not allowed at this step of the turn.');
    expect(refusalText({ code: 'SOMETHING_NEW', message: raw })).toBe(REFUSAL_FALLBACK);
    expect(refusalText({ code: 'toString' })).toBe(REFUSAL_FALLBACK);
    for (const text of Object.values(REFUSAL_TEXT)) {
      // No internal names: no camelCase identifiers, no SHOUTED codes.
      expect(text).not.toMatch(/[a-z][A-Z]|[A-Z]{2,}_|\b(placePiece|roundEnd|pendingFactoryOps)\b/);
      expect(text).toMatch(/^[A-Z].*[.]$/);
    }
  });
});
