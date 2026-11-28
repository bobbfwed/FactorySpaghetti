// Ownership: nothing crosses between players (RULES_CHANGES.md #57, #58).
//
// A building has at most one owner: all its claims (Control Modules) belong to one player (#57).
// When a building loses its owner (today only Changing Priorities can move a player's last
// Control Module off it), everything on it is settled at once, after the move (#58):
//   - every Teleporter on it goes back to the player who placed it (#37);
//   - every material in its inputs and its output goes to the bank (it is dropped: the engine
//     keeps no bank count), so an unclaimed building never holds material;
//   - a pending operate-or-skip decision about it is dropped (no decision is ever left pointing
//     at a building its player no longer owns).
// Pure helpers, shared by the engine, the interface and the bots.

import type { BoardPiece, GameState, PlayerId } from '../state';
import { teleportersOf, withTeleporter } from './teleporters';

const BUILDING_TYPES: ReadonlySet<BoardPiece['type']> = new Set(['plateFact', 'sphereFact', 'tesseractFact', 'powerPlant']);

/** True for a piece that can be claimed (a factory or a Power Plant; not a Mine or a blank tile). */
export function isBuilding(piece: Pick<BoardPiece, 'type'>): boolean {
  return BUILDING_TYPES.has(piece.type);
}

/**
 * The owner of `piece` (the player whose claims it holds), or null when it is unclaimed. Every
 * claim on a building belongs to this one player (#57), so code that looks at "the owner" needs
 * no loop over owners. Only for a checked game state: save checking, which reads unvalidated
 * input, looks at every claim itself.
 */
export function buildingOwner(piece: Pick<BoardPiece, 'claims'>): PlayerId | null {
  return piece.claims[0]?.ownerId ?? null;
}

/**
 * Whether `playerId` may add a claim to `piece` as far as ownership goes: only when it is
 * unclaimed or every claim on it is already theirs (#57). The one test for every claiming route
 * (CLAIM_BUILDING, Short Sale, Changing Priorities) and their listing in legalActions. The limit
 * of MAX_CLAIMS_PER_BUILDING claims is checked separately.
 */
export function mayAddClaim(piece: Pick<BoardPiece, 'claims'>, playerId: PlayerId): boolean {
  return piece.claims.every(c => c.ownerId === playerId);
}

/** True when the claims on `piece` belong to more than one player (a state the rules forbid, #57). */
export function hasTwoOwners(piece: Pick<BoardPiece, 'claims'>): boolean {
  const first = piece.claims[0]?.ownerId;
  return piece.claims.some(c => c.ownerId !== first);
}

/** How many materials lie in `piece`'s inputs and output. */
export function materialsIn(piece: Pick<BoardPiece, 'input' | 'output'>): number {
  const count = (slots: ReadonlyArray<unknown> | undefined): number => (slots ?? []).filter(m => m != null).length;
  return count(piece.input?.slots) + count(piece.output?.slots);
}

/**
 * What `playerId` gives up if one of their Control Modules leaves `piece` (Changing Priorities):
 * when it is their last claim there, the building has no owner afterwards, so its materials go to
 * the bank and their Teleporters on it come back to them (#58). Zero of each otherwise. For the
 * interface's warning, the log line and the bots.
 */
export function lossIfModuleLeaves(piece: BoardPiece, playerId: PlayerId): { materials: number; teleporters: number } {
  if (piece.claims.length !== 1 || buildingOwner(piece) !== playerId) return { materials: 0, teleporters: 0 };
  const teleporters = [...teleportersOf(piece.input), ...teleportersOf(piece.output)].filter(t => t.owner === playerId).length;
  return { materials: materialsIn(piece), teleporters };
}

// A building whose settlement would change something: a Teleporter whose placer holds no claim
// there, or material lying in an unclaimed building.
function unsettled(piece: BoardPiece): boolean {
  if (!isBuilding(piece)) return false;
  const lost = (owner: PlayerId | null | undefined): boolean => owner != null && !piece.claims.some(c => c.ownerId === owner);
  if (piece.input?.teleporters.some(lost) || piece.output?.teleporters.some(lost)) return true;
  return piece.claims.length === 0 && materialsIn(piece) > 0;
}

/**
 * Settle every building that lost a claim (#37, #58): Teleporters whose placer holds no claim on
 * their building go back to that player (and the Teleporter price drops with the count on the
 * board); an unclaimed building's inputs and output are emptied to the bank; pending
 * operate-or-skip decisions of a player about a building they hold no claim on are dropped.
 * Pure; run after every action (reducer), so every claim-removing effect is covered, and an older
 * save that left material in an unclaimed building is emptied at the first move. Returns `state`
 * itself when nothing changes (the common case: this runs after every move a bot tries).
 */
export function settleLostClaims(state: GameState): GameState {
  const holds = (pieceId: string, owner: PlayerId): boolean =>
    !!state.board.find(p => p.id === pieceId)?.claims.some(c => c.ownerId === owner);
  const stalePending = state.pendingFactoryOps.some(e => !holds(e.pieceId, e.ownerId));
  if (!stalePending && !state.board.some(unsettled)) return state;

  let returned = 0;
  let players = state.players;
  const board = state.board.map(piece => {
    if (!unsettled(piece)) return piece;
    let next = piece;
    for (const side of ['input', 'output'] as const) {
      for (const { slot, owner } of teleportersOf(next[side])) {
        if (next.claims.some(c => c.ownerId === owner)) continue;
        next = { ...next, [side]: withTeleporter(next[side]!, slot, null) };
        players = players.map(p => (p.id === owner ? { ...p, teleportersRemaining: p.teleportersRemaining + 1 } : p));
        returned++;
      }
    }
    if (next.claims.length === 0) {
      // Nobody owns it: its material goes to the bank (#58).
      if (next.input) next = { ...next, input: { ...next.input, slots: next.input.slots.map(() => null) } };
      if (next.output) next = { ...next, output: { ...next.output, slots: next.output.slots.map(() => null) } };
    }
    return next;
  });
  const pendingFactoryOps = stalePending
    ? state.pendingFactoryOps.filter(e => holds(e.pieceId, e.ownerId))
    : state.pendingFactoryOps;
  return {
    ...state, board, players, pendingFactoryOps,
    globalTeleporterCount: Math.max(0, state.globalTeleporterCount - returned),
  };
}
