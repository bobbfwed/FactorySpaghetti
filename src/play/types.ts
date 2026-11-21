// Public types of the play controller.

import type { CardType } from '../engine/config';
import type { PlayerId } from '../engine/state';
import type { Ghost, Target } from '../table/types';

export interface Item {
  id: string;
  label: string;
  detail?: string;
  enabled: boolean;
  reason?: string;
  danger?: boolean;
}

/** What is currently "picked up". */
export interface Selection {
  kind: 'tile' | 'mine' | 'overstock' | 'drone' | 'building' | 'belt' | 'card' | 'teleporter' | 'meeple' | 'module';
  label: string;
}

export interface TrayEntry {
  module: number;
  state: 'onBoard' | 'inTray' | 'lit';
  cost?: string;
}

export interface Prompt {
  id: string;
  anchor: Target;
  title: string;
  detail: string;
  options: Item[];
}

export interface PlayView {
  step: 'setup' | 'place' | 'roll' | 'actions' | 'meeple' | 'roundEnd' | 'waiting' | 'over';
  /** The rulebook's four steps (of the active player's turn); null outside them. */
  stepIndex: 1 | 2 | 3 | 4 | null;
  myTurn: boolean;
  activePlayer: PlayerId | null;
  /** One sentence telling the player what to do now. */
  instruction: string;
  /** The big button. */
  primary: { label: string; enabled: boolean; hint?: string } | null;
  /** Everything that should glow on the table. */
  targets: Target[];
  /** Preview tile or mine awaiting confirm. */
  ghost: Ghost | null;
  confirmBar: { confirm: boolean; rotate: boolean; cancel: boolean } | null;
  selection: Selection | null;
  /** Building (or belt) menu. */
  menu: { anchor: Target; title: string; subtitle?: string; items: Item[] } | null;
  /** My 18 Control Modules. A lit module is chosen with choose(`module:<n>`). */
  tray: TrayEntry[];
  /** Belt, Leverage card, Mine, teleporter, exchange: price, enabled, reason when not. */
  bank: Item[];
  hand: (Item & { card: CardType; text: string })[];
  /** Operate-or-skip decisions I owe, even on other players' turns. */
  prompts: Prompt[];
  /** A list the current flow needs (Scouting Drone's pile, exchange options, ...). */
  choices: { title: string; items: Item[] } | null;
  /** Short "why not" after touching something unlit, or the last refusal. */
  hint: string | null;
}
