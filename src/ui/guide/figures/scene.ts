// Turns a staged scene (figures/types.ts) into an engine GameState, so the table's own drawing code
// can draw it and the guide's tests can check it against the rules. Pure: no DOM, no Three.js.

import { createGame } from '../../../engine/rules/setup';
import { legalActions } from '../../../engine/rules/legalActions';
import { applyAction } from '../../../engine/reducer';
import { makeBuffers } from '../../../engine/rules/pieces';
import { teleporterCount, withTeleporter } from '../../../engine/rules/teleporters';
import type { Belt, BoardPiece, Buffer, GameState, Material, PlayerId } from '../../../engine/state';
import type { FigColor, SceneSpec } from './types';

export const DEFAULT_COLORS: readonly FigColor[] = ['blue', 'red', 'orange', 'green'];

/** Number of players a scene needs: the highest player number it uses + 1, at least 2. */
export function scenePlayers(spec: SceneSpec): 2 | 3 | 4 {
  if (spec.setup) return spec.setup.players;
  let top = 1;
  for (const p of spec.pieces ?? []) {
    for (const [pl] of p.claims ?? []) top = Math.max(top, pl);
    for (const o of tpList(p.tpIn)) if (o !== null) top = Math.max(top, o);
    if (p.tpOut !== undefined) top = Math.max(top, p.tpOut);
  }
  for (const b of spec.belts ?? []) top = Math.max(top, b.owner ?? 0);
  for (const m of spec.meeples ?? []) top = Math.max(top, m.player);
  return Math.min(4, top + 1) as 2 | 3 | 4;
}

/** A scene's teleporter owners per slot: a number is the first slot (input 1, or the output). */
function tpList(tp: number | readonly (number | null)[] | undefined): readonly (number | null)[] {
  return tp === undefined ? [] : typeof tp === 'number' ? [tp] : tp;
}

function buffer(base: Buffer | null, slots: readonly (Material | null)[] | undefined, tp: number | readonly (number | null)[] | undefined): Buffer | null {
  if (!base) return null;
  const filled = base.slots.map((s, i) => slots?.[i] ?? s);
  let out: Buffer = { slots: filled, teleporters: [] };
  tpList(tp).forEach((o, i) => { if (o !== null) out = withTeleporter(out, i, o as PlayerId); });
  return out;
}

/** The pieces of a scene as engine board pieces. */
export function scenePieces(spec: SceneSpec): BoardPiece[] {
  return (spec.pieces ?? []).map(p => {
    const b = makeBuffers(p.type);
    return {
      id: p.id,
      type: p.type,
      coord: { q: p.q, r: p.r },
      rotation: p.rot ?? 0,
      claims: (p.claims ?? []).map(([owner, n]) => ({ ownerId: owner as PlayerId, controlModule: n })),
      input: buffer(b.input, p.input, p.tpIn),
      output: buffer(b.output, p.output, p.tpOut),
    };
  });
}

/** The belts of a scene as engine belts (ids as the engine spells them). */
export function sceneBelts(spec: SceneSpec): Belt[] {
  return (spec.belts ?? []).map(b => {
    const owner = (b.owner ?? 0) as PlayerId;
    return { id: `belt-p${owner}-${b.piece}-${b.a}-${b.b}`, ownerId: owner, pieceId: b.piece, fromPoint: b.a, toPoint: b.b };
  });
}

/** The real starting board for a seed, optionally after every player's first two claims. */
export function setupState(seed: number, players: 2 | 3 | 4, claims: boolean): GameState {
  let s = createGame(seed, players);
  for (let guard = 0; claims && (s.phase === 'setupClaimPF' || s.phase === 'setupClaimPP') && guard < 16; guard++) {
    const active = s.turnOrder[s.activePlayerIndex]!;
    const move = legalActions(s, active).find(a => a.type === 'SETUP_CLAIM');
    if (!move) break;
    const r = applyAction(s, move);
    if (!r.ok) break;
    s = r.state;
  }
  return s;
}

/**
 * A complete GameState for the scene: its board, belts and meeples, in the actions step of a turn,
 * with empty stacks, no cards and no roll, so the table draws only the board.
 */
export function sceneState(spec: SceneSpec): GameState {
  const players = scenePlayers(spec);
  const base = spec.setup ? setupState(spec.setup.seed, players, !!spec.setup.claims) : createGame(1, players);
  const board = spec.setup ? base.board : scenePieces(spec);
  const belts = spec.setup ? [] : sceneBelts(spec);
  const meeples = spec.meeples ?? [];
  const teleporters = board.reduce((n, p) => n + teleporterCount(p), 0);
  return {
    ...base,
    board,
    belts,
    players: base.players.map(pl => {
      const m = meeples.find(x => x.player === pl.id);
      if (!m) return { ...pl, meepleOnPieceId: null, meepleSlotIndex: null };
      const piece = board.find(p => p.id === m.piece);
      return { ...pl, meepleOnPieceId: m.piece, meepleSlotIndex: piece?.type === 'mine' ? (m.slot ?? 0) : null };
    }),
    stacks: base.stacks.map(s => ({ ...s, pieces: [] })) as unknown as GameState['stacks'],
    unplacedMines: [],
    pendingMineIds: [],
    mineCount: Math.max(1, board.filter(p => p.type === 'mine').length),
    globalTeleporterCount: teleporters,
    cardDeck: [],
    cardDiscard: [],
    lastRoll: null,
    phase: spec.setup && !spec.setup.claims ? base.phase : 'actions',
    activePlayerIndex: 0,
    mineBeltPlacedThisTurn: false,
    beltsPlacedThisTurn: [],
    pendingFactoryOps: [],
    overstockPieces: [],
  };
}
