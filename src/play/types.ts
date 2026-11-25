// Public types of the play controller.

import type { CardType, Material } from '../engine/config';
import type { PlayerId } from '../engine/state';
import type { Ghost, Target } from '../table/types';

export interface Item {
  id: string;
  label: string;
  detail?: string;
  enabled: boolean;
  reason?: string;
  danger?: boolean;
  /** Bank items: the price in material value, as the engine charges it (absent when there is none, e.g. all Mines are in). */
  price?: number;
  /** Hand items: how many copies of this Leverage card are in the hand. */
  count?: number;
  /** Running a building: the materials this choice hands over from my inventory (none for a plain run). */
  materials?: Material[];
}

/**
 * Running a building that has my teleporter on its input and an empty input slot: what it holds,
 * what it needs, and my materials. The ways to run it are the items beside it (one per listed move).
 */
export interface SupplyView {
  /** "The Tesseract Factory needs a Sphere and a Plate to run." */
  heading: string;
  /** Its input slots: what lies there now (null = empty). */
  slots: (Material | null)[];
  /** My materials now. */
  have: Record<Material, number>;
  /** When no supplied run is offered: why, in words; null otherwise. */
  missing: string | null;
}

/** What is currently "picked up". */
export interface Selection {
  kind: 'tile' | 'mine' | 'overstock' | 'drone' | 'building' | 'belt' | 'card' | 'teleporter' | 'meeple' | 'module' | 'exchange';
  label: string;
}

export interface TrayEntry {
  module: number;
  state: 'onBoard' | 'inTray' | 'lit';
  cost?: string;
  /** A lit module: what using it costs, in upgrades (0 = free). */
  upgradeCost?: number;
}

export interface Prompt {
  id: string;
  anchor: Target;
  title: string;
  detail: string;
  options: Item[];
  /** The supply chooser, when my teleporter is on the building's input and a slot is empty. */
  supply: SupplyView | null;
  /** On another player's turn: what happens when the time runs out. */
  timeout: string | null;
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
  /** `label`: what confirming does, when the generic wording would not say it ("Remove this belt"). */
  confirmBar: { confirm: boolean; rotate: boolean; cancel: boolean; label?: string } | null;
  selection: Selection | null;
  /** Building (or belt) menu. */
  menu: { anchor: Target; title: string; subtitle?: string; items: Item[]; supply?: SupplyView | null } | null;
  /** My 18 Control Modules. A lit module is chosen with choose(`module:<n>`). */
  tray: TrayEntry[];
  /** Belt, Leverage card, Mine, teleporter, exchange: price, enabled, reason when not. */
  bank: Item[];
  /**
   * Plate, Sphere and Tesseract in my materials (ids `inv:<material>`): pressing one offers to
   * break it down into smaller materials; disabled ones carry the reason. Empty when not seated.
   */
  inventory: Item[];
  /** The total value of my materials (each material at its value), null when not seated. */
  totalValue: number | null;
  hand: (Item & { card: CardType; text: string })[];
  /** Operate-or-skip decisions I owe, even on other players' turns. */
  prompts: Prompt[];
  /** A list the current flow needs (Scouting Drone's pile, exchange options, ...). */
  choices: { title: string; items: Item[] } | null;
  /**
   * A planned belt route (Lay a belt), in order from its first point: each belt with its tier,
   * own = from the supply, buy = can be bought now, cant = not yet. null when no route is planned.
   */
  route: { pieceId: string; from: number; to: number; tier: 'own' | 'buy' | 'cant' }[] | null;
  /** The spot chosen for my meeple, awaiting confirmation (a building: slot null; a Mine point: 0 or 1). */
  meeplePick: { pieceId: string; slot: 0 | 1 | null } | null;
  /** Short "why not" after touching something unlit, or the last refusal. */
  hint: string | null;
}
