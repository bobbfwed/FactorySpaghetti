// Public types of the 3D table (re-exported by src/table/index.ts).

import type { GameState, PieceType } from '../engine/state';

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
  setGame(game: GameState | null): void;            // full state every time; the table works out what changed
  setPlayerColors(colors: readonly PlayerColor[]): void;   // index = engine player id
  setTargets(targets: readonly Target[], color: PlayerColor): void;  // soft glow on everything the player may touch
  setGhost(ghost: Ghost | null): void;              // translucent preview of a tile about to be placed
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
