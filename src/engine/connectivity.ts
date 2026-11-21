// Connectivity — how cheaply ore can be routed from a mine to a building's input,
// treating empty hexes as future BLANK pieces (all belt points available). This is the
// primitive the smart bot uses to value advantageous piece placement and belt routing —
// the supply game that the meeple-only bot ignores. Pure & deterministic.
//
// Model (hex-level): ore is available for free at every hex adjacent to a mine (the
// ore-output seam). To carry ore one hex further, the carrying hex needs a belt
// (cost BELT_W) if a piece already sits there, or a future blank + belt (PIECE_W + BELT_W)
// if the hex is empty. A building is "connected" once ore reaches its hex. We Dijkstra
// from the mines and report the cheapest { belts, newPieces } to reach the building.
//   • belts    = belts to lay on already-placed pieces along the route
//   • newPieces = empty hexes the route needs a (future) blank placed on
//
// Ore sources: a hex next to a mine is ore-bearing only when one of the mine's ore outputs
// faces it (every external edge of the rich hex; on the lean hex only mine 1 has any, on 3
// of its 5 external edges — see config MINE_LEAN_ORE_OUTPUTS).
//
// Approximations (intentional for v1; refine if the feature needs it): relaying is
// allowed across any non-mine placed piece; the
// belt >2-apart point geometry and opponent-blocked points are ignored; the building is
// assumed orientable so an input can face the route.

import type { GameState, HexCoord } from './state';
import { hexNeighbours, mineSecondaryCoord } from './rules/pieces';
import { adjAt, getRole } from './rules/flow';

export interface ConnectionCost {
  readonly belts: number;     // belts to lay on existing pieces
  readonly newPieces: number; // empty hexes needing a future blank
  readonly cost: number;      // weighted scalar = belts*BELT_W + newPieces*PIECE_W
}

export const BELT_W = 1;   // a belt is cheap (≤1 ore; first 5 free)
export const PIECE_W = 3;  // committing a placement to a spot is worth ~3 belts of effort (tunable)
const MAX_EXPANSIONS = 4000; // bound the search over open (empty) space

const key = (h: HexCoord): string => `${h.q},${h.r}`;

// Cheapest ore connection from any mine to `buildingId`'s hex, or null if none is found
// within the search bound (or there is no mine / no such building).
export function oreConnectionCost(state: GameState, buildingId: string): ConnectionCost | null {
  const building = state.board.find(p => p.id === buildingId);
  if (!building) return null;
  const target = key(building.coord);

  const mineHexes = new Set<string>();      // sources; also impassable (no belts on a mine)
  const placedHexes = new Set<string>();    // non-mine placed pieces (relay at BELT_W)
  for (const p of state.board) {
    if (p.type === 'mine') {
      mineHexes.add(key(p.coord));
      mineHexes.add(key(mineSecondaryCoord(p.coord, p.rotation ?? 0)));
    } else {
      placedHexes.add(key(p.coord));
    }
  }
  if (mineHexes.size === 0) return null;

  interface Node { h: HexCoord; cost: number; belts: number; newPieces: number }
  const dist = new Map<string, number>();
  const heap: Node[] = [];
  const push = (n: Node): void => {
    heap.push(n);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heap[p]!.cost <= heap[i]!.cost) break;
      [heap[p], heap[i]] = [heap[i]!, heap[p]!];
      i = p;
    }
  };
  const pop = (): Node | undefined => {
    if (heap.length === 0) return undefined;
    const top = heap[0]!;
    const last = heap.pop()!;
    if (heap.length > 0) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = 2 * i + 2;
        let m = i;
        if (l < heap.length && heap[l]!.cost < heap[m]!.cost) m = l;
        if (r < heap.length && heap[r]!.cost < heap[m]!.cost) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i]!, heap[m]!];
        i = m;
      }
    }
    return top;
  };

  const relax = (h: HexCoord, cost: number, belts: number, newPieces: number): void => {
    const k = key(h);
    if (mineHexes.has(k)) return; // can't deliver into / relay through a mine
    const prev = dist.get(k);
    if (prev !== undefined && prev <= cost) return;
    dist.set(k, cost);
    push({ h, cost, belts, newPieces });
  };

  // Inject: ore is free at every non-mine neighbour of a mine hex that an ore output faces.
  // (Probed from the neighbour's side: any of its 12 points whose aligned mine point is an
  // ore output. adjAt only needs the coordinate, so the neighbour may be empty.)
  const oreBearing = (h: HexCoord): boolean => {
    for (let pos = 0; pos < 12; pos++) {
      const a = adjAt(h, 0, pos, state.board);
      if (a && a.piece.type === 'mine' && getRole(a.piece, a.pos) === 'ore_output') return true;
    }
    return false;
  };
  for (const mk of mineHexes) {
    const parts = mk.split(',');
    const h: HexCoord = { q: Number(parts[0]), r: Number(parts[1]) };
    for (const n of hexNeighbours(h)) if (!mineHexes.has(key(n)) && oreBearing(n)) relax(n, 0, 0, 0);
  }

  let expansions = 0;
  for (;;) {
    const node = pop();
    if (!node) break;
    const k = key(node.h);
    if (k === target) return { belts: node.belts, newPieces: node.newPieces, cost: node.cost };
    if ((dist.get(k) ?? Infinity) < node.cost) continue;      // stale heap entry
    if (++expansions > MAX_EXPANSIONS) break;
    // Relay across node.h: it hosts a belt (placed → BELT_W; empty → place a blank + belt).
    const placed = placedHexes.has(k);
    const cost = node.cost + BELT_W + (placed ? 0 : PIECE_W);
    const belts = node.belts + 1;
    const newPieces = node.newPieces + (placed ? 0 : 1);
    for (const n of hexNeighbours(node.h)) relax(n, cost, belts, newPieces);
  }
  return null;
}
