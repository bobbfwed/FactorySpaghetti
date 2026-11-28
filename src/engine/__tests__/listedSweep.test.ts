// Accepted ⇒ listed, for every kind of move (RULES_CHANGES.md #40, #43). On sampled states of
// seeded random games, a broad set of candidate moves for the active player — every action type,
// every piece, every Control Module, every coordinate near the board, each with the fields a
// player could fill in — is put to applyAction; every one it accepts must be a move legalActions
// lists (in its listed form, listedForm), so the online host, which accepts only listed moves,
// never refuses a move the engine takes. The other direction (listed ⇒ accepted) is checked at
// every step by sim.test.ts.

import { describe, it, expect } from 'vitest';
import { createGame } from '../rules/setup';
import { applyAction, legalActions } from '../reducer';
import { listedForm } from '../rules/legalActions';
import { hexNeighbours, mineSecondaryCoord, OWN_TURN_STEPS } from '../rules/pieces';
import { createRng, nextIntBelow } from '../rng';
import { CARD_COUNTS, CONTROL_MODULE_MAX } from '../config';
import type { CardType, Material } from '../config';
import type { Action } from '../actions';
import type { GameState, HexCoord, PlayerId } from '../state';

const MATERIALS: readonly Material[] = ['ore', 'plate', 'sphere', 'tesseract'];
const STACKS = [0, 1, 2] as const;
const ROTATIONS = [0, 1, 2, 3, 4, 5];

/** A key that does not depend on field order. */
function key(a: Action): string {
  const rec = a as unknown as Record<string, unknown>;
  return JSON.stringify(Object.keys(rec).sort().map(k => [k, rec[k]]));
}

/** Coordinates on, next to, and two steps from the board. */
function nearbyCoords(s: GameState): HexCoord[] {
  const seen = new Map<string, HexCoord>();
  const add = (c: HexCoord): void => { seen.set(`${c.q},${c.r}`, c); };
  for (const p of s.board) {
    const cells = [p.coord, ...(p.type === 'mine' ? [mineSecondaryCoord(p.coord, p.rotation ?? 0)] : [])];
    for (const c of cells) {
      add(c);
      for (const n of hexNeighbours(c)) { add(n); for (const m of hexNeighbours(n)) add(m); }
    }
  }
  return [...seen.values()];
}

/** Every list of 1 to 3 materials (with repeats), in sorted and in reversed order. */
function supplies(): Material[][] {
  const out: Material[][] = [];
  const grow = (cur: Material[], from: number): void => {
    if (cur.length > 0) { out.push(cur); if (cur.length > 1) out.push([...cur].reverse()); }
    if (cur.length === 3) return;
    for (let i = from; i < MATERIALS.length; i++) grow([...cur, MATERIALS[i]!], i);
  };
  grow([], 0);
  return out;
}

/** A broad superset of the moves the active player `me` could send. */
function candidates(s: GameState, me: PlayerId): Action[] {
  const out: Action[] = [];
  const ids = [...s.board.map(p => p.id), 'no-such-piece'];
  const player = s.players[me]!;
  const coords = nearbyCoords(s);
  for (const type of ['END_ACTIONS', 'END_TURN', 'BUY_BELT', 'BUY_CARD', 'UNDO_BELTS'] as const) out.push({ type });
  for (const stackIndex of STACKS) out.push({ type: 'DRAW_PIECE', stackIndex });
  for (const id of ids) {
    out.push({ type: 'SETUP_CLAIM', pieceId: id });
    out.push({ type: 'PLACE_MEEPLE', pieceId: id }, { type: 'PLACE_MEEPLE', pieceId: id, slotIndex: 0 }, { type: 'PLACE_MEEPLE', pieceId: id, slotIndex: 1 });
    out.push({ type: 'PLACE_TELEPORTER', pieceId: id, bufferType: 'input' }, { type: 'PLACE_TELEPORTER', pieceId: id, bufferType: 'output' });
    out.push({ type: 'COLLECT_OUTPUT', pieceId: id });
    // The host stamps the sender as owner of an answer in the actions step, and drops it elsewhere.
    const owner = s.phase === 'actions' ? { ownerId: me } : {};
    out.push({ type: 'OPERATE_BUILDING', pieceId: id, ...owner }, { type: 'SKIP_FACTORY_ROLL', pieceId: id, ...owner });
    // What a player may name to supply through an input teleporter: every 1–3 materials, in any
    // order (pieces with a teleporter on their input only, to keep the sweep quick).
    if (s.board.find(p => p.id === id)?.input?.teleporters.some(o => o != null)) {
      for (const supply of supplies()) out.push({ type: 'OPERATE_BUILDING', pieceId: id, ...owner, supply });
    }
    for (const material of MATERIALS) out.push({ type: 'LOAD_BUILDING_INPUT', pieceId: id, material });
    for (let m = 1; m <= CONTROL_MODULE_MAX; m++) {
      out.push({ type: 'CLAIM_BUILDING', pieceId: id, controlModule: m });
      out.push({ type: 'CLAIM_BUILDING', pieceId: id, controlModule: m, fromProductionIncrease: true });
      out.push({ type: 'CLAIM_BUILDING', pieceId: id, controlModule: m, fromFreeClaim: true });
    }
  }
  for (const p of s.board) {
    for (const c of p.claims.filter(c => c.ownerId === me)) {
      for (let m = 1; m <= CONTROL_MODULE_MAX; m++) {
        const base = { type: 'UPGRADE_BUILDING' as const, pieceId: p.id, oldModule: c.controlModule, newModule: m };
        out.push(base, { ...base, freeCredits: m - c.controlModule }, { ...base, fromProductionIncrease: true }, { ...base, fromMineCredit: true });
      }
    }
  }
  for (const b of s.belts) out.push({ type: 'REMOVE_BELT', beltId: b.id });
  for (const material of MATERIALS) out.push({ type: 'EXCHANGE_MATERIALS', give: material });
  for (const coord of coords) {
    for (const rotation of ROTATIONS) {
      for (const stackIndex of STACKS) out.push({ type: 'PLACE_PIECE', stackIndex, coord, rotation });
      out.push({ type: 'PLACE_MINE', coord, rotation }, { type: 'BUY_MINE', coord, rotation }, { type: 'PLACE_OVERSTOCK_PIECE', coord, rotation });
    }
  }
  // Leverage cards: every card in the hand, with every kind of choice it takes.
  for (const cardType of new Set<CardType>([...player.hand, ...(Object.keys(CARD_COUNTS) as CardType[])])) {
    out.push({ type: 'PLAY_CARD', cardType });
    if (!player.hand.includes(cardType)) continue;
    for (const id of ids) {
      out.push({ type: 'PLAY_CARD', cardType, pieceId: id });
      out.push({ type: 'PLAY_CARD', cardType, pieceId: id, bufferType: 'input' }, { type: 'PLAY_CARD', cardType, pieceId: id, bufferType: 'output' });
      if (cardType === 'changingPriorities') {
        const mine = s.board.find(p => p.id === id)?.claims.filter(c => c.ownerId === me) ?? [];
        for (const c of mine) for (const to of ids) out.push({ type: 'PLAY_CARD', cardType, pieceId: id, toPieceId: to, controlModule: c.controlModule });
      }
    }
    if (cardType === 'scoutingDrone') {
      const few = coords.slice(0, 12);
      for (const stackIndex of STACKS) {
        for (let pieceIndex = 0; pieceIndex < s.stacks[stackIndex].pieces.length + 1; pieceIndex++) {
          for (const coord of few) for (const rotation of [0, 3]) out.push({ type: 'PLAY_CARD', cardType, stackIndex, pieceIndex, coord, rotation });
        }
      }
    }
  }
  return out;
}

describe('accepted ⇒ listed, every kind of move, seeded games', () => {
  it('every candidate move applyAction accepts for the active player is listed', { timeout: 300_000 }, () => {
    let rng = createRng(77);
    const below = (n: number): number => { const [v, next] = nextIntBelow(rng, n); rng = next; return v; };
    const pick = <T>(xs: readonly T[]): T => xs[below(xs.length)]!;
    const seen = { states: 0, probes: 0, accepted: 0, ownPending: 0, supplied: 0, kinds: new Set<string>(), cardSteps: new Set<string>() };

    for (const [pc, seed] of [[2, 11], [3, 12], [4, 13], [2, 14], [3, 15], [4, 16]] as const) {
      let s = createGame(seed, pc);
      for (let step = 0; step < 450 && !s.gameOver; step++) {
        const active = s.turnOrder[s.activePlayerIndex]!;
        const ownPending = s.pendingFactoryOps.some(e => e.ownerId === active);
        const probe = (st: GameState, only?: Action['type']): void => {
          seen.states++;
          const listed = new Set(legalActions(st, active).map(key));
          for (const a of candidates(st, active)) {
            if (only && a.type !== only) continue;
            seen.probes++;
            if (!applyAction(st, a).ok) continue;
            seen.accepted++;
            seen.kinds.add(a.type === 'PLAY_CARD' ? `PLAY_CARD:${a.cardType}` : a.type);
            if (a.type === 'PLAY_CARD') seen.cardSteps.add(st.phase);
            if (a.type === 'OPERATE_BUILDING' && (a.supply?.length ?? 0) > 0) seen.supplied++;
            expect(listed.has(key(listedForm(st, a))), `seed ${seed} step ${step} phase ${st.phase}: ${JSON.stringify(a)}`).toBe(true);
          }
        };
        if (step % 9 === 0 || ownPending) {
          if (ownPending) seen.ownPending++;
          probe(s);
          // The same state with one of every Leverage card in hand and no card played yet, so
          // every card's choices are probed, not only the cards these games happen to hold — in
          // every step of the player's own turn (RULES_CHANGES.md #50).
          if (OWN_TURN_STEPS.has(s.phase)) {
            const allCards = Object.keys(CARD_COUNTS) as CardType[];
            probe({ ...s, cardsPlayedThisTurn: 0, players: s.players.map(p => (p.id === active ? { ...p, hand: allCards } : p)) }, 'PLAY_CARD');
          }
        }
        // Advance: any owner's pending answer first, then a random move of the active player
        // (an action type first, so rare kinds get played).
        let action: Action;
        const rollCards = s.phase === 'roll' ? legalActions(s, active) : [];
        if (s.phase === 'roll' && (rollCards.length === 0 || below(4) > 0)) {
          action = { type: 'ROLL_DICE', rolls: Array.from({ length: s.mineCount }, () => 1 + below(6)) };
        } else if (s.phase === 'roll') {
          action = pick(rollCards); // a card played before rolling
        } else {
          const owner = s.pendingFactoryOps[0]?.ownerId;
          const who = (owner ?? active) as PlayerId;
          const legal = legalActions(s, who);
          if (legal.length === 0) break;
          // Cards are bought and played often, so their moves get probed.
          const cards = legal.filter(a => a.type === 'BUY_CARD' || a.type === 'PLAY_CARD');
          const types = [...new Set(legal.map(a => a.type))].filter(t => t !== 'REMOVE_BELT' || below(5) === 0);
          const t = types.length ? pick(types) : legal[0]!.type;
          action = cards.length > 0 && below(2) === 0 ? pick(cards) : pick(legal.filter(a => a.type === t));
        }
        const r = applyAction(s, action);
        expect(r.ok, JSON.stringify(action)).toBe(true);
        if (!r.ok) break;
        s = r.state;
      }
    }
    // eslint-disable-next-line no-console -- coverage figures for the report
    console.log(`accepted ⇒ listed sweep: ${JSON.stringify({ ...seen, kinds: [...seen.kinds].sort(), cardSteps: [...seen.cardSteps].sort() })}`);
    expect(seen.states).toBeGreaterThan(80);
    expect(seen.ownPending).toBeGreaterThan(0);
    expect(seen.kinds.size).toBeGreaterThan(12);
    expect([...seen.cardSteps].sort()).toEqual(['actions', 'placeMeeple', 'placePiece', 'roll']);
  });
});
