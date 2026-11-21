import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { runGame } from '../../sim/runGames';
import { createGame } from '../../engine/rules/setup';
import { chooseAction as greedyBot } from '../greedyBot';
import { chooseAction as randomBot } from '../randomBot';
import type { GameState, PieceType, Material, Buffer, BoardPiece } from '../../engine/state';

// B3: the greedy one-ply bot must reliably beat the random fuzzer. Bots use
// Math.random only for dice rolls; we seed it so the head-to-head is reproducible.
describe('greedyBot (B3 one-ply lookahead vs randomBot)', () => {
  const realRandom = Math.random;
  beforeAll(() => {
    let s = 123456789 >>> 0;
    Math.random = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  });
  afterAll(() => { Math.random = realRandom; });

  it('wins a clear majority of a 2-player head-to-head', () => {
    const N = 30;
    let greedyWins = 0;
    let randomWins = 0;
    for (let i = 0; i < N; i++) {
      // Alternate seats so neither bot benefits from turn order.
      const greedyFirst = i % 2 === 0;
      const bots = greedyFirst ? [greedyBot, randomBot] : [randomBot, greedyBot];
      const greedyId = greedyFirst ? 0 : 1;
      const r = runGame(1000 + i, 2, bots);
      if (r.winner === greedyId) greedyWins++;
      else if (r.winner !== null) randomWins++;
    }
    expect(greedyWins).toBeGreaterThan(randomWins);
    expect(greedyWins / N).toBeGreaterThanOrEqual(0.7);
  });
});

// Stage 3: the round-end conversion policy drives load → operate → collect, which the
// one-ply lookahead can't sequence on its own.
describe('greedyBot round-end conversion policy', () => {
  const buf = (slots: Array<Material | null>): Buffer => ({ slots, teleporterOwner: null });
  const factory = (id: string, type: PieceType, input: Buffer | null, output: Buffer | null): BoardPiece =>
    ({ id, type, coord: { q: 0, r: 0 }, rotation: 0, claims: [{ ownerId: 0, controlModule: 7 }], input, output });
  function roundEnd(board: BoardPiece[], inv: Partial<Record<Material, number>>, meepleId: string, power = 5): GameState {
    const g = createGame(1, 2);
    return {
      ...g, phase: 'roundEnd', turnOrder: [0, 1], activePlayerIndex: 0, board,
      players: g.players.map(p => p.id === 0
        ? { ...p, meepleOnPieceId: meepleId, meepleSlotIndex: null, meepleOperatedThisRound: false,
            powerTokens: power, inventory: { ...p.inventory, ...inv } }
        : p),
    };
  }

  it('collects finished output first', () => {
    const st = roundEnd([factory('pf', 'plateFact', buf([null]), buf(['plate']))], {}, 'pf');
    expect(greedyBot(st, 0)).toEqual({ type: 'COLLECT_OUTPUT', pieceId: 'pf' });
  });

  it('operates a factory whose recipe is already loaded', () => {
    const st = roundEnd([factory('pf', 'plateFact', buf(['ore']), buf([null]))], {}, 'pf');
    expect(greedyBot(st, 0)).toEqual({ type: 'OPERATE_BUILDING', pieceId: 'pf' });
  });

  it('loads from inventory to complete a profitable recipe (tesseract from ore+plate+sphere)', () => {
    const st = roundEnd([factory('tf', 'tesseractFact', buf([null, null, null]), buf([null]))],
      { ore: 1, plate: 1, sphere: 1 }, 'tf');
    const a = greedyBot(st, 0);
    expect(a.type).toBe('LOAD_BUILDING_INPUT');
    expect((a as { pieceId: string }).pieceId).toBe('tf');
  });

  it('does NOT load when the conversion is unaffordable (no power)', () => {
    const st = roundEnd([factory('tf', 'tesseractFact', buf([null, null, null]), buf([null]))],
      { ore: 1, plate: 1, sphere: 1 }, 'tf', 0); // 0 power → can't operate a tesseract (cost 3)
    expect(greedyBot(st, 0).type).not.toBe('LOAD_BUILDING_INPUT');
  });
});
