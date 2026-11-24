// The whole guide: the table of contents (sections, in reading order) and every topic.
// Previous / next follow the order of the topics in the sections.

import type { Guide, Topic } from '../types';
import { goal, screen, starting, table } from './basics';
import { roundEnd, stepActions, stepMeeple, stepPlace, stepRoll, turn } from './turn';
import { bank, belts, claiming, factories, moving, production, teleporters } from './factory';
import { cards } from './cards';
import { bonuses, mines, online, winning } from './more';
import { changes, printed } from './changes';

const TOPICS: readonly Topic[] = [
  goal, table, screen, starting,
  turn, stepPlace, stepRoll, stepActions, stepMeeple, roundEnd,
  claiming, production, factories, moving, belts, teleporters, bank,
  cards, mines, bonuses, winning,
  online,
  changes, printed,
];

export const GUIDE: Guide = {
  sections: [
    { title: 'Start here', topics: ['goal', 'table', 'screen', 'starting'] },
    { title: 'Your turn', topics: ['turn', 'step-place', 'step-roll', 'step-actions', 'step-meeple', 'round-end'] },
    { title: 'Running your factory', topics: ['claiming', 'production', 'factories', 'moving', 'belts', 'teleporters', 'bank'] },
    { title: 'Cards, Mines and winning', topics: ['cards', 'mines', 'bonuses', 'winning'] },
    { title: 'Playing online', topics: ['online'] },
    { title: 'Changes', topics: ['changes', 'printed'] },
  ],
  topics: TOPICS,
};

/** Topics in reading order (the order of the table of contents). */
export function topicOrder(g: Guide = GUIDE): string[] {
  return g.sections.flatMap(s => s.topics);
}

export function findTopic(id: string, g: Guide = GUIDE): Topic | undefined {
  return g.topics.find(t => t.id === id);
}
