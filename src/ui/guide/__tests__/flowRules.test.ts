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

describe('a teleporter cuts its buffer off from belts and direct contact (#53)', () => {
  it('Teleporters says so, and the change is listed', () => {
    const t = text('teleporters');
    expect(t).toContain('never down a belt or into a touching input, even while it waits because you are at your limit');
    expect(t).toContain('An input with a teleporter takes nothing from a Mine, a belt or a touching output');
    expect(titles()).toContain('A teleporter cuts its buffer off from belts');
  });
});

describe('a teleporter sits on one input (#55)', () => {
  it('Teleporters says it cuts off and supplies only its own input, and the interim words are gone', () => {
    const t = text('teleporters');
    expect(t).toContain('A teleporter goes on **one input** or on the **output**');
    expect(t).toContain('the other inputs of a Sphere or Tesseract Factory keep receiving');
    expect(t).toContain('Each teleporter supplies only its own input');
    expect(everywhere()).not.toContain('still receive material as before, for now');
    expect(everywhere()).not.toContain('one per buffer');
    expect(titles()).toContain('A teleporter sits on one input');
  });
});

describe('a removed belt goes back to the bank unless laid this turn (#54)', () => {
  it('Belts says both cases, and the change is listed', () => {
    const belts = text('belts');
    expect(belts).toContain('A belt you laid this turn comes back to your own belts');
    expect(belts).toContain('A belt laid on an earlier turn goes back to the bank');
    expect(everywhere()).not.toContain('ready to be laid again for free. **Undo');
    expect(everywhere()).not.toContain('Free; it goes back to your supply');
    expect(titles()).toContain('A removed belt goes back to the bank');
  });
});

describe('removing this turn\'s Mine belt frees the limit (#52)', () => {
  it('Belts says so, and the change is listed', () => {
    expect(text('belts')).toContain('Removing just the belt you laid at a Mine this turn does the same');
    expect(titles()).toContain('Removing this turn\'s Mine belt lets you lay another');
  });
});
