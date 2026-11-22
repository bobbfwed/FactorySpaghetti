// What every part of the table game screen reads while it draws: the app controller, the room as
// this device last saw it, the play controller's view, and the screen's own small UI state
// (which panels are open). Parts are plain functions from this context to elements.

import type { AppController } from '../../app/controller';
import type { CardType } from '../../engine/config';
import type { GameState, PlayerId } from '../../engine/state';
import type { PlayController, PlayView } from '../../play';
import type { Room, SeatColor } from '../../session/room';
import { COLORS } from '../icons';
import type { Feel } from './feel';

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
  /** Dice are still tumbling on the table: the "Rolled N" chip waits for them to land. */
  diceRolling: boolean;
  /** The player just closed the phone sheet themselves (the screen then leaves it closed for the current choice). */
  sheetUserClosed: boolean;
  /** The player put away the "cannot store the game" strip (shown again if storage recovers and fails again). */
  storeDismissed: boolean;
  /** What the last roll produced (shown on the roll chip until the next roll). */
  rollOutcome: { seq: number; roller: number; total: number; dice: number[]; text: string } | null;
  /** The same lines for the log, by move number. */
  rollNotes: Record<number, string>;
  /** Phone: the full turn order is open. */
  queueOpen: boolean;
  /** Desktop on a narrow touch screen: the hand panel is open. */
  handOpen: boolean;
  /** A Leverage card that was played as soon as it was drawn: said on the table for everyone. */
  announce: { seq: number; seat: number; text: string } | null;
  /** The roll outcome is shown in full (after a roll, or when its chip is tapped); otherwise the small chip. */
  rollOpen: boolean;
}

export function initialUi(): UiState {
  return { menuOpen: false, side: null, sheetOpen: false, sheetTab: 'tray', card: null, seat: null, overHidden: false, topDown: false, diceRolling: false, sheetUserClosed: false, storeDismissed: false, rollOutcome: null, rollNotes: {}, queueOpen: false, handOpen: false, announce: null, rollOpen: false };
}

/** What the interface may ask of the play controller (the moves a player makes). */
export type PlayInput = Pick<PlayController, 'tap' | 'choose' | 'primary' | 'confirm' | 'cancel' | 'rotate'>;

/** Animation speed, sound and vibration settings, and whether this device can vibrate. */
export interface FeelCtl {
  readonly settings: Feel;
  set(patch: Partial<Feel>): void;
  readonly canVibrate: boolean;
}

export interface Ctx {
  ctrl: AppController;
  room: Room;
  game: GameState;
  /** My seat (= engine player id), or null when watching. */
  me: number | null;
  /** The play controller's view of the displayed state; nothing is lit while the picture lags the newest state. */
  view: PlayView;
  /** Moves. While the picture lags the newest state, any of these just catches the picture up. */
  play: PlayInput;
  feel: FeelCtl;
  /** The picture is still catching up with the newest state (animations playing or waiting). */
  busy: boolean;
  /** Jump straight to the newest state. */
  skip(): void;
  /** The next round's turn order from the engine, when known (for "Round N+1: X starts"). */
  upcomingOrder?: readonly PlayerId[] | null;
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
