import { describe, it, expect } from 'vitest';
import { CODE_LETTERS, codeFromLocation, inviteLink, isRoomCode, makeRoomCode, normalizeCode } from '../roomCode';

describe('room codes', () => {
  it('are five letters from A-Z without I and O, and vary', () => {
    expect(CODE_LETTERS).toHaveLength(24);
    expect(CODE_LETTERS).not.toMatch(/[IO]/);
    const seen = new Set<string>();
    const letters = new Set<string>();
    for (let i = 0; i < 2000; i++) {
      const c = makeRoomCode();
      expect(c).toMatch(/^[A-HJ-NP-Z]{5}$/);
      expect(isRoomCode(c)).toBe(true);
      seen.add(c);
      for (const ch of c) letters.add(ch);
    }
    expect(seen.size).toBeGreaterThan(1990);
    expect(letters.size).toBe(24); // every letter turns up
  });

  it('normalizes typed and pasted codes', () => {
    expect(normalizeCode(' kqm-tv ')).toBe('KQMTV');
    expect(normalizeCode('k q m t v')).toBe('KQMTV');
    expect(normalizeCode('https://example.org/game/?join=kqmtv#save=v1.x')).toBe('KQMTV');
    expect(normalizeCode('KQMT')).toBeNull();
    expect(normalizeCode('KQMTVX')).toBeNull();
    expect(normalizeCode('KQMTI')).toBeNull(); // I is never in a code
    expect(normalizeCode('KQ0TV')).toBeNull();
    expect(normalizeCode('')).toBeNull();
  });

  it('builds and reads invite links', () => {
    const link = inviteLink('https://example.org/fs/?solo=1#save=v1.abc', 'KQMTV');
    expect(link).toBe('https://example.org/fs/?solo=1&join=KQMTV');
    expect(codeFromLocation(new URL(link).search)).toBe('KQMTV');
    expect(inviteLink('http://localhost:5173/', 'ABCDE')).toBe('http://localhost:5173/?join=ABCDE');
    expect(codeFromLocation('?join=abcde')).toBe('ABCDE');
    expect(codeFromLocation('?join=bad')).toBeNull();
    expect(codeFromLocation('')).toBeNull();
  });
});
