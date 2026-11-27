// The guide states the flow rules decided on 2026-11-27 (RULES_CHANGES.md #51 onward), and no
// longer the rules they replaced.

import { describe, expect, it } from 'vitest';
import { GUIDE, findTopic } from '../content';
import { RELEASES } from '../content/changes';

const text = (id: string): string => JSON.stringify(findTopic(id)!.blocks);
const everywhere = (): string => JSON.stringify(GUIDE.topics.filter(t => t.id !== 'changes' && t.id !== 'printed'));
const titles = (): string[] => RELEASES[0]!.rules.map(r => r.title);

describe('a building feeds only its own player\'s buildings (#51)', () => {
  it('Moving material says so, with the unclaimed and Mine cases', () => {
    const moving = text('moving');
    expect(moving).toContain('a building\'s output touching the input of another building of the same player');
    expect(moving).toContain('Your output never passes into another player\'s building: it stays in your output.');
    expect(moving).toContain('The output of an unclaimed building passes into any claimed building it touches.');
    expect(everywhere()).not.toContain('Every output that touches the input of another claimed building passes its material across.');
    expect(everywhere()).not.toContain('or a building\'s output, touching the input of a claimed building');
  });

  it('is listed among the changes of the newest release', () => {
    expect(titles()).toContain('Your buildings feed only your own buildings');
  });
});

describe('removing this turn\'s Mine belt frees the limit (#52)', () => {
  it('Belts says so, and the change is listed', () => {
    expect(text('belts')).toContain('Removing just the belt you laid at a Mine this turn does the same');
    expect(titles()).toContain('Removing this turn\'s Mine belt lets you lay another');
  });
});
