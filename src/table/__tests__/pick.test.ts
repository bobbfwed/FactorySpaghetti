// Picking without WebGL: a tap where a target is drawn must resolve to that target.

import { describe, it, expect, beforeAll } from 'vitest';
import type { BoardPiece, GameState, PlayerId } from '../../engine/state';
import { createBotGame, playUntil } from '../botGame';
import { boardCandidates, choose, rayBox, sideBoxes, targetAnchor, targetKey, BELT_PICK_Y, TELEPORTER_PICK_Y, type SideHeights } from '../pick';
import { boardBounds, sideLayout, pointCount, pointRole, teleporterPlacement, TILE_TOP } from '../layout';
import type { Target } from '../types';

let game: GameState;
beforeAll(() => {
  // Random bots also pick belts up, and since RULES_CHANGES.md #54 an older belt picked up goes
  // back to the bank, so belts thin out: play on until enough are on the board.
  game = playUntil(createBotGame(31, 4, 'random'), s => s.round >= 10 && s.belts.length > 5, 8000);
}, 60_000);

const heights: SideHeights = { stackTop: () => 30, pile: () => 4 };
const tap = (t: Target, targets: ReadonlySet<string> = new Set()): Target | null => {
  const side = sideLayout(boardBounds(game.board), game.mineCount);
  const a = targetAnchor(game, side, heights, t)!;
  return choose(boardCandidates(game, a.x, a.z), targets);
};

describe('picking', () => {
  it('the board has belts, claims and buffers to test against', () => {
    expect(game.belts.length).toBeGreaterThan(5);
    expect(game.board.some(p => p.claims.length > 0)).toBe(true);
  });

  it('every non-disabled connection point resolves to itself', () => {
    let n = 0;
    for (const piece of game.board) {
      for (let pos = 0; pos < pointCount(piece); pos++) {
        if (pointRole(piece, pos) === 'disabled') continue;
        const t: Target = { kind: 'point', pieceId: piece.id, point: pos };
        expect(tap(t)).toEqual(t);
        n++;
      }
    }
    expect(n).toBeGreaterThan(200);
  });

  it('buffers, mine slots and pieces resolve to themselves', () => {
    for (const piece of game.board) {
      const pt: Target = { kind: 'piece', pieceId: piece.id };
      // At the centre, a belt crossing the tile is the more specific hit, unless the piece is a target.
      const free = tap(pt);
      if (free?.kind === 'belt') expect(game.belts.find(b => b.id === free.beltId)?.pieceId).toBe(piece.id);
      else expect(free).toEqual(pt);
      expect(tap(pt, new Set([targetKey(pt)]))).toEqual(pt);
      if (piece.type === 'mine') {
        for (const slot of [0, 1]) { const t: Target = { kind: 'mineSlot', pieceId: piece.id, slot }; expect(tap(t)).toEqual(t); }
        continue;
      }
      for (const buffer of ['input', 'output'] as const) {
        if (!(buffer === 'input' ? piece.input : piece.output)) continue;
        const t: Target = { kind: 'buffer', pieceId: piece.id, buffer };
        expect(tap(t)).toEqual(t);
      }
    }
  });

  it('belts resolve to themselves at their middle (hit-tested at belt height)', () => {
    for (const b of game.belts) {
      const t: Target = { kind: 'belt', beltId: b.id };
      const side = sideLayout(boardBounds(game.board), game.mineCount);
      const a = targetAnchor(game, side, heights, t)!;
      expect(a.y).toBe(BELT_PICK_Y);
      const hit = choose(boardCandidates(game, a.x, a.z), new Set([targetKey(t)]));
      expect(hit).toEqual(t);
    }
  });

  it('a tap on a teleporter picks its input or the output (hit-tested half-way up the model), and buffers, points and pieces still resolve', () => {
    // A teleporter on every input (each input of a Sphere or Tesseract Factory has its own, #55)
    // and on the output of every claimed building.
    const all = (buf: NonNullable<BoardPiece['input']>, owner: PlayerId): NonNullable<BoardPiece['input']> =>
      ({ ...buf, teleporters: buf.slots.map(() => owner) });
    const withTeleporters: GameState = {
      ...game,
      board: game.board.map(p => (p.claims.length === 0 || p.type === 'mine' ? p : {
        ...p,
        input: p.input ? all(p.input, p.claims[0]!.ownerId) : null,
        output: p.output ? all(p.output, p.claims[0]!.ownerId) : null,
      })),
    };
    expect(withTeleporters.board.some(p => (p.input?.teleporters.length ?? 0) > 1)).toBe(true);
    const side = sideLayout(boardBounds(withTeleporters.board), withTeleporters.mineCount);
    // The isometric camera looks down at 45 degrees: a ray through the teleporter's middle meets the
    // tile top a few millimetres behind it. Try it from four directions.
    const drop = TELEPORTER_PICK_Y - TILE_TOP;
    expect(drop).toBeGreaterThan(2);
    let n = 0;
    for (const piece of withTeleporters.board) {
      for (const buffer of ['input', 'output'] as const) {
        const buf = buffer === 'input' ? piece.input : piece.output;
        if (!buf || buf.teleporters.length === 0 || piece.type === 'mine') continue;
        const whole: Target = { kind: 'buffer', pieceId: piece.id, buffer };
        for (let slot = 0; slot < buf.slots.length; slot++) {
          // Each input is its own target when lit (placing a teleporter); the output is the buffer.
          const own: Target = buffer === 'input' ? { kind: 'buffer', pieceId: piece.id, buffer, slot } : whole;
          const lit = new Set(buf.slots.map((_, i) => targetKey(buffer === 'input' ? { kind: 'buffer', pieceId: piece.id, buffer, slot: i } : whole)));
          const at = teleporterPlacement(piece, buffer, slot);
          for (const [dx, dz] of [[0, 1], [1, 0], [0, -1], [-1, 0]] as const) {
            const cands = boardCandidates(withTeleporters, at.x + dx * drop, at.z + dz * drop, undefined, at);
            const label = `${piece.id} ${buffer} ${slot}`;
            expect(choose(cands, new Set()), label).toEqual(whole); // nothing lit: the buffer, as before
            expect(choose(cands, lit), `${label} lit`).toEqual(own);
          }
          // Its material picks it too.
          const m = targetAnchor(withTeleporters, side, heights, own)!;
          expect(choose(boardCandidates(withTeleporters, m.x, m.z), lit), `${piece.id} ${buffer} ${slot} material`).toEqual(own);
          n++;
        }
        // Still picked at its anchor, as before.
        const a = targetAnchor(withTeleporters, side, heights, whole)!;
        expect(choose(boardCandidates(withTeleporters, a.x, a.z), new Set())).toEqual(whole);
      }
      for (let pos = 0; pos < pointCount(piece); pos++) {
        if (pointRole(piece, pos) === 'disabled') continue;
        const pt: Target = { kind: 'point', pieceId: piece.id, point: pos };
        const a = targetAnchor(withTeleporters, side, heights, pt)!;
        expect(choose(boardCandidates(withTeleporters, a.x, a.z), new Set())).toEqual(pt);
      }
    }
    expect(n).toBeGreaterThan(10);
  });

  it('empty cells resolve to cells, and a current target wins over a more specific hit', () => {
    expect(tap({ kind: 'cell', q: 40, r: 40 })).toEqual({ kind: 'cell', q: 40, r: 40 });
    const piece = game.board.find(p => p.type === 'blank')!;
    const pointTarget: Target = { kind: 'point', pieceId: piece.id, point: 0 };
    // Tapping right on a point while the whole piece is the target gives the piece.
    expect(tap(pointTarget, new Set([targetKey({ kind: 'piece', pieceId: piece.id })]))).toEqual({ kind: 'piece', pieceId: piece.id });
  });

  it('stacks and the deck are hit by rays from above', () => {
    const side = sideLayout(boardBounds(game.board), game.mineCount);
    const boxes = sideBoxes(side, heights, game);
    expect(boxes.map(b => targetKey(b.target))).toEqual(['stack:0', 'stack:1', 'stack:2', 'deck']);
    for (const b of boxes) {
      const cx = (b.min.x + b.max.x) / 2, cz = (b.min.z + b.max.z) / 2;
      const down = { x: 0, y: -1, z: 0 };
      expect(rayBox({ x: cx, y: 500, z: cz }, down, b.min, b.max)).toBeCloseTo(500 - b.max.y, 6);
      expect(rayBox({ x: cx + 500, y: 500, z: cz }, down, b.min, b.max)).toBeNull();
    }
    expect(TILE_TOP).toBe(3);
  });
});
