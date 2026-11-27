// Development harness for the 3D table (not part of the production build).
// Plays a seeded bot-vs-bot game locally and feeds every state to the table.
// Run: npx vite, then open /dev/table.html.
// URL parameters (for repeatable screenshots): players=2|3|4, seed=N, bot=greedy|random,
// round=N (play until that round), end=1 (play to the end), debug=1, targets=1, ghost=1,
// topdown=1, rotate=N (60-degree steps), hud=0 (hide the controls), zoom=F (zoom in by F),
// focus=pieceId (centre on a piece), teleporters=1 (draw a teleporter on every buffer of every
// claimed building). Sets window.__ready when the requested view is drawn.

import { createTable, planTransition, revealedStack, type Target, type Ghost, type PlayerColor, type Preview, type RouteSegment, type RouteTier } from '../src/table';
import { createBotGame, playUntil, type BotGame, type BotKind } from '../src/table/botGame';
import { pointCount, pointWorld } from '../src/table/layout';
import { legalActions } from '../src/engine/reducer';
import type { BoardPiece, GameState, PlayerId } from '../src/engine/state';
import type { Action } from '../src/engine/actions';

declare global {
  interface Window {
    __ready?: boolean;
    __harness?: unknown;
  }
}

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const params = new URLSearchParams(location.search);
const canvas = $<HTMLCanvasElement>('table');
const statusEl = $('status');
const pop = $('pop');
if (params.get('hud') === '0') document.body.classList.add('nohud');

const COLORS: readonly PlayerColor[] = ['blue', 'red', 'orange', 'green'];
const table = await createTable(canvas, { modelsBase: '../models' });
table.setPlayerColors(COLORS);
addEventListener('resize', () => table.resize());

let game: BotGame = createBotGame(7, 4, 'greedy');
let playing = false;
let timer: number | undefined;
let showTargets = params.get('targets') === '1';
let showGhost = params.get('ghost') === '1';
let debug = params.get('debug') === '1';
let topDown = params.get('topdown') === '1';
let ghostRotation = 0;
let ghostCell: { q: number; r: number } | null = null;
let lastPick = '';

function activeId(s: GameState): PlayerId {
  return s.pendingFactoryOps[0]?.ownerId ?? s.turnOrder[s.activePlayerIndex] ?? 0;
}

/** Everything the current player may touch, from legalActions. */
function legalTargets(s: GameState): Target[] {
  if (s.gameOver) return [];
  const out = new Map<string, Target>();
  const add = (k: string, t: Target): void => { out.set(k, t); };
  for (const a of legalActions(s, activeId(s)) as Action[]) {
    switch (a.type) {
      case 'PLACE_PIECE':
        add(`c${a.coord.q},${a.coord.r}`, { kind: 'cell', q: a.coord.q, r: a.coord.r });
        break;
      case 'DRAW_PIECE':
        add(`s${a.stackIndex}`, { kind: 'stack', index: a.stackIndex });
        break;
      case 'PLACE_MINE': case 'PLACE_OVERSTOCK_PIECE': case 'BUY_MINE':
        add(`c${a.coord.q},${a.coord.r}`, { kind: 'cell', q: a.coord.q, r: a.coord.r });
        break;
      case 'PLACE_MEEPLE': {
        const piece = s.board.find(p => p.id === a.pieceId);
        if (piece?.type === 'mine') add(`m${a.pieceId}${a.slotIndex ?? 0}`, { kind: 'mineSlot', pieceId: a.pieceId, slot: a.slotIndex ?? 0 });
        else add(`p${a.pieceId}`, { kind: 'piece', pieceId: a.pieceId });
        break;
      }
      case 'CLAIM_BUILDING': case 'UPGRADE_BUILDING': case 'SETUP_CLAIM': case 'OPERATE_BUILDING': case 'SKIP_FACTORY_ROLL':
        add(`p${a.pieceId}`, { kind: 'piece', pieceId: a.pieceId });
        break;
      case 'PLACE_BELT':
        add(`pt${a.pieceId}:${a.fromPoint}`, { kind: 'point', pieceId: a.pieceId, point: a.fromPoint });
        add(`pt${a.pieceId}:${a.toPoint}`, { kind: 'point', pieceId: a.pieceId, point: a.toPoint });
        break;
      case 'REMOVE_BELT':
        add(`b${a.beltId}`, { kind: 'belt', beltId: a.beltId });
        break;
      case 'PLACE_TELEPORTER':
        add(`bf${a.pieceId}${a.bufferType}`, { kind: 'buffer', pieceId: a.pieceId, buffer: a.bufferType });
        break;
      case 'LOAD_BUILDING_INPUT':
        add(`bf${a.pieceId}input`, { kind: 'buffer', pieceId: a.pieceId, buffer: 'input' });
        break;
      case 'COLLECT_OUTPUT':
        add(`bf${a.pieceId}output`, { kind: 'buffer', pieceId: a.pieceId, buffer: 'output' });
        break;
      case 'BUY_CARD':
        add('deck', { kind: 'deck' });
        break;
      default:
        break;
    }
  }
  return [...out.values()];
}

/** The ghost: the top tile of the first legal stack, at the chosen (or first legal) cell. */
function currentGhost(s: GameState): Ghost | null {
  const places = legalActions(s, activeId(s)).filter((a): a is Extract<Action, { type: 'PLACE_PIECE' }> => a.type === 'PLACE_PIECE');
  const first = places[0];
  if (!first) {
    if (s.pendingMineIds.length > 0) {
      const mines = legalActions(s, activeId(s)).filter((a): a is Extract<Action, { type: 'PLACE_MINE' }> => a.type === 'PLACE_MINE');
      const m = mines[0];
      if (!m) return null;
      const cell = ghostCell ?? m.coord;
      const rot = ghostRotation % 6;
      return { pieceType: 'mine', q: cell.q, r: cell.r, rotation: rot, valid: mines.some(x => x.coord.q === cell.q && x.coord.r === cell.r && (x.rotation ?? 0) === rot) };
    }
    return null;
  }
  const type = s.stacks[first.stackIndex].pieces[0]?.type ?? 'blank';
  const cell = ghostCell ?? first.coord;
  const rot = ghostCell ? ghostRotation % 6 : (first.rotation ?? 0);
  const valid = places.some(a => a.stackIndex === first.stackIndex && a.coord.q === cell.q && a.coord.r === cell.r && (a.rotation ?? 0) === rot);
  return { pieceType: type, q: cell.q, r: cell.r, rotation: rot, valid };
}

/**
 * teleporters=1: show a teleporter on every buffer of every claimed building, in the colour of its
 * first claim (rendering only; the game is not changed). Bots rarely place them.
 */
let demoTeleporters = params.get('teleporters') === '1';
function withTeleporters(s: GameState): GameState {
  if (!demoTeleporters) return s;
  const board = s.board.map((p): BoardPiece => {
    const owner = p.claims[0]?.ownerId;
    if (owner === undefined || p.type === 'mine') return p;
    return {
      ...p,
      input: p.input ? { ...p.input, teleporterOwner: p.input.teleporterOwner ?? owner } : null,
      output: p.output ? { ...p.output, teleporterOwner: p.output.teleporterOwner ?? owner } : null,
    };
  });
  return { ...s, board };
}

function refresh(): void {
  const s = withTeleporters(game.state);
  table.setGame(s);
  table.setTargets(showTargets ? legalTargets(s) : [], COLORS[activeId(s)] ?? 'blue');
  table.setGhost(showGhost ? currentGhost(s) : null);
  const st = table.stats();
  const who = s.gameOver ? `game over (${s.gameOverReason}, winner ${s.winner ?? s.tiedWinners.join('+')})` : `player ${activeId(s)} (${COLORS[activeId(s)]})`;
  statusEl.textContent =
    `seed ${s.seed} · ${s.playerCount} players · round ${s.round} · ${s.phase} · ${who} · ${game.actions} actions\n` +
    `board ${s.board.length} pieces, ${s.belts.length} belts · last frame: ${st.calls} draw calls, ${st.triangles.toLocaleString('en')} triangles, ${st.frameMs.toFixed(1)} ms` +
    (lastPick ? `\npicked: ${lastPick}` : '');
}

function newGame(): void {
  const players = Number(($<HTMLSelectElement>('players')).value) as 2 | 3 | 4;
  const seed = Number(($<HTMLInputElement>('seed')).value) || 1;
  const bot = ($<HTMLSelectElement>('bot')).value as BotKind;
  game = createBotGame(seed, players, bot);
  ghostCell = null;
  table.setGame(null);
  refresh();
  table.recenter();
}

function step(n = 1): void {
  const before = game.state;
  for (let i = 0; i < n; i++) if (!game.step()) { setPlaying(false); break; }
  // anim=1: play the change as an animated transition (one action per step reads best).
  if (params.get('anim') === '1' && n === 1) {
    table.animateTo(game.state, planTransition(before, game.state, []).steps);
    table.setTargets(showTargets ? legalTargets(game.state) : [], COLORS[activeId(game.state)] ?? 'blue');
    return;
  }
  refresh();
}

// ── Belt chains, routes and previews for checking the table without the game interface ─────────

/**
 * A chain of `n` belts across neighbouring tiles, each running straight across its tile and
 * meeting the next at a shared edge (connection points that touch). `skip` picks a later chain.
 */
function beltChain(s: GameState, n: number, skip = 0): Array<{ pieceId: string; from: number; to: number }> {
  // Blank tiles where there are enough of them (a belt across a factory crosses its module square).
  const blanks = s.board.filter(p => p.type === 'blank');
  const tiles = blanks.length >= n + 2 ? blanks : s.board.filter(p => p.type !== 'mine');
  const touching = (p: BoardPiece, pos: number): { piece: BoardPiece; pos: number } | null => {
    const a = pointWorld(p, pos, 0);
    for (const q of tiles) {
      if (q.id === p.id) continue;
      for (let k = 0; k < pointCount(q.type); k++) {
        const b = pointWorld(q, k, 0);
        if (Math.hypot(a.x - b.x, a.z - b.z) < 0.05) return { piece: q, pos: k };
      }
    }
    return null;
  };
  let found = 0;
  for (const start of tiles) {
    for (let entry = 0; entry < 12; entry++) {
      const out: Array<{ pieceId: string; from: number; to: number }> = [];
      const seen = new Set<string>();
      let cur: BoardPiece = start, e = entry;
      while (out.length < n) {
        seen.add(cur.id);
        const a = pointWorld(cur, e);
        let best: { to: number; next: { piece: BoardPiece; pos: number }; d: number } | null = null;
        for (let x = 0; x < 12; x++) {
          if (x === e) continue;
          const t = touching(cur, x);
          if (!t || seen.has(t.piece.id)) continue;
          const b = pointWorld(cur, x);
          const d = Math.hypot(a.x - b.x, a.z - b.z);
          if (!best || d > best.d) best = { to: x, next: t, d };
        }
        if (!best || best.d < 50) break;
        out.push({ pieceId: cur.id, from: e, to: best.to });
        cur = best.next.piece;
        e = best.next.pos;
      }
      if (out.length === n && found++ === skip) return out;
    }
  }
  return [];
}

/** Show the state with a chain of belts laid by `owner` (rendering only; the game is not changed). */
function showChain(n: number, owner: PlayerId = 0, skip = 0): Array<{ pieceId: string; from: number; to: number }> {
  const s = game.state;
  const chain = beltChain(s, n, skip);
  const on = new Set(chain.map(c => c.pieceId));
  const belts = [...s.belts.filter(b => !on.has(b.pieceId)), ...chain.map((c, i) => ({ id: `demo-${i}`, ownerId: owner, pieceId: c.pieceId, fromPoint: c.from, toPoint: c.to }))];
  table.setGame({ ...s, belts });
  return chain;
}

/** A planned route of `n` belts with the tiers given in order (cycled). */
function showRoute(n: number, tiers: readonly RouteTier[] = ['own', 'own', 'buy', 'cant'], color: PlayerColor = 'red', skip = 3): RouteSegment[] {
  const s = game.state;
  const segs = beltChain(s, n, skip).map((c, i) => ({ ...c, tier: tiers[i % tiers.length]! }));
  // Shown on tiles with no belts yet (rendering only), as a real route would be.
  const on = new Set(segs.map(c => c.pieceId));
  table.setGame({ ...s, belts: s.belts.filter(b => !on.has(b.pieceId)) });
  table.setRoute(segs, color);
  return segs;
}

/** A piece preview at the first legal cell (or the given one), from the drawn pile. */
function previewPiece(player?: number, cell?: { q: number; r: number }, rotation = 1): Preview | null {
  const s = game.state;
  const id: PlayerId = (player as PlayerId | undefined) ?? activeId(s);
  const places = legalActions(s, id).filter((a): a is Extract<Action, { type: 'PLACE_PIECE' }> => a.type === 'PLACE_PIECE');
  const r = revealedStack(s);
  const type = r !== null ? s.stacks[r].pieces[0]?.type : places[0] ? s.stacks[places[0].stackIndex].pieces[0]?.type : undefined;
  const at = cell ?? places[0]?.coord;
  if (!type || !at) return null;
  const p: Preview = { k: 'piece', pieceType: type, q: at.q, r: at.r, rotation };
  table.setPreview(id, p);
  return p;
}

/** A meeple preview on the given building or mine slot. */
function previewMeeple(player: number, pieceId: string, slot: 0 | 1 | null): void {
  table.setPreview(player, { k: 'meeple', pieceId, slot });
}

function setPlaying(on: boolean): void {
  playing = on;
  $('play').setAttribute('aria-pressed', String(on));
  $('play').textContent = on ? 'Pause' : 'Play';
  if (timer !== undefined) { clearInterval(timer); timer = undefined; }
  if (on) {
    const rate = Number(($<HTMLSelectElement>('speed')).value);
    const perTick = Math.max(1, Math.round(rate / 20));
    timer = window.setInterval(() => step(perTick), Math.max(50, 1000 / rate));
  }
}

function toggle(id: string, on: boolean): void { $(id).setAttribute('aria-pressed', String(on)); }

$('step').onclick = (): void => step();
$('play').onclick = (): void => setPlaying(!playing);
$('speed').onchange = (): void => { if (playing) setPlaying(true); };
$('toPlace').onclick = (): void => {
  game.step();
  playUntil(game, s => s.phase === 'placePiece' || s.pendingMineIds.length > 0);
  ghostCell = null;
  refresh();
};
$('toRound').onclick = (): void => { const r = game.state.round + 5; playUntil(game, s => s.round >= r); refresh(); };
$('new').onclick = newGame;
$('rotL').onclick = (): void => table.rotateBy(-1);
$('rotR').onclick = (): void => table.rotateBy(1);
$('center').onclick = (): void => table.recenter();
$('top').onclick = (): void => { topDown = !topDown; toggle('top', topDown); table.setTopDown(topDown); };
$('targets').onclick = (): void => { showTargets = !showTargets; toggle('targets', showTargets); refresh(); };
$('ghost').onclick = (): void => { showGhost = !showGhost; toggle('ghost', showGhost); refresh(); };
$('debug').onclick = (): void => { debug = !debug; toggle('debug', debug); table.setDebugPoints(debug); };
let routeOn = false;
let previewMode: 'none' | 'piece' | 'meeple' = 'none';
$('route').onclick = (): void => {
  routeOn = !routeOn;
  toggle('route', routeOn);
  if (routeOn) showRoute(4); else table.setRoute(null, 'red');
};
$('preview').onclick = (): void => {
  const s = game.state;
  const id = activeId(s);
  previewMode = previewMode === 'none' ? 'piece' : previewMode === 'piece' ? 'meeple' : 'none';
  if (previewMode === 'piece' && !previewPiece(id)) previewMode = 'meeple';
  if (previewMode === 'meeple') {
    const b = s.board.find(p => p.type !== 'mine' && p.type !== 'blank') ?? s.board[0];
    if (b) previewMeeple(id, b.id, b.type === 'mine' ? 0 : null);
  }
  if (previewMode === 'none') table.setPreview(id, null);
  $('preview').textContent = `Preview: ${previewMode}`;
};
addEventListener('keydown', (e) => {
  if (e.key === 'r' && showGhost) { ghostRotation++; refresh(); }
});

table.onPick((hit, ev) => {
  lastPick = hit ? JSON.stringify(hit) : 'nothing';
  if (hit && hit.kind === 'cell' && showGhost) { ghostCell = { q: hit.q, r: hit.r }; }
  refresh();
  const at = hit ? table.screenPosition(hit) : null;
  if (at) {
    pop.textContent = hit!.kind + ('pieceId' in hit! ? ` ${hit!.pieceId}` : '') + ('point' in hit! ? ` #${hit!.point}` : '');
    pop.style.left = `${at.x + canvas.getBoundingClientRect().left}px`;
    pop.style.top = `${at.y + canvas.getBoundingClientRect().top - 6}px`;
    pop.style.display = 'block';
  } else {
    pop.style.display = 'none';
    void ev;
  }
});

// Start from the URL parameters.
if (params.get('players')) ($<HTMLSelectElement>('players')).value = params.get('players')!;
if (params.get('seed')) ($<HTMLInputElement>('seed')).value = params.get('seed')!;
if (params.get('bot')) ($<HTMLSelectElement>('bot')).value = params.get('bot')!;
newGame();
const untilRound = Number(params.get('round') ?? '0');
if (params.get('end') === '1') playUntil(game, () => false);
else if (untilRound > 0) playUntil(game, s => s.round >= untilRound);
if (params.get('stop') === 'place') playUntil(game, s => s.phase === 'placePiece');
toggle('targets', showTargets); toggle('ghost', showGhost); toggle('debug', debug); toggle('top', topDown);
table.setDebugPoints(debug);
refresh();
table.recenter();
if (topDown) table.setTopDown(true);
const rot = Number(params.get('rotate') ?? '0');
if (rot) table.rotateBy(rot);

/** Zoom by `factor` about a target, the way a user would: a wheel event over it. */
function zoomOn(target: Target, factor: number): void {
  const at = table.screenPosition(target);
  const r = canvas.getBoundingClientRect();
  const x = (at?.x ?? r.width / 2) + r.left, y = (at?.y ?? r.height / 2) + r.top;
  canvas.dispatchEvent(new WheelEvent('wheel', { clientX: x, clientY: y, deltaY: -Math.log(factor) / 0.0015, cancelable: true }));
}

window.__harness = {
  table, get game() { return game; }, refresh, step, legalTargets, zoomOn, playUntil: (f: (s: GameState) => boolean) => { playUntil(game, f); refresh(); },
  beltChain: (n: number, skip = 0) => beltChain(game.state, n, skip), showChain, showRoute, previewPiece, previewMeeple, revealedStack,
  planTransition, legalActions, setTeleporters: (on: boolean) => { demoTeleporters = on; refresh(); },
};
// Let the camera animations finish, apply any zoom, then report ready.
setTimeout(() => {
  const zoom = Number(params.get('zoom') ?? '0');
  const focus = params.get('focus');
  const gh = focus === 'ghost' ? currentGhost(game.state) : null;
  if (zoom > 0) {
    zoomOn(gh ? { kind: 'cell', q: gh.q, r: gh.r } : focus ? { kind: 'piece', pieceId: focus } : { kind: 'cell', q: 0, r: 0 }, zoom);
  }
  refresh();
  setTimeout(() => { refresh(); window.__ready = true; }, 400);
}, 1000);
