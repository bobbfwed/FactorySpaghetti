import { describe, it, expect } from 'vitest';
import { createGame } from '../rules/setup';
import { findRoute, routeSources, routeDests, findBeltPath, usableBeltPoints } from '../routing';
import { resolveDirectAdjacency } from '../rules/flow';
import type { GameState, BoardPiece, PieceType, PlayerId, Belt } from '../state';

// ── Fixture helpers ───────────────────────────────────────────────────────────
// Routing reads piece TEMPLATES (point roles), coords, rotations and claims — not the
// buffer contents — so fixtures can leave input/output null.

function mk(
  id: string,
  type: PieceType,
  coord: { q: number; r: number },
  rotation = 0,
  claims: Array<{ ownerId: PlayerId; controlModule: number }> = [],
): BoardPiece {
  return { id, type, coord, rotation, claims, input: null, output: null };
}

function fixture(board: BoardPiece[], belts: Belt[] = []): GameState {
  return { ...createGame(1, 2), board, belts };
}

// Mine-1 at (0,0) rot0 → lean hex (1,0). Its ore-output point facing the hex east of the
// lean side, (2,0), is position 17. A single-hex piece at (2,0) faces the mine on its
// left edge (point 0) and the hex at (3,0) on its right edge (point 7).
const MINE_ORE_EAST = 17;
const claimMe = [{ ownerId: 0 as PlayerId, controlModule: 3 }];

// ── Tests ───────────────────────────────────────────────────────────────────

describe('findRoute', () => {
  it('routes a single belt across a blank from a mine to a claimed factory input', () => {
    const state = fixture([
      mk('mine', 'mine', { q: 0, r: 0 }),
      mk('bk', 'blank', { q: 2, r: 0 }),
      mk('pf', 'plateFact', { q: 3, r: 0 }, 0, claimMe),
    ]);
    const route = findRoute(state, { pieceId: 'mine', position: MINE_ORE_EAST }, { pieceId: 'pf', position: 0 }, 0);

    expect(route).not.toBeNull();
    expect(route!.cost).toBe(1);
    expect(route!.belts).toHaveLength(1);
    expect(route!.belts[0]).toEqual({ pieceId: 'bk', fromPoint: 0, toPoint: 7 });
  });

  it('routeSources / routeDests enumerate the right connection points for the UI picker', () => {
    const state = fixture([
      mk('mine', 'mine', { q: 0, r: 0 }),
      mk('pf', 'plateFact', { q: 3, r: 0 }, 0, claimMe),                          // mine + my factory
      mk('opp', 'plateFact', { q: 5, r: 0 }, 0, [{ ownerId: 1, controlModule: 3 }]),
    ]);
    const sources = routeSources(state, 0);
    const dests = routeDests(state, 0);

    expect(sources.some(s => s.pieceId === 'mine')).toBe(true);          // neutral ore outputs
    expect(sources).toContainEqual({ pieceId: 'pf', position: 7 });      // my plate factory output (#8)
    expect(sources.some(s => s.pieceId === 'opp')).toBe(false);          // not an opponent's output

    expect(dests).toContainEqual({ pieceId: 'pf', position: 0 });        // my plate factory input (#1)
    expect(dests.some(d => d.pieceId === 'opp' || d.pieceId === 'mine')).toBe(false);
  });

  it('findBeltPath / usableBeltPoints: connect two belt points the player clicks', () => {
    // mine + blank(2,0) + my factory(3,0). usableBeltPoints highlights every placeable
    // belt point — including the blank's point 0 (faces the mine) and point 7 (faces the
    // factory input) — and excludes points already taken by another belt.
    const state = fixture(
      [
        mk('mine', 'mine', { q: 0, r: 0 }),
        mk('bk', 'blank', { q: 2, r: 0 }),
        mk('pf', 'plateFact', { q: 3, r: 0 }, 0, claimMe),
      ],
      [{ id: 'x', ownerId: 0, pieceId: 'bk', fromPoint: 3, toPoint: 9 }], // occupies bk points 3 and 9
    );
    const endpoints = usableBeltPoints(state, 0);
    expect(endpoints).toContainEqual({ pieceId: 'bk', position: 0 });     // next to the mine
    expect(endpoints).toContainEqual({ pieceId: 'bk', position: 7 });     // next to the factory input
    expect(endpoints).not.toContainEqual({ pieceId: 'bk', position: 3 }); // taken by belt x
    expect(endpoints).not.toContainEqual({ pieceId: 'bk', position: 9 }); // taken by belt x

    const route = findBeltPath(state, { pieceId: 'bk', position: 0 }, { pieceId: 'bk', position: 7 }, 0);
    expect(route).not.toBeNull();
    expect(route!.cost).toBe(1);
    expect(route!.belts[0]).toEqual({ pieceId: 'bk', fromPoint: 0, toPoint: 7 });
  });

  it('findBeltPath chains belt points across two pieces (fewest belts)', () => {
    const state = fixture([
      mk('mine', 'mine', { q: 0, r: 0 }),
      mk('a', 'blank', { q: 2, r: 0 }),
      mk('b', 'blank', { q: 3, r: 0 }),
      mk('pf', 'plateFact', { q: 4, r: 0 }, 0, claimMe),
    ]);
    const route = findBeltPath(state, { pieceId: 'a', position: 0 }, { pieceId: 'b', position: 7 }, 0);
    expect(route).not.toBeNull();
    expect(route!.cost).toBe(2);
    expect(route!.belts.map(b => b.pieceId)).toEqual(['a', 'b']);
  });

  it('chains two belts when the factory is two pieces away (fewest belts)', () => {
    const state = fixture([
      mk('mine', 'mine', { q: 0, r: 0 }),
      mk('a', 'blank', { q: 2, r: 0 }),
      mk('b', 'blank', { q: 3, r: 0 }),
      mk('pf', 'plateFact', { q: 4, r: 0 }, 0, claimMe),
    ]);
    const route = findRoute(state, { pieceId: 'mine', position: MINE_ORE_EAST }, { pieceId: 'pf', position: 0 }, 0);

    expect(route).not.toBeNull();
    expect(route!.cost).toBe(2);
    expect(route!.belts.map(b => b.pieceId)).toEqual(['a', 'b']); // ordered source → dest
  });

  it('all returned belts respect the >2-apart rule', () => {
    const state = fixture([
      mk('mine', 'mine', { q: 0, r: 0 }),
      mk('a', 'blank', { q: 2, r: 0 }),
      mk('b', 'blank', { q: 3, r: 0 }),
      mk('pf', 'plateFact', { q: 4, r: 0 }, 0, claimMe),
    ]);
    const route = findRoute(state, { pieceId: 'mine', position: MINE_ORE_EAST }, { pieceId: 'pf', position: 0 }, 0)!;
    for (const b of route.belts) {
      const d = Math.min(Math.abs(b.fromPoint - b.toPoint), 12 - Math.abs(b.fromPoint - b.toPoint));
      expect(d).toBeGreaterThan(2);
    }
  });

  it('returns a 0-belt route when the source already faces the dest input directly', () => {
    const state = fixture([
      mk('mine', 'mine', { q: 0, r: 0 }),
      mk('pf', 'plateFact', { q: 2, r: 0 }, 0, claimMe), // input (pos 0) faces the lean hex (1,0)
    ]);
    const route = findRoute(state, { pieceId: 'mine', position: MINE_ORE_EAST }, { pieceId: 'pf', position: 0 }, 0);
    expect(route).toEqual({ belts: [], cost: 0 });
  });

  it('returns null when there is no connecting piece between source and dest', () => {
    const state = fixture([
      mk('mine', 'mine', { q: 0, r: 0 }),
      mk('pf', 'plateFact', { q: 5, r: 0 }, 0, claimMe), // far away, nothing adjacent to the mine
    ]);
    const route = findRoute(state, { pieceId: 'mine', position: MINE_ORE_EAST }, { pieceId: 'pf', position: 0 }, 0);
    expect(route).toBeNull();
  });

  it('respects maxBelts (a 2-belt route is rejected at maxBelts=1)', () => {
    const state = fixture([
      mk('mine', 'mine', { q: 0, r: 0 }),
      mk('a', 'blank', { q: 2, r: 0 }),
      mk('b', 'blank', { q: 3, r: 0 }),
      mk('pf', 'plateFact', { q: 4, r: 0 }, 0, claimMe),
    ]);
    expect(findRoute(state, { pieceId: 'mine', position: MINE_ORE_EAST }, { pieceId: 'pf', position: 0 }, 0, 1)).toBeNull();
    expect(findRoute(state, { pieceId: 'mine', position: MINE_ORE_EAST }, { pieceId: 'pf', position: 0 }, 0, 2)).not.toBeNull();
  });

  it('returns null when the only entry point is already used by another belt', () => {
    const state = fixture(
      [
        mk('mine', 'mine', { q: 0, r: 0 }),
        mk('bk', 'blank', { q: 2, r: 0 }),
        mk('pf', 'plateFact', { q: 3, r: 0 }, 0, claimMe),
      ],
      [{ id: 'x', ownerId: 1, pieceId: 'bk', fromPoint: 0, toPoint: 6 }], // occupies the entry point 0
    );
    const route = findRoute(state, { pieceId: 'mine', position: MINE_ORE_EAST }, { pieceId: 'pf', position: 0 }, 0);
    expect(route).toBeNull();
  });

  it('refuses to route into an opponent-claimed building', () => {
    const state = fixture([
      mk('mine', 'mine', { q: 0, r: 0 }),
      mk('bk', 'blank', { q: 2, r: 0 }),
      mk('pf', 'plateFact', { q: 3, r: 0 }, 0, [{ ownerId: 1, controlModule: 3 }]),
    ]);
    const route = findRoute(state, { pieceId: 'mine', position: MINE_ORE_EAST }, { pieceId: 'pf', position: 0 }, 0);
    expect(route).toBeNull();
  });

  it('its prescribed belts actually carry material end-to-end (router ↔ flow agree)', () => {
    // Build a real factory with an input buffer, find a 2-belt route, place exactly those
    // belts, resolve flow, and confirm ore arrives — proving the router and the resolver
    // share the same belt geometry.
    const pf: BoardPiece = {
      id: 'pf', type: 'plateFact', coord: { q: 4, r: 0 }, rotation: 0,
      claims: claimMe,
      input: { slots: [null], teleporterOwner: null },
      output: { slots: [null], teleporterOwner: null },
    };
    const state = fixture([
      mk('mine', 'mine', { q: 0, r: 0 }),
      mk('a', 'blank', { q: 2, r: 0 }),
      mk('b', 'blank', { q: 3, r: 0 }),
      pf,
    ]);

    const route = findRoute(state, { pieceId: 'mine', position: MINE_ORE_EAST }, { pieceId: 'pf', position: 0 }, 0);
    expect(route).not.toBeNull();
    expect(route!.cost).toBe(2);

    const belts: Belt[] = route!.belts.map((bp, i) => ({
      id: `r${i}`, ownerId: 0 as PlayerId, pieceId: bp.pieceId, fromPoint: bp.fromPoint, toPoint: bp.toPoint,
    }));
    const after = resolveDirectAdjacency({ ...state, belts });
    expect(after.board.find(p => p.id === 'pf')!.input?.slots[0]).toBe('ore');
  });

  it('routes through a blank to a deeper input while an opponent building sits off to the side', () => {
    // A second blank at (2,-1) is adjacent to an opponent factory at (2,-2); routing must
    // still succeed via the clean (2,0) blank and not get confused by the opponent piece.
    const state = fixture([
      mk('mine', 'mine', { q: 0, r: 0 }),
      mk('bk', 'blank', { q: 2, r: 0 }),
      mk('pf', 'plateFact', { q: 3, r: 0 }, 0, claimMe),
      mk('opp', 'plateFact', { q: 2, r: -2 }, 0, [{ ownerId: 1, controlModule: 3 }]),
    ]);
    const route = findRoute(state, { pieceId: 'mine', position: MINE_ORE_EAST }, { pieceId: 'pf', position: 0 }, 0);
    expect(route).not.toBeNull();
    expect(route!.cost).toBe(1);
  });
});

// ── Self-loop guard: a route must never reuse a connection point ──────────────

// True if any two belts in the route share the same (pieceId, point) — an illegal placement
// the engine would reject as POINT_OCCUPIED.
function routeReusesPoint(route: { belts: ReadonlyArray<{ pieceId: string; fromPoint: number; toPoint: number }> }): boolean {
  const seen = new Set<string>();
  for (const b of route.belts) {
    for (const pt of [b.fromPoint, b.toPoint]) {
      const k = `${b.pieceId}:${pt}`;
      if (seen.has(k)) return true;
      seen.add(k);
    }
  }
  return false;
}

describe('router never reuses a connection point (self-loop guard)', () => {
  // A dense blank cluster (centre + all six neighbours) is full of cycles, so shortest paths
  // routinely wrap back onto a piece. Before the fix, 58 of ~7000 belt paths here reused a
  // point (illegal — the engine rejects the 2nd belt as POINT_OCCUPIED).
  const cluster = () => fixture([
    mk('bk0', 'blank', { q: 0, r: 0 }),
    mk('bk1', 'blank', { q: 1, r: 0 }),
    mk('bk2', 'blank', { q: -1, r: 0 }),
    mk('bk3', 'blank', { q: 0, r: 1 }),
    mk('bk4', 'blank', { q: 0, r: -1 }),
    mk('bk5', 'blank', { q: 1, r: -1 }),
    mk('bk6', 'blank', { q: -1, r: 1 }),
  ]);

  it('every belt path between two usable points is placeable (no reused points)', () => {
    const state = cluster();
    const pts = usableBeltPoints(state, 0);
    let routesFound = 0;
    for (let i = 0; i < pts.length; i++) {
      for (let j = 0; j < pts.length; j++) {
        if (i === j) continue;
        const r = findBeltPath(state, pts[i]!, pts[j]!, 0, 8);
        if (r && r.belts.length > 0) {
          routesFound++;
          expect(routeReusesPoint(r), `route ${pts[i]!.pieceId}:${pts[i]!.position} → ${pts[j]!.pieceId}:${pts[j]!.position} reused a point`).toBe(false);
        }
      }
    }
    expect(routesFound).toBeGreaterThan(0);
  });
});
