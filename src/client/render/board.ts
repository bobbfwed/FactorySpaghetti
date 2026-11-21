// Canvas 2D renderer for the Factory Spaghetti hex board.

import type { GameState, HexCoord, BoardPiece, Buffer, Belt } from '../../engine/state';
import type { PieceType, PointRole } from '../../engine/config';
import { PIECE_TEMPLATES } from '../../engine/config';
import { hexToPixel, hexCorners, pixelToHex } from './hex';
import type { Point } from './hex';
import { PIECE_FILL, PIECE_STROKE, PLAYER_COLORS, MATERIAL_FILL } from './colors';
import { mineSecondaryCoord } from '../../engine/rules/pieces';

// ── Transform state ───────────────────────────────────────────────────────────

export interface BoardTransform {
  offsetX: number;
  offsetY: number;
  hexSize: number;
}

export function computeTransform(state: GameState, canvas: HTMLCanvasElement): BoardTransform {
  const allCoords = collectAllCoords(state);
  if (allCoords.length === 0) {
    return { offsetX: canvas.width / 2, offsetY: canvas.height / 2, hexSize: 52 };
  }
  for (const size of [60, 52, 44, 36, 28, 22, 16]) {
    const pixels = allCoords.map(c => hexToPixel(c.q, c.r, size, 0, 0));
    const minX = Math.min(...pixels.map(p => p.x)) - size * 1.2;
    const maxX = Math.max(...pixels.map(p => p.x)) + size * 1.2;
    const minY = Math.min(...pixels.map(p => p.y)) - size * 1.2;
    const maxY = Math.max(...pixels.map(p => p.y)) + size * 1.2;
    if (maxX - minX < canvas.width - 16 && maxY - minY < canvas.height - 16) {
      return {
        offsetX: canvas.width / 2 - (minX + maxX) / 2,
        offsetY: canvas.height / 2 - (minY + maxY) / 2,
        hexSize: size,
      };
    }
  }
  const pixels = allCoords.map(c => hexToPixel(c.q, c.r, 16, 0, 0));
  const minX = Math.min(...pixels.map(p => p.x)) - 20;
  const maxX = Math.max(...pixels.map(p => p.x)) + 20;
  const minY = Math.min(...pixels.map(p => p.y)) - 20;
  const maxY = Math.max(...pixels.map(p => p.y)) + 20;
  return {
    offsetX: canvas.width / 2 - (minX + maxX) / 2,
    offsetY: canvas.height / 2 - (minY + maxY) / 2,
    hexSize: 16,
  };
}

function collectAllCoords(state: GameState): HexCoord[] {
  const coords: HexCoord[] = [];
  for (const p of state.board) {
    coords.push(p.coord);
    if (p.type === 'mine') coords.push(mineSecondaryCoord(p.coord, p.rotation ?? 0));
  }
  return coords;
}

// ── Public draw API ───────────────────────────────────────────────────────────

export interface GhostPiece {
  coord: HexCoord;
  pieceType: PieceType;
  rotation: number;
}

export interface BeltSelection {
  pieceId: string | null;       // null = no piece chosen yet
  fromPoint: number | null;     // null = first point not chosen yet
  legalPieceIds: ReadonlySet<string>;
}

// Route-placement overlay (findRoute-driven belt picker).
export interface RoutePointRef { pieceId: string; position: number; }
export interface RouteBelt { pieceId: string; fromPoint: number; toPoint: number; }
export interface RouteModeView {
  // Belt connection points to highlight as clickable route endpoints.
  candidatePoints: ReadonlyArray<RoutePointRef>;
  selectedSource: RoutePointRef | null;   // the first point the player clicked
  hoverPoint: RoutePointRef | null;        // currently hovered candidate
  route: ReadonlyArray<RouteBelt> | null;  // preview belts for source → hovered point
  beltsRemaining: number;                  // belts up to this many draw solid; the rest dashed
}

export interface DrawOptions {
  transform: BoardTransform;
  validCoords?: ReadonlyArray<HexCoord>;
  selectedCoord?: HexCoord | null;
  hoveredCoord?: HexCoord | null;
  ghostPiece?: GhostPiece | null;
  meepleValidPieceIds?: ReadonlySet<string>;
  claimablePieceIds?: ReadonlySet<string>; // buildings the player may claim now (claim mode)
  beltSelection?: BeltSelection | null;
  removeBeltMode?: boolean;
  routeMode?: RouteModeView | null;
}

export function drawBoard(canvas: HTMLCanvasElement, state: GameState, opts: DrawOptions): void {
  const ctx = canvas.getContext('2d')!;
  const { offsetX: ox, offsetY: oy, hexSize: sz } = opts.transform;

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#1a1a2e';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Valid placement highlights
  if (opts.validCoords) {
    for (const coord of opts.validCoords) {
      drawHexFill(ctx, coord, ox, oy, sz, 'rgba(255,235,59,0.15)', 'rgba(255,235,59,0.4)', 1);
    }
  }

  // Hovered valid coord
  if (opts.hoveredCoord) {
    drawHexFill(ctx, opts.hoveredCoord, ox, oy, sz, 'rgba(255,235,59,0.3)', '#ffe033', 2);
  }

  // Ghost piece (placement preview) — drawn under everything else
  if (opts.ghostPiece) {
    const gp = opts.ghostPiece;
    const { x: gx, y: gy } = hexToPixel(gp.coord.q, gp.coord.r, sz, ox, oy);
    ctx.save();
    ctx.globalAlpha = 0.45;
    drawHexFill(ctx, gp.coord, ox, oy, sz, PIECE_FILL[gp.pieceType], PIECE_STROKE[gp.pieceType], 1.5);
    drawConnectionPointsAt(ctx, gp.pieceType, gp.rotation, gx, gy, sz);
    ctx.restore();
  }

  // Selected coord (white outline)
  if (opts.selectedCoord) {
    drawHexFill(ctx, opts.selectedCoord, ox, oy, sz, 'rgba(255,255,255,0.08)', '#fff', 2.5);
  }

  // Board pieces
  for (const piece of state.board) {
    drawPiece(ctx, piece, state, ox, oy, sz, opts.meepleValidPieceIds);
  }

  // Claimable-building highlight — drawn OVER the (opaque) pieces so it's visible, unlike
  // the under-piece validCoords tint. A bright outline + soft glow marks what can be claimed;
  // the building under the cursor gets a much stronger background fill for clear feedback.
  if (opts.claimablePieceIds && opts.claimablePieceIds.size > 0) {
    const hov = opts.hoveredCoord;
    for (const piece of state.board) {
      if (!opts.claimablePieceIds.has(piece.id)) continue;
      const hovered = !!hov && hov.q === piece.coord.q && hov.r === piece.coord.r;
      ctx.save();
      ctx.shadowColor = '#ffe033';
      ctx.shadowBlur = Math.max(6, sz * (hovered ? 0.45 : 0.25));
      drawHexFill(
        ctx, piece.coord, ox, oy, sz,
        hovered ? 'rgba(255,224,51,0.42)' : 'rgba(255,224,51,0.12)',
        '#ffe033', hovered ? 4 : 3,
      );
      ctx.restore();
    }
  }

  // Belt selection overlay (before existing belts so belts draw on top)
  if (opts.beltSelection) {
    const { pieceId, fromPoint, legalPieceIds } = opts.beltSelection;
    for (const piece of state.board) {
      if (!legalPieceIds.has(piece.id)) continue;
      if (pieceId !== null && piece.id !== pieceId) continue;
      const { x: cx, y: cy } = hexToPixel(piece.coord.q, piece.coord.r, sz, ox, oy);
      const occupied = new Set(
        state.belts.filter(b => b.pieceId === piece.id).flatMap(b => [b.fromPoint, b.toPoint]),
      );
      drawBeltSelectionPoints(ctx, piece, cx, cy, sz, pieceId === piece.id ? fromPoint : null, occupied);
    }
  }

  // Belts (on top)
  for (const belt of state.belts) {
    drawBelt(ctx, belt, state, ox, oy, sz, PLAYER_COLORS[belt.ownerId] ?? '#888', !!opts.removeBeltMode);
  }

  // Route-placement overlay (drawn last, above everything)
  if (opts.routeMode) drawRouteMode(ctx, state, opts.routeMode, ox, oy, sz);
}

// ── Hex fill primitive ────────────────────────────────────────────────────────

function drawHexFill(
  ctx: CanvasRenderingContext2D,
  coord: HexCoord,
  ox: number, oy: number, sz: number,
  fill: string, stroke: string, lineWidth: number,
): void {
  const { x: cx, y: cy } = hexToPixel(coord.q, coord.r, sz, ox, oy);
  const corners = hexCorners(cx, cy, sz - 0.5);
  ctx.beginPath();
  ctx.moveTo(corners[0]!.x, corners[0]!.y);
  for (let i = 1; i < 6; i++) ctx.lineTo(corners[i]!.x, corners[i]!.y);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = stroke;
  ctx.lineWidth = lineWidth;
  ctx.stroke();
}

// ── Piece drawing ─────────────────────────────────────────────────────────────

function drawPiece(
  ctx: CanvasRenderingContext2D,
  piece: BoardPiece,
  state: GameState,
  ox: number, oy: number, sz: number,
  meepleValidIds?: ReadonlySet<string>,
): void {
  const { x: cx, y: cy } = hexToPixel(piece.coord.q, piece.coord.r, sz, ox, oy);
  const rotation = piece.rotation ?? 0;

  if (piece.type === 'mine') {
    const secondary = mineSecondaryCoord(piece.coord, rotation);
    const { x: sx, y: sy } = hexToPixel(secondary.q, secondary.r, sz, ox, oy);
    // Thick connector between the two hexes
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(sx, sy);
    ctx.strokeStyle = PIECE_FILL['mine'];
    ctx.lineWidth = sz * 0.55;
    ctx.lineCap = 'round';
    ctx.stroke();
    ctx.lineCap = 'butt';
    drawHexFill(ctx, piece.coord, ox, oy, sz, PIECE_FILL['mine'], PIECE_STROKE['mine'], 1.5);
    drawHexFill(ctx, secondary, ox, oy, sz, PIECE_FILL['mine'], PIECE_STROKE['mine'], 1.5);
    drawConnectionPointsAt(ctx, 'mine', rotation, cx, cy, sz);
    drawMineHex1Points(ctx, secondary.q, secondary.r, rotation, sx, sy, sz);
    drawMeepleSlots(ctx, piece, state, cx, cy, sx, sy, sz, meepleValidIds);
    drawLabel(ctx, cx, cy, sz, 'MINE', PIECE_ICON['mine']);
    return;
  }

  const { fill, stroke } = pieceColors(piece);
  drawHexFill(ctx, piece.coord, ox, oy, sz, fill, stroke, 1.5);
  drawConnectionPointsAt(ctx, piece.type, rotation, cx, cy, sz);
  if (piece.type === 'blank') return; // blanks: no claims, buffers, meeple slots, or label
  drawClaims(ctx, piece, cx, cy, sz);
  drawBuffers(ctx, piece, cx, cy, sz);
  drawMeepleSlots(ctx, piece, state, cx, cy, null, null, sz, meepleValidIds);
  // Label drawn last so it's never covered by buffers or slot markers
  drawLabel(ctx, cx, cy, sz, PIECE_LONG_LABEL[piece.type] ?? piece.type, PIECE_ICON[piece.type]);
}

const PIECE_LONG_LABEL: Record<PieceType, string> = {
  blank:         'BLANK',
  mine:          'MINE',
  plateFact:     'PLATE FACT',
  sphereFact:    'SPHERE FACT',
  tesseractFact: 'TESS FACT',
  powerPlant:    'POWER PLANT',
};

const PIECE_ICON: Record<PieceType, string> = {
  blank:         '·',
  mine:          '⛏',
  plateFact:     '▱',
  sphereFact:    '●',
  tesseractFact: '★',
  powerPlant:    '⚡',
};

function colorScale(hex: string, factor: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgb(${Math.round(r * factor)},${Math.round(g * factor)},${Math.round(b * factor)})`;
}

// Unclaimed buildings render as a neutral gray — lighter than a blank — so they read as
// "a building nobody owns yet" (claim it to take on your player colour). Blanks stay darker.
const UNCLAIMED_BUILDING_FILL = '#50505e';
const UNCLAIMED_BUILDING_STROKE = '#7c7c8a';

function pieceColors(piece: BoardPiece): { fill: string; stroke: string } {
  if (piece.type === 'mine' || piece.type === 'blank') {
    return { fill: PIECE_FILL[piece.type], stroke: PIECE_STROKE[piece.type] };
  }
  if (piece.claims.length === 0) {
    return { fill: UNCLAIMED_BUILDING_FILL, stroke: UNCLAIMED_BUILDING_STROKE };
  }
  const color = PLAYER_COLORS[piece.claims[0]!.ownerId] ?? '#888';
  return { fill: colorScale(color, 0.35), stroke: color };
}

function drawLabel(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number, sz: number,
  longText: string, icon?: string,
): void {
  if (sz < 16) return;

  const useIcon = icon && icon !== '·' && sz >= 26;
  const text = useIcon ? icon : (sz >= 36 ? longText : longText.split(' ').map(w => w[0]).join(''));
  const fontSize = useIcon ? Math.max(11, sz * 0.3) : (sz >= 36 ? Math.max(9, sz * 0.2) : Math.max(8, sz * 0.28));

  ctx.font = `bold ${fontSize}px monospace`;
  const w = ctx.measureText(text).width + 4;
  const h = fontSize + 4;

  // Dark pill background for readability
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.beginPath();
  ctx.roundRect(cx - w / 2, cy - h / 2, w, h, 3);
  ctx.fill();

  ctx.fillStyle = 'rgba(255,255,255,0.95)';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, cx, cy);
}

// ── Claims ────────────────────────────────────────────────────────────────────

function drawClaims(
  ctx: CanvasRenderingContext2D,
  piece: BoardPiece,
  cx: number, cy: number, sz: number,
): void {
  if (piece.claims.length === 0) return;
  const dotR = Math.max(4, sz * 0.13);
  const spread = dotR * 2.5;
  // The control-module tile ROTATES with the piece. At rotation 0 it sits at the top
  // vertex (a gap between the two upper edges); rotating by rotation·60° keeps it tracking
  // that gap as the I/O symbols rotate, so it never gets buried by an input/output symbol.
  const rotation = piece.rotation ?? 0;
  const angle = -Math.PI / 2 + rotation * (Math.PI / 3);
  const rad = sz * 0.52;
  const ax = cx + Math.cos(angle) * rad;
  const ay = cy + Math.sin(angle) * rad;
  const tx = -Math.sin(angle), ty = Math.cos(angle); // tangent: spread claims along the edge
  const startOff = -(piece.claims.length - 1) / 2;
  for (let i = 0; i < piece.claims.length; i++) {
    const claim = piece.claims[i]!;
    const off = (startOff + i) * spread;
    const dotX = ax + tx * off;
    const dotY = ay + ty * off;
    ctx.beginPath();
    ctx.arc(dotX, dotY, dotR, 0, Math.PI * 2);
    ctx.fillStyle = PLAYER_COLORS[claim.ownerId] ?? '#888';
    ctx.fill();
    if (sz >= 30) {
      const numSize = Math.max(7, sz * 0.21);
      ctx.fillStyle = '#fff';
      ctx.font = `bold ${numSize}px monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(claim.controlModule), dotX, dotY);
    }
  }
}

// ── Buffers ───────────────────────────────────────────────────────────────────

function drawBuffers(
  ctx: CanvasRenderingContext2D,
  piece: BoardPiece,
  cx: number, cy: number, sz: number,
): void {
  if (sz < 22) return;
  const rotation = piece.rotation ?? 0;
  // Anchor each buffer near its own connection points so the symbols rotate with
  // the piece (rather than sitting at a fixed left/right). Fall back to the old
  // fixed offset if a role has no enabled points.
  if (piece.input) {
    const a = bufferAnchor(piece.type, rotation, 'input_buffer', cx, cy, sz)
      ?? { x: cx - sz * 0.44, y: cy };
    drawBuffer(ctx, piece.input, a.x, a.y, sz, true);
  }
  if (piece.output) {
    const a = bufferAnchor(piece.type, rotation, 'output_buffer', cx, cy, sz)
      ?? { x: cx + sz * 0.44, y: cy };
    drawBuffer(ctx, piece.output, a.x, a.y, sz, false);
  }
}

// Centroid (inset toward the hex center) of all enabled points with the given role,
// using the same rotated edge geometry as the connection-point indicators.
// Returns null when the piece type has no such point.
function bufferAnchor(
  pieceType: PieceType,
  rotation: number,
  role: PointRole,
  cx: number, cy: number, sz: number,
): Point | null {
  const template = PIECE_TEMPLATES[pieceType];
  const corners = hexCorners(cx, cy, sz);
  let sumX = 0, sumY = 0, n = 0;
  for (let edge = 0; edge < 6; edge++) {
    const ve = (edge + rotation + 3) % 6;
    const v0 = corners[ve]!;
    const v1 = corners[(ve + 1) % 6]!;
    for (let w = 0; w < 2; w++) {
      const pt = template.points[edge * 2 + w];
      if (!pt?.enabled || pt.role !== role) continue;
      const t = w === 0 ? 1 / 3 : 2 / 3;
      sumX += v0.x + (v1.x - v0.x) * t;
      sumY += v0.y + (v1.y - v0.y) * t;
      n++;
    }
  }
  if (n === 0) return null;
  const mx = sumX / n, my = sumY / n;
  const inset = 0.52; // pull the slot stack inward so it sits inside the hex
  return { x: cx + (mx - cx) * inset, y: cy + (my - cy) * inset };
}

function drawBuffer(
  ctx: CanvasRenderingContext2D,
  buf: Buffer,
  x: number, y: number, sz: number,
  isInput: boolean,
): void {
  // Scale with zoom (hex size) so symbols grow/shrink as the board scales.
  const slotH = Math.max(7, sz * 0.22);
  const slotW = slotH * 1.3;
  const gap = 2;
  const totalH = buf.slots.length * slotH + (buf.slots.length - 1) * gap;
  const startY = y - totalH / 2;

  const MATERIAL_SYMBOL: Record<string, string> = {
    ore: 'O', plate: '▱', sphere: '●', tesseract: '★',
  };

  for (let i = 0; i < buf.slots.length; i++) {
    const mat = buf.slots[i];
    const slotY = startY + i * (slotH + gap);
    ctx.fillStyle = mat ? (MATERIAL_FILL[mat] ?? '#aaa') : '#1a1a2e';
    ctx.strokeStyle = isInput ? '#4fc3f7' : '#a5d6a7';
    ctx.lineWidth = 1;
    ctx.fillRect(x - slotW / 2, slotY, slotW, slotH);
    ctx.strokeRect(x - slotW / 2, slotY, slotW, slotH);
    if (mat && slotH >= 7) {
      const sym = MATERIAL_SYMBOL[mat] ?? mat[0]!.toUpperCase();
      ctx.save();
      ctx.fillStyle = mat === 'tesseract' ? '#222' : '#fff';
      ctx.font = `bold ${Math.max(6, Math.floor(slotH * 0.68))}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(sym, x, slotY + slotH / 2);
      ctx.restore();
    }
  }

  // Teleporter badge — ONE prominent portal marker for the whole buffer (was an easy-to-miss
  // 2px dot per slot). Player-coloured, glowing, with a white bullseye ring so it clearly
  // reads as a placed teleporter.
  if (buf.teleporterOwner !== null && sz >= 16) {
    const color = PLAYER_COLORS[buf.teleporterOwner] ?? '#e040fb';
    const R = Math.max(6, sz * 0.16);
    const bx = x + slotW / 2 + R * 0.15;
    const by = startY - R * 0.15;
    ctx.save();
    ctx.shadowColor = color;
    ctx.shadowBlur = R;
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(bx, by, R, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = Math.max(1.5, R * 0.3);
    ctx.beginPath(); ctx.arc(bx, by, R * 0.55, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(bx, by, R * 0.16, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
}

// ── Meeple slots ──────────────────────────────────────────────────────────────
//
// Each piece shows one or two meeple slot markers so it's clear where to click.
// Mines have two: slot 0 = resource (hex 0, collect ore this round),
//                 slot 1 = upgrade (hex 1, earn a Control Module upgrade).
// All other pieces have one slot at the lower-center of the hex.

function drawMeepleSlots(
  ctx: CanvasRenderingContext2D,
  piece: BoardPiece,
  state: GameState,
  cx: number, cy: number,
  sx: number | null, sy: number | null,
  sz: number,
  validIds?: ReadonlySet<string>,
): void {
  if (sz < 20) return;
  const isValid = validIds?.has(piece.id) ?? false;
  const yOff = sz * 0.28;

  if (piece.type === 'mine' && sx !== null && sy !== null) {
    // Each mine slot is independent — look them up separately so both show at once
    const slot0 = state.players.find(p => p.meepleOnPieceId === piece.id && p.meepleSlotIndex === 0) ?? null;
    const slot1 = state.players.find(p => p.meepleOnPieceId === piece.id && p.meepleSlotIndex === 1) ?? null;
    const color0 = slot0 ? (PLAYER_COLORS[slot0.id] ?? '#fff') : null;
    const color1 = slot1 ? (PLAYER_COLORS[slot1.id] ?? '#fff') : null;
    drawMeepleSlot(ctx, cx, cy + yOff, sz, 'R', color0, isValid && slot0 === null);
    drawMeepleSlot(ctx, sx, sy + yOff, sz, 'U', color1, isValid && slot1 === null);
  } else {
    const meeplePlayer = state.players.find(p => p.meepleOnPieceId === piece.id) ?? null;
    const meepleColor = meeplePlayer ? (PLAYER_COLORS[meeplePlayer.id] ?? '#fff') : null;
    drawMeepleSlot(ctx, cx, cy + yOff, sz, null, meepleColor, isValid);
  }
}

function drawMeepleSlot(
  ctx: CanvasRenderingContext2D,
  x: number, y: number,
  sz: number,
  label: string | null,
  playerColor: string | null,
  isValid: boolean,
): void {
  const r = Math.max(5, sz * 0.15);
  ctx.save();

  if (playerColor) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = playerColor;
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.strokeStyle = isValid ? '#ffe033' : 'rgba(255,255,255,0.22)';
    ctx.lineWidth = isValid ? 2 : 1;
    ctx.setLineDash([3, 3]);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  if (label && sz >= 24) {
    const labelColor = playerColor
      ? '#fff'
      : (isValid ? '#ffe033' : 'rgba(255,255,255,0.4)');
    ctx.fillStyle = labelColor;
    ctx.font = `bold ${Math.max(7, sz * 0.14)}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, x, y);
  }

  ctx.restore();
}

// ── Belts ─────────────────────────────────────────────────────────────────────

// Returns the inward-pointing unit normal for a belt connection point's edge.
function beltEdgeNormal(cx: number, cy: number, sz: number, rotation: number, position: number): Point {
  const edge = Math.floor(position / 2);
  const ve = (edge + rotation + 3) % 6;
  const corners = hexCorners(cx, cy, sz);
  const v0 = corners[ve]!;
  const v1 = corners[(ve + 1) % 6]!;
  const midX = (v0.x + v1.x) / 2;
  const midY = (v0.y + v1.y) / 2;
  const dx = cx - midX;
  const dy = cy - midY;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  return { x: dx / len, y: dy / len };
}

// Returns the point exactly ON the hex edge (not inset) for a given position.
function beltEdgePoint(cx: number, cy: number, sz: number, rotation: number, position: number): Point {
  const edge = Math.floor(position / 2);
  const w = position % 2;
  const ve = (edge + rotation + 3) % 6;
  const corners = hexCorners(cx, cy, sz);
  const v0 = corners[ve]!;
  const v1 = corners[(ve + 1) % 6]!;
  const t = w === 0 ? 1 / 3 : 2 / 3;
  return { x: v0.x + (v1.x - v0.x) * t, y: v0.y + (v1.y - v0.y) * t };
}

// Returns { p1, cp1, cp2, p2 } for a cubic Bezier spline between two belt points.
// Endpoints sit on the hex edge so adjacent belts meet seamlessly.
function beltSpline(
  cx: number, cy: number, sz: number,
  rotation: number,
  fromPoint: number, toPoint: number,
): { p1: Point; cp1: Point; cp2: Point; p2: Point } {
  // Edge points — on the hex perimeter — make belt ends flush with neighbours.
  const p1 = beltEdgePoint(cx, cy, sz, rotation, fromPoint);
  const p2 = beltEdgePoint(cx, cy, sz, rotation, toPoint);
  const n1 = beltEdgeNormal(cx, cy, sz, rotation, fromPoint);
  const n2 = beltEdgeNormal(cx, cy, sz, rotation, toPoint);
  const dist = Math.sqrt((p2.x - p1.x) ** 2 + (p2.y - p1.y) ** 2);
  const ctrl = dist * 0.6;
  return {
    p1,
    cp1: { x: p1.x + n1.x * ctrl, y: p1.y + n1.y * ctrl },
    cp2: { x: p2.x + n2.x * ctrl, y: p2.y + n2.y * ctrl },
    p2,
  };
}

function drawBelt(
  ctx: CanvasRenderingContext2D,
  belt: Belt,
  state: GameState,
  ox: number, oy: number, sz: number,
  color: string,
  removeBeltMode: boolean,
): void {
  const piece = state.board.find(p => p.id === belt.pieceId);
  if (!piece) return;
  const { x: cx, y: cy } = hexToPixel(piece.coord.q, piece.coord.r, sz, ox, oy);
  const rotation = piece.rotation ?? 0;
  const { p1, cp1, cp2, p2 } = beltSpline(cx, cy, sz, rotation, belt.fromPoint, belt.toPoint);

  ctx.beginPath();
  ctx.moveTo(p1.x, p1.y);
  ctx.bezierCurveTo(cp1.x, cp1.y, cp2.x, cp2.y, p2.x, p2.y);

  if (removeBeltMode) {
    // Pulsing highlight when hoverable for removal
    ctx.strokeStyle = '#ff5555';
    ctx.lineWidth = 6;
    ctx.setLineDash([8, 4]);
    ctx.stroke();
    ctx.setLineDash([]);
  } else {
    // Solid colored spline
    ctx.strokeStyle = color;
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.stroke();
    // Thin white center line for depth
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
}

// Hit-tests pixel (px,py) against a specific belt's spline (samples along curve).
export function hitTestBelt(
  px: number, py: number,
  belt: Belt,
  state: GameState,
  transform: BoardTransform,
  hitRadius = 10,
): boolean {
  const piece = state.board.find(p => p.id === belt.pieceId);
  if (!piece) return false;
  const { offsetX: ox, offsetY: oy, hexSize: sz } = transform;
  const { x: cx, y: cy } = hexToPixel(piece.coord.q, piece.coord.r, sz, ox, oy);
  const rotation = piece.rotation ?? 0;
  const { p1, cp1, cp2, p2 } = beltSpline(cx, cy, sz, rotation, belt.fromPoint, belt.toPoint);

  // Sample 24 points along the curve and find minimum distance.
  for (let i = 0; i <= 24; i++) {
    const t = i / 24;
    const mt = 1 - t;
    const bx = mt ** 3 * p1.x + 3 * mt ** 2 * t * cp1.x + 3 * mt * t ** 2 * cp2.x + t ** 3 * p2.x;
    const by = mt ** 3 * p1.y + 3 * mt ** 2 * t * cp1.y + 3 * mt * t ** 2 * cp2.y + t ** 3 * p2.y;
    if (Math.sqrt((px - bx) ** 2 + (py - by) ** 2) <= hitRadius) return true;
  }
  return false;
}

// ── Belt selection overlay ────────────────────────────────────────────────────

function beltPointPixel(
  cx: number, cy: number, sz: number,
  rotation: number,
  position: number,
): { x: number; y: number } {
  const edge = Math.floor(position / 2);
  const w = position % 2;
  const ve = (edge + rotation + 3) % 6;
  const corners = hexCorners(cx, cy, sz);
  const v0 = corners[ve]!;
  const v1 = corners[(ve + 1) % 6]!;
  const t = w === 0 ? 1 / 3 : 2 / 3;
  const mx = v0.x + (v1.x - v0.x) * t;
  const my = v0.y + (v1.y - v0.y) * t;
  const inset = 0.72;
  return { x: cx + (mx - cx) * inset, y: cy + (my - cy) * inset };
}

function drawBeltSelectionPoints(
  ctx: CanvasRenderingContext2D,
  piece: BoardPiece,
  cx: number, cy: number, sz: number,
  fromPoint: number | null,
  occupied: ReadonlySet<number>,
): void {
  if (sz < 16 || piece.type === 'mine') return;
  const template = PIECE_TEMPLATES[piece.type];
  const rotation = piece.rotation ?? 0;
  const totalPos = template.hexCount * 12;
  const dotR = Math.max(4, sz * 0.13);

  for (const ptDef of template.points) {
    if (!ptDef.enabled || ptDef.role !== 'belt') continue;
    const pos = ptDef.position;
    const { x: bx, y: by } = beltPointPixel(cx, cy, sz, rotation, pos);

    let fillColor: string;
    if (pos === fromPoint) {
      fillColor = '#ffe033'; // selected first point
    } else if (occupied.has(pos)) {
      fillColor = 'rgba(200,60,60,0.7)'; // already in use by a belt
    } else if (fromPoint !== null) {
      const dist = Math.min(Math.abs(pos - fromPoint), totalPos - Math.abs(pos - fromPoint));
      fillColor = dist <= 2
        ? 'rgba(200,140,40,0.55)' // adjacent — invalid second point
        : 'rgba(80,220,100,0.9)'; // valid second point
    } else {
      fillColor = 'rgba(255,255,255,0.8)'; // available first point
    }

    ctx.beginPath();
    ctx.arc(bx, by, dotR, 0, Math.PI * 2);
    ctx.fillStyle = fillColor;
    ctx.fill();
    if (pos === fromPoint) {
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }
}

export function hitTestBeltPoint(
  px: number, py: number,
  piece: BoardPiece,
  t: BoardTransform,
  occupied: ReadonlySet<number>,
  fromPoint: number | null,
): number | null {
  if (piece.type === 'mine') return null;
  const template = PIECE_TEMPLATES[piece.type];
  const { x: cx, y: cy } = hexToPixel(piece.coord.q, piece.coord.r, t.hexSize, t.offsetX, t.offsetY);
  const rotation = piece.rotation ?? 0;
  const totalPos = template.hexCount * 12;
  const hitR = Math.max(7, t.hexSize * 0.22);

  let closest: { pos: number; dist: number } | null = null;

  for (const ptDef of template.points) {
    if (!ptDef.enabled || ptDef.role !== 'belt') continue;
    if (occupied.has(ptDef.position)) continue;
    if (fromPoint !== null) {
      if (ptDef.position === fromPoint) continue;
      const dist = Math.min(
        Math.abs(ptDef.position - fromPoint),
        totalPos - Math.abs(ptDef.position - fromPoint),
      );
      if (dist <= 2) continue;
    }
    const { x: bx, y: by } = beltPointPixel(cx, cy, t.hexSize, rotation, ptDef.position);
    const d = Math.sqrt((px - bx) ** 2 + (py - by) ** 2);
    if (d <= hitR && (closest === null || d < closest.dist)) {
      closest = { pos: ptDef.position, dist: d };
    }
  }

  return closest?.pos ?? null;
}

// ── Connection-point geometry ─────────────────────────────────────────────────
//
// Each hex template defines 12 positions (2 per edge, 6 edges), going clockwise:
//   Template edges in order: left(0-1), upper-left(2-3), upper-right(4-5),
//                            right(6-7), lower-right(8-9), lower-left(10-11)
//
// HEX_DIRECTIONS = [{q:+1,r:0},{q:-1,r:0},{q:0,r:+1},{q:0,r:-1},{q:+1,r:-1},{q:-1,r:+1}]
// Each direction maps to the following vertex-edge in my hexCorners system (vertices
// clockwise from upper-right at -30°):
//   dir 0 (+q, right)        → vertex edge 0 (v0→v1)
//   dir 1 (-q, left)         → vertex edge 3 (v3→v4)
//   dir 2 (+r, lower-right)  → vertex edge 1 (v1→v2)
//   dir 3 (-r, upper-left)   → vertex edge 4 (v4→v5)
//   dir 4 (+q-r, upper-right)→ vertex edge 5 (v5→v0)
//   dir 5 (-q+r, lower-left) → vertex edge 2 (v2→v3)
// i.e. HEX_DIR_TO_VERTEX_EDGE = [0, 3, 1, 4, 5, 2]
//
// Template edge numbering follows the direction convention so that
// template edge 0 corresponds to direction 0 at rotation 0.
// At rotation R, template edge E is drawn at vertex edge:
//   HEX_DIR_TO_VERTEX_EDGE[(E + R) % 6]

const HEX_DIR_TO_VERTEX_EDGE = [0, 3, 1, 4, 5, 2] as const;

// Mine lean-hex (hex 1): template edge → vertex-edge offset from the internal edge iv
// (iv = HEX_DIR_TO_VERTEX_EDGE[rotation ^ 1]). The 3 ore edges (1,2,5) land at offsets
// {5,3,1} — the every-other vertex edges — for ALL rotations. Must match flow.ts
// (LEAN_OFFSET_TO_EDGE is the inverse). Preserves the correct rotation-0 layout.
const LEAN_EDGE_TO_OFFSET = [2, 5, 3, 0, 4, 1] as const;
const leanVertexEdge = (edge: number, rotation: number): number =>
  (HEX_DIR_TO_VERTEX_EDGE[(rotation ^ 1) % 6]! + LEAN_EDGE_TO_OFFSET[edge]!) % 6;

// Draw connection-point indicators on hex 0 of any piece type (positions 0-11).
// Each edge has 2 positions: drawn at 1/3 and 2/3 along the vertex edge.
//
// Non-mine pieces: config.ts defines template edge 0 = LEFT edge (vertex edge 3 at
// rotation 0). Rotating by R CW steps shifts each edge by R: vertex edge = (edge + R + 3) % 6.
//
// Mine hex 0: template edge 0 = the edge facing direction 0 (right) at rotation 0 —
// opposite convention. Old formula HEX_DIR_TO_VERTEX_EDGE[(edge + R) % 6] is correct.
function drawConnectionPointsAt(
  ctx: CanvasRenderingContext2D,
  pieceType: PieceType,
  rotation: number,
  cx: number, cy: number,
  sz: number,
): void {
  if (sz < 18) return;
  const template = PIECE_TEMPLATES[pieceType];
  const isMine = pieceType === 'mine';
  const points = isMine ? template.points.slice(0, 12) : template.points;
  const corners = hexCorners(cx, cy, sz);
  const r = Math.max(3, sz * 0.072); // ~15% smaller symbols (was 0.085)
  const inset = 0.72;

  for (let edge = 0; edge < 6; edge++) {
    const ve = isMine
      ? HEX_DIR_TO_VERTEX_EDGE[(edge + rotation) % 6]!
      : (edge + rotation + 3) % 6;
    const v0 = corners[ve]!;
    const v1 = corners[(ve + 1) % 6]!;
    for (let w = 0; w < 2; w++) {
      const pt = points[edge * 2 + w];
      if (!pt?.enabled || pt.role === 'disabled') continue;
      const t = w === 0 ? 1 / 3 : 2 / 3;
      const mx = v0.x + (v1.x - v0.x) * t;
      const my = v0.y + (v1.y - v0.y) * t;
      const px = cx + (mx - cx) * inset;
      const py = cy + (my - cy) * inset;
      const dx = mx - cx, dy = my - cy;
      const len = Math.sqrt(dx * dx + dy * dy) || 1;
      drawPointIndicator(ctx, px, py, dx / len, dy / len, pt.role, r);
    }
  }
}

// Draw hex-1 connection points for a mine (positions 12-23) via leanVertexEdge, so the
// 3 ore outputs render at the every-other edges (opposite parity to the internal edge)
// for EVERY rotation — not just rotation 0. Internal edge (template edge 3) faces hex 0.
function drawMineHex1Points(
  ctx: CanvasRenderingContext2D,
  _q: number, _r: number,
  rotation: number,
  cx: number, cy: number,
  sz: number,
): void {
  if (sz < 18) return;
  const template = PIECE_TEMPLATES['mine'];
  const hex1Points = template.points.slice(12);
  const corners = hexCorners(cx, cy, sz);
  const r = Math.max(3, sz * 0.072); // ~15% smaller symbols (was 0.085)
  const inset = 0.72;
  for (let edge = 0; edge < 6; edge++) {
    const ve = leanVertexEdge(edge, rotation);
    const v0 = corners[ve]!;
    const v1 = corners[(ve + 1) % 6]!;
    for (let w = 0; w < 2; w++) {
      const pt = hex1Points[edge * 2 + w];
      if (!pt?.enabled || pt.role === 'disabled') continue;
      const t = w === 0 ? 1 / 3 : 2 / 3;
      const mx = v0.x + (v1.x - v0.x) * t;
      const my = v0.y + (v1.y - v0.y) * t;
      const px = cx + (mx - cx) * inset;
      const py = cy + (my - cy) * inset;
      const dx = mx - cx, dy = my - cy;
      const len = Math.sqrt(dx * dx + dy * dy) || 1;
      drawPointIndicator(ctx, px, py, dx / len, dy / len, pt.role, r);
    }
  }
}

// Draw one indicator symbol at (px, py) with outward unit vector (nx, ny).
function drawPointIndicator(
  ctx: CanvasRenderingContext2D,
  px: number, py: number,
  nx: number, ny: number,
  role: PointRole,
  r: number,
): void {
  ctx.save();
  switch (role) {
    case 'belt':
      // Open circle (belt connection point)
      ctx.strokeStyle = '#90a4ae';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.stroke();
      break;

    case 'input_buffer':
      // Filled triangle pointing INWARD (tip toward hex center)
      ctx.fillStyle = '#29b6f6';
      drawTriangle(ctx, px, py, -nx, -ny, r);
      ctx.fill();
      // Thin outline
      ctx.strokeStyle = '#01579b';
      ctx.lineWidth = 0.8;
      ctx.stroke();
      break;

    case 'output_buffer':
      // Filled triangle pointing OUTWARD (tip away from hex center)
      ctx.fillStyle = '#66bb6a';
      drawTriangle(ctx, px, py, nx, ny, r);
      ctx.fill();
      ctx.strokeStyle = '#1b5e20';
      ctx.lineWidth = 0.8;
      ctx.stroke();
      break;

    case 'ore_output':
      // Diamond (ore exits mine)
      ctx.fillStyle = '#ffb74d';
      ctx.beginPath();
      ctx.moveTo(px + nx * r,       py + ny * r);        // outward tip
      ctx.lineTo(px - ny * r * 0.7, py + nx * r * 0.7);  // side 1
      ctx.lineTo(px - nx * r,       py - ny * r);        // inward tip
      ctx.lineTo(px + ny * r * 0.7, py - nx * r * 0.7);  // side 2
      ctx.closePath();
      ctx.fill();
      break;
  }
  ctx.restore();
}

// Draw a filled triangle with tip in direction (dirX, dirY) centered at (cx, cy), radius r.
function drawTriangle(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number,
  dirX: number, dirY: number,
  r: number,
): void {
  const px = -dirY, py = dirX; // perpendicular
  ctx.beginPath();
  ctx.moveTo(cx + dirX * r,             cy + dirY * r);              // tip
  ctx.lineTo(cx - dirX * r + px * r * 0.75, cy - dirY * r + py * r * 0.75); // base L
  ctx.lineTo(cx - dirX * r - px * r * 0.75, cy - dirY * r - py * r * 0.75); // base R
  ctx.closePath();
}

// ── Hit testing ───────────────────────────────────────────────────────────────

export function hitTestPiece(
  px: number, py: number,
  state: GameState,
  t: BoardTransform,
): BoardPiece | null {
  const hit = pixelToHex(px, py, t.hexSize, t.offsetX, t.offsetY);
  for (const piece of state.board) {
    if (piece.coord.q === hit.q && piece.coord.r === hit.r) return piece;
    if (piece.type === 'mine') {
      const sec = mineSecondaryCoord(piece.coord, piece.rotation ?? 0);
      if (sec.q === hit.q && sec.r === hit.r) return piece;
    }
  }
  return null;
}

export function hitTestFreeCoord(
  px: number, py: number,
  state: GameState,
  t: BoardTransform,
): HexCoord | null {
  const hit = pixelToHex(px, py, t.hexSize, t.offsetX, t.offsetY);
  for (const piece of state.board) {
    if (piece.coord.q === hit.q && piece.coord.r === hit.r) return null;
    if (piece.type === 'mine') {
      const sec = mineSecondaryCoord(piece.coord, piece.rotation ?? 0);
      if (sec.q === hit.q && sec.r === hit.r) return null;
    }
  }
  return hit;
}

// ── Route overlay (findRoute-driven belt picker) ──────────────────────────────

// Pixel centre of any connection point on any piece — handles the mine's two hexes and
// their distinct edge conventions, matching the markers drawn by drawConnectionPointsAt /
// drawMineHex1Points so a route point lands exactly on its drawn dot.
export function connectionPointPixel(piece: BoardPiece, position: number, ox: number, oy: number, sz: number): Point {
  const rotation = piece.rotation ?? 0;
  let cx: number, cy: number, ve: number, w: number;

  if (piece.type === 'mine' && position >= 12) {
    const sec = mineSecondaryCoord(piece.coord, rotation);
    const c = hexToPixel(sec.q, sec.r, sz, ox, oy);
    cx = c.x; cy = c.y;
    const edge = Math.floor((position - 12) / 2); w = (position - 12) % 2;
    ve = leanVertexEdge(edge, rotation);
  } else {
    const c = hexToPixel(piece.coord.q, piece.coord.r, sz, ox, oy);
    cx = c.x; cy = c.y;
    const edge = Math.floor(position / 2); w = position % 2;
    ve = piece.type === 'mine'
      ? HEX_DIR_TO_VERTEX_EDGE[(edge + rotation) % 6]!
      : (edge + rotation + 3) % 6;
  }

  const corners = hexCorners(cx, cy, sz);
  const v0 = corners[ve]!, v1 = corners[(ve + 1) % 6]!;
  const t = w === 0 ? 1 / 3 : 2 / 3;
  const mx = v0.x + (v1.x - v0.x) * t;
  const my = v0.y + (v1.y - v0.y) * t;
  const inset = 0.72;
  return { x: cx + (mx - cx) * inset, y: cy + (my - cy) * inset };
}

// Nearest candidate connection point to (px,py) within the hit radius, or null.
export function hitTestPointAmong(
  px: number, py: number,
  candidates: ReadonlyArray<RoutePointRef>,
  state: GameState,
  t: BoardTransform,
): RoutePointRef | null {
  const hitR = Math.max(8, t.hexSize * 0.22);
  let best: RoutePointRef | null = null;
  let bestD = Infinity;
  for (const c of candidates) {
    const piece = state.board.find(p => p.id === c.pieceId);
    if (!piece) continue;
    const pt = connectionPointPixel(piece, c.position, t.offsetX, t.offsetY, t.hexSize);
    const d = Math.hypot(px - pt.x, py - pt.y);
    if (d <= hitR && d < bestD) { best = c; bestD = d; }
  }
  return best;
}

function drawPointDot(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, fill: string, ring: boolean): void {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  if (ring) {
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}

function drawRouteMode(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  rm: RouteModeView,
  ox: number, oy: number, sz: number,
): void {
  const r = Math.max(4, sz * 0.14);
  const baseColor = '#90caf9'; // belt connection point
  const sameRef = (a: RoutePointRef | null, b: RoutePointRef) =>
    a !== null && a.pieceId === b.pieceId && a.position === b.position;

  // Candidate belt-point markers (hovered one gets a ring).
  for (const c of rm.candidatePoints) {
    const piece = state.board.find(p => p.id === c.pieceId);
    if (!piece) continue;
    const { x, y } = connectionPointPixel(piece, c.position, ox, oy, sz);
    ctx.save();
    ctx.globalAlpha = 0.9;
    drawPointDot(ctx, x, y, r, baseColor, sameRef(rm.hoverPoint, c));
    ctx.restore();
  }

  // Chosen start point gets a persistent white-ringed amber dot.
  if (rm.selectedSource) {
    const piece = state.board.find(p => p.id === rm.selectedSource!.pieceId);
    if (piece) {
      const { x, y } = connectionPointPixel(piece, rm.selectedSource.position, ox, oy, sz);
      drawPointDot(ctx, x, y, r, '#ffd54f', true);
    }
  }

  // Route preview: belts the player can afford are solid; the rest dashed.
  if (rm.route) {
    rm.route.forEach((b, i) => {
      const piece = state.board.find(p => p.id === b.pieceId);
      if (!piece) return;
      const { x: cx, y: cy } = hexToPixel(piece.coord.q, piece.coord.r, sz, ox, oy);
      const { p1, cp1, cp2, p2 } = beltSpline(cx, cy, sz, piece.rotation ?? 0, b.fromPoint, b.toPoint);
      const affordable = i < rm.beltsRemaining;
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.bezierCurveTo(cp1.x, cp1.y, cp2.x, cp2.y, p2.x, p2.y);
      ctx.strokeStyle = affordable ? '#66ff99' : '#ffa733';
      ctx.lineWidth = 5;
      ctx.lineCap = 'round';
      if (!affordable) ctx.setLineDash([8, 5]);
      ctx.stroke();
      ctx.restore();
    });
  }
}
