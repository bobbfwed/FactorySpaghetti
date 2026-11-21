// What a roll produced, in one short line: which buildings the total activated, for whom, and
// what each did, plus ore flowing out of the Mines. Built from the room's events (and later
// updated when an activated factory is run or skipped), never from the rules themselves.

import type { Material, PieceType } from '../../engine/config';
import type { ActivationOutcome, TableEvent } from '../../session/room';
import { BUILDING_NAME, MATERIAL_NAME } from '../../session/describe';

export interface OutcomeItem {
  pieceId: string;
  owner: number;
  building: PieceType;
  state: ActivationOutcome | 'made' | 'skipped';
  amount: number;
  product: Material | null;
}

export interface RollOutcome {
  /** Move number of the roll. */
  seq: number;
  roller: number;
  total: number;
  dice: number[];
  items: OutcomeItem[];
  /** Input slots filled with ore from the Mines by this roll. */
  ore: number;
}

/** The outcome of the last roll among `events` (a move or a burst of moves), or null when there was no roll. */
export function outcomeOf(seq: number, events: readonly TableEvent[], ore = 0): RollOutcome | null {
  let at = -1;
  events.forEach((e, i) => { if (e.kind === 'roll') at = i; });
  if (at < 0) return null;
  const roll = events[at] as Extract<TableEvent, { kind: 'roll' }>;
  const o: RollOutcome = { seq, roller: roll.seat, total: roll.total, dice: [...roll.dice], items: [], ore };
  for (const e of events.slice(at + 1)) {
    if (e.kind === 'activated') {
      o.items.push({ pieceId: e.pieceId, owner: e.seat, building: e.building, state: e.outcome, amount: e.amount, product: null });
    }
  }
  return update(o, events.slice(at + 1));
}

/** Fold later events (a factory run or skipped after the roll) into the outcome. */
export function update(o: RollOutcome, events: readonly TableEvent[]): RollOutcome {
  let items = o.items;
  for (const e of events) {
    if (e.kind !== 'operated' && e.kind !== 'skipped') continue;
    const i = items.findIndex(x => x.pieceId === e.pieceId && x.owner === e.seat && x.state === 'awaiting-choice');
    if (i < 0) continue;
    items = items.map((x, k) => (k !== i ? x
      : e.kind === 'skipped' ? { ...x, state: 'skipped' as const }
        : { ...x, state: 'made' as const, product: e.product }));
  }
  return items === o.items ? o : { ...o, items };
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

function what(it: OutcomeItem, owner: string, you: boolean): string {
  switch (it.state) {
    case 'power': return `gave ${plural(it.amount, 'Power Token', 'Power Tokens')}`;
    case 'power-capped': return 'gave nothing (Power Tokens already at the limit)';
    case 'awaiting-choice': return you ? 'is activated: run it or skip' : `is activated: ${owner} decides whether to run it`;
    case 'made': return it.product ? `made 1 ${MATERIAL_NAME[it.product]}` : 'ran';
    case 'skipped': return 'was not run';
    case 'output-full': return 'did nothing: its output is still full';
    case 'input-missing': return 'did nothing: its input is not complete';
    case 'no-power': return 'did nothing: not enough Power Tokens';
  }
}

/** "Bea rolled 6: Bea's Plate Factory made 1 Plate; your Power Plant gave 2 Power Tokens." */
export function outcomeText(o: RollOutcome, nameOf: (seat: number) => string, me: number | null): string {
  const who = o.roller === me ? 'You' : nameOf(o.roller);
  const head = `${who} rolled ${o.total}`;
  const parts = o.items.map((it) => {
    const you = it.owner === me;
    const owner = you ? 'your' : `${nameOf(it.owner)}'s`;
    return `${owner} ${BUILDING_NAME[it.building]} ${what(it, nameOf(it.owner), you)}`;
  });
  const ore = o.ore > 0 ? ` Ore flowed from the Mines into ${plural(o.ore, 'input', 'inputs')}.` : '';
  if (parts.length === 0) {
    return `${head}: no Control Module ${o.total} is on a building, so nothing was activated.${ore}`;
  }
  const body = parts.join('; ');
  return `${head}: ${body.charAt(0).toUpperCase()}${body.slice(1)}.${ore}`;
}
