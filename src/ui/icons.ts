// Inline SVG icons, drawn after the printed pieces (from the mock-ups). The SVG text is a
// fixed constant of this file; colours come only from the fixed player colour table and the
// fixed material colours (table/materialColors.ts).

import type { Material } from '../engine/config';
import type { SeatColor } from '../session/room';
import { MATERIAL_COLOR, MATERIAL_EDGE } from '../table/materialColors';

export const COLORS: Record<SeatColor, string> = { blue: '#2f6fd6', red: '#e0454f', orange: '#f08a24', green: '#2e9e5b' };
export const COLOR_NAME: Record<SeatColor, string> = { blue: 'Blue', red: 'Red', orange: 'Orange', green: 'Green' };

/** Fill and edge of a material icon (colours from table/materialColors.ts). */
const mat = (m: Material): string => `fill="${MATERIAL_COLOR[m]}" stroke="${MATERIAL_EDGE[m]}" stroke-width="1.2" stroke-linejoin="round"`;

const svg = (body: string, vb = '0 0 24 24'): string => `<svg viewBox="${vb}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">${body}</svg>`;

const ICONS = {
  // Materials: the true colour as the fill, with a thin lighter edge so the dark ones show on dark panels.
  ore: (): string => svg(`<path d="M12 3.2c.6 0 1.1.3 1.4.8l8 13.7c.6 1-.1 2.3-1.3 2.3H3.9c-1.2 0-1.9-1.3-1.3-2.3l8-13.7c.3-.5.8-.8 1.4-.8z" ${mat('ore')}/>`),
  plate: (): string => svg(`<path d="M8.2 5.5h13c.9 0 1.4.9 1 1.6l-5.5 10.6c-.2.5-.7.8-1.2.8h-13c-.9 0-1.4-.9-1-1.6L7 6.3c.2-.5.7-.8 1.2-.8z" ${mat('plate')}/>`),
  sphere: (): string => svg(`<circle cx="12" cy="12" r="9" ${mat('sphere')}/><circle cx="12" cy="12" r="6.4" fill="none" stroke="${MATERIAL_EDGE.sphere}" stroke-opacity=".35" stroke-width="1"/>`),
  tess: (): string => svg(`<path d="M12 2.5l2.3 7.2 7.2 2.3-7.2 2.3L12 21.5l-2.3-7.2L2.5 12l7.2-2.3z" ${mat('tesseract')}/>`),
  power: (): string => svg('<circle cx="12" cy="12" r="10" fill="#e1ac36"/><path d="M13.6 4.6 7.6 13h3.6l-1.6 6.4 6.6-9h-3.7l1.9-5.8z" fill="#121214"/>'),
  card: (): string => svg('<rect x="5" y="2.5" width="14" height="19" rx="2.2" fill="#121214" stroke="#e8b730" stroke-width="1.4"/><path d="M8 9c3-3 5 3 8 0M8 14c3-3 5 3 8 0" stroke="#e8b730" stroke-width="1.2" fill="none"/>'),
  meeple: (c: string): string => svg(`<g fill="${c}"><circle cx="12" cy="5.4" r="3.9"/><rect x="2.2" y="8.4" width="19.6" height="5.4" rx="2.7"/><path d="M7.2 10.5h9.6l2.7 9.6c.3 1-.4 1.9-1.4 1.9h-3.3L12 17.6 9.2 22H5.9c-1 0-1.7-.9-1.4-1.9z"/></g>`),
  check: (): string => svg('<path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>'),
  cross: (): string => svg('<path d="M6.5 6.5l11 11M17.5 6.5l-11 11" stroke="currentColor" stroke-width="2.8" stroke-linecap="round"/>'),
  link: (): string => svg('<path d="M10 14a4 4 0 0 0 5.7 0l3.2-3.2a4 4 0 0 0-5.7-5.7l-1.3 1.3M14 10a4 4 0 0 0-5.7 0l-3.2 3.2a4 4 0 0 0 5.7 5.7l1.3-1.3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>'),
  download: (): string => svg('<path d="M12 3.5v11M7.5 10l4.5 4.5 4.5-4.5M4.5 19.5h15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>'),
  share: (): string => svg('<circle cx="6" cy="12" r="2.6" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="17.5" cy="5.5" r="2.6" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="17.5" cy="18.5" r="2.6" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8.3 10.7l6.9-3.9M8.3 13.3l6.9 3.9" stroke="currentColor" stroke-width="2"/>'),
  menu: (): string => svg('<path d="M4.5 7h15M4.5 12h15M4.5 17h15" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>'),
  leave: (): string => svg('<path d="M10 4.5H5.5v15H10M14.5 8l4 4-4 4M18.5 12H9" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>'),
  file: (): string => svg('<path d="M6 3h8l4 4v14H6z" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"/><path d="M14 3v4h4M9 13h6M9 17h6" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/>'),
  copy: (): string => svg('<rect x="8" y="8" width="12" height="12" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.9"/><path d="M16 5.5V5a1.5 1.5 0 0 0-1.5-1.5h-9A1.5 1.5 0 0 0 4 5v9a1.5 1.5 0 0 0 1.5 1.5H6" fill="none" stroke="currentColor" stroke-width="1.9"/>'),
  install: (): string => svg('<rect x="6" y="2.5" width="12" height="19" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 7v7.5M9 11.5l3 3 3-3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>'),
  bot: (): string => svg('<rect x="4.5" y="7.5" width="15" height="11" rx="3" fill="none" stroke="currentColor" stroke-width="1.9"/><circle cx="9.5" cy="13" r="1.4" fill="currentColor"/><circle cx="14.5" cy="13" r="1.4" fill="currentColor"/><path d="M12 7.5V4.5" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/><circle cx="12" cy="3.6" r="1.3" fill="currentColor"/>'),
  crown: (): string => svg('<path d="M4 17.5 3 7.5l5 4 4-6 4 6 5-4-1 10z" fill="currentColor"/>'),
  wifi: (): string => svg('<path d="M3 9.5a13 13 0 0 1 18 0M6 12.8a8.5 8.5 0 0 1 12 0M9 16a4 4 0 0 1 6 0" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="19" r="1.4" fill="currentColor"/>'),
  trash: (): string => svg('<path d="M5 7h14M10 7V4.5h4V7M7 7l1 13h8l1-13" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>'),
  chevron: (): string => svg('<path d="M8 10l4 4 4-4" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>'),
  play: (): string => svg('<path d="M8 5.5v13l10-6.5z" fill="currentColor"/>'),
  pause: (): string => svg('<rect x="6.5" y="5.5" width="4" height="13" rx="1" fill="currentColor"/><rect x="13.5" y="5.5" width="4" height="13" rx="1" fill="currentColor"/>'),
  stepBack: (): string => svg('<path d="M17 5.5v13L8.5 12z" fill="currentColor"/><rect x="5.5" y="5.5" width="2.6" height="13" rx="1" fill="currentColor"/>'),
  stepFwd: (): string => svg('<path d="M7 5.5v13l8.5-6.5z" fill="currentColor"/><rect x="15.9" y="5.5" width="2.6" height="13" rx="1" fill="currentColor"/>'),
  toStart: (): string => svg('<path d="M12.5 6v12L5.5 12zM20 6v12l-7-6z" fill="currentColor"/>'),
  toEnd: (): string => svg('<path d="M4 6v12l7-6zM11.5 6v12l7-6z" fill="currentColor"/>'),
  flag: (): string => svg('<path d="M6 21V4M6 4.5h11l-2.5 4 2.5 4H6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>'),
  replay: (): string => svg('<path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><path d="M4 3.5v4.6h4.6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/><path d="M10.5 8.8v6.4l5-3.2z" fill="currentColor"/>'),
  belt: (c: string): string => svg(`<g fill="${c}"><path d="M1 8h3.4l3 4-3 4H1l3-4z"/><path d="M7.4 8h3.4l3 4-3 4H7.4l3-4z"/><path d="M13.8 8h3.4l3 4-3 4h-3.4l3-4z"/><path d="M19.6 7.2 23.4 12l-3.8 4.8z"/></g>`),
  teleporter: (c: string): string => svg(`<ellipse cx="12" cy="15" rx="8.5" ry="4" fill="none" stroke="${c}" stroke-width="2.6"/><path d="M3.5 15V10M20.5 15V10" stroke="${c}" stroke-width="2.6"/><ellipse cx="12" cy="10" rx="8.5" ry="4" fill="none" stroke="#fff" stroke-opacity=".85" stroke-width="1.4"/>`),
  mine: (): string => svg('<polygon points="3,12 6,7 12,7 15,12 12,17 6,17" fill="#efede6"/><circle cx="9" cy="12" r="2.2" fill="#151515"/><g stroke="#151515" stroke-width="1.1"><path d="M9 8.2V7.4M9 15.8v.8M5.6 10l-.8-.5M12.4 14l.8.5M5.6 14l-.8.5M12.4 10l.8-.5"/></g><polygon points="15,12 18,7 22.5,9.5 22.5,14.5 18,17" fill="#efede6"/>'),
  exchange: (): string => svg('<path d="M5 8h13l-3.5-3.5M19 16H6l3.5 3.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>'),
  undo: (): string => svg('<path d="M9 7 4.5 11.5 9 16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/><path d="M5 11.5h9.5a5 5 0 0 1 0 10H12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>'),
  rotate: (): string => svg('<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><path d="M20 3.5v4.6h-4.6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>'),
  recenter: (): string => svg('<circle cx="12" cy="12" r="3.2" fill="currentColor"/><path d="M12 2.5v4M12 17.5v4M2.5 12h4M17.5 12h4" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><circle cx="12" cy="12" r="7.5" fill="none" stroke="currentColor" stroke-width="1.6"/>'),
  topdown: (): string => svg('<polygon points="12,3 20,7.5 20,16.5 12,21 4,16.5 4,7.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 8v8M8 12h8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>'),
  book: (): string => svg('<path d="M4 5.5c2.8-1.2 5.5-1.2 8 .5 2.5-1.7 5.2-1.7 8-.5v13c-2.8-1.2-5.5-1.2-8 .5-2.5-1.7-5.2-1.7-8-.5z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M12 6v13" stroke="currentColor" stroke-width="1.8"/>'),
  table: (): string => svg('<polygon points="12,3 20,7.5 20,16.5 12,21 4,16.5 4,7.5" fill="none" stroke="currentColor" stroke-width="2"/><polygon points="12,8 15.5,10 15.5,14 12,16 8.5,14 8.5,10" fill="currentColor"/>'),
  list: (): string => svg('<path d="M9 7h11M9 12h11M9 17h11" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="4.5" cy="7" r="1.4" fill="currentColor"/><circle cx="4.5" cy="12" r="1.4" fill="currentColor"/><circle cx="4.5" cy="17" r="1.4" fill="currentColor"/>'),
  pipOn: (): string => svg('<path d="M12 2.5l2.6 6.9 6.9 2.6-6.9 2.6L12 21.5l-2.6-6.9L2.5 12l6.9-2.6z" fill="#e8b730" stroke="#e8b730" stroke-width="1.8" stroke-linejoin="round"/>'),
  pipOff: (): string => svg('<path d="M12 2.5l2.6 6.9 6.9 2.6-6.9 2.6L12 21.5l-2.6-6.9L2.5 12l6.9-2.6z" fill="none" stroke="#6d6a64" stroke-width="1.8" stroke-linejoin="round"/>'),
  dice: (): string => svg('<rect x="3.5" y="3.5" width="17" height="17" rx="3.5" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="8.5" cy="8.5" r="1.5" fill="currentColor"/><circle cx="15.5" cy="15.5" r="1.5" fill="currentColor"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/>'),
};

export type IconName = keyof typeof ICONS;
/** Every icon name (for checks that content names only icons that exist). */
export const ICON_NAMES = Object.keys(ICONS) as IconName[];

export function icon(name: IconName, color?: SeatColor, cls = 'ic'): HTMLElement {
  const el = document.createElement('i');
  el.className = cls;
  // Constant SVG markup from this file; `color` can only be one of the four fixed colours.
  const c = color ? COLORS[color] : name === 'meeple' ? '#75716a' : '#b9b4aa';
  el.innerHTML = name === 'meeple' || name === 'belt' || name === 'teleporter'
    ? ICONS[name](c)
    : (ICONS[name] as () => string)();
  return el;
}

/** The game's mark: a white hexagon with three gold belt chevrons. */
export function mark(cls: string): HTMLElement {
  const el = document.createElement('span');
  el.className = cls;
  el.innerHTML = svg('<polygon points="20,2 36,11 36,29 20,38 4,29 4,11" fill="#efede6"/><g fill="#e8b730"><path d="M9 22h4l3-4-3-4H9l3 4z"/><path d="M16 22h4l3-4-3-4h-4l3 4z"/><path d="M23 22h4l3-4-3-4h-4l3 4z"/></g><path d="M8 27a3 3 0 0 1 6 0z" fill="#141416"/><path d="M26 27a3 3 0 0 1 6 0z" fill="#141416"/>', '0 0 40 40');
  return el;
}
