import {
  STACK_COMPOSITION,
  CARD_COUNTS,
  STARTING_POWER_TOKENS,
  BELT_COUNT,
  TELEPORTER_COUNT,
  CONTROL_MODULE_MAX,
  STARTING_PIECES_PER_PLAYER,
  type PieceType,
  type CardType,
  type Material,
} from '../config';
import { createRng, shuffle, nextIntBelow } from '../rng';
import type {
  GameState,
  Player,
  BoardPiece,
  HexCoord,
  PieceStack,
  UnplacedPiece,
  PlayerId,
  Buffer,
} from '../state';
import { hexNeighbours, mineSecondaryCoord } from './pieces';

function makeBuffer(slotCount: number): Buffer {
  return {
    slots: new Array<Material | null>(slotCount).fill(null),
    teleporters: [],
  };
}

// Buffer configuration per piece type.
function makeBuffers(type: PieceType): { input: Buffer | null; output: Buffer | null } {
  switch (type) {
    case 'mine':          return { input: null,          output: makeBuffer(1) };
    case 'plateFact':     return { input: makeBuffer(1), output: makeBuffer(1) };
    case 'sphereFact':    return { input: makeBuffer(2), output: makeBuffer(1) };
    case 'tesseractFact': return { input: makeBuffer(3), output: makeBuffer(1) };
    case 'powerPlant':    return { input: makeBuffer(1), output: null };
    case 'blank':         return { input: null,          output: null };
  }
}

function buildStack(index: 0 | 1 | 2, playerCount: 2 | 3 | 4, rng: number): [PieceStack, number] {
  const comp = STACK_COMPOSITION[playerCount][index];
  const types: PieceType[] = [];

  const addType = (type: PieceType, count: number): void => {
    for (let i = 0; i < count; i++) types.push(type);
  };

  addType('plateFact',      comp.plateFact);
  addType('sphereFact',     comp.sphereFact);
  addType('tesseractFact',  comp.tesseractFact);
  addType('powerPlant',     comp.powerPlant);
  addType('blank',          comp.blank);

  let seq = 0;
  const pieces: UnplacedPiece[] = types.map(type => ({ id: `s${index}-${type}-${seq++}`, type }));
  const [shuffled, nextRng] = shuffle(pieces, rng);
  return [{ index, available: index === 0, pieces: shuffled }, nextRng];
}

function buildCardDeck(rng: number): [CardType[], number] {
  const deck: CardType[] = [];
  for (const [cardType, count] of Object.entries(CARD_COUNTS) as [CardType, number][]) {
    for (let i = 0; i < count; i++) {
      deck.push(cardType);
    }
  }
  return shuffle(deck, rng);
}

function makePlayer(id: PlayerId): Player {
  return {
    id,
    controlModules: Array.from({ length: CONTROL_MODULE_MAX }, (_, i) => i + 1),
    meepleOnPieceId: null,
    meepleSlotIndex: null,
    powerTokens: STARTING_POWER_TOKENS,
    inventory: { ore: 0, plate: 0, sphere: 0, tesseract: 0 },
    beltsRemaining: BELT_COUNT,
    teleportersRemaining: TELEPORTER_COUNT,
    hand: [],
    bonusTesseracts: { investor: false, beltWeaver: false, factoryEmpire: false },
    freeUpgradesRemaining: 0, // granted at end of first round
    freeUpgradePieceId: null,
    freeActionCredits: 0,
    freeClaimUsed: false,
    meepleOperatedThisRound: false,
    stats: { cardsPurchased: 0, cardsPlayed: 0, modulesUpgraded: 0 },
  };
}

function makeMine(id: string, coord: HexCoord): BoardPiece {
  const { input, output } = makeBuffers('mine');
  return { id, type: 'mine', coord, rotation: 0, claims: [], input, output };
}

function makeBoardPiece(up: UnplacedPiece, coord: HexCoord, rotation: number): BoardPiece {
  const { input, output } = makeBuffers(up.type);
  return { id: up.id, type: up.type, coord, rotation, claims: [], input, output };
}

// ── S5 helpers ────────────────────────────────────────────────────────────────

function hexToPixel(coord: HexCoord): [number, number] {
  return [Math.sqrt(3) * (coord.q + coord.r / 2), 1.5 * coord.r];
}

// Clockwise angle from a pixel center. 0 = north; increases clockwise.
function clockwiseAngle(coord: HexCoord, cx: number, cy: number): number {
  const [px, py] = hexToPixel(coord);
  const a = Math.atan2(px - cx, -(py - cy));
  return a < 0 ? a + 2 * Math.PI : a;
}

function hexEq(a: HexCoord, b: HexCoord): boolean {
  return a.q === b.q && a.r === b.r;
}

function isNeighbour(a: HexCoord, b: HexCoord): boolean {
  return hexNeighbours(a).some(n => hexEq(n, b));
}

// Hexes adjacent to both a and b.
function commonNeighbours(a: HexCoord, b: HexCoord): HexCoord[] {
  return hexNeighbours(a).filter(n => isNeighbour(n, b));
}

// Build the clockwise placement spiral around the mine, per the rulebook:
//  • The first piece goes below the connecting edge of the rich and lean hexes (the
//    lower hex adjacent to both mine hexes), then continues clockwise around the mine.
//  • Once a ring is complete, the spiral continues — the next ring begins at the "seam"
//    directly below: the hex adjacent to BOTH the first and last piece of the previous
//    ring (i.e. below and between them), then sweeps clockwise again.
// Returns the first `count` coords.
function clockwisePlacementCoords(
  primary: HexCoord,
  rotation: number,
  count: number,
): HexCoord[] {
  const secondary = mineSecondaryCoord(primary, rotation);

  const [px0, py0] = hexToPixel(primary);
  const [px1, py1] = hexToPixel(secondary);
  const cx = (px0 + px1) / 2;
  const cy = (py0 + py1) / 2;
  const angleOf = (c: HexCoord): number => clockwiseAngle(c, cx, cy);
  const mod2pi = (x: number): number => ((x % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);

  // The bottom-most hex of a set (largest screen y), tie-broken toward the mine's
  // horizontal centre — used to pick the "below the connecting edge" seam.
  const pickSeam = (hexes: HexCoord[]): HexCoord =>
    hexes.reduce((best, h) => {
      const [hx, hy] = hexToPixel(h);
      const [bx, by] = hexToPixel(best);
      if (hy !== by) return hy > by ? h : best;
      return Math.abs(hx - cx) < Math.abs(bx - cx) ? h : best;
    });

  const key = (c: HexCoord): string => `${c.q},${c.r}`;
  const seen = new Set<string>([key(primary), key(secondary)]);
  const result: HexCoord[] = [];

  let frontier: HexCoord[] = [primary, secondary];
  let prevFirst: HexCoord | null = null;
  let prevLast: HexCoord | null = null;

  while (result.length < count) {
    // Collect the next ring (unseen neighbours of the current frontier).
    const ringMap = new Map<string, HexCoord>();
    for (const hex of frontier) {
      for (const nb of hexNeighbours(hex)) {
        if (!seen.has(key(nb))) ringMap.set(key(nb), nb);
      }
    }
    if (ringMap.size === 0) break;
    const ring = [...ringMap.values()];
    for (const h of ring) seen.add(key(h));

    // Where this ring's clockwise sweep begins.
    let seam: HexCoord;
    if (prevFirst && prevLast) {
      const seamCandidates = ring.filter(h => isNeighbour(h, prevFirst!) && isNeighbour(h, prevLast!));
      seam = pickSeam(seamCandidates.length > 0 ? seamCandidates : ring);
    } else {
      // First ring: below the mine's connecting edge = lower common neighbour of the two hexes.
      seam = pickSeam(commonNeighbours(primary, secondary).filter(h => ringMap.has(key(h))));
    }

    const seamAngle = angleOf(seam);
    ring.sort((a, b) => mod2pi(angleOf(a) - seamAngle) - mod2pi(angleOf(b) - seamAngle));

    result.push(...ring);
    prevFirst = ring[0]!;
    prevLast = ring[ring.length - 1]!;
    frontier = ring;
  }

  return result.slice(0, count);
}

// Pull the starting pieces (per STARTING_PIECES_PER_PLAYER) for all players
// from the front of the shuffled stack. Returns: [pulled (re-shuffled), trimmed stack, nextRng].
function pullStartingPieces(
  stack: PieceStack,
  playerCount: number,
  rng: number,
): [UnplacedPiece[], PieceStack, number] {
  const targets: Partial<Record<PieceType, number>> = {};
  for (const type of Object.keys(STARTING_PIECES_PER_PLAYER) as PieceType[]) {
    targets[type] = (STARTING_PIECES_PER_PLAYER[type] ?? 0) * playerCount;
  }

  const pulled: UnplacedPiece[] = [];
  const remaining: UnplacedPiece[] = [];

  for (const piece of stack.pieces) {
    const need = targets[piece.type] ?? 0;
    if (need > 0) {
      pulled.push(piece);
      targets[piece.type] = need - 1;
    } else {
      remaining.push(piece);
    }
  }

  const [shuffled, nextRng] = shuffle(pulled, rng);
  return [shuffled, { ...stack, pieces: remaining }, nextRng];
}

// Place each piece at the corresponding coord with a seeded random rotation.
function placeStartingPieces(
  pieces: UnplacedPiece[],
  coords: HexCoord[],
  rng: number,
): [BoardPiece[], number] {
  const placed: BoardPiece[] = [];
  let r = rng;
  for (let i = 0; i < pieces.length; i++) {
    const piece = pieces[i]!;
    const coord = coords[i]!;
    const [rotation, nextR] = nextIntBelow(r, 6);
    r = nextR;
    placed.push(makeBoardPiece(piece, coord, rotation));
  }
  return [placed, r];
}

// ── createGame ────────────────────────────────────────────────────────────────

export function createGame(seed: number, playerCount: 2 | 3 | 4): GameState {
  let rng = createRng(seed);

  const [cardDeck, rng1] = buildCardDeck(rng);   rng = rng1;
  const [stack0, rng2]   = buildStack(0, playerCount, rng);    rng = rng2;
  const [stack1, rng3]   = buildStack(1, playerCount, rng);    rng = rng3;
  const [stack2, rng4]   = buildStack(2, playerCount, rng);    rng = rng4;

  const playerIds = Array.from({ length: playerCount }, (_, i) => i as PlayerId);
  const [turnOrder, rng5] = shuffle(playerIds, rng); rng = rng5;

  const players: Player[] = Array.from(
    { length: playerCount },
    (_, i) => makePlayer(i as PlayerId),
  );

  // S4: Mine 1 at origin, rotation 0.
  const mineCoord: HexCoord = { q: 0, r: 0 };
  const mine1 = makeMine('mine-1', mineCoord);

  // S5: Pull 4 pieces per player from stack 0, shuffle, place clockwise around mine.
  const [startingPieces, trimmedStack0, rng6] = pullStartingPieces(stack0, playerCount, rng);
  rng = rng6;
  const placementCoords = clockwisePlacementCoords(mineCoord, 0, 4 * playerCount);
  const [startingBoard, rng7] = placeStartingPieces(startingPieces, placementCoords, rng);
  rng = rng7;

  const board: BoardPiece[] = [mine1, ...startingBoard];

  // S7 is interactive: game starts in 'setupClaimPF' so players pick their own buildings.

  return {
    seed,
    rng,
    playerCount,
    players,
    board,
    stacks: [trimmedStack0, stack1, stack2],
    unplacedMines: [
      { id: 'mine-2', type: 'mine' },
      { id: 'mine-3', type: 'mine' },
    ],
    mineCount: 1,
    globalTeleporterCount: 0,
    cardDeck,
    cardDiscard: [],
    turnOrder,
    activePlayerIndex: 0,
    round: 1,
    phase: 'setupClaimPF',
    lastRoll: null,
    belts: [],
    mineBeltPlacedThisTurn: false,
    beltsPlacedThisTurn: [],
    pendingMineIds: [],
    drawnStackIndex: null,
    pendingFactoryOps: [],
    cardsPlayedThisTurn: 0,
    overstockPieces: [],
    productionIncreaseBudget: 0,
    productionIncreaseClaimedThisTurn: false,
    gameOver: false,
    winner: null,
    tiedWinners: [],
    gameOverReason: null,
  };
}
