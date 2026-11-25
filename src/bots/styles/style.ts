// A play style: the priorities a human brings to the table, as numbers. Every style bot runs
// the same decision procedure (styleBot.ts); the style only shifts what it values and how
// eagerly it spends. Keep these small and readable — a style is a set of priorities, not code.

export interface Style {
  readonly id: string;
  readonly label: string;
  /** Worth of one Power Token in material value, before the bot adjusts it for its own needs. */
  readonly powerValue: number;
  /** 0–1: how readily Leverage cards are bought (1 = whenever affordable). */
  readonly cardAppetite: number;
  /** Lowest value a card in hand must promise before it is played. */
  readonly cardPlayThreshold: number;
  /** 0–1: how readily the next Mine is bought (1 = as soon as affordable). */
  readonly mineAppetite: number;
  /** 0–1: how readily teleporters are bought. */
  readonly teleporterAppetite: number;
  /** Most belts the bot will lay to feed one input. */
  readonly maxRouteBelts: number;
  /** Weight of the three Bonus Tesseracts, as a multiple of a real Tesseract's worth. */
  readonly bonusWeight: { readonly investor: number; readonly beltWeaver: number; readonly factoryEmpire: number };
  /** Extra worth of one more claimed building (towards Factory Empire and breadth). */
  readonly breadth: number;
  /** Extra worth of a meeple on a Mine's resource point / upgrade point (style bias). */
  readonly meepleMine: number;
  readonly meepleUpgrade: number;
  /** Keep materials for points and end the game by emptying the stacks when ahead. */
  readonly hoard: boolean;
  /** Plan Control Modules for the dice that are coming (0 = current dice only, 1 = the next Mine's dice). */
  readonly lookAheadDice: number;
}

/** The balanced default every style starts from. */
export const BASE_STYLE: Omit<Style, 'id' | 'label'> = {
  powerValue: 1.2,
  cardAppetite: 0.35,
  cardPlayThreshold: 1.5,
  mineAppetite: 0.4,
  teleporterAppetite: 0.5,
  maxRouteBelts: 4,
  bonusWeight: { investor: 0.6, beltWeaver: 0.4, factoryEmpire: 0.5 },
  breadth: 1.5,
  meepleMine: 0,
  meepleUpgrade: 0,
  hoard: false,
  lookAheadDice: 0.5,
};
