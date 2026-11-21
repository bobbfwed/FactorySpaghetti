// PLACE_PIECE action handler + hex-grid utilities.

import type { GameState, BoardPiece, HexCoord, Buffer, PieceStack } from '../state';
import type { PlacePieceAction, RulesError } from '../actions';
import type { PieceType, Material } from '../config';

export type ActionResult =
  | { ok: true; state: GameState }
  | { ok: false; error: RulesError };

// ── Hex-grid helpers ──────────────────────────────────────────────────────────

const HEX_DIRECTIONS: ReadonlyArray<HexCoord> = [
  { q: 1, r: 0 }, { q: -1, r: 0 },
  { q: 0, r: 1 }, { q: 0, r: -1 },
  { q: 1, r: -1 }, { q: -1, r: 1 },
];

export function hexNeighbours(coord: HexCoord): HexCoord[] {
  return HEX_DIRECTIONS.map(d => ({ q: coord.q + d.q, r: coord.r + d.r }));
}

export function hexEqual(a: HexCoord, b: HexCoord): boolean {
  return a.q === b.q && a.r === b.r;
}

// Secondary hex of a 2-hex mine: primary + HEX_DIRECTIONS[rotation % 6].
export function mineSecondaryCoord(primary: HexCoord, rotation: number): HexCoord {
  const dir = HEX_DIRECTIONS[rotation % HEX_DIRECTIONS.length]!;
  return { q: primary.q + dir.q, r: primary.r + dir.r };
}

// All hexes considered "occupied": primary coords + secondary hexes of placed mines.
function allOccupiedCoords(board: ReadonlyArray<BoardPiece>): ReadonlyArray<HexCoord> {
  const coords: HexCoord[] = [];
  for (const p of board) {
    coords.push(p.coord);
    if (p.type === 'mine') coords.push(mineSecondaryCoord(p.coord, p.rotation ?? 0));
  }
  return coords;
}

export function isCoordsOccupied(coord: HexCoord, board: ReadonlyArray<BoardPiece>): boolean {
  return allOccupiedCoords(board).some(c => hexEqual(c, coord));
}

export function isAdjacentToBoard(coord: HexCoord, board: ReadonlyArray<BoardPiece>): boolean {
  const occupied = allOccupiedCoords(board);
  return HEX_DIRECTIONS.some(d =>
    occupied.some(c => c.q === coord.q - d.q && c.r === coord.r - d.r),
  );
}

// ── Buffer factory ────────────────────────────────────────────────────────────

function makeBuffer(slotCount: number): Buffer {
  return {
    slots: new Array<Material | null>(slotCount).fill(null),
    teleporterOwner: null,
  };
}

export function makeBuffers(type: PieceType): { input: Buffer | null; output: Buffer | null } {
  switch (type) {
    case 'mine':          return { input: null,          output: makeBuffer(1) };
    case 'plateFact':     return { input: makeBuffer(1), output: makeBuffer(1) };
    case 'sphereFact':    return { input: makeBuffer(2), output: makeBuffer(1) };
    case 'tesseractFact': return { input: makeBuffer(3), output: makeBuffer(1) };
    case 'powerPlant':    return { input: makeBuffer(1), output: null };
    case 'blank':         return { input: null,          output: null };
  }
}

// ── PLACE_PIECE ───────────────────────────────────────────────────────────────

export function applyPlacePiece(state: GameState, action: PlacePieceAction): ActionResult {
  if (state.phase !== 'placePiece') {
    return err('WRONG_PHASE', `Expected placePiece phase, got ${state.phase}`);
  }

  // A pending auto-dropped mine must be placed first (PLACE_MINE action).
  if (state.pendingMineIds.length > 0) {
    return err('PENDING_MINE', 'Place the auto-dropped mine before placing a board piece');
  }

  const { stackIndex, coord } = action;
  const stack = state.stacks[stackIndex];

  if (!stack.available) {
    return err('STACK_LOCKED', `Stack ${stackIndex} is not yet available`);
  }

  if (stack.pieces.length === 0) {
    return err('STACK_EMPTY', `Stack ${stackIndex} is empty`);
  }

  if (isCoordsOccupied(coord, state.board)) {
    return err('COORD_OCCUPIED', `${coord.q},${coord.r} is already occupied`);
  }

  if (!isAdjacentToBoard(coord, state.board)) {
    return err('NOT_ADJACENT', `${coord.q},${coord.r} is not adjacent to any board piece`);
  }

  const unplaced = stack.pieces[0]!; // stack.pieces.length > 0 checked above
  const { input, output } = makeBuffers(unplaced.type);

  const newPiece: BoardPiece = {
    id: unplaced.id,
    type: unplaced.type,
    coord,
    rotation: action.rotation ?? 0, // player freely chooses orientation at placement
    claims: [],
    input,
    output,
  };

  const newStack: PieceStack = {
    ...stack,
    pieces: stack.pieces.slice(1), // ReadonlyArray<UnplacedPiece> accepts UnplacedPiece[]
  };

  let updatedStacks: readonly [PieceStack, PieceStack, PieceStack] = [
    stackIndex === 0 ? newStack : state.stacks[0],
    stackIndex === 1 ? newStack : state.stacks[1],
    stackIndex === 2 ? newStack : state.stacks[2],
  ];

  // Auto-drop: if the stack just became empty and there are unplaced mines, the
  // next mine drops immediately (enters pendingMineIds) and its stack unlocks.
  let pendingMineIds = state.pendingMineIds;
  let unplacedMines = state.unplacedMines;

  if (newStack.pieces.length === 0 && unplacedMines.length > 0) {
    const droppedMine = unplacedMines[0]!;
    unplacedMines = unplacedMines.slice(1);
    pendingMineIds = [...pendingMineIds, droppedMine.id];
    // Stack unlock for auto-drop: mine 2 drop → unlock stacks[1]; mine 3 → stacks[2]
    const dropsRemaining = unplacedMines.length; // how many are still unplaced after this drop
    if (dropsRemaining === 1) {
      // We just dropped mine 2 (one more remains)
      updatedStacks = [updatedStacks[0], { ...updatedStacks[1], available: true }, updatedStacks[2]];
    } else if (dropsRemaining === 0) {
      // We just dropped mine 3 (none remain)
      updatedStacks = [updatedStacks[0], updatedStacks[1], { ...updatedStacks[2], available: true }];
    }
  }

  const newState: GameState = {
    ...state,
    board: [...state.board, newPiece],
    stacks: updatedStacks,
    unplacedMines,
    pendingMineIds,
    phase: 'roll',
  };

  return { ok: true, state: newState };
}

function err(code: string, message: string): { ok: false; error: RulesError } {
  return { ok: false, error: { code, message } };
}
