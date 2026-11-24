// The viewer's navigation: open → topic → back → close, as pure state transitions.

import { describe, it, expect } from 'vitest';
import type { GuideEvent, GuideState } from '../state';
import { CLOSED, currentPage, reduce } from '../state';

const run = (events: GuideEvent[], from: GuideState = CLOSED): GuideState => events.reduce(reduce, from);
const topics = (s: GuideState): (string | null)[] => s.stack.map(p => p.topic);

describe('guide navigation', () => {
  it('opens at the table of contents', () => {
    const s = run([{ type: 'open' }]);
    expect(s.open).toBe(true);
    expect(topics(s)).toEqual([null]);
  });

  it('goes to a topic and back to the contents, then closes', () => {
    let s = run([{ type: 'open' }, { type: 'go', topic: 'belts' }]);
    expect(topics(s)).toEqual([null, 'belts']);
    s = reduce(s, { type: 'back' });
    expect(topics(s)).toEqual([null]);
    expect(s.open).toBe(true);
    s = reduce(s, { type: 'back' });
    expect(s).toEqual(CLOSED);
  });

  it('closes from anywhere', () => {
    const s = run([{ type: 'open' }, { type: 'go', topic: 'belts' }, { type: 'go', topic: 'cards', anchor: 'sinkHole' }, { type: 'close' }]);
    expect(s).toEqual(CLOSED);
  });

  it('opens straight at a topic with the contents behind it', () => {
    const s = run([{ type: 'open', topic: 'bank', anchor: 'exchange' }]);
    expect(topics(s)).toEqual([null, 'bank']);
    expect(currentPage(s)?.anchor).toBe('exchange');
    expect(topics(reduce(s, { type: 'back' }))).toEqual([null]);
  });

  it('opening again while open goes to the topic asked for', () => {
    const s = run([{ type: 'open' }, { type: 'open', topic: 'mines' }]);
    expect(topics(s)).toEqual([null, 'mines']);
    expect(run([{ type: 'open' }, { type: 'open' }])).toEqual(run([{ type: 'open' }]));
  });

  it('does not stack the same page twice, but does follow a link to a heading on it', () => {
    let s = run([{ type: 'open' }, { type: 'go', topic: 'cards' }, { type: 'go', topic: 'cards' }]);
    expect(topics(s)).toEqual([null, 'cards']);
    s = reduce(s, { type: 'go', topic: 'cards', anchor: 'shortSale' });
    expect(topics(s)).toEqual([null, 'cards', 'cards']);
  });

  it('remembers the scroll position of each page for Back', () => {
    let s = run([{ type: 'open' }, { type: 'scroll', y: 420 }, { type: 'go', topic: 'belts' }, { type: 'scroll', y: 90 }]);
    expect(currentPage(s)?.scroll).toBe(90);
    s = reduce(s, { type: 'back' });
    expect(currentPage(s)).toEqual({ topic: null, anchor: null, scroll: 420 });
  });

  it('drops the heading once the reader scrolls, so Back restores the scroll position', () => {
    const s = run([{ type: 'open', topic: 'bank', anchor: 'exchange' }, { type: 'scroll', y: 300 }]);
    expect(currentPage(s)).toEqual({ topic: 'bank', anchor: null, scroll: 300 });
  });

  it('ignores Back and scrolling while closed', () => {
    expect(reduce(CLOSED, { type: 'back' })).toBe(CLOSED);
    expect(reduce(CLOSED, { type: 'scroll', y: 5 })).toBe(CLOSED);
  });
});
