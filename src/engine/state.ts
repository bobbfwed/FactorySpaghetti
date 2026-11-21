// GameState and all supporting types.
// All interfaces use readonly fields — applyAction() returns new state, never mutates.

import type { PieceType, Material, CardType } from './config';
import type { RngState } from './rng';

export type { PieceType, Material, CardType, RngState };

export type PlayerId = 0 | 1 | 2 | 3;

// Axial hex coordinates (flat-top or pointy-top — renderer decides orientation).
export interface HexCoord {
  readonly q: number;
  readonly r: number;
}

// A single buffer (input or output) on a board piece.
// slots.length = number of material slots (e.g., 2 for Sphere factory input).
// null in a slot means the slot is empty.
export interface Buffer {
  readonly slots: ReadonlyArray<Material | null>;
  readonly teleporterOwner: PlayerId | null; // set when a teleporter is placed here
}

// A piece that has not yet been placed on the board (sits in a stack or mine pool).
// Rotation is not tracked here — players freely choose orientation when placing.
export interface UnplacedPiece {
  readonly id: string;
  readonly type: PieceType;
}

// A piece sitting on the hex grid.
// claims: each entry is one Control Module placed on this building (≤3 per player).
// input: null for mines (no input) and blanks (no buffers).
// output: null for power plants (tokens go to inventory) and blanks.
// rotation: 0–5 (60° steps clockwise). For single-hex pieces, maps edge 0 to this
//   hex direction. For mines (2-hex), the secondary hex occupies this neighbour.
//   Absent means 0.
export interface BoardPiece {
  readonly id: string;
  readonly type: PieceType;
  readonly coord: HexCoord;
  readonly rotation?: number;
  readonly claims: ReadonlyArray<{
    readonly ownerId: PlayerId;
    readonly controlModule: number;
  }>;
  readonly input: Buffer | null;
  readonly output: Buffer | null;
}

// One of the three face-down stacks.
// Stack 0 is available from game start.
// Stacks 1 and 2 unlock when mines 2 and 3 respectively enter play.
export interface PieceStack {
  readonly index: 0 | 1 | 2;
  readonly available: boolean;
  readonly pieces: ReadonlyArray<UnplacedPiece>; // index 0 = top of stack
}

export interface Player {
  readonly id: PlayerId;
  readonly controlModules: ReadonlyArray<number>; // unplaced modules (1–18 at game start)
  readonly meepleOnPieceId: string | null;        // null = not yet placed this round
  readonly meepleSlotIndex: number | null;        // 0=resource,1=upgrade for mines; null otherwise
  readonly powerTokens: number;
  readonly inventory: Readonly<Record<Material, number>>;
  readonly beltsRemaining: number;
  readonly teleportersRemaining: number;
  readonly hand: ReadonlyArray<CardType>;
  readonly bonusTesseracts: Readonly<{
    investor: boolean;
    beltWeaver: boolean;
    factoryEmpire: boolean;
  }>;
  // Credits given at end of each round (= mineCount); usable to raise ONE in-play module.
  readonly freeUpgradesRemaining: number;
  // Which building received free upgrade credits this round (null = none yet).
  // All free credits in a round must go to the same building.
  readonly freeUpgradePieceId: string | null;
  // Credits from mine slot 1 (mineCount+1 per trigger). Spend on:
  //   • 1 free claim (cost = controlModule − mineCount + 1, max once per trigger)
  //   • free upgrades (1 credit per module step, any building)
  readonly freeActionCredits: number;
  // True once a free claim has been used from freeActionCredits this round.
  readonly freeClaimUsed: boolean;
  // True once this player has operated their meeple building during the current
  // roundEnd phase — a building may be operated at most once per round end.
  readonly meepleOperatedThisRound: boolean;
  // Cumulative per-game tallies for the end-of-game stats screen (not used by any rule).
  // Everything else on the stats screen is derived from live state; these three count events
  // that leave no trace (cards leave the hand, upgrades overwrite the module).
  readonly stats: {
    readonly cardsPurchased: number; // BUY_CARD draws
    readonly cardsPlayed: number;    // cards resolved (explicit PLAY_CARD + play-on-draw)
    readonly modulesUpgraded: number; // UPGRADE_BUILDING actions
  };
}

// A belt token placed by a player on a board piece, linking two perimeter
// connection points. fromPoint and toPoint are 0-indexed positions on the
// piece's 12-point grid (doc #N → index N-1).
export interface Belt {
  readonly id: string;
  readonly ownerId: PlayerId;
  readonly pieceId: string;
  readonly fromPoint: number;
  readonly toPoint: number;
}

// A factory activated by a roll and awaiting its OWNER's decision to operate or skip.
// Every player whose factory matched the roll gets an entry (not just the active player),
// so a roll on anyone's turn never spends your power/materials without your consent.
export interface PendingFactoryOp {
  readonly pieceId: string;
  readonly ownerId: PlayerId;
}

export type TurnPhase =
  | 'setupClaimPF'  // setup S7a: each player claims a Plate Factory (round-robin)
  | 'setupClaimPP'  // setup S7b: each player claims a Power Plant (reverse round-robin)
  | 'placePiece'    // step 1: place a board piece from an available stack
  | 'roll'          // step 2: roll dice (N dice = N mines), resolve production
  | 'actions'       // step 3: buy/place belts, cards, mines, teleporters, exchange
  | 'placeMeeple'   // step 4: place meeple on owned building or mine upgrade point
  | 'roundEnd';     // end-of-round: free upgrades, rotate start player

export interface GameState {
  readonly seed: number;
  readonly rng: RngState;
  readonly playerCount: 2 | 3 | 4;
  readonly players: ReadonlyArray<Player>;
  readonly board: ReadonlyArray<BoardPiece>;
  readonly stacks: readonly [PieceStack, PieceStack, PieceStack];
  // Mines 2 and 3 before they are placed (either auto-drop or purchased).
  readonly unplacedMines: ReadonlyArray<UnplacedPiece>;
  readonly mineCount: number;             // mines currently on the board (starts at 1)
  readonly globalTeleporterCount: number; // ever-placed teleporters across all players (for pricing)
  readonly cardDeck: ReadonlyArray<CardType>;
  readonly cardDiscard: ReadonlyArray<CardType>;
  readonly turnOrder: ReadonlyArray<PlayerId>;
  readonly activePlayerIndex: number; // index into turnOrder
  readonly round: number;             // 1-indexed
  readonly phase: TurnPhase;
  readonly lastRoll: ReadonlyArray<number> | null; // dice values from most recent ROLL_DICE
  readonly belts: ReadonlyArray<Belt>;
  // True once a belt touching a mine is placed this turn; resets at turn start.
  readonly mineBeltPlacedThisTurn: boolean;
  // IDs of belts placed during the current actions phase (enables bulk undo).
  readonly beltsPlacedThisTurn: ReadonlyArray<string>;
  // Mines that have been auto-dropped but not yet physically placed on the board.
  // When non-empty, the player must use PLACE_MINE (not PLACE_PIECE) in the placePiece phase.
  readonly pendingMineIds: ReadonlyArray<string>;
  // The stack the active player drew from in this place-a-piece step (DRAW_PIECE), whose top
  // piece they must now place; null before the draw. Only set in the placePiece phase, and
  // only when more than one stack was open. Saves from before the draw step have no field:
  // read it as `state.drawnStackIndex ?? null` (rules/pieces.ts drawnStack).
  readonly drawnStackIndex?: 0 | 1 | 2 | null;
  // Factories (any owner) that matched the roll and await their owner's operate/skip choice.
  // Populated on ROLL_DICE; must be emptied (each entry OPERATEd or SKIPped, by its owner)
  // before the active player may END_ACTIONS. Power plants are exempt (they auto-operate).
  readonly pendingFactoryOps: ReadonlyArray<PendingFactoryOp>;
  // ── Per-turn card tracking ────────────────────────────────────────────────────
  // Incremented each time a non-play-on-draw card is played; max 2 per turn.
  readonly cardsPlayedThisTurn: number;
  // Pieces drawn by Overstock Supplies (play-on-draw) awaiting placement via PLACE_OVERSTOCK_PIECE.
  readonly overstockPieces: ReadonlyArray<UnplacedPiece>;
  // Remaining Control Module upgrade-units from Production Increase this turn (0 = card not
  // active). Claims cost (module − mineCount + 1) and upgrades cost (new − old), drawn from
  // this budget; never paid with materials.
  readonly productionIncreaseBudget: number;
  // Production Increase allows at most 1 CLAIM regardless of remaining budget.
  readonly productionIncreaseClaimedThisTurn: boolean;
  // ── End-game ──────────────────────────────────────────────────────────────────
  // gameOver: true once the game has ended (either win condition).
  // winner: set to the winning PlayerId on an outright win; null if tied or ongoing.
  // tiedWinners: populated on a shared-win board-exhaustion result.
  // gameOverReason: 'tesseracts' = 4-Tesseract win; 'boardExhausted' = point win.
  readonly gameOver: boolean;
  readonly winner: PlayerId | null;
  readonly tiedWinners: ReadonlyArray<PlayerId>;
  readonly gameOverReason: 'tesseracts' | 'boardExhausted' | null;
}
