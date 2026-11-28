// The colours of the four materials: the one place they are defined. The 3D pieces (models.ts,
// and tools/convert-3mf.mjs when it bakes public/models/*.glb), the 2D icons (ui/icons.ts) and
// the Mine symbols all read them from here.
//
// In the printed game every more valuable material is a darker green: Ore light green, Plate mid
// green, Sphere dark green, Tesseract very dark green (owner, 2026-11-27). The designer's print
// file gives the four materials Bambu Studio slot colours that do not follow that order (filaments
// 8, 7, 6, 5: #A4FFA6, #6BFA27, #9DFB20, #B7EC00, all very light), so the ramp is designed here:
// one green hue (CIE LCh hue 136-142) at evenly spaced lightness, L* 82 / 62 / 42 / 24.
//
// Plain data with type-only imports, so Node can load this file as it is (the converter imports it).

import type { Material } from '../engine/config';

/** sRGB fill colour of each material, lightest (least valuable) to darkest (most valuable). */
export const MATERIAL_COLOR: Readonly<Record<Material, string>> = {
  ore: '#92DF7E', // L* 82
  plate: '#4CA945', // L* 62
  sphere: '#237228', // L* 42
  tesseract: '#114218', // L* 24
};

/** Materials in value order (the order the colours darken in). */
export const MATERIALS_BY_VALUE: readonly Material[] = ['ore', 'plate', 'sphere', 'tesseract'];

/**
 * Surface of the 3D pieces. The darker pieces are a little glossier, so the table's light catches
 * their edges and a Tesseract in shadow still reads as green, not as a black hole; the emissive is
 * a faint glow of the piece's own colour for the same reason. Neither changes the order of the ramp.
 */
export const MATERIAL_SURFACE: Readonly<Record<Material, { readonly roughness: number; readonly emissive: number }>> = {
  ore: { roughness: 0.6, emissive: 0 },
  plate: { roughness: 0.55, emissive: 0 },
  sphere: { roughness: 0.45, emissive: 0.08 },
  tesseract: { roughness: 0.4, emissive: 0.18 },
};

/** Mix two sRGB hex colours: t = 0 gives `a`, t = 1 gives `b` (in sRGB, as CSS mixes). */
export function mixHex(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const ch = (p: number, s: number): number => (p >> s) & 255;
  const out = [16, 8, 0].map(s => Math.round(ch(pa, s) + (ch(pb, s) - ch(pa, s)) * t));
  return `#${out.map(v => v.toString(16).padStart(2, '0')).join('').toUpperCase()}`;
}

/**
 * The thin lighter edge drawn round each 2D material icon, so a dark Sphere or Tesseract still shows
 * on the dark panels. Always lighter than the fill; the fill keeps the true colour.
 */
export const MATERIAL_EDGE: Readonly<Record<Material, string>> = {
  ore: mixHex(MATERIAL_COLOR.ore, '#F2FFEE', 0.55),
  plate: mixHex(MATERIAL_COLOR.plate, '#F2FFEE', 0.5),
  sphere: mixHex(MATERIAL_COLOR.sphere, '#F2FFEE', 0.45),
  tesseract: mixHex(MATERIAL_COLOR.tesseract, '#F2FFEE', 0.45),
};

/** WCAG relative luminance (0 black .. 1 white) of an sRGB hex colour. */
export function relativeLuminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const lin = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(c => lin(c / 255)) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
