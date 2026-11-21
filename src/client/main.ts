// Client entry point: wires canvas, game session, action panel, and event handlers.

import type { HexCoord, GameState } from '../engine/state';
import type { PieceType } from '../engine/config';
import type { Action } from '../engine/actions';
import { legalActions } from '../engine/reducer';
import { BOT_TYPES, botById } from '../bots/registry';
import { findBeltPath, usableBeltPoints } from '../engine/routing';
import { playerStats } from '../engine/rules/stats';
import type { RoutePoint, Route } from '../engine/routing';
import { drawBoard, computeTransform, hitTestPiece, hitTestFreeCoord, hitTestBelt, hitTestPointAmong } from './render/board';
import type { BoardTransform, GhostPiece, RouteModeView, DrawOptions } from './render/board';
import { pixelToHex } from './render/hex';
import { mineSecondaryCoord } from '../engine/rules/pieces';
import { GameSession } from './GameSession';
import type { Seat, ClientSession } from './GameSession';
import { NetworkSession } from './NetworkSession';
import { NetClient } from './net';
import type { NetHandlers } from './net';
import type { LobbyView, StateSnapshot, SeatKind, PresenceState } from '../server/protocol';
import type { PlayerId } from '../engine/state';
import { ActionPanel, BOARD_PIECE_CARDS } from './ui/actionPanel';
import type { PanelState } from './ui/actionPanel';
import { PLAYER_COLORS, PLAYER_NAMES } from './render/colors';

// ── Bootstrap ────────────────────────────────────────────────────────────────

const canvas = document.getElementById('board') as HTMLCanvasElement;
const gameOverOverlay = document.getElementById('game-over-overlay')!;
const gameOverTitle   = document.getElementById('game-over-title')!;
const gameOverMsg     = document.getElementById('game-over-msg')!;
const setupOverlay = document.getElementById('setup-overlay')!;
const setupCount   = document.getElementById('setup-count') as HTMLSelectElement;
const setupSeats   = document.getElementById('setup-seats')!;
const botSpeedSelect = document.getElementById('bot-speed') as HTMLSelectElement;

// LAN lobby DOM
const modeLocalBtn = document.getElementById('mode-local')!;
const modeLanBtn   = document.getElementById('mode-lan')!;
const localSetup   = document.getElementById('local-setup')!;
const lanSetup     = document.getElementById('lan-setup')!;
const lanNameInput = document.getElementById('lan-name') as HTMLInputElement;
const lanUrlInput  = document.getElementById('lan-url') as HTMLInputElement;
const lanConnectBtn = document.getElementById('lan-connect')!;
const lanStatus    = document.getElementById('lan-status')!;
const lanLobby     = document.getElementById('lan-lobby')!;

// Default seats for the idle session shown behind the lobby until the user starts.
function defaultSeats(): Seat[] {
  const greedy = BOT_TYPES[0]!;
  return [{ kind: 'human' }, { kind: 'bot', bot: greedy.fn, label: greedy.label }];
}

let session: ClientSession = buildSession(defaultSeats(), Date.now());
let panelState: PanelState = freshPanelState();

// ── LAN state ───────────────────────────────────────────────────────────────
let net: NetClient | null = null;
let netSession: NetworkSession | null = null;
let lanIsHost = false;
let myClientId: string | null = null;
let currentLobby: LobbyView | null = null;
// Latest ephemeral UI intent received from another player, for spectating their turn.
let remotePresence: { playerId: PlayerId; presence: PresenceState } | null = null;
// True once the player dismisses the game-over overlay to inspect the final board.
let gameOverDismissed = false;
let transform: BoardTransform = { offsetX: 300, offsetY: 300, hexSize: 52 };
let hoveredCoord: HexCoord | null = null;
let ghostPiece: GhostPiece | null = null;
// Belt-route picker: the belt connection point currently hovered (for the route preview).
let routeHoverPoint: RoutePoint | null = null;
// All placeable belt points highlighted while in belt mode. Recomputed in render() (when
// the board/belts change) and reused by the mousemove/click handlers so they don't re-scan
// the whole board on every pointer event.
let routeCandidates: RoutePoint[] = [];

// ── Zoom / pan state ──────────────────────────────────────────────────────────

const MIN_HEX_SIZE = 14;
const MAX_HEX_SIZE = 130;

let dragStart: { x: number; y: number; ox: number; oy: number } | null = null;
let didDrag = false;

const panel = new ActionPanel(
  handleHumanAction,
  handleCancel,
  handleGhostUpdate,
  () => render(),
  handleRouteCommit,
);

function freshPanelState(): PanelState {
  return {
    selectedCoord: null, pendingActionType: null, ghostPieceType: null, ghostRotation: 0,
    beltPieceId: null, beltFromPoint: null, beltRouteSource: null, beltRoutePrompt: null,
    claimFromFreeClaim: false, tpPieceId: null,
    pendingCardType: null, pendingCardTarget: null, pendingCardTarget2: null,
    drawnCardNotice: null,
  };
}

// Build a session (subscribed to re-render) without starting bot turns yet.
function buildSession(seats: Seat[], seed: number): GameSession {
  const s = new GameSession(seed, seats);
  s.subscribe(() => render());
  return s;
}

// ── Canvas sizing ─────────────────────────────────────────────────────────────

function resizeCanvas(): void {
  const wrap = canvas.parentElement!;
  canvas.width  = wrap.clientWidth;
  canvas.height = wrap.clientHeight;
  // Re-fit on resize so the board stays visible
  transform = computeTransform(session.state, canvas);
  render();
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

// ── Render ────────────────────────────────────────────────────────────────────

// The board overlay (ghost, highlights, belt-route preview). When it's my turn (or local
// hot-seat) it reflects my own UI state; while spectating a LAN game it mirrors the active
// player's broadcast presence, so I see what they're doing live.
function currentDrawOverlay(): Partial<DrawOptions> {
  const spec = spectatorOverlay();
  if (spec) return spec;

  const state = session.state;
  const validCoords = computeValidCoords();
  const ghostCoord = panelState.selectedCoord ??
    (isValidCoord(hoveredCoord, validCoords) ? hoveredCoord : null);
  const activeGhost: GhostPiece | null = ghostCoord ? resolveGhost(state, ghostCoord) : null;
  const meepleValidPieceIds = computeMeepleValidPieceIds();
  const claimablePieceIds = computeClaimablePieceIds();
  routeCandidates =
    session.isHumanTurn() && state.phase === 'actions' &&
    panelState.pendingActionType === 'PLACE_BELT' && !panelState.beltRoutePrompt
      ? usableBeltPoints(state, session.viewPlayerId)
      : [];
  const routeMode = computeRouteMode();
  const removeBeltMode = session.isHumanTurn() && panelState.pendingActionType === 'REMOVE_BELT';
  return {
    validCoords,
    selectedCoord: panelState.selectedCoord,
    hoveredCoord: isValidCoord(hoveredCoord, validCoords) ? hoveredCoord : null,
    ghostPiece: activeGhost,
    ...(meepleValidPieceIds && { meepleValidPieceIds }),
    ...(claimablePieceIds && { claimablePieceIds }),
    ...(routeMode && { routeMode }),
    removeBeltMode,
  };
}

// When spectating a LAN game (not my turn), turn the active player's broadcast presence into
// board overlay options. Returns null when I'm the one acting or there's no live presence.
function spectatorOverlay(): Partial<DrawOptions> | null {
  if (!netSession || session.isHumanTurn()) return null;
  const active = session.state.turnOrder[session.state.activePlayerIndex];
  if (active === undefined || !remotePresence || remotePresence.playerId !== active) return null;
  const p = remotePresence.presence;
  const routeMode: RouteModeView | undefined = p.route
    ? {
        candidatePoints: [],
        selectedSource: p.route.source,
        hoverPoint: p.route.hover,
        route: p.route.belts,
        beltsRemaining: p.route.belts.length, // preview: draw them all as placed
      }
    : undefined;
  return {
    selectedCoord: p.selectedCoord,
    hoveredCoord: p.hoveredCoord,
    ...(p.ghost && { ghostPiece: p.ghost }),
    ...(routeMode && { routeMode }),
  };
}

function render(): void {
  const state = session.state;
  drawBoard(canvas, state, { transform, ...currentDrawOverlay() });

  (document.getElementById('round-info') as HTMLElement).textContent = `Round ${state.round}`;
  (document.getElementById('phase-info') as HTMLElement).textContent = `Phase: ${phaseLabel(state.phase)}`;

  const rollLogSection = document.getElementById('roll-log-section');
  const rollLogEntries = document.getElementById('roll-log-entries');
  if (rollLogSection && rollLogEntries) {
    const evs = session.lastRollEvents;
    if (evs.length > 0) {
      rollLogEntries.innerHTML = evs.map(e => `<div class="roll-entry">${escapeHtml(e)}</div>`).join('');
      rollLogSection.classList.remove('hidden');
    } else {
      rollLogSection.classList.add('hidden');
    }
  }

  const viewSeat = session.seats[session.viewPlayerId];
  const seatLabel = viewSeat ? (viewSeat.kind === 'human' ? 'Human' : viewSeat.label) : undefined;
  panel.render(state, session.viewPlayerId, panelState, session.getLog(), {
    controllable: session.isHumanTurn(),
    ...(seatLabel ? { seatLabel } : {}),
    actionDeadline: session.actionDeadline,
  });

  if (state.gameOver && !gameOverDismissed) showGameOver();
  else gameOverOverlay.classList.add('hidden');

  maybeSendPresence();
}

// Tick the countdown banner ~every 500 ms while a timed auto-action (operate / round-end)
// is pending. Updates ONLY the timer element in place — never re-renders the action buttons,
// so a click can't be lost to a mid-click DOM rebuild (the old full render() here caused
// buttons to need two clicks at round end).
setInterval(() => {
  panel.updateTurnTimer(session.actionDeadline);
}, 500);

function computeValidCoords(): HexCoord[] {
  const state = session.state;
  if (!session.isHumanTurn()) return [];

  if (state.phase === 'placePiece') {
    const legal = legalActions(state, session.viewPlayerId);
    const seen = new Map<string, HexCoord>();
    for (const a of legal) {
      if (a.type === 'PLACE_PIECE' || a.type === 'PLACE_MINE') {
        const k = `${a.coord.q},${a.coord.r}`;
        if (!seen.has(k)) seen.set(k, a.coord);
      }
    }
    return [...seen.values()];
  }

  if (state.phase === 'actions') {
    // Scouting drone placement step 3: highlight valid adjacent hexes.
    if (panelState.pendingCardType === 'scoutingDrone' && panelState.pendingCardTarget2 !== null) {
      const legal = legalActions(state, session.viewPlayerId);
      const seen = new Map<string, HexCoord>();
      for (const a of legal) {
        if (a.type === 'PLAY_CARD' && (a as { cardType: string }).cardType === 'scoutingDrone' && (a as { coord?: HexCoord }).coord) {
          const c = (a as { coord: HexCoord }).coord;
          seen.set(`${c.q},${c.r}`, c);
        }
      }
      return [...seen.values()];
    }

    // Card piece-selection mode: highlight valid target pieces.
    if (panelState.pendingCardType && BOARD_PIECE_CARDS.has(panelState.pendingCardType)) {
      const legal = legalActions(state, session.viewPlayerId);
      const seen = new Map<string, HexCoord>();
      for (const a of legal) {
        if (a.type !== 'PLAY_CARD') continue;
        const ca = a as { type: 'PLAY_CARD'; cardType: string; pieceId?: string; toPieceId?: string };
        if (ca.cardType !== panelState.pendingCardType) continue;
        if (panelState.pendingCardType === 'changingPriorities' && panelState.pendingCardTarget) {
          if (ca.pieceId === panelState.pendingCardTarget && ca.toPieceId) {
            const p = state.board.find(b => b.id === ca.toPieceId);
            if (p) seen.set(`${p.coord.q},${p.coord.r}`, p.coord);
          }
        } else if (!panelState.pendingCardTarget && ca.pieceId) {
          const p = state.board.find(b => b.id === ca.pieceId);
          if (p) seen.set(`${p.coord.q},${p.coord.r}`, p.coord);
        }
      }
      return [...seen.values()];
    }

    if (state.overstockPieces.length > 0 || panelState.pendingActionType === 'BUY_MINE') {
      const legal = legalActions(state, session.viewPlayerId);
      const seen = new Map<string, HexCoord>();
      for (const a of legal) {
        if ((a.type === 'PLACE_OVERSTOCK_PIECE' || a.type === 'BUY_MINE') && a.coord) {
          const k = `${a.coord.q},${a.coord.r}`;
          if (!seen.has(k)) seen.set(k, a.coord);
        }
      }
      return [...seen.values()];
    }
    if (panelState.pendingActionType === 'CLAIM_BUILDING') {
      const legal = legalActions(state, session.viewPlayerId);
      const seen = new Map<string, HexCoord>();
      for (const a of legal) {
        if (a.type === 'CLAIM_BUILDING') {
          const piece = state.board.find(p => p.id === (a as { pieceId: string }).pieceId);
          if (piece) {
            const k = `${piece.coord.q},${piece.coord.r}`;
            if (!seen.has(k)) seen.set(k, piece.coord);
          }
        }
      }
      return [...seen.values()];
    }

    // Belt routing uses connection-point markers (drawn via routeMode), not hex highlights.
    if (panelState.pendingActionType === 'PLACE_BELT') return [];

    if (panelState.pendingActionType === 'PLACE_TELEPORTER') {
      const legal = legalActions(state, session.viewPlayerId);
      const seen = new Map<string, HexCoord>();
      for (const a of legal) {
        if (a.type === 'PLACE_TELEPORTER') {
          const piece = state.board.find(p => p.id === (a as { pieceId: string }).pieceId);
          if (piece) {
            const k = `${piece.coord.q},${piece.coord.r}`;
            if (!seen.has(k)) seen.set(k, piece.coord);
          }
        }
      }
      return [...seen.values()];
    }
  }

  if (state.phase === 'setupClaimPF') {
    return state.board.filter(p => p.type === 'plateFact' && p.claims.length === 0).map(p => p.coord);
  }

  if (state.phase === 'setupClaimPP') {
    return state.board.filter(p => p.type === 'powerPlant' && p.claims.length === 0).map(p => p.coord);
  }

  if (state.phase === 'placeMeeple') {
    return state.board
      .filter(p => p.type === 'mine' || p.claims.some(c => c.ownerId === session.viewPlayerId))
      .map(p => p.coord);
  }

  if (state.phase === 'roundEnd' && panelState.pendingActionType === 'CLAIM_BUILDING') {
    const legal = legalActions(state, session.viewPlayerId);
    const seen = new Map<string, HexCoord>();
    for (const a of legal) {
      if (a.type === 'CLAIM_BUILDING') {
        const piece = state.board.find(p => p.id === (a as { pieceId: string }).pieceId);
        if (piece) {
          const k = `${piece.coord.q},${piece.coord.r}`;
          if (!seen.has(k)) seen.set(k, piece.coord);
        }
      }
    }
    return [...seen.values()];
  }

  return [];
}

function isValidCoord(coord: HexCoord | null, valids: HexCoord[]): boolean {
  if (!coord) return false;
  return valids.some(v => v.q === coord.q && v.r === coord.r);
}

// ── Game over ─────────────────────────────────────────────────────────────────

function showGameOver(): void {
  gameOverOverlay.classList.remove('hidden');
  const state = session.state;
  if (state.winner !== null) {
    const seat = session.seats[state.winner];
    const who = PLAYER_NAMES[state.winner] ?? `Player ${state.winner + 1}`;
    const kind = seat ? (seat.kind === 'human' ? 'Human' : seat.label) : '';
    gameOverTitle.style.color = PLAYER_COLORS[state.winner] ?? '#fff';
    gameOverTitle.textContent = `${who} wins!`;
    const via = state.gameOverReason === 'tesseracts' ? '4 Tesseracts' : 'board exhaustion';
    gameOverMsg.textContent = `Via ${via}${kind ? ` · ${kind}` : ''}`;
  } else if (state.tiedWinners.length > 0) {
    gameOverTitle.style.color = '#fff';
    gameOverTitle.textContent = 'Tie Game!';
    gameOverMsg.textContent = `Players ${state.tiedWinners.map(p => p + 1).join(' & ')} tied`;
  }
}

// ── Callbacks ─────────────────────────────────────────────────────────────────

function handleHumanAction(action: Action): void {
  const ok = session.applyHumanAction(action);
  if (ok) {
    if (action.type === 'PLACE_BELT') {
      // Change 3: stay in belt-placing mode after placing a belt
      // Reset only the point-selection state, keep pendingActionType = 'PLACE_BELT'
      panelState = {
        ...freshPanelState(),
        pendingActionType: 'PLACE_BELT',
        drawnCardNotice: null,
      };
    } else if (action.type === 'BUY_CARD') {
      // Change 2: show drawn-card notice
      panelState = {
        ...freshPanelState(),
        drawnCardNotice: session.lastDrawnCardInfo,
      };
    } else {
      panelState = freshPanelState();
    }
    ghostPiece = null;
    render();
  }
}

function handleCancel(): void {
  panelState = freshPanelState();
  ghostPiece = null;
  routeHoverPoint = null;
  render();
}

function handleGhostUpdate(pieceType: PieceType | null, rotation: number): void {
  ghostPiece = pieceType ? { coord: { q: 0, r: 0 }, pieceType, rotation } : null;
  // Only redraw canvas — do NOT call render() here because that rebuilds the panel
  // DOM and destroys the rotation button before its click event fires.
  renderCanvasOnly();
}

// Return the ghost piece to render at `coord`.
// If the user has explicitly hovered a rotation button (ghostPiece is set), use it.
// Otherwise, during placePiece phase, auto-derive from the top of the first available stack.
function resolveGhost(state: GameState, coord: HexCoord): GhostPiece | null {
  if (ghostPiece) return { ...ghostPiece, coord };
  if (state.phase !== 'placePiece') return null;
  if (state.pendingMineIds.length > 0) {
    return { coord, pieceType: 'mine', rotation: panelState.ghostRotation };
  }
  for (let si = 0; si <= 2; si++) {
    const st = state.stacks[si as 0 | 1 | 2];
    if (st.available && st.pieces.length > 0) {
      return { coord, pieceType: st.pieces[0]!.type, rotation: panelState.ghostRotation };
    }
  }
  return null;
}

function renderCanvasOnly(): void {
  drawBoard(canvas, session.state, { transform, ...currentDrawOverlay() });
  maybeSendPresence();
}

// ── Presence broadcast (LAN spectating) ───────────────────────────────────────
// While it's my turn in a LAN game, broadcast my in-progress overlay (hover / ghost / belt
// route preview) so others can watch. Throttled so mouse-move spam doesn't flood the host.

let lastPresenceSent = 0;
let presenceTimer: ReturnType<typeof setTimeout> | null = null;
const PRESENCE_MIN_INTERVAL_MS = 60;

function buildPresence(): PresenceState {
  const state = session.state;
  const validCoords = computeValidCoords();
  const ghostCoord = panelState.selectedCoord ??
    (isValidCoord(hoveredCoord, validCoords) ? hoveredCoord : null);
  const activeGhost = ghostCoord ? resolveGhost(state, ghostCoord) : null;
  const rm = computeRouteMode();
  return {
    hoveredCoord: isValidCoord(hoveredCoord, validCoords) ? hoveredCoord : null,
    ghost: activeGhost,
    selectedCoord: panelState.selectedCoord,
    route: rm ? { source: rm.selectedSource, hover: rm.hoverPoint, belts: rm.route ?? [] } : null,
  };
}

function maybeSendPresence(): void {
  if (!net || !netSession || !session.isHumanTurn()) return;
  const doSend = () => { lastPresenceSent = Date.now(); net!.sendPresence(buildPresence()); };
  const dt = Date.now() - lastPresenceSent;
  if (dt >= PRESENCE_MIN_INTERVAL_MS) {
    doSend();
  } else if (presenceTimer === null) {
    presenceTimer = setTimeout(() => { presenceTimer = null; doSend(); }, PRESENCE_MIN_INTERVAL_MS - dt);
  }
}

function computeMeepleValidPieceIds(): ReadonlySet<string> | undefined {
  const state = session.state;
  if (!session.isHumanTurn() || state.phase !== 'placeMeeple') return undefined;
  const ids = new Set<string>();
  for (const piece of state.board) {
    if (piece.type === 'mine' || piece.claims.some(c => c.ownerId === session.viewPlayerId)) {
      ids.add(piece.id);
    }
  }
  return ids;
}

// Buildings the player can claim right now — highlighted on top of the pieces. Covers both
// the mid-game claim mode (CLAIM_BUILDING) and the setup claim phases (SETUP_CLAIM), which
// otherwise only got the under-piece tint hidden beneath the opaque buildings.
function computeClaimablePieceIds(): ReadonlySet<string> | undefined {
  const state = session.state;
  if (!session.isHumanTurn()) return undefined;
  const inSetupClaim = state.phase === 'setupClaimPF' || state.phase === 'setupClaimPP';
  if (!inSetupClaim && panelState.pendingActionType !== 'CLAIM_BUILDING') return undefined;
  const ids = new Set<string>();
  for (const a of legalActions(state, session.viewPlayerId)) {
    if (a.type === 'CLAIM_BUILDING' || a.type === 'SETUP_CLAIM') {
      ids.add((a as { pieceId: string }).pieceId);
    }
  }
  return ids.size > 0 ? ids : undefined;
}

// Belt-route overlay: all usable belt endpoints highlight; once a start point is chosen,
// hovering another previews the route between them (or nothing if it can't connect).
function computeRouteMode(): RouteModeView | undefined {
  const state = session.state;
  if (!session.isHumanTurn() || state.phase !== 'actions') return undefined;
  if (panelState.pendingActionType !== 'PLACE_BELT' || panelState.beltRoutePrompt) return undefined;
  const me = session.viewPlayerId;
  const belts = state.players[me]?.beltsRemaining ?? 0;
  const src = panelState.beltRouteSource;
  const route = (src && routeHoverPoint) ? findBeltPath(state, src, routeHoverPoint, me) : null;
  return {
    candidatePoints: routeCandidates,
    selectedSource: src,
    hoverPoint: routeHoverPoint,
    route: route ? route.belts : null,
    beltsRemaining: belts,
  };
}

// Total inventory value (used to test whether the player can afford to buy belts).
function inventoryValue(playerId: number): number {
  const inv = session.state.players[playerId]?.inventory;
  if (!inv) return 0;
  return inv.ore * 1 + inv.plate * 3 + inv.sphere * 7 + inv.tesseract * 23;
}

// Place a route's belts (optionally buying `buyFirst` belts first), then exit belt mode.
function commitRoute(belts: Route['belts'], buyFirst: number): void {
  for (let i = 0; i < buyFirst; i++) {
    if (!session.applyHumanAction({ type: 'BUY_BELT' })) break;
  }
  for (const b of belts) {
    if (!session.applyHumanAction({ type: 'PLACE_BELT', pieceId: b.pieceId, fromPoint: b.fromPoint, toPoint: b.toPoint })) break;
  }
  panelState = freshPanelState();
  routeHoverPoint = null;
  render();
}

// Panel callback for the insufficient-belts prompt.
function handleRouteCommit(confirm: boolean): void {
  const prompt = panelState.beltRoutePrompt;
  if (confirm && prompt && prompt.affordable) {
    commitRoute(prompt.belts, prompt.need);
  } else {
    panelState = freshPanelState();
    routeHoverPoint = null;
    render();
  }
}

// ── Canvas events ─────────────────────────────────────────────────────────────

canvas.addEventListener('wheel', e => {
  e.preventDefault();
  const rect = canvas.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;
  const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
  const newSize = Math.min(MAX_HEX_SIZE, Math.max(MIN_HEX_SIZE, transform.hexSize * factor));
  const ratio = newSize / transform.hexSize;
  transform = {
    hexSize: newSize,
    offsetX: mx + (transform.offsetX - mx) * ratio,
    offsetY: my + (transform.offsetY - my) * ratio,
  };
  renderCanvasOnly();
}, { passive: false });

canvas.addEventListener('mousedown', e => {
  if (e.button !== 0) return;
  const rect = canvas.getBoundingClientRect();
  dragStart = { x: e.clientX - rect.left, y: e.clientY - rect.top, ox: transform.offsetX, oy: transform.offsetY };
  didDrag = false;
});

window.addEventListener('mouseup', e => {
  if (e.button !== 0 || dragStart === null) return;
  dragStart = null;
  canvas.style.cursor = '';
});

canvas.addEventListener('mousemove', e => {
  const rect = canvas.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;

  if (dragStart !== null) {
    const dx = mx - dragStart.x;
    const dy = my - dragStart.y;
    if (!didDrag && Math.hypot(dx, dy) > 4) didDrag = true;
    if (didDrag) {
      transform = { ...transform, offsetX: dragStart.ox + dx, offsetY: dragStart.oy + dy };
      canvas.style.cursor = 'grabbing';
      hoveredCoord = null;
      renderCanvasOnly();
      return;
    }
  }

  // Belt-route picker: track the hovered candidate point (source or destination) so the
  // route preview can update, instead of the normal hex hover.
  if (session.isHumanTurn() && session.state.phase === 'actions' &&
      panelState.pendingActionType === 'PLACE_BELT' && !panelState.beltRoutePrompt) {
    const hit = hitTestPointAmong(mx, my, routeCandidates, session.state, transform);
    if (hit?.pieceId !== routeHoverPoint?.pieceId || hit?.position !== routeHoverPoint?.position) {
      routeHoverPoint = hit;
      renderCanvasOnly();
    }
    return;
  }

  hoveredCoord = pixelToHex(mx, my, transform.hexSize, transform.offsetX, transform.offsetY);
  renderCanvasOnly();
});

canvas.addEventListener('mouseleave', () => {
  // During piece placement keep hoveredCoord so the ghost persists while
  // the player moves the mouse to the rotation buttons in the panel.
  if (session.state.phase !== 'placePiece') hoveredCoord = null;
  render();
});

canvas.addEventListener('click', e => {
  if (didDrag) { didDrag = false; return; } // was a pan drag, not a click
  if (!session.isHumanTurn()) return;
  const rect = canvas.getBoundingClientRect();
  const px = e.clientX - rect.left;
  const py = e.clientY - rect.top;
  const state = session.state;

  if (state.phase === 'setupClaimPF' || state.phase === 'setupClaimPP') {
    const piece = hitTestPiece(px, py, state, transform);
    if (piece) {
      const expectedType = state.phase === 'setupClaimPF' ? 'plateFact' : 'powerPlant';
      if (piece.type === expectedType && piece.claims.length === 0) {
        handleHumanAction({ type: 'SETUP_CLAIM', pieceId: piece.id });
      }
    }
    return;
  }

  if (state.phase === 'placePiece') {
    const coord = hitTestFreeCoord(px, py, state, transform);
    if (coord && isValidCoord(coord, computeValidCoords())) {
      panelState = { ...panelState, selectedCoord: coord };
      render();
    }
    return;
  }

  if (state.phase === 'actions') {
    // Scouting drone placement: step 3 — pick a hex to place the piece.
    if (panelState.pendingCardType === 'scoutingDrone' && panelState.pendingCardTarget2 !== null) {
      const coord = hitTestFreeCoord(px, py, state, transform);
      if (coord && isValidCoord(coord, computeValidCoords())) {
        panelState = { ...panelState, selectedCoord: coord };
        render();
      }
      return;
    }

    // Card piece-selection: clicking a piece captures it as a target.
    if (panelState.pendingCardType && BOARD_PIECE_CARDS.has(panelState.pendingCardType)) {
      const piece = hitTestPiece(px, py, state, transform);
      if (piece && piece.type !== 'blank' && piece.type !== 'mine') {
        if (!panelState.pendingCardTarget) {
          panelState = { ...panelState, pendingCardTarget: piece.id };
        } else if (panelState.pendingCardType === 'changingPriorities' && !panelState.pendingCardTarget2) {
          panelState = { ...panelState, pendingCardTarget2: piece.id };
        }
        render();
      }
      return;
    }

    if (state.overstockPieces.length > 0 || panelState.pendingActionType === 'BUY_MINE') {
      const coord = hitTestFreeCoord(px, py, state, transform);
      if (coord && isValidCoord(coord, computeValidCoords())) {
        panelState = { ...panelState, selectedCoord: coord };
        render();
      }
    } else if (panelState.pendingActionType === 'CLAIM_BUILDING') {
      const piece = hitTestPiece(px, py, state, transform);
      if (piece && piece.type !== 'blank' && piece.type !== 'mine') {
        const legal = legalActions(state, session.viewPlayerId);
        const claimsForPiece = (legal.filter(a =>
          a.type === 'CLAIM_BUILDING' && (a as { pieceId: string }).pieceId === piece.id,
        ) as Array<{ type: 'CLAIM_BUILDING'; pieceId: string; controlModule: number; fromFreeClaim?: boolean }>);
        if (claimsForPiece.length > 0) {
          // Auto-pick lowest module (cheapest claim)
          const best = claimsForPiece.reduce((a, b) => a.controlModule < b.controlModule ? a : b);
          handleHumanAction(best);
        }
      }
    } else if (panelState.pendingActionType === 'REMOVE_BELT') {
      // Find nearest belt whose spline is within hit radius.
      const removable = state.belts.filter(b => b.ownerId === session.viewPlayerId);
      for (const belt of removable) {
        if (hitTestBelt(px, py, belt, state, transform)) {
          handleHumanAction({ type: 'REMOVE_BELT', beltId: belt.id });
          break;
        }
      }
    } else if (panelState.pendingActionType === 'PLACE_BELT') {
      if (panelState.beltRoutePrompt) return; // buy prompt is up — use the panel buttons
      const me = session.viewPlayerId;
      const hit = hitTestPointAmong(px, py, routeCandidates, state, transform);
      if (!hit) return;
      if (!panelState.beltRouteSource) {
        // First click: choose the route's start belt point.
        panelState = { ...panelState, beltRouteSource: hit };
        routeHoverPoint = null;
        render();
      } else {
        // Second click: route from the start point to this one → place (or prompt to buy).
        const route = findBeltPath(state, panelState.beltRouteSource, hit, me);
        if (!route || route.cost === 0) return; // unconnectable / same point
        const have = state.players[me]?.beltsRemaining ?? 0;
        if (route.cost <= have) {
          commitRoute(route.belts, 0);
        } else {
          const need = route.cost - have;
          panelState = {
            ...panelState,
            beltRoutePrompt: { belts: route.belts, cost: route.cost, have, need, affordable: inventoryValue(me) >= need },
          };
          render();
        }
      }
    } else if (panelState.pendingActionType === 'PLACE_TELEPORTER') {
      const piece = hitTestPiece(px, py, state, transform);
      if (piece) {
        const legal = legalActions(state, session.viewPlayerId);
        const tpsForPiece = legal.filter(a =>
          a.type === 'PLACE_TELEPORTER' && (a as { pieceId: string }).pieceId === piece.id,
        ) as Array<{ type: 'PLACE_TELEPORTER'; pieceId: string; bufferType: 'input' | 'output' }>;
        if (tpsForPiece.length === 1) {
          handleHumanAction(tpsForPiece[0]!);
        } else if (tpsForPiece.length > 1) {
          // Both buffers available — show panel choice
          panelState = { ...panelState, tpPieceId: piece.id };
          render();
        }
      }
    }
    return;
  }

  if (state.phase === 'roundEnd' && panelState.pendingActionType === 'CLAIM_BUILDING') {
    const piece = hitTestPiece(px, py, state, transform);
    if (piece && piece.type !== 'blank' && piece.type !== 'mine') {
      const legal = legalActions(state, session.viewPlayerId);
      const claimsForPiece = (legal.filter(a =>
        a.type === 'CLAIM_BUILDING' && (a as { pieceId: string }).pieceId === piece.id,
      ) as Array<{ type: 'CLAIM_BUILDING'; pieceId: string; controlModule: number; fromFreeClaim?: boolean }>);
      if (claimsForPiece.length > 0) {
        const best = claimsForPiece.reduce((a, b) => a.controlModule < b.controlModule ? a : b);
        handleHumanAction(best);
      }
    }
    return;
  }

  if (state.phase === 'placeMeeple') {
    const piece = hitTestPiece(px, py, state, transform);
    if (piece) {
      const isValidTarget = piece.type === 'mine'
        || piece.claims.some(c => c.ownerId === session.viewPlayerId);
      if (isValidTarget) {
        if (piece.type === 'mine') {
          // Clicking hex 1 (upgrade slot) vs hex 0 (resource slot).
          const clickedHex = pixelToHex(px, py, transform.hexSize, transform.offsetX, transform.offsetY);
          const sec = mineSecondaryCoord(piece.coord, piece.rotation ?? 0);
          const isHex1 = sec.q === clickedHex.q && sec.r === clickedHex.r;
          handleHumanAction({ type: 'PLACE_MEEPLE', pieceId: piece.id, slotIndex: isHex1 ? 1 : 0 });
        } else {
          handleHumanAction({ type: 'PLACE_MEEPLE', pieceId: piece.id });
        }
      }
    }
  }
});

// ── Toolbar ───────────────────────────────────────────────────────────────────

function phaseLabel(phase: string): string {
  switch (phase) {
    case 'setupClaimPF': return 'Setup — claim a Plate Factory';
    case 'setupClaimPP': return 'Setup — claim a Power Plant';
    case 'placePiece':   return 'Place piece';
    case 'roll':         return 'Roll dice';
    case 'actions':      return 'Actions';
    case 'placeMeeple':  return 'Place meeple';
    case 'roundEnd':     return 'Round end';
    default:             return phase;
  }
}

// ── Lobby ───────────────────────────────────────────────────────────────────

// Per-seat choices, preserved across player-count changes. Index = player id.
// Each is 'human' or 'bot:<id>' (matching a registry bot).
const seatChoices: string[] = ['human', 'bot:greedy', 'bot:greedy', 'bot:greedy'];

function renderLobbySeats(): void {
  const count = parseInt(setupCount.value, 10);
  setupSeats.innerHTML = '';
  for (let i = 0; i < count; i++) {
    const row = document.createElement('div');
    row.className = 'setup-row';

    const dot = document.createElement('div');
    dot.className = 'seat-dot';
    dot.style.background = PLAYER_COLORS[i] ?? '#fff';

    const label = document.createElement('label');
    label.className = 'lead';
    label.textContent = PLAYER_NAMES[i] ?? `Player ${i + 1}`;

    const sel = document.createElement('select');
    sel.innerHTML =
      `<option value="human">Human</option>` +
      BOT_TYPES.map(b => `<option value="bot:${b.id}">${b.label}</option>`).join('');
    sel.value = seatChoices[i] ?? 'bot:greedy';
    sel.addEventListener('change', () => { seatChoices[i] = sel.value; });

    row.append(dot, label, sel);
    setupSeats.append(row);
  }
}

function readLobbySeats(): Seat[] {
  const count = parseInt(setupCount.value, 10);
  const seats: Seat[] = [];
  for (let i = 0; i < count; i++) {
    const choice = seatChoices[i] ?? 'bot:greedy';
    if (choice === 'human') {
      seats.push({ kind: 'human' });
    } else {
      const bt = botById(choice.slice('bot:'.length));
      seats.push({ kind: 'bot', bot: bt.fn, label: bt.label });
    }
  }
  return seats;
}

function startGame(): void {
  // Leaving any LAN session for a fresh local game.
  net?.disconnect();
  net = null;
  netSession = null;
  session.stop();
  panelState = freshPanelState();
  ghostPiece = null;
  gameOverDismissed = false;
  session = buildSession(readLobbySeats(), Date.now());
  session.setBotDelay(parseInt(botSpeedSelect.value, 10));
  setupOverlay.classList.add('hidden');
  resizeCanvas(); // sizes the canvas, recomputes the transform, and renders
  session.start();
}

function openLobby(): void {
  // In a networked game the host resets the shared room; everyone else just re-opens
  // the overlay and waits for the host's lobby broadcast.
  if (net && netSession) {
    if (lanIsHost) net.returnToLobby();
    else { setMode('lan'); setupOverlay.classList.remove('hidden'); }
    return;
  }
  session.stop(); // pause the current game while configuring a new one
  setupOverlay.classList.remove('hidden');
}

// ── LAN lobby ─────────────────────────────────────────────────────────────────

function setMode(mode: 'local' | 'lan'): void {
  const lan = mode === 'lan';
  modeLanBtn.classList.toggle('active', lan);
  modeLocalBtn.classList.toggle('active', !lan);
  localSetup.classList.toggle('hidden', lan);
  lanSetup.classList.toggle('hidden', !lan);
  if (lan) {
    if (!lanNameInput.value) lanNameInput.value = localStorage.getItem('fs-name') ?? '';
    if (!lanUrlInput.value) lanUrlInput.value = `ws://${location.hostname || 'localhost'}:8080/ws`;
  }
}

function setLanStatus(msg: string, err = false): void {
  lanStatus.textContent = msg;
  lanStatus.classList.toggle('err', err);
}

function botKindLabel(kind: SeatKind): string {
  if (kind === 'open') return 'Open (human)';
  const id = kind.slice('bot:'.length);
  return `Bot: ${BOT_TYPES.find(b => b.id === id)?.label ?? id}`;
}

const lanHandlers: NetHandlers = {
  onOpen: () => setLanStatus('Connected. Joining…'),
  onWelcome: ({ clientId, token, isHost }) => {
    myClientId = clientId;
    lanIsHost = isHost;
    localStorage.setItem(`fs-token:${lanUrlInput.value.trim()}`, token);
    localStorage.setItem('fs-name', lanNameInput.value.trim() || 'Player');
  },
  onLobby: lobby => onLanLobby(lobby),
  onSnapshot: snap => onLanSnapshot(snap),
  onPresence: (playerId, presence) => {
    remotePresence = { playerId, presence };
    // Only the board overlay changed — repaint the canvas, don't rebuild the panel.
    if (netSession && !session.isHumanTurn()) renderCanvasOnly();
  },
  onRejected: reason => { setLanStatus(`Move rejected: ${reason}`, true); net?.resync(); },
  onError: msg => setLanStatus(msg, true),
  onClose: willReconnect =>
    setLanStatus(willReconnect ? 'Disconnected — reconnecting…' : 'Disconnected.', !willReconnect),
};

function lanConnect(): void {
  const url = lanUrlInput.value.trim();
  const name = lanNameInput.value.trim() || 'Player';
  if (!url) { setLanStatus('Enter the host address', true); return; }
  const token = localStorage.getItem(`fs-token:${url}`) ?? undefined;
  net?.disconnect();
  net = new NetClient(lanHandlers);
  setLanStatus('Connecting…');
  net.connect(url, name, token);
}

// The host reconfigured the room, or we (re)joined a lobby, or a game returned to lobby.
function onLanLobby(lobby: LobbyView): void {
  currentLobby = lobby;
  netSession = null;               // any prior game is over / reset
  gameOverDismissed = false;
  gameOverOverlay.classList.add('hidden');
  setMode('lan');
  setupOverlay.classList.remove('hidden');
  lanLobby.classList.remove('hidden');
  renderLanLobby(lobby);
  setLanStatus(`In lobby as ${lanIsHost ? 'host' : 'player'}.`);
}

// A full authoritative state broadcast: enter (or continue) the networked game.
function onLanSnapshot(snap: StateSnapshot): void {
  if (!net) return;
  if (!netSession) {
    session.stop();                 // stop the idle local placeholder session
    netSession = new NetworkSession(net, snap);
    netSession.subscribe(() => render());
    session = netSession;
    panelState = freshPanelState();
    ghostPiece = null;
    gameOverDismissed = false;
    lanLobby.classList.add('hidden');
    setupOverlay.classList.add('hidden');
    resizeCanvas();                 // sizes canvas, recomputes transform, renders
  } else {
    netSession.applySnapshot(snap);
  }
}

function gatherSeatKinds(): SeatKind[] {
  return Array.from(lanLobby.querySelectorAll('select.kind-select'))
    .map(s => (s as HTMLSelectElement).value as SeatKind);
}

function renderLanLobby(lobby: LobbyView): void {
  lanLobby.innerHTML = '';

  if (lanIsHost) {
    const row = document.createElement('div');
    row.className = 'setup-row';
    const label = document.createElement('label');
    label.className = 'lead';
    label.textContent = 'Players';
    const sel = document.createElement('select');
    for (const n of [2, 3, 4]) {
      const opt = document.createElement('option');
      opt.value = String(n);
      opt.textContent = `${n} players`;
      if (n === lobby.playerCount) opt.selected = true;
      sel.append(opt);
    }
    sel.addEventListener('change', () => {
      const n = parseInt(sel.value, 10) as 2 | 3 | 4;
      const kinds: SeatKind[] = [];
      for (let i = 0; i < n; i++) kinds.push(lobby.seats[i]?.kind ?? 'open');
      net?.configure(n, kinds);
    });
    row.append(label, sel);
    lanLobby.append(row);
  }

  for (const seat of lobby.seats) {
    const row = document.createElement('div');
    row.className = 'lan-seat';

    const dot = document.createElement('div');
    dot.className = 'seat-dot';
    dot.style.background = PLAYER_COLORS[seat.index] ?? '#fff';

    const who = document.createElement('span');
    who.className = 'who';
    const base = PLAYER_NAMES[seat.index] ?? `Player ${seat.index + 1}`;
    if (seat.kind !== 'open') {
      who.textContent = `${base} — ${botKindLabel(seat.kind)}`;
    } else if (seat.claimedByClientId) {
      const mine = seat.claimedByClientId === myClientId;
      who.textContent = `${base} — `;
      const nm = document.createElement('span');
      if (mine) nm.className = 'me';
      nm.textContent = mine ? `${seat.claimedByName} (you)` : (seat.claimedByName ?? 'player');
      who.append(nm);
    } else {
      who.textContent = `${base} — (open)`;
    }

    row.append(dot, who);

    if (lanIsHost) {
      const kindSel = document.createElement('select');
      kindSel.className = 'kind-select';
      const openOpt = document.createElement('option');
      openOpt.value = 'open';
      openOpt.textContent = 'Open (human)';
      kindSel.append(openOpt);
      for (const b of BOT_TYPES) {
        const opt = document.createElement('option');
        opt.value = `bot:${b.id}`;
        opt.textContent = `Bot: ${b.label}`;
        kindSel.append(opt);
      }
      kindSel.value = seat.kind;
      kindSel.addEventListener('change', () => net?.configure(lobby.playerCount, gatherSeatKinds()));
      row.append(kindSel);
    }

    if (seat.kind === 'open') {
      const btn = document.createElement('button');
      const mine = seat.claimedByClientId === myClientId;
      if (mine) {
        btn.textContent = 'Release';
        btn.addEventListener('click', () => net?.releaseSeat());
      } else {
        btn.textContent = 'Claim';
        btn.addEventListener('click', () => net?.claimSeat(seat.index));
      }
      row.append(btn);
    }

    lanLobby.append(row);
  }

  if (lanIsHost) {
    const start = document.createElement('button');
    start.id = 'lan-start';
    start.textContent = 'Start Game';
    start.disabled = !lobby.canStart;
    start.addEventListener('click', () => net?.start());
    lanLobby.append(start);
    const note = document.createElement('div');
    note.className = 'lan-note';
    note.textContent = lobby.allSeatsClaimed
      ? 'Use a seat’s dropdown to make it a Bot instead of a human.'
      : 'Open seats with no player will be filled with a Smart Bot on start. ' +
        'Pick a specific bot from a seat’s dropdown, or leave a seat open for a human to claim.';
    lanLobby.append(note);
  } else {
    const note = document.createElement('div');
    note.className = 'lan-note';
    note.textContent = 'Waiting for the host to start the game…';
    lanLobby.append(note);
  }
}

modeLocalBtn.addEventListener('click', () => setMode('local'));
modeLanBtn.addEventListener('click', () => setMode('lan'));
lanConnectBtn.addEventListener('click', lanConnect);

setupCount.addEventListener('change', renderLobbySeats);
document.getElementById('setup-start')!.addEventListener('click', startGame);
document.getElementById('new-game-btn')!.addEventListener('click', openLobby);
document.getElementById('game-over-new-btn')!.addEventListener('click', () => {
  gameOverOverlay.classList.add('hidden');
  openLobby();
});
// Dismiss the game-over overlay to pan/zoom and inspect the final board. The result
// stays available via the toolbar "New Game" button; it won't pop back up on its own.
document.getElementById('game-over-view-btn')!.addEventListener('click', () => {
  gameOverDismissed = true;
  gameOverOverlay.classList.add('hidden');
});

// ── End-of-game stats screen ──────────────────────────────────────────────────

const statsOverlay = document.getElementById('stats-overlay')!;
const statsContent = document.getElementById('stats-content')!;

function showStats(): void {
  const rows = playerStats(session.state);
  const colOf = (id: number) => PLAYER_COLORS[id] ?? '#fff';
  const nameOf = (id: number) => escapeHtml(PLAYER_NAMES[id] ?? `Player ${id + 1}`);

  // metric label → value extractor
  const metrics: Array<[string, (r: (typeof rows)[number]) => number]> = [
    ['Tesseracts', r => r.tesseracts],
    ['Bonus Tesseracts', r => r.bonusTesseracts],
    ['Total Tesseracts', r => r.totalTesseracts],
    ['Ore', r => r.ore],
    ['Plate', r => r.plate],
    ['Sphere', r => r.sphere],
    ['Belts used', r => r.beltsUsed],
    ['Buildings claimed', r => r.buildingsClaimed],
    ['Control Modules used', r => r.modulesUsed],
    ['Longest belt', r => r.longestBelt],
    ['Cards purchased', r => r.cardsPurchased],
    ['Cards played', r => r.cardsPlayed],
    ['Modules upgraded', r => r.modulesUpgraded],
  ];

  const head = `<tr><th class="metric"></th>${rows
    .map(r => `<th style="color:${colOf(r.playerId)}">${nameOf(r.playerId)}</th>`)
    .join('')}</tr>`;
  const body = metrics
    .map(([label, get]) =>
      `<tr><td class="metric">${label}</td>${rows.map(r => `<td>${get(r)}</td>`).join('')}</tr>`)
    .join('');
  statsContent.innerHTML = `<table><thead>${head}</thead><tbody>${body}</tbody></table>`;
  statsOverlay.classList.remove('hidden');
}

document.getElementById('game-over-stats-btn')!.addEventListener('click', showStats);
document.getElementById('stats-close-btn')!.addEventListener('click', () => {
  statsOverlay.classList.add('hidden');
});

botSpeedSelect.addEventListener('change', () => {
  session.setBotDelay(parseInt(botSpeedSelect.value, 10));
});

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

renderLobbySeats();
render();
