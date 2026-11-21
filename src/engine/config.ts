// All tunables live here as data. Logic in rules/ never hardcodes these values.

// ── Domain types (define what the game has) ──────────────────────────────────

export type PieceType =
  | 'mine'
  | 'plateFact'
  | 'sphereFact'
  | 'tesseractFact'
  | 'powerPlant'
  | 'blank';

export type Material = 'ore' | 'plate' | 'sphere' | 'tesseract';

export type CardType =
  | 'scoutingDrone'
  | 'shortSale'
  | 'embezzlement'
  | 'sinkHole'
  | 'overstockSupplies'
  | 'netSurplusSellOff'
  | 'changingPriorities'
  | 'productionIncrease'
  | 'mineInspection'
  | 'personalJetPack'
  | 'assetForfeiture'
  | 'rdTaxWriteOff'
  | 'solarFlare';

// ── Board piece counts ────────────────────────────────────────────────────────

export const TOTAL_PIECES = 99;
export const MINE_COUNT = 3;

export const PIECE_COUNTS: Record<PieceType, number> = {
  mine: 3,
  plateFact: 19,
  sphereFact: 13,
  tesseractFact: 9,
  powerPlant: 12,
  blank: 43,
};

// Non-mine pieces distributed across 3 stacks, per player count (rulebook tables).
// Stacks 1 and 2 (indices 1, 2) are blocked until their respective mine drops.
// The pool scales with player count — fewer players use fewer pieces (2p: 63, 3p: 81,
// 4p: 96) — which keeps games from running too long at low counts while naturally
// shortening them at high counts.
export interface StackComposition {
  plateFact: number;
  sphereFact: number;
  tesseractFact: number;
  powerPlant: number;
  blank: number;
}

export const STACK_COMPOSITION: Record<2 | 3 | 4, [StackComposition, StackComposition, StackComposition]> = {
  2: [
    { plateFact: 6, sphereFact: 3, tesseractFact: 0, powerPlant: 3, blank: 9 },  // 21 pieces
    { plateFact: 4, sphereFact: 3, tesseractFact: 3, powerPlant: 3, blank: 8 },  // 21
    { plateFact: 3, sphereFact: 3, tesseractFact: 3, powerPlant: 2, blank: 10 }, // 21
  ],
  3: [
    { plateFact: 8, sphereFact: 3, tesseractFact: 0, powerPlant: 4, blank: 12 }, // 27 pieces
    { plateFact: 5, sphereFact: 4, tesseractFact: 3, powerPlant: 3, blank: 12 }, // 27
    { plateFact: 3, sphereFact: 3, tesseractFact: 4, powerPlant: 3, blank: 14 }, // 27
  ],
  4: [
    { plateFact: 9, sphereFact: 4, tesseractFact: 0, powerPlant: 5, blank: 14 }, // 32 pieces
    { plateFact: 6, sphereFact: 5, tesseractFact: 4, powerPlant: 4, blank: 13 }, // 32
    { plateFact: 4, sphereFact: 4, tesseractFact: 5, powerPlant: 3, blank: 16 }, // 32
  ],
};

// ── Material values & caps ────────────────────────────────────────────────────

export const MATERIAL_VALUES: Record<Material, number> = {
  ore: 1,
  plate: 3,
  sphere: 7,
  tesseract: 23,
};

export const INVENTORY_CAP = 6;
export const POWER_TOKEN_CAP = 10;

// When a roll activates a player's factory, they're prompted to operate or skip. If they
// don't decide within this window (multiplayer courtesy so one player can't stall the table),
// the choice defaults to OPERATE (when affordable). Host-adjustable; default 8 seconds.
export const FACTORY_OP_TIMEOUT_MS = 8000;

// A player's round-end turn (claiming buildings / upgrading Control Modules) is time-limited
// so an idle player can't stall the table; on expiry their round-end turn auto-ends. The
// timer resets on each action, so an actively-playing player is never cut off. Default 20 s.
export const ROUND_END_TIMEOUT_MS = 20000;

// ── Starting per-player components ───────────────────────────────────────────

export const STARTING_POWER_TOKENS = 3;
export const BELT_COUNT = 5;
export const TELEPORTER_COUNT = 4;
export const CONTROL_MODULE_MAX = 18; // modules numbered 1–18

// ── Limits and goal ───────────────────────────────────────────────────────────

export const MAX_CARDS_PLAYED_PER_TURN = 2;  // Leverage cards played per turn (play-on-draw cards excepted)
export const MAX_CLAIMS_PER_BUILDING = 3;    // one player's Control Modules on one building
export const TESSERACTS_TO_WIN = 4;          // Tesseracts (bonus cards count) shown on your own turn

// Pieces pulled from stack 0 for each player during S5 of setup.
export const STARTING_PIECES_PER_PLAYER: Partial<Record<PieceType, number>> = {
  powerPlant: 1,
  plateFact: 1,
  blank: 2,
};

// ── Prices ────────────────────────────────────────────────────────────────────

// Mine purchase costs; index 0 = 2nd mine, index 1 = 3rd mine.
export const MINE_COSTS: [number, number] = [6, 18];
export const BELT_COST = 1;

// Card price: #mines currently on board + 1 (formula tunable — RULES_CHANGES.md #14).
export const cardCost = (mineCount: number): number => mineCount + 1;

// Teleporter price: teleporters ever placed (all players) + 1, paid exactly.
export const teleporterCost = (placedSoFar: number): number => placedSoFar + 1;

// Production Increase grants this many Control Module upgrade-units to spend this turn
// (claims and upgrades draw from this budget; never paid with materials). Tunable.
export const PRODUCTION_INCREASE_BUDGET = 4;

// Cards that resolve immediately on purchase (never enter hand; don't count toward 2/turn limit).
// OQ-4 default: play-on-draw does NOT count against the 2-cards-per-turn play limit.
export const PLAY_ON_DRAW_CARDS: ReadonlySet<CardType> = new Set<CardType>([
  'overstockSupplies',
  'mineInspection',
  'solarFlare',
]);

// ── Leverage card counts ──────────────────────────────────────────────────────

export const CARD_COUNTS: Record<CardType, number> = {
  scoutingDrone: 6,
  shortSale: 4,
  embezzlement: 2,
  sinkHole: 6,
  overstockSupplies: 6,
  netSurplusSellOff: 4,
  changingPriorities: 6,
  productionIncrease: 6,
  mineInspection: 6,
  personalJetPack: 4,
  assetForfeiture: 4,
  rdTaxWriteOff: 4,
  solarFlare: 4,
};

// ── Production ────────────────────────────────────────────────────────────────

// Power Plant yield — the TOTAL tokens produced per the 1/2/5/10 chart in RULES.md.
// Tesseract may NOT be used in a Power Plant.
export const POWER_PLANT_BASE_YIELD = 1;                    // no material consumed
export const POWER_PLANT_MATERIAL_YIELD: Record<Exclude<Material, 'tesseract'>, number> = {
  ore: 2,   // chart row 2
  plate: 5, // chart row 5
  sphere: 10, // chart row 10
};

// Factory power cost per input consumed (Plate=1, Sphere=2, Tesseract=3).
export const FACTORY_POWER_COST: Record<Exclude<Material, 'ore'>, number> = {
  plate: 1,
  sphere: 2,
  tesseract: 3,
};

// ── Factory recipes (the single source of truth for inputs & products) ─────────
// Each factory's valid input sets, listed exactly (rulebook). `inputs` entries are
// sorted ascending by material value so they can be compared as multisets. This table
// governs BOTH what may be loaded into an input buffer and what allows a factory to
// operate — see production.ts (factoryProduct / canLoadMaterial). Power Plants are not
// here: they consume at most one ore/plate/sphere for tokens (POWER_PLANT_MATERIAL_YIELD)
// and can also run with no input, so their "recipe" is any single valid material.
export interface FactoryRecipeSet {
  readonly product: Material;
  readonly inputs: ReadonlyArray<ReadonlyArray<Material>>;
}
export const FACTORY_RECIPES: Partial<Record<PieceType, FactoryRecipeSet>> = {
  plateFact: {
    product: 'plate',
    inputs: [['ore']],
  },
  sphereFact: {
    product: 'sphere',
    inputs: [
      ['ore', 'plate'],
      ['plate', 'plate'],
    ],
  },
  tesseractFact: {
    product: 'tesseract',
    inputs: [
      ['ore', 'plate', 'sphere'],
      ['ore', 'sphere', 'sphere'],
      ['plate', 'sphere', 'sphere'],
      ['sphere', 'sphere', 'sphere'],
      ['plate', 'plate', 'sphere'],
    ],
  },
};

// Materials a Power Plant may consume (each on its own) for extra tokens.
export const POWER_PLANT_INPUTS: ReadonlyArray<Material> = ['ore', 'plate', 'sphere'];

// ── Bonus Tesseracts ──────────────────────────────────────────────────────────

export const bonusesEnabled = true;

export const BONUS_THRESHOLDS = {
  investor: 10,     // highest claiming Control Module must be ≥ this
  beltWeaver: 8,    // longest valid belt chain must have ≥ this many belts
  factoryEmpire: 6, // most distinct claimed buildings must be ≥ this
} as const;

// ── Smart-bot evaluation weights (bots/evaluateState.ts) ──────────────────────
// Importance multipliers for the state-evaluation features the smart bot scores
// candidate moves with. Tuning the bot = changing these numbers and re-running
// the simulator, never rewriting logic. Features are added one milestone at a
// time (see CLAUDE.md "Smart Bot Creation"); only the implemented ones appear.
export const BOT_WEIGHTS = {
  // Tesseracts toward the 4-Tesseract win. Non-linear and dominant: closing the
  // last gap matters far more than the first Tesseract.
  winProgress: 100,
  // Expected per-roll output value of owned buildings: P(module rolled | dice
  // count) × value produced, summed over claims. Rewards claiming/upgrading
  // buildings whose module fits the current dice-sum distribution.
  production: 6,
  // Value of material sitting in my output buffers (collectable next round). Below
  // inventoryValue so OPERATE_BUILDING pays off yet COLLECT stays a net gain.
  bufferedOutput: 0.06,
  // Value my meeple is positioned to harvest this round (collect + operate-then-
  // collect, or a mine resource). Steers meeple placement; kept small (with
  // bufferedOutput, the sum stays under inventoryValue so collecting is positive).
  meepleHarvest: 0.03,
  // Value of retained cheap-claim capacity (low control modules). Makes the bot claim
  // selectively — fewer, stronger buildings — and save cheap modules for the late,
  // high-value Tesseract-factory claim instead of burning them on early buildings.
  // Weight 4 chosen by sweep: ~80% vs the prior bot (same-seed control ~43%); 6 adds nothing.
  claimReserve: 4,
  // Power income of the best owned power plant. The bot is chronically power-starved
  // (can't run Tesseract conversions), so this drives it to upgrade its power plant onto
  // a hittable number. Weight 22 from a multi-seed sweep (step-function: ~91% vs prior
  // bot, control ~36%); the curve plateaus past ~20, so 22 sits safely on the peak.
  power: 22,
  // Inventory value — materials are fuel, not the goal, so a small weight
  // discounts it. Mirrors the board-exhaustion tiebreak's resource metric.
  inventoryValue: 0.1,
} as const;

// ── Piece connection-point geometry ──────────────────────────────────────────
//
// Every single-hex piece shares a 12-position perimeter grid: 2 equidistant
// points per edge, 6 edges → 12 positions (clockwise from position 0).
// Double-hex pieces (mine) use positions 0–11 for hex 0 and 12–23 for hex 1.
//
// When two adjacent hexes share an edge their 2 positions on that edge align
// with the neighbour's 2 positions on the opposite-facing edge (reversed order)
// — this is how material moves between pieces without explicit "bridge" logic.
//
// Piece types differ only by which positions are active and what role each plays.
// All 12 (or 24) positions are always present; disabled means nothing attaches.

// Role of each position on a piece's perimeter grid.
export type PointRole =
  | 'belt'          // belt connection point — belts may start/end here
  | 'input_buffer'  // material intake for a building (one per input slot)
  | 'output_buffer' // material output for a building (one per output slot)
  | 'ore_output'    // mine ore exit point (material flows to aligned belt/input)
  | 'disabled';     // grid position exists but nothing attaches here

export interface PointDef {
  readonly position: number; // 0–11 for single hex; 0–11 hex 0, 12–23 hex 1 for mine
  readonly role: PointRole;
  // Flip enabled: false to deactivate a point during playtesting — no code change needed.
  readonly enabled: boolean;
}

export interface MeepleSlot {
  readonly type: 'resource' | 'upgrade';
}

// Full layout descriptor for one piece type. Rules code reads a placed piece's layout with
// pieceTemplate(piece) (PIECE_TEMPLATES by type; each mine by id, MINE_TEMPLATES);
// nothing in rules/ hardcodes positions or roles.
export interface PieceTemplate {
  readonly kind: PieceType;
  readonly hexCount: 1 | 2;
  readonly points: ReadonlyArray<PointDef>;
  readonly meepleSlots?: ReadonlyArray<MeepleSlot>;
}


// Build all 12 PointDefs for a single-hex piece from individual position roles.
// Confirmed physical geometry — pointy-top hex (left/right edges are vertical):
//   Position 0 (#1 in game docs) = left edge, lower point; clockwise, 2 per edge.
//   Edges in order: left(0-1) → upper-left(2-3) → upper-right(4-5)
//                 → right(6-7) → lower-right(8-9) → lower-left(10-11)
//   Game docs use 1-indexed #1–#12; code uses 0-indexed (doc #N → index N-1).
function points12(
  r: readonly [PointRole, PointRole, PointRole, PointRole, PointRole, PointRole,
               PointRole, PointRole, PointRole, PointRole, PointRole, PointRole],
): ReadonlyArray<PointDef> {
  return r.map((role, i) => ({ position: i, role, enabled: role !== 'disabled' }));
}

// Per-edge builder used only for mine helpers where both positions on an edge share a role.
function singleHexPoints(
  roles: readonly [PointRole, PointRole, PointRole, PointRole, PointRole, PointRole],
): PointDef[] {
  return roles.flatMap((role, edge) => [
    { position: edge * 2,     role, enabled: true },
    { position: edge * 2 + 1, role, enabled: true },
  ]);
}

// Mine hex 0: rich side.  Internal edge 0 disabled; 5 external edges × 2 ore_output.
function mineHex0Points(): PointDef[] {
  return singleHexPoints([
    'disabled',
    'ore_output', 'ore_output', 'ore_output', 'ore_output', 'ore_output',
  ]);
}

// Mine hex 1: lean side.  Position IDs 12–23. Only the listed positions are ore outputs;
// every other lean-hex position is disabled. Edge 3 (positions 18, 19) is internal (toward
// hex 0) and is always disabled. (adjAt uses the matching mine edge convention so flow
// lines up with the drawn points.)
function mineHex1Points(oreOutputs: ReadonlyArray<number>): PointDef[] {
  return Array.from({ length: 12 }, (_, i) => {
    const position = 12 + i;
    const role: PointRole = oreOutputs.includes(position) ? 'ore_output' : 'disabled';
    return { position, role, enabled: role !== 'disabled' };
  });
}

// Which mine is which: setup gives the three mines these ids (mine 1 starts on the board,
// mines 2 and 3 cover stacks 2 and 3).
export type MineId = 'mine-1' | 'mine-2' | 'mine-3';

// Ore outputs on each mine's LEAN (second) hex, per the printed pieces (RULES_CHANGES.md #32).
// Mine 1's lean hex has the two curved tracks ending at 15, 17, 23 — in the designer's
// numbering (counting from the shared edge) positions #4, #8, #12, every-other external
// edge. Mines 2 and 3 have nothing printed on their lean hex, so ore leaves them only from
// the rich hex. Tunable: list positions 12–23 (never 18 or 19, the shared edge).
export const MINE_LEAN_ORE_OUTPUTS: Readonly<Record<MineId, ReadonlyArray<number>>> = {
  'mine-1': [15, 17, 23],
  'mine-2': [],
  'mine-3': [],
};

// ── PIECE_TEMPLATES ───────────────────────────────────────────────────────────
// Single source of truth for all piece geometry.
// Position numbering: see points12() above.
// Rotation maps the position-0 edge to an absolute hex direction at placement time.

export const PIECE_TEMPLATES: Record<PieceType, PieceTemplate> = {

  // ── Blank ───────────────────────────────────────────────────────────────────
  // All 12 positions are belt points — pure routing piece.
  blank: {
    kind: 'blank', hexCount: 1,
    points: points12(['belt','belt','belt','belt','belt','belt','belt','belt','belt','belt','belt','belt']),
  },

  // Building pieces: every hole on the printed piece that is not an input or output is a
  // belt point any player may use, whoever has claimed the building (RULES_CHANGES.md #30).
  // Hole positions measured from the models (public/models, converted from the designer's
  // AMS print file); src/engine/__tests__/pieceModels.test.ts fails if they ever disagree.

  // ── Plate Factory ───────────────────────────────────────────────────────────
  // #1=input · #8=output · #3,#4,#5,#6,#9,#10,#11,#12=belt · #2,#7 no hole
  plateFact: {
    kind: 'plateFact', hexCount: 1,
    points: points12([
      'input_buffer', 'disabled',      // #1, #2  (left edge)
      'belt',         'belt',           // #3, #4  (upper-left edge)
      'belt',         'belt',           // #5, #6  (upper-right edge)
      'disabled',     'output_buffer',  // #7, #8  (right edge)
      'belt',         'belt',           // #9, #10 (lower-right edge)
      'belt',         'belt',           // #11, #12 (lower-left edge)
    ]),
  },

  // ── Sphere Factory ──────────────────────────────────────────────────────────
  // #1,#3=input · #8=output · #4,#5,#6,#10,#11,#12=belt · #2,#7,#9 no hole
  sphereFact: {
    kind: 'sphereFact', hexCount: 1,
    points: points12([
      'input_buffer', 'disabled',      // #1, #2  (left edge)
      'input_buffer', 'belt',           // #3, #4  (upper-left edge)
      'belt',         'belt',           // #5, #6  (upper-right edge)
      'disabled',     'output_buffer',  // #7, #8  (right edge)
      'disabled',     'belt',           // #9, #10 (lower-right edge)
      'belt',         'belt',           // #11, #12 (lower-left edge)
    ]),
  },

  // ── Tesseract Factory ───────────────────────────────────────────────────────
  // #1,#3,#12=input · #8=output · #4,#5,#10,#11=belt · #2,#6,#7,#9 no hole
  tesseractFact: {
    kind: 'tesseractFact', hexCount: 1,
    points: points12([
      'input_buffer', 'disabled',      // #1, #2  (left edge)
      'input_buffer', 'belt',           // #3, #4  (upper-left edge)
      'belt',         'disabled',       // #5, #6  (upper-right edge)
      'disabled',     'output_buffer',  // #7, #8  (right edge)
      'disabled',     'belt',           // #9, #10 (lower-right edge)
      'belt',         'input_buffer',   // #11, #12 (lower-left edge)
    ]),
  },

  // ── Power Plant ─────────────────────────────────────────────────────────────
  // #1=input · no output buffer (power tokens go to inventory) · #3,#4,#5,#6,#9,#10,#11,#12=belt
  // · #2,#7,#8 no hole
  powerPlant: {
    kind: 'powerPlant', hexCount: 1,
    points: points12([
      'input_buffer', 'disabled',      // #1, #2  (left edge)
      'belt',         'belt',           // #3, #4  (upper-left edge)
      'belt',         'belt',           // #5, #6  (upper-right edge)
      'disabled',     'disabled',       // #7, #8  (right edge — no output)
      'belt',         'belt',           // #9, #10 (lower-right edge)
      'belt',         'belt',           // #11, #12 (lower-left edge)
    ]),
  },

  // ── Mine ────────────────────────────────────────────────────────────────────
  // Double-hex piece. NO belt connection points — belts never touch a mine directly.
  // Hex 0 (rich, positions 0–11):   internal edge 0 disabled; 5 external × 2 ore_output.
  // Hex 1 (lean, positions 12–23):  internal edge 3 disabled; ore outputs per mine
  //   (MINE_LEAN_ORE_OUTPUTS). This entry is MINE 1's layout; mines 2 and 3 differ only on
  //   the lean hex — always read a placed piece's layout with pieceTemplate(piece).
  // Which hex is rich vs lean is set by the mine's rotation at placement.
  // Meeple slots: 1 resource point + 1 upgrade point (separate from connection points).
  mine: mineTemplate('mine-1'),
};

function mineTemplate(id: MineId): PieceTemplate {
  return {
    kind: 'mine', hexCount: 2,
    points: [...mineHex0Points(), ...mineHex1Points(MINE_LEAN_ORE_OUTPUTS[id])],
    meepleSlots: [{ type: 'resource' }, { type: 'upgrade' }],
  };
}

// Each mine's own layout (they differ on the lean hex).
export const MINE_TEMPLATES: Readonly<Record<MineId, PieceTemplate>> = {
  'mine-1': PIECE_TEMPLATES.mine,
  'mine-2': mineTemplate('mine-2'),
  'mine-3': mineTemplate('mine-3'),
};

// The layout of one piece: by type, except that each mine has its own (by id). A mine with
// an unknown id (hand-built test boards) uses mine 1's layout.
export function pieceTemplate(piece: { readonly type: PieceType; readonly id: string }): PieceTemplate {
  if (piece.type === 'mine') return MINE_TEMPLATES[piece.id as MineId] ?? PIECE_TEMPLATES.mine;
  return PIECE_TEMPLATES[piece.type];
}
