// Belt connection points follow the printed pieces (RULES_CHANGES.md #30), points facing a
// claimed building's input or output are reserved for its owner (#31), and mines 2 and 3 have
// no ore exits on their lean hex (#32).

import { describe, it, expect } from 'vitest';
import { createGame } from '../rules/setup';
import { applyAction, legalActions } from '../reducer';
import { adjAt, fillInputsFromAdjacentMines, resolveDirectAdjacency } from '../rules/flow';
import { oreConnectionCost } from '../connectivity';
import { pieceTemplate } from '../config';
import type { Action } from '../actions';
import type { Belt, BoardPiece, GameState, PieceType, PlayerId } from '../state';

type Claims = BoardPiece['claims'];

function piece(id: string, type: PieceType, q: number, r: number, rotation = 0, claims: Claims = []): BoardPiece {
  const inputs = type === 'plateFact' || type === 'powerPlant' ? 1 : type === 'sphereFact' ? 2 : type === 'tesseractFact' ? 3 : 0;
  const hasOutput = type === 'plateFact' || type === 'sphereFact' || type === 'tesseractFact';
  return {
    id, type, coord: { q, r }, rotation, claims,
    input: inputs ? { slots: new Array(inputs).fill(null), teleporters: [] } : null,
    output: hasOutput || type === 'mine' ? { slots: [null], teleporters: [] } : null,
  };
}

// Player `active` (0 or 1) in the actions phase, with plenty of belts.
function actionsState(board: BoardPiece[], belts: Belt[] = [], active: PlayerId = 0): GameState {
  const g = createGame(1, 2);
  return {
    ...g, board, belts, turnOrder: [active, active === 0 ? 1 : 0], activePlayerIndex: 0, phase: 'actions',
    players: g.players.map(p => ({ ...p, beltsRemaining: 10 })),
  };
}

const belt = (pieceId: string, fromPoint: number, toPoint: number): Action => ({ type: 'PLACE_BELT', pieceId, fromPoint, toPoint });
const errCode = (s: GameState, a: Action): string | null => { const r = applyAction(s, a); return r.ok ? null : r.error.code; };
const listed = (s: GameState, a: Action, who: PlayerId = 0): boolean =>
  legalActions(s, who).some(x => JSON.stringify(x) === JSON.stringify(a));

// Mine 1 layout at (0,0) rot 0 (lean hex at (1,0)). Blank A at (2,0): its point 0 faces the
// lean hex's ore output, its point 7 faces F's INPUT (point 0). Factory F at (3,0) rot 0.
// Blank C at (4,0): its point 0 faces F's OUTPUT (point 7).
const MINE = piece('mine', 'mine', 0, 0);
const A = piece('A', 'blank', 2, 0);
const C = piece('C', 'blank', 4, 0);
const F = (claims: Claims): BoardPiece => piece('F', 'plateFact', 3, 0, 0, claims);

describe('belt points on building pieces (#30)', () => {
  it('the template belt points per building type', () => {
    const beltPoints = (type: PieceType): number[] =>
      pieceTemplate({ type, id: 'x' }).points.filter(p => p.enabled && p.role === 'belt').map(p => p.position);
    expect(beltPoints('plateFact')).toEqual([2, 3, 4, 5, 8, 9, 10, 11]);
    expect(beltPoints('sphereFact')).toEqual([3, 4, 5, 9, 10, 11]);
    expect(beltPoints('tesseractFact')).toEqual([3, 4, 9, 10]);
    expect(beltPoints('powerPlant')).toEqual([2, 3, 4, 5, 8, 9, 10, 11]);
    expect(beltPoints('blank')).toHaveLength(12);
  });

  it("a belt on another player's claimed building, between two of its belt points, is legal", () => {
    for (const [type, from, to] of [['plateFact', 2, 8], ['powerPlant', 5, 11], ['sphereFact', 5, 11], ['tesseractFact', 4, 9]] as const) {
      const opp = piece('opp', type, 3, 0, 0, [{ ownerId: 1, controlModule: 3 }]);
      const s = actionsState([MINE, opp]);
      expect(errCode(s, belt('opp', from, to)), type).toBeNull();
      expect(listed(s, belt('opp', from, to)), type).toBe(true);
    }
  });

  it('holes that are not on the printed piece stay closed', () => {
    const s = actionsState([MINE, F([])]);
    expect(errCode(s, belt('F', 1, 5))).toBe('NOT_A_BELT_POINT'); // no hole at 1
    expect(errCode(s, belt('F', 2, 6))).toBe('NOT_A_BELT_POINT'); // no hole at 6
    expect(errCode(s, belt('F', 0, 4))).toBe('NOT_A_BELT_POINT'); // 0 is the input
  });
});

describe('points facing a claimed building are reserved for its owner (#31)', () => {
  const cases: Array<{ who: string; claims: Claims; ok: boolean }> = [
    { who: 'unclaimed', claims: [], ok: true },
    { who: 'owner', claims: [{ ownerId: 0, controlModule: 3 }], ok: true },
    { who: 'owner with two claims', claims: [{ ownerId: 0, controlModule: 3 }, { ownerId: 0, controlModule: 4 }], ok: true },
    { who: 'non-owner', claims: [{ ownerId: 1, controlModule: 3 }, { ownerId: 1, controlModule: 5 }], ok: false },
  ];
  for (const c of cases) {
    it(`${c.who}: ${c.ok ? 'may' : 'may not'} end a belt facing the input or the output`, () => {
      const s = actionsState([MINE, A, F(c.claims), C]);
      for (const a of [belt('A', 0, 7) /* faces F's input */, belt('C', 0, 7) /* faces F's output */]) {
        expect(errCode(s, a), JSON.stringify(a)).toBe(c.ok ? null : 'POINT_RESERVED');
        expect(listed(s, a), JSON.stringify(a)).toBe(c.ok);
      }
    });
  }

  it("joining another player's belt is still refused, with its own code", () => {
    // Player 1's belt on blank B uses B's point 0, which faces A's point 7.
    const s = actionsState([MINE, A, piece('B', 'blank', 3, 0)], [{ id: 'b1', ownerId: 1, pieceId: 'B', fromPoint: 0, toPoint: 7 }]);
    expect(errCode(s, belt('A', 0, 7))).toBe('BELT_BLOCKED');
    expect(listed(s, belt('A', 0, 7))).toBe(false);
  });

  it('legalActions lists exactly the belts the engine accepts on the reservation board', () => {
    for (const c of cases) {
      const s = actionsState([MINE, A, F(c.claims), C]);
      const legal = new Set(legalActions(s, 0).filter(a => a.type === 'PLACE_BELT').map(a => JSON.stringify(a)));
      for (const p of s.board) {
        const n = p.type === 'mine' ? 24 : 12;
        for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
          const a = belt(p.id, i, j);
          expect(legal.has(JSON.stringify(a)), `${c.who} ${p.id} ${i}-${j}`).toBe(errCode(s, a) === null);
        }
      }
    }
  });

  it('a belt already lying at the point stays when someone else claims the building later, but stops feeding it (#38)', () => {
    // Player 0 lays A 0→7 into the unclaimed factory's input.
    let s = actionsState([MINE, A, F([])]);
    const placed = applyAction(s, belt('A', 0, 7));
    expect(placed.ok).toBe(true);
    if (!placed.ok) return;
    // Now player 1 claims the factory with Short Sale on their turn.
    s = {
      ...placed.state, turnOrder: [1, 0], activePlayerIndex: 0, cardsPlayedThisTurn: 0,
      players: placed.state.players.map(p => (p.id === 1 ? { ...p, hand: ['shortSale'] } : p)),
    };
    const claimed = applyAction(s, { type: 'PLAY_CARD', cardType: 'shortSale', pieceId: 'F' });
    expect(claimed.ok).toBe(true);
    if (!claimed.ok) return;
    expect(claimed.state.board.find(p => p.id === 'F')!.claims.map(c => c.ownerId)).toEqual([1]);
    expect(claimed.state.belts.map(b => b.id)).toEqual(placed.state.belts.map(b => b.id)); // untouched
    // Player 0's belt is now a dead end at player 1's factory: no ore goes in (RULES_CHANGES #38).
    const flowed = resolveDirectAdjacency(claimed.state);
    expect(flowed.board.find(p => p.id === 'F')!.input!.slots[0]).toBeNull();
    // But player 0 could not lay it again now.
    const again = actionsState([MINE, A, F([{ ownerId: 1, controlModule: 1 }])]);
    expect(errCode(again, belt('A', 0, 7))).toBe('POINT_RESERVED');
  });
});

describe('mines 2 and 3 have ore exits only on their rich hex (#32)', () => {
  // A claimed Plate Factory at (2,0) rot 0 has its input facing the lean hex's ore exit of
  // mine 1 (position 17); one at (-1,0) rot 3 faces the rich hex.
  const pfLean = (): BoardPiece => piece('pfLean', 'plateFact', 2, 0, 0, [{ ownerId: 0, controlModule: 4 }]);
  const pfRich = (): BoardPiece => piece('pfRich', 'plateFact', -1, 0, 3, [{ ownerId: 0, controlModule: 4 }]);
  const slot = (s: GameState, id: string): unknown => s.board.find(p => p.id === id)!.input!.slots[0];

  for (const [mineId, leanOre] of [['mine-1', true], ['mine-2', false], ['mine-3', false]] as const) {
    it(`${mineId}: lean-hex neighbour ${leanOre ? 'gets' : 'gets no'} ore; rich-hex neighbour gets ore`, () => {
      const s = actionsState([piece(mineId, 'mine', 0, 0), pfLean(), pfRich()]);
      const after = fillInputsFromAdjacentMines(s);
      expect(slot(after, 'pfLean')).toBe(leanOre ? 'ore' : null);
      expect(slot(after, 'pfRich')).toBe('ore');
    });
  }

  it('no ore along a belt from mine 2\'s lean hex either', () => {
    const board = (mineId: string): BoardPiece[] =>
      [piece(mineId, 'mine', 0, 0), A, F([{ ownerId: 0, controlModule: 4 }])];
    const withBelt = (mineId: string): GameState =>
      actionsState(board(mineId), [{ id: 'b', ownerId: 0, pieceId: 'A', fromPoint: 0, toPoint: 7 }]);
    expect(slot(resolveDirectAdjacency(withBelt('mine-1')), 'F')).toBe('ore');
    expect(slot(resolveDirectAdjacency(withBelt('mine-2')), 'F')).toBeNull();
  });

  it("the ore-connection estimate knows mine 2's lean hex gives no ore", () => {
    const s = (mineId: string): GameState => actionsState([piece(mineId, 'mine', 0, 0), piece('pf', 'plateFact', 2, 0)]);
    expect(oreConnectionCost(s('mine-1'), 'pf')).toEqual({ belts: 0, newPieces: 0, cost: 0 });
    expect(oreConnectionCost(s('mine-2'), 'pf')!.cost).toBeGreaterThan(0);
  });

  it('setup and the stacks give the three mines the ids the templates use', () => {
    const g = createGame(7, 3);
    expect(g.board.filter(p => p.type === 'mine').map(p => p.id)).toEqual(['mine-1']);
    expect(g.unplacedMines.map(m => m.id)).toEqual(['mine-2', 'mine-3']);
  });
});

// The same reservation rule with every rotation of both pieces and every side: the pieces are
// put down at all 6 × 6 rotations and the belt points facing a buffer are found through the
// engine's own edge geometry (adjAt), so these cases do not depend on hand-worked positions.
describe('reservation with rotated neighbours (#31)', () => {
  const CELLS = [{ q: 1, r: 0 }, { q: -1, r: 0 }, { q: 0, r: 1 }, { q: 0, r: -1 }, { q: 1, r: -1 }, { q: -1, r: 1 }];
  const P0: Claims = [{ ownerId: 0, controlModule: 4 }];
  const P1: Claims = [{ ownerId: 1, controlModule: 4 }];
  const P0x2: Claims = [{ ownerId: 0, controlModule: 4 }, { ownerId: 0, controlModule: 5 }];
  const OWNER_CASES: Array<{ claims: Claims; reserved: boolean }> = [
    { claims: [], reserved: false }, { claims: P0, reserved: false }, { claims: P0x2, reserved: false }, { claims: P1, reserved: true },
  ];

  const beltPointsOf = (p: BoardPiece): number[] => pieceTemplate(p).points.filter(d => d.enabled && d.role === 'belt').map(d => d.position);
  const isBuffer = (p: BoardPiece, pos: number): boolean => {
    const role = pieceTemplate(p).points.find(d => d.position === pos)?.role;
    return role === 'input_buffer' || role === 'output_buffer';
  };
  // What point `pos` of `p` faces across its edge, on this board.
  const facing = (board: BoardPiece[], p: BoardPiece, pos: number): { piece: BoardPiece; pos: number } | null =>
    adjAt(p.coord, p.rotation ?? 0, pos, board);
  const far = (a: number, b: number): boolean => Math.min(Math.abs(a - b), 12 - Math.abs(a - b)) > 2;

  for (const type of ['plateFact', 'sphereFact', 'tesseractFact', 'powerPlant'] as const) {
    it(`${type}: a blank beside it, every rotation of both, every side`, () => {
      let cases = 0;
      for (let rf = 0; rf < 6; rf++) {
        let facedThisRotation = 0;
        for (const cell of CELLS) {
          for (let rb = 0; rb < 6; rb++) {
            for (const { claims, reserved } of OWNER_CASES) {
              const X = piece('X', type, 0, 0, rf, claims);
              const N = piece('N', 'blank', cell.q, cell.r, rb);
              const board = [X, N];
              const s = actionsState(board);
              for (const i of beltPointsOf(N)) {
                const f = facing(board, N, i);
                if (!f || f.piece.id !== 'X' || !isBuffer(X, f.pos)) continue;
                const j = beltPointsOf(N).find(k => far(i, k) && facing(board, N, k) === null)!;
                for (const a of [belt('N', i, j), belt('N', j, i)]) {
                  expect(errCode(s, a), `${type} rf${rf} cell ${cell.q},${cell.r} rb${rb} ${JSON.stringify(claims)} ${i}-${j}`)
                    .toBe(reserved ? 'POINT_RESERVED' : null);
                }
                expect(listed(s, belt('N', Math.min(i, j), Math.max(i, j)))).toBe(!reserved);
                cases++;
                facedThisRotation++;
              }
              // Points that face no buffer of X are never reserved, whoever owns X.
              for (const i of beltPointsOf(N)) {
                const f = facing(board, N, i);
                if (f && f.piece.id === 'X' && isBuffer(X, f.pos)) continue;
                const j = beltPointsOf(N).find(k => far(i, k) && !(facing(board, N, k)?.piece.id === 'X' && isBuffer(X, facing(board, N, k)!.pos)));
                if (j !== undefined) expect(errCode(s, belt('N', i, j))).toBeNull();
              }
            }
          }
        }
        expect(facedThisRotation, `${type} rotation ${rf}`).toBeGreaterThan(0);
      }
      expect(cases).toBeGreaterThan(0);
    });
  }

  it("a building beside a building: a belt on one building's own belt points facing the other's buffer", () => {
    let cases = 0;
    for (let rx = 0; rx < 6; rx++) {
      for (let ry = 0; ry < 6; ry++) {
        for (const cell of CELLS) {
          // X is the building the belt lies on; its own claims never matter for its belt points.
          for (const xClaims of [[], P0, P1] as Claims[]) {
            for (const { claims, reserved } of OWNER_CASES) {
              const X = piece('X', 'plateFact', 0, 0, rx, xClaims);
              const Y = piece('Y', 'sphereFact', cell.q, cell.r, ry, claims);
              const board = [X, Y];
              const s = actionsState(board);
              for (const i of beltPointsOf(X)) {
                const f = facing(board, X, i);
                if (!f || f.piece.id !== 'Y' || !isBuffer(Y, f.pos)) continue;
                const j = beltPointsOf(X).find(k => far(i, k) && facing(board, X, k) === null);
                if (j === undefined) continue;
                expect(errCode(s, belt('X', i, j)), `rx${rx} ry${ry} ${cell.q},${cell.r} X${JSON.stringify(xClaims)} Y${JSON.stringify(claims)}`)
                  .toBe(reserved ? 'POINT_RESERVED' : null);
                cases++;
              }
            }
          }
        }
      }
    }
    expect(cases).toBeGreaterThan(100);
  });

  it('a belt whose two ends face two different claimed buildings', () => {
    // Blank N at (0,0) between L at (-1,0) and R at (1,0); every rotation of all three.
    const PAIRS: Array<{ l: Claims; r: Claims; reserved: boolean }> = [
      { l: [], r: [], reserved: false },
      { l: P0, r: P0, reserved: false },
      { l: P0, r: P0x2, reserved: false },
      { l: [], r: P0, reserved: false },
      { l: P0, r: P1, reserved: true },
      { l: P1, r: P0, reserved: true },
      { l: P1, r: P1, reserved: true },
      { l: P0x2, r: P1, reserved: true },
    ];
    let cases = 0;
    for (let rl = 0; rl < 6; rl++) {
      for (let rr = 0; rr < 6; rr++) {
        for (let rb = 0; rb < 6; rb++) {
          for (const { l, r, reserved } of PAIRS) {
            const L = piece('L', 'plateFact', -1, 0, rl, l);
            const R = piece('R', 'tesseractFact', 1, 0, rr, r);
            const N = piece('N', 'blank', 0, 0, rb);
            const board = [L, R, N];
            const s = actionsState(board);
            const toward = (id: string): number[] => beltPointsOf(N).filter(i => {
              const f = facing(board, N, i);
              return !!f && f.piece.id === id && isBuffer(f.piece, f.pos);
            });
            for (const i of toward('L')) for (const j of toward('R')) {
              if (!far(i, j)) continue;
              expect(errCode(s, belt('N', i, j)), `rl${rl} rr${rr} rb${rb} L${JSON.stringify(l)} R${JSON.stringify(r)} ${i}-${j}`)
                .toBe(reserved ? 'POINT_RESERVED' : null);
              cases++;
            }
          }
        }
      }
    }
    expect(cases).toBeGreaterThan(50);
  });
});
