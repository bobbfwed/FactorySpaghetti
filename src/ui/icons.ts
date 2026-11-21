// Inline SVG icons, drawn after the printed pieces (from the mock-ups). The SVG text is a
// fixed constant of this file; colours come only from the fixed player colour table.

import type { SeatColor } from '../session/room';

export const COLORS: Record<SeatColor, string> = { blue: '#2f6fd6', red: '#e0454f', orange: '#f08a24', green: '#2e9e5b' };
export const COLOR_NAME: Record<SeatColor, string> = { blue: 'Blue', red: 'Red', orange: 'Orange', green: 'Green' };

const svg = (body: string, vb = '0 0 24 24'): string => `<svg viewBox="${vb}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">${body}</svg>`;

const ICONS = {
  ore: (): string => svg('<path d="M12 3.2c.6 0 1.1.3 1.4.8l8 13.7c.6 1-.1 2.3-1.3 2.3H3.9c-1.2 0-1.9-1.3-1.3-2.3l8-13.7c.3-.5.8-.8 1.4-.8z" fill="#9ee89c"/>'),
  plate: (): string => svg('<path d="M8.2 5.5h13c.9 0 1.4.9 1 1.6l-5.5 10.6c-.2.5-.7.8-1.2.8h-13c-.9 0-1.4-.9-1-1.6L7 6.3c.2-.5.7-.8 1.2-.8z" fill="#3fbf4c"/>'),
  sphere: (): string => svg('<circle cx="12" cy="12" r="9" fill="#a9d630"/><circle cx="12" cy="12" r="6.8" fill="none" stroke="rgba(0,0,0,.18)" stroke-width="1.2"/>'),
  tess: (): string => svg('<path d="M12 2.5l2.3 7.2 7.2 2.3-7.2 2.3L12 21.5l-2.3-7.2L2.5 12l7.2-2.3z" fill="#5fcf6a" stroke="#1d4a29" stroke-width="1" stroke-linejoin="round"/>'),
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
  dice: (): string => svg('<rect x="3.5" y="3.5" width="17" height="17" rx="3.5" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="8.5" cy="8.5" r="1.5" fill="currentColor"/><circle cx="15.5" cy="15.5" r="1.5" fill="currentColor"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/>'),
};

export type IconName = keyof typeof ICONS;

export function icon(name: IconName, color?: SeatColor, cls = 'ic'): HTMLElement {
  const el = document.createElement('i');
  el.className = cls;
  // Constant SVG markup from this file; `color` can only be one of the four fixed colours.
  el.innerHTML = name === 'meeple' ? ICONS.meeple(color ? COLORS[color] : '#75716a') : (ICONS[name] as () => string)();
  return el;
}

/** The game's mark: a white hexagon with three gold belt chevrons. */
export function mark(cls: string): HTMLElement {
  const el = document.createElement('span');
  el.className = cls;
  el.innerHTML = svg('<polygon points="20,2 36,11 36,29 20,38 4,29 4,11" fill="#efede6"/><g fill="#e8b730"><path d="M9 22h4l3-4-3-4H9l3 4z"/><path d="M16 22h4l3-4-3-4h-4l3 4z"/><path d="M23 22h4l3-4-3-4h-4l3 4z"/></g><path d="M8 27a3 3 0 0 1 6 0z" fill="#141416"/><path d="M26 27a3 3 0 0 1 6 0z" fill="#141416"/>', '0 0 40 40');
  return el;
}
