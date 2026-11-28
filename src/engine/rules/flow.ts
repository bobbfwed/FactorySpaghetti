// M3: Belt and teleporter placement; direct-adjacency flow utility.
// All functions are pure: return new state, never mutate.

import type { GameState, BoardPiece, Belt, Player, PlayerId, HexCoord } from '../state';
import type {
  PlaceBeltAction,
  PlaceTeleporterAction,
  RemoveBeltAction,
  RulesError,
} from '../actions';
import {
  MATERIAL_VALUES,
  pieceTemplate,
  BELT_COST,
  INVENTORY_CAP,
  teleporterCost,
} from '../config';
import type { Material, PointRole } from '../config';
import { hexNeighbours, mineSecondaryCoord } from './pieces';
import { canLoadMaterial } from './recipes';

// ── Geometry constants ────────────────────────────────────────────────────────

// Pointy-top hex: visual edge → HEX_DIRS index.
// Derived from hex geometry: ve=0 faces (1,0), ve=1 faces (0,1), etc.
const VE_TO_DIR: readonly number[] = [0, 2, 5, 1, 3, 4];

// Same pairing as HEX_DIRECTIONS in pieces.ts (not exported there, duplicated here).
const HEX_DIRS: readonly HexCoord[] = [
  { q: 1, r: 0 }, { q: -1, r: 0 },
  { q: 0, r: 1 }, { q: 0, r: -1 },
  { q: 1, r: -1 }, { q: -1, r: 1 },
];

// direction index → vertex edge (inverse of VE_TO_DIR); matches the renderer's constant.
const HEX_DIR_TO_VERTEX_EDGE: readonly number[] = [0, 3, 1, 4, 5, 2];

// Mine lean-hex (hex 1) geometry. The lean hex's internal (shared) edge faces the rich hex
// at vertex edge iv = HEX_DIR_TO_VERTEX_EDGE[rotation ^ 1]. Its 3 ore outputs sit at the
// every-other vertex edges {iv+1, iv+3, iv+5} (opposite parity to iv). LEAN_OFFSET_TO_EDGE
// maps a vertex-edge offset from iv back to the lean template edge (0–5), so a neighbour
// facing an ore edge resolves to an ore_output position for EVERY rotation (not just 0).
// Derived to match the correct rotation-0 layout: template edges [0,1,2,3,4,5] sit at
// offsets [2,5,3,0,4,1] from iv, so the inverse (offset → edge) is:
const LEAN_OFFSET_TO_EDGE: readonly number[] = [3, 5, 0, 2, 4, 1];

// For point at `pos` on piece at (`coord`, `rotation`), find the adjacent BoardPiece
// (primary or mine-secondary hex) and the position on that piece aligned with pos.
// Exported for the routing module so it shares the exact same seam geometry as flow.
// IMPORTANT: only valid when called from a normal (non-mine) piece's point — the mine is
// only ever a *target* here. Mines have no belt points, so the router never calls it on one.
export function adjAt(
  coord: HexCoord,
  rotation: number,
  pos: number,
  board: ReadonlyArray<BoardPiece>,
): { piece: BoardPiece; pos: number } | null {
  const e = Math.floor(pos / 2);
  const w = pos % 2;
  const ve = (e + rotation + 3) % 6;
  const dir = HEX_DIRS[VE_TO_DIR[ve]!]!;
  const adjQ = coord.q + dir.q;
  const adjR = coord.r + dir.r;
  const veB = (ve + 3) % 6;

  // Template edge on the neighbour aligned with the shared edge (vertex-edge veB).
  // Normal single-hex pieces use the (veB - rot - 3) convention. The mine's two hexes
  // use the renderer's HEX_DIR_TO_VERTEX_EDGE convention instead (edge = VE_TO_DIR[ve] -
  // effRot), so flow lines up with the drawn ore-output points. The lean (second) hex is
  // carried on an effective rotation of ((rot ^ 1) + 3) % 6 — the same value the renderer
  // uses in drawMineHex1Points. The rich hex is symmetric so this only matters for the lean
  // hex, but both are computed consistently here.
  const normalEdge = (rB: number) => ((veB - rB - 3) % 6 + 6) % 6;
  const mineEdge = (effRot: number) => ((VE_TO_DIR[veB]! - effRot) % 6 + 6) % 6;

  for (const bp of board) {
    const rB = bp.rotation ?? 0;
    if (bp.coord.q === adjQ && bp.coord.r === adjR) {
      const eB = bp.type === 'mine' ? mineEdge(rB) : normalEdge(rB);
      return { piece: bp, pos: eB * 2 + (1 - w) };
    }
    if (bp.type === 'mine') {
      const sec = mineSecondaryCoord(bp.coord, rB);
      if (sec.q === adjQ && sec.r === adjR) {
        // Lean hex: internal edge at vertex edge iv; map the shared vertex edge's offset
        // from iv back to the lean template edge so ore lands every-other for all rotations.
        const iv = HEX_DIR_TO_VERTEX_EDGE[(rB ^ 1) % 6]!;
        const offset = ((veB - iv) % 6 + 6) % 6;
        const leanEdge = LEAN_OFFSET_TO_EDGE[offset]!;
        return { piece: bp, pos: 12 + leanEdge * 2 + (1 - w) };
      }
    }
  }
  return null;
}

export function getRole(piece: BoardPiece, pos: number): PointRole {
  const ptDef = pieceTemplate(piece).points.find(p => p.position === pos);
  return ptDef?.role ?? 'disabled';
}

// Index of this input_buffer position within the piece's input slot array.
function inputSlotIdx(piece: BoardPiece, pos: number): number {
  const inputs = pieceTemplate(piece).points
    .filter(p => p.role === 'input_buffer')
    .map(p => p.position)
    .sort((a, b) => a - b);
  return inputs.indexOf(pos);
}

// Index of this output_buffer position within the piece's output slot array.
function outputSlotIdx(piece: BoardPiece, pos: number): number {
  const outputs = pieceTemplate(piece).points
    .filter(p => p.role === 'output_buffer')
    .map(p => p.position)
    .sort((a, b) => a - b);
  return outputs.indexOf(pos);
}

export type ActionResult =
  | { ok: true; state: GameState }
  | { ok: false; error: RulesError };

// ── Helpers ───────────────────────────────────────────────────────────────────

function err(code: string, message: string): { ok: false; error: RulesError } {
  return { ok: false, error: { code, message } };
}

function mapPlayer(
  players: ReadonlyArray<Player>,
  id: PlayerId,
  fn: (p: Player) => Player,
): ReadonlyArray<Player> {
  return players.map((p, i) => (i === id ? fn(p) : p));
}

// Circular distance between two connection-point indices on a piece with n points.
function circularDistance(a: number, b: number, n: number): number {
  const d = Math.abs(a - b);
  return Math.min(d, n - d);
}

// True if the specific connection point on `piece` faces a Mine's ore exit (a mine point whose
// template role is ore_output) across the shared edge. The one-Mine-belt-per-turn limit counts
// only these belt ends, not ends facing a part of a Mine without an exit (RULES_CHANGES.md #39).
export function beltEndpointFacesOreExit(
  piece: BoardPiece,
  point: number,
  board: ReadonlyArray<BoardPiece>,
): boolean {
  const adj = adjAt(piece.coord, piece.rotation ?? 0, point, board);
  return adj != null && adj.piece.type === 'mine' && getRole(adj.piece, adj.pos) === 'ore_output';
}

// True when point `pos` of `piece` is an input or output of a building that has at least one
// claim and none of them is `playerId`'s: the point is reserved for the building's owners.
// One predicate for two rules: a NEW belt of that player may not end facing it (placement,
// POINT_RESERVED, RULES_CHANGES.md #31), and a belt of that player already lying there is a
// dead end — no material enters or leaves the belt chain through that end (flow, the Belt
// Weaver chain and the table's flow display; RULES_CHANGES.md #38).
export function isReservedPoint(piece: BoardPiece, pos: number, playerId: PlayerId): boolean {
  const role = getRole(piece, pos);
  return (role === 'input_buffer' || role === 'output_buffer') &&
    piece.claims.length > 0 && !piece.claims.some(c => c.ownerId === playerId);
}

// True when a teleporter cuts this side of `piece` off from belts and direct contact
// (RULES_CHANGES.md #53): an output with a teleporter is never a source for a belt chain or a
// touching input (only the teleporter drains it); the input of a building with ONE input
// (Plate Factory, Power Plant) with a teleporter receives nothing from a Mine, a belt or a
// touching output. A teleporter belongs to the whole input buffer, so on a building with
// several inputs (Sphere, Tesseract Factory) it cuts nothing off: which single input it should
// block is the designer's open question OQ-11. Used by the flow resolver, the table's flow
// display and the bots, so all three agree.
export function teleporterCutsOff(piece: Pick<BoardPiece, 'input' | 'output'>, side: 'input' | 'output'): boolean {
  if (side === 'output') return piece.output != null && piece.output.teleporterOwner != null;
  return piece.input != null && piece.input.teleporterOwner != null && piece.input.slots.length === 1;
}

// May material move from building `src`'s output into building `dst`'s input (RULES_CHANGES.md
// #51)? Only a claimed building receives, and only from a building of the same player: at least
// one player holds a claim on both. An unclaimed building's output is open — it is nobody's
// material, just as it is open to anyone's belt — and a Mine belongs to nobody and feeds any
// claimed building. Otherwise nothing moves and the material stays in `src`'s output.
// One predicate for every consumer: the flow resolver (direct contact, and as a safeguard every
// belt-chain delivery too), the table's flow display and the bots' feed analysis.
// `assumeOwner`: judge as if that player also held a claim on `dst` (a bot weighing a building it
// may claim).
export function directFlowAllowed(
  src: Pick<BoardPiece, 'type' | 'claims'>,
  dst: Pick<BoardPiece, 'claims'>,
  assumeOwner?: PlayerId,
): boolean {
  const receivers = new Set<PlayerId>(dst.claims.map(c => c.ownerId));
  if (assumeOwner !== undefined) receivers.add(assumeOwner);
  if (receivers.size === 0) return false;
  if (src.type === 'mine' || src.claims.length === 0) return true;
  return src.claims.some(c => receivers.has(c.ownerId));
}

// Why player `me` may not end a belt at (piece, pos), judged by what sits across that
// point's shared edge, or null if nothing there forbids it:
//   • 'POINT_RESERVED' — the point faces an input or output of a building that has at least
//     one claim and none of them is mine (the point is reserved for its owners; a co-owner
//     may use it; anyone may use it while the building is unclaimed);
//   • 'BELT_BLOCKED'   — another player's belt connects there (you may not join it).
// Used by belt placement, legalActions, and the router so all three agree. Only NEW belts
// are checked here: a belt already lying at a point stays when someone later claims the
// building it faces, but is then a dead end at that point (isReservedPoint, used by flow).
export type BeltEndpointConflict = 'POINT_RESERVED' | 'BELT_BLOCKED';

export function beltEndpointConflict(
  state: GameState,
  piece: BoardPiece,
  pos: number,
  me: PlayerId,
): BeltEndpointConflict | null {
  const n = adjAt(piece.coord, piece.rotation ?? 0, pos, state.board);
  if (!n) return null;
  if (isReservedPoint(n.piece, n.pos, me)) return 'POINT_RESERVED';
  // Can't terminate where another player's belt connects across the seam.
  const joinsOther = state.belts.some(
    b => b.ownerId !== me && b.pieceId === n.piece.id && (b.fromPoint === n.pos || b.toPoint === n.pos),
  );
  return joinsOther ? 'BELT_BLOCKED' : null;
}

export function beltEndpointBlocked(
  state: GameState,
  piece: BoardPiece,
  pos: number,
  me: PlayerId,
): boolean {
  return beltEndpointConflict(state, piece, pos, me) !== null;
}

// True when an inventory's total value (MATERIAL_VALUES) covers `cost`. This is the one
// affordability test for every material payment (cards, Mines, belts, teleporters): with
// change given back (payMaterials), any set of materials worth enough can pay.
export function canAfford(inventory: Readonly<Record<Material, number>>, cost: number): boolean {
  return inventoryValue(inventory) >= cost;
}

export function inventoryValue(inventory: Readonly<Record<Material, number>>): number {
  return (Object.keys(MATERIAL_VALUES) as Material[]).reduce((s, m) => s + (inventory[m] ?? 0) * MATERIAL_VALUES[m], 0);
}

// Pay `cost` value-units from `inventory` the way a sensible player would at the table, so they
// keep the highest denominations they can (RULES_CHANGES.md #42). Returns the inventory after
// paying, or null when the total value is short of the cost.
//
// Every way of handing in whole units worth at least the cost is considered (each material
// from 0 up to what is held). The change (handed-in value − cost) comes back from the bank in
// materials strictly LOWER than the highest material handed in (exchanging down only), highest
// first, each only up to the room left under INVENTORY_CAP; change that fits nowhere is lost.
// Of all outcomes, the one that (1) loses the least value to the cap, then (2) leaves the most
// Tesseracts, then Spheres, then Plates, then Ore is chosen. Values come from MATERIAL_VALUES.
// Examples (Ore 1, Plate 3, Sphere 7, Tesseract 23), paying 3: Sphere + Ore → Plate + 2 Ore;
// 2 Spheres → Sphere + Plate + Ore; a Tesseract → 2 Spheres + 2 Plates.
export function payMaterials(
  inventory: Readonly<Record<Material, number>>,
  cost: number,
): Record<Material, number> | null {
  if (!canAfford(inventory, cost)) return null;
  const held = PAY_MATS.map(m => Math.max(0, Math.floor(inventory[m] ?? 0)));
  // Pure and called often (every purchase the bots consider), so the choice is remembered.
  const memoKey = `${held.join(',')}|${cost}`;
  const kept = payMemo.get(memoKey) ?? choosePayment(held, cost);
  if (!payMemo.has(memoKey)) {
    if (payMemo.size >= PAY_MEMO_MAX) payMemo.clear();
    payMemo.set(memoKey, kept);
  }
  const out = { ...inventory } as Record<Material, number>;
  PAY_MATS.forEach((m, i) => { out[m] = kept[i]!; });
  return out;
}

// Materials from the most to the least valuable, and their values.
const PAY_MATS: readonly Material[] = (Object.keys(MATERIAL_VALUES) as Material[])
  .sort((a, b) => MATERIAL_VALUES[b] - MATERIAL_VALUES[a]);
const PAY_VALUES: readonly number[] = PAY_MATS.map(m => MATERIAL_VALUES[m]);
const payMemo = new Map<string, readonly number[]>();
const PAY_MEMO_MAX = 20_000;

// The search behind payMaterials, over counts in PAY_MATS order (most valuable first). `held`
// is worth at least `cost`. Returns the counts kept after paying and taking the change.
function choosePayment(held: readonly number[], cost: number): readonly number[] {
  const k = held.length;
  const handIn = new Array<number>(k).fill(0);
  const after = new Array<number>(k).fill(0);
  let best: number[] = [...held].fill(0);
  let bestLost = Infinity;
  for (;;) {
    let paid = 0;
    let top = -1; // index of the most valuable material handed in
    for (let i = 0; i < k; i++) {
      paid += handIn[i]! * PAY_VALUES[i]!;
      if (top < 0 && handIn[i]! > 0) top = i;
    }
    if (paid >= cost) {
      for (let i = 0; i < k; i++) after[i] = held[i]! - handIn[i]!;
      let change = paid - cost;
      for (let i = top + 1; i < k && change > 0; i++) {
        const room = Math.max(0, INVENTORY_CAP - after[i]!);
        const n = Math.min(Math.floor(change / PAY_VALUES[i]!), room);
        after[i] = after[i]! + n;
        change -= n * PAY_VALUES[i]!;
      }
      // `change` left over could not be given back under the cap: it is lost.
      let better = change < bestLost;
      if (change === bestLost) {
        // Lexicographically greatest from the most valuable material down.
        let i = 0;
        while (i < k && after[i] === best[i]) i++;
        better = i < k && after[i]! > best[i]!;
      }
      if (better) { best = [...after]; bestLost = change; }
    }
    // Next hand-in (an odometer over 0..held[i] for each material).
    let i = k - 1;
    while (i >= 0 && handIn[i] === held[i]) { handIn[i] = 0; i--; }
    if (i < 0) break;
    handIn[i] = handIn[i]! + 1;
  }
  return best;
}

// ── BUY_BELT ──────────────────────────────────────────────────────────────────

// Purchase one belt from the bank for BELT_COST ore value-units.
// Adds to beltsRemaining; the player then uses a separate PLACE_BELT to put it on the board.
export function applyBuyBelt(state: GameState): ActionResult {
  if (state.phase !== 'actions') {
    return err('WRONG_PHASE', `Expected actions phase, got ${state.phase}`);
  }

  const activeId = state.turnOrder[state.activePlayerIndex];
  if (activeId === undefined) return err('INTERNAL', 'No active player');

  const player = state.players[activeId];
  if (!player) return err('INTERNAL', 'Player not found');

  const newInv = payMaterials(player.inventory, BELT_COST);
  if (!newInv) {
    return err('CANNOT_AFFORD', `Buying a belt costs ${BELT_COST} ore value unit(s)`);
  }

  const newPlayers = mapPlayer(state.players, activeId, p => ({
    ...p,
    inventory: newInv,
    beltsRemaining: p.beltsRemaining + 1,
  }));

  return { ok: true, state: { ...state, players: newPlayers } };
}

// ── PLACE_TELEPORTER ──────────────────────────────────────────────────────────

export function applyPlaceTeleporter(
  state: GameState,
  action: PlaceTeleporterAction,
): ActionResult {
  if (state.phase !== 'actions') {
    return err('WRONG_PHASE', `Expected actions phase, got ${state.phase}`);
  }

  const activeId = state.turnOrder[state.activePlayerIndex];
  if (activeId === undefined) return err('INTERNAL', 'No active player');

  const player = state.players[activeId];
  if (!player) return err('INTERNAL', 'Player not found');

  const piece = state.board.find(p => p.id === action.pieceId);
  if (!piece) return err('PIECE_NOT_FOUND', `No board piece with id ${action.pieceId}`);

  if (!piece.claims.some(c => c.ownerId === activeId)) {
    return err('NOT_YOUR_BUILDING', 'You must have a claim on the building to place a teleporter');
  }

  if (player.teleportersRemaining <= 0) {
    return err('NO_TELEPORTERS', 'You have no teleporters remaining');
  }

  // Cost = teleporters currently on the board (all players) + 1 value-units, paid with change.
  const cost = teleporterCost(state.globalTeleporterCount);
  const newInv = payMaterials(player.inventory, cost);
  if (!newInv) {
    return err('CANNOT_AFFORD', `Teleporter costs ${cost} value unit(s)`);
  }

  let newPiece: BoardPiece;
  if (action.bufferType === 'input') {
    if (!piece.input) return err('NO_BUFFER', 'This piece has no input buffer');
    if (piece.input.teleporterOwner !== null) {
      return err('BUFFER_OCCUPIED', 'This input buffer already has a teleporter');
    }
    newPiece = { ...piece, input: { ...piece.input, teleporterOwner: activeId } };
  } else {
    if (!piece.output) return err('NO_BUFFER', 'This piece has no output buffer');
    if (piece.output.teleporterOwner !== null) {
      return err('BUFFER_OCCUPIED', 'This output buffer already has a teleporter');
    }
    newPiece = { ...piece, output: { ...piece.output, teleporterOwner: activeId } };
  }

  const newBoard = state.board.map(p => (p.id === piece.id ? newPiece : p));
  const newPlayers = mapPlayer(state.players, activeId, p => ({
    ...p,
    inventory: newInv,
    teleportersRemaining: p.teleportersRemaining - 1,
  }));

  return {
    ok: true,
    state: {
      ...state,
      board: newBoard,
      players: newPlayers,
      globalTeleporterCount: state.globalTeleporterCount + 1,
    },
  };
}

// ── Teleporters that lost their claim ─────────────────────────────────────────

// A teleporter works for the building it sits on only while its placer holds a claim there.
// As soon as a player holds no claim on a building any more (today only Changing Priorities
// can move their last Control Module off it), every teleporter of theirs on that building's
// buffers goes back to their supply, the buffer has no teleporter, and the teleporter price
// drops with the count on the board (RULES_CHANGES.md #37). Material in the buffers stays.
// Pure; run after every action (reducer) so any future claim-removing effect is covered too.
export function returnOrphanedTeleporters(state: GameState): GameState {
  // Fast path (this runs after every action, including every move a bot tries).
  const orphaned = (piece: BoardPiece, owner: PlayerId | null | undefined): boolean =>
    owner != null && !piece.claims.some(c => c.ownerId === owner);
  if (!state.board.some(p => orphaned(p, p.input?.teleporterOwner) || orphaned(p, p.output?.teleporterOwner))) return state;
  let returned = 0;
  let players = state.players;
  const board = state.board.map(piece => {
    let next = piece;
    for (const side of ['input', 'output'] as const) {
      const buf = next[side];
      const owner = buf?.teleporterOwner ?? null;
      if (!buf || owner === null || next.claims.some(c => c.ownerId === owner)) continue;
      next = { ...next, [side]: { ...buf, teleporterOwner: null } };
      players = mapPlayer(players, owner, p => ({ ...p, teleportersRemaining: p.teleportersRemaining + 1 }));
      returned++;
    }
    return next;
  });
  if (returned === 0) return state;
  return {
    ...state, board, players,
    globalTeleporterCount: Math.max(0, state.globalTeleporterCount - returned),
  };
}

// ── PLACE_BELT ────────────────────────────────────────────────────────────────

// Endpoint order (a deliberate contract, see PlaceBeltAction): both orders are accepted and the
// belt is stored exactly as given, because the interface lays a route in the direction the player
// tapped it. The table draws each belt along the direction beltDirections (beltDirection.ts)
// works out from the chain it belongs to (from a source towards an input); the stored order only
// decides the direction of a chain that nothing else decides. Every check below treats the
// two endpoints alike, and no rule reads the stored order: material flow (beltPartner) takes
// whichever end is the other one, the Belt Weaver chain and the router use both ends as an
// unordered pair, and removal/undo work by belt id. The one visible difference is the belt id,
// which spells the points in the given order. legalActions lists each belt once, lower point
// first (sameMove / canonicalAction in actions.ts treat the two orders as the same move).
export function applyPlaceBelt(state: GameState, action: PlaceBeltAction): ActionResult {
  if (state.phase !== 'actions') {
    return err('WRONG_PHASE', `Expected actions phase, got ${state.phase}`);
  }

  const activeId = state.turnOrder[state.activePlayerIndex];
  if (activeId === undefined) return err('INTERNAL', 'No active player');

  const player = state.players[activeId];
  if (!player) return err('INTERNAL', 'Player not found');

  const piece = state.board.find(p => p.id === action.pieceId);
  if (!piece) return err('PIECE_NOT_FOUND', `No board piece with id ${action.pieceId}`);

  if (player.beltsRemaining <= 0) {
    return err('NO_BELTS', 'You have no belts remaining');
  }

  // Validate connection points against the piece's template.
  const template = pieceTemplate(piece);
  const totalPositions = template.hexCount * 12;
  const { fromPoint, toPoint } = action;

  if (!Number.isInteger(fromPoint) || fromPoint < 0 || fromPoint >= totalPositions) {
    return err('INVALID_POINT', `fromPoint ${fromPoint} is out of range [0, ${totalPositions}) for ${piece.type}`);
  }
  if (!Number.isInteger(toPoint) || toPoint < 0 || toPoint >= totalPositions) {
    return err('INVALID_POINT', `toPoint ${toPoint} is out of range [0, ${totalPositions}) for ${piece.type}`);
  }
  if (fromPoint === toPoint) {
    return err('SAME_POINT', 'fromPoint and toPoint must be different');
  }

  // Both positions must be enabled belt connection points in the template.
  // (Mines have no belt points, so any attempt on a mine fails here.)
  const fromDef = template.points.find(p => p.position === fromPoint);
  const toDef   = template.points.find(p => p.position === toPoint);
  if (!fromDef || fromDef.role !== 'belt' || !fromDef.enabled) {
    return err('NOT_A_BELT_POINT', `Position ${fromPoint} is not an active belt connection point on ${piece.type}`);
  }
  if (!toDef || toDef.role !== 'belt' || !toDef.enabled) {
    return err('NOT_A_BELT_POINT', `Position ${toPoint} is not an active belt connection point on ${piece.type}`);
  }

  // Must be more than 2 positions apart (circular distance among totalPositions grid).
  // Prevents within-edge belts (distance 1) and one-step-across belts (distance 2).
  if (circularDistance(fromPoint, toPoint, totalPositions) <= 2) {
    return err(
      'POINTS_TOO_CLOSE',
      'Belt connection points must be more than 2 positions apart on the piece perimeter',
    );
  }

  // A connection point can only be used by one belt per piece.
  const conflict = state.belts.some(
    b =>
      b.pieceId === piece.id &&
      (b.fromPoint === fromPoint || b.toPoint === fromPoint ||
       b.fromPoint === toPoint   || b.toPoint === toPoint),
  );
  if (conflict) {
    return err('POINT_OCCUPIED', 'One of the connection points is already used by another belt on this piece');
  }

  // A belt endpoint may not face the input or output of a building claimed only by other
  // players, nor connect across a shared edge to another player's belt.
  const conflicts = [
    beltEndpointConflict(state, piece, fromPoint, activeId),
    beltEndpointConflict(state, piece, toPoint, activeId),
  ];
  if (conflicts.includes('POINT_RESERVED')) {
    return err(
      'POINT_RESERVED',
      "A belt endpoint may not face the input or output of a building claimed only by other players",
    );
  }
  if (conflicts.includes('BELT_BLOCKED')) {
    return err('BELT_BLOCKED', "A belt endpoint may not join another player's belt");
  }

  // One Mine belt per turn: only belt ends that face a Mine's ore exit count.
  const adjacentToMine = beltEndpointFacesOreExit(piece, fromPoint, state.board) ||
                         beltEndpointFacesOreExit(piece, toPoint, state.board);
  if (adjacentToMine && state.mineBeltPlacedThisTurn) {
    return err('MINE_BELT_LIMIT', 'Only one belt with an end facing a Mine ore exit may be placed per turn');
  }

  // No ore cost — placing from supply is free. Only buying additional belts costs ore.
  const beltId = `belt-p${activeId}-${piece.id}-${fromPoint}-${toPoint}`;
  const newBelt: Belt = { id: beltId, ownerId: activeId, pieceId: piece.id, fromPoint, toPoint };

  const newPlayers = mapPlayer(state.players, activeId, p => ({
    ...p,
    beltsRemaining: p.beltsRemaining - 1,
  }));

  const newState: GameState = {
    ...state,
    belts: [...state.belts, newBelt],
    players: newPlayers,
    mineBeltPlacedThisTurn: adjacentToMine ? true : state.mineBeltPlacedThisTurn,
    beltsPlacedThisTurn: [...state.beltsPlacedThisTurn, beltId],
  };
  // Flow is deferred: resolveDirectAdjacency runs at END_ACTIONS so the player
  // can rearrange belts freely (and undo them) before material moves.
  return { ok: true, state: newState };
}

// ── REMOVE_BELT ───────────────────────────────────────────────────────────────

export function applyRemoveBelt(state: GameState, action: RemoveBeltAction): ActionResult {
  if (state.phase !== 'actions') {
    return err('WRONG_PHASE', `Expected actions phase, got ${state.phase}`);
  }

  const activeId = state.turnOrder[state.activePlayerIndex];
  if (activeId === undefined) return err('INTERNAL', 'No active player');

  const belt = state.belts.find(b => b.id === action.beltId);
  if (!belt) return err('BELT_NOT_FOUND', `No belt with id ${action.beltId}`);

  if (belt.ownerId !== activeId) {
    return err('NOT_YOUR_BELT', 'You can only remove your own belts');
  }

  // Printed rule 6 (RULES_CHANGES.md #54): a belt laid on an earlier turn goes back to the bank
  // (belts in the bank are unlimited, so nothing is counted there); placing one again means
  // buying one. A belt laid this turn is a move not yet finished: it goes back to the player's
  // own belts, as with Undo belts (any ore spent buying it is not refunded).
  const laidThisTurn = beltLaidThisTurn(state, action.beltId);
  const newBelts = state.belts.filter(b => b.id !== action.beltId);
  const newPlayers = laidThisTurn
    ? mapPlayer(state.players, activeId, p => ({ ...p, beltsRemaining: p.beltsRemaining + 1 }))
    : state.players;
  const placedThisTurn = state.beltsPlacedThisTurn.filter(id => id !== action.beltId);

  return {
    ok: true,
    state: {
      ...state,
      belts: newBelts,
      players: newPlayers,
      // Picking up the turn's Mine belt frees the limit again, as Undo belts does
      // (RULES_CHANGES.md #52): the limit is used only while a belt laid this turn still has
      // an end facing a Mine ore exit. A Mine belt laid on an earlier turn never counted.
      mineBeltPlacedThisTurn: mineBeltAmong(state.board, newBelts, placedThisTurn),
      beltsPlacedThisTurn: placedThisTurn,
    },
  };
}

// True when belt `beltId` was laid in the current turn, so picking it up returns it to its
// owner's own belts; a belt laid on an earlier turn goes back to the bank (#54). For the
// interface, which must say which of the two will happen before the player confirms.
export function beltLaidThisTurn(state: Pick<GameState, 'beltsPlacedThisTurn'>, beltId: string): boolean {
  return state.beltsPlacedThisTurn.includes(beltId);
}

// True when one of the belts with an id in `ids` has an end facing a Mine ore exit (the test
// PLACE_BELT uses for the one-Mine-belt-per-turn limit).
function mineBeltAmong(
  board: ReadonlyArray<BoardPiece>,
  belts: ReadonlyArray<Belt>,
  ids: ReadonlyArray<string>,
): boolean {
  const wanted = new Set(ids);
  return belts.some(b => {
    if (!wanted.has(b.id)) return false;
    const piece = board.find(p => p.id === b.pieceId);
    return !!piece && (beltEndpointFacesOreExit(piece, b.fromPoint, board) || beltEndpointFacesOreExit(piece, b.toPoint, board));
  });
}

// ── UNDO_BELTS ────────────────────────────────────────────────────────────────

export function applyUndoBelts(state: GameState): ActionResult {
  if (state.phase !== 'actions') {
    return err('WRONG_PHASE', `Expected actions phase, got ${state.phase}`);
  }

  const activeId = state.turnOrder[state.activePlayerIndex];
  if (activeId === undefined) return err('INTERNAL', 'No active player');

  const undoIds = new Set(state.beltsPlacedThisTurn);
  if (undoIds.size === 0) {
    return err('NOTHING_TO_UNDO', 'No belts placed this turn to undo');
  }

  const removedCount = state.belts.filter(b => undoIds.has(b.id)).length;
  const newBelts = state.belts.filter(b => !undoIds.has(b.id));
  const newPlayers = mapPlayer(state.players, activeId, p => ({
    ...p,
    beltsRemaining: p.beltsRemaining + removedCount,
  }));

  return {
    ok: true,
    state: {
      ...state,
      belts: newBelts,
      players: newPlayers,
      mineBeltPlacedThisTurn: false,
      beltsPlacedThisTurn: [],
    },
  };
}

// ── Mine ore delivery (direct adjacency) ──────────────────────────────────────

// Top up every claimed building's empty input slots with ore wherever an
// input-buffer point directly faces a mine's ore_output point. The mine is an
// unlimited, instant ore source: any directly-connected input is always kept full.
//
// Computed from the INPUT side (single-hex factory positions 0–11, where adjAt's
// geometry is exact) rather than iterating the mine's points — the mine's lean
// hex uses positions 12–23, for which adjAt cannot resolve neighbours correctly.
// This is purely additive (fills empty slots only) and safe to call any time after
// pieces are placed, independent of belt finalisation.
export function fillInputsFromAdjacentMines(state: GameState): GameState {
  const board: BoardPiece[] = [...state.board];
  let changed = false;

  for (let i = 0; i < board.length; i++) {
    const piece = board[i]!;
    if (piece.claims.length === 0 || !piece.input) continue;
    if (teleporterCutsOff(piece, 'input')) continue; // a teleported input takes no Ore by itself (#53)

    const template = pieceTemplate(piece);
    for (const ptDef of template.points) {
      if (ptDef.role !== 'input_buffer' || !ptDef.enabled) continue;

      const adj = adjAt(piece.coord, piece.rotation ?? 0, ptDef.position, board);
      if (!adj || adj.piece.type !== 'mine') continue;
      if (getRole(adj.piece, adj.pos) !== 'ore_output') continue;

      const cur = board[i]!;
      if (!cur.input) continue;
      const si = inputSlotIdx(cur, ptDef.position);
      if (si < 0 || cur.input.slots[si] !== null) continue;
      // Only deliver ore if it keeps a valid recipe reachable (e.g. never a 2nd ore into a
      // Sphere Factory) — flow respects the recipe table, same as manual loading.
      if (!canLoadMaterial(cur.type, cur.input.slots, 'ore')) continue;

      const slots = [...cur.input.slots] as Array<Material | null>;
      slots[si] = 'ore';
      board[i] = { ...cur, input: { ...cur.input, slots } };
      changed = true;
    }
  }

  return changed ? { ...state, board } : state;
}

// ── Output teleporters ────────────────────────────────────────────────────────

// An output teleporter sends its building's produced material to the placer's inventory
// (RULES.md: "material the building produces goes instantly to your inventory, respecting
// the 6-per-material cap — overflow stays in the buffer"). tryOperateFactory diverts at
// production time, but material can still sit in an output buffer — produced before the
// teleporter was placed, or overflow from when inventory was at cap and later had room.
// So we also drain any teleported output buffer to inventory whenever flow resolves; a
// full buffer would otherwise block the factory from ever producing again.
export function drainOutputTeleporters(state: GameState): GameState {
  let players = state.players;
  let changed = false;
  const board = state.board.map(piece => {
    if (!piece.output || piece.output.teleporterOwner === null) return piece;
    const owner = piece.output.teleporterOwner;
    const slots = [...piece.output.slots] as Array<Material | null>;
    let pieceChanged = false;
    for (let i = 0; i < slots.length; i++) {
      const mat = slots[i];
      if (mat == null) continue; // empty slot (null/undefined)
      const p = players[owner];
      if (!p || p.inventory[mat] >= INVENTORY_CAP) continue; // cap reached — overflow stays
      players = players.map((pl, idx) =>
        idx === owner ? { ...pl, inventory: { ...pl.inventory, [mat]: pl.inventory[mat] + 1 } } : pl,
      );
      slots[i] = null;
      pieceChanged = true;
    }
    if (!pieceChanged) return piece;
    changed = true;
    return { ...piece, output: { ...piece.output, slots } };
  });
  return changed ? { ...state, board, players } : state;
}

// ── Direct adjacency flow ─────────────────────────────────────────────────────

// One pass of material flow:
//   Pass 0 — output teleporters drain to their owner's inventory (respecting caps)
//   Pass 1 — direct adjacency: ore_output / output_buffer → adjacent claimed input_buffer
//            (a building's output only into a building of the same player; #51)
//   Pass 2 — belt-mediated:    through a chain of one or more belts (input-driven search)
// Called after PLACE_BELT and CLAIM_BUILDING so new connections activate immediately.
export function resolveDirectAdjacency(state: GameState): GameState {
  // Output teleporters take priority: buffered material goes to inventory before it could
  // flow downstream (and this clears material stuck from before the teleporter was placed).
  state = drainOutputTeleporters(state);
  // Mine ore (direct adjacency) is handled by the robust input-driven pass first
  // so both mine hexes deliver correctly; the loop below then routes building output.
  state = fillInputsFromAdjacentMines(state);

  const board: BoardPiece[] = [...state.board];
  let changed = false;

  function cur(id: string): BoardPiece {
    return board.find(p => p.id === id)!;
  }

  function updatePiece(updated: BoardPiece): void {
    const i = board.findIndex(p => p.id === updated.id);
    if (i >= 0) { board[i] = updated; changed = true; }
  }

  // Deliver ore (unlimited mine supply) to a claimed building's input slot.
  function deliverOre(dstPiece: BoardPiece, dstPos: number): boolean {
    if (dstPiece.claims.length === 0) return false;
    if (teleporterCutsOff(dstPiece, 'input')) return false; // #53
    const si = inputSlotIdx(dstPiece, dstPos);
    if (si < 0 || !dstPiece.input) return false;
    if (dstPiece.input.slots[si] !== null) return false;
    if (!canLoadMaterial(dstPiece.type, dstPiece.input.slots, 'ore')) return false; // recipe-aware
    const slots = [...dstPiece.input.slots] as Array<Material | null>;
    slots[si] = 'ore';
    updatePiece({ ...cur(dstPiece.id), input: { ...cur(dstPiece.id).input!, slots } });
    return true;
  }

  // Move a material from a building's output slot to a claimed building's input slot of the
  // same player (directFlowAllowed). Belt chains already stop at buildings the chain's owner
  // holds no claim on (dead ends, #38), so for them the ownership test changes nothing; it is
  // checked here as well so no path can carry one player's output into another's building.
  function moveOutput(
    srcPiece: BoardPiece, srcPos: number,
    dstPiece: BoardPiece, dstPos: number,
  ): boolean {
    if (!directFlowAllowed(srcPiece, dstPiece)) return false;
    // A teleported output is drained only by its teleporter, even when it cannot drain (owner at
    // the cap); a teleported single input takes nothing by itself (#53).
    if (teleporterCutsOff(srcPiece, 'output') || teleporterCutsOff(dstPiece, 'input')) return false;
    const srcSi = outputSlotIdx(srcPiece, srcPos);
    if (srcSi < 0 || !srcPiece.output) return false;
    const material = srcPiece.output.slots[srcSi];
    if (material == null) return false; // null or undefined → slot empty
    const dstSi = inputSlotIdx(dstPiece, dstPos);
    if (dstSi < 0 || !dstPiece.input) return false;
    if (dstPiece.input.slots[dstSi] !== null) return false;
    if (!canLoadMaterial(dstPiece.type, dstPiece.input.slots, material)) return false; // recipe-aware

    const srcNow = cur(srcPiece.id);
    const srcSlots = [...srcNow.output!.slots] as Array<Material | null>;
    srcSlots[srcSi] = null;
    updatePiece({ ...srcNow, output: { ...srcNow.output!, slots: srcSlots } });

    const dstNow = cur(dstPiece.id);
    const dstSlots = [...dstNow.input!.slots] as Array<Material | null>;
    dstSlots[dstSi] = material;
    updatePiece({ ...dstNow, input: { ...dstNow.input!, slots: dstSlots } });
    return true;
  }

  // Pass 1: direct adjacency, building output → adjacent claimed input (no belt), only between
  // buildings of the same player or out of an unclaimed building (moveOutput, #51); otherwise
  // the material stays in the output, as it does when the input is full.
  // (Direct mine ore is already delivered by fillInputsFromAdjacentMines above.)
  for (const piece of state.board) {
    const template = pieceTemplate(piece);
    for (const ptDef of template.points) {
      if (ptDef.role !== 'output_buffer' || !ptDef.enabled) continue;

      const adj = adjAt(piece.coord, piece.rotation ?? 0, ptDef.position, board);
      if (!adj) continue;
      if (getRole(adj.piece, adj.pos) !== 'input_buffer') continue;

      moveOutput(cur(piece.id), ptDef.position, cur(adj.piece.id), adj.pos);
    }
  }

  // Pass 2: belt-mediated flow, including multi-belt chains.
  // Input-driven: for each empty input slot of a claimed building, walk the belt network
  // outward to find a feeding source (a mine ore-output = unlimited, or a building output
  // buffer = one unit). The belt graph: a belt links its two endpoints within a piece;
  // material crosses the shared edge between the aligned points of touching pieces (a
  // "seam"). Material flows source → seam → belt → seam → belt → … → seam → input.

  // Other endpoint of the placed belt that uses (pieceId, pos), or null if none.
  const beltAt = (pieceId: string, pos: number): Belt | undefined =>
    state.belts.find(bl => bl.pieceId === pieceId && (bl.fromPoint === pos || bl.toPoint === pos));
  const beltPartner = (pieceId: string, pos: number): number | null => {
    const b = beltAt(pieceId, pos);
    if (!b) return null;
    return b.fromPoint === pos ? b.toPoint : b.fromPoint;
  };
  // A belt end facing an input or output reserved against the belt's owner is a dead end
  // (RULES_CHANGES.md #38): no material enters or leaves the chain there. Belts of different
  // players never join, so a chain has one owner; the check is still made per belt end.
  const deadEnd = (beltPieceId: string, beltPos: number, faced: { piece: BoardPiece; pos: number }): boolean => {
    const b = beltAt(beltPieceId, beltPos);
    return !!b && isReservedPoint(faced.piece, faced.pos, b.ownerId);
  };
  const seamOf = (pieceId: string, pos: number): { piece: BoardPiece; pos: number } | null => {
    const p = cur(pieceId);
    return p ? adjAt(p.coord, p.rotation ?? 0, pos, board) : null;
  };

  type ChainSource = { kind: 'ore' } | { kind: 'output'; pieceId: string; pos: number };
  // BFS the belt network from a belt endpoint adjacent to an empty input; return the
  // source feeding it (prefer unlimited ore; else a building output that still has material).
  function findChainSource(startPieceId: string, startPos: number): ChainSource | null {
    const seen = new Set<string>([`${startPieceId}:${startPos}`]);
    const queue: Array<{ pieceId: string; pos: number }> = [{ pieceId: startPieceId, pos: startPos }];
    let oreFound = false;
    const outputs: Array<{ pieceId: string; pos: number }> = [];

    while (queue.length > 0) {
      const e = queue.shift()!;
      const s = seamOf(e.pieceId, e.pos);
      if (s) {
        const role = getRole(s.piece, s.pos);
        if (role === 'ore_output') {
          oreFound = true;
        } else if (role === 'output_buffer') {
          // A teleported output is never a source for a chain (#53).
          if (!deadEnd(e.pieceId, e.pos, s) && !teleporterCutsOff(s.piece, 'output')) outputs.push({ pieceId: s.piece.id, pos: s.pos });
        } else if (beltPartner(s.piece.id, s.pos) !== null) {
          // a placed belt continues the chain on the neighbouring piece
          const key = `${s.piece.id}:${s.pos}`;
          if (!seen.has(key)) { seen.add(key); queue.push({ pieceId: s.piece.id, pos: s.pos }); }
        }
      }
      // the belt carries material across to its other endpoint
      const partner = beltPartner(e.pieceId, e.pos);
      if (partner !== null) {
        const key = `${e.pieceId}:${partner}`;
        if (!seen.has(key)) { seen.add(key); queue.push({ pieceId: e.pieceId, pos: partner }); }
      }
    }

    if (oreFound) return { kind: 'ore' };
    outputs.sort((a, b) => (a.pieceId < b.pieceId ? -1 : a.pieceId > b.pieceId ? 1 : a.pos - b.pos));
    for (const o of outputs) {
      const srcNow = cur(o.pieceId);
      const si = outputSlotIdx(srcNow, o.pos);
      if (si >= 0 && srcNow.output && srcNow.output.slots[si] != null) return { kind: 'output', pieceId: o.pieceId, pos: o.pos };
    }
    return null;
  }

  for (const building of state.board) {
    if (building.claims.length === 0) continue; // only claimed buildings receive material
    if (teleporterCutsOff(building, 'input')) continue; // nor a teleported single input (#53)
    const template = pieceTemplate(building);
    for (const ptDef of template.points) {
      if (ptDef.role !== 'input_buffer' || !ptDef.enabled) continue;
      const b = cur(building.id);
      if (!b.input) continue;
      const si = inputSlotIdx(b, ptDef.position);
      if (si < 0 || b.input.slots[si] !== null) continue; // slot invalid or already full

      const q = adjAt(b.coord, b.rotation ?? 0, ptDef.position, board);
      if (!q || q.piece.type === 'mine') continue;           // direct mine adjacency handled above
      if (beltPartner(q.piece.id, q.pos) === null) continue; // the adjacent point has no belt
      if (deadEnd(q.piece.id, q.pos, { piece: b, pos: ptDef.position })) continue; // not the belt owner's building

      const src = findChainSource(q.piece.id, q.pos);
      if (!src) continue;
      if (src.kind === 'ore') deliverOre(cur(building.id), ptDef.position);
      else moveOutput(cur(src.pieceId), src.pos, cur(building.id), ptDef.position);
    }
  }

  return changed ? { ...state, board } : state;
}
