// The renderer turns every kind of block into the expected elements; details start collapsed;
// links and navigation are buttons the viewer can recognise; every real page renders.

import { describe, it, expect } from 'vitest';
import { GUIDE } from '../content';
import { parseInline } from '../inline';
import { DETAILS_TITLE, renderContents, renderInline, renderPage, renderSideList, renderTopic } from '../render';
import type { Guide, Topic } from '../types';
import type { VNode } from '../vdom';
import { textOf, walk } from '../vdom';

function find(root: VNode, pred: (n: VNode) => boolean): VNode[] {
  const out: VNode[] = [];
  walk(root, n => { if (pred(n)) out.push(n); });
  return out;
}
const byTag = (root: VNode, tag: string): VNode[] => find(root, n => n.tag === tag);
const byClass = (root: VNode, cls: string): VNode[] => find(root, n => (n.attrs?.class ?? '').split(' ').includes(cls));

const sample: Topic = {
  id: 'sample',
  title: 'Sample',
  summary: 'Every kind of block.',
  blocks: [
    { k: 'p', t: 'A **bold** word and a [[other#h1|link]].' },
    { k: 'h', t: 'Heading', id: 'h1' },
    { k: 'steps', items: ['one', 'two'] },
    { k: 'list', items: ['a', 'b', 'c'] },
    { k: 'table', head: ['A', 'B'], rows: [['1', '2'], ['3', '4']], caption: 'Caption' },
    { k: 'note', t: 'A note', tone: 'example' },
    { k: 'icons', items: [{ icon: 'ore', label: 'Ore · 1' }] },
    { k: 'details', blocks: [{ k: 'p', t: 'Fine print.' }] },
    { k: 'change', title: 'Changed', before: 'Old', now: 'New' },
  ],
  see: ['other'],
};
const other: Topic = { id: 'other', title: 'Other', summary: 'The other topic.', blocks: [{ k: 'h', t: 'H', id: 'h1' }, { k: 'p', t: 'x' }] };
const guide: Guide = { sections: [{ title: 'Part', topics: ['sample', 'other'] }], topics: [sample, other] };

describe('inline markup', () => {
  it('splits text, bold and links', () => {
    expect(parseInline('a **b** [[t#x|c]] d')).toEqual([
      { kind: 'text', text: 'a ' }, { kind: 'bold', text: 'b' }, { kind: 'text', text: ' ' },
      { kind: 'link', target: 't#x', text: 'c' }, { kind: 'text', text: ' d' },
    ]);
  });
  it('makes links into buttons that carry their target', () => {
    const [link] = renderInline('[[belts#rules|the rules]]') as VNode[];
    expect(link!.tag).toBe('button');
    expect(link!.attrs?.['data-go']).toBe('belts#rules');
    expect(textOf(link!)).toBe('the rules');
  });
});

describe('rendering a topic', () => {
  const page = renderTopic(guide, sample);

  it('renders each block kind', () => {
    expect(byTag(page, 'h1').map(textOf)).toEqual(['Sample']);
    expect(byTag(page, 'b').map(textOf)).toContain('bold');
    expect(byClass(page, 'g-h')[0]!.attrs?.['data-anchor']).toBe('h1');
    expect(byTag(page, 'ol')[0]!.children).toHaveLength(2);
    expect(byClass(page, 'g-list')[0]!.children).toHaveLength(3);
    const table = byTag(page, 'table')[0]!;
    expect(byTag(table, 'caption').map(textOf)).toEqual(['Caption']);
    expect(byTag(table, 'tr')).toHaveLength(3);
    expect(byClass(page, 'g-note')[0]!.attrs?.class).toContain('example');
    expect(byTag(page, 'icon')[0]!.attrs?.name).toBe('ore');
    const change = byClass(page, 'g-change')[0]!;
    expect(textOf(byClass(change, 'g-before')[0]!)).toBe('BeforeOld');
    expect(textOf(byClass(change, 'g-now')[0]!)).toBe('NowNew');
  });

  it('starts details collapsed, under the standard question', () => {
    const details = byTag(page, 'details');
    expect(details).toHaveLength(1);
    expect(details[0]!.attrs?.open).toBeUndefined();
    expect(textOf(byTag(details[0]!, 'summary')[0]!)).toBe(DETAILS_TITLE);
  });

  it('wraps tables so they scroll inside their own box', () => {
    const wrap = byClass(page, 'g-tablewrap')[0]!;
    expect(byTag(wrap, 'table')).toHaveLength(1);
  });

  it('links to related topics, the next topic and the contents', () => {
    const gos = find(page, n => n.attrs?.['data-go'] !== undefined).map(n => n.attrs!['data-go']);
    expect(gos).toContain('other#h1'); // inline link
    expect(gos).toContain('other'); // see also and next
    expect(find(page, n => n.attrs?.['data-nav'] === 'contents')).toHaveLength(1);
    expect(byClass(page, 'g-prev')).toHaveLength(0); // first topic has no previous
    expect(byClass(renderTopic(guide, other), 'g-prev')[0]!.attrs?.['data-go']).toBe('sample');
  });
});

describe('the table of contents and side list', () => {
  it('lists every topic with its summary', () => {
    const toc = renderContents(GUIDE);
    const items = byClass(toc, 'g-tocitem');
    expect(items.map(i => i.attrs?.['data-go'])).toEqual(GUIDE.sections.flatMap(s => s.topics));
    expect(textOf(items[0]!)).toContain(GUIDE.topics.find(t => t.id === items[0]!.attrs?.['data-go'])!.summary);
  });
  it('marks the current topic in the side list', () => {
    const side = renderSideList(GUIDE, 'belts');
    const on = find(side, n => n.attrs?.['aria-current'] === 'page');
    expect(on.map(textOf)).toEqual(['Belts']);
  });
  it('shows the contents for the contents page and for an unknown topic', () => {
    expect(byClass(renderPage(GUIDE, null), 'g-contents')).toHaveLength(1);
    expect(byClass(renderPage(GUIDE, 'no-such-topic'), 'g-contents')).toHaveLength(1);
  });
  it('renders every real topic', () => {
    for (const t of GUIDE.topics) {
      const page = renderPage(GUIDE, t.id);
      expect(page.attrs?.['data-topic']).toBe(t.id);
      expect(textOf(page).length).toBeGreaterThan(100);
    }
  });
});
