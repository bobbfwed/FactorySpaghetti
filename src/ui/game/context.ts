// What every part of the table game screen reads while it draws: the app controller, the room as
// this device last saw it, the play controller's view, and the screen's own small UI state
// (which panels are open). Parts are plain functions from this context to elements.

import type { AppController } from '../../app/controller';
import type { CardType } from '../../engine/config';
import type { GameState, PlayerId } from '../../engine/state';
import type { PlayController, PlayView } from '../../play';
import type { Room, SeatColor } from '../../session/room';
import { COLORS } from '../icons';

export type SheetTab = 'tray' | 'cards' | 'log' | 'rules';
export type SideTab = 'log' | 'rules' | 'bonuses';

export interface UiState {
  menuOpen: boolean;
  /** Desktop: the right-hand panel. */
  side: SideTab | null;
  /** Phone: the bottom sheet is pulled up. */
  sheetOpen: boolean;
  sheetTab: SheetTab;
  /** The hand card shown large. */
  card: CardType | null;
  /** The opponent whose details are open. */
  seat: number | null;
  /** The game-over card is put away to look at the table. */
  overHidden: boolean;
  topDown: boolean;
}

export function initialUi(): UiState {
  return { menuOpen: false, side: null, sheetOpen: false, sheetTab: 'tray', card: null, seat: null, overHidden: false, topDown: false };
}

export interface Ctx {
  ctrl: AppController;
  room: Room;
  game: GameState;
  /** My seat (= engine player id), or null when watching. */
  me: number | null;
  view: PlayView;
  play: PlayController;
  ui: UiState;
  phone: boolean;
  /** Phone layout on a window wider than tall: the sheet becomes a panel on the right. */
  landscape: boolean;
  /** Redraw the interface after a change to `ui`. */
  redraw(): void;
  /** Camera controls (no-ops until the table has loaded). */
  camera: { rotate(): void; recenter(): void; topDown(on: boolean): void };
}

export function seatColor(room: Room, seat: number | null | undefined): SeatColor {
  return (seat !== null && seat !== undefined ? room.seats[seat]?.color : undefined) ?? 'blue';
}

export function seatHex(room: Room, seat: number | null | undefined): string {
  return COLORS[seatColor(room, seat)];
}

export function seatName(room: Room, seat: number | null | undefined): string {
  if (seat === null || seat === undefined) return '';
  return room.seats[seat]?.name || `Player ${seat + 1}`;
}

export function activePlayer(game: GameState): PlayerId | null {
  return game.turnOrder[game.activePlayerIndex] ?? null;
}

/** "8 s" / "1:05" for a countdown. */
export function clock(ms: number | null): string {
  if (ms === null) return '';
  const s = Math.max(0, Math.ceil(ms / 1000));
  return s >= 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : `${s} s`;
}
