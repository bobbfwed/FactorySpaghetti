// When the Teleporters' portals are redrawn by themselves (a few frames a second): only while the
// table can be seen. The game guide covers the whole table when it is open over a game or a
// replay, so the portals rest until it closes (the guide says when it opens and closes).

import { describe, it, expect } from 'vitest';
import { portalsRun } from '../portal';
import { isGuideOpen, onGuideOpen, setGuideOpen } from '../../ui/guide/open';

const base = { portals: 2, visible: true, swirl: true, disposed: false, contextLost: false, covered: false };

describe('the portals\' slow redraw', () => {
  it('runs with a Teleporter on a visible table', () => {
    expect(portalsRun(base)).toBe(true);
  });
  it('rests while the guide (or anything else covering the whole table) is over it', () => {
    expect(portalsRun({ ...base, covered: true })).toBe(false);
  });
  it('rests as before: no Teleporter, page hidden, setting off, table gone, context lost', () => {
    for (const k of [{ portals: 0 }, { visible: false }, { swirl: false }, { disposed: true }, { contextLost: true }]) {
      expect(portalsRun({ ...base, ...k })).toBe(false);
    }
  });
});

describe('the guide says when it opens and closes', () => {
  it('tells every watcher once per change, and stops telling one that left', () => {
    const seen: boolean[] = [];
    const off = onGuideOpen(on => seen.push(on));
    expect(isGuideOpen()).toBe(false);
    setGuideOpen(true);
    setGuideOpen(true); // no change: nothing told
    expect(isGuideOpen()).toBe(true);
    setGuideOpen(false);
    off();
    setGuideOpen(true);
    expect(seen).toEqual([true, false]);
    setGuideOpen(false);
  });
});
