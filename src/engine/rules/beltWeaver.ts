// Belt Weaver bonus metric: the longest continuous belt chain a player owns.
//
// RULES.md: "longest continuous valid belt chain connecting ≥2 buildings (or a mine + a
// building); passes through but doesn't include claimed factories; ≥8 belts." Belts chain
// across shared edges (seams, same geometry as flow.ts). A claimed factory owned by the
// player BRIDGES its input and output buffers, so a chain may pass THROUGH it — the belts on
// each side count, the factory itself does not. The chain must terminate at ≥2 distinct
// buildings, or a mine and a building.
//
// Implementation: contract all zero-cost connectors (seams + factory pass-throughs) with a
// union-find, leaving a small graph whose edges are belts. The metric is the longest simple
// path (by belt count) whose visited nodes touch a qualifying set of buildings/mines.

import type { GameState, PlayerId } from '../state';
import { pieceTemplate } from '../config';
import { adjAt, getRole } from './flow';

const MAX_DFS_STEPS = 200_000; // safety cap for pathological belt graphs

export function longestBeltChain(state: GameState, playerId: PlayerId): number {
  const belts = state.belts.filter(b => b.ownerId === playerId);
  if (belts.length === 0) return 0;

  const pieceById = new Map(state.board.map(p => [p.id, p]));
  const key = (pieceId: string, pos: number) => `${pieceId}:${pos}`;

  // ── Union-find over ports (piece:pos) ──
  const parent = new Map<string, string>();
  const ensure = (k: string) => { if (!parent.has(k)) parent.set(k, k); };
  const find = (k: string): string => {
    ensure(k);
    let root = k;
    while (parent.get(root) !== root) root = parent.get(root)!;
    let cur = k;
    while (parent.get(cur) !== root) { const nxt = parent.get(cur)!; parent.set(cur, root); cur = nxt; }
    return root;
  };
  const union = (a: string, b: string) => { ensure(a); ensure(b); parent.set(find(a), find(b)); };

  for (const b of belts) { ensure(key(b.pieceId, b.fromPoint)); ensure(key(b.pieceId, b.toPoint)); }

  // Terminal ports (building buffers, mine ore-outputs) reached from a belt endpoint via a seam.
  const terminal = new Map<string, { pieceId: string; kind: 'building' | 'mine' }>();

  for (const b of belts) {
    const piece = pieceById.get(b.pieceId);
    if (!piece) continue;
    for (const pos of [b.fromPoint, b.toPoint]) {
      const adj = adjAt(piece.coord, piece.rotation ?? 0, pos, state.board);
      if (!adj) continue;
      const role = getRole(adj.piece, adj.pos);
      const nKey = key(adj.piece.id, adj.pos);
      if (role === 'belt') {
        union(key(b.pieceId, pos), nKey);                 // belt ↔ belt across the seam
      } else if (role === 'input_buffer' || role === 'output_buffer') {
        union(key(b.pieceId, pos), nKey);
        terminal.set(nKey, { pieceId: adj.piece.id, kind: 'building' });
      } else if (role === 'ore_output') {
        union(key(b.pieceId, pos), nKey);
        terminal.set(nKey, { pieceId: adj.piece.id, kind: 'mine' });
      }
    }
  }

  // Factory pass-through: merge the buffer ports of the player's claimed factories that are
  // wired into the graph, so a chain can run input → (factory) → output.
  for (const piece of state.board) {
    if (piece.type === 'mine' || piece.type === 'blank') continue;
    if (!piece.claims.some(c => c.ownerId === playerId)) continue;
    const bufPorts = pieceTemplate(piece).points
      .filter(pt => (pt.role === 'input_buffer' || pt.role === 'output_buffer') && pt.enabled)
      .map(pt => key(piece.id, pt.position))
      .filter(k => parent.has(k)); // only ports already seamed to a belt
    for (let i = 1; i < bufPorts.length; i++) union(bufPorts[0]!, bufPorts[i]!);
  }

  // ── Contracted graph: belts are the edges ──
  const nodeBuildings = new Map<string, Set<string>>();
  const nodeMines = new Map<string, Set<string>>();
  for (const [k, meta] of terminal) {
    const root = find(k);
    const map = meta.kind === 'building' ? nodeBuildings : nodeMines;
    if (!map.has(root)) map.set(root, new Set());
    map.get(root)!.add(meta.pieceId);
  }

  const adjList = new Map<string, Array<{ to: string; id: string }>>();
  const addEdge = (a: string, to: string, id: string) => {
    if (!adjList.has(a)) adjList.set(a, []);
    adjList.get(a)!.push({ to, id });
  };
  const nodes = new Set<string>();
  for (const b of belts) {
    const a = find(key(b.pieceId, b.fromPoint));
    const c = find(key(b.pieceId, b.toPoint));
    nodes.add(a); nodes.add(c);
    if (a === c) continue; // belt whose ends collapse to one node can't extend a simple path
    addEdge(a, c, b.id);
    addEdge(c, a, b.id);
  }

  const qualifies = (buildings: Set<string>, mines: Set<string>): boolean =>
    buildings.size >= 2 || (buildings.size >= 1 && mines.size >= 1);

  // ── Longest simple path (belt count) with a qualifying building/mine set ──
  let best = 0;
  let steps = 0;
  const visited = new Set<string>();

  const dfs = (node: string, used: number, buildings: Set<string>, mines: Set<string>): void => {
    if (used > best && qualifies(buildings, mines)) best = used;
    if (++steps > MAX_DFS_STEPS) return;
    for (const e of adjList.get(node) ?? []) {
      if (visited.has(e.to)) continue;
      visited.add(e.to);
      const nb = nodeBuildings.get(e.to);
      const nm = nodeMines.get(e.to);
      dfs(
        e.to,
        used + 1,
        nb ? new Set([...buildings, ...nb]) : buildings,
        nm ? new Set([...mines, ...nm]) : mines,
      );
      visited.delete(e.to);
    }
  };

  for (const start of nodes) {
    visited.clear();
    visited.add(start);
    dfs(start, 0, new Set(nodeBuildings.get(start) ?? []), new Set(nodeMines.get(start) ?? []));
    if (steps > MAX_DFS_STEPS) break;
  }

  return best;
}
