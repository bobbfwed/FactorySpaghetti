// "What changed" is a change log of the rules by rules version: newest first, the newest is the
// rules version the engine plays, the oldest compares with the printed rulebook, and every entry
// is a rule as it was and as it is now, in players' words, about how the game is played only.

import { describe, expect, it } from 'vitest';
import { PRINTED_RULES_VERSION, RULES_VERSION, TELEPORTER_COUNT } from '../../../engine/config';
import { GUIDE, findTopic } from '../content';
import { RULES_LOG, versionHeading } from '../content/changes';
import { PLAYER_COUNTS, stackSize } from '../content/facts';
import { linkTargets, plainText, splitTarget } from '../inline';
import type { Block, RuleChange } from '../types';

const entries = (i = 0): RuleChange[] => RULES_LOG[i]!.themes.flatMap(t => t.entries);
const titles = (): string[] => entries().map(e => e.title);
const num = (v: string): number => Number(v);

/** Words about the interface or the digital version, which do not belong in a rules change log. */
const INTERFACE_WORDS = /\b(tap|taps|tapped|tapping|click|clicks|clicked|button|buttons|screen|screens|menu|menus|save|saves|saved|saving|replay|replays|online|bot|bots|log|logs|timer|timers|host|hosts)\b/i;
/** Internal names of the engine and its documents. */
const INTERNAL_NAMES = /\b[A-Z]+_[A-Z_]+\b|\b(plateFact|sphereFact|tesseractFact|powerPlant|roundEnd|placeMeeple|legalActions|applyAction|undefined|NaN)\b|RULES_CHANGES|#\d+/;

function anchors(blocks: readonly Block[]): string[] {
  return blocks.flatMap(b => (b.k === 'h' && b.id ? [b.id] : b.k === 'details' ? anchors(b.blocks) : []));
}

describe('What changed: the rules by rules version', () => {
  it('starts with the rules version the game plays and ends with the comparison with the printed rulebook', () => {
    expect(RULES_LOG.length).toBeGreaterThan(0);
    expect(RULES_LOG[0]!.version).toBe(RULES_VERSION);
    expect(RULES_LOG[RULES_LOG.length - 1]!.comparedWith).toBe(PRINTED_RULES_VERSION);
  });

  it('lists the versions newest first, each compared with the one before it', () => {
    for (let i = 0; i < RULES_LOG.length; i++) {
      const log = RULES_LOG[i]!;
      expect(num(log.version), log.version).toBeGreaterThan(num(log.comparedWith));
      const older = RULES_LOG[i + 1];
      if (older) expect(log.comparedWith, log.version).toBe(older.version);
    }
  });

  it('heads each version from its numbers, the oldest "compared with the printed rulebook"', () => {
    const topic = findTopic('changes')!;
    const headings = topic.blocks.flatMap(b => (b.k === 'h' ? [b.t] : []));
    for (const log of RULES_LOG) expect(headings).toContain(versionHeading(log));
    expect(versionHeading(RULES_LOG[RULES_LOG.length - 1]!))
      .toBe(`Rules v${RULES_LOG[RULES_LOG.length - 1]!.version}, compared with the printed rulebook (v${PRINTED_RULES_VERSION})`);
    expect(anchors(topic.blocks)).toContain(`v${RULES_VERSION}`);
  });

  it('gives every version a one-line summary and themes with unique ids, none empty', () => {
    for (const log of RULES_LOG) {
      expect(log.summary.length, log.version).toBeGreaterThan(10);
      expect(log.summary.length, log.version).toBeLessThan(200);
      const ids = log.themes.map(t => t.id);
      expect(new Set(ids).size, log.version).toBe(ids.length);
      for (const t of log.themes) expect(t.entries.length, `${log.version} ${t.subject}`).toBeGreaterThan(0);
    }
  });

  it('gives every entry a title, the earlier rule and the current rule, with unique titles per version', () => {
    for (let i = 0; i < RULES_LOG.length; i++) {
      const list = entries(i);
      for (const e of list) {
        expect(e.title.length, e.title).toBeGreaterThan(3);
        expect(e.before.length, e.title).toBeGreaterThan(10);
        expect(e.now.length, e.title).toBeGreaterThan(10);
        expect(e.before, e.title).not.toBe(e.now);
      }
      const t = list.map(e => e.title);
      expect(new Set(t).size).toBe(t.length);
    }
  });

  it('shows every entry as a change, labelled with the printed rulebook and "Now"', () => {
    const changes = findTopic('changes')!.blocks.filter(b => b.k === 'change');
    expect(changes.length).toBe(RULES_LOG.reduce((n, _, i) => n + entries(i).length, 0));
    const first = changes[0]!;
    if (first.k !== 'change') throw new Error('not a change');
    expect(first.nowLabel).toBe('Now');
    const oldest = changes[changes.length - 1]!;
    if (oldest.k !== 'change') throw new Error('not a change');
    expect(oldest.beforeLabel).toBe(`Printed v${PRINTED_RULES_VERSION}`);
  });

  it('speaks only of the rules: no interface words, no internal names', () => {
    const bad: string[] = [];
    for (let i = 0; i < RULES_LOG.length; i++) {
      for (const e of entries(i)) {
        for (const s of [e.title, e.before, e.now]) {
          const plain = plainText(s);
          if (INTERFACE_WORDS.test(plain)) bad.push(`interface word in "${plain}"`);
          if (INTERNAL_NAMES.test(plain)) bad.push(`internal name in "${plain}"`);
        }
      }
    }
    for (const log of RULES_LOG) {
      if (INTERFACE_WORDS.test(log.summary) || INTERNAL_NAMES.test(log.summary)) bad.push(`summary of ${log.version}`);
    }
    expect(bad).toEqual([]);
  });

  it('words each clarification as one: where the printed rulebook is silent, says what the rules decided', () => {
    const silent = entries(RULES_LOG.length - 1).filter(e => e.before.startsWith('The printed rulebook does not say'));
    expect(silent.length).toBeGreaterThan(0);
    for (const e of silent) expect(e.now, e.title).toMatch(new RegExp(`^In v${RULES_LOG[RULES_LOG.length - 1]!.version.replace('.', '\\.')} `));
  });

  it('points every entry at a guide topic that exists', () => {
    const exists = (target: string): boolean => {
      const { topic, anchor } = splitTarget(target);
      const t = findTopic(topic);
      return !!t && (anchor === null || anchors(t.blocks).includes(anchor));
    };
    for (let i = 0; i < RULES_LOG.length; i++) {
      for (const e of entries(i)) {
        if (e.see) expect(exists(e.see), `${e.title} → ${e.see}`).toBe(true);
        for (const target of [...linkTargets(e.before), ...linkTargets(e.now)]) expect(exists(target), `${e.title} → ${target}`).toBe(true);
      }
    }
  });

  it('lists the rules that are new since the printed rulebook', () => {
    for (const t of ['Order of the first claims', 'Smaller stacks with fewer players', 'Teleporters', 'A teleporter cuts its input or output off',
      'The next Mine drops into play when a stack runs out', 'Eminent Domain removed', 'Four new cards', 'Embezzlement is always a Sphere',
      'Your buildings feed only your own buildings', 'A building that loses its owner loses its material',
      'Short Sale and Changing Priorities: an unclaimed building or one of yours', 'A belt laid this turn can be taken back for free',
      'End-of-round upgrades are not combined with Mine upgrades', 'You win during your own turn']) {
      expect(titles()).toContain(t);
    }
  });

  it('leaves out what only made the digital game follow the printed rulebook again', () => {
    for (const gone of ['A removed belt goes back to the bank', 'Sink Hole sends belts to the bank', 'The empty Leverage deck is refilled from the discard pile',
      'A Mine\'s upgrade point gives the number printed on it', 'Your meeple must be placed', 'Every claim is paid for', 'Drawing from a face-down stack',
      'Other players\' belts do not serve your buildings']) {
      expect(titles()).not.toContain(gone);
    }
  });

  it('takes its numbers from the engine\'s config', () => {
    const all = entries().map(e => plainText(e.now)).join(' ');
    for (const n of PLAYER_COUNTS) expect(all).toContain(`${stackSize(n, 0)} pieces per stack with ${n} players`);
    expect(all).toContain(`Each player has ${TELEPORTER_COUNT}.`);
  });

  it('is the only topic of the "Changes" section', () => {
    expect(GUIDE.sections.find(s => s.title === 'Changes')!.topics).toEqual(['changes']);
  });
});
