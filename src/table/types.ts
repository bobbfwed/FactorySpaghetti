// Public types of the 3D table (re-exported by src/table/index.ts).

import type { GameState, PieceType } from '../engine/state';
import type { AnimStep } from './transition';

export type PlayerColor = 'blue' | 'red' | 'orange' | 'green';

export const PLAYER_COLOR_HEX: Readonly<Record<PlayerColor, string>> = {
  blue: '#2f6fd6',
  red: '#e0454f',
  orange: '#f08a24',
  green: '#2e9e5b',
};

export type Target =
  | { kind: 'cell'; q: number; r: number }                          // an empty board space
  | { kind: 'piece'; pieceId: string }                               // a placed tile or mine
  | { kind: 'point'; pieceId: string; point: number }                // a connection point
  | { kind: 'buffer'; pieceId: string; buffer: 'input' | 'output' }
  | { kind: 'mineSlot'; pieceId: string; slot: number }
  | { kind: 'belt'; beltId: string }
  | { kind: 'stack'; index: number }
  | { kind: 'deck' };

export interface ViewInsets { top: number; right: number; bottom: number; left: number }

/** How a planned belt is drawn: 'own' solid (belts the player has), 'buy' translucent (could buy now), 'cant' translucent, fading in and out (cannot afford yet). */
export type RouteTier = 'own' | 'buy' | 'cant';
/** One belt of a planned route: on board piece `pieceId`, between connection points `from` and `to`. */
export interface RouteSegment { pieceId: string; from: number; to: number; tier: RouteTier }
/** A player's unconfirmed choice, shown to everyone in that player's colour. */
export type Preview =
  | { k: 'piece'; pieceType: PieceType; q: number; r: number; rotation: number }  // a board piece or mine a player is considering at a space
  | { k: 'meeple'; pieceId: string; slot: 0 | 1 | null };                       // a meeple a player is considering on a building (slot null) or a mine slot

export interface Ghost { pieceType: PieceType; q: number; r: number; rotation: number; valid: boolean }

/** Numbers for performance checks (renderer.info of the last frame, and how long it took). */
export interface TableStats {
  readonly calls: number;
  readonly triangles: number;
  readonly frameMs: number;
  readonly frames: number;
  /** Draw calls / triangles of the visible pass alone (no shadow map), filled in by renderNow(). */
  readonly mainCalls?: number;
  readonly mainTriangles?: number;
}

export interface Table {
  setGame(game: GameState | null): void;            // full state every time; snaps to it (ends any animated transition)
  // ── Animated transitions (N8) ──
  /**
   * Show `game` like setGame, but play the change from the state shown now: the table steps of
   * `steps` (from planTransition(shown, game, events) in ./transition) at their times multiplied
   * by `scale` (1 = Normal speed, 0.5 = Fast; the playback queue also compresses). Steps the table
   * does not draw (toPlayer / fromPlayer, drawn by the interface) are ignored. The canvas renders
   * every frame until the transition ends, then stops again (rendering stays on demand).
   * A later setGame, animateTo or finishAnimation ends the transition at once.
   */
  animateTo(game: GameState, steps: readonly AnimStep[], scale?: number): void;
  /** Jump the transition playing (if any) to its end. */
  finishAnimation(): void;
  /** True while an animated transition is playing. */
  isAnimating(): boolean;
  /** Called when a transition ends (played out, finished early, or replaced). */
  onAnimationEnd(fn: () => void): () => void;
  // ── ──
  setPlayerColors(colors: readonly PlayerColor[]): void;   // index = engine player id
  setTargets(targets: readonly Target[], color: PlayerColor): void;  // soft glow on everything the player may touch
  setGhost(ghost: Ghost | null): void;              // translucent preview of a tile about to be placed
  /** A planned belt route in the player's colour. 'own' = solid (belts the player has); 'buy' = translucent (belts the player could buy now); 'cant' = translucent and slowly fading in and out (cannot afford yet). null clears it. */
  setRoute(segments: readonly RouteSegment[] | null, color: PlayerColor): void;
  /** A player's unconfirmed choice, shown to everyone in that player's colour. Changes are animated: a piece lifts from the revealed pile (or glides from where it was last previewed) to the space and turns to the rotation; a meeple drops in from above the first time (as if leaving the player's supply) and hops from its previous preview spot after that. null removes it (the piece returns to the pile; the meeple lifts away). playerId is the engine player id (same index as setPlayerColors). */
  setPreview(playerId: number, preview: Preview | null): void;
  onPick(fn: (hit: Target | null, ev: { x: number; y: number }) => void): () => void;  // tap/click
  screenPosition(of: Target): { x: number; y: number } | null;      // canvas-relative CSS pixels, for HTML popovers
  rotateBy(steps: number): void;                    // 60-degree steps, animated
  recenter(): void;                                 // frame the whole board
  setTopDown(on: boolean): void;
  resize(): void;
  dispose(): void;
  /**
   * The part of the canvas not covered by HTML panels (CSS pixels from each edge), and the smallest
   * size a board tile may be drawn at when framing. Re-centring frames the board inside that area.
   */
  setViewport(insets: ViewInsets, opts?: { minTilePx?: number }): void;
  /** Called after every drawn frame (camera moves, zoom, re-render), e.g. to move HTML anchored to pieces. */
  onFrame(fn: () => void): () => void;
  // ── Additions (development aids) ──
  /** Draw a small marker on every connection point, coloured by engine role. */
  setDebugPoints(on: boolean): void;
  /** Draw calls / triangles of the last frame and its CPU time. */
  stats(): TableStats;
  /** Draw one frame now (synchronously) — for screenshots and measurements. */
  renderNow(): void;
}

export interface TableOptions {
  /** Folder holding manifest.json and the .glb files, relative to the page. Default './models'. */
  modelsBase?: string;
}
