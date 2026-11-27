// Words: no label, instruction, reason or hint the controller shows contains an internal
// name (a phase name, an Action type, a piece or card id, a piece id) or leftover junk.

import { describe, expect, it } from 'vitest';
import type { GameState, PlayerId } from '../../engine/state';
import { applyAction, createGame } from '../../engine';
import { CARD_COUNTS, PIECE_COUNTS } from '../../engine/config';
import { PlayController } from '../controller';
import type { PlayView } from '../types';
import { ALL_ACTION_TYPES, Rand, actors, allItems, randomMove, roll } from './helpers';

// Phase names. 'roll' and 'actions' are also plain English words ("Roll 2 dice", "Done with
// actions"), so they are checked as the camelCase identifiers only would be: the five
// camelCase phase names below, plus every Action type and piece/card id.
const FORBIDDEN = [
  'setupClaimPF', 'setupClaimPP', 'placePiece', 'placeMeeple', 'roundEnd',
  ...ALL_ACTION_TYPES,
  ...Object.keys(PIECE_COUNTS).filter(k => k !== 'mine' && k !== 'blank'),
  ...Object.keys(CARD_COUNTS),
  'undefined', 'null', 'NaN', '[object', 'pieceId', 'controlModule',
];
const ID_PATTERN = /\bs\d-[a-zA-Z]+-\d+\b|\bmine-\d\b|\bbelt-p\d/;

function strings(v: PlayView): string[] {
  const out = [v.instruction, v.hint ?? '', v.primary?.label ?? '', v.primary?.hint ?? '', v.selection?.label ?? ''];
  for (const it of allItems(v)) out.push(it.label, it.detail ?? '', it.reason ?? '');
  for (const h of v.hand) out.push(h.text);
  if (v.menu) out.push(v.menu.title, v.menu.subtitle ?? '', v.menu.note ?? '');
  if (v.choices) out.push(v.choices.title);
  for (const p of v.prompts) out.push(p.title, p.detail);
  for (const t of v.tray) out.push(t.cost ?? '', t.label ?? '');
  return out.filter(s => s.length > 0);
}

describe('words', () => {
  it('views use rulebook words only', () => {
    const seen = new Set<string>();
    for (const [pc, seed] of [[2, 41], [3, 42], [4, 43]] as const) {
      const r = new Rand(seed);
      let s: GameState = createGame(seed, pc);
      const ctrls = Array.from({ length: pc }, () => new PlayController({ send: (): void => {} }));
      for (let step = 0; step < 900 && !s.gameOver; step++) {
        const p = r.pick(actors(s));
        for (let i = 0; i < pc; i++) {
          const c = ctrls[i]!;
          c.update(s, i as PlayerId);
          for (const x of strings(c.view)) seen.add(x);
        }
        // Wander through a few menus and selections before moving on.
        const c = ctrls[p]!;
        for (let g = 0; g < 6; g++) {
          const v = c.view;
          const ids = allItems(v).map(i => i.id);
          if (r.next() < 0.6 && v.targets.length) c.tap(r.pick(v.targets));
          else if (ids.length) c.choose(r.pick(ids));
          for (const x of strings(c.view)) seen.add(x);
        }
        c.cancel();
        const a = s.phase === 'roll' && p === s.turnOrder[s.activePlayerIndex] ? roll(r, s) : randomMove(r, s, p);
        if (!a) continue;
        const res = applyAction(s, a);
        if (res.ok) s = res.state;
      }
    }
    expect(seen.size).toBeGreaterThan(150);
    const bad: string[] = [];
    for (const text of seen) {
      for (const f of FORBIDDEN) if (text.includes(f)) bad.push(`"${text}" contains ${f}`);
      if (ID_PATTERN.test(text)) bad.push(`"${text}" contains an id`);
    }
    expect(bad).toEqual([]);
    // eslint-disable-next-line no-console -- coverage figure for the report
    console.log(`words: ${seen.size} distinct strings checked`);
  }, 300_000);
});
