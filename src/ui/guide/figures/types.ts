// Pictures in the guide: plain data, like the rest of the content. A figure is drawn live from the
// game's own assets: 3D pieces from public/models through the table's drawing code, flat things
// (Leverage cards, dice, the Control Module tray) by the game screen's own HTML code. Nothing here
// is an image file, so the pictures always match the current pieces.

import type { CardType, Material, PieceType } from '../../../engine/config';
import type { Action } from '../../../engine/actions';
import type { TurnPhase } from '../../../engine/state';

export type FigColor = 'blue' | 'red' | 'orange' | 'green';

/** Icons a figure may fall back on (a subset of src/ui/icons.ts, same as GuideIcon). */
export type FigIcon = 'ore' | 'plate' | 'sphere' | 'tess' | 'power' | 'card' | 'mine' | 'belt' | 'teleporter' | 'meeple' | 'dice' | 'exchange' | 'book';

/**
 * A model file in public/models (by its manifest name). A model missing from the manifest, or one
 * that fails to load, is not an error: the figure draws its stand-in (orElse) or its icon instead.
 */
export type FigModel =
  | 'tile-blank' | 'tile-plate-factory' | 'tile-sphere-factory' | 'tile-tesseract-factory' | 'tile-power-plant'
  | 'mine-1' | 'mine-2' | 'mine-3' | 'ore' | 'plate' | 'sphere' | 'tesseract' | 'belt' | 'meeple'
  | 'power-token' | 'starting-player' | 'control-module' | 'control-module-tray' | 'teleporter';

/**
 * Models a figure may name before they are in public/models/manifest.json (the figure then
 * degrades quietly). Empty now that the Teleporter model has arrived; the content test allows these.
 */
export const OPTIONAL_MODELS: ReadonlySet<FigModel> = new Set<FigModel>();

/** One board piece of a staged scene. Players are numbered 0-3 (the scene's colours, in order). */
export interface ScenePiece {
  readonly id: string;
  readonly type: PieceType;
  readonly q: number;
  readonly r: number;
  /** 60-degree steps, 0-5 (as the engine counts them). */
  readonly rot?: number;
  /** Control Modules on the building: [player, number]. */
  readonly claims?: readonly (readonly [number, number])[];
  /** What lies in the input slots / the output (null = empty). Missing: empty. */
  readonly input?: readonly (Material | null)[];
  readonly output?: readonly (Material | null)[];
  /**
   * A teleporter of this player on the input / the output. On a building with several inputs a
   * teleporter sits on one input (RULES_CHANGES.md #55): a number means input 1; a list gives the
   * owner per input (null = none).
   */
  readonly tpIn?: number | readonly (number | null)[];
  readonly tpOut?: number;
}

/** A belt on piece `piece` between its connection points a and b (engine positions, 0-11). */
export interface SceneBelt {
  readonly piece: string;
  readonly a: number;
  readonly b: number;
  readonly owner?: number;
  /** A belt shown as an example of what the rules do NOT allow: the engine's error code for it. */
  readonly illegal?: string;
}

export interface SceneMeeple { readonly player: number; readonly piece: string; readonly slot?: 0 | 1 }

/** Something the game would make glow (a free space, a connection point, a buffer, a Mine spot). */
export type GlowAt =
  | { readonly q: number; readonly r: number }
  | { readonly piece: string; readonly point: number }
  | { readonly piece: string; readonly buffer: 'input' | 'output' }
  | { readonly piece: string; readonly slot: 0 | 1 };

/**
 * A small hand-built arrangement drawn by the table's own code and camera. Either `pieces` (with
 * belts, meeples) or `setup` (the real starting board the game deals for a seed).
 */
export interface SceneSpec {
  readonly pieces?: readonly ScenePiece[];
  readonly belts?: readonly SceneBelt[];
  readonly meeples?: readonly SceneMeeple[];
  /** The board the game sets up for this seed and number of players; `claims`: after the first claims. */
  readonly setup?: { readonly seed: number; readonly players: 2 | 3 | 4; readonly claims?: boolean };
  /** Player colours, index = player number. Default blue, red, orange, green. */
  readonly colors?: readonly FigColor[];
  /** Turn the view by 60-degree steps (the table's turn button). */
  readonly turn?: number;
  /** Glow on things the player may choose, in a player's colour. */
  readonly glow?: { readonly color: FigColor; readonly at: readonly GlowAt[] };
  /** A piece about to be placed, drawn see-through like the game's preview. */
  readonly ghost?: { readonly type: PieceType; readonly q: number; readonly r: number; readonly rot?: number };
  /** Width / height of the picture. Default 16 / 9. */
  readonly aspect?: number;
  /**
   * Frame these pieces (plus `pad` millimetres all round) instead of the whole board: a close-up.
   * Pieces outside run off the edge of the picture, as on the table when zoomed in.
   */
  readonly frame?: { readonly pieces: readonly string[]; readonly pad?: number };
  /**
   * The scene shows a moment when material has finished moving (the default): moving material
   * again changes nothing. Checked by the guide's tests with the engine. False for scenes that
   * show a moment just before material moves.
   */
  readonly settled?: boolean;
}

/** Where a numbered marker sits on a scene. */
export type CalloutAt =
  | { readonly piece: string; readonly buffer: 'input' | 'output' }
  | { readonly piece: string; readonly point: number }
  | { readonly piece: string; readonly slot: 0 | 1 }
  | { readonly piece: string; readonly belt: number }
  /** Just above the teleporter on an input (`slot`, default the first) or the output (where the table draws it). */
  | { readonly piece: string; readonly teleporter: 'input' | 'output'; readonly slot?: number }
  /** The middle of a piece, moved dx / dz millimetres on the table (-dz is up the picture). */
  | { readonly piece: string; readonly centre: true; readonly dx?: number; readonly dz?: number }
  | { readonly q: number; readonly r: number };

/** A marker over the picture ("1", "2", ...) with its explanation in the legend below. */
export interface Callout { readonly mark: string; readonly at: CalloutAt; readonly text: string }

/** A flat thing drawn by the game screen's own HTML code. */
export type Flat =
  | { readonly k: 'card'; readonly card: CardType }
  | { readonly k: 'die'; readonly n: number }
  | { readonly k: 'tray'; readonly color: FigColor; readonly onBoard?: readonly number[] }
  | { readonly k: 'icon'; readonly icon: FigIcon; readonly color?: FigColor }
  /** A material in the player area, with how many you hold. */
  | { readonly k: 'well'; readonly m: Material; readonly n: number }
  /** "Total Value: 11". */
  | { readonly k: 'total'; readonly n: number }
  /** The Tesseract pips of the player area: n of the Tesseracts needed to win. */
  | { readonly k: 'pips'; readonly n: number };

/** One picture in a line-up. */
export type Pic =
  /**
   * A single piece model. `numeral`: the number printed on a Control Module. `yaw`: turn the model
   * (radians, as Three.js turns about the vertical) so its telling side faces the viewer, e.g. the
   * Teleporter's portal end.
   */
  | { readonly model: FigModel; readonly color?: FigColor; readonly numeral?: number; readonly yaw?: number; readonly icon?: FigIcon; readonly orElse?: SceneSpec }
  | { readonly scene: SceneSpec; readonly icon?: FigIcon }
  | { readonly flat: Flat };

export type LineupItem =
  | { readonly pic: Pic; readonly label: string; readonly value?: string; readonly wide?: boolean; readonly big?: boolean }
  /** A sign between pictures: "+", "→", "or". */
  | { readonly sign: string };

// ── Animated examples ("play" figures) ────────────────────────────────────────────────────────
// An example is a starting position and a list of steps. Each step is one or more real engine
// moves (applied with applyAction, so every step is legal by construction) and is drawn with the
// game's own animation code (planTransition, Animator). Where something is not a move, a step may
// say so directly: the turn passes to another player (`turnTo`), or the board jumps to a new
// staged position later in the game (`jump`). Plain data: about fifteen examples are written this way.

/** A move by the player whose turn it is (or `seat`, for a decision on another player's building). */
export interface PlayMove { readonly act: Action; readonly seat?: number }

/** What a player holds at the start of an example (staged positions). Missing: as the game deals. */
export interface PlayHoldings {
  readonly power?: number;
  readonly materials?: Partial<Readonly<Record<Material, number>>>;
  /** Mine credits (from a Mine's upgrade point) and free upgrades, as in a round-end turn. */
  readonly credits?: number;
  readonly freeUpgrades?: number;
  /** Leverage cards in hand, belts and Teleporters still in their supply. */
  readonly hand?: readonly CardType[];
  readonly belts?: number;
  readonly teleporters?: number;
}

/** Where an example starts: the real starting board for a seed, or a staged board. */
export interface PlayStart {
  /** The board the game deals for this seed; `claims`: after every player's first claims. */
  readonly setup?: { readonly seed: number; readonly players: 2 | 3 | 4; readonly claims?: boolean };
  /** A staged board (pieces, belts, meeples), as for a still scene. Player Control Modules on it leave the trays. */
  readonly scene?: Pick<SceneSpec, 'pieces' | 'belts' | 'meeples'>;
  /**
   * Whose turn it is and in which step; `order`: the turn order (players by number, first to
   * last). Default: as the setup leaves it, or player 0's actions step on a staged board.
   */
  readonly turn?: { readonly seat: number; readonly phase: TurnPhase; readonly order?: readonly number[] };
  /** Per player, by number. */
  readonly players?: readonly PlayHoldings[];
  /** Staged boards: the pieces left in stack 1, top first (default none; stacks 2 and 3 stay empty). */
  readonly stack?: readonly PieceType[];
  /** Staged boards: the pieces of stacks 2 and 3, top first (each opens when its Mine comes into play). */
  readonly stacks23?: readonly [readonly PieceType[], readonly PieceType[]];
  /** At the start (before step 1): light what the player whose turn it is may choose (example starts only). */
  readonly glow?: 'legal';
}

/** One step of an example. Every caption is shown in the step list from the start. */
export interface PlayStep {
  /** One sentence in the rulebook's words, saying what happens and why. */
  readonly caption: string;
  /** Not a move: the board jumps to a new staged position ("later in the game"). Applied first. */
  readonly jump?: PlayStart;
  /** Not a move: the turn passes to `seat`, in `phase` (what happens in between is not shown). */
  readonly turnTo?: { readonly seat: number; readonly phase: TurnPhase };
  /** Engine moves, in order. Each is animated as the game animates it. */
  readonly moves?: readonly PlayMove[];
  /** Numbered markers shown once the step has played (and, with keepMarks, after it). */
  readonly callouts?: readonly Callout[];
  /**
   * Glow once the step has played: 'legal' lights what the player whose turn it is may choose
   * next (from the engine's legal moves: free spaces, buildings to claim, meeple spots), or a list.
   */
  readonly glow?: 'legal' | readonly GlowAt[] | { readonly beltsFrom: { readonly piece: string; readonly point: number } };
}

/** HTML under the picture: the parts of a player's area the example uses. */
export interface PlaySide {
  /** Whose tray and upgrades (player number). */
  readonly player: number;
  /** The Control Module tray: a module lights, then travels to its building (and back on an upgrade). */
  readonly tray?: boolean;
  /** Mine credits and free upgrades. */
  readonly upgrades?: boolean;
  /** These players' Power Tokens and materials (Power Tokens and materials fly to and from them). */
  readonly holdings?: readonly number[];
  /** The dice and their total, and what the roll did, in one line. */
  readonly roll?: boolean;
  /** The bank: its prices now, and what the last purchase or exchange handed in and gave back. */
  readonly bank?: boolean;
  /** The Leverage cards in the player's hand (a card played travels to the table). */
  readonly hand?: boolean;
  /** The four steps of a turn, the current one marked (whose turn it is, or the round-end turn). */
  readonly steps?: boolean;
  /** These players' Tesseracts toward winning (Tesseracts held and bonus cards). */
  readonly tesseracts?: readonly number[];
  /** Belts and Teleporters in the supply, in the holdings rows. */
  readonly supply?: boolean;
}

export interface PlayExample {
  /** Unique; names the example in tests and in the page. */
  readonly id: string;
  readonly start: PlayStart;
  readonly steps: readonly PlayStep[];
  /** Player colours, index = player number. Default blue, red, orange, green. */
  readonly colors?: readonly FigColor[];
  /** Width / height of the picture. Default 16 / 9. */
  readonly aspect?: number;
  /**
   * The camera frame, fixed for the whole example: these pieces plus `pad` millimetres. Default:
   * every piece the example ever shows.
   */
  readonly frame?: { readonly pieces: readonly string[]; readonly pad?: number };
  /** Turn the view by 60-degree steps. */
  readonly turn?: number;
  /** Show stack 1 beside the board (where placed pieces come from), or these stacks (0-2). */
  readonly pile?: boolean | readonly number[];
  /** Show the dice beside the board. */
  readonly dice?: boolean;
  readonly side?: PlaySide;
  /** Markers of finished steps stay on the picture (an order, built up step by step). */
  readonly keepMarks?: boolean;
}

export type FigureShow =
  /** Pieces side by side, each with its name (and a value) under it; the row wraps on narrow screens. */
  | { readonly kind: 'lineup'; readonly items: readonly LineupItem[] }
  /** A factory and what it makes: its tile, then one row of material pictures per recipe. */
  | {
    readonly kind: 'recipe'; readonly factory: FigModel; readonly name: string; readonly note?: string;
    readonly inputs: readonly (readonly Material[])[]; readonly product: Material;
  }
  /** A staged scene with optional numbered markers. */
  | { readonly kind: 'scene'; readonly scene: SceneSpec; readonly callouts?: readonly Callout[]; readonly icon?: FigIcon }
  /** An animated example: a picture that plays its steps, with the numbered step list under it. */
  | { readonly kind: 'play'; readonly play: PlayExample };

export interface FigureBlock {
  readonly k: 'figure';
  /** One short sentence under the picture saying what it shows (may be left out where the picture names itself, e.g. a card). */
  readonly caption?: string;
  /** What a screen reader says for the picture. */
  readonly alt: string;
  readonly show: FigureShow;
}
