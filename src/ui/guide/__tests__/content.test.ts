// The guide's content holds together: every topic is in the table of contents, ids are unique,
// every link and "see also" lands on a topic (and heading) that exists, every Leverage card has
// an entry and no entry names a card that does not exist, and releases are listed newest first.

import { describe, it, expect } from 'vitest';
import { CARD_COUNTS } from '../../../engine/config';
import { GUIDE, findTopic, topicOrder } from '../content';
import { CARD_GUIDE } from '../content/cards';
import { PRINTED_GROUPS, RELEASES } from '../content/changes';
import { linkTargets, plainText, splitTarget } from '../inline';
import type { Block, Topic } from '../types';

/** Every string of text in a list of blocks (paragraphs, list items, table cells, ...). */
function texts(blocks: readonly Block[]): string[] {
  const out: string[] = [];
  for (const b of blocks) {
    switch (b.k) {
      case 'p': case 'h': case 'note': out.push(b.t); break;
      case 'steps': case 'list': out.push(...b.items); break;
      case 'table': out.push(...b.head, ...b.rows.flat(), ...(b.caption ? [b.caption] : [])); break;
      case 'icons': out.push(...b.items.map(i => i.label)); break;
      case 'details': out.push(...(b.title ? [b.title] : []), ...texts(b.blocks)); break;
      case 'change': out.push(b.title, b.before, b.now); break;
    }
  }
  return out;
}

/** Heading ids in a list of blocks, details included. */
function anchors(blocks: readonly Block[]): string[] {
  return blocks.flatMap(b => (b.k === 'h' && b.id ? [b.id] : b.k === 'details' ? anchors(b.blocks) : []));
}

const allText = (t: Topic): string[] => [t.title, t.summary, ...texts(t.blocks)];

function resolves(target: string): boolean {
  const { topic, anchor } = splitTarget(target);
  const t = findTopic(topic);
  if (!t) return false;
  return anchor === null || anchors(t.blocks).includes(anchor);
}

describe('guide content', () => {
  it('has unique topic ids', () => {
    const ids = GUIDE.topics.map(t => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('lists every topic in the table of contents exactly once, and nothing else', () => {
    const order = topicOrder();
    expect(new Set(order).size).toBe(order.length);
    expect([...order].sort()).toEqual(GUIDE.topics.map(t => t.id).sort());
  });

  it('gives every topic a title, a one-line summary and some content', () => {
    for (const t of GUIDE.topics) {
      expect(t.title.length, t.id).toBeGreaterThan(0);
      expect(t.summary.length, t.id).toBeGreaterThan(10);
      expect(t.summary.length, `${t.id} summary should fit one line`).toBeLessThan(120);
      expect(t.blocks.length, t.id).toBeGreaterThan(1);
    }
  });

  it('has unique heading ids within each topic', () => {
    for (const t of GUIDE.topics) {
      const a = anchors(t.blocks);
      expect(new Set(a).size, t.id).toBe(a.length);
    }
  });

  it('resolves every link and every "see also" to a topic and heading that exist', () => {
    const bad: string[] = [];
    for (const t of GUIDE.topics) {
      for (const s of allText(t)) for (const target of linkTargets(s)) if (!resolves(target)) bad.push(`${t.id} → ${target}`);
      for (const target of t.see ?? []) if (!resolves(target)) bad.push(`${t.id} (see also) → ${target}`);
    }
    expect(bad).toEqual([]);
  });

  it('leaves no placeholders and no internal names in the text', () => {
    const bad: string[] = [];
    for (const t of GUIDE.topics) {
      for (const s of allText(t)) {
        const plain = plainText(s);
        if (/\b(TODO|TBD|FIXME|lorem)\b/i.test(plain)) bad.push(`${t.id}: placeholder in "${plain}"`);
        // Action and phase names of the engine (PLACE_BELT, roundEnd, plateFact, ...) never reach players.
        if (/\b[A-Z]+_[A-Z_]+\b/.test(plain) || /\b(plateFact|sphereFact|tesseractFact|powerPlant|roundEnd|placeMeeple|legalActions|undefined|NaN)\b/.test(plain)) {
          bad.push(`${t.id}: internal name in "${plain}"`);
        }
        // Markup that did not parse (a stray ** or [[) would show as symbols.
        if (/\*\*|\[\[|\]\]/.test(plain)) bad.push(`${t.id}: broken markup in "${s}"`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('has an entry for every Leverage card in the engine, and none for a card that does not exist', () => {
    expect(Object.keys(CARD_GUIDE).sort()).toEqual(Object.keys(CARD_COUNTS).sort());
    const cards = findTopic('cards')!;
    expect(anchors(cards.blocks).sort()).toEqual(Object.keys(CARD_COUNTS).sort());
  });

  it('lists releases newest first, with unique versions', () => {
    const parse = (v: string): number[] => v.split('.').map(Number);
    const cmp = (a: string, b: string): number => {
      const x = parse(a);
      const y = parse(b);
      for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0);
      return 0;
    };
    const versions = RELEASES.map(r => r.version);
    for (const v of versions) expect(v).toMatch(/^\d+\.\d+\.\d+$/);
    for (let i = 1; i < versions.length; i++) expect(cmp(versions[i - 1]!, versions[i]!), `${versions[i - 1]} before ${versions[i]}`).toBeGreaterThan(0);
  });

  it('describes the newest release with its rule changes, each as before and now', () => {
    const newest = RELEASES[0]!;
    expect(newest.version).toBe('0.1.2');
    expect(newest.rules.length).toBe(10);
    for (const c of newest.rules) {
      expect(c.before.length).toBeGreaterThan(10);
      expect(c.now.length).toBeGreaterThan(10);
    }
    expect(anchors(findTopic('changes')!.blocks)).toContain('v0.1.2');
  });

  it('groups the differences from the printed rulebook under unique headings', () => {
    const ids = PRINTED_GROUPS.map(g => g.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const g of PRINTED_GROUPS) expect(g.items.length, g.subject).toBeGreaterThan(0);
    expect(anchors(findTopic('printed')!.blocks)).toEqual(ids);
  });

  it('gives the nuanced topics a "How exactly does this work?" section', () => {
    const withDetails = GUIDE.topics.filter(t => t.blocks.some(b => b.k === 'details')).map(t => t.id);
    for (const id of ['claiming', 'production', 'factories', 'moving', 'belts', 'teleporters', 'bank', 'cards', 'bonuses', 'winning', 'round-end']) {
      expect(withDetails, id).toContain(id);
    }
  });
});
