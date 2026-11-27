// The guide's content holds together: every topic is in the table of contents, ids are unique,
// every link and "see also" lands on a topic (and heading) that exists, every Leverage card has
// an entry and no entry names a card that does not exist, and releases are listed newest first.

import { describe, it, expect } from 'vitest';
import { CARD_COUNTS } from '../../../engine/config';
import { BOT_TYPES } from '../../../bots/registry';
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
    // The designer's decisions (#35-#39, #42, #44-#51, #53), the moves the engine now refuses
    // (#43) and the Mine-belt fix (#52): 25 in all.
    expect(newest.rules.length).toBe(25);
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

  it('names every kind of bot the host can choose, by its label', () => {
    const online = allText(findTopic('online')!).join(' ');
    for (const b of BOT_TYPES) expect(online, b.id).toContain(`**${b.label}**`);
  });

  it('states the rules this release settled: payment with change and the limit, the Mine\'s larger half, the meeple', () => {
    const all = GUIDE.topics.flatMap(allText).map(plainText).join(' ');
    expect(all).toContain('Change that fits nowhere is lost');
    expect(all).toContain('Either half may touch the board');
    expect(all).toMatch(/If it has anywhere to go, it must be placed/);
    // Old wording that is no longer true.
    expect(all).not.toMatch(/paid exactly|at least one of them must touch the board/i);
  });

  it('states the second set of decisions (#44-#50) and none of the rules they replaced', () => {
    const topics = GUIDE.topics.filter(t => t.id !== 'changes' && t.id !== 'printed');
    const all = topics.flatMap(allText).map(plainText).join(' ');
    // Supplying through an input teleporter is the player's choice; the timer never supplies.
    expect(all).toContain('Provide a Sphere and a Plate');
    expect(all).toContain('nothing is ever taken on its own');
    expect(all).toMatch(/runs only if it can without your materials/);
    // Power Plant decisions.
    expect(all).toContain('Run it as it is');
    // Cards in every step; Scouting Drone before the draw.
    expect(all).toMatch(/any of the four steps of your own turn/);
    expect(all).toMatch(/Scouting Drone can be played in step 1 only before you draw/);
    // The reshuffle, the upgrade point, finishing the round.
    expect(all).toContain('the discard pile is shuffled into a new deck');
    expect(all).toContain('2 on the first Mine, 3 on the second and 4 on the third');
    expect(all).toContain('The pieces have run out: this is the final round');
    // Old rules that no longer hold.
    expect(all).not.toMatch(/cheapest materials|missing inputs are taken|teleporter on a Power Plant's input does nothing/i);
    expect(all).not.toMatch(/once it is empty, no more can be bought|during this actions step|during your actions step/i);
    expect(all).not.toMatch(/upgrade point[^.]*Mines \+ 1|larger half must touch/i);
    expect(all).not.toMatch(/the game ends at the end of the turn in which the last piece/i);
    expect(all).not.toMatch(/claim a building another player has claimed\. You then share/i);
  });

  it('lists 0.1.2 with the second set of decisions, and no longer the withdrawn Mine rule', () => {
    const titles = RELEASES[0]!.rules.map(r => r.title);
    expect(titles).not.toContain('A Mine\'s larger half must touch the board');
    for (const t of ['You choose what goes in through an input teleporter', 'Leverage cards in every step of your turn',
      'A Mine may touch the board with either half', 'The empty Leverage deck is refilled from the discard pile',
      'A Mine\'s upgrade point gives the number printed on it', 'When the pieces run out, the round is finished']) {
      expect(titles).toContain(t);
    }
  });

  it('no longer lists printed-rulebook differences this version has given up', () => {
    const titles = PRINTED_GROUPS.flatMap(g => g.items.map(i => i.title));
    for (const gone of ['When cards are played', 'The Mine\'s upgrade point', 'An empty deck', 'When the pieces run out']) {
      expect(titles).not.toContain(gone);
    }
  });
});
