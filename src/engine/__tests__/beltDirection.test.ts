// beltDirections: which way each belt points (display only). Chains run from a source (Mine ore
// exit, building output) to a sink (building input); undecided chains follow the click order of
// their earliest belt; a chain is always consistent end to end.

import { describe, it, expect } from 'vitest';
import { beltDirections, type BeltDirection } from '../index';
import { adjAt } from '../rules/flow';
import type { Belt, BoardPiece, GameState, PieceType } from '../state';

function piece(id: string, type: PieceType, q: number, r: number, rotation = 0): BoardPiece {
  const factory = type === 'plateFact';
  return {
    id, type, coord: { q, r }, rotation, claims: [],
    input: factory ? { slots: [null], teleporters: [] } : null,
    output: factory || type === 'mine' ? { slots: [null], teleporters: [] } : null,
  };
}

const belt = (pieceId: string, fromPoint: number, toPoint: number): Belt =>
  ({ id: `b-${pieceId}-${fromPoint}-${toPoint}`, ownerId: 0, pieceId, fromPoint, toPoint });

type Fixture = Pick<GameState, 'board' | 'belts'>;

// A row along r = 0: Mine 1 at (0,0) (its second hex at (1,0)), blanks at (2,0), (3,0), (4,0).
// On every blank, point 0 faces west and point 7 faces east; A's point 0 faces a Mine ore exit.
const MINE = piece('mine', 'mine', 0, 0);
const A = piece('A', 'blank', 2, 0);
const B = piece('B', 'blank', 3, 0);
const C = piece('C', 'blank', 4, 0);
/** Plate Factory east of B: its input (point 0) faces B's point 7. */
const F_IN = piece('F', 'plateFact', 4, 0);
/** Plate Factory east of B, turned round: its output (point 7) faces B's point 6. */
const F_OUT = piece('F', 'plateFact', 4, 0, 3);
/** Plate Factory west of A (where the mine was), turned round: its input (point 0) faces A's point 1. */
const G_IN = piece('G', 'plateFact', 1, 0, 3);

const dirs = (f: Fixture): Array<[number, number]> => beltDirections(f).map(d => [d.tail, d.head]);

/** Every join in the chain meets head to tail. */
function consistent(f: Fixture, d: readonly BeltDirection[]): boolean {
  const byPoint = new Map<string, number>();
  f.belts.forEach((b, i) => { byPoint.set(`${b.pieceId}:${b.fromPoint}`, i); byPoint.set(`${b.pieceId}:${b.toPoint}`, i); });
  return f.belts.every((b, i) => {
    const p = f.board.find(x => x.id === b.pieceId)!;
    const n = adjAt(p.coord, p.rotation ?? 0, d[i]!.head, f.board);
    const j = n ? byPoint.get(`${n.piece.id}:${n.pos}`) : undefined;
    return j === undefined || d[j]!.tail === n!.pos;
  });
}

describe('beltDirections', () => {
  it('the fixture is what the tests think it is', () => {
    expect(adjAt(A.coord, 0, 0, [MINE, A])!.piece.id).toBe('mine');
    expect(adjAt(A.coord, 0, 7, [A, B])).toEqual({ piece: B, pos: 0 });
    expect(adjAt(B.coord, 0, 7, [B, F_IN])).toEqual({ piece: F_IN, pos: 0 });
    expect(adjAt(B.coord, 0, 6, [B, F_OUT])).toEqual({ piece: F_OUT, pos: 7 });
    expect(adjAt(A.coord, 0, 1, [A, G_IN])).toEqual({ piece: G_IN, pos: 0 });
  });

  it('a chain from a Mine ore exit points away from the Mine, whichever way it was tapped', () => {
    for (const belts of [[belt('A', 0, 7), belt('B', 0, 7)], [belt('A', 7, 0), belt('B', 7, 0)], [belt('B', 7, 0), belt('A', 0, 7)]]) {
      const f = { board: [MINE, A, B], belts };
      const d = beltDirections(f);
      const byId = new Map(belts.map((b, i) => [b.pieceId, d[i]!]));
      expect(byId.get('A')).toEqual({ tail: 0, head: 7 });
      expect(byId.get('B')).toEqual({ tail: 0, head: 7 });
    }
  });

  it('a chain into a building input points at the input (claimed or not), whichever way it was tapped', () => {
    expect(dirs({ board: [A, B, F_IN], belts: [belt('A', 7, 0), belt('B', 7, 0)] })).toEqual([[0, 7], [0, 7]]);
    expect(dirs({ board: [A, B, F_IN], belts: [belt('A', 0, 7), belt('B', 0, 7)] })).toEqual([[0, 7], [0, 7]]);
    const claimed = { ...F_IN, claims: [{ ownerId: 1 as const, controlModule: 3 }] };
    expect(dirs({ board: [A, B, claimed], belts: [belt('A', 7, 0), belt('B', 7, 0)] })).toEqual([[0, 7], [0, 7]]);
  });

  it('a chain from a building output points away from it', () => {
    expect(dirs({ board: [A, B, F_OUT], belts: [belt('A', 0, 7), belt('B', 0, 6)] })).toEqual([[7, 0], [6, 0]]);
  });

  it('a three-piece chain from the Mine to an input is consistent end to end, tapped in any mix of orders', () => {
    const F = piece('F', 'plateFact', 5, 0);
    const f = { board: [MINE, A, B, C, F], belts: [belt('B', 7, 0), belt('A', 0, 7), belt('C', 7, 0)] };
    const d = beltDirections(f);
    expect(d.map(x => [x.tail, x.head])).toEqual([[0, 7], [0, 7], [0, 7]]);
    expect(consistent(f, d)).toBe(true);
  });

  it('an undecided chain follows the tap order of its earliest belt', () => {
    // A first, tapped east to west: the whole chain points west.
    let f: Fixture = { board: [A, B, C], belts: [belt('A', 7, 0), belt('B', 0, 7), belt('C', 0, 7)] };
    expect(dirs(f)).toEqual([[7, 0], [7, 0], [7, 0]]);
    expect(consistent(f, beltDirections(f))).toBe(true);
    // B first, tapped west to east: the whole chain points east.
    f = { board: [A, B, C], belts: [belt('B', 0, 7), belt('A', 7, 0), belt('C', 7, 0)] };
    expect(dirs(f)).toEqual([[0, 7], [0, 7], [0, 7]]);
    // A lone belt keeps its tap order.
    expect(dirs({ board: [A], belts: [belt('A', 7, 0)] })).toEqual([[7, 0]]);
  });

  it('extending an undecided chain so that it reaches an input turns all of it', () => {
    const belts = [belt('A', 7, 0), belt('B', 7, 0)];
    expect(dirs({ board: [A, B], belts })).toEqual([[7, 0], [7, 0]]);
    // A Plate Factory placed later at the east end: every belt now points east.
    expect(dirs({ board: [A, B, F_IN], belts })).toEqual([[0, 7], [0, 7]]);
    // Or a belt laid later on C up to a factory beyond it.
    const F = piece('F', 'plateFact', 5, 0);
    const f = { board: [A, B, C, F], belts: [...belts, belt('C', 7, 0)] };
    expect(dirs(f)).toEqual([[0, 7], [0, 7], [0, 7]]);
    expect(consistent(f, beltDirections(f))).toBe(true);
  });

  it('two sources or two sinks do not decide: the earliest belt does', () => {
    // Mine ore exit at the west end and a building output at the east end.
    expect(dirs({ board: [MINE, A, B, F_OUT], belts: [belt('B', 6, 0), belt('A', 7, 0)] })).toEqual([[6, 0], [7, 0]]);
    expect(dirs({ board: [MINE, A, B, F_OUT], belts: [belt('B', 0, 6), belt('A', 7, 0)] })).toEqual([[0, 6], [0, 7]]);
    // Inputs at both ends.
    expect(dirs({ board: [G_IN, A, B, F_IN], belts: [belt('A', 7, 1), belt('B', 0, 7)] })).toEqual([[7, 1], [7, 0]]);
    expect(dirs({ board: [G_IN, A, B, F_IN], belts: [belt('A', 1, 7), belt('B', 7, 0)] })).toEqual([[1, 7], [0, 7]]);
  });

  it('a source at one end decides even when the other end is open', () => {
    // Input at the west end only (G), nothing at the east: flows west into G.
    expect(dirs({ board: [G_IN, A, B], belts: [belt('A', 1, 7), belt('B', 0, 7)] })).toEqual([[7, 1], [7, 0]]);
  });

  it('a closed loop is consistent and follows its earliest belt', () => {
    // Three blanks around one corner; on each, a belt joins the edges facing the other two.
    const P = piece('P', 'blank', 0, 0), Q = piece('Q', 'blank', 1, 0), R = piece('R', 'blank', 0, 1);
    const board = [P, Q, R];
    const facing = (from: BoardPiece, to: BoardPiece): number[] =>
      Array.from({ length: 12 }, (_, i) => i).filter(i => adjAt(from.coord, 0, i, board)?.piece.id === to.id);
    // P: a point facing Q and a point facing R; follow the seams round.
    const pq = facing(P, Q)[0]!, pr = facing(P, R)[1]!;
    const qp = adjAt(P.coord, 0, pq, board)!.pos;
    const rp = adjAt(P.coord, 0, pr, board)!.pos;
    const qr = facing(Q, R).find(i => i !== qp)!;
    const rq = adjAt(Q.coord, 0, qr, board)!.pos;
    expect(rq).not.toBe(rp);
    const loop = [belt('Q', qr, qp), belt('P', pq, pr), belt('R', rp, rq)];
    const f = { board, belts: loop };
    const d = beltDirections(f);
    expect(consistent(f, d)).toBe(true);
    expect(d[0]).toEqual({ tail: qr, head: qp }); // the earliest belt keeps its tap order
    // Reversing the earliest belt reverses the whole loop.
    const g = { board, belts: [belt('Q', qp, qr), ...loop.slice(1)] };
    const e = beltDirections(g);
    expect(consistent(g, e)).toBe(true);
    expect(e[0]).toEqual({ tail: qp, head: qr });
    expect(e[1]).toEqual({ tail: d[1]!.head, head: d[1]!.tail });
  });

  it('separate chains are decided separately, and a belt on a missing piece keeps its tap order', () => {
    const f = { board: [MINE, A, C], belts: [belt('C', 7, 0), belt('A', 7, 0), belt('gone', 3, 9)] };
    expect(dirs(f)).toEqual([[7, 0], [0, 7], [3, 9]]);
  });
});
