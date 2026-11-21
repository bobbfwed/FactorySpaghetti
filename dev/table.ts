// Development harness for the 3D table (not part of the production build).
// Plays a seeded bot-vs-bot game locally and feeds every state to the table.
// Run: npx vite, then open /dev/table.html.
// URL parameters (for repeatable screenshots): players=2|3|4, seed=N, bot=greedy|random,
// round=N (play until that round), end=1 (play to the end), debug=1, targets=1, ghost=1,
// topdown=1, rotate=N (60-degree steps), hud=0 (hide the controls), zoom=F (zoom in by F),
// focus=pieceId (centre on a piece). Sets window.__ready when the requested view is drawn.

import { createTable, type Target, type Ghost, type PlayerColor } from '../src/table';
import { createBotGame, playUntil, type BotGame, type BotKind } from '../src/table/botGame';
import { legalActions } from '../src/engine/reducer';
import type { GameState, PlayerId } from '../src/engine/state';
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

function refresh(): void {
  const s = game.state;
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
  for (let i = 0; i < n; i++) if (!game.step()) { setPlaying(false); break; }
  refresh();
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

window.__harness = { table, get game() { return game; }, refresh, step, legalTargets, zoomOn };
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
