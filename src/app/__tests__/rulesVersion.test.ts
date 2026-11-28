// The rules version has one source (RULES_VERSION in engine/config.ts); the documents and the
// screens that show it must agree with it, so they cannot drift apart.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PRINTED_RULES_VERSION, RULES_VERSION } from '../../engine/config';
import { findTopic } from '../../ui/guide/content';
import { plainText } from '../../ui/guide/inline';
import type { Block } from '../../ui/guide/types';
import { versionLineText } from '../../ui/version';

const read = (p: string): string => readFileSync(new URL(`../../../${p}`, import.meta.url), 'utf8');

function guideText(id: string): string {
  const topic = findTopic(id);
  if (!topic) throw new Error(`no topic ${id}`);
  const out: string[] = [topic.summary];
  const walk = (blocks: readonly Block[]): void => {
    for (const b of blocks) {
      if (b.k === 'p' || b.k === 'note' || b.k === 'h') out.push(b.t);
      else if (b.k === 'steps' || b.k === 'list') out.push(...b.items);
      else if (b.k === 'details') walk(b.blocks);
    }
  };
  walk(topic.blocks);
  return plainText(out.join('\n'));
}

describe('rules version', () => {
  it('is v0.70, with the printed rulebook at v0.61', () => {
    expect(RULES_VERSION).toBe('0.70');
    expect(PRINTED_RULES_VERSION).toBe('0.61');
  });

  it('is stated in the first line of RULES.md and in README.md', () => {
    const first = read('RULES.md').split(/\r?\n/)[0]!;
    expect(first).toContain(`Rules v${RULES_VERSION}`);
    expect(first).toContain(`v${PRINTED_RULES_VERSION}`);
    expect(read('README.md')).toContain(`rules v${RULES_VERSION}`);
  });

  it('is named in the Rule versions section of RULES_CHANGES.md', () => {
    const top = read('RULES_CHANGES.md').slice(0, 1500);
    expect(top).toContain('## Rule versions');
    expect(top).toContain(`**v${RULES_VERSION}**`);
    expect(top).toContain(`**v${PRINTED_RULES_VERSION}**`);
  });

  it('is shown beside the app version, as one line of text', () => {
    expect(versionLineText('0.1.1+abc1234')).toBe(`Version 0.1.01 · Rules v${RULES_VERSION}`);
    expect(versionLineText('dev')).toBe(`Version dev · Rules v${RULES_VERSION}`);
  });

  it('is stated in the guide: first topic and the printed-rulebook topic', () => {
    expect(guideText('goal')).toContain(`rules v${RULES_VERSION}`);
    const printed = guideText('printed');
    expect(printed).toContain(`rules v${RULES_VERSION}`);
    expect(printed).toContain(`rules v${PRINTED_RULES_VERSION}`);
    expect(printed).toContain('footer');
    expect(guideText('changes')).toContain(`rules version (v${RULES_VERSION})`);
  });
});
