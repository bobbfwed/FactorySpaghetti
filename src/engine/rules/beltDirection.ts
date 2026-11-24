// Which way material runs along each belt on the board: for drawing only. It changes no state and
// no rule reads it (material flow takes either end of a belt, see flow.ts beltPartner).
//
// Belts form chains: a belt end and the belt end on the neighbouring piece that faces it across
// the shared edge (the same seam flow uses, flow.ts adjAt) are joined. Each point holds one belt,
// so a chain is a simple path, or now and then a closed loop.
//
// A chain end is a source when it faces a Mine ore exit or a building's output, and a sink when it
// faces a building's input, claimed or not. A chain with a source at one end and/or a sink at the
// other runs from the source end towards the sink end. When nothing decides it (no source or sink,
// two sources, two sinks, or a loop) the whole chain follows the stored fromPoint -> toPoint order
// of its earliest-placed belt (the first belt in state.belts), which is the order the player tapped
// it. Recomputed from the state each time, so a later building or belt that decides the direction
// turns the whole chain by itself.

import type { Belt, BoardPiece, GameState } from '../state';
import { pieceTemplate, type PointRole } from '../config';
import { adjAt } from './flow';

/** The two ends of a belt: material enters at `tail` and leaves at `head` (both connection points). */
export interface BeltDirection {
  readonly tail: number;
  readonly head: number;
}

type EndKind = 'source' | 'sink' | 'open';

interface EndInfo {
  /** The belt joined at this end (index into belts) and the point it is joined at. */
  readonly next: { readonly belt: number; readonly pos: number } | null;
  readonly kind: EndKind;
}

interface Step { readonly belt: number; readonly enter: number; readonly exit: number }

function roleAt(piece: BoardPiece, pos: number): PointRole {
  const def = pieceTemplate(piece).points.find(p => p.position === pos);
  return def && def.enabled ? def.role : 'disabled';
}

/** Tail and head of every belt, in the order of `state.belts`. */
export function beltDirections(state: Pick<GameState, 'board' | 'belts'>): BeltDirection[] {
  const belts: ReadonlyArray<Belt> = state.belts;
  const board = state.board;
  const pieces = new Map(board.map(p => [p.id, p]));
  // Which belt uses each point (the first one, should a malformed state hold two).
  const at = new Map<string, number>();
  belts.forEach((b, i) => {
    for (const pos of [b.fromPoint, b.toPoint]) {
      const k = `${b.pieceId}:${pos}`;
      if (!at.has(k)) at.set(k, i);
    }
  });

  const infoCache = new Map<string, EndInfo>();
  const endInfo = (i: number, pos: number): EndInfo => {
    const ck = `${i}:${pos}`;
    const hit = infoCache.get(ck);
    if (hit) return hit;
    let info: EndInfo = { next: null, kind: 'open' };
    const piece = pieces.get(belts[i]!.pieceId);
    const n = piece ? adjAt(piece.coord, piece.rotation ?? 0, pos, board) : null;
    if (n) {
      const j = at.get(`${n.piece.id}:${n.pos}`);
      if (j !== undefined && j !== i) info = { next: { belt: j, pos: n.pos }, kind: 'open' };
      else {
        const role = roleAt(n.piece, n.pos);
        if (role === 'ore_output' || role === 'output_buffer') info = { next: null, kind: 'source' };
        else if (role === 'input_buffer') info = { next: null, kind: 'sink' };
      }
    }
    infoCache.set(ck, info);
    return info;
  };
  const otherEnd = (i: number, pos: number): number => {
    const b = belts[i]!;
    return b.fromPoint === pos ? b.toPoint : b.fromPoint;
  };

  const out: BeltDirection[] = belts.map(b => ({ tail: b.fromPoint, head: b.toPoint }));
  const done = new Set<number>();

  for (let i = 0; i < belts.length; i++) {
    if (done.has(i)) continue;
    if (!pieces.has(belts[i]!.pieceId)) { done.add(i); continue; }

    // Walk out of belt i through its fromPoint to find one end of the chain (or come back: a loop).
    let first = i, firstEnter = belts[i]!.toPoint;
    let loop = false;
    {
      const seen = new Set<number>([i]);
      let cur = i, leave = belts[i]!.fromPoint;
      for (;;) {
        const nx = endInfo(cur, leave).next;
        if (!nx) break;
        if (nx.belt === i) { loop = true; break; }
        if (seen.has(nx.belt)) break; // malformed joins: stop rather than go round for ever
        seen.add(nx.belt);
        cur = nx.belt;
        leave = otherEnd(cur, nx.pos);
      }
      if (loop) { first = i; firstEnter = belts[i]!.fromPoint; } else { first = cur; firstEnter = leave; }
    }

    // Walk the chain from that end to the other.
    const chain: Step[] = [];
    {
      const inChain = new Set<number>();
      let cur = first, enter = firstEnter;
      for (;;) {
        inChain.add(cur);
        const exit = otherEnd(cur, enter);
        chain.push({ belt: cur, enter, exit });
        const nx = endInfo(cur, exit).next;
        if (!nx || inChain.has(nx.belt) || done.has(nx.belt)) break;
        cur = nx.belt;
        enter = nx.pos;
      }
    }
    for (const s of chain) done.add(s.belt);

    // Decide: +1 runs from the chain's first end to its last, -1 the other way, 0 undecided.
    let dir = 0;
    if (!loop) {
      const a = endInfo(chain[0]!.belt, chain[0]!.enter).kind;
      const last = chain[chain.length - 1]!;
      const b = endInfo(last.belt, last.exit).kind;
      const forward = a === 'source' || b === 'sink';
      const backward = b === 'source' || a === 'sink';
      if (forward !== backward) dir = forward ? 1 : -1;
    }
    if (dir === 0) {
      let earliest = chain[0]!;
      for (const s of chain) if (s.belt < earliest.belt) earliest = s;
      dir = belts[earliest.belt]!.fromPoint === earliest.enter ? 1 : -1;
    }
    for (const s of chain) out[s.belt] = dir > 0 ? { tail: s.enter, head: s.exit } : { tail: s.exit, head: s.enter };
  }
  return out;
}
