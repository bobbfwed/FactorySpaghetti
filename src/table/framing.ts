// When the camera and the piles beside the board move by themselves. Pure, no Three.js.
//
// The camera moves on its own only when a game or replay opens, when the player presses
// Re-centre, after the player turns the table and the board no longer fits the free part of the
// screen, and when something that must be seen would fall outside the view. In that last case
// it re-frames once, with head-room for the next several placements, and never zooms in. The piles
// beside the board are laid out around an area that only grows, in coarse steps, so that a placed
// piece normally moves neither the piles nor the camera.

import type { GameState } from '../engine/state';
import { ACROSS_FLATS, TILE_TOP, containsBounds, unionBounds, type Bounds } from './layout';

/** What the table remembers of the game it showed last, to tell the same game going on from another. */
export interface ShownGame { readonly seed: number; readonly playerCount: number; readonly pieces: number }
export const shownGame = (g: GameState): ShownGame => ({ seed: g.seed, playerCount: g.playerCount, pieces: g.board.length });

/** The most pieces one move takes off the board (Sink Hole takes one). */
const MOST_REMOVED_BY_A_MOVE = 1;

/**
 * Whether showing `next` starts the view afresh (the camera re-frames, the piles are laid out
 * again): the first game shown, another game (another seed or number of players), or a jump back
 * in the same game (a save loaded, a replay going back several moves: more pieces gone than one
 * move can take). Within one game a board one piece smaller is a Sink Hole: the view stays.
 */
export function freshView(before: ShownGame | null, next: GameState): boolean {
  if (!before) return true;
  if (next.seed !== before.seed || next.playerCount !== before.playerCount) return true;
  return next.board.length < before.pieces - MOST_REMOVED_BY_A_MOVE;
}

/** Room the pile area keeps around the board: one tile, so one more tile on any edge fits. */
export const ANCHOR_PAD = ACROSS_FLATS;
/** When the board reaches past the pile area on a side, that side moves out to this far past it. */
export const ANCHOR_STEP = 2 * ACROSS_FLATS;
/** Extra room added on each side a re-frame had to grow. */
export const FRAME_HEADROOM = ACROSS_FLATS;

/**
 * The board area the piles are laid out around. Starts as the board plus ANCHOR_PAD on every
 * side; afterwards it only grows: a side the board reaches past moves out to ANCHOR_STEP past the
 * board, the other sides stay. `prev` null starts afresh.
 */
export function sideAnchor(prev: Bounds | null, board: Bounds): Bounds {
  if (!prev) {
    return { minX: board.minX - ANCHOR_PAD, maxX: board.maxX + ANCHOR_PAD, minZ: board.minZ - ANCHOR_PAD, maxZ: board.maxZ + ANCHOR_PAD };
  }
  if (containsBounds(prev, board)) return prev;
  return {
    minX: board.minX < prev.minX ? board.minX - ANCHOR_STEP : prev.minX,
    maxX: board.maxX > prev.maxX ? board.maxX + ANCHOR_STEP : prev.maxX,
    minZ: board.minZ < prev.minZ ? board.minZ - ANCHOR_STEP : prev.minZ,
    maxZ: board.maxZ > prev.maxZ ? board.maxZ + ANCHOR_STEP : prev.maxZ,
  };
}

export interface FrameCheck {
  /** The table area the camera was last framed to (null: never framed). */
  readonly framed: Bounds | null;
  /** What must be in view now: the board and everything beside it. */
  readonly needed: Bounds;
  /** The board lies inside the free part of the screen with the camera where it is going. */
  readonly boardVisible: boolean;
  /** The whole board could be shown at the furthest the framing may zoom out. */
  readonly boardFits: boolean;
}

/**
 * The area to frame now, or null to leave the camera alone. A re-frame happens when the table
 * grew past the area last framed (then the grown sides get FRAME_HEADROOM more), or when the board
 * is out of view although it could be shown whole (the view was turned, or a panel came up). The
 * new area always contains the old one, so together with CameraRig.frame's noZoomIn the camera
 * never zooms in by itself.
 */
export function reframeArea(c: FrameCheck, headroom = FRAME_HEADROOM): Bounds | null {
  const grew = !c.framed || !containsBounds(c.framed, c.needed);
  const hidden = !c.boardVisible && c.boardFits;
  if (!grew && !hidden) return null;
  if (!c.framed) return c.needed;
  const u = unionBounds(c.framed, c.needed);
  if (!grew) return u;
  return {
    minX: c.needed.minX < c.framed.minX ? u.minX - headroom : u.minX,
    maxX: c.needed.maxX > c.framed.maxX ? u.maxX + headroom : u.maxX,
    minZ: c.needed.minZ < c.framed.minZ ? u.minZ - headroom : u.minZ,
    maxZ: c.needed.maxZ > c.framed.maxZ ? u.maxZ + headroom : u.maxZ,
  };
}

/**
 * What the round "turn the table" button turns the view about. While the player has not panned or
 * zoomed since the camera was last framed, the centre of the area framed then (so the framed
 * content turns in place, in the free part of the screen); otherwise null: the camera turns about
 * the point in the middle of the free part of the screen, whatever the player has put there.
 */
export function turnPivot(framed: Bounds | null, userMoved: boolean): { x: number; z: number } | null {
  if (userMoved || !framed) return null;
  return { x: (framed.minX + framed.maxX) / 2, z: (framed.minZ + framed.maxZ) / 2 };
}

export interface TurnCheck {
  /** The table area the camera was last framed to (null: never framed). */
  readonly framed: Bounds | null;
  /** What must be in view now: the board and everything beside it. */
  readonly needed: Bounds;
  /** The player panned or zoomed since the last framing (turning by the button does not count). */
  readonly userMoved: boolean;
  /** The board lies inside the free part of the screen with the view turned. */
  readonly boardVisible: boolean;
}

/**
 * When a turn of the table has ended: the area to frame again because the board no longer lies
 * inside the free part of the screen (a turned board is wider or taller on the screen), or null to
 * leave the camera alone. A view the player has panned or zoomed is left as they put it.
 */
export function turnRefitArea(c: TurnCheck): Bounds | null {
  if (c.userMoved || c.boardVisible) return null;
  return c.framed ? unionBounds(c.framed, c.needed) : c.needed;
}

/** What framing needs of the camera (CameraRig has it all). */
export interface FramingCamera {
  boxVisible(b: Bounds, top: number): boolean;
  boxFits(b: Bounds, top: number): boolean;
  frame(b: Bounds, animate: boolean, top: number, margin: number, noZoomIn: boolean): void;
}

/** The table as framing sees it: the board, and the board with everything beside it. */
export interface FramingTable {
  readonly board: Bounds;
  readonly needed: Bounds;
  /** Height of the tallest pile (plus what lies on it), included when the piles are framed. */
  readonly stackTop: number;
}

/**
 * Point the camera at `area`. When the screen cannot hold all of it at the furthest the framing
 * may zoom out (a phone held upright), the camera still centres on it as long as the whole board
 * stays in view that way (so the piles are partly in view too); otherwise it frames the board with
 * a tile of room round it, or the board alone, so the board stays in view and as large as allowed.
 */
export function frameArea(cam: FramingCamera, t: FramingTable, area: Bounds, animate: boolean, noZoomIn: boolean, margin = 1.08): void {
  cam.frame(area, animate, t.stackTop, margin, noZoomIn);
  if (cam.boxFits(area, t.stackTop) || cam.boxVisible(t.board, TILE_TOP)) return;
  const near = { minX: t.board.minX - FRAME_HEADROOM, maxX: t.board.maxX + FRAME_HEADROOM, minZ: t.board.minZ - FRAME_HEADROOM, maxZ: t.board.maxZ + FRAME_HEADROOM };
  cam.frame(cam.boxFits(near, TILE_TOP) ? near : t.board, animate, TILE_TOP, margin, noZoomIn);
}

/** Framing at the start (a game or replay opens) and on Re-centre: everything, tightly. */
export function frameAll(cam: FramingCamera, t: FramingTable, animate: boolean): Bounds {
  frameArea(cam, t, t.needed, animate, false);
  return t.needed;
}

/**
 * After the board grew or a panel came or went: move the camera only if something must be seen
 * that would not be (reframeArea), never zooming in. Returns the new framed area, or null when the
 * camera stays.
 */
export function keepInView(cam: FramingCamera, t: FramingTable, framed: Bounds | null): Bounds | null {
  const area = reframeArea({
    framed,
    needed: t.needed,
    boardVisible: cam.boxVisible(t.board, TILE_TOP),
    boardFits: cam.boxFits(t.board, TILE_TOP),
  });
  if (!area) return null;
  frameArea(cam, t, area, true, true);
  return area;
}
