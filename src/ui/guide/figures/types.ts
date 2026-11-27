// Pictures in the guide: plain data, like the rest of the content. A figure is drawn live from the
// game's own assets: 3D pieces from public/models through the table's drawing code, flat things
// (Leverage cards, dice, the Control Module tray) by the game screen's own HTML code. Nothing here
// is an image file, so the pictures always match the current pieces.

import type { CardType, Material, PieceType } from '../../../engine/config';

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
  /** A teleporter of this player on the input / the output. */
  readonly tpIn?: number;
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
  /** Just above the teleporter on a buffer (where the table draws it). */
  | { readonly piece: string; readonly teleporter: 'input' | 'output' }
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
  /** A single piece model. `numeral`: the number printed on a Control Module. */
  | { readonly model: FigModel; readonly color?: FigColor; readonly numeral?: number; readonly icon?: FigIcon; readonly orElse?: SceneSpec }
  | { readonly scene: SceneSpec; readonly icon?: FigIcon }
  | { readonly flat: Flat };

export type LineupItem =
  | { readonly pic: Pic; readonly label: string; readonly value?: string; readonly wide?: boolean }
  /** A sign between pictures: "+", "→", "or". */
  | { readonly sign: string };

export type FigureShow =
  /** Pieces side by side, each with its name (and a value) under it; the row wraps on narrow screens. */
  | { readonly kind: 'lineup'; readonly items: readonly LineupItem[] }
  /** A factory and what it makes: its tile, then one row of material pictures per recipe. */
  | {
    readonly kind: 'recipe'; readonly factory: FigModel; readonly name: string; readonly note?: string;
    readonly inputs: readonly (readonly Material[])[]; readonly product: Material;
  }
  /** A staged scene with optional numbered markers. */
  | { readonly kind: 'scene'; readonly scene: SceneSpec; readonly callouts?: readonly Callout[]; readonly icon?: FigIcon };

export interface FigureBlock {
  readonly k: 'figure';
  /** One short sentence under the picture saying what it shows (may be left out where the picture names itself, e.g. a card). */
  readonly caption?: string;
  /** What a screen reader says for the picture. */
  readonly alt: string;
  readonly show: FigureShow;
}
