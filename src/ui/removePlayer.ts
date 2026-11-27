// The host's "Remove player" during a game (table view, text view and the resume lobby): asks
// first, then the host session puts the seat on a bot at once. The player may rejoin later.

import type { AppController } from '../app/controller';
import { REMOVE_PLAYER_LABEL, canRemovePlayer, removePlayerQuestion } from '../app/lobby';
import { askConfirm } from './confirmDialog';
import { h } from './dom';

/** Ask the host to confirm, then remove the player in `seat`. */
export function askRemovePlayer(ctrl: AppController, seat: number): void {
  const room = ctrl.room;
  const s = room?.seats[seat];
  if (!room || !s) return;
  const name = s.name || `Player ${seat + 1}`;
  askConfirm({
    question: removePlayerQuestion(name),
    confirmLabel: REMOVE_PLAYER_LABEL,
    // Closed by itself once it no longer applies (the player was removed, came back, or left the seat).
    stillValid: () => {
      const r = ctrl.room;
      return !!r && canRemovePlayer(r, ctrl.mySeat, seat) && r.seats[seat]!.name === s.name;
    },
    onConfirm: () => ctrl.kick(seat),
  });
}

/** The "Remove player" button for `seat` (the caller decides whether it is shown). */
export function removePlayerButton(ctrl: AppController, seat: number, cls: string): HTMLButtonElement {
  const name = ctrl.room?.seats[seat]?.name || `Player ${seat + 1}`;
  return h('button', {
    class: cls,
    attrs: { 'aria-label': `Remove ${name} from the game`, 'data-remove-seat': String(seat) },
    onclick: (e: MouseEvent) => { e.stopPropagation(); askRemovePlayer(ctrl, seat); },
  }, REMOVE_PLAYER_LABEL);
}
