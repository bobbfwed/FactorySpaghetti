// Canvas-drawn textures: wood table, Control Module numerals, dice faces, card faces.

import * as THREE from 'three';
import type { CardType } from '../engine/state';

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  if (!g) throw new Error('2D canvas unavailable');
  return [c, g];
}

function srgb(t: THREE.CanvasTexture): THREE.CanvasTexture {
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** Dark wood with long deterministic grain streaks (same look as tools/gallery). */
export function woodTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(1024, 1024);
  g.fillStyle = '#2f1f14';
  g.fillRect(0, 0, 1024, 1024);
  let seed = 7;
  const rnd = (): number => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 460; i++) {
    const y = rnd() * 1024;
    g.strokeStyle = (rnd() < 0.5 ? 'rgba(15,8,4,' : 'rgba(85,56,36,') + (0.08 + rnd() * 0.18) + ')';
    g.lineWidth = 1 + rnd() * 3;
    g.beginPath();
    g.moveTo(0, y);
    for (let x = 0; x <= 1024; x += 64) g.lineTo(x, y + Math.sin(x / 180 + i) * 6 * rnd());
    g.stroke();
  }
  const t = srgb(new THREE.CanvasTexture(c));
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(6, 6);
  return t;
}

export const NUMERAL_COLS = 6;
export const NUMERAL_ROWS = 3;

/**
 * White numerals 1-18 on transparent, 6 x 3 cells; 6 and 9 carry a bar underneath, as printed. Each
 * numeral instance tints them (near black, or dimmed on a Control Module that cannot be rolled).
 */
export function numeralAtlas(): THREE.CanvasTexture {
  const cell = 128;
  const [c, g] = canvas(cell * NUMERAL_COLS, cell * NUMERAL_ROWS);
  g.clearRect(0, 0, c.width, c.height);
  g.fillStyle = '#fff';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  for (let n = 1; n <= 18; n++) {
    const col = (n - 1) % NUMERAL_COLS, row = Math.floor((n - 1) / NUMERAL_COLS);
    const cx = col * cell + cell / 2, cy = row * cell + cell / 2;
    const text = String(n);
    const size = text.length > 1 ? 74 : 92;
    g.font = `800 ${size}px "Segoe UI", Roboto, Helvetica, Arial, sans-serif`;
    g.fillText(text, cx, cy + (n === 6 || n === 9 ? -6 : 2));
    if (n === 6 || n === 9) g.fillRect(cx - 22, cy + 38, 44, 10);
  }
  const t = srgb(new THREE.CanvasTexture(c));
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

/** Cell offset (in cell units, bottom-left origin) of numeral n in the atlas, for the shader. */
export function numeralCell(n: number): [number, number] {
  const i = Math.min(18, Math.max(1, Math.round(n))) - 1;
  const col = i % NUMERAL_COLS, row = Math.floor(i / NUMERAL_COLS);
  return [col, NUMERAL_ROWS - 1 - row];
}

/** Die faces 1-6 in a 3 x 2 atlas (ivory with black pips). */
export function diceAtlas(): THREE.CanvasTexture {
  const s = 128;
  const [c, g] = canvas(s * 3, s * 2);
  const pips: Record<number, Array<[number, number]>> = {
    1: [[0.5, 0.5]],
    2: [[0.27, 0.27], [0.73, 0.73]],
    3: [[0.25, 0.25], [0.5, 0.5], [0.75, 0.75]],
    4: [[0.27, 0.27], [0.73, 0.27], [0.27, 0.73], [0.73, 0.73]],
    5: [[0.25, 0.25], [0.75, 0.25], [0.5, 0.5], [0.25, 0.75], [0.75, 0.75]],
    6: [[0.27, 0.23], [0.73, 0.23], [0.27, 0.5], [0.73, 0.5], [0.27, 0.77], [0.73, 0.77]],
  };
  for (let v = 1; v <= 6; v++) {
    const x0 = ((v - 1) % 3) * s, y0 = Math.floor((v - 1) / 3) * s;
    g.fillStyle = '#f4efe4';
    g.fillRect(x0, y0, s, s);
    g.strokeStyle = 'rgba(0,0,0,0.12)';
    g.lineWidth = 6;
    g.strokeRect(x0 + 3, y0 + 3, s - 6, s - 6);
    g.fillStyle = v === 1 ? '#b3202c' : '#151515';
    for (const [px, py] of pips[v]!) {
      g.beginPath();
      g.arc(x0 + px * s, y0 + py * s, v === 1 ? 15 : 11, 0, Math.PI * 2);
      g.fill();
    }
  }
  return srgb(new THREE.CanvasTexture(c));
}

/** UV rectangle [u0, v0, u1, v1] of die face v in the atlas (flipY texture: v measured from the bottom). */
export function diceCell(v: number): [number, number, number, number] {
  const col = (v - 1) % 3, row = Math.floor((v - 1) / 3);
  return [col / 3, 1 - (row + 1) / 2, (col + 1) / 3, 1 - row / 2];
}

/** Leverage card back: black with a yellow border and the word LEVERAGE (as in the mock-ups). */
export function cardBackTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(256, 358);
  g.fillStyle = '#16140f';
  g.fillRect(0, 0, 256, 358);
  g.strokeStyle = '#e8c33a';
  g.lineWidth = 10;
  g.strokeRect(12, 12, 232, 334);
  g.lineWidth = 3;
  g.strokeStyle = 'rgba(232,195,58,0.55)';
  for (let i = 0; i < 5; i++) {
    g.beginPath();
    g.moveTo(30, 90 + i * 45);
    g.bezierCurveTo(110, 40 + i * 50, 150, 160 + i * 40, 226, 110 + i * 45);
    g.stroke();
  }
  g.fillStyle = '#e8c33a';
  g.fillRect(40, 160, 176, 38);
  g.fillStyle = '#16140f';
  g.font = '800 26px "Segoe UI", Roboto, Arial, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('LEVERAGE', 128, 180);
  return srgb(new THREE.CanvasTexture(c));
}

const CARD_TITLE: Readonly<Record<CardType, string>> = {
  scoutingDrone: 'Scouting Drone',
  shortSale: 'Short Sale',
  embezzlement: 'Embezzlement',
  sinkHole: 'Sink Hole',
  overstockSupplies: 'Overstock Supplies',
  netSurplusSellOff: 'Net Surplus Sell-Off',
  changingPriorities: 'Changing Priorities',
  productionIncrease: 'Production Increase',
  mineInspection: 'Mine Inspection',
  personalJetPack: 'Personal Jet Pack',
  assetForfeiture: 'Asset Forfeiture',
  rdTaxWriteOff: 'R&D Tax Write-Off',
  solarFlare: 'Solar Flare',
};

/** Face of a played card (top of the discard pile): cream card, yellow title band. */
export function cardFaceTexture(card: CardType | null): THREE.CanvasTexture {
  const [c, g] = canvas(256, 358);
  g.fillStyle = card ? '#f3ecd9' : '#3a3428';
  g.fillRect(0, 0, 256, 358);
  g.strokeStyle = '#16140f';
  g.lineWidth = 8;
  g.strokeRect(8, 8, 240, 342);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  if (card) {
    g.fillStyle = '#e8c33a';
    g.fillRect(16, 16, 224, 86);
    g.fillStyle = '#16140f';
    g.font = '700 15px "Segoe UI", Roboto, Arial, sans-serif';
    g.fillText('LEVERAGE', 128, 32);
    g.font = '800 24px "Segoe UI", Roboto, Arial, sans-serif';
    const words = CARD_TITLE[card].split(' ');
    const lines = words.length > 2 ? [words.slice(0, 2).join(' '), words.slice(2).join(' ')] : [words.join(' ')];
    lines.forEach((l, i) => g.fillText(l, 128, 62 + i * 26 - (lines.length - 1) * 8));
    g.fillStyle = 'rgba(22,20,15,0.35)';
    for (let i = 0; i < 6; i++) g.fillRect(36, 140 + i * 26, 184 - (i % 3) * 30, 8);
  } else {
    g.fillStyle = 'rgba(243,236,217,0.4)';
    g.font = '700 22px "Segoe UI", Roboto, Arial, sans-serif';
    g.fillText('DISCARD', 128, 179);
  }
  return srgb(new THREE.CanvasTexture(c));
}
