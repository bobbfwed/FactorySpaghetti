// The 4-player save link must stay under 6,000 characters (CLAUDE.md). The end states of greedy
// bot games (botGame.test.ts, drawGame.test.ts) have no belts, Teleporters or Leverage cards, so
// this builds a deliberately heavy late game instead: a nearly full 4-player board from seeded
// random legal play, then for each player in turn many more belts, all four Teleporters and a hand
// of Leverage cards, every one placed or bought through the engine as a legal move (materials and
// Power Tokens are topped up between moves to pay for them), material in the buffers of every
// claimed building, and names of the longest length allowed. The measured length is printed.

import { describe, it, expect } from 'vitest';
import type { Action } from '../../engine/actions';
import { applyAction, legalActions } from '../../engine';
import { INVENTORY_CAP, POWER_TOKEN_CAP, TELEPORTER_COUNT } from '../../engine/config';
import { createGame } from '../../engine/rules/setup';
import { createRng, nextIntBelow, type RngState } from '../../engine/rng';
import type { BoardPiece, GameState, Material, PlayerId } from '../../engine/state';
import { NAME_MAX } from '../room';
import { packLink, toSave, unpackLink, validateSave } from '../save';
import { playingRoom } from './helpers';

const LIMIT = 6000;
const BELTS_EACH = 30;
const CARDS_EACH = 6;

const actorOf = (s: GameState): PlayerId => (s.pendingFactoryOps[0]?.ownerId ?? s.turnOrder[s.activePlayerIndex]!) as PlayerId;
const stackLeft = (s: GameState): number => s.stacks.reduce((n, st) => n + st.pieces.length, 0);

/** Seeded random legal play (dice from the same generator) until few pieces are left in the stacks. */
function lateGame(seed: number): GameState {
  let s = createGame(seed, 4);
  let rng: RngState = createRng(seed);
  const pick = (n: number): number => { const [i, next] = nextIntBelow(rng, n); rng = next; return i; };
  for (let n = 0; n < 20000 && !s.gameOver && stackLeft(s) > 6; n++) {
    const p = actorOf(s);
    let a: Action;
    if (s.phase === 'roll' && s.pendingFactoryOps.length === 0) {
      a = { type: 'ROLL_DICE', rolls: Array.from({ length: s.mineCount }, () => pick(6) + 1) };
    } else {
      const legal = legalActions(s, p);
      // Mostly anything but ending early, so the board fills with what players do.
      const busy = legal.filter(x => x.type !== 'END_TURN' && x.type !== 'END_ACTIONS');
      const from = busy.length > 0 && pick(4) > 0 ? busy : legal;
      a = from[pick(from.length)]!;
    }
    const r = applyAction(s, a);
    if (!r.ok) throw new Error(`${a.type}: ${r.error.code}`);
    s = r.state;
  }
  expect(s.gameOver).toBe(false);
  return s;
}

const placedBy = (s: GameState, p: PlayerId): number => s.belts.filter(b => b.ownerId === p).length;
const telesOf = (s: GameState, p: PlayerId): number => TELEPORTER_COUNT - s.players[p]!.teleportersRemaining;

/** Player `p`'s actions step, paid up (materials and Power Tokens at their limits). */
function theirTurn(s: GameState, p: PlayerId): GameState {
  return {
    ...s, phase: 'actions', activePlayerIndex: s.turnOrder.indexOf(p), pendingFactoryOps: [], overstockPieces: [],
    beltsPlacedThisTurn: [], mineBeltPlacedThisTurn: false, cardsPlayedThisTurn: 0,
    players: s.players.map(x => (x.id === p ? { ...x, powerTokens: POWER_TOKEN_CAP, inventory: { ore: INVENTORY_CAP, plate: INVENTORY_CAP, sphere: INVENTORY_CAP, tesseract: x.inventory.tesseract } } : x)),
  };
}

/** Each player in turn: Teleporters, Leverage cards and belts, each a legal move of the engine. */
function loadUp(start: GameState, seed: number): GameState {
  let s = start;
  let rng: RngState = createRng(seed ^ 0xbee);
  const pick = (n: number): number => { const [i, next] = nextIntBelow(rng, n); rng = next; return i; };
  for (let round = 0; round < 3; round++) {
    for (const p of [0, 1, 2, 3] as PlayerId[]) {
      s = theirTurn(s, p);
      for (let n = 0; n < 200; n++) {
        if (s.phase !== 'actions' || actorOf(s) !== p) s = theirTurn(s, p);
        const legal = legalActions(s, p);
        const of = (t: Action['type']): Action[] => legal.filter(a => a.type === t);
        const me = s.players[p]!;
        const anyOf = (xs: Action[]): Action | undefined => (xs.length > 0 ? xs[pick(xs.length)] : undefined);
        const a = of('PLACE_TELEPORTER')[0]
          ?? (me.hand.length < CARDS_EACH ? of('BUY_CARD')[0] : undefined)
          ?? (placedBy(s, p) < BELTS_EACH ? anyOf(me.beltsRemaining > 0 ? of('PLACE_BELT') : of('BUY_BELT')) : undefined);
        if (!a) break;
        const r = applyAction(s, a);
        if (!r.ok) throw new Error(`${a.type}: ${r.error.code}`);
        s = theirTurn(r.state, p);
      }
    }
  }
  return s;
}

const PRODUCT: Partial<Record<BoardPiece['type'], Material>> = { plateFact: 'plate', sphereFact: 'sphere', tesseractFact: 'tesseract' };

/** Material in every input and output of every claimed building. */
function fullBuffers(s: GameState): GameState {
  const mats: Material[] = ['ore', 'plate', 'sphere'];
  return {
    ...s,
    board: s.board.map((p, i) => (p.claims.length === 0 || p.type === 'mine' ? p : {
      ...p,
      input: p.input ? { ...p.input, slots: p.input.slots.map((m, k) => m ?? mats[(i + k) % mats.length]!) } : p.input,
      output: p.output && PRODUCT[p.type] ? { ...p.output, slots: p.output.slots.map(m => m ?? PRODUCT[p.type]!) } : p.output,
    })),
  };
}

describe('a heavy 4-player late game', () => {
  it(`still makes a save link under ${LIMIT} characters, and it round-trips`, async () => {
    const seed = 4242;
    const s = fullBuffers(loadUp(lateGame(seed), seed));
    const teleporters = s.players.map((_, p) => telesOf(s, p as PlayerId));
    const hands = s.players.map(p => p.hand.length);
    const names = ['Alexandria Montague', 'Bartholomew Kingsle', 'Christabel Fairweat', 'Dominic Ashcroft-Ve'].map(n => n.padEnd(NAME_MAX, 'x').slice(0, NAME_MAX));
    const room = { ...playingRoom(s, names.map(name => ({ kind: 'human' as const, name })), 0), seq: 2400 };
    const save = toSave(room, { savedAt: 1_700_000_000_000, app: '0.1.5+abcdef0' }, { forLink: true });
    const link = await packLink(save);
    const buffered = s.board.reduce((n, p) => n + [p.input, p.output].reduce((k, b) => k + (b?.slots.filter(m => m !== null).length ?? 0), 0), 0);
    // eslint-disable-next-line no-console
    console.log(`heavy 4-player save link: ${link.length} characters (limit ${LIMIT}); board ${s.board.length} pieces, ${s.belts.length} belts, Teleporters ${teleporters.join('/')}, hands ${hands.join('/')}, ${buffered} materials in buffers, deck ${s.cardDeck.length}, round ${s.round}`);
    // It is the heavy case it claims to be.
    expect(s.board.length).toBeGreaterThanOrEqual(60);
    expect(s.belts.length).toBeGreaterThanOrEqual(80);
    expect(teleporters).toEqual([4, 4, 4, 4]);
    expect(hands.every(n => n >= 3)).toBe(true);
    expect(buffered).toBeGreaterThanOrEqual(40);
    // A real game state: it passes every check a save gets, and the link round-trips.
    expect(validateSave(save).room.game).toEqual(s);
    expect(await unpackLink(link)).toEqual(save);
    expect(link.length).toBeLessThan(LIMIT);
  }, 120_000);
});
