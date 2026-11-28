// The guide states the flow rules decided on 2026-11-27 (RULES_CHANGES.md #51 onward), and no
// longer the rules they replaced.

import { describe, expect, it } from 'vitest';
import { GUIDE, findTopic } from '../content';
import { RULES_LOG } from '../content/changes';

const text = (id: string): string => JSON.stringify(findTopic(id)!.blocks);
const everywhere = (): string => JSON.stringify(GUIDE.topics.filter(t => t.id !== 'changes'));
const titles = (): string[] => RULES_LOG[0]!.themes.flatMap(t => t.entries.map(e => e.title));

describe('a building feeds only its own player\'s buildings (#51)', () => {
  it('Moving material says so; an unclaimed building feeds nothing (#58)', () => {
    const moving = text('moving');
    expect(moving).toContain('a building\'s output touching the input of another building of the same player');
    expect(moving).toContain('Your output never passes into another player\'s building: it stays in your output.');
    expect(everywhere()).toContain('An unclaimed building holds nothing');
    expect(everywhere()).not.toContain('The output of an unclaimed building passes into any claimed building it touches.');
    expect(everywhere()).not.toContain('Every output that touches the input of another claimed building passes its material across.');
    expect(everywhere()).not.toContain('or a building\'s output, touching the input of a claimed building');
  });

  it('is listed in What changed', () => {
    expect(titles()).toContain('Your buildings feed only your own buildings');
  });
});

describe('a teleporter cuts its buffer off from belts and direct contact (#53)', () => {
  it('Teleporters says so, and the change is listed', () => {
    const t = text('teleporters');
    expect(t).toContain('never down a belt or into a touching input, even while it waits because you are at your limit');
    expect(t).toContain('An input with a teleporter takes nothing from a Mine, a belt or a touching output');
    expect(titles()).toContain('A teleporter cuts its input or output off');
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
    expect(titles()).toContain('Teleporters');
  });
});

describe('a removed belt goes back to the bank unless laid this turn (#54)', () => {
  it('Belts says both cases, and the change is listed', () => {
    const belts = text('belts');
    expect(belts).toContain('A belt you laid this turn comes back to your own belts');
    expect(belts).toContain('A belt laid on an earlier turn goes back to the bank');
    expect(everywhere()).not.toContain('ready to be laid again for free. **Undo');
    expect(everywhere()).not.toContain('Free; it goes back to your supply');
    expect(titles()).toContain('A belt laid this turn can be taken back for free');
  });
});

describe('removing this turn\'s Mine belt frees the limit (#52)', () => {
  it('Belts says so, and the change is listed', () => {
    expect(text('belts')).toContain('Removing just the belt you laid at a Mine this turn does the same');
    expect(titles()).toContain('One Mine belt per turn counts only ore exits');
  });
});

describe('one owner per building; a building without an owner loses its material (#57, #58)', () => {
  it('the card, Claiming, Teleporters and the change list say so, and no topic speaks of shared buildings', () => {
    expect(text('cards')).toContain('every material in its inputs and output goes to the bank, your teleporters on it come back to you');
    expect(text('claiming')).toContain('A building has one owner.');
    expect(text('teleporters')).toContain('another player\'s teleporter is never on your building');
    expect(everywhere()).not.toContain('two players share');
    expect(everywhere()).not.toContain('several owners');
    expect(titles()).toContain('Short Sale and Changing Priorities: an unclaimed building or one of yours');
    expect(titles()).toContain('A building that loses its owner loses its material');
  });
});

describe('Sink Hole sends belts to the bank (#56)', () => {
  it('the card and Belts say so, and no topic says the belts go back to their owners', () => {
    expect(text('cards')).toContain('Belts lying on it go back to the bank: their owners do not get them back');
    expect(text('belts')).toContain('those belts go back to the bank, as in the printed rulebook');
    expect(everywhere()).not.toContain("go back to their owners' supplies");
    // As in the printed rulebook, so not a change of the rules: What changed does not list it.
    expect(titles()).not.toContain('Sink Hole sends belts to the bank');
  });
});
