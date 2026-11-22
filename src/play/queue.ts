// The turn queue: who has played this round, who is playing and doing what, who is next, the end
// of the round, and who starts the next one. Read from the state (turnOrder, activePlayerIndex,
// phase, round); the order of the next round comes from the engine when it is given.

import type { GameState, PlayerId } from '../engine/state';

export type ChipStatus = 'done' | 'active' | 'next' | 'later';

export type QueueItem =
  /** A player's turn (or end-of-round turn, or set-up claim). */
  | { kind: 'turn'; seat: PlayerId; status: ChipStatus; first: boolean; step: string | null }
  /** A heading or a milestone: "Round 3", "End of round", "Round 4: Bea starts". */
  | { kind: 'mark'; text: string; status: 'done' | 'active' | 'later'; role: 'round' | 'roundEnd' | 'next' | 'setup' };

export interface TurnQueue {
  items: QueueItem[];
  /** The seat whose turn comes next (for "next" tags elsewhere), or null. */
  next: PlayerId | null;
}

const STEP: Partial<Record<GameState['phase'], string>> = {
  placePiece: 'Place a piece',
  roll: 'Roll',
  actions: 'Actions',
  placeMeeple: 'Place meeple',
  roundEnd: 'End-of-round turn',
  setupClaimPF: 'Claim a Plate Factory',
  setupClaimPP: 'Claim a Power Plant',
};

function chips(order: readonly PlayerId[], activeAt: number, first: PlayerId | undefined, step: string | null): QueueItem[] {
  return order.map((seat, i) => ({
    kind: 'turn' as const,
    seat,
    status: i < activeAt ? 'done' as const : i === activeAt ? 'active' as const : i === activeAt + 1 ? 'next' as const : 'later' as const,
    first: seat === first,
    step: i === activeAt ? step : null,
  }));
}

/**
 * The queue for the state on screen. `upcoming` is the next round's order when known
 * (engine `upcomingTurnOrder`), else the "next round starts with" line is left out during turns.
 */
export function turnQueue(g: GameState, names: (seat: PlayerId) => string, upcoming: readonly PlayerId[] | null = null): TurnQueue {
  const order = g.turnOrder;
  const at = g.activePlayerIndex;
  const step = STEP[g.phase] ?? null;
  const items: QueueItem[] = [];
  if (g.gameOver) return { items: [{ kind: 'mark', text: 'Game over', status: 'active', role: 'round' }], next: null };

  if (g.phase === 'setupClaimPF' || g.phase === 'setupClaimPP') {
    // Plate Factories go forward through the order, then Power Plants come back.
    const pf = g.phase === 'setupClaimPF';
    items.push({ kind: 'mark', text: 'Set-up: Plate Factories', status: pf ? 'active' : 'done', role: 'setup' });
    items.push(...chips(order, pf ? at : order.length, order[0], pf ? step : null));
    const back = [...order].reverse();
    const backAt = pf ? -1 : order.length - 1 - at;
    items.push({ kind: 'mark', text: 'Power Plants', status: pf ? 'later' : 'active', role: 'setup' });
    const ppStart = items.length;
    items.push(...back.map((seat, i) => ({
      kind: 'turn' as const, seat, first: false,
      status: backAt < 0 ? 'later' as const : i < backAt ? 'done' as const : i === backAt ? 'active' as const : i === backAt + 1 ? 'next' as const : 'later' as const,
      step: i === backAt ? step : null,
    })));
    // The last Plate Factory claim is followed by the first Power Plant claim.
    const firstPP = items[ppStart];
    if (pf && at === order.length - 1 && firstPP?.kind === 'turn') firstPP.status = 'next';
    const starts = order[0];
    if (starts !== undefined) items.push({ kind: 'mark', text: `Round 1: ${names(starts)} starts`, status: 'later', role: 'next' });
  } else if (g.phase === 'roundEnd') {
    items.push({ kind: 'mark', text: 'End of round', status: 'active', role: 'roundEnd' });
    items.push(...chips(order, at, undefined, step));
    const starts = order[0];
    if (starts !== undefined) items.push({ kind: 'mark', text: `Round ${g.round}: ${names(starts)} starts`, status: 'later', role: 'next' });
  } else {
    items.push({ kind: 'mark', text: `Round ${g.round}`, status: 'active', role: 'round' });
    items.push(...chips(order, at, order[0], step));
    items.push({ kind: 'mark', text: 'End of round', status: 'later', role: 'roundEnd' });
    const starts = upcoming?.[0];
    if (starts !== undefined) items.push({ kind: 'mark', text: `Round ${g.round + 1}: ${names(starts)} starts`, status: 'later', role: 'next' });
  }
  const nextChip = items.find((x): x is Extract<QueueItem, { kind: 'turn' }> => x.kind === 'turn' && x.status === 'next');
  return { items, next: nextChip ? nextChip.seat : null };
}
